import { Tree, type NodeRendererProps } from 'react-arborist'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, ChevronRight, Copy, ExternalLink, File, FilePlus, Folder, FolderOpen, FolderPlus, Pencil, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { FileEntry } from '@shared/schema'
import { useElementSize } from '../../hooks/use-element-size'
import { useI18n, type TFunction } from '../../i18n'
import { writeClipboardText } from '../../lib/clipboard'
import { componentTypeForFileSource, createFileComponentPatch } from '../../lib/file-component-factory'
import { asString, cn } from '../../lib/utils'
import { useCanvasStore } from '../../store/canvas-store'
import type { AtlasComponentRendererProps } from '../registry'

type FileNodeData = FileEntry
const FILE_TREE_LOAD_DEPTH = 1
const FILE_TREE_DESKTOP_OFFSET = 24
const FILE_TREE_WATCH_REFRESH_DELAY_MS = 80

type FileTreeRowActions = {
  onContextTarget: (entry: FileEntry) => void
  onCreateEntry: (kind: CreateEntryKind, target: FileEntry) => void
  onRenameEntry: (target: FileEntry) => void
  onTrashEntry: (target: FileEntry) => void
  onRevealInFolder: (entry: FileEntry) => Promise<void> | void
  onOpenCommandLine: (entry: FileEntry) => Promise<void> | void
  onOpenOnDesktop: (entry: FileEntry) => Promise<void> | void
  onCopyPath: (entry: FileEntry) => Promise<void> | void
}

type CreateEntryKind = 'file' | 'folder'

type PendingCreateEntry = {
  kind: CreateEntryKind
  target: FileEntry
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function parentDirectoryPath(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, '')
}

