import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import type { AtlasAppState, CanvasComponent, CanvasDocument, ComponentType, Frame } from '@shared/schema'
import {
  componentDefinitionTitle,
  getComponentDefinition,
  type ComponentCreateInput,
  type ComponentCreatePatch
} from '../components/registry'
import { translateCurrent } from '../i18n'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type ComponentFrameUpdate = {
  componentId: string
  frame: Partial<Frame>
}

type CanvasStore = {
  appState: AtlasAppState | null
  canvases: Record<string, CanvasDocument>
  activeCanvasId: string | null
  saveState: SaveState
  error: string | null
  load: () => Promise<void>
  createCanvas: () => Promise<void>
  setActiveCanvas: (canvasId: string) => Promise<void>
  reorderCanvases: (canvasOrder: string[]) => Promise<void>
  renameCanvas: (canvasId: string, name: string) => void
  deleteCanvas: (canvasId: string) => Promise<void>
  saveCanvasNow: (canvasId: string) => Promise<void>
  updateCanvas: (canvasId: string, updater: (canvas: CanvasDocument) => void, immediate?: boolean) => void
  addComponent: (type: ComponentType, position?: { x: number; y: number }, patch?: ComponentCreatePatch) => void
  addComponents: (components: ComponentCreateInput[]) => void
  duplicateComponents: (canvasId: string, componentIds: string[]) => string[]
  updateComponent: (canvasId: string, componentId: string, updater: (component: CanvasComponent) => void, immediate?: boolean) => void
  updateComponentFrames: (canvasId: string, updates: ComponentFrameUpdate[], immediate?: boolean) => void
  removeComponent: (canvasId: string, componentId: string) => void
  removeComponents: (canvasId: string, componentIds: string[]) => void
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
    name: translateCurrent('canvas.homeName'),
    viewport: { ...DEFAULT_VIEWPORT },
    background: {
      color: DEFAULT_CANVAS_BACKGROUND.color,
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

function cloneRecord<T extends Record<string, unknown>>(record: T): T {
  try {
    return structuredClone(record) as T
  } catch {
    return JSON.parse(JSON.stringify(record)) as T
  }
}

function hasPatchKey<TKey extends keyof ComponentCreatePatch>(patch: ComponentCreatePatch | undefined, key: TKey): patch is ComponentCreatePatch & Required<Pick<ComponentCreatePatch, TKey>> {
  return Boolean(patch && Object.prototype.hasOwnProperty.call(patch, key))
}

function mergeComponentPatch(first?: ComponentCreatePatch | null, second?: ComponentCreatePatch | null): ComponentCreatePatch | undefined {
  if (!first && !second) return undefined

  return {
    ...first,
    ...second,
    frame: { ...first?.frame, ...second?.frame },
    config: { ...first?.config, ...second?.config },
    state: { ...first?.state, ...second?.state },
    bindings: { ...first?.bindings, ...second?.bindings }
  }
}

function createComponent(type: ComponentType, canvas: CanvasDocument, position?: { x: number; y: number }, patch?: ComponentCreatePatch): CanvasComponent {
  const definition = getComponentDefinition(type)
  const createPatch = mergeComponentPatch(definition.create?.(), patch)
  const timestamp = nowIso()
  const frame: Frame = {
    ...definition.defaultFrame,
    x: position?.x ?? definition.defaultFrame.x,
    y: position?.y ?? definition.defaultFrame.y
  }

  const base: CanvasComponent = {
    id: nanoid(),
    type,
    title: componentDefinitionTitle(definition),
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
    ...createPatch,
    frame: { ...base.frame, ...createPatch?.frame },
    config: { ...base.config, ...createPatch?.config },
    state: { ...base.state, ...createPatch?.state },
    bindings: { ...base.bindings, ...createPatch?.bindings }
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
        set({ error: error instanceof Error ? error.message : translateCurrent('app.error.loadWorkspace') })
      }
    },

    async createCanvas() {
      const index = (get().appState?.canvasOrder.length ?? Object.keys(get().canvases).length) + 1
      const result = await window.atlas.canvas.create(translateCurrent('canvas.newCanvasName', { index }))
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

    async reorderCanvases(canvasOrder) {
      const previousAppState = get().appState
      if (!previousAppState) return

      const knownCanvasIds = new Set(previousAppState.canvasOrder)
      const nextOrder = [...new Set(canvasOrder)].filter((canvasId) => knownCanvasIds.has(canvasId))
      if (nextOrder.length !== previousAppState.canvasOrder.length) return

      set((state) => {
        if (!state.appState) return
        state.appState = {
          ...state.appState,
          canvasOrder: nextOrder,
          updatedAt: nowIso()
        }
      })

      try {
        const appState = await window.atlas.canvas.reorder(nextOrder)
        set((state) => {
          state.appState = appState
          state.activeCanvasId = appState.activeCanvasId
          state.error = null
        })
      } catch (error) {
        set((state) => {
          state.appState = previousAppState
          state.activeCanvasId = previousAppState.activeCanvasId
          state.error = error instanceof Error ? error.message : translateCurrent('app.error.reorderCanvases')
        })
      }
    },

    renameCanvas(canvasId, name) {
      const nextName = name.trim()
      if (!nextName) return

      get().updateCanvas(
        canvasId,
        (canvas) => {
          canvas.name = nextName
        },
        true
      )
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
          error: error instanceof Error ? error.message : translateCurrent('app.error.saveCanvas')
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

    addComponents(components) {
      const canvasId = get().activeCanvasId
      if (!canvasId || components.length === 0) return

      get().updateCanvas(
        canvasId,
        (canvas) => {
          for (const component of components) {
            canvas.components.push(createComponent(component.type, canvas, component.position, component.patch))
          }
        },
        true
      )
    },

    duplicateComponents(canvasId, componentIds) {
      const canvas = get().canvases[canvasId]
      if (!canvas || componentIds.length === 0) return []

      const sourceIds = new Set(componentIds)
      const componentsToDuplicate = canvas.components.filter((component) => sourceIds.has(component.id))
      if (componentsToDuplicate.length === 0) return []

      const duplicatedComponentIds: string[] = []

      get().updateCanvas(
        canvasId,
        (draft) => {
          let zIndex = nextZIndex(draft)

          for (const component of componentsToDuplicate) {
            const timestamp = nowIso()
            const definition = getComponentDefinition(component.type)
            const duplicatePatch = definition.duplicate?.(component) ?? undefined
            const duplicatedComponent: CanvasComponent = {
              ...component,
              ...duplicatePatch,
              id: nanoid(),
              frame: {
                ...component.frame,
                ...duplicatePatch?.frame,
                x: component.frame.x + 32,
                y: component.frame.y + 32
              },
              zIndex,
              config: { ...cloneRecord(component.config), ...duplicatePatch?.config },
              state: hasPatchKey(duplicatePatch, 'state') ? cloneRecord(duplicatePatch.state ?? {}) : cloneRecord(component.state),
              bindings: { ...cloneRecord(component.bindings), ...duplicatePatch?.bindings },
              createdAt: timestamp,
              updatedAt: timestamp
            }

            zIndex += 1
            duplicatedComponentIds.push(duplicatedComponent.id)
            draft.components.push(duplicatedComponent)
          }
        },
        true
      )

      return duplicatedComponentIds
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

    updateComponentFrames(canvasId, updates, immediate = false) {
      if (updates.length === 0) return

      const currentCanvas = get().canvases[canvasId]
      if (!currentCanvas) return

      const updatesById = new Map(updates.map((update) => [update.componentId, update.frame]))
      if (!currentCanvas.components.some((component) => updatesById.has(component.id))) return

      get().updateCanvas(
        canvasId,
        (canvas) => {
          const updatedAt = nowIso()

          for (const component of canvas.components) {
            const frame = updatesById.get(component.id)
            if (!frame) continue

            component.frame = { ...component.frame, ...frame }
            component.updatedAt = updatedAt
          }
        },
        immediate
      )
    },

    removeComponent(canvasId, componentId) {
      get().removeComponents(canvasId, [componentId])
    },

    removeComponents(canvasId, componentIds) {
      const components = get().canvases[canvasId]?.components ?? []
      if (componentIds.length === 0 || components.length === 0) return

      const requestedIds = new Set(componentIds)
      const removableIds = new Set(components.filter((component) => requestedIds.has(component.id)).map((component) => component.id))
      if (removableIds.size === 0) return

      for (const component of components) {
        if (removableIds.has(component.id)) void getComponentDefinition(component.type).dispose?.(component)
      }

      get().updateCanvas(
        canvasId,
        (canvas) => {
          canvas.components = canvas.components.filter((component) => !removableIds.has(component.id))
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
