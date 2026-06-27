import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'

export const SKETCH_SCENE_SCHEMA_VERSION = 1
export const SKETCH_VIEW_BACKGROUND = '#f8f9fa'
export const SKETCH_THEME = 'light'
export const SKETCH_DEFAULT_STROKE_COLOR = '#1e1e1e'

const RUNTIME_APP_STATE_KEYS = new Set([
  'activeEmbeddable',
  'collaborators',
  'contextMenu',
  'croppingElementId',
  'cursorButton',
  'draggingElement',
  'editingElement',
  'editingFrame',
  'editingGroupId',
  'editingLinearElement',
  'editingTextElement',
  'elementsToHighlight',
  'errorMessage',
  'frameToHighlight',
  'hoveredElementIds',
  'isCropping',
  'isDraggingScrollBar',
  'isLoading',
  'isRotating',
  'multiElement',
  'openDialog',
  'openMenu',
  'pendingImageElementId',
  'previousSelectedElementIds',
  'resizingElement',
  'selectedElementIds',
  'selectedElementsAreBeingDragged',
  'selectedGroupIds',
  'selectedLinearElement',
  'selectionElement',
  'snapLines',
  'startBoundElement',
  'suggestedBindings',
  'width',
  'height',
  'offsetLeft',
  'offsetTop'
])

export type SketchScene = {
  schemaVersion: typeof SKETCH_SCENE_SCHEMA_VERSION
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJsonValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? JSON.parse(serialized) : undefined
  } catch {
    return undefined
  }
}

function isPersistableValue(value: unknown): boolean {
  return typeof value !== 'function' && !(value instanceof Map) && !(value instanceof Set)
}

export function sanitizeSketchElements(elements: unknown): ExcalidrawElement[] {
  if (!Array.isArray(elements)) return []

  return elements
    .map((element) => cloneJsonValue(element))
    .filter((element): element is ExcalidrawElement => isRecord(element) && typeof element.type === 'string')
}

export function sanitizeSketchAppState(appState: unknown): Partial<AppState> {
  const nextAppState: Record<string, unknown> = {}

  if (isRecord(appState)) {
    for (const [key, value] of Object.entries(appState)) {
      if (RUNTIME_APP_STATE_KEYS.has(key) || !isPersistableValue(value)) continue

      const clonedValue = cloneJsonValue(value)
      if (typeof clonedValue === 'undefined') continue

      nextAppState[key] = clonedValue
    }
  }

  nextAppState.theme = SKETCH_THEME
  nextAppState.viewBackgroundColor = SKETCH_VIEW_BACKGROUND
  if (typeof nextAppState.currentItemStrokeColor !== 'string') {
    nextAppState.currentItemStrokeColor = SKETCH_DEFAULT_STROKE_COLOR
  }

  return nextAppState as Partial<AppState>
}

export function sanitizeSketchFiles(files: unknown): BinaryFiles {
  if (!isRecord(files)) return {}

  const nextFiles: BinaryFiles = {}
  for (const [fileId, file] of Object.entries(files)) {
    if (!isRecord(file) || typeof file.dataURL !== 'string') continue

    const clonedFile = cloneJsonValue(file)
    if (!isRecord(clonedFile) || typeof clonedFile.dataURL !== 'string') continue

    nextFiles[fileId] = clonedFile as BinaryFiles[string]
  }

  return nextFiles
}

export function createSketchScene(elements: unknown, appState: unknown, files: unknown): SketchScene {
  return {
    schemaVersion: SKETCH_SCENE_SCHEMA_VERSION,
    elements: sanitizeSketchElements(elements),
    appState: sanitizeSketchAppState(appState),
    files: sanitizeSketchFiles(files)
  }
}

export function normalizeSketchScene(value: unknown): SketchScene {
  if (!isRecord(value)) {
    return createSketchScene([], null, null)
  }

  return createSketchScene(value.elements, value.appState, value.files)
}

export function sketchSceneToInitialData(scene: SketchScene): ExcalidrawInitialDataState {
  return {
    elements: scene.elements,
    appState: {
      ...scene.appState,
      theme: SKETCH_THEME,
      viewBackgroundColor: SKETCH_VIEW_BACKGROUND,
      currentItemStrokeColor: typeof scene.appState.currentItemStrokeColor === 'string' ? scene.appState.currentItemStrokeColor : SKETCH_DEFAULT_STROKE_COLOR
    },
    files: scene.files
  }
}

export function sketchSceneFingerprint(scene: SketchScene): string {
  return JSON.stringify(scene)
}

export function sketchElementCount(scene: SketchScene): number {
  return scene.elements.filter((element) => !('isDeleted' in element) || !element.isDeleted).length
}

export function getSketchSearchTokens(scene: SketchScene): string[] {
  const textTokens = scene.elements
    .map((element) => ('text' in element && typeof element.text === 'string' ? element.text : null))
    .filter((text): text is string => Boolean(text?.trim()))

  return ['sketch', 'drawing', 'whiteboard', ...textTokens]
}