function containingDirectory(entry: FileEntry): string {
  if (entry.kind === 'directory') return entry.path
  return parentDirectoryPath(entry.path)
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

function createLocationName(entry: FileEntry): string {
  if (entry.kind === 'directory') return entry.name
  return fileNameFromPath(containingDirectory(entry))
}

function canExpandDirectory(entry: FileEntry): boolean {
  if (entry.kind !== 'directory') return false
  return entry.childrenLoaded !== true || Boolean(entry.children?.length)
}

function findEntry(entry: FileEntry, path: string): FileEntry | null {
  if (entry.path === path) return entry

  for (const child of entry.children ?? []) {
    const result = findEntry(child, path)
    if (result) return result
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

function collectLoadedDirectoryPaths(entry: FileEntry): string[] {
  if (entry.kind !== 'directory' || entry.childrenLoaded !== true) return []

  return [entry.path, ...(entry.children ?? []).flatMap(collectLoadedDirectoryPaths)]
}

function descendantDirectoryPaths(rootPath: string, targetPath: string, paths: Iterable<string>): string[] {
  return uniqueSortedPaths(
    [...paths].filter((path) => path !== targetPath && isPathInRoot(rootPath, path) && isPathInRoot(targetPath, path))
  )
}

function pathDepth(path: string): number {
  return path.split(/[\\/]/).length
}

function sortByPathDepth(paths: string[]): string[] {
  return [...paths].sort((first, second) => pathDepth(first) - pathDepth(second))
}

function normalizeTreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function comparableTreePath(path: string): string {
  const normalizedPath = normalizeTreePath(path)
  return /^[A-Za-z]:($|\/)/.test(normalizedPath) ? normalizedPath.toLowerCase() : normalizedPath
}

function isPathInRoot(rootPath: string, path: string): boolean {
  const normalizedRoot = comparableTreePath(rootPath)
  const normalizedPath = comparableTreePath(path)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function trimTrailingTreeSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '') || path
}

function treePathSeparator(rootPath: string, path: string): '\\' | '/' {
  return rootPath.includes('\\') || path.includes('\\') ? '\\' : '/'
}

function appendTreePathSegment(basePath: string, separator: '\\' | '/', segment: string): string {
  if (basePath === separator) return `${separator}${segment}`
  return `${basePath}${separator}${segment}`
}

function openPathAncestors(rootPath: string, path: string): string[] {
  if (!isPathInRoot(rootPath, path)) return []

  const normalizedRoot = normalizeTreePath(rootPath)
  const normalizedPath = normalizeTreePath(path)
  const relativePath = normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, '')
  if (!relativePath) return [rootPath]

  const separator = treePathSeparator(rootPath, path)
  const ancestors = [rootPath]
  let currentPath = trimTrailingTreeSeparators(rootPath)

  for (const segment of relativePath.split('/').filter(Boolean)) {
    currentPath = appendTreePathSegment(currentPath, separator, segment)
    ancestors.push(currentPath)
  }

  return ancestors
}

function rebaseTreePath(oldPath: string, newPath: string, path: string): string {
  if (!isPathInRoot(oldPath, path)) return path

  const normalizedOldPath = normalizeTreePath(oldPath)
  const normalizedPath = normalizeTreePath(path)
  const relativePath = normalizedPath.slice(normalizedOldPath.length).replace(/^\/+/, '')
  if (!relativePath) return newPath

  const separator = treePathSeparator(newPath, path)
  return relativePath
    .split('/')
    .filter(Boolean)
    .reduce((currentPath, segment) => appendTreePathSegment(currentPath, separator, segment), trimTrailingTreeSeparators(newPath))
}

function rebaseOpenPaths(rootPath: string, paths: Iterable<string>, oldPath: string, newPath: string): string[] {
  return uniqueSortedPaths([...paths].flatMap((path) => openPathAncestors(rootPath, rebaseTreePath(oldPath, newPath, path))))
}

function uniqueSortedPaths(paths: string[]): string[] {
  return sortByPathDepth([...new Set(paths)])
}

function clearRefreshTimers(timers: Map<string, number>): void {
  for (const timer of timers.values()) {
    window.clearTimeout(timer)
  }
  timers.clear()
}

function readOpenPaths(rootPath: string, value: unknown): string[] {
  if (!rootPath) return []
  if (!Array.isArray(value)) return [rootPath]

  const openPaths = value.flatMap((item) => (typeof item === 'string' ? openPathAncestors(rootPath, item) : []))
  if (openPaths.length === 0 && value.length > 0) return [rootPath]

  return uniqueSortedPaths(openPaths)
}

function treeChildren(entry: FileEntry): readonly FileEntry[] | null {
  return canExpandDirectory(entry) ? (entry.children ?? []) : null
}

function syncSelectedEntry(tree: FileEntry, selected: FileEntry | null): FileEntry | null {
  if (!selected) return null

  return findEntry(tree, selected.path)
}

function isCopyPathShortcut(event: Pick<KeyboardEvent<HTMLElement>, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c'
}

function createRow(rootPath: string, actions: FileTreeRowActions, t: TFunction) {
  return function Row({ node, style }: NodeRendererProps<FileNodeData>) {
    const entry = node.data
    const Icon = entry.kind === 'directory' ? (node.isOpen ? FolderOpen : Folder) : File
    const isExpandable = canExpandDirectory(entry)
    const DisclosureIcon = node.isOpen ? ChevronDown : ChevronRight

    return (
      <ContextMenu.Root modal={false}>
        <ContextMenu.Trigger
          asChild
          onContextMenu={(event) => {
            event.stopPropagation()
            node.select()
            actions.onContextTarget(entry)
          }}
        >
          <div
            className={cn('file-tree-row', node.isSelected && 'file-tree-row--selected')}
            style={style}
            data-component-context-menu-trigger=""
            onDoubleClick={() => {
              if (isExpandable) node.toggle()
              else if (entry.kind === 'file') void actions.onOpenOnDesktop(entry)
            }}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(
                'application/atlas-file',
                JSON.stringify({
                  path: entry.path,
                  name: entry.name,
                  kind: entry.kind,
                  rootPath
                })
              )
            }}
          >
            {isExpandable ? (
              <button
                type="button"
                className="file-tree-disclosure"
                aria-label={node.isOpen ? t('fileTree.collapseFolder') : t('fileTree.expandFolder')}
                title={node.isOpen ? t('fileTree.collapseFolder') : t('fileTree.expandFolder')}
                onClick={(event) => {
                  event.stopPropagation()
                  node.toggle()
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <DisclosureIcon size={13} />
              </button>
            ) : (
              <span className="file-tree-disclosure file-tree-disclosure--placeholder" aria-hidden="true" />
            )}
            <Icon size={15} />
            <span>{entry.name}</span>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="menu-content file-tree-context-menu"
            collisionPadding={12}
            onCloseAutoFocus={(event) => event.preventDefault()}
            aria-label={t('fileTree.entryActions', { name: entry.name })}
          >
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => actions.onCreateEntry('file', entry)}>
              <FilePlus size={14} />
              <span>{t('fileTree.newFile')}</span>
            </ContextMenu.Item>
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => actions.onCreateEntry('folder', entry)}>
              <FolderPlus size={14} />
              <span>{t('fileTree.newFolder')}</span>
            </ContextMenu.Item>
            {entry.path !== rootPath ? (
              <>
                <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => actions.onRenameEntry(entry)}>
                  <Pencil size={14} />
                  <span>{t('common.rename')}</span>
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="menu-item menu-item--danger file-tree-context-menu__item"
                  onSelect={() => actions.onTrashEntry(entry)}
                >
                  <Trash2 size={14} />
                  <span>{entry.kind === 'directory' ? t('fileTree.deleteFolder') : t('fileTree.deleteFile')}</span>
                </ContextMenu.Item>
              </>
            ) : null}
            <ContextMenu.Separator className="menu-separator" />
            {entry.kind === 'file' ? (
              <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => void actions.onOpenOnDesktop(entry)}>
                <ExternalLink size={14} />
                <span>{t('fileTree.openDesktop')}</span>
              </ContextMenu.Item>
            ) : null}
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => void actions.onRevealInFolder(entry)}>
              <FolderOpen size={14} />
              <span>{t('fileTree.revealLocation')}</span>
            </ContextMenu.Item>
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => void actions.onOpenCommandLine(entry)}>
              <TerminalSquare size={14} />
              <span>{t('fileTree.openCommandLine')}</span>
            </ContextMenu.Item>
            <ContextMenu.Separator className="menu-separator" />
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => void actions.onCopyPath(entry)}>
              <Copy size={14} />
              <span>{t('fileTree.copyFilePath')}</span>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    )
  }
}

