import * as Dialog from '@radix-ui/react-dialog'
import type { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import CodeMirror from '@uiw/react-codemirror'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderPlus,
  KeyRound,
  Pencil,
  Plug,
  RefreshCw,
  Save,
  Server,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { FileEntry } from '@shared/schema'
import {
  REMOTE_SERVER_TEXT_FILE_MAX_BYTES,
  type RemoteServerConnectResult,
  type RemoteServerProfile,
  type RemoteServerProfileDraft,
  type RemoteServerStatusSnapshot
} from '@shared/remote-servers'
import { useI18n } from '../../i18n'
import { writeClipboardText } from '../../lib/clipboard'
import { codeLanguageDescriptionForFile, loadCodeLanguageForFile } from '../../lib/code-language'
import { cn } from '../../lib/utils'
import { DropdownSelect } from '../dropdown-select'
import type { AtlasComponentRendererProps } from '../registry'

type ConnectionState = {
  sessionId: string
  homePath: string
  hostKeyFingerprint: string
}

type FilePanelState = {
  rootPath: string
  tree: FileEntry | null
  selectedPath: string | null
  openPaths: string[]
}

type ProfileDialogState =
  | {
      mode: 'create'
      draft: RemoteServerProfileDraft
    }
  | {
      mode: 'edit'
      profileId: string
      draft: RemoteServerProfileDraft
    }

type NameDialogState = {
  kind: 'file' | 'folder' | 'rename'
  target: FileEntry
  value: string
}

type HostKeyDialogState = {
  profileId: string
  kind: 'untrusted' | 'mismatch'
  expected?: string
  actual: string
}

type EditorState = {
  entry: FileEntry
  contents: string
  draft: string
}

const FILE_TREE_LOAD_DEPTH = 1
const STATUS_REFRESH_MS = 30_000
const TERMINAL_BUFFER_LIMIT = 80_000
const DEFAULT_TERMINAL_COLS = 100
const DEFAULT_TERMINAL_ROWS = 30
const REMOTE_SERVER_EDITOR_BASIC_SETUP = {
  autocompletion: false,
  closeBrackets: false,
  foldGutter: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: false,
  searchKeymap: true
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function emptyDraft(): RemoteServerProfileDraft {
  return {
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    privateKeyPath: '',
    password: '',
    passphrase: '',
    clearPassword: false,
    clearPassphrase: false
  }
}

function draftFromProfile(profile: RemoteServerProfile): RemoteServerProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authType: profile.authType,
    privateKeyPath: profile.privateKeyPath ?? '',
    password: '',
    passphrase: '',
    clearPassword: false,
    clearPassphrase: false
  }
}

function parentDirectoryPath(path: string): string {
  return path.replace(/\/[^/]+$/, '') || '/'
}

function containingDirectory(entry: FileEntry): string {
  return entry.kind === 'directory' ? entry.path : parentDirectoryPath(entry.path)
}

function findEntry(entry: FileEntry | null, path: string | null): FileEntry | null {
  if (!entry || !path) return null
  if (entry.path === path) return entry
  for (const child of entry.children ?? []) {
    const found = findEntry(child, path)
    if (found) return found
  }
  return null
}

function replaceEntry(entry: FileEntry, replacement: FileEntry): FileEntry {
  if (entry.path === replacement.path) return replacement
  if (!entry.children?.length) return entry

  let didReplace = false
  const children = entry.children.map((child) => {
    const nextChild = replaceEntry(child, replacement)
    if (nextChild !== child) didReplace = true
    return nextChild
  })
  return didReplace ? { ...entry, children } : entry
}

function removeEntry(entry: FileEntry, targetPath: string): FileEntry {
  if (!entry.children?.length) return entry
  return {
    ...entry,
    children: entry.children.filter((child) => child.path !== targetPath).map((child) => removeEntry(child, targetPath))
  }
}

