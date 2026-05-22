import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { NodeResizer, type Node, type NodeProps, type OnResize, type OnResizeEnd } from '@xyflow/react'
import type { CanvasComponent } from '@shared/schema'
import { asString, cn } from '../lib/utils'
import { getFilePreviewKind } from '../lib/file-types'
import {
  fitMediaFrameToAspectRatio,
  mediaAspectRatioFromConfig,
  mediaAspectRatioFromFrame,
  MEDIA_NODE_MIN_WIDTH,
  normalizeMediaResizeFrame
} from '../lib/media-frame'
import { notifyCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { useCanvasStore } from '../store/canvas-store'
import { ComponentErrorBoundary } from './component-error-boundary'
import { componentRegistry } from './registry'

type AtlasNodeData = Record<string, unknown> & {
  canvasId: string
  component: CanvasComponent
  onRequestSelect?: (componentId: string) => void
}

export type AtlasFlowNode = Node<AtlasNodeData, 'atlasComponent'>

const NODE_SELECTION_RESIZER_COLOR = 'var(--component-node-selected-handle)'
const DEFAULT_NODE_MIN_HEIGHT = 160

function ComponentNodeBase({ data, selected, dragging }: NodeProps<AtlasFlowNode>): JSX.Element {
  const { canvasId, component } = data
  const definition = componentRegistry[component.type]
  const updateComponent = useCanvasStore((state) => state.updateComponent)
  const [isResizing, setIsResizing] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(component.title)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const shouldCommitTitleEditRef = useRef(true)
  const resizeDirectionRef = useRef<readonly number[] | null>(null)
  const terminalPath = component.type === 'terminal' ? asString(component.state.cwd, asString(component.config.cwd)) : ''
  const previewKind =
    component.type === 'file-preview' ? getFilePreviewKind(asString(component.bindings.path), asString(component.config.mimeType)) : null
  const isMediaPreview = previewKind === 'image' || previewKind === 'video'
  const mediaAspectRatio = isMediaPreview ? (mediaAspectRatioFromConfig(component.config) ?? mediaAspectRatioFromFrame(component.frame)) : null

  const Icon = definition.icon
  const Renderer = definition.Renderer
  const isCanvasInteracting = dragging || isResizing
  const showInteractionShield = !selected

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

  const updateFrame = useCallback((patch: Partial<CanvasComponent['frame']>, immediate = false) => {
    updateComponent(
      canvasId,
      component.id,
      (draft) => {
        draft.frame = { ...draft.frame, ...patch }
      },
      immediate
    )
  }, [canvasId, component.id, updateComponent])

  const setTitle = useCallback((title: string) => {
    updateComponent(canvasId, component.id, (draft) => {
      draft.title = title.trim() || definition.title
    })
  }, [canvasId, component.id, definition.title, updateComponent])

  useEffect(() => {
    if (!isEditingTitle) setDraftTitle(component.title)
  }, [component.title, isEditingTitle])

  useEffect(() => {
    if (!isEditingTitle) return undefined

    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isEditingTitle])

  const beginTitleEdit = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    shouldCommitTitleEditRef.current = true
    setDraftTitle(component.title)
    setIsEditingTitle(true)
  }, [component.title])

  const commitTitleEdit = useCallback(() => {
    if (!shouldCommitTitleEditRef.current) {
      shouldCommitTitleEditRef.current = true
      return
    }

    setIsEditingTitle(false)
    setTitle(draftTitle)
  }, [draftTitle, setTitle])

  const cancelTitleEdit = useCallback(() => {
    shouldCommitTitleEditRef.current = false
    setDraftTitle(component.title)
    setIsEditingTitle(false)
  }, [component.title])

  const handleTitleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return

    if (event.key === 'Enter') {
      event.preventDefault()
      commitTitleEdit()
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelTitleEdit()
    }
  }, [cancelTitleEdit, commitTitleEdit])

  const trackResize = useCallback<OnResize>((_, params) => {
    resizeDirectionRef.current = params.direction
    setIsResizing(true)
  }, [])

  const persistResize = useCallback<OnResizeEnd>((_, params) => {
    setIsResizing(false)
    const normalizedFrame =
      mediaAspectRatio && isMediaPreview
        ? normalizeMediaResizeFrame(params, mediaAspectRatio, resizeDirectionRef.current)
        : {
            x: Math.round(params.x),
            y: Math.round(params.y),
            width: Math.round(params.width),
            height: Math.round(params.height)
          }

    resizeDirectionRef.current = null
    updateComponent(canvasId, component.id, (draft) => {
      draft.frame = normalizedFrame
    })
    notifyCanvasViewportSync()
  }, [canvasId, component.id, isMediaPreview, mediaAspectRatio, updateComponent])

  const markResizing = useCallback(() => {
    setIsResizing(true)
  }, [])

  const selectComponentForContextMenu = useCallback(() => {
    data.onRequestSelect?.(component.id)
  }, [component.id, data])

  return (
    <section
      className={cn('component-node', selected && 'component-node--selected', component.type === 'terminal' && 'component-node--terminal')}
      style={{ zIndex: component.zIndex }}
      onContextMenuCapture={selectComponentForContextMenu}
    >
      <NodeResizer
        color={NODE_SELECTION_RESIZER_COLOR}
        handleClassName="component-node__resize-handle"
        isVisible={selected}
        lineClassName="component-node__resize-line"
        minWidth={MEDIA_NODE_MIN_WIDTH}
        minHeight={
          isMediaPreview && mediaAspectRatio
            ? fitMediaFrameToAspectRatio(component.frame, mediaAspectRatio, MEDIA_NODE_MIN_WIDTH).height
            : DEFAULT_NODE_MIN_HEIGHT
        }
        keepAspectRatio={isMediaPreview}
        onResize={isMediaPreview ? trackResize : markResizing}
        onResizeEnd={persistResize}
      />
      <header className={cn('component-node__header', component.type === 'terminal' && 'component-node__header--terminal')}>
        <div className="component-node__title">
          <Icon size={16} />
          <div className={cn('component-node__title-stack', component.type === 'terminal' && 'component-node__title-stack--terminal')}>
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                className={cn('component-node__title-input nodrag', component.type === 'terminal' && 'component-node__title-input--terminal')}
                size={component.type === 'terminal' ? Math.max(8, draftTitle.length) : undefined}
                value={draftTitle}
                onBlur={commitTitleEdit}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={handleTitleKeyDown}
                aria-label="Component title"
              />
            ) : (
              <span
                className={cn('component-node__title-display', component.type === 'terminal' && 'component-node__title-display--terminal')}
                title={component.title}
                onDoubleClick={beginTitleEdit}
              >
                {component.title}
              </span>
            )}
            {component.type === 'terminal' && terminalPath ? (
              <div className="component-node__subtitle component-node__subtitle--inline" title={terminalPath}>
                {terminalPath}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <div className={cn('component-node__body', selected && 'nodrag nowheel')}>
        <ComponentErrorBoundary>
          <Renderer
            canvasId={canvasId}
            component={component}
            updateConfig={updateConfig}
            updateState={updateState}
            updateFrame={updateFrame}
            setTitle={setTitle}
            isCanvasInteracting={isCanvasInteracting}
            isNodeSelected={selected}
          />
        </ComponentErrorBoundary>
        {showInteractionShield ? <div className="component-node__interaction-shield" aria-hidden="true" /> : null}
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