export function FileTreeComponent({ component, updateConfig, updateState, setHeaderActions }: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const rootPath = asString(component.config.rootPath)
  const persistedOpenPaths = useMemo(() => readOpenPaths(rootPath, component.state.openPaths), [component.state.openPaths, rootPath])
  const treeViewportRef = useRef<HTMLDivElement | null>(null)
  const treeViewportSize = useElementSize(treeViewportRef)
  const addComponent = useCanvasStore((state) => state.addComponent)
  const [tree, setTree] = useState<FileEntry | null>(null)
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [pendingCreate, setPendingCreate] = useState<PendingCreateEntry | null>(null)
  const [newEntryName, setNewEntryName] = useState('')
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null)
  const [renameEntryName, setRenameEntryName] = useState('')
  const [trashTarget, setTrashTarget] = useState<FileEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const treeRef = useRef<FileEntry | null>(null)
  const loadingPathsRef = useRef(new Set<string>())
  const openPathsRef = useRef(new Set<string>())
  const refreshTimersRef = useRef(new Map<string, number>())

  useEffect(() => {
    treeRef.current = tree
  }, [tree])

  useEffect(() => {
    openPathsRef.current = new Set(persistedOpenPaths)
  }, [persistedOpenPaths])

  const loadTree = useCallback(async () => {
    if (!rootPath) return
    try {
      const previousTree = treeRef.current?.path === rootPath ? treeRef.current : null
      const root = (await window.atlas.filesystem.listTree(rootPath, rootPath, FILE_TREE_LOAD_DEPTH)) as FileEntry
      let nextTree = root
      const loadedPaths = uniqueSortedPaths([
        ...(previousTree ? collectLoadedDirectoryPaths(previousTree) : []),
        ...openPathsRef.current
      ]).filter((path) => path !== rootPath && isPathInRoot(rootPath, path))
      const loadedEntries = await Promise.allSettled(
        loadedPaths.map((targetPath) => window.atlas.filesystem.listTree(rootPath, targetPath, FILE_TREE_LOAD_DEPTH) as Promise<FileEntry>)
      )

      for (const loadedEntry of loadedEntries) {
        if (loadedEntry.status === 'fulfilled') {
          nextTree = replaceEntry(nextTree, loadedEntry.value)
        }
      }

      setTree(nextTree)
      treeRef.current = nextTree
      setSelected((current) => syncSelectedEntry(nextTree, current))
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('fileTree.failedLoadFolder'))
    }
  }, [rootPath, t])

  const loadDirectory = useCallback(
    async (targetPath: string, force = false) => {
      if (!rootPath || loadingPathsRef.current.has(targetPath)) return

      const currentTree = treeRef.current
      const currentEntry = currentTree ? findEntry(currentTree, targetPath) : null
      if (!currentEntry || currentEntry.kind !== 'directory') return
      if (!force && currentEntry.childrenLoaded) return
      const descendantPaths = force
        ? descendantDirectoryPaths(rootPath, targetPath, [
            ...collectLoadedDirectoryPaths(currentEntry),
            ...openPathsRef.current
          ])
        : []

      loadingPathsRef.current.add(targetPath)
      try {
        const loadedEntry = (await window.atlas.filesystem.listTree(rootPath, targetPath, FILE_TREE_LOAD_DEPTH)) as FileEntry
        let nextLoadedEntry = loadedEntry
        const loadedDescendants = await Promise.allSettled(
          descendantPaths.map((path) => window.atlas.filesystem.listTree(rootPath, path, FILE_TREE_LOAD_DEPTH) as Promise<FileEntry>)
        )

        for (const loadedDescendant of loadedDescendants) {
          if (loadedDescendant.status === 'fulfilled') {
            nextLoadedEntry = replaceEntry(nextLoadedEntry, loadedDescendant.value)
          }
        }

        setTree((current) => {
          if (!current) return current

          const nextTree = replaceEntry(current, nextLoadedEntry)
          treeRef.current = nextTree
          return nextTree
        })
        setSelected((current) => (current?.path === nextLoadedEntry.path ? nextLoadedEntry : current))
        setError(null)
      } catch (loadError) {
        setError(errorMessage(loadError, t('fileTree.failedLoadFolder')))
      } finally {
        loadingPathsRef.current.delete(targetPath)
      }
    },
    [rootPath, t]
  )

  const persistOpenPaths = useCallback(
    (targetPath: string): boolean => {
      if (!rootPath || !isPathInRoot(rootPath, targetPath)) return false

      const nextOpenPaths = new Set(openPathsRef.current)
      const didOpen = !nextOpenPaths.has(targetPath)
      if (!didOpen) {
        for (const openPath of nextOpenPaths) {
          if (isPathInRoot(targetPath, openPath)) nextOpenPaths.delete(openPath)
        }
      } else {
        for (const ancestorPath of openPathAncestors(rootPath, targetPath)) {
          nextOpenPaths.add(ancestorPath)
        }
      }

      const openPaths = uniqueSortedPaths([...nextOpenPaths].flatMap((path) => openPathAncestors(rootPath, path)))
      openPathsRef.current = new Set(openPaths)
      updateState({ openPaths }, true)
      return didOpen
    },
    [rootPath, updateState]
  )

  const toggleDirectory = useCallback(
    (targetPath: string) => {
      if (persistOpenPaths(targetPath)) void loadDirectory(targetPath)
    },
    [loadDirectory, persistOpenPaths]
  )

  const scheduleWatchedDirectoryRefresh = useCallback(
    (targetPath: string) => {
      if (!rootPath || !isPathInRoot(rootPath, targetPath)) return

      const currentTree = treeRef.current
      const currentEntry = currentTree ? findEntry(currentTree, targetPath) : null
      if (currentTree && targetPath !== rootPath && (currentEntry?.kind !== 'directory' || !currentEntry.childrenLoaded)) return

      const currentTimer = refreshTimersRef.current.get(targetPath)
      if (currentTimer !== undefined) window.clearTimeout(currentTimer)

      const timer = window.setTimeout(() => {
        refreshTimersRef.current.delete(targetPath)

        const latestTree = treeRef.current
        const latestEntry = latestTree ? findEntry(latestTree, targetPath) : null
        if (latestEntry?.kind === 'directory' && latestEntry.childrenLoaded) {
          void loadDirectory(targetPath, true)
          return
        }

        if (!latestTree || targetPath === rootPath) void loadTree()
      }, FILE_TREE_WATCH_REFRESH_DELAY_MS)

      refreshTimersRef.current.set(targetPath, timer)
    },
    [loadDirectory, loadTree, rootPath]
  )

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    if (!rootPath || persistedOpenPaths.length === 0) return

    let disposed = false
    const watchIds = new Set<string>()
    const disposeWatchEvents = window.atlas.filesystem.onWatchEvent((event) => {
      if (!watchIds.has(event.watchId)) return

      scheduleWatchedDirectoryRefresh(parentDirectoryPath(event.path))
    })

    for (const targetPath of persistedOpenPaths) {
      void window.atlas.filesystem
        .watch(rootPath, targetPath)
        .then((watch) => {
          if (disposed) {
            void window.atlas.filesystem.unwatch(watch.watchId)
            return
          }

          watchIds.add(watch.watchId)
        })
        .catch(() => undefined)
    }

    return () => {
      disposed = true
      disposeWatchEvents()
      clearRefreshTimers(refreshTimersRef.current)
      for (const watchId of watchIds) {
        void window.atlas.filesystem.unwatch(watchId)
      }
    }
  }, [persistedOpenPaths, rootPath, scheduleWatchedDirectoryRefresh])

  const treeData = useMemo(() => (tree ? [tree] : []), [tree])
  const initialOpenState = useMemo(
    () => Object.fromEntries(persistedOpenPaths.map((path) => [path, true])),
    [persistedOpenPaths]
  )

  const revealInFolder = useCallback(
    async (entry: FileEntry) => {
      if (!rootPath) return
      try {
        await window.atlas.filesystem.revealInFolder(rootPath, entry.path)
        setError(null)
      } catch (actionError) {
        setError(errorMessage(actionError, t('fileTree.failedOpenLocation')))
      }
    },
    [rootPath, t]
  )

  const openCommandLine = useCallback((entry: FileEntry) => {
    const cwd = containingDirectory(entry)
    if (!cwd) return

    addComponent(
      'terminal',
      {
        x: component.frame.x + component.frame.width + 24,
        y: component.frame.y
      },
      {
        config: { cwd },
        state: { cwd }
      }
    )
    setError(null)
  }, [addComponent, component.frame.width, component.frame.x, component.frame.y])

  const openOnDesktop = useCallback(
    async (entry: FileEntry) => {
      if (!rootPath || entry.kind !== 'file') return

      try {
        const type = componentTypeForFileSource({ ...entry, rootPath })
        const patch = await createFileComponentPatch({ ...entry, rootPath }, type)
        addComponent(
          type,
          {
            x: component.frame.x + component.frame.width + FILE_TREE_DESKTOP_OFFSET,
            y: component.frame.y
          },
          patch
        )
        setError(null)
      } catch (actionError) {
        setError(errorMessage(actionError, t('fileTree.failedOpenDesktop')))
      }
    },
    [addComponent, component.frame.width, component.frame.x, component.frame.y, rootPath, t]
  )

  const copyPath = useCallback(async (entry: FileEntry) => {
    try {
      const didCopy = await writeClipboardText(entry.path)
      if (!didCopy) {
        setError(t('fileTree.failedCopyPath'))
        return
      }
      setError(null)
    } catch (actionError) {
      setError(errorMessage(actionError, t('fileTree.failedCopyPath')))
    }
  }, [t])

  const handleTreeKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || !selected || !isCopyPathShortcut(event)) return

      event.preventDefault()
      event.stopPropagation()
      void copyPath(selected)
    },
    [copyPath, selected]
  )

  const requestCreateEntry = useCallback((kind: CreateEntryKind, target: FileEntry) => {
    setPendingCreate({ kind, target })
    setNewEntryName('')
    setError(null)
  }, [])

  const closeCreateDialog = useCallback(() => {
    setPendingCreate(null)
    setNewEntryName('')
  }, [])

  const createEntry = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      const name = newEntryName.trim()
      if (!rootPath || !pendingCreate || !name) return

      try {
        const targetPath = containingDirectory(pendingCreate.target)
        if (pendingCreate.kind === 'file') await window.atlas.filesystem.createFile(rootPath, targetPath, name)
        else await window.atlas.filesystem.createFolder(rootPath, targetPath, name)
        closeCreateDialog()
        await loadDirectory(targetPath, true)
        setError(null)
      } catch (createError) {
        setError(errorMessage(createError, pendingCreate.kind === 'file' ? t('fileTree.failedCreateFile') : t('fileTree.failedCreateFolder')))
      }
    },
    [closeCreateDialog, loadDirectory, newEntryName, pendingCreate, rootPath, t]
  )

  const requestRenameEntry = useCallback((target: FileEntry) => {
    setRenameTarget(target)
    setRenameEntryName(target.name)
    setError(null)
  }, [])

  const closeRenameDialog = useCallback(() => {
    setRenameTarget(null)
    setRenameEntryName('')
  }, [])

  const renameEntry = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      const name = renameEntryName.trim()
      if (!rootPath || !renameTarget || !name || name === renameTarget.name || renameTarget.path === rootPath) return

      try {
        const parentPath = parentDirectoryPath(renameTarget.path)
        const renamedEntry = (await window.atlas.filesystem.rename(rootPath, renameTarget.path, name)) as FileEntry

        if (renameTarget.kind === 'directory') {
          const openPaths = rebaseOpenPaths(rootPath, openPathsRef.current, renameTarget.path, renamedEntry.path)
          openPathsRef.current = new Set(openPaths)
          updateState({ openPaths }, true)
        }

        closeRenameDialog()
        setSelected(renamedEntry)
        await loadDirectory(parentPath, true)
        setError(null)
      } catch (renameError) {
        setError(errorMessage(renameError, t('fileTree.failedRename')))
      }
    },
    [closeRenameDialog, loadDirectory, renameEntryName, renameTarget, rootPath, t, updateState]
  )

  const requestTrashEntry = useCallback((target: FileEntry) => {
    setTrashTarget(target)
    setError(null)
  }, [])

  const confirmTrashEntry = useCallback(async () => {
    if (!rootPath || !trashTarget) return

    try {
      const parentPath = parentDirectoryPath(trashTarget.path)
      await window.atlas.filesystem.trash(rootPath, trashTarget.path)
      setTrashTarget(null)
      setSelected((current) => (current?.path === trashTarget.path ? null : current))
      await loadDirectory(parentPath, true)
      setError(null)
    } catch (trashError) {
      setError(errorMessage(trashError, t('fileTree.failedTrash')))
    }
  }, [loadDirectory, rootPath, t, trashTarget])

  const rowActions = useMemo<FileTreeRowActions>(
    () => ({
      onContextTarget: setSelected,
      onCreateEntry: requestCreateEntry,
      onRenameEntry: requestRenameEntry,
      onTrashEntry: requestTrashEntry,
      onRevealInFolder: revealInFolder,
      onOpenCommandLine: openCommandLine,
      onOpenOnDesktop: openOnDesktop,
      onCopyPath: copyPath
    }),
    [copyPath, openCommandLine, openOnDesktop, requestCreateEntry, requestRenameEntry, requestTrashEntry, revealInFolder]
  )
  const Row = useMemo(() => createRow(rootPath, rowActions, t), [rootPath, rowActions, t])

  const chooseDirectory = useCallback(async () => {
    const directory = await window.atlas.filesystem.chooseDirectory(t('fileTree.bindTitle'))
    if (directory) {
      updateConfig({ rootPath: directory }, true)
      updateState({ openPaths: [directory] }, true)
    }
  }, [t, updateConfig, updateState])

  const headerActions = useMemo(() => {
    if (!rootPath) return null

    return (
      <>
        <button
          className="icon-button component-node__header-action-button"
          onClick={chooseDirectory}
          title={t('fileTree.chooseFolder')}
          aria-label={t('fileTree.chooseFolder')}
        >
          <Folder size={14} />
        </button>
        <button
          className="icon-button component-node__header-action-button"
          onClick={() => void loadTree()}
          title={t('common.reload')}
          aria-label={t('common.reload')}
        >
          <RefreshCw size={14} />
        </button>
      </>
    )
  }, [chooseDirectory, loadTree, rootPath, t])

  useEffect(() => {
    if (!setHeaderActions) return undefined

    setHeaderActions(headerActions)
    return () => setHeaderActions(null)
  }, [headerActions, setHeaderActions])

  const treeViewportWidth = Math.max(treeViewportSize.width || component.frame.width, 1)
  const treeViewportHeight = Math.max(treeViewportSize.height || component.frame.height, 1)

  if (!rootPath) {
    return (
      <div className="empty-module">
        <Folder size={28} />
        <button className="primary-button" onClick={chooseDirectory}>
          {t('fileTree.chooseFolder')}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="file-tree-module">
        <div className={cn('file-tree-content', error && 'file-tree-content--with-error')}>
          {error ? <div className="module-error">{error}</div> : null}
          <div className="file-tree-viewport" ref={treeViewportRef} onKeyDownCapture={handleTreeKeyDownCapture}>
            <Tree
              key={rootPath}
              data={treeData}
              width={treeViewportWidth}
              height={treeViewportHeight}
              indent={18}
              rowHeight={28}
              childrenAccessor={treeChildren}
              openByDefault={false}
              initialOpenState={initialOpenState}
              selection={selected?.id}
              onSelect={(nodes) => setSelected(nodes[0]?.data ?? null)}
              onToggle={toggleDirectory}
            >
              {Row}
            </Tree>
          </div>
        </div>
      </div>

      <Dialog.Root open={Boolean(pendingCreate)} onOpenChange={(open) => !open && closeCreateDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">
              {pendingCreate?.kind === 'folder' ? t('fileTree.newFolderTitle') : t('fileTree.newFileTitle')}
            </Dialog.Title>
            <Dialog.Description className="dialog-description">
              {t('fileTree.createDescription', {
                location: pendingCreate ? `"${createLocationName(pendingCreate.target)}"` : t('fileTree.currentDirectory')
              })}
            </Dialog.Description>
            <form onSubmit={(event) => void createEntry(event)}>
              <div className="field-row">
                <label htmlFor="file-tree-new-entry-name">{t('common.name')}</label>
                <input
                  id="file-tree-new-entry-name"
                  value={newEntryName}
                  autoFocus
                  onChange={(event) => setNewEntryName(event.target.value)}
                />
              </div>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {t('common.cancel')}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button" disabled={!newEntryName.trim()}>
                  {pendingCreate?.kind === 'folder' ? <FolderPlus size={16} /> : <FilePlus size={16} />}
                  <span>{t('common.create')}</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(renameTarget)} onOpenChange={(open) => !open && closeRenameDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">
              {renameTarget?.kind === 'directory' ? t('fileTree.renameFolderTitle') : t('fileTree.renameFileTitle')}
            </Dialog.Title>
            <Dialog.Description className="dialog-description">
              {t('fileTree.renameDescription', { name: renameTarget ? `"${renameTarget.name}"` : t('fileTree.thisItem') })}
            </Dialog.Description>
            <form onSubmit={(event) => void renameEntry(event)}>
              <div className="field-row">
                <label htmlFor="file-tree-rename-entry-name">{t('common.name')}</label>
                <input
                  id="file-tree-rename-entry-name"
                  value={renameEntryName}
                  autoFocus
                  onChange={(event) => setRenameEntryName(event.target.value)}
                />
              </div>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {t('common.cancel')}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button" disabled={!renameEntryName.trim() || renameEntryName.trim() === renameTarget?.name}>
                  <Pencil size={16} />
                  <span>{t('common.rename')}</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(trashTarget)} onOpenChange={(open) => !open && setTrashTarget(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">
              {trashTarget?.kind === 'directory' ? t('fileTree.deleteFolderTitle') : t('fileTree.deleteFileTitle')}
            </Dialog.Title>
            <Dialog.Description className="dialog-description">
              {t('fileTree.trashDescription', { name: trashTarget ? `"${trashTarget.name}"` : t('fileTree.thisItem') })}
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {t('common.cancel')}
                  </button>
              </Dialog.Close>
              <button type="button" className="tool-button danger" onClick={() => void confirmTrashEntry()}>
                <Trash2 size={16} />
                <span>{t('common.delete')}</span>
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
