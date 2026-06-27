import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, UIOptions } from '@excalidraw/excalidraw/types'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type FocusEvent } from 'react'
import { subscribeCanvasViewportSync } from '../../lib/canvas-viewport-sync'
import { CaptureUpdateAction, Excalidraw } from '../../lib/excalidraw'
import type { AtlasComponentRendererProps } from '../registry'
import {
  createSketchScene,
  normalizeSketchScene,
  sketchSceneFingerprint,
  sketchSceneToInitialData,
  SKETCH_THEME,
  SKETCH_VIEW_BACKGROUND,
  type SketchScene
} from './sketch-model'

const SKETCH_SAVE_DELAY_MS = 450
const SKETCH_CANVAS_SELECTOR = '.excalidraw__canvas'
const SKETCH_CANVAS_ZOOM_EPSILON = 0.001
const SKETCH_POINTER_EVENT_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'] as const
const SKETCH_SVG_LAYER_OFFSET_X_PROPERTY = '--sketch-excalidraw-svg-offset-x'
const SKETCH_SVG_LAYER_OFFSET_Y_PROPERTY = '--sketch-excalidraw-svg-offset-y'
const patchedSketchPointerEvents = new WeakSet<MouseEvent>()

const SKETCH_UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    export: false,
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
    toggleTheme: false
  }
} satisfies Partial<UIOptions>

type SketchRuntimeViewportAppState = Pick<AppState, 'width' | 'height' | 'offsetLeft' | 'offsetTop'>

function normalizeCanvasZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}

function nearlyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) < SKETCH_CANVAS_ZOOM_EPSILON
}

function isSketchCanvasEventTarget(target: EventTarget | null, editor: HTMLElement): boolean {
  return target instanceof Element && editor.contains(target) && Boolean(target.closest(SKETCH_CANVAS_SELECTOR))
}

function getMousePointerId(event: MouseEvent): number | null {
  const pointerId = (event as Partial<PointerEvent>).pointerId
  return typeof pointerId === 'number' ? pointerId : null
}

function getSketchRuntimeViewportAppState(editor: HTMLElement, canvasZoom: number): SketchRuntimeViewportAppState | null {
  const normalizedZoom = normalizeCanvasZoom(canvasZoom)
  const rect = editor.getBoundingClientRect()
  const width = editor.clientWidth || rect.width / normalizedZoom
  const height = editor.clientHeight || rect.height / normalizedZoom

  if (width <= 0 || height <= 0) return null

  return {
    width,
    height,
    offsetLeft: rect.left,
    offsetTop: rect.top
  }
}

function patchMouseEventClientCoordinates(event: MouseEvent, editor: HTMLElement, canvasZoom: number): void {
  const normalizedZoom = normalizeCanvasZoom(canvasZoom)
  if (nearlyEqual(normalizedZoom, 1) || patchedSketchPointerEvents.has(event)) return

  // React Flow zooms nodes with CSS transforms; Excalidraw needs unscaled scene coordinates.
  const rect = editor.getBoundingClientRect()
  const clientX = rect.left + (event.clientX - rect.left) / normalizedZoom
  const clientY = rect.top + (event.clientY - rect.top) / normalizedZoom

  try {
    Object.defineProperties(event, {
      clientX: { configurable: true, value: clientX },
      clientY: { configurable: true, value: clientY },
      x: { configurable: true, value: clientX },
      y: { configurable: true, value: clientY },
      pageX: { configurable: true, value: clientX + window.scrollX },
      pageY: { configurable: true, value: clientY + window.scrollY }
    })
    patchedSketchPointerEvents.add(event)
  } catch {
    // Some browser event implementations make coordinates non-configurable.
  }
}

function syncSketchSvgLayerOffset(editor: HTMLElement, runtimeViewport: SketchRuntimeViewportAppState): void {
  editor.style.setProperty(SKETCH_SVG_LAYER_OFFSET_X_PROPERTY, `${-runtimeViewport.offsetLeft}px`)
  editor.style.setProperty(SKETCH_SVG_LAYER_OFFSET_Y_PROPERTY, `${-runtimeViewport.offsetTop}px`)
}

