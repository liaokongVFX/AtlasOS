import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import type { AtlasAppState, CanvasComponent, CanvasDocument, CanvasGroup, ComponentType, Frame } from '@shared/schema'
import {
  componentDefinitionTitle,
  getComponentDefinition,
  type ComponentCreateInput,
  type ComponentCreatePatch
} from '../components/registry'
import { translateCurrent } from '../i18n'
import { isTerminalComponentLocked } from '../lib/terminal-lock'

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

type ComponentFrameUpdate = {
  componentId: string
  frame: Partial<Frame>
  reconcileGroup?: boolean
}

type DuplicateSelectionResult = {
  componentIds: string[]
  groupIds: string[]
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
  beginCanvasInteraction: () => void
  endCanvasInteraction: () => void
  updateCanvas: (canvasId: string, updater: (canvas: CanvasDocument) => void, immediate?: boolean) => void
  addComponent: (type: ComponentType, position?: { x: number; y: number }, patch?: ComponentCreatePatch) => string | null
  addComponents: (components: ComponentCreateInput[]) => void
  duplicateComponents: (canvasId: string, componentIds: string[]) => string[]
  duplicateSelection: (canvasId: string, componentIds: string[], groupIds: string[]) => DuplicateSelectionResult
  updateComponent: (canvasId: string, componentId: string, updater: (component: CanvasComponent) => void, immediate?: boolean) => void
  updateComponentFrames: (canvasId: string, updates: ComponentFrameUpdate[], immediate?: boolean) => void
  removeComponent: (canvasId: string, componentId: string) => void
  removeComponents: (canvasId: string, componentIds: string[]) => void
  bringToFront: (canvasId: string, componentId: string) => void
  bringNodesToFront: (canvasId: string, nodeIds: string[]) => void
  createGroup: (canvasId: string, componentIds: string[]) => string | null
  updateGroup: (canvasId: string, groupId: string, patch: Partial<Pick<CanvasGroup, 'title' | 'notes'>>, immediate?: boolean) => void
  updateGroupFrame: (canvasId: string, groupId: string, frame: Frame, immediate?: boolean) => void
  moveGroup: (canvasId: string, groupId: string, position: { x: number; y: number }, immediate?: boolean) => void
  ungroupGroups: (canvasId: string, groupIds: string[]) => string[]
  removeGroups: (canvasId: string, groupIds: string[]) => void
  deleteGroupsWithMembers: (canvasId: string, groupIds: string[]) => string[]
  bringGroupToFront: (canvasId: string, groupId: string) => void
}

const SAVE_DELAY_MS = 500
export const CANVAS_GROUP_PADDING_X = 20
export const CANVAS_GROUP_PADDING_TOP = 58
export const CANVAS_GROUP_PADDING_BOTTOM = 20
export const CANVAS_GROUP_MIN_WIDTH = 220
export const CANVAS_GROUP_MIN_HEIGHT = 132
const CANVAS_GROUP_DUPLICATE_OFFSET = 32

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const canvasRevisions = new Map<string, number>()
const savedCanvasRevisions = new Map<string, number>()
const deferredSaveCanvasIds = new Set<string>()
const deferredSavedCanvasIds = new Set<string>()
let canvasInteractionDepth = 0

function nowIso(): string {
  return new Date().toISOString()
}

function canvasRevision(canvasId: string): number {
  return canvasRevisions.get(canvasId) ?? 0
}

function bumpCanvasRevision(canvasId: string): number {
  const revision = canvasRevision(canvasId) + 1
  canvasRevisions.set(canvasId, revision)
  return revision
}

