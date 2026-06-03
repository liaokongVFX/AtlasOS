import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, UIOptions } from '@excalidraw/excalidraw/types'
import { Network } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, type FocusEvent } from 'react'
import { useI18n, type TFunction } from '../../i18n'
import type { AtlasComponentRendererProps } from '../registry'
import {
  createMindMapTemplateSkeletons,
  createSketchScene,
  getMindMapTemplateOrigin,
  normalizeSketchScene,
  sketchSceneFingerprint,
  sketchSceneToInitialData,
  SKETCH_THEME,
  SKETCH_VIEW_BACKGROUND,
  type MindMapTemplateText,
  type SketchScene
} from './sketch-model'

const SKETCH_SAVE_DELAY_MS = 450

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

function createMindMapText(t: TFunction): MindMapTemplateText {
  return {
    center: t('sketch.mindMap.center'),
    branches: [
      t('sketch.mindMap.context'),
      t('sketch.mindMap.plan'),
      t('sketch.mindMap.risks'),
      t('sketch.mindMap.nextSteps')
    ]
  }
}

export function SketchComponent({ component, updateState }: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const scene = useMemo(() => normalizeSketchScene(component.state.sketchScene), [component.state.sketchScene])
  const initialData = useMemo(() => sketchSceneToInitialData(scene), [scene])
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSceneRef = useRef<SketchScene>(scene)
  const savedFingerprintRef = useRef(sketchSceneFingerprint(scene))

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

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const nextFocusTarget = event.relatedTarget
      if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) return

      flushScene(true)
    },
    [flushScene]
  )

  const insertMindMapTemplate = useCallback(() => {
    const api = apiRef.current
    const existingElements = api?.getSceneElementsIncludingDeleted() ?? pendingSceneRef.current.elements
    const files = api?.getFiles() ?? pendingSceneRef.current.files
    const appState = api?.getAppState() ?? pendingSceneRef.current.appState
    const templateElements = convertToExcalidrawElements(
      createMindMapTemplateSkeletons(createMindMapText(t), getMindMapTemplateOrigin(existingElements)),
      { regenerateIds: true }
    )
    const nextElements = [...existingElements, ...templateElements]
    const sceneAppState: Pick<AppState, 'theme' | 'viewBackgroundColor'> = {
      theme: SKETCH_THEME,
      viewBackgroundColor: SKETCH_VIEW_BACKGROUND
    }

    api?.updateScene({
      elements: nextElements,
      appState: sceneAppState
    })
    queueSceneSave(createSketchScene(nextElements, appState, files), true)
  }, [queueSceneSave, t])

  return (
    <div className="sketch-module nodrag nowheel nopan" onBlurCapture={handleBlur}>
      <div className="sketch-toolbar">
        <button type="button" className="tool-button" onClick={insertMindMapTemplate} aria-label={t('sketch.insertMindMap')} title={t('sketch.insertMindMap')}>
          <Network size={14} />
          {t('sketch.insertMindMap')}
        </button>
      </div>
      <div className="sketch-editor">
        <Excalidraw
          initialData={initialData}
          excalidrawAPI={(api) => {
            apiRef.current = api
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