export function SketchComponent({ canvasZoom = 1, component, updateState }: AtlasComponentRendererProps): JSX.Element {
  const scene = useMemo(() => normalizeSketchScene(component.state.sketchScene), [component.state.sketchScene])
  const initialData = useMemo(() => sketchSceneToInitialData(scene), [scene])
  const editorRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const canvasZoomRef = useRef(normalizeCanvasZoom(canvasZoom))
  const viewportSyncFrameRef = useRef<number | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSceneRef = useRef<SketchScene>(scene)
  const savedFingerprintRef = useRef(sketchSceneFingerprint(scene))

  useEffect(() => {
    canvasZoomRef.current = normalizeCanvasZoom(canvasZoom)
  }, [canvasZoom])

  useEffect(() => {
    const nextFingerprint = sketchSceneFingerprint(scene)
    if (saveTimerRef.current || nextFingerprint === savedFingerprintRef.current) return

    pendingSceneRef.current = scene
    savedFingerprintRef.current = nextFingerprint
  }, [scene])

  const flushScene = useCallback(
    (immediate = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }

      const nextScene = pendingSceneRef.current
      const nextFingerprint = sketchSceneFingerprint(nextScene)
      if (nextFingerprint === savedFingerprintRef.current) return

      savedFingerprintRef.current = nextFingerprint
      updateState({ sketchScene: nextScene }, immediate)
    },
    [updateState]
  )

  const queueSceneSave = useCallback(
    (nextScene: SketchScene, immediate = false) => {
      pendingSceneRef.current = nextScene

      if (immediate) {
        flushScene(true)
        return
      }

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => flushScene(false), SKETCH_SAVE_DELAY_MS)
    },
    [flushScene]
  )

  useEffect(() => () => flushScene(true), [flushScene])

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      queueSceneSave(createSketchScene(elements, appState, files))
    },
    [queueSceneSave]
  )

  const syncSketchViewport = useCallback(() => {
    const editor = editorRef.current
    const api = apiRef.current
    if (!editor || !api) return

    const runtimeViewport = getSketchRuntimeViewportAppState(editor, canvasZoomRef.current)
    if (!runtimeViewport) return

    syncSketchSvgLayerOffset(editor, runtimeViewport)

    const appState = api.getAppState()
    if (
      nearlyEqual(appState.width, runtimeViewport.width) &&
      nearlyEqual(appState.height, runtimeViewport.height) &&
      nearlyEqual(appState.offsetLeft, runtimeViewport.offsetLeft) &&
      nearlyEqual(appState.offsetTop, runtimeViewport.offsetTop)
    ) {
      return
    }

    api.updateScene({
      appState: runtimeViewport,
      captureUpdate: CaptureUpdateAction.NEVER
    })
  }, [])

  const scheduleSketchViewportSync = useCallback(() => {
    if (viewportSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportSyncFrameRef.current)
    }

    viewportSyncFrameRef.current = window.requestAnimationFrame(() => {
      viewportSyncFrameRef.current = null
      syncSketchViewport()
    })
  }, [syncSketchViewport])

  useLayoutEffect(() => {
    scheduleSketchViewportSync()

    return () => {
      if (viewportSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportSyncFrameRef.current)
        viewportSyncFrameRef.current = null
      }
    }
  }, [canvasZoom, component.frame.height, component.frame.width, scheduleSketchViewportSync])

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(scheduleSketchViewportSync)
    observer.observe(editor)

    return () => observer.disconnect()
  }, [scheduleSketchViewportSync])

  useEffect(
    () =>
      subscribeCanvasViewportSync((viewport) => {
        if (viewport && typeof viewport.zoom === 'number') {
          canvasZoomRef.current = normalizeCanvasZoom(viewport.zoom)
        }
        scheduleSketchViewportSync()
      }),
    [scheduleSketchViewportSync]
  )

  useEffect(() => {
    window.addEventListener('resize', scheduleSketchViewportSync)
    return () => window.removeEventListener('resize', scheduleSketchViewportSync)
  }, [scheduleSketchViewportSync])

  useEffect(() => {
    const activePointerIds = new Set<number>()
    let isMouseGestureActive = false

    const handlePointerEvent = (event: Event) => {
      const editor = editorRef.current
      if (!editor || !(event instanceof MouseEvent)) return

      const targetIsSketchCanvas = isSketchCanvasEventTarget(event.target, editor)
      const pointerId = getMousePointerId(event)
      const isTrackedPointer = pointerId === null ? isMouseGestureActive : activePointerIds.has(pointerId)

      if (event.type === 'pointerdown' && targetIsSketchCanvas && pointerId !== null) {
        activePointerIds.add(pointerId)
      }
      if (event.type === 'mousedown' && targetIsSketchCanvas) {
        isMouseGestureActive = true
      }

      if (targetIsSketchCanvas || isTrackedPointer) {
        patchMouseEventClientCoordinates(event, editor, canvasZoomRef.current)
      }

      if ((event.type === 'pointerup' || event.type === 'pointercancel') && pointerId !== null) {
        activePointerIds.delete(pointerId)
      }
      if (event.type === 'mouseup') {
        isMouseGestureActive = false
      }
    }

    for (const eventType of SKETCH_POINTER_EVENT_TYPES) {
      window.addEventListener(eventType, handlePointerEvent, true)
    }

    return () => {
      for (const eventType of SKETCH_POINTER_EVENT_TYPES) {
        window.removeEventListener(eventType, handlePointerEvent, true)
      }
    }
  }, [])

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const nextFocusTarget = event.relatedTarget
      if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) return

      flushScene(true)
    },
    [flushScene]
  )

  return (
    <div className="sketch-module nodrag nowheel nopan" onBlurCapture={handleBlur}>
      <div ref={editorRef} className="sketch-editor">
        <Excalidraw
          initialData={initialData}
          excalidrawAPI={(api) => {
            apiRef.current = api
            scheduleSketchViewportSync()
          }}
          onChange={handleChange}
          theme={SKETCH_THEME}
          name={component.title}
          UIOptions={SKETCH_UI_OPTIONS}
          handleKeyboardGlobally={false}
          autoFocus={false}
          detectScroll={false}
        />
      </div>
    </div>
  )
}