function hasPendingSave(canvasId: string): boolean {
  return saveTimers.has(canvasId) || deferredSaveCanvasIds.has(canvasId)
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
    groups: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function nextZIndex(canvas: CanvasDocument): number {
  return canvas.components.reduce((max, component) => Math.max(max, component.zIndex), 0) + 1
}

function nextGroupZIndex(canvas: CanvasDocument): number {
  return canvas.groups.reduce((max, group) => Math.max(max, group.zIndex), 0) + 1
}

function nextCanvasNodeZIndex(canvas: CanvasDocument): number {
  const componentMax = canvas.components.reduce((max, component) => Math.max(max, component.zIndex), 0)
  const groupMax = canvas.groups.reduce((max, group) => Math.max(max, group.zIndex), 0)
  return Math.max(componentMax, groupMax) + 1
}

function frontNodeRefs(canvas: CanvasDocument, nodeIds: string[]): Array<{ id: string; kind: 'component' | 'group'; zIndex: number; order: number }> {
  const refs: Array<{ id: string; kind: 'component' | 'group'; zIndex: number; order: number }> = []
  const seen = new Set<string>()
  const componentsById = new Map(canvas.components.map((component) => [component.id, component]))
  const groupsById = new Map(canvas.groups.map((group) => [group.id, group]))

  nodeIds.forEach((nodeId, order) => {
    if (seen.has(nodeId)) return
    seen.add(nodeId)

    const component = componentsById.get(nodeId)
    if (component) {
      if (!isTerminalComponentLocked(component)) refs.push({ id: nodeId, kind: 'component', zIndex: component.zIndex, order })
      return
    }

    const group = groupsById.get(nodeId)
    if (group) refs.push({ id: nodeId, kind: 'group', zIndex: group.zIndex, order })
  })

  return refs.sort((first, second) => first.zIndex - second.zIndex || first.order - second.order)
}

function selectedComponentBounds(components: CanvasComponent[]): Frame | null {
  if (components.length === 0) return null

  const left = Math.min(...components.map((component) => component.frame.x))
  const top = Math.min(...components.map((component) => component.frame.y))
  const right = Math.max(...components.map((component) => component.frame.x + component.frame.width))
  const bottom = Math.max(...components.map((component) => component.frame.y + component.frame.height))

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }
}

function paddedGroupFrame(components: CanvasComponent[]): Frame {
  const bounds = selectedComponentBounds(components)
  if (!bounds) {
    return { x: 0, y: 0, width: CANVAS_GROUP_MIN_WIDTH, height: CANVAS_GROUP_MIN_HEIGHT }
  }

  return {
    x: Math.round(bounds.x - CANVAS_GROUP_PADDING_X),
    y: Math.round(bounds.y - CANVAS_GROUP_PADDING_TOP),
    width: Math.max(CANVAS_GROUP_MIN_WIDTH, Math.round(bounds.width + CANVAS_GROUP_PADDING_X * 2)),
    height: Math.max(CANVAS_GROUP_MIN_HEIGHT, Math.round(bounds.height + CANVAS_GROUP_PADDING_TOP + CANVAS_GROUP_PADDING_BOTTOM))
  }
}

function memberComponents(canvas: CanvasDocument, group: CanvasGroup): CanvasComponent[] {
  const memberIds = new Set(group.memberIds)
  return canvas.components.filter((component) => memberIds.has(component.id))
}

function clampGroupFrame(canvas: CanvasDocument, group: CanvasGroup, frame: Frame): Frame {
  const roundedFrame = {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(CANVAS_GROUP_MIN_WIDTH, Math.round(frame.width)),
    height: Math.max(CANVAS_GROUP_MIN_HEIGHT, Math.round(frame.height))
  }
  const members = memberComponents(canvas, group)
  const bounds = selectedComponentBounds(members)
  if (!bounds) return roundedFrame

  const requiredLeft = bounds.x - CANVAS_GROUP_PADDING_X
  const requiredTop = bounds.y - CANVAS_GROUP_PADDING_TOP
  const requiredRight = bounds.x + bounds.width + CANVAS_GROUP_PADDING_X
  const requiredBottom = bounds.y + bounds.height + CANVAS_GROUP_PADDING_BOTTOM
  const x = Math.min(roundedFrame.x, requiredLeft)
  const y = Math.min(roundedFrame.y, requiredTop)
  const right = Math.max(roundedFrame.x + roundedFrame.width, requiredRight)
  const bottom = Math.max(roundedFrame.y + roundedFrame.height, requiredBottom)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(CANVAS_GROUP_MIN_WIDTH, Math.round(right - x)),
    height: Math.max(CANVAS_GROUP_MIN_HEIGHT, Math.round(bottom - y))
  }
}

function removeMemberIdsFromGroups(canvas: CanvasDocument, memberIds: Set<string>, exceptGroupId?: string): void {
  if (memberIds.size === 0) return

  for (const group of canvas.groups) {
    if (group.id === exceptGroupId) continue
    group.memberIds = group.memberIds.filter((memberId) => !memberIds.has(memberId))
  }
}

