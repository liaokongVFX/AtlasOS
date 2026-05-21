import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  type OnMove,
  type NodeChange,
  type OnMoveEnd,
  useReactFlow,
  useViewport
} from '@xyflow/react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronLeft, Map as MapIcon, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type RefObject } from 'react'
import type { Measurable } from '@radix-ui/rect'
import type { CanvasComponent, ComponentType, FileEntry } from '@shared/schema'
import { notifyCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { fileName, getFilePreviewKind, isMarkdownFile } from '../lib/file-types'
import {
  fitMediaFrameToAspectRatio,
  mediaAspectRatioFromConfig,
  mediaAspectRatioFromDimensions,
  mediaFrameHeightForWidth,
  type MediaDimensions
} from '../lib/media-frame'
import { useCanvasStore } from '../store/canvas-store'
import { ComponentNode, type AtlasFlowNode } from './component-node'
import { COMPONENT_DEFINITIONS, CREATABLE_COMPONENT_TYPES } from './component-definitions'
import { componentRegistry } from './registry'

type CanvasComponentPatch = Omit<Partial<CanvasComponent>, 'frame'> & {
  frame?: Partial<CanvasComponent['frame']>
}

const nodeTypes = {
  atlasComponent: ComponentNode
}

const MINIMAP_PANEL_OFFSET = 15
const MINIMAP_WIDTH = 224
const MINIMAP_HEIGHT = 164
const MINIMAP_BUTTON_SIZE = 32
const MINIMAP_TOGGLE_INSET = 6
const DROP_STACK_OFFSET = 32

const MINIMAP_NODE_COLORS: Record<ComponentType, string> = {
  terminal: '#5e6ad2',
  'file-tree': '#828fff',
  browser: '#7a7fad',
  'markdown-note': '#9aa3ff',
  'file-preview': '#4f58b8'
}

const CANVAS_SHORTCUT_BLOCKLIST_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  '.cm-editor',
  '.xterm',
  '.component-node__body',
  '.dialog-content',
  '.popover-content',
  '.menu-content',
  '.top-bar'
].join(',')

function getMiniMapNodeColor(node: AtlasFlowNode): string {
  return MINIMAP_NODE_COLORS[node.data.component.type]
}

function componentToNode(canvasId: string, component: CanvasComponent, onRequestSelect?: (componentId: string) => void): AtlasFlowNode {
  return {
    id: component.id,
    type: 'atlasComponent',
    position: { x: component.frame.x, y: component.frame.y },
    initialWidth: component.frame.width,
    initialHeight: component.frame.height,
    width: component.frame.width,
    height: component.frame.height,
    measured: { width: component.frame.width, height: component.frame.height },
    zIndex: component.zIndex,
    data: { canvasId, component, onRequestSelect },
    style: {
      width: component.frame.width,
      height: component.frame.height,
      zIndex: component.zIndex
    }
  }
}

function reconcileFlowNodes(nextNodes: AtlasFlowNode[], currentNodes: AtlasFlowNode[]): AtlasFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]))

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id)
    if (!currentNode) return nextNode
    const measured =
      currentNode.measured?.width !== undefined && currentNode.measured.height !== undefined
        ? currentNode.measured
        : nextNode.measured

    return {
      ...currentNode,
      ...nextNode,
      selected: currentNode.selected,
      dragging: currentNode.dragging,
      resizing: currentNode.resizing,
      measured
    }
  })
}

function selectedNodeIds(nodes: AtlasFlowNode[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id)
}

function closestFlowNodeId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null

  return target.closest<HTMLElement>('.react-flow__node[data-id]')?.dataset.id ?? null
}

function isSelectedTerminalTarget(target: EventTarget | null, selectedNodeIds: Set<string>): boolean {
  if (!(target instanceof Element) || !target.closest('.xterm')) return false

  const flowNodeId = closestFlowNodeId(target)
  return Boolean(flowNodeId && selectedNodeIds.has(flowNodeId))
}

function isCanvasShortcutBlocked(target: EventTarget | null, selectedNodeIds: Set<string>, shortcut: 'delete' | 'duplicate'): boolean {
  if (shortcut === 'delete' && isSelectedTerminalTarget(target, selectedNodeIds)) return false

  return target instanceof Element && Boolean(target.closest(CANVAS_SHORTCUT_BLOCKLIST_SELECTOR))
}

