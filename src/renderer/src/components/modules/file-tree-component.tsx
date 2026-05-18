import { Tree, type NodeRendererProps } from 'react-arborist'
import { File, Folder, FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry } from '@shared/schema'
import { useElementSize } from '../../hooks/use-element-size'
import { asString, cn } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type FileNodeData = FileEntry

function createRow(rootPath: string) {
  return function Row({ node, style }: NodeRendererProps<FileNodeData>) {
  const entry = node.data
  const Icon = entry.kind === 'directory' ? (node.isOpen ? FolderOpen : Folder) : File

  return (
    <div
      className={cn('file-tree-row', node.isSelected && 'file-tree-row--selected')}
      style={style}
      onDoubleClick={() => {
        if (entry.kind === 'directory') node.toggle()
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
      <Icon size={15} />
      <span>{entry.name}</span>
    </div>
  )
}
}

export function FileTreeComponent({ component, updateConfig }: AtlasComponentRendererProps): JSX.Element {
  const rootPath = asString(component.config.rootPath)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const size = useElementSize(containerRef)
  const [tree, setTree] = useState<FileEntry | null>(null)
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadTree = useCallback(async () => {
    if (!rootPath) return
    try {
      const result = (await window.atlas.filesystem.listTree(rootPath, 4)) as FileEntry
      setTree(result)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load folder')
    }
  }, [rootPath])

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
        if (event.watchId === watch.watchId) void loadTree()
      })
    })

    return () => {
      dispose()
      if (watchId) void window.atlas.filesystem.unwatch(watchId)
    }
  }, [loadTree, rootPath])

  const treeData = useMemo(() => (tree ? [tree] : []), [tree])
  const Row = useMemo(() => createRow(rootPath), [rootPath])
  const operationTarget = selected?.kind === 'directory' ? selected.path : selected ? selected.path.replace(/[\\/][^\\/]+$/, '') : rootPath

  const chooseDirectory = async () => {
    const directory = await window.atlas.filesystem.chooseDirectory('Bind file tree to folder')
    if (directory) updateConfig({ rootPath: directory }, true)
  }

  const createEntry = async (kind: 'file' | 'folder') => {
    if (!rootPath || !operationTarget || !newName.trim()) return
    if (kind === 'file') await window.atlas.filesystem.createFile(rootPath, operationTarget, newName.trim())
    else await window.atlas.filesystem.createFolder(rootPath, operationTarget, newName.trim())
    setNewName('')
    await loadTree()
  }

  const trashSelected = async () => {
    if (!rootPath || !selected) return
    const ok = window.confirm(`Move ${selected.name} to recycle bin?`)
    if (!ok) return
    await window.atlas.filesystem.trash(rootPath, selected.path)
    setSelected(null)
    await loadTree()
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
    <div className="file-tree-module" ref={containerRef}>
      <div className="file-tree-toolbar">
        <button className="icon-button" onClick={chooseDirectory} title="Choose folder">
          <Folder size={15} />
        </button>
        <button className="icon-button" onClick={() => void loadTree()} title="Refresh">
          <RefreshCw size={15} />
        </button>
        <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="new file or folder" />
        <button className="icon-button" onClick={() => void createEntry('file')} title="New file">
          <Plus size={15} />
        </button>
        <button className="icon-button" onClick={() => void createEntry('folder')} title="New folder">
          <Folder size={15} />
        </button>
        <button className="icon-button danger" onClick={() => void trashSelected()} disabled={!selected} title="Trash selected">
          <Trash2 size={15} />
        </button>
      </div>
      {error ? <div className="module-error">{error}</div> : null}
      <Tree
        data={treeData}
        width={Math.max(size.width, 280)}
        height={Math.max(size.height - 42, 240)}
        indent={18}
        rowHeight={28}
        openByDefault
        onSelect={(nodes) => setSelected(nodes[0]?.data ?? null)}
      >
        {Row}
      </Tree>
    </div>
  )
}
