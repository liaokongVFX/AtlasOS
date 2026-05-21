import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  type NodeChange,
  type OnMoveEnd,
  useReactFlow,
  useViewport
} from '@xyflow/react'
import { ChevronLeft, Map as MapIcon, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import type { CanvasComponent, ComponentType } from '@shared/schema'
import { notifyCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { useCanvasStore } from '../store/canvas-store'
import { ComponentNode, type AtlasFlowNode } from './component-node'

const nodeTypes = {
  atlasComponent: ComponentNode
}

const MINIMAP_PANEL_OFFSET = 15
const MINIMAP_WIDTH = 224
const MINIMAP_HEIGHT = 164
const MINIMAP_BUTTON_SIZE = 32
const MINIMAP_TOGGLE_INSET = 6

const MINIMAP_NODE_COLORS: Record<ComponentType, string> = {
  terminal: '#3fb950',
  'file-tree': '#58a6ff',
  browser: '#d29922',
  'markdown-note': '#a371f7',
  'file-preview': '#f778ba'
}

function getMiniMapNodeColor(node: AtlasFlowNode): string {
  return MINIMAP_NODE_COLORS[node.data.component.type]
}

function componentToNode(canvasId: string, component: CanvasComponent): AtlasFlowNode {
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
    data: { canvasId, component },
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

function typeForDroppedFile(name: string, kind: string): ComponentType {
  if (kind === 'directory') return 'file-tree'
  if (/\.(md|markdown)$/i.test(name)) return 'markdown-note'
  return 'file-preview'
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
          bgColor="rgba(13, 17, 23, 0.96)"
          maskColor="rgba(88, 166, 255, 0.18)"
          maskStrokeColor="rgba(88, 166, 255, 0.55)"
          maskStrokeWidth={1.25}
          nodeColor={getMiniMapNodeColor}
          nodeStrokeColor={() => 'rgba(255, 255, 255, 0.16)'}
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
  const bringToFront = useCanvasStore((state) => state.bringToFront)
  const persistedNodes = useMemo(
    () => (canvas ? canvas.components.map((component) => componentToNode(canvas.id, component)) : []),
    [canvas]
  )
  const [nodes, setNodes] = useState<AtlasFlowNode[]>(persistedNodes)

  useLayoutEffect(() => {
    setNodes((currentNodes) => reconcileFlowNodes(persistedNodes, currentNodes))
  }, [persistedNodes])

  const onNodesChange = useCallback(
    (changes: NodeChange<AtlasFlowNode>[]) => {
      setNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
      if (!activeCanvasId) return

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updateComponent(activeCanvasId, change.id, (component) => {
            component.frame.x = Math.round(change.position!.x)
            component.frame.y = Math.round(change.position!.y)
          })
        }

        if (change.type === 'dimensions' && change.dimensions) {
          updateComponent(activeCanvasId, change.id, (component) => {
            component.frame.width = Math.round(change.dimensions!.width)
            component.frame.height = Math.round(change.dimensions!.height)
          })
        }
      }
    },
    [activeCanvasId, updateComponent]
  )

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

  const createTerminalAtPointer = (event: MouseEvent) => {
    if (event.detail !== 2) return
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addComponent('terminal', { x: Math.round(position.x), y: Math.round(position.y) })
  }

  const dropFile = (event: DragEvent) => {
    event.preventDefault()
    const raw = event.dataTransfer.getData('application/atlas-file')
    if (!raw) return

    const dropped = JSON.parse(raw) as { path: string; name: string; kind: string; rootPath?: string }
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const type = typeForDroppedFile(dropped.name, dropped.kind)

    if (type === 'file-tree') {
      addComponent(type, position, {
        title: dropped.name,
        config: { rootPath: dropped.path },
        bindings: { rootPath: dropped.path, path: dropped.path }
      })
      return
    }

    addComponent(type, position, {
      title: dropped.name,
      bindings: { rootPath: dropped.rootPath ?? dropped.path, path: dropped.path },
      state: type === 'markdown-note' ? { content: '' } : {}
    })
  }

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
    <main className="canvas-board" style={{ backgroundColor: canvas.background.color }}>
      {backgroundImageStyle ? <div className="canvas-background-image" style={backgroundImageStyle} /> : null}
      <ReactFlow
        className="canvas-flow"
        key={canvas.id}
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => activeCanvasId && bringToFront(activeCanvasId, node.id)}
        onPaneClick={createTerminalAtPointer}
        onMoveEnd={onMoveEnd}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFile}
        defaultViewport={canvas.viewport}
        minZoom={0.15}
        maxZoom={2.4}
        snapToGrid
        snapGrid={[canvas.background.grid.size, canvas.background.grid.size]}
        fitView={canvas.components.length === 0}
        style={{ backgroundColor: 'transparent' }}
        proOptions={{ hideAttribution: true }}
      >
        {canvas.background.grid.enabled ? (
          <Background
            color={`rgba(255,255,255,${canvas.background.grid.opacity})`}
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
      </ReactFlow>
    </main>
  )
}