type DroppedCanvasFile = {
  path: string
  name: string
  kind: 'file' | 'directory'
  rootPath?: string
  mimeType?: string
  mediaDimensions?: MediaDimensions
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

async function measureImageFileDimensions(file: File): Promise<MediaDimensions | null> {
  if (typeof createImageBitmap !== 'function') return null

  try {
    const bitmap = await createImageBitmap(file)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return dimensions
  } catch {
    return null
  }
}

async function measureExternalMediaDimensions(file: File, droppedFile: DroppedCanvasFile): Promise<MediaDimensions | null> {
  const previewKind = getFilePreviewKind(droppedFile.name || droppedFile.path, droppedFile.mimeType)
  if (previewKind === 'image') return measureImageFileDimensions(file)
  return null
}

function parseAtlasDroppedFile(raw: string): DroppedCanvasFile | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value)) return null

    const path = optionalString(value.path)
    const name = optionalString(value.name)
    const kind = value.kind === 'directory' ? 'directory' : value.kind === 'file' ? 'file' : null

    if (!path || !name || !kind) return null

    return {
      path,
      name,
      kind,
      rootPath: optionalString(value.rootPath),
      mimeType: optionalString(value.mimeType)
    }
  } catch {
    return null
  }
}

function isSupportedDrop(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types)
  return types.includes('application/atlas-file') || types.includes('Files')
}

async function describeExternalFile(file: File): Promise<DroppedCanvasFile | null> {
  const path = window.atlas.filesystem.getPathForFile(file).trim()
  if (!path) return null

  try {
    const entry = (await window.atlas.filesystem.listTree(path, 0)) as FileEntry
    const droppedFile: DroppedCanvasFile = {
      path: entry.path,
      name: file.name || fileName(entry.path) || entry.name,
      kind: entry.kind,
      rootPath: entry.path,
      mimeType: optionalString(file.type)
    }
    return {
      ...droppedFile,
      mediaDimensions: entry.kind === 'file' ? (await measureExternalMediaDimensions(file, droppedFile)) ?? undefined : undefined
    }
  } catch {
    const droppedFile: DroppedCanvasFile = {
      path,
      name: file.name || fileName(path),
      kind: 'file',
      rootPath: path,
      mimeType: optionalString(file.type)
    }
    return {
      ...droppedFile,
      mediaDimensions: (await measureExternalMediaDimensions(file, droppedFile)) ?? undefined
    }
  }
}

async function droppedFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<DroppedCanvasFile[]> {
  const atlasFile = parseAtlasDroppedFile(dataTransfer.getData('application/atlas-file'))
  if (atlasFile) return [atlasFile]

  const files = await Promise.all(Array.from(dataTransfer.files).map((file) => describeExternalFile(file)))
  return files.filter((file): file is DroppedCanvasFile => Boolean(file))
}

function typeForDroppedFile(file: DroppedCanvasFile): ComponentType {
  if (file.kind === 'directory') return 'file-tree'
  if (isMarkdownFile(file.name, file.mimeType)) return 'markdown-note'
  return 'file-preview'
}

function rootPathForDroppedFile(file: DroppedCanvasFile): string {
  return file.rootPath ?? file.path
}

async function createDroppedFilePatch(file: DroppedCanvasFile, type: ComponentType): Promise<CanvasComponentPatch> {
  const rootPath = rootPathForDroppedFile(file)
  const config: Record<string, unknown> = file.mimeType ? { mimeType: file.mimeType } : {}
  const bindings = { rootPath, path: file.path }
  const mediaAspectRatio = type === 'file-preview' ? mediaAspectRatioFromDimensions(file.mediaDimensions) : null

  if (file.mediaDimensions && mediaAspectRatio) {
    config.mediaAspectRatio = mediaAspectRatio
    config.mediaWidth = Math.round(file.mediaDimensions.width)
    config.mediaHeight = Math.round(file.mediaDimensions.height)
  }

  if (type === 'file-tree') {
    return {
      title: file.name,
      config: { rootPath: file.path },
      bindings
    }
  }

  if (type === 'markdown-note') {
    let content = ''
    let status = 'live'

    try {
      content = (await window.atlas.filesystem.readFile(rootPath, file.path)) as string
    } catch {
      status = 'missing'
    }

    return {
      title: file.name,
      config,
      bindings,
      state: { content, status }
    }
  }

  const mediaFrame = mediaAspectRatio ? fitMediaFrameToAspectRatio(COMPONENT_DEFINITIONS['file-preview'].defaultFrame, mediaAspectRatio) : null

  return {
    title: file.name,
    config,
    bindings,
    frame: mediaFrame ? { width: mediaFrame.width, height: mediaFrame.height } : undefined
  }
}

