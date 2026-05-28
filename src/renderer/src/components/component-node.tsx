import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { NodeResizer, type Node, type NodeProps, type OnResize, type OnResizeEnd } from '@xyflow/react'
import type { CanvasComponent } from '@shared/schema'
import { cn } from '../lib/utils'
import { MEDIA_NODE_MIN_WIDTH } from '../lib/media-frame'
import { notifyCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { useCanvasStore } from '../store/canvas-store'
import { useI18n } from '../i18n'
import { ComponentErrorBoundary } from './component-error-boundary'
import { componentDefinitionTitle, getComponentDefinition, type NodeResizeParams } from './registry'

type AtlasNodeData = Record<string, unknown> & {
  canvasId: string
  component: CanvasComponent
  onRequestSelect?: (componentId: string) => void
}

export type AtlasFlowNode = Node<AtlasNodeData, 'atlasComponent'>

const DEFAULT_NODE_MIN_HEIGHT = 160
const SHIELD_CONTEXT_MENU_TRIGGER_SELECTOR = '[data-component-context-menu-trigger]'

function contextMenuPassthroughTarget(shield: HTMLElement, clientX: number, clientY: number): HTMLElement | null {
  const body = shield.parentElement
  if (!body) return null

  const elementsAtPoint = document.elementsFromPoint?.(clientX, clientY) ?? []
  const target = elementsAtPoint
    .filter((element) => element !== shield && body.contains(element) && !element.closest('.component-node__interaction-shield'))
    .map((element) => element.closest<HTMLElement>(SHIELD_CONTEXT_MENU_TRIGGER_SELECTOR))
    .find((element): element is HTMLElement => Boolean(element && body.contains(element)))
  if (target) return target

  const previousPointerEvents = shield.style.pointerEvents
  shield.style.pointerEvents = 'none'
  const fallbackTarget = document.elementFromPoint?.(clientX, clientY) ?? null
  shield.style.pointerEvents = previousPointerEvents

  const passthroughTarget = fallbackTarget?.closest<HTMLElement>(SHIELD_CONTEXT_MENU_TRIGGER_SELECTOR) ?? null
  return passthroughTarget && body.contains(passthroughTarget) ? passthroughTarget : null
}

function createForwardedContextMenuEvent(event: MouseEvent<HTMLElement>): globalThis.MouseEvent {
  return new globalThis.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    view: window,
    button: event.button,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  })
}

function ComponentNodeBase({ data, selected, dragging }: NodeProps<AtlasFlowNode>): JSX.Element {
  const { t } = useI18n()
  const { canvasId, component } = data
  const definition = getComponentDefinition(component.type)
  const defaultTitle = componentDefinitionTitle(definition, t)
  const updateComponent = useCanvasStore((state) => state.updateComponent)
  const [isResizing, setIsResizing] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(component.title)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const shouldCommitTitleEditRef = useRef(true)
  const resizeDirectionRef = useRef<readonly number[] | null>(null)
  const resizeBehavior = definition.getResizeBehavior?.(component) ?? null
  const nodeChromeVariant = definition.chrome?.variant
  const isTerminalChrome = nodeChromeVariant === 'terminal'
  const subtitle = definition.getSubtitle?.(component) ?? null

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
      draft.title = title.trim() || defaultTitle
    })
  }, [canvasId, component.id, defaultTitle, updateComponent])

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
    const resizeParams: NodeResizeParams = {
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height
    }
    const normalizedFrame = resizeBehavior?.normalizeFrame
      ? resizeBehavior.normalizeFrame(resizeParams, { component, direction: resizeDirectionRef.current })
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
  }, [canvasId, component, resizeBehavior, updateComponent])

  const markResizing = useCallback(() => {
    setIsResizing(true)
  }, [])

  const selectComponentForContextMenu = useCallback(() => {
    data.onRequestSelect?.(component.id)
  }, [component.id, data])

  const forwardShieldContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = contextMenuPassthroughTarget(event.currentTarget, event.clientX, event.clientY)
    if (!target) return

    event.preventDefault()
    event.stopPropagation()
    target.dispatchEvent(createForwardedContextMenuEvent(event))
  }, [])

  return (
    <section
      className={cn('component-node', selected && 'component-node--selected', isTerminalChrome && 'component-node--terminal')}
      style={{ zIndex: component.zIndex }}
      onContextMenuCapture={selectComponentForContextMenu}
    >
      <NodeResizer
        handleClassName="component-node__resize-handle"
        isVisible={selected}
        lineClassName="component-node__resize-line"
        minWidth={resizeBehavior?.minWidth ?? MEDIA_NODE_MIN_WIDTH}
        minHeight={resizeBehavior?.minHeight ?? DEFAULT_NODE_MIN_HEIGHT}
        keepAspectRatio={resizeBehavior?.keepAspectRatio ?? false}
        onResize={resizeBehavior?.keepAspectRatio ? trackResize : markResizing}
        onResizeEnd={persistResize}
      />
      <header className={cn('component-node__header', isTerminalChrome && 'component-node__header--terminal')}>
        <div className="component-node__title">
          <Icon size={16} />
          <div className={cn('component-node__title-stack', isTerminalChrome && 'component-node__title-stack--terminal')}>
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                className={cn('component-node__title-input nodrag', isTerminalChrome && 'component-node__title-input--terminal')}
                size={definition.chrome?.titleInputSize?.(draftTitle)}
                value={draftTitle}
                onBlur={commitTitleEdit}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={handleTitleKeyDown}
                aria-label={t('component.title')}
              />
            ) : (
              <span
                className={cn('component-node__title-display', isTerminalChrome && 'component-node__title-display--terminal')}
                title={component.title}
                onDoubleClick={beginTitleEdit}
              >
                {component.title}
              </span>
            )}
            {subtitle ? (
              <div className="component-node__subtitle component-node__subtitle--inline" title={subtitle}>
                {subtitle}
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
        {showInteractionShield ? (
          <div className="component-node__interaction-shield" aria-hidden="true" onContextMenu={forwardShieldContextMenu} />
        ) : null}
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