function pointInsideFrame(point: { x: number; y: number }, frame: Frame): boolean {
  return point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= frame.y && point.y <= frame.y + frame.height
}

function topmostGroupAtPoint(canvas: CanvasDocument, point: { x: number; y: number }): CanvasGroup | null {
  let matchedGroup: CanvasGroup | null = null
  let matchedIndex = -1

  canvas.groups.forEach((group, index) => {
    if (!pointInsideFrame(point, group.frame)) return
    if (!matchedGroup || group.zIndex > matchedGroup.zIndex || (group.zIndex === matchedGroup.zIndex && index > matchedIndex)) {
      matchedGroup = group
      matchedIndex = index
    }
  })

  return matchedGroup
}

function reconcileComponentGroup(canvas: CanvasDocument, componentId: string): void {
  const component = canvas.components.find((item) => item.id === componentId)
  if (!component) return

  const center = {
    x: component.frame.x + component.frame.width / 2,
    y: component.frame.y + component.frame.height / 2
  }
  const targetGroup = topmostGroupAtPoint(canvas, center)
  const componentIds = new Set([componentId])
  removeMemberIdsFromGroups(canvas, componentIds, targetGroup?.id)

  if (targetGroup && !targetGroup.memberIds.includes(componentId)) {
    targetGroup.memberIds.push(componentId)
  }
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

function duplicateComponent(component: CanvasComponent, zIndex: number): CanvasComponent {
  const timestamp = nowIso()
  const definition = getComponentDefinition(component.type)
  const duplicatePatch = definition.duplicate?.(component) ?? undefined

  return {
    ...component,
    ...duplicatePatch,
    id: nanoid(),
    frame: {
      ...component.frame,
      ...duplicatePatch?.frame,
      x: component.frame.x + CANVAS_GROUP_DUPLICATE_OFFSET,
      y: component.frame.y + CANVAS_GROUP_DUPLICATE_OFFSET
    },
    zIndex,
    config: { ...cloneRecord(component.config), ...duplicatePatch?.config },
    state: hasPatchKey(duplicatePatch, 'state') ? cloneRecord(duplicatePatch.state ?? {}) : cloneRecord(component.state),
    bindings: { ...cloneRecord(component.bindings), ...duplicatePatch?.bindings },
    createdAt: timestamp,
    updatedAt: timestamp
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
        for (const canvas of canvases) {
          canvasRevisions.set(canvas.id, 0)
          savedCanvasRevisions.set(canvas.id, 0)
        }

        if (canvases.length === 0) {
          const fallback = createFallbackCanvas()
          canvasRevisions.set(fallback.id, 0)
          savedCanvasRevisions.set(fallback.id, 0)
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
      canvasRevisions.set(result.canvas.id, 0)
      savedCanvasRevisions.set(result.canvas.id, 0)
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
      const saveRevision = canvasRevision(canvasId)

      if (saveTimers.has(canvasId)) {
        clearTimeout(saveTimers.get(canvasId))
        saveTimers.delete(canvasId)
      }
      deferredSaveCanvasIds.delete(canvasId)

      set({ saveState: 'saving' })
      try {
        await window.atlas.canvas.save(canvas)
        savedCanvasRevisions.set(canvasId, saveRevision)

        if (canvasRevision(canvasId) === saveRevision) {
          if (canvasInteractionDepth > 0 || hasPendingSave(canvasId)) {
            deferredSavedCanvasIds.add(canvasId)
            set({ error: null })
          } else {
            deferredSavedCanvasIds.delete(canvasId)
            set({ saveState: 'saved', error: null })
          }
        } else {
          set({ error: null })
        }
      } catch (error) {
        set({
          saveState: 'error',
          error: error instanceof Error ? error.message : translateCurrent('app.error.saveCanvas')
        })
      }
    },

    beginCanvasInteraction() {
      canvasInteractionDepth += 1
    },

    endCanvasInteraction() {
      if (canvasInteractionDepth > 0) {
        canvasInteractionDepth -= 1
      }

      if (canvasInteractionDepth > 0) return

      const deferredCanvasIds = [...deferredSaveCanvasIds]
      deferredSaveCanvasIds.clear()

      for (const canvasId of deferredCanvasIds) {
        if (saveTimers.has(canvasId)) continue

        saveTimers.set(
          canvasId,
          setTimeout(() => {
            saveTimers.delete(canvasId)
            if (canvasInteractionDepth > 0) {
              deferredSaveCanvasIds.add(canvasId)
              return
            }
            void get().saveCanvasNow(canvasId)
          }, SAVE_DELAY_MS)
        )
      }

      const activeCanvasId = get().activeCanvasId
      if (
        activeCanvasId &&
        deferredSavedCanvasIds.has(activeCanvasId) &&
        savedCanvasRevisions.get(activeCanvasId) === canvasRevision(activeCanvasId) &&
        !hasPendingSave(activeCanvasId)
      ) {
        deferredSavedCanvasIds.delete(activeCanvasId)
        set({ saveState: 'saved', error: null })
      }
    },

    updateCanvas(canvasId, updater, immediate = false) {
      set((state) => {
        const canvas = state.canvases[canvasId]
        if (!canvas) return
        updater(canvas)
        canvas.updatedAt = nowIso()
      })
      bumpCanvasRevision(canvasId)

      if (immediate) {
        void get().saveCanvasNow(canvasId)
        return
      }

      if (canvasId === get().activeCanvasId) {
        set({ saveState: 'dirty' })
      }

      if (saveTimers.has(canvasId)) clearTimeout(saveTimers.get(canvasId))
      deferredSaveCanvasIds.delete(canvasId)
      saveTimers.set(
        canvasId,
        setTimeout(() => {
          saveTimers.delete(canvasId)
          if (canvasInteractionDepth > 0) {
            deferredSaveCanvasIds.add(canvasId)
            return
          }
          void get().saveCanvasNow(canvasId)
        }, SAVE_DELAY_MS)
      )
    },

    addComponent(type, position, patch) {
      const canvasId = get().activeCanvasId
      if (!canvasId) return null
      let componentId: string | null = null
      get().updateCanvas(
        canvasId,
        (canvas) => {
          const component = createComponent(type, canvas, position, patch)
          componentId = component.id
          canvas.components.push(component)
        },
      )
      return componentId
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
            const duplicatedComponent = duplicateComponent(component, zIndex)
            zIndex += 1
            duplicatedComponentIds.push(duplicatedComponent.id)
            draft.components.push(duplicatedComponent)
          }
        },
        true
      )

      return duplicatedComponentIds
    },

    duplicateSelection(canvasId, componentIds, groupIds) {
      const canvas = get().canvases[canvasId]
      if (!canvas || (componentIds.length === 0 && groupIds.length === 0)) {
        return { componentIds: [], groupIds: [] }
      }

      const requestedGroupIds = new Set(groupIds)
      const requestedComponentIds = new Set(componentIds)
      const groupsToDuplicate = canvas.groups.filter((group) => requestedGroupIds.has(group.id))
      const groupedMemberIds = new Set(groupsToDuplicate.flatMap((group) => group.memberIds))
      const looseComponentsToDuplicate = canvas.components.filter(
        (component) => requestedComponentIds.has(component.id) && !groupedMemberIds.has(component.id)
      )

      if (groupsToDuplicate.length === 0 && looseComponentsToDuplicate.length === 0) {
        return { componentIds: [], groupIds: [] }
      }

      const duplicated: DuplicateSelectionResult = { componentIds: [], groupIds: [] }

      get().updateCanvas(
        canvasId,
        (draft) => {
          let componentZIndex = nextZIndex(draft)
          let groupZIndex = nextGroupZIndex(draft)
          const sourceComponentById = new Map(draft.components.map((component) => [component.id, component]))

          for (const group of groupsToDuplicate) {
            const memberIdMap = new Map<string, string>()

            for (const memberId of group.memberIds) {
              const component = sourceComponentById.get(memberId)
              if (!component) continue

              const duplicatedComponent = duplicateComponent(component, componentZIndex)
              componentZIndex += 1
              memberIdMap.set(memberId, duplicatedComponent.id)
              duplicated.componentIds.push(duplicatedComponent.id)
              draft.components.push(duplicatedComponent)
            }

            const duplicatedGroup: CanvasGroup = {
              ...group,
              id: nanoid(),
              frame: {
                ...group.frame,
                x: group.frame.x + CANVAS_GROUP_DUPLICATE_OFFSET,
                y: group.frame.y + CANVAS_GROUP_DUPLICATE_OFFSET
              },
              zIndex: groupZIndex,
              memberIds: group.memberIds.map((memberId) => memberIdMap.get(memberId)).filter((memberId): memberId is string => Boolean(memberId))
            }

            groupZIndex += 1
            duplicated.groupIds.push(duplicatedGroup.id)
            draft.groups.push(duplicatedGroup)
          }

          for (const component of looseComponentsToDuplicate) {
            const duplicatedComponent = duplicateComponent(component, componentZIndex)
            componentZIndex += 1
            duplicated.componentIds.push(duplicatedComponent.id)
            draft.components.push(duplicatedComponent)
          }
        },
        true
      )

      return duplicated
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

      const updatesById = new Map(
        updates
          .filter((update) => {
            const component = currentCanvas.components.find((item) => item.id === update.componentId)
            return component && !isTerminalComponentLocked(component)
          })
          .map((update) => [update.componentId, update.frame])
      )
      if (updatesById.size === 0) return
      if (!currentCanvas.components.some((component) => updatesById.has(component.id))) return

      get().updateCanvas(
        canvasId,
        (canvas) => {
          const updatedAt = nowIso()
          const reconcileIds = new Set(updates.filter((update) => update.reconcileGroup).map((update) => update.componentId))

          for (const component of canvas.components) {
            const frame = updatesById.get(component.id)
            if (!frame) continue

            component.frame = { ...component.frame, ...frame }
            component.updatedAt = updatedAt
          }

          for (const componentId of reconcileIds) {
            reconcileComponentGroup(canvas, componentId)
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
      const removableIds = new Set(
        components
          .filter((component) => requestedIds.has(component.id) && !isTerminalComponentLocked(component))
          .map((component) => component.id)
      )
      if (removableIds.size === 0) return

      for (const component of components) {
        if (removableIds.has(component.id)) void getComponentDefinition(component.type).dispose?.(component)
      }

      get().updateCanvas(
        canvasId,
        (canvas) => {
          canvas.components = canvas.components.filter((component) => !removableIds.has(component.id))
          removeMemberIdsFromGroups(canvas, removableIds)
        },
        true
      )
    },

    bringToFront(canvasId, componentId) {
      get().updateComponent(canvasId, componentId, (component) => {
        const canvas = get().canvases[canvasId]
        if (canvas) component.zIndex = nextZIndex(canvas)
      })
    },

    bringNodesToFront(canvasId, nodeIds) {
      if (nodeIds.length === 0) return

      const currentCanvas = get().canvases[canvasId]
      if (!currentCanvas) return

      const refs = frontNodeRefs(currentCanvas, nodeIds)
      if (refs.length === 0) return

      get().updateCanvas(canvasId, (canvas) => {
        const updatedAt = nowIso()
        const componentsById = new Map(canvas.components.map((component) => [component.id, component]))
        const groupsById = new Map(canvas.groups.map((group) => [group.id, group]))
        let zIndex = nextCanvasNodeZIndex(canvas)

        for (const ref of refs) {
          if (ref.kind === 'component') {
            const component = componentsById.get(ref.id)
            if (!component || isTerminalComponentLocked(component)) continue

            component.zIndex = zIndex
            component.updatedAt = updatedAt
          } else {
            const group = groupsById.get(ref.id)
            if (!group) continue

            group.zIndex = zIndex
          }
          zIndex += 1
        }
      })
    },

    createGroup(canvasId, componentIds) {
      const canvas = get().canvases[canvasId]
      if (!canvas || componentIds.length === 0) return null

      const requestedIds = new Set(componentIds)
      const componentsToGroup = canvas.components.filter((component) => requestedIds.has(component.id))
      if (componentsToGroup.length === 0) return null

      const groupId = nanoid()
      const memberIds = new Set(componentsToGroup.map((component) => component.id))
      const groupIndex = canvas.groups.length + 1

      get().updateCanvas(
        canvasId,
        (draft) => {
          removeMemberIdsFromGroups(draft, memberIds)
          draft.groups.push({
            id: groupId,
            title: translateCurrent('canvas.groupDefaultTitle', { index: groupIndex }),
            notes: '',
            frame: paddedGroupFrame(componentsToGroup),
            zIndex: nextGroupZIndex(draft),
            memberIds: componentsToGroup.map((component) => component.id)
          })
        },
        true
      )

      return groupId
    },

    updateGroup(canvasId, groupId, patch, immediate = false) {
      get().updateCanvas(
        canvasId,
        (canvas) => {
          const group = canvas.groups.find((item) => item.id === groupId)
          if (!group) return

          if (patch.title !== undefined) {
            group.title = patch.title.trim() || translateCurrent('canvas.untitledGroup')
          }
          if (patch.notes !== undefined) {
            group.notes = patch.notes
          }
        },
        immediate
      )
    },

    updateGroupFrame(canvasId, groupId, frame, immediate = false) {
      get().updateCanvas(
        canvasId,
        (canvas) => {
          const group = canvas.groups.find((item) => item.id === groupId)
          if (!group) return

          group.frame = clampGroupFrame(canvas, group, frame)
        },
        immediate
      )
    },

    moveGroup(canvasId, groupId, position, immediate = false) {
      const canvas = get().canvases[canvasId]
      const group = canvas?.groups.find((item) => item.id === groupId)
      if (!canvas || !group) return

      const x = Math.round(position.x)
      const y = Math.round(position.y)
      const dx = x - group.frame.x
      const dy = y - group.frame.y
      if (dx === 0 && dy === 0) return

      get().updateCanvas(
        canvasId,
        (draft) => {
          const draftGroup = draft.groups.find((item) => item.id === groupId)
          if (!draftGroup) return

          const updatedAt = nowIso()
          const memberIds = new Set(draftGroup.memberIds)
          draftGroup.frame = { ...draftGroup.frame, x, y }

          for (const component of draft.components) {
            if (!memberIds.has(component.id) || isTerminalComponentLocked(component)) continue

            component.frame = {
              ...component.frame,
              x: component.frame.x + dx,
              y: component.frame.y + dy
            }
            component.updatedAt = updatedAt
          }
        },
        immediate
      )
    },

    ungroupGroups(canvasId, groupIds) {
      const canvas = get().canvases[canvasId]
      if (!canvas || groupIds.length === 0) return []

      const removableIds = new Set(groupIds)
      const groupsToRemove = canvas.groups.filter((group) => removableIds.has(group.id))
      if (groupsToRemove.length === 0) return []

      const memberIds = [...new Set(groupsToRemove.flatMap((group) => group.memberIds))]
      get().updateCanvas(
        canvasId,
        (draft) => {
          draft.groups = draft.groups.filter((group) => !removableIds.has(group.id))
        },
        true
      )

      return memberIds
    },

    removeGroups(canvasId, groupIds) {
      const canvas = get().canvases[canvasId]
      if (!canvas || groupIds.length === 0) return

      const removableIds = new Set(groupIds)
      if (!canvas.groups.some((group) => removableIds.has(group.id))) return

      get().updateCanvas(
        canvasId,
        (draft) => {
          draft.groups = draft.groups.filter((group) => !removableIds.has(group.id))
        },
        true
      )
    },

    deleteGroupsWithMembers(canvasId, groupIds) {
      const canvas = get().canvases[canvasId]
      if (!canvas || groupIds.length === 0) return []

      const removableGroupIds = new Set(groupIds)
      const groupsToRemove = canvas.groups.filter((group) => removableGroupIds.has(group.id))
      if (groupsToRemove.length === 0) return []

      const lockedComponentIds = new Set(canvas.components.filter(isTerminalComponentLocked).map((component) => component.id))
      const removableComponentIds = new Set(groupsToRemove.flatMap((group) => group.memberIds).filter((componentId) => !lockedComponentIds.has(componentId)))
      for (const component of canvas.components) {
        if (removableComponentIds.has(component.id)) void getComponentDefinition(component.type).dispose?.(component)
      }

      get().updateCanvas(
        canvasId,
        (draft) => {
          draft.groups = draft.groups.filter((group) => !removableGroupIds.has(group.id))
          draft.components = draft.components.filter((component) => !removableComponentIds.has(component.id))
          removeMemberIdsFromGroups(draft, removableComponentIds)
        },
        true
      )

      return [...removableComponentIds]
    },

    bringGroupToFront(canvasId, groupId) {
      get().updateCanvas(canvasId, (canvas) => {
        const group = canvas.groups.find((item) => item.id === groupId)
        if (!group) return

        group.zIndex = nextGroupZIndex(canvas)
      })
    }
  }))
)