function droppedFilePosition(position: { x: number; y: number }, index: number): { x: number; y: number } {
  const column = index % 4
  const row = Math.floor(index / 4)

  return {
    x: Math.round(position.x + column * DROP_STACK_OFFSET),
    y: Math.round(position.y + row * DROP_STACK_OFFSET)
  }
}

type CanvasCreateMenuState = {
  flowPosition: { x: number; y: number }
}

function createPointRect(x: number, y: number): DOMRect {
  return {
    x,
    y,
    width: 0,
    height: 0,
    top: y,
    right: x,
    bottom: y,
    left: x,
    toJSON: () => ({ x, y, width: 0, height: 0, top: y, right: x, bottom: y, left: x })
  } as DOMRect
}

function createPointAnchor(x: number, y: number): Measurable {
  return {
    getBoundingClientRect: () => createPointRect(x, y)
  }
}

function CanvasCreateMenu({
  anchorRef,
  open,
  onClose,
  onCreate
}: {
  anchorRef: RefObject<Measurable>
  open: boolean
  onClose: () => void
  onCreate: (type: ComponentType) => void
}): JSX.Element {
  const [activeType, setActiveType] = useState<ComponentType>(CREATABLE_COMPONENT_TYPES[0])

  useEffect(() => {
    if (open) setActiveType(CREATABLE_COMPONENT_TYPES[0])
  }, [open])

  return (
    <Popover.Root open={open} modal={false} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Popover.Anchor virtualRef={anchorRef} />
      <Popover.Portal>
        <Popover.Content
          className="menu-content canvas-create-menu"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          role="menu"
          aria-label="Create component"
        >
          {CREATABLE_COMPONENT_TYPES.map((type) => {
            const definition = componentRegistry[type]
            const Icon = definition.icon

            return (
              <button
                key={type}
                type="button"
                className={[
                  'menu-item',
                  'canvas-create-menu__item',
                  activeType === type ? 'menu-item--active canvas-create-menu__item--active' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                role="menuitem"
                onFocus={() => setActiveType(type)}
                onMouseEnter={() => setActiveType(type)}
                onClick={() => onCreate(type)}
              >
                <Icon size={14} />
                <span>{definition.title}</span>
              </button>
            )
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function CanvasMiniMapToggle({
  expanded,
  onToggle
}: {
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  const Icon = expanded ? ChevronLeft : MapIcon
  const toggleStyle = expanded
    ? {
        left: MINIMAP_PANEL_OFFSET + MINIMAP_WIDTH - MINIMAP_BUTTON_SIZE - MINIMAP_TOGGLE_INSET,
        bottom: MINIMAP_PANEL_OFFSET + MINIMAP_HEIGHT - MINIMAP_BUTTON_SIZE - MINIMAP_TOGGLE_INSET,
        margin: 0
      }
    : { left: MINIMAP_PANEL_OFFSET, bottom: MINIMAP_PANEL_OFFSET, margin: 0 }

  return (
    <Panel
      position="bottom-left"
      className={`canvas-minimap-toggle${expanded ? ' canvas-minimap-toggle--overlaid' : ''}`}
      style={toggleStyle}
    >
      <button
        type="button"
        className="canvas-panel-button"
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
        aria-label={expanded ? 'Collapse canvas overview' : 'Expand canvas overview'}
        title={expanded ? 'Collapse canvas overview' : 'Expand canvas overview'}
      >
        <Icon size={16} />
      </button>
    </Panel>
  )
}

function CanvasMiniMap(): JSX.Element {
  const [expanded, setExpanded] = useState(true)

  return (
    <>
      {expanded ? (
        <MiniMap<AtlasFlowNode>
          position="bottom-left"
          className="canvas-minimap"
          style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT, left: MINIMAP_PANEL_OFFSET, bottom: MINIMAP_PANEL_OFFSET, margin: 0 }}
          bgColor="rgba(1, 1, 2, 0.96)"
          maskColor="rgba(94, 106, 210, 0.18)"
          maskStrokeColor="rgba(130, 143, 255, 0.56)"
          maskStrokeWidth={1.25}
          nodeColor={getMiniMapNodeColor}
          nodeStrokeColor={() => 'rgba(247, 248, 248, 0.18)'}
          nodeBorderRadius={2}
          nodeStrokeWidth={1}
          pannable
          zoomable
          ariaLabel="Canvas overview"
        />
      ) : null}
      <CanvasMiniMapToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    </>
  )
}

function CanvasZoomControls({ hasNodes }: { hasNodes: boolean }): JSX.Element {
  const reactFlow = useReactFlow<AtlasFlowNode>()
  const { zoom } = useViewport()
  const zoomPercent = Math.round(zoom * 100)

  const notifyAfterViewportAction = useCallback((action: Promise<boolean>) => {
    void action.then(() => notifyCanvasViewportSync()).catch(() => undefined)
  }, [])

  const zoomOut = useCallback(() => {
    notifyAfterViewportAction(reactFlow.zoomOut({ duration: 140, interpolate: 'linear' }))
  }, [notifyAfterViewportAction, reactFlow])

  const zoomIn = useCallback(() => {
    notifyAfterViewportAction(reactFlow.zoomIn({ duration: 140, interpolate: 'linear' }))
  }, [notifyAfterViewportAction, reactFlow])

  const fitView = useCallback(() => {
    if (!hasNodes) return
    notifyAfterViewportAction(reactFlow.fitView({ duration: 160, padding: 0.12 }))
  }, [hasNodes, notifyAfterViewportAction, reactFlow])

  return (
    <Panel position="bottom-right" className="canvas-zoom-controls" style={{ right: 15, bottom: 15, margin: 0 }}>
      <button type="button" className="canvas-panel-button" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
        <ZoomOut size={16} />
      </button>
      <div className="canvas-zoom-level" aria-live="polite">
        {zoomPercent}%
      </div>
      <button
        type="button"
        className="canvas-panel-button"
        onClick={fitView}
        disabled={!hasNodes}
        aria-label="Fit view"
        title="Fit view"
      >
        <Maximize2 size={16} />
      </button>
      <button type="button" className="canvas-panel-button" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
        <ZoomIn size={16} />
      </button>
    </Panel>
  )
}

export function CanvasBoard(): JSX.Element {
  const reactFlow = useReactFlow<AtlasFlowNode>()
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvas = useCanvasStore((state) => (state.activeCanvasId ? state.canvases[state.activeCanvasId] : null))
  const updateCanvas = useCanvasStore((state) => state.updateCanvas)
  const updateComponent = useCanvasStore((state) => state.updateComponent)
  const addComponent = useCanvasStore((state) => state.addComponent)
  const addComponents = useCanvasStore((state) => state.addComponents)
  const duplicateComponents = useCanvasStore((state) => state.duplicateComponents)
  const removeComponents = useCanvasStore((state) => state.removeComponents)
  const bringToFront = useCanvasStore((state) => state.bringToFront)
  const [nodes, setNodes] = useState<AtlasFlowNode[]>(() =>
    canvas ? canvas.components.map((component) => componentToNode(canvas.id, component)) : []
  )
  const [createMenu, setCreateMenu] = useState<CanvasCreateMenuState | null>(null)
  const [isFileDragActive, setIsFileDragActive] = useState(false)
  const createMenuAnchorRef = useRef<Measurable>(createPointAnchor(0, 0))
  const pendingSelectedNodeIdsRef = useRef<Set<string> | null>(null)

  const selectComponentForContextMenu = useCallback(
    (componentId: string) => {
      if (!activeCanvasId) return

      setNodes((currentNodes) => {
        let didChange = false
        const nextNodes = currentNodes.map((node) => {
          const shouldSelect = node.id === componentId
          if (node.selected === shouldSelect) return node

          didChange = true
          return { ...node, selected: shouldSelect }
        })

        return didChange ? nextNodes : currentNodes
      })
      bringToFront(activeCanvasId, componentId)
      notifyCanvasViewportSync()
    },
    [activeCanvasId, bringToFront]
  )

  const persistedNodes = useMemo(
    () => (canvas ? canvas.components.map((component) => componentToNode(canvas.id, component, selectComponentForContextMenu)) : []),
    [canvas, selectComponentForContextMenu]
  )

  useLayoutEffect(() => {
    setNodes((currentNodes) => {
      const reconciledNodes = reconcileFlowNodes(persistedNodes, currentNodes)
      const pendingSelectedNodeIds = pendingSelectedNodeIdsRef.current

      if (!pendingSelectedNodeIds) return reconciledNodes

      pendingSelectedNodeIdsRef.current = null
      return reconciledNodes.map((node) => ({
        ...node,
        selected: pendingSelectedNodeIds.has(node.id)
      }))
    })
  }, [persistedNodes])

  const onNodesChange = useCallback(
    (changes: NodeChange<AtlasFlowNode>[]) => {
      setNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
      if (!activeCanvasId) return

      const removedNodeIds = changes.filter((change) => change.type === 'remove').map((change) => change.id)
      if (removedNodeIds.length > 0) {
        removeComponents(activeCanvasId, removedNodeIds)
      }

      let shouldSyncNativeOverlays = removedNodeIds.length > 0
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          shouldSyncNativeOverlays = true
          updateComponent(activeCanvasId, change.id, (component) => {
            component.frame.x = Math.round(change.position!.x)
            component.frame.y = Math.round(change.position!.y)
          })
        }

        if (change.type === 'dimensions' && change.dimensions) {
          shouldSyncNativeOverlays = true
          updateComponent(activeCanvasId, change.id, (component) => {
            const mediaAspectRatio =
              component.type === 'file-preview'
                ? mediaAspectRatioFromConfig(component.config)
                : null
            component.frame.width = Math.round(change.dimensions!.width)
            component.frame.height = Math.round(
              mediaAspectRatio ? mediaFrameHeightForWidth(change.dimensions!.width, mediaAspectRatio) : change.dimensions!.height
            )
          })
        }
      }

      if (shouldSyncNativeOverlays) notifyCanvasViewportSync()
    },
    [activeCanvasId, removeComponents, updateComponent]
  )

  const closeCreateMenu = useCallback(() => {
    setCreateMenu((currentMenu) => (currentMenu ? null : currentMenu))
  }, [])

  const deleteSelectedNodes = useCallback(
    (componentIds: string[]) => {
      if (!activeCanvasId || componentIds.length === 0) return

      closeCreateMenu()
      removeComponents(activeCanvasId, componentIds)
      const removedIds = new Set(componentIds)
      setNodes((currentNodes) => currentNodes.filter((node) => !removedIds.has(node.id)))
      notifyCanvasViewportSync()
    },
    [activeCanvasId, closeCreateMenu, removeComponents]
  )

  const duplicateSelectedNodes = useCallback(
    (componentIds: string[]) => {
      if (!activeCanvasId || componentIds.length === 0) return

      const duplicatedNodeIds = duplicateComponents(activeCanvasId, componentIds)
      if (duplicatedNodeIds.length === 0) return

      closeCreateMenu()
      pendingSelectedNodeIdsRef.current = new Set(duplicatedNodeIds)
      setNodes((currentNodes) => currentNodes.map((node) => (node.selected ? { ...node, selected: false } : node)))
      notifyCanvasViewportSync()
    },
    [activeCanvasId, closeCreateMenu, duplicateComponents]
  )

  const getSelectedComponentIds = useCallback(() => {
    const flowNodes = reactFlow.getNodes()
    return flowNodes.length > 0 ? selectedNodeIds(flowNodes) : selectedNodeIds(nodes)
  }, [nodes, reactFlow])

  const handleCanvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || !activeCanvasId) return

      const componentIds = getSelectedComponentIds()
      if (componentIds.length === 0) return

      const selectedComponentIds = new Set(componentIds)
      if (event.key === 'Delete' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (isCanvasShortcutBlocked(event.target, selectedComponentIds, 'delete')) return

        event.preventDefault()
        event.stopPropagation()
        deleteSelectedNodes(componentIds)
        return
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'd') {
        if (isCanvasShortcutBlocked(event.target, selectedComponentIds, 'duplicate')) return

        event.preventDefault()
        event.stopPropagation()
        duplicateSelectedNodes(componentIds)
      }
    },
    [activeCanvasId, deleteSelectedNodes, duplicateSelectedNodes, getSelectedComponentIds]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleCanvasKeyDown, true)
    return () => window.removeEventListener('keydown', handleCanvasKeyDown, true)
  }, [handleCanvasKeyDown])

  const onMove: OnMove = useCallback(() => {
    closeCreateMenu()
    notifyCanvasViewportSync()
  }, [closeCreateMenu])

  const onMoveEnd: OnMoveEnd = useCallback(
    (_, viewport) => {
      if (!activeCanvasId) return
      updateCanvas(activeCanvasId, (draft) => {
        draft.viewport = viewport
      })
      notifyCanvasViewportSync()
    },
    [activeCanvasId, updateCanvas]
  )

  const openCreateMenuAtPointer = useCallback((event: MouseEvent) => {
    if (event.detail !== 2) return
    event.preventDefault()

    const screenPosition = { x: event.clientX, y: event.clientY }
    const flowPosition = reactFlow.screenToFlowPosition(screenPosition, { snapToGrid: false })
    createMenuAnchorRef.current = createPointAnchor(screenPosition.x, screenPosition.y)
    setCreateMenu({
      flowPosition: { x: Math.round(flowPosition.x), y: Math.round(flowPosition.y) }
    })
  }, [reactFlow])

  const createComponentFromMenu = useCallback(
    (type: ComponentType) => {
      if (!createMenu) return
      addComponent(type, createMenu.flowPosition)
      closeCreateMenu()
      notifyCanvasViewportSync()
    },
    [addComponent, closeCreateMenu, createMenu]
  )

  const handleNodeClick = useCallback(
    (_: MouseEvent, node: AtlasFlowNode) => {
      if (!activeCanvasId) return
      bringToFront(activeCanvasId, node.id)
      notifyCanvasViewportSync()
    },
    [activeCanvasId, bringToFront]
  )

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!isSupportedDrop(event.dataTransfer)) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsFileDragActive(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsFileDragActive(false)
    }
  }, [])

  const dropFile = useCallback(
    async (event: DragEvent) => {
      event.preventDefault()
      setIsFileDragActive(false)
      closeCreateMenu()

      const droppedFiles = await droppedFilesFromDataTransfer(event.dataTransfer)
      if (droppedFiles.length === 0) return

      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const plannedComponents = await Promise.all(
        droppedFiles.map(async (droppedFile, index) => {
          const type = typeForDroppedFile(droppedFile)

          return {
            type,
            position: droppedFilePosition(position, index),
            patch: await createDroppedFilePatch(droppedFile, type)
          }
        })
      )

      addComponents(plannedComponents)
      notifyCanvasViewportSync()
    },
    [addComponents, closeCreateMenu, reactFlow]
  )

  if (!canvas) {
    return <main className="canvas-empty" />
  }

  const backgroundImageStyle = canvas.background.image.src
    ? {
        backgroundImage: `url(${canvas.background.image.src})`,
        opacity: canvas.background.image.opacity,
        backgroundSize: canvas.background.image.fit,
        backgroundRepeat: canvas.background.image.fit === 'repeat' ? 'repeat' : 'no-repeat',
        backgroundAttachment: canvas.background.image.fixed ? 'fixed' : 'local'
      }
    : undefined

  return (
    <main className={`canvas-board${isFileDragActive ? ' canvas-board--file-drag-active' : ''}`} style={{ backgroundColor: canvas.background.color }}>
      {backgroundImageStyle ? <div className="canvas-background-image" style={backgroundImageStyle} /> : null}
      <ReactFlow
        className="canvas-flow"
        key={canvas.id}
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={openCreateMenuAtPointer}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={dropFile}
        defaultViewport={canvas.viewport}
        minZoom={0.15}
        maxZoom={2.4}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[canvas.background.grid.size, canvas.background.grid.size]}
        fitView={canvas.components.length === 0}
        style={{ backgroundColor: 'transparent' }}
        proOptions={{ hideAttribution: true }}
      >
        {canvas.background.grid.enabled ? (
          <Background
            color={`rgba(208,214,224,${canvas.background.grid.opacity})`}
            gap={canvas.background.grid.size}
            variant={
              canvas.background.grid.variant === 'lines'
                ? BackgroundVariant.Lines
                : canvas.background.grid.variant === 'cross'
                  ? BackgroundVariant.Cross
                  : BackgroundVariant.Dots
            }
          />
        ) : null}
        <CanvasMiniMap />
        <CanvasZoomControls hasNodes={canvas.components.length > 0} />
        <CanvasCreateMenu
          anchorRef={createMenuAnchorRef}
          open={Boolean(createMenu)}
          onClose={closeCreateMenu}
          onCreate={createComponentFromMenu}
        />
      </ReactFlow>
    </main>
  )
}
