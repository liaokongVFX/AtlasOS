import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeChange,
  type OnMoveEnd,
  useReactFlow
} from '@xyflow/react'
import { useCallback, useLayoutEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import type { CanvasComponent, ComponentType } from '@shared/schema'
import { useCanvasStore } from '../store/canvas-store'
import { ComponentNode, type AtlasFlowNode } from './component-node'

const nodeTypes = {
  atlasComponent: ComponentNode
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

export function CanvasBoard(): JSX.Element {
  const reactFlow = useReactFlow()
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvas = useCanvasStore((state) => (state.activeCanvasId ? state.canvases[state.activeCanvasId] : null))
  const updateCanvas = useCanvasStore((state) => state.updateCanvas)
  const updateComponent = useCanvasStore((state) => state.updateComponent)
  const addComponent = useCanvasStore((state) => state.addComponent)
  const bringToFront = useCanvasStore((state) => state.bringToFront)
  const persistedNodes = useMemo(() => (canvas ? canvas.components.map((component) => componentToNode(canvas.id, component)) : []), [canvas])
  const [nodes, setNodes] = useState<AtlasFlowNode[]>(persistedNodes)

  useLayoutEffect(() => {
    setNodes((currentNodes) => reconcileFlowNodes(persistedNodes, currentNodes))
  }, [persistedNodes])

  const onNodesChange = useCallback((changes: NodeChange<AtlasFlowNode>[]) => {
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
  }, [activeCanvasId, updateComponent])

  const onMoveEnd: OnMoveEnd = (_, viewport) => {
    if (!activeCanvasId) return
    updateCanvas(activeCanvasId, (draft) => {
      draft.viewport = viewport
    })
  }

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
        <Controls position="bottom-right" />
        <MiniMap pannable zoomable position="bottom-left" nodeStrokeWidth={3} />
        <div className="zoom-indicator">{Math.round(reactFlow.getZoom() * 100)}%</div>
      </ReactFlow>
    </main>
  )
}
