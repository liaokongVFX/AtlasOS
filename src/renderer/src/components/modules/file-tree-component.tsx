import { Tree, type NodeRendererProps } from 'react-arborist'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, ChevronRight, Copy, File, FilePlus, Folder, FolderOpen, FolderPlus, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { FileEntry } from '@shared/schema'
import { useElementSize } from '../../hooks/use-element-size'
import { writeClipboardText } from '../../lib/clipboard'
import { asString, cn } from '../../lib/utils'
import { useCanvasStore } from '../../store/canvas-store'
import type { AtlasComponentRendererProps } from '../registry'

type FileNodeData = FileEntry
const FILE_TREE_LOAD_DEPTH = 1

type FileTreeRowActions = {
  onContextTarget: (entry: FileEntry) => void
  onCreateEntry: (kind: CreateEntryKind, target: FileEntry) => void
  onTrashEntry: (target: FileEntry) => void
  onRevealInFolder: (entry: FileEntry) => Promise<void> | void
  onOpenCommandLine: (entry: FileEntry) => Promise<void> | void
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

function pathDepth(path: string): number {
  return path.split(/[\\/]/).length
}

function sortByPathDepth(paths: string[]): string[] {
  return [...paths].sort((first, second) => pathDepth(first) - pathDepth(second))
}

function treeChildren(entry: FileEntry): readonly FileEntry[] | null {
  return canExpandDirectory(entry) ? (entry.children ?? []) : null
}

function syncSelectedEntry(tree: FileEntry, selected: FileEntry | null): FileEntry | null {
  if (!selected) return null

  return findEntry(tree, selected.path)
}

function createRow(rootPath: string, actions: FileTreeRowActions) {
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
            onDoubleClick={() => {
              if (isExpandable) node.toggle()
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
                aria-label={node.isOpen ? 'Collapse folder' : 'Expand folder'}
                title={node.isOpen ? 'Collapse folder' : 'Expand folder'}
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
            aria-label={`${entry.name} actions`}
          >
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => actions.onCreateEntry('file', entry)}>
              <FilePlus size={14} />
              <span>新建文件</span>
            </ContextMenu.Item>
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => actions.onCreateEntry('folder', entry)}>
              <FolderPlus size={14} />
              <span>新建文件夹</span>
            </ContextMenu.Item>
            {entry.path !== rootPath ? (
              <ContextMenu.Item
                className="menu-item menu-item--danger file-tree-context-menu__item"
                onSelect={() => actions.onTrashEntry(entry)}
              >
                <Trash2 size={14} />
                <span>{entry.kind === 'directory' ? '删除文件夹' : '删除文件'}</span>
              </ContextMenu.Item>
            ) : null}
            <ContextMenu.Separator className="menu-separator" />
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => void actions.onRevealInFolder(entry)}>
              <FolderOpen size={14} />
              <span>打开文件所在位置</span>
            </ContextMenu.Item>
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => void actions.onOpenCommandLine(entry)}>
              <TerminalSquare size={14} />
              <span>打开命令行</span>
            </ContextMenu.Item>
            <ContextMenu.Separator className="menu-separator" />
            <ContextMenu.Item className="menu-item file-tree-context-menu__item" onSelect={() => void actions.onCopyPath(entry)}>
              <Copy size={14} />
              <span>复制文件路径</span>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    )
  }
}