function humanBytes(value: number | undefined): string {
  if (!value || value < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`
}

function terminalIsValidSize(terminal: Terminal): boolean {
  return terminal.cols >= 10 && terminal.rows >= 4
}

export function RemoteServerComponent({ canvasId, component, updateState, setHeaderActions, isNodeSelected = false }: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const activeProfileIdRef = useRef<string | null>(null)
  const connectionsRef = useRef<Record<string, ConnectionState>>({})
  const sessionDisposersRef = useRef(new Map<string, () => void>())
  const sessionBuffersRef = useRef(new Map<string, string>())
  const [profiles, setProfiles] = useState<RemoteServerProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState(() => asString(component.state.activeProfileId) || null)
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({})
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, RemoteServerStatusSnapshot>>({})
  const [filePanels, setFilePanels] = useState<Record<string, FilePanelState>>({})
  const [profileDialog, setProfileDialog] = useState<ProfileDialogState | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null)
  const [deleteProfile, setDeleteProfile] = useState<RemoteServerProfile | null>(null)
  const [hostKeyDialog, setHostKeyDialog] = useState<HostKeyDialogState | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState<string | null>(null)

  activeProfileIdRef.current = activeProfileId
  connectionsRef.current = connections

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? null,
    [activeProfileId, profiles]
  )
  const activeConnection = activeProfile ? connections[activeProfile.id] : undefined
  const activeFilePanel = activeProfile ? filePanels[activeProfile.id] : undefined
  const selectedEntry = activeFilePanel ? findEntry(activeFilePanel.tree, activeFilePanel.selectedPath) : null

  const appendTerminalBuffer = useCallback((profileId: string, data: string) => {
    const previous = sessionBuffersRef.current.get(profileId) ?? ''
    sessionBuffersRef.current.set(profileId, `${previous}${data}`.slice(-TERMINAL_BUFFER_LIMIT))
  }, [])

  const writeProfileTerminal = useCallback(
    (profileId: string, data: string) => {
      appendTerminalBuffer(profileId, data)
      if (activeProfileIdRef.current === profileId) {
        terminalRef.current?.write(data)
      }
    },
    [appendTerminalBuffer]
  )

  const writeProfileTerminalLine = useCallback(
    (profileId: string, message: string) => {
      writeProfileTerminal(profileId, `\r\n${message}\r\n`)
    },
    [writeProfileTerminal]
  )

  const clearProfileTerminal = useCallback((profileId: string) => {
    sessionBuffersRef.current.delete(profileId)
    if (activeProfileIdRef.current === profileId) {
      terminalRef.current?.reset()
    }
  }, [])

  const updateFilePanel = useCallback((profileId: string, patch: Partial<FilePanelState>) => {
    setFilePanels((current) => ({
      ...current,
      [profileId]: {
        rootPath: patch.rootPath ?? current[profileId]?.rootPath ?? '/',
        tree: patch.tree ?? current[profileId]?.tree ?? null,
        selectedPath: patch.selectedPath !== undefined ? patch.selectedPath : current[profileId]?.selectedPath ?? null,
        openPaths: patch.openPaths ?? current[profileId]?.openPaths ?? []
      }
    }))
  }, [])

  const loadProfiles = useCallback(async () => {
    const settings = await window.atlas.remoteServers.listProfiles()
    setProfiles(settings.profiles)
    setActiveProfileId((current) => {
      if (current && settings.profiles.some((profile) => profile.id === current)) return current
      return asString(component.state.activeProfileId) || (settings.profiles[0]?.id ?? null)
    })
    setError(null)
  }, [component.state.activeProfileId])

  const attachSession = useCallback(
    (profileId: string, sessionId: string) => {
      if (sessionDisposersRef.current.has(sessionId)) return

      const disposeData = window.atlas.remoteServers.onShellData(sessionId, (data) => {
        writeProfileTerminal(profileId, data)
      })
      const disposeExit = window.atlas.remoteServers.onShellExit(sessionId, () => {
        setConnections((current) => {
          const next = { ...current }
          delete next[profileId]
          return next
        })
        writeProfileTerminalLine(profileId, t('remoteServer.shellExited'))
      })

      sessionDisposersRef.current.set(sessionId, () => {
        disposeData()
        disposeExit()
      })
    },
    [t, writeProfileTerminal, writeProfileTerminalLine]
  )

  const refreshStatus = useCallback(async (profileId: string, sessionId: string) => {
    try {
      const snapshot = await window.atlas.remoteServers.status(sessionId)
      setStatuses((current) => ({ ...current, [profileId]: snapshot }))
    } catch (nextError) {
      setStatuses((current) => ({
        ...current,
        [profileId]: {
          profileId,
          sessionId,
          connection: 'connected',
          updatedAt: new Date().toISOString(),
          error: nextError instanceof Error ? nextError.message : String(nextError)
        }
      }))
    }
  }, [])

  const loadTree = useCallback(
    async (profileId: string, sessionId: string, rootPath: string, targetPath = rootPath) => {
      const entry = await window.atlas.remoteServers.listTree(sessionId, rootPath, targetPath, FILE_TREE_LOAD_DEPTH)
      setFilePanels((current) => {
        const panel = current[profileId]
        const tree = panel?.tree && entry.path !== rootPath ? replaceEntry(panel.tree, entry) : entry
        return {
          ...current,
          [profileId]: {
            rootPath,
            tree,
            selectedPath: panel?.selectedPath && findEntry(tree, panel.selectedPath) ? panel.selectedPath : entry.path,
            openPaths: Array.from(new Set([rootPath, ...(panel?.openPaths ?? [])]))
          }
        }
      })
      setError(null)
    },
    []
  )

  const connectProfile = useCallback(
    async (profileId: string, hostKey?: { acceptHostKey: boolean; expectedHostKeyFingerprint?: string }) => {
      const terminal = terminalRef.current
      setConnectingProfileId(profileId)
      setError(null)

      try {
        const result: RemoteServerConnectResult = await window.atlas.remoteServers.connect({
          componentId: component.id,
          canvasId,
          profileId,
          cols: terminal && terminalIsValidSize(terminal) ? terminal.cols : DEFAULT_TERMINAL_COLS,
          rows: terminal && terminalIsValidSize(terminal) ? terminal.rows : DEFAULT_TERMINAL_ROWS,
          acceptHostKey: hostKey?.acceptHostKey,
          expectedHostKeyFingerprint: hostKey?.expectedHostKeyFingerprint
        })

        if (result.status === 'host-key-untrusted') {
          setHostKeyDialog({ profileId, kind: 'untrusted', actual: result.hostKeyFingerprint })
          return
        }
        if (result.status === 'host-key-mismatch') {
          setHostKeyDialog({
            profileId,
            kind: 'mismatch',
            expected: result.expectedHostKeyFingerprint,
            actual: result.actualHostKeyFingerprint
          })
          return
        }

        setConnections((current) => ({
          ...current,
          [profileId]: {
            sessionId: result.sessionId,
            homePath: result.homePath,
            hostKeyFingerprint: result.hostKeyFingerprint
          }
        }))
        attachSession(profileId, result.sessionId)
        updateFilePanel(profileId, { rootPath: result.homePath, openPaths: [result.homePath], selectedPath: result.homePath })
        try {
          await Promise.all([
            loadTree(profileId, result.sessionId, result.homePath),
            refreshStatus(profileId, result.sessionId)
          ])
        } catch (panelError) {
          setError(panelError instanceof Error ? panelError.message : String(panelError))
        }
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : String(nextError)
        setError(message)
        writeProfileTerminalLine(profileId, t('remoteServer.connectFailed', { message }))
      } finally {
        setConnectingProfileId(null)
      }
    },
    [attachSession, canvasId, component.id, loadTree, refreshStatus, t, updateFilePanel, writeProfileTerminalLine]
  )

  const selectProfile = useCallback(
    (profileId: string) => {
      setActiveProfileId(profileId)
      updateState({ activeProfileId: profileId }, true)
      const connection = connectionsRef.current[profileId]
      terminalRef.current?.reset()
      const buffered = sessionBuffersRef.current.get(profileId)
      if (buffered) terminalRef.current?.write(buffered)
      if (!connection) void connectProfile(profileId)
    },
    [connectProfile, updateState]
  )

  useEffect(() => {
    void loadProfiles().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)))
  }, [loadProfiles])

  useEffect(() => {
    const container = terminalContainerRef.current
    if (!container) return undefined

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      convertEol: true,
      fontFamily: 'JetBrains Mono, Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      theme: {
        background: '#010102',
        foreground: '#f7f8f8',
        cursor: '#828fff',
        selectionBackground: '#5e6ad24d'
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const resize = (): void => {
      try {
        fitAddon.fit()
        const profileId = activeProfileIdRef.current
        const connection = profileId ? connectionsRef.current[profileId] : null
        if (connection && terminalIsValidSize(terminal)) {
          void window.atlas.remoteServers.resize(connection.sessionId, terminal.cols, terminal.rows)
        }
      } catch (resizeError) {
        console.warn('Failed to fit remote terminal', resizeError)
      }
    }
    const dataDisposable = terminal.onData((data) => {
      const profileId = activeProfileIdRef.current
      const connection = profileId ? connectionsRef.current[profileId] : null
      if (connection) void window.atlas.remoteServers.write(connection.sessionId, data)
    })
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    window.requestAnimationFrame(resize)

    return () => {
      observer.disconnect()
      dataDisposable.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      terminal.dispose()
    }
  }, [])

  useEffect(() => {
    if (!isNodeSelected) return
    terminalRef.current?.focus()
  }, [isNodeSelected, activeProfileId])

  useEffect(() => {
    if (!activeProfile || !activeConnection) return undefined

    const timer = window.setInterval(() => {
      void refreshStatus(activeProfile.id, activeConnection.sessionId)
    }, STATUS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [activeConnection, activeProfile, refreshStatus])

  const headerActions = useMemo<ReactNode>(
    () => (
      <button
        type="button"
        className="icon-button component-node__header-action-button"
        onClick={() => void loadProfiles()}
        title={t('common.reload')}
        aria-label={t('common.reload')}
      >
        <RefreshCw size={14} />
      </button>
    ),
    [loadProfiles, t]
  )

  useEffect(() => {
    if (!setHeaderActions) return undefined
    setHeaderActions(headerActions)
    return () => setHeaderActions(null)
  }, [headerActions, setHeaderActions])

  useEffect(() => {
    return () => {
      for (const dispose of sessionDisposersRef.current.values()) dispose()
      sessionDisposersRef.current.clear()
      void window.atlas.remoteServers.closeComponent(component.id)
    }
  }, [component.id])

  const saveProfile = useCallback(async () => {
    if (!profileDialog) return
    const settings = await window.atlas.remoteServers.saveProfile(profileDialog.draft)
    setProfiles(settings.profiles)
    const nextActiveId = profileDialog.draft.id ?? settings.profiles.at(-1)?.id ?? null
    if (nextActiveId) {
      setActiveProfileId(nextActiveId)
      updateState({ activeProfileId: nextActiveId }, true)
    }
    setProfileDialog(null)
    setError(null)
  }, [profileDialog, updateState])

  const confirmDeleteProfile = useCallback(async () => {
    if (!deleteProfile) return
    await window.atlas.remoteServers.deleteProfile(deleteProfile.id)
    setProfiles((current) => current.filter((profile) => profile.id !== deleteProfile.id))
    setConnections((current) => {
      const next = { ...current }
      delete next[deleteProfile.id]
      return next
    })
    clearProfileTerminal(deleteProfile.id)
    setDeleteProfile(null)
  }, [clearProfileTerminal, deleteProfile])

  const choosePrivateKey = useCallback(async () => {
    if (!profileDialog) return
    const chosen = await window.atlas.launcher.chooseFile({ kind: 'file' })
    if (!chosen) return
    setProfileDialog({ ...profileDialog, draft: { ...profileDialog.draft, privateKeyPath: chosen.path } })
  }, [profileDialog])

  const submitNameDialog = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!nameDialog || !activeProfile || !activeConnection || !activeFilePanel) return
      const value = nameDialog.value.trim()
      if (!value) return

      if (nameDialog.kind === 'file') {
        await window.atlas.remoteServers.createFile(activeConnection.sessionId, activeFilePanel.rootPath, containingDirectory(nameDialog.target), value)
      } else if (nameDialog.kind === 'folder') {
        await window.atlas.remoteServers.createFolder(activeConnection.sessionId, activeFilePanel.rootPath, containingDirectory(nameDialog.target), value)
      } else {
        await window.atlas.remoteServers.rename(activeConnection.sessionId, activeFilePanel.rootPath, nameDialog.target.path, value)
      }

      setNameDialog(null)
      await loadTree(activeProfile.id, activeConnection.sessionId, activeFilePanel.rootPath, containingDirectory(nameDialog.target))
    },
    [activeConnection, activeFilePanel, activeProfile, loadTree, nameDialog]
  )

  const confirmDeleteEntry = useCallback(async () => {
    if (!deleteTarget || !activeProfile || !activeConnection || !activeFilePanel) return
    const parentPath = parentDirectoryPath(deleteTarget.path)
    await window.atlas.remoteServers.deletePath(activeConnection.sessionId, activeFilePanel.rootPath, deleteTarget.path, true)
    setFilePanels((current) => {
      const panel = current[activeProfile.id]
      return panel?.tree
        ? {
            ...current,
            [activeProfile.id]: {
              ...panel,
              tree: removeEntry(panel.tree, deleteTarget.path),
              selectedPath: panel.selectedPath === deleteTarget.path ? parentPath : panel.selectedPath
            }
          }
        : current
    })
    setDeleteTarget(null)
  }, [activeConnection, activeFilePanel, activeProfile, deleteTarget])

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!activeProfile || !activeConnection || !activeFilePanel) return
      const targetDirectory = selectedEntry ? containingDirectory(selectedEntry) : activeFilePanel.rootPath
      for (const file of Array.from(files)) {
        const localPath = window.atlas.filesystem.getPathForFile(file)
        if (localPath) {
          await window.atlas.remoteServers.upload(activeConnection.sessionId, activeFilePanel.rootPath, targetDirectory, localPath, file.name)
        }
      }
      await loadTree(activeProfile.id, activeConnection.sessionId, activeFilePanel.rootPath, targetDirectory)
    },
    [activeConnection, activeFilePanel, activeProfile, loadTree, selectedEntry]
  )

  const downloadSelected = useCallback(async () => {
    if (!selectedEntry || selectedEntry.kind !== 'file' || !activeConnection || !activeFilePanel) return
    const directory = await window.atlas.filesystem.chooseDirectory(t('remoteServer.chooseDownloadFolder'))
    if (!directory) return
    await window.atlas.remoteServers.download(activeConnection.sessionId, activeFilePanel.rootPath, selectedEntry.path, directory)
  }, [activeConnection, activeFilePanel, selectedEntry, t])

  const openTextEntry = useCallback(async (entry: FileEntry) => {
    if (entry.kind !== 'file' || !activeConnection || !activeFilePanel) return
    const contents = await window.atlas.remoteServers.readFile(activeConnection.sessionId, activeFilePanel.rootPath, entry.path)
    setEditor({ entry, contents, draft: contents })
  }, [activeConnection, activeFilePanel])

  const openSelectedText = useCallback(async () => {
    if (!selectedEntry) return
    await openTextEntry(selectedEntry)
  }, [openTextEntry, selectedEntry])

  const saveEditor = useCallback(async () => {
    if (!editor || !activeConnection || !activeFilePanel) return
    await window.atlas.remoteServers.writeFile(activeConnection.sessionId, activeFilePanel.rootPath, editor.entry.path, editor.draft)
    setEditor(null)
  }, [activeConnection, activeFilePanel, editor])

  const toggleDirectory = useCallback(
    async (entry: FileEntry) => {
      if (!activeProfile || !activeConnection || !activeFilePanel || entry.kind !== 'directory') return
      const isOpen = activeFilePanel.openPaths.includes(entry.path)
      const openPaths = isOpen ? activeFilePanel.openPaths.filter((path) => path !== entry.path) : [...activeFilePanel.openPaths, entry.path]
      updateFilePanel(activeProfile.id, { openPaths, selectedPath: entry.path })
      if (!isOpen && !entry.childrenLoaded) {
        await loadTree(activeProfile.id, activeConnection.sessionId, activeFilePanel.rootPath, entry.path)
      }
    },
    [activeConnection, activeFilePanel, activeProfile, loadTree, updateFilePanel]
  )

  const chooseUploadFile = useCallback(async () => {
    if (!activeProfile || !activeConnection || !activeFilePanel) return
    const chosen = await window.atlas.launcher.chooseFile({ kind: 'file' })
    if (!chosen) return

    const targetDirectory = selectedEntry ? containingDirectory(selectedEntry) : activeFilePanel.rootPath
    await window.atlas.remoteServers.upload(activeConnection.sessionId, activeFilePanel.rootPath, targetDirectory, chosen.path)
    await loadTree(activeProfile.id, activeConnection.sessionId, activeFilePanel.rootPath, targetDirectory)
  }, [activeConnection, activeFilePanel, activeProfile, loadTree, selectedEntry])

  const renderFileEntry = (entry: FileEntry, depth = 0): ReactNode => {
    const isSelected = activeFilePanel?.selectedPath === entry.path
    const isOpen = activeFilePanel?.openPaths.includes(entry.path) ?? false
    const hasChildren = entry.kind === 'directory'

    return (
      <div key={entry.path}>
        <button
          type="button"
          className={cn('remote-file-row', isSelected && 'remote-file-row--selected')}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => activeProfile && updateFilePanel(activeProfile.id, { selectedPath: entry.path })}
          onDoubleClick={() => {
            if (entry.kind === 'directory') void toggleDirectory(entry)
            else void openTextEntry(entry)
          }}
        >
          <span className="remote-file-row__disclosure" onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (hasChildren) void toggleDirectory(entry)
          }}>
            {hasChildren ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
          </span>
          {entry.kind === 'directory' ? <Folder size={14} /> : <FileIcon size={14} />}
          <span>{entry.name}</span>
        </button>
        {entry.kind === 'directory' && isOpen ? entry.children?.map((child) => renderFileEntry(child, depth + 1)) : null}
      </div>
    )
  }

  return (
    <div className="remote-server-module">
      <aside className="remote-server-sidebar">
        <div className="remote-server-sidebar__header">
          <span>{t('remoteServer.servers')}</span>
          <button type="button" className="icon-button" title={t('remoteServer.addServer')} onClick={() => setProfileDialog({ mode: 'create', draft: emptyDraft() })}>
            <Server size={14} />
          </button>
        </div>
        <div className="remote-server-list">
          {profiles.length === 0 ? <div className="remote-server-empty">{t('remoteServer.noServers')}</div> : null}
          {profiles.map((profile) => {
            const selected = activeProfile?.id === profile.id
            const connected = Boolean(connections[profile.id])
            return (
              <button
                key={profile.id}
                type="button"
                className={cn('remote-server-list__item', selected && 'remote-server-list__item--selected')}
                onClick={() => selectProfile(profile.id)}
              >
                <span>
                  <strong>{profile.name}</strong>
                  <small>{profile.username}@{profile.host}:{profile.port}</small>
                </span>
                <i className={connected ? 'remote-server-status-dot remote-server-status-dot--online' : 'remote-server-status-dot'} />
              </button>
            )
          })}
        </div>
        {activeProfile ? (
          <div className="remote-server-sidebar__actions">
            <button type="button" className="tool-button" disabled={connectingProfileId === activeProfile.id} onClick={() => void connectProfile(activeProfile.id)}>
              <Plug size={14} />
              <span>{connections[activeProfile.id] ? t('remoteServer.reconnect') : t('remoteServer.connect')}</span>
            </button>
            <button type="button" className="tool-button" onClick={() => setProfileDialog({ mode: 'edit', profileId: activeProfile.id, draft: draftFromProfile(activeProfile) })}>
              <Pencil size={14} />
              <span>{t('remoteServer.editServer')}</span>
            </button>
            <button type="button" className="tool-button danger" onClick={() => setDeleteProfile(activeProfile)}>
              <Trash2 size={14} />
              <span>{t('common.delete')}</span>
            </button>
          </div>
        ) : null}
      </aside>

      <section className="remote-server-terminal">
        <div className="remote-server-terminal__toolbar">
          <span>{activeProfile ? activeProfile.name : t('remoteServer.noActiveServer')}</span>
          {error ? <small>{error}</small> : null}
        </div>
        <div ref={terminalContainerRef} className="remote-server-terminal__screen" />
      </section>

      <aside className="remote-server-detail">
        <section className="remote-server-status">
          <div className="remote-server-section-header">
            <strong>{t('remoteServer.status')}</strong>
            <button
              type="button"
              className="icon-button"
              disabled={!activeProfile || !activeConnection}
              onClick={() => activeProfile && activeConnection && void refreshStatus(activeProfile.id, activeConnection.sessionId)}
              title={t('common.reload')}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <StatusGrid status={activeProfile ? statuses[activeProfile.id] : undefined} />
        </section>

        <section
          className="remote-server-files"
          onDragOver={(event: DragEvent) => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(event: DragEvent) => {
            const files = event.dataTransfer.files
            if (files.length === 0) return
            event.preventDefault()
            void uploadFiles(files)
          }}
        >
          <div className="remote-server-section-header">
            <strong>{t('remoteServer.files')}</strong>
            <button
              type="button"
              className="icon-button"
              disabled={!activeProfile || !activeConnection || !activeFilePanel}
              onClick={() => activeProfile && activeConnection && activeFilePanel && void loadTree(activeProfile.id, activeConnection.sessionId, activeFilePanel.rootPath)}
              title={t('common.reload')}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="remote-server-file-actions">
            <button type="button" className="icon-button" disabled={!selectedEntry} title={t('remoteServer.newFile')} onClick={() => selectedEntry && setNameDialog({ kind: 'file', target: selectedEntry, value: '' })}>
              <FilePlus size={14} />
            </button>
            <button type="button" className="icon-button" disabled={!selectedEntry} title={t('remoteServer.newFolder')} onClick={() => selectedEntry && setNameDialog({ kind: 'folder', target: selectedEntry, value: '' })}>
              <FolderPlus size={14} />
            </button>
            <button type="button" className="icon-button" disabled={!selectedEntry} title={t('common.rename')} onClick={() => selectedEntry && setNameDialog({ kind: 'rename', target: selectedEntry, value: selectedEntry.name })}>
              <Pencil size={14} />
            </button>
            <button type="button" className="icon-button" disabled={!selectedEntry} title={t('common.delete')} onClick={() => selectedEntry && setDeleteTarget(selectedEntry)}>
              <Trash2 size={14} />
            </button>
            <button type="button" className="icon-button" disabled={!activeConnection} title={t('remoteServer.upload')} onClick={() => void chooseUploadFile()}>
              <Upload size={14} />
            </button>
            <button type="button" className="icon-button" disabled={!selectedEntry || selectedEntry.kind !== 'file'} title={t('remoteServer.download')} onClick={() => void downloadSelected()}>
              <Download size={14} />
            </button>
            <button type="button" className="icon-button" disabled={!selectedEntry || selectedEntry.kind !== 'file'} title={t('remoteServer.editText')} onClick={() => void openSelectedText()}>
              <Save size={14} />
            </button>
          </div>
          <div className="remote-server-file-tree">
            {activeFilePanel?.tree ? renderFileEntry(activeFilePanel.tree) : <div className="remote-server-empty">{t('remoteServer.connectToBrowse')}</div>}
          </div>
          {selectedEntry ? (
            <button type="button" className="remote-server-path" onClick={() => void writeClipboardText(selectedEntry.path)}>
              {selectedEntry.path}
            </button>
          ) : null}
        </section>
      </aside>

      <ProfileDialog
        state={profileDialog}
        onChange={setProfileDialog}
        onChoosePrivateKey={choosePrivateKey}
        onTest={(profile) => window.atlas.remoteServers.testConnection(profile)}
        onSave={() => void saveProfile()}
      />
      <NameDialog state={nameDialog} onChange={setNameDialog} onSubmit={submitNameDialog} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('remoteServer.deleteRemoteTitle')}
        description={deleteTarget ? t('remoteServer.deleteRemoteDescription', { name: deleteTarget.name }) : ''}
        confirmLabel={t('common.delete')}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => void confirmDeleteEntry()}
      />
      <ConfirmDialog
        open={Boolean(deleteProfile)}
        title={t('remoteServer.deleteServerTitle')}
        description={deleteProfile ? t('remoteServer.deleteServerDescription', { name: deleteProfile.name }) : ''}
        confirmLabel={t('common.delete')}
        onOpenChange={(open) => !open && setDeleteProfile(null)}
        onConfirm={() => void confirmDeleteProfile()}
      />
      <HostKeyDialog
        state={hostKeyDialog}
        onOpenChange={(open) => !open && setHostKeyDialog(null)}
        onConfirm={() => {
          if (!hostKeyDialog) return
          if (hostKeyDialog.kind !== 'untrusted') {
            setHostKeyDialog(null)
            return
          }
          const fingerprint = hostKeyDialog.actual
          setHostKeyDialog(null)
          void connectProfile(hostKeyDialog.profileId, { acceptHostKey: true, expectedHostKeyFingerprint: fingerprint })
        }}
      />
      <EditorDialog state={editor} onChange={setEditor} onSave={() => void saveEditor()} />
    </div>
  )
}

function StatusGrid({ status }: { status?: RemoteServerStatusSnapshot }): JSX.Element {
  const { t } = useI18n()
  const memory = status?.memory
  const disk = status?.disk

  return (
    <div className="remote-server-status-grid">
      <StatusItem label={t('remoteServer.connection')} value={status?.connection ?? t('remoteServer.disconnected')} />
      <StatusItem label={t('remoteServer.host')} value={status?.hostname} />
      <StatusItem label={t('remoteServer.user')} value={status?.username} />
      <StatusItem label={t('remoteServer.os')} value={status?.os} />
      <StatusItem label={t('remoteServer.kernel')} value={status?.kernel} />
      <StatusItem label={t('remoteServer.uptime')} value={status?.uptime} />
      <StatusItem label={t('remoteServer.load')} value={status?.loadAverage} />
      <StatusItem label={t('remoteServer.cpu')} value={status?.cpuUsagePercent === undefined ? undefined : `${Math.round(status.cpuUsagePercent)}%`} />
      <StatusItem label={t('remoteServer.memory')} value={memory ? `${humanBytes(memory.used)} / ${humanBytes(memory.total)}` : undefined} />
      <StatusItem label={t('remoteServer.disk')} value={disk ? `${humanBytes(disk.used)} / ${humanBytes(disk.total)}` : undefined} />
      {status?.error ? <div className="remote-server-status-error">{status.error}</div> : null}
    </div>
  )
}

function StatusItem({ label, value }: { label: string; value?: string }): JSX.Element {
  return (
    <div className="remote-server-status-item">
      <span>{label}</span>
      <strong>{value || '-'}</strong>
    </div>
  )
}

function ProfileDialog({
  state,
  onChange,
  onChoosePrivateKey,
  onTest,
  onSave
}: {
  state: ProfileDialogState | null
  onChange: (state: ProfileDialogState | null) => void
  onChoosePrivateKey: () => void
  onTest: (profile: RemoteServerProfileDraft) => Promise<unknown>
  onSave: () => void
}): JSX.Element {
  const { t } = useI18n()
  const authTypeLabelId = useId()
  const [testState, setTestState] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const draft = state?.draft
  const authTypeOptions = useMemo(
    () => [
      { value: 'password' as const, label: t('remoteServer.password') },
      { value: 'private-key' as const, label: t('remoteServer.privateKey') }
    ],
    [t]
  )
  const updateDraft = (patch: Partial<RemoteServerProfileDraft>): void => {
    if (!state) return
    onChange({ ...state, draft: { ...state.draft, ...patch } })
    setTestState(null)
  }
  const canSubmit = Boolean(draft?.name && draft.host && draft.username)

  const testConnection = async (): Promise<void> => {
    if (!draft || !canSubmit) return
    setTesting(true)
    setTestState(null)

    try {
      const result = await onTest(draft)
      if (typeof result === 'object' && result && 'status' in result && result.status !== 'ok') {
        setTestState({ kind: 'error', message: t('remoteServer.testNeedsHostKey') })
      } else {
        setTestState({ kind: 'success', message: t('remoteServer.testSucceeded') })
      }
    } catch (error) {
      setTestState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog.Root open={Boolean(state)} onOpenChange={(open) => !open && onChange(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content remote-server-dialog" aria-describedby={undefined}>
          <Dialog.Title className="dialog-title">{state?.mode === 'edit' ? t('remoteServer.editServer') : t('remoteServer.addServer')}</Dialog.Title>
          {draft ? (
            <div className="remote-server-form">
              <label className="field-row">
                <span>{t('common.name')}</span>
                <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} autoFocus />
              </label>
              <label className="field-row">
                <span>{t('remoteServer.host')}</span>
                <input value={draft.host} onChange={(event) => updateDraft({ host: event.target.value })} />
              </label>
              <label className="field-row">
                <span>{t('remoteServer.port')}</span>
                <input type="number" min={1} max={65535} value={draft.port} onChange={(event) => updateDraft({ port: Number(event.target.value) || 22 })} />
              </label>
              <label className="field-row">
                <span>{t('remoteServer.username')}</span>
                <input value={draft.username} onChange={(event) => updateDraft({ username: event.target.value })} />
              </label>
              <div className="field-row">
                <span id={authTypeLabelId}>{t('remoteServer.authType')}</span>
                <DropdownSelect ariaLabelledBy={authTypeLabelId} value={draft.authType} options={authTypeOptions} onChange={(authType) => updateDraft({ authType })} />
              </div>
              {draft.authType === 'password' ? (
                <label className="field-row">
                  <span>{t('remoteServer.password')}</span>
                  <input type="password" value={draft.password ?? ''} onChange={(event) => updateDraft({ password: event.target.value })} />
                </label>
              ) : (
                <>
                  <label className="field-row">
                    <span>{t('remoteServer.privateKeyPath')}</span>
                    <input value={draft.privateKeyPath ?? ''} onChange={(event) => updateDraft({ privateKeyPath: event.target.value })} />
                  </label>
                  <button type="button" className="tool-button" onClick={onChoosePrivateKey}>
                    <KeyRound size={14} />
                    <span>{t('remoteServer.choosePrivateKey')}</span>
                  </button>
                  <label className="field-row">
                    <span>{t('remoteServer.passphrase')}</span>
                    <input type="password" value={draft.passphrase ?? ''} onChange={(event) => updateDraft({ passphrase: event.target.value })} />
                  </label>
                </>
              )}
              {testState ? (
                <div className={cn('remote-server-test-result', testState.kind === 'error' && 'remote-server-test-result--error')}>
                  {testState.message}
                </div>
              ) : null}
              <div className="dialog-actions">
                <button type="button" className="tool-button" disabled={!canSubmit || testing} onClick={() => void testConnection()}>
                  <Plug size={14} />
                  <span>{testing ? t('remoteServer.testing') : t('remoteServer.testConnection')}</span>
                </button>
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    <X size={14} />
                    <span>{t('common.cancel')}</span>
                  </button>
                </Dialog.Close>
                <button type="button" className="tool-button primary" disabled={!canSubmit} onClick={onSave}>
                  <Save size={14} />
                  <span>{t('common.save')}</span>
                </button>
              </div>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function NameDialog({
  state,
  onChange,
  onSubmit
}: {
  state: NameDialogState | null
  onChange: (state: NameDialogState | null) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <Dialog.Root open={Boolean(state)} onOpenChange={(open) => !open && onChange(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-describedby={undefined}>
          <Dialog.Title className="dialog-title">{state?.kind === 'rename' ? t('common.rename') : state?.kind === 'folder' ? t('remoteServer.newFolder') : t('remoteServer.newFile')}</Dialog.Title>
          <form onSubmit={onSubmit}>
            <label className="field-row">
              <span>{t('common.name')}</span>
              <input value={state?.value ?? ''} autoFocus onChange={(event) => state && onChange({ ...state, value: event.target.value })} />
            </label>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="tool-button">{t('common.cancel')}</button>
              </Dialog.Close>
              <button type="submit" className="tool-button primary" disabled={!state?.value.trim()}>{state?.kind === 'rename' ? t('common.rename') : t('common.create')}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title className="dialog-title">{title}</Dialog.Title>
          <Dialog.Description className="dialog-description">{description}</Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="tool-button">{t('common.cancel')}</button>
            </Dialog.Close>
            <button type="button" className="tool-button danger" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function HostKeyDialog({
  state,
  onOpenChange,
  onConfirm
}: {
  state: HostKeyDialogState | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <Dialog.Root open={Boolean(state)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title className="dialog-title">{state?.kind === 'mismatch' ? t('remoteServer.hostKeyChanged') : t('remoteServer.hostKeyUnknown')}</Dialog.Title>
          <Dialog.Description className="dialog-description">
            {state?.kind === 'mismatch' ? t('remoteServer.hostKeyChangedDescription') : t('remoteServer.hostKeyUnknownDescription')}
          </Dialog.Description>
          {state?.expected ? <code className="remote-server-fingerprint">{state.expected}</code> : null}
          {state ? <code className="remote-server-fingerprint">{state.actual}</code> : null}
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="tool-button">{t('common.cancel')}</button>
            </Dialog.Close>
            {state?.kind === 'untrusted' ? (
              <button type="button" className="tool-button primary" onClick={onConfirm}>{t('remoteServer.trustHostKey')}</button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function EditorDialog({
  state,
  onChange,
  onSave
}: {
  state: EditorState | null
  onChange: (state: EditorState | null) => void
  onSave: () => void
}): JSX.Element {
  const { t } = useI18n()
  const editorPath = state?.entry.path ?? ''
  const loadedTextLength = state?.contents.length ?? 0
  const editorTextLength = state?.draft.length ?? 0
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(null)
  const languageDescription = useMemo(() => (editorPath ? codeLanguageDescriptionForFile(editorPath) : null), [editorPath])
  const editorExtensions = useMemo(() => (languageExtension ? [languageExtension] : []), [languageExtension])

  useEffect(() => {
    let cancelled = false

    setLanguageExtension(null)

    if (!editorPath || loadedTextLength > REMOTE_SERVER_TEXT_FILE_MAX_BYTES) return undefined

    void loadCodeLanguageForFile(editorPath)
      .then((language) => {
        if (!cancelled) setLanguageExtension(language?.extension ?? null)
      })
      .catch(() => {
        if (!cancelled) setLanguageExtension(null)
      })

    return () => {
      cancelled = true
    }
  }, [editorPath, loadedTextLength])

  return (
    <Dialog.Root open={Boolean(state)} onOpenChange={(open) => !open && onChange(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content remote-server-editor-dialog" aria-describedby={undefined}>
          <Dialog.Title className="dialog-title remote-server-editor-title">
            <span>{state?.entry.name ?? t('remoteServer.editText')}</span>
            {languageDescription && editorTextLength <= REMOTE_SERVER_TEXT_FILE_MAX_BYTES ? <strong>{languageDescription.name}</strong> : null}
          </Dialog.Title>
          <CodeMirror
            aria-label={state?.entry.name ?? t('remoteServer.editText')}
            className="remote-server-editor"
            value={state?.draft ?? ''}
            height="100%"
            theme={oneDark}
            extensions={editorExtensions}
            basicSetup={REMOTE_SERVER_EDITOR_BASIC_SETUP}
            onChange={(value) => state && onChange({ ...state, draft: value })}
          />
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="tool-button">{t('common.cancel')}</button>
            </Dialog.Close>
            <button type="button" className="tool-button primary" disabled={!state || state.draft === state.contents} onClick={onSave}>
              <Save size={14} />
              <span>{t('common.save')}</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
