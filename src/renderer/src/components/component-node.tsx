import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { Copy, MoreHorizontal, Trash2 } from 'lucide-react'
import type { CanvasComponent } from '@shared/schema'
import { cn } from '../lib/utils'
import { useCanvasStore } from '../store/canvas-store'
import { ComponentErrorBoundary } from './component-error-boundary'
import { componentRegistry } from './registry'

type AtlasNodeData = Record<string, unknown> & {
  canvasId: string
  component: CanvasComponent
}

export type AtlasFlowNode = Node<AtlasNodeData, 'atlasComponent'>

export function ComponentNode({ data, selected }: NodeProps<AtlasFlowNode>): JSX.Element {
  const { canvasId, component } = data
  const definition = componentRegistry[component.type]
  const removeComponent = useCanvasStore((state) => state.removeComponent)
  const updateComponent = useCanvasStore((state) => state.updateComponent)
  const addComponent = useCanvasStore((state) => state.addComponent)

  const Icon = definition.icon
  const Renderer = definition.Renderer

  const updateConfig = (patch: Record<string, unknown>, immediate = false) => {
    updateComponent(
      canvasId,
      component.id,
      (draft) => {
        draft.config = { ...draft.config, ...patch }
      },
      immediate
    )
  }

  const updateState = (patch: Record<string, unknown>, immediate = false) => {
    updateComponent(
      canvasId,
      component.id,
      (draft) => {
        draft.state = { ...draft.state, ...patch }
      },
      immediate
    )
  }

  const setTitle = (title: string) => {
    updateComponent(canvasId, component.id, (draft) => {
      draft.title = title.trim() || definition.title
    })
  }

  return (
    <section className={cn('component-node', selected && 'component-node--selected')} style={{ zIndex: component.zIndex }}>
      <NodeResizer color="#58a6ff" isVisible={selected} minWidth={220} minHeight={160} />
      <header className="component-node__header">
        <div className="component-node__title">
          <Icon size={16} />
          <input value={component.title} onChange={(event) => setTitle(event.target.value)} aria-label="Component title" />
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="icon-button nodrag" aria-label="Component actions">
            <MoreHorizontal size={16} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="menu-content" sideOffset={6}>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={() =>
                addComponent(component.type, { x: component.frame.x + 32, y: component.frame.y + 32 }, {
                  config: component.config,
                  state: component.type === 'terminal' || component.type === 'browser' ? {} : component.state,
                  bindings: component.bindings
                })
              }
            >
              <Copy size={14} />
              Duplicate
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item menu-item--danger" onSelect={() => removeComponent(canvasId, component.id)}>
              <Trash2 size={14} />
              Remove
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </header>
      <div className="component-node__body nodrag">
        <ComponentErrorBoundary>
          <Renderer
            canvasId={canvasId}
            component={component}
            updateConfig={updateConfig}
            updateState={updateState}
            setTitle={setTitle}
          />
        </ComponentErrorBoundary>
      </div>
    </section>
  )
}
