import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { memo, useCallback, useState } from 'react'
import { NodeResizer, type Node, type NodeProps, type OnResizeEnd } from '@xyflow/react'
import { Copy, MoreHorizontal, Trash2 } from 'lucide-react'
import type { CanvasComponent } from '@shared/schema'
import { asString, cn } from '../lib/utils'
import { useCanvasStore } from '../store/canvas-store'
import { ComponentErrorBoundary } from './component-error-boundary'
import { componentRegistry } from './registry'

type AtlasNodeData = Record<string, unknown> & {
  canvasId: string
  component: CanvasComponent
}

export type AtlasFlowNode = Node<AtlasNodeData, 'atlasComponent'>

const NODE_SELECTION_RESIZER_COLOR = 'var(--component-node-selected-handle)'

function ComponentNodeBase({ data, selected, dragging }: NodeProps<AtlasFlowNode>): JSX.Element {
  const { canvasId, component } = data
  const definition = componentRegistry[component.type]
  const removeComponent = useCanvasStore((state) => state.removeComponent)
  const updateComponent = useCanvasStore((state) => state.updateComponent)
  const addComponent = useCanvasStore((state) => state.addComponent)
  const [isResizing, setIsResizing] = useState(false)
  const terminalPath = component.type === 'terminal' ? asString(component.state.cwd, asString(component.config.cwd)) : ''

  const Icon = definition.icon
  const Renderer = definition.Renderer
  const isCanvasInteracting = dragging || isResizing

  const updateConfig = useCallback((patch: Record<string, unknown>, immediate = false) => {
    updateComponent(
      canvasId,
      component.id,
      (draft) => {
        draft.config = { ...draft.config, ...patch }
      },
      immediate
    )
  }, [canvasId, component.id, updateComponent])

  const updateState = useCallback((patch: Record<string, unknown>, immediate = false) => {
    updateComponent(
      canvasId,
      component.id,
      (draft) => {
        draft.state = { ...draft.state, ...patch }
      },
      immediate
    )
  }, [canvasId, component.id, updateComponent])

  const setTitle = useCallback((title: string) => {
    updateComponent(canvasId, component.id, (draft) => {
      draft.title = title.trim() || definition.title
    })
  }, [canvasId, component.id, definition.title, updateComponent])

  const persistResize = useCallback<OnResizeEnd>((_, params) => {
    setIsResizing(false)
    updateComponent(canvasId, component.id, (draft) => {
      draft.frame.x = Math.round(params.x)
      draft.frame.y = Math.round(params.y)
      draft.frame.width = Math.round(params.width)
      draft.frame.height = Math.round(params.height)
    })
  }, [canvasId, component.id, updateComponent])

  const markResizing = useCallback(() => {
    setIsResizing(true)
  }, [])

  return (
    <section
      className={cn('component-node', selected && 'component-node--selected', component.type === 'terminal' && 'component-node--terminal')}
      style={{ zIndex: component.zIndex }}
    >
      <NodeResizer
        color={NODE_SELECTION_RESIZER_COLOR}
        handleClassName="component-node__resize-handle"
        isVisible={selected}
        lineClassName="component-node__resize-line"
        minWidth={220}
        minHeight={160}
        onResize={markResizing}
        onResizeEnd={persistResize}
      />
      <header className={cn('component-node__header', component.type === 'terminal' && 'component-node__header--terminal')}>
        <div className="component-node__title">
          <Icon size={16} />
          <div className={cn('component-node__title-stack', component.type === 'terminal' && 'component-node__title-stack--terminal')}>
            <input
              className={cn(component.type === 'terminal' && 'component-node__title-input--terminal')}
              size={component.type === 'terminal' ? Math.max(8, component.title.length) : undefined}
              value={component.title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Component title"
            />
            {component.type === 'terminal' && terminalPath ? (
              <div className="component-node__subtitle component-node__subtitle--inline" title={terminalPath}>
                {terminalPath}
              </div>
            ) : null}
          </div>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className={cn('icon-button nodrag', component.type === 'terminal' && 'component-node__action--ghost')} aria-label="Component actions">
            <MoreHorizontal size={16} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="menu-content" sideOffset={6}>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={() =>
                addComponent(component.type, { x: component.frame.x + 32, y: component.frame.y + 32 }, {
                  config: component.config,
                  state: component.type === 'browser' ? {} : component.state,
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
      <div className={cn('component-node__body nodrag', selected && 'nowheel')}>
        <ComponentErrorBoundary>
          <Renderer
            canvasId={canvasId}
            component={component}
            updateConfig={updateConfig}
            updateState={updateState}
            setTitle={setTitle}
            isCanvasInteracting={isCanvasInteracting}
            isNodeSelected={selected}
          />
        </ComponentErrorBoundary>
        {!selected ? <div className="component-node__interaction-shield nodrag" aria-hidden="true" /> : null}
      </div>
    </section>
  )
}

function areNodePropsEqual(previous: NodeProps<AtlasFlowNode>, next: NodeProps<AtlasFlowNode>): boolean {
  return (
    previous.data === next.data &&
    previous.selected === next.selected &&
    previous.dragging === next.dragging &&
    previous.width === next.width &&
    previous.height === next.height
  )
}

export const ComponentNode = memo(ComponentNodeBase, areNodePropsEqual)