export function FileTreeComponent({ component, updateConfig }: AtlasComponentRendererProps): JSX.Element {
  const rootPath = asString(component.config.rootPath)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const size = useElementSize(containerRef)
  const addComponent = useCanvasStore((state) => state.addComponent)
  const [tree, setTree] = useState<FileEntry | null>(null)
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [pendingCreate, setPendingCreate] = useState<PendingCreateEntry | null>(null)
  const [newEntryName, setNewEntryName] = useState('')
  const [trashTarget, setTrashTarget] = useState<FileEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const treeRef = useRef<FileEntry | null>(null)
  const loadingPathsRef = useRef(new Set<string>())

  useEffect(() => {
    treeRef.current = tree
  }, [tree])

  const loadTree = useCallback(async () => {
    if (!rootPath) return
    try {
      const previousTree = treeRef.current?.path === rootPath ? treeRef.current : null
      const root = (await window.atlas.filesystem.listTree(rootPath, rootPath, FILE_TREE_LOAD_DEPTH)) as FileEntry
      let nextTree = root
      const loadedPaths = sortByPathDepth((previousTree ? collectLoadedDirectoryPaths(previousTree) : []).filter((path) => path !== rootPath))
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
      setError(loadError instanceof Error ? loadError.message : 'Failed to load folder')
    }
  }, [rootPath])

  const loadDirectory = useCallback(
    async (targetPath: string, force = false) => {
      if (!rootPath || loadingPathsRef.current.has(targetPath)) return

      const currentTree = treeRef.current
      const currentEntry = currentTree ? findEntry(currentTree, targetPath) : null
      if (!currentEntry || currentEntry.kind !== 'directory') return
      if (!force && currentEntry.childrenLoaded) return

      loadingPathsRef.current.add(targetPath)
      try {
        const loadedEntry = (await window.atlas.filesystem.listTree(rootPath, targetPath, FILE_TREE_LOAD_DEPTH)) as FileEntry
        setTree((current) => {
          if (!current) return current

          const nextTree = replaceEntry(current, loadedEntry)
          treeRef.current = nextTree
          return nextTree
        })
        setSelected((current) => (current?.path === loadedEntry.path ? loadedEntry : current))
        setError(null)
      } catch (loadError) {
        setError(errorMessage(loadError, 'Failed to load folder'))
      } finally {
        loadingPathsRef.current.delete(targetPath)
      }
    },
    [rootPath]
  )

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    if (!rootPath) return
    let watchId: string | null = null
    let dispose: () => void = () => undefined

    void window.atlas.filesystem.watch(rootPath).then((watch) => {
      watchId = watch.watchId
      dispose = window.atlas.filesystem.onWatchEvent((event) => {
        if (event.watchId !== watch.watchId) return

        const currentTree = treeRef.current
        const parentPath = parentDirectoryPath(event.path)
        const parentEntry = currentTree ? findEntry(currentTree, parentPath) : null
        if (parentEntry?.kind === 'directory' && parentEntry.childrenLoaded) {
          void loadDirectory(parentPath, true)
          return
        }

        if (!currentTree || parentPath === rootPath) void loadTree()
      })
    })

    return () => {
      dispose()
      if (watchId) void window.atlas.filesystem.unwatch(watchId)
    }
  }, [loadDirectory, loadTree, rootPath])

  const treeData = useMemo(() => (tree ? [tree] : []), [tree])
  const initialOpenState = useMemo(() => (rootPath ? { [rootPath]: true } : {}), [rootPath])

  const revealInFolder = useCallback(
    async (entry: FileEntry) => {
      if (!rootPath) return
      try {
        await window.atlas.filesystem.revealInFolder(rootPath, entry.path)
        setError(null)
      } catch (actionError) {
        setError(errorMessage(actionError, 'Failed to open file location'))
      }
    },
    [rootPath]
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

  const copyPath = useCallback(async (entry: FileEntry) => {
    try {
      const didCopy = await writeClipboardText(entry.path)
      if (!didCopy) {
        setError('Failed to copy file path')
        return
      }
      setError(null)
    } catch (actionError) {
      setError(errorMessage(actionError, 'Failed to copy file path'))
    }
  }, [])

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
        setError(errorMessage(createError, pendingCreate.kind === 'file' ? 'Failed to create file' : 'Failed to create folder'))
      }
    },
    [closeCreateDialog, loadDirectory, newEntryName, pendingCreate, rootPath]
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
      setError(errorMessage(trashError, 'Failed to move item to recycle bin'))
    }
  }, [loadDirectory, rootPath, trashTarget])

  const rowActions = useMemo<FileTreeRowActions>(
    () => ({
      onContextTarget: setSelected,
      onCreateEntry: requestCreateEntry,
      onTrashEntry: requestTrashEntry,
      onRevealInFolder: revealInFolder,
      onOpenCommandLine: openCommandLine,
      onCopyPath: copyPath
    }),
    [copyPath, openCommandLine, requestCreateEntry, requestTrashEntry, revealInFolder]
  )
  const Row = useMemo(() => createRow(rootPath, rowActions), [rootPath, rowActions])

  const chooseDirectory = async () => {
    const directory = await window.atlas.filesystem.chooseDirectory('Bind file tree to folder')
    if (directory) updateConfig({ rootPath: directory }, true)
  }

  if (!rootPath) {
    return (
      <div className="empty-module">
        <Folder size={28} />
        <button className="primary-button" onClick={chooseDirectory}>
          Choose folder
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="file-tree-module" ref={containerRef}>
        <div className="file-tree-toolbar">
          <button className="icon-button" onClick={chooseDirectory} title="Choose folder">
            <Folder size={15} />
          </button>
          <button className="icon-button" onClick={() => void loadTree()} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
        {error ? <div className="module-error">{error}</div> : null}
        <Tree
          key={rootPath}
          data={treeData}
          width={Math.max(size.width, 280)}
          height={Math.max(size.height - 42, 240)}
          indent={18}
          rowHeight={28}
          childrenAccessor={treeChildren}
          openByDefault={false}
          initialOpenState={initialOpenState}
          selection={selected?.id}
          onSelect={(nodes) => setSelected(nodes[0]?.data ?? null)}
          onToggle={(id) => void loadDirectory(id)}
        >
          {Row}
        </Tree>
      </div>

      <Dialog.Root open={Boolean(pendingCreate)} onOpenChange={(open) => !open && closeCreateDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">{pendingCreate?.kind === 'folder' ? '新建文件夹' : '新建文件'}</Dialog.Title>
            <Dialog.Description className="dialog-description">
              在 {pendingCreate ? `"${createLocationName(pendingCreate.target)}"` : '当前目录'} 中创建。
            </Dialog.Description>
            <form onSubmit={(event) => void createEntry(event)}>
              <div className="field-row">
                <label htmlFor="file-tree-new-entry-name">名称</label>
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
                    取消
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button" disabled={!newEntryName.trim()}>
                  {pendingCreate?.kind === 'folder' ? <FolderPlus size={16} /> : <FilePlus size={16} />}
                  <span>创建</span>
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
            <Dialog.Title className="dialog-title">{trashTarget?.kind === 'directory' ? '删除文件夹?' : '删除文件?'}</Dialog.Title>
            <Dialog.Description className="dialog-description">
              将 {trashTarget ? `"${trashTarget.name}"` : '该项目'} 移到回收站。
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="tool-button">
                  取消
                </button>
              </Dialog.Close>
              <button type="button" className="tool-button danger" onClick={() => void confirmTrashEntry()}>
                <Trash2 size={16} />
                <span>删除</span>
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
