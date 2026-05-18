import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import type { AtlasAppState, CanvasComponent, CanvasDocument, ComponentType, Frame } from '@shared/schema'
import { COMPONENT_DEFINITIONS } from '../components/component-definitions'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type CanvasStore = {
  appState: AtlasAppState | null
  canvases: Record<string, CanvasDocument>
  activeCanvasId: string | null
  saveState: SaveState
  error: string | null
  load: () => Promise<void>
  createCanvas: () => Promise<void>
  setActiveCanvas: (canvasId: string) => Promise<void>
  deleteCanvas: (canvasId: string) => Promise<void>
  saveCanvasNow: (canvasId: string) => Promise<void>
  updateCanvas: (canvasId: string, updater: (canvas: CanvasDocument) => void, immediate?: boolean) => void
  addComponent: (type: ComponentType, position?: { x: number; y: number }, patch?: Partial<CanvasComponent>) => void
  updateComponent: (canvasId: string, componentId: string, updater: (component: CanvasComponent) => void, immediate?: boolean) => void
  removeComponent: (canvasId: string, componentId: string) => void
  bringToFront: (canvasId: string, componentId: string) => void
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function nowIso(): string {
  return new Date().toISOString()
}

function createFallbackCanvas(): CanvasDocument {
  const timestamp = nowIso()
  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    id: nanoid(),
    name: 'Home',
    viewport: { ...DEFAULT_VIEWPORT },
    background: {
      color: DEFAULT_CANVAS_BACKGROUND.color,
      grid: { ...DEFAULT_CANVAS_BACKGROUND.grid },
      image: { ...DEFAULT_CANVAS_BACKGROUND.image }
    },
    components: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function nextZIndex(canvas: CanvasDocument): number {
  return canvas.components.reduce((max, component) => Math.max(max, component.zIndex), 0) + 1
}

function createComponent(type: ComponentType, canvas: CanvasDocument, position?: { x: number; y: number }, patch?: Partial<CanvasComponent>): CanvasComponent {
  const definition = COMPONENT_DEFINITIONS[type]
  const timestamp = nowIso()
  const frame: Frame = {
    ...definition.defaultFrame,
    x: position?.x ?? definition.defaultFrame.x,
    y: position?.y ?? definition.defaultFrame.y
  }

  const base: CanvasComponent = {
    id: nanoid(),
    type,
    title: definition.title,
    frame,
    zIndex: nextZIndex(canvas),
    config: {},
    state: {},
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  return {
    ...base,
    ...patch,
    frame: { ...base.frame, ...patch?.frame },
    config: { ...base.config, ...patch?.config },
    state: { ...base.state, ...patch?.state },
    bindings: { ...base.bindings, ...patch?.bindings }
  }
}

export const useCanvasStore = create<CanvasStore>()(
  immer((set, get) => ({
    appState: null,
    canvases: {},
    activeCanvasId: null,
    saveState: 'idle',
    error: null,

    async load() {
      try {
        const [appState, canvases] = await Promise.all([window.atlas.appState.get(), window.atlas.canvas.list()])
        const canvasMap = Object.fromEntries(canvases.map((canvas) => [canvas.id, canvas]))

        if (canvases.length === 0) {
          const fallback = createFallbackCanvas()
          set({
            appState: {
              schemaVersion: ATLAS_SCHEMA_VERSION,
              activeCanvasId: fallback.id,
              canvasOrder: [fallback.id],
              createdAt: fallback.createdAt,
              updatedAt: fallback.updatedAt
            },
            canvases: { [fallback.id]: fallback },
            activeCanvasId: fallback.id,
            saveState: 'idle',
            error: null
          })
          return
        }

        set({
          appState,
          canvases: canvasMap,
          activeCanvasId: appState.activeCanvasId ?? canvases[0]?.id ?? null,
          saveState: 'idle',
          error: null
        })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Failed to load workspace' })
      }
    },

    async createCanvas() {
      const result = await window.atlas.canvas.create()
      set((state) => {
        state.appState = result.appState
        state.canvases[result.canvas.id] = result.canvas
        state.activeCanvasId = result.canvas.id
      })
    },

    async setActiveCanvas(canvasId) {
      const appState = await window.atlas.canvas.setActive(canvasId)
      set((state) => {
        state.appState = appState
        state.activeCanvasId = canvasId
      })
    },

    async deleteCanvas(canvasId) {
      const appState = await window.atlas.canvas.delete(canvasId)
      const canvases = await window.atlas.canvas.list()
      set((state) => {
        state.appState = appState
        state.canvases = Object.fromEntries(canvases.map((canvas) => [canvas.id, canvas]))
        state.activeCanvasId = appState.activeCanvasId
      })
    },

    async saveCanvasNow(canvasId) {
      const canvas = get().canvases[canvasId]
      if (!canvas) return

      if (saveTimers.has(canvasId)) {
        clearTimeout(saveTimers.get(canvasId))
        saveTimers.delete(canvasId)
      }

      set({ saveState: 'saving' })
      try {
        const saved = await window.atlas.canvas.save(canvas)
        set((state) => {
          state.canvases[canvasId] = saved
          state.saveState = 'saved'
          state.error = null
        })
      } catch (error) {
        set({
          saveState: 'error',
          error: error instanceof Error ? error.message : 'Failed to save canvas'
        })
      }
    },

    updateCanvas(canvasId, updater, immediate = false) {
      set((state) => {
        const canvas = state.canvases[canvasId]
        if (!canvas) return
        updater(canvas)
        canvas.updatedAt = nowIso()
      })

      if (immediate) {
        void get().saveCanvasNow(canvasId)
        return
      }

      if (saveTimers.has(canvasId)) clearTimeout(saveTimers.get(canvasId))
      saveTimers.set(
        canvasId,
        setTimeout(() => {
          void get().saveCanvasNow(canvasId)
        }, 500)
      )
    },

    addComponent(type, position, patch) {
      const canvasId = get().activeCanvasId
      if (!canvasId) return
      get().updateCanvas(
        canvasId,
        (canvas) => {
          canvas.components.push(createComponent(type, canvas, position, patch))
        },
        true
      )
    },

    updateComponent(canvasId, componentId, updater, immediate = false) {
      get().updateCanvas(
        canvasId,
        (canvas) => {
          const component = canvas.components.find((item) => item.id === componentId)
          if (!component) return
          updater(component)
          component.updatedAt = nowIso()
        },
        immediate
      )
    },

    removeComponent(canvasId, componentId) {
      get().updateCanvas(
        canvasId,
        (canvas) => {
          canvas.components = canvas.components.filter((component) => component.id !== componentId)
        },
        true
      )
    },

    bringToFront(canvasId, componentId) {
      get().updateComponent(canvasId, componentId, (component) => {
        const canvas = get().canvases[canvasId]
        if (canvas) component.zIndex = nextZIndex(canvas)
      })
    }
  }))
)
