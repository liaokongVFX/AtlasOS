import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import type { CanvasComponent, CanvasDocument, CanvasGroup } from '@shared/schema'
import { registerBuiltInComponentDefinitions } from '../components/register-builtins'
import { useCanvasStore } from './canvas-store'

registerBuiltInComponentDefinitions()

const initialStore = useCanvasStore.getState()

function createComponent(id: string, patch: Partial<CanvasComponent> = {}): CanvasComponent {
  const timestamp = '2026-06-01T00:00:00.000Z'

  return {
    id,
    type: 'markdown-note',
    title: 'Note',
    frame: { x: 100, y: 120, width: 420, height: 300 },
    zIndex: 1,
    config: {},
    state: { content: id },
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    ...patch
  }
}

function createGroup(id: string, patch: Partial<CanvasGroup> = {}): CanvasGroup {
  return {
    id,
    title: 'Group',
    notes: '',
    frame: { x: 80, y: 62, width: 460, height: 378 },
    zIndex: 1,
    memberIds: [],
    ...patch
  }
}

function createCanvas(patch: Partial<CanvasDocument> = {}): CanvasDocument {
  const timestamp = '2026-06-01T00:00:00.000Z'

  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    id: 'canvas-1',
    name: 'Canvas',
    viewport: { ...DEFAULT_VIEWPORT },
    background: {
      color: DEFAULT_CANVAS_BACKGROUND.color,
      image: { ...DEFAULT_CANVAS_BACKGROUND.image }
    },
    components: [],
    groups: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...patch
  }
}

describe('canvas group store operations', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        canvas: {
          save: vi.fn(async (canvas: CanvasDocument) => canvas)
        }
      }
    })

    useCanvasStore.setState(
      {
        ...initialStore,
        activeCanvasId: 'canvas-1',
        canvases: { 'canvas-1': createCanvas() },
        saveState: 'idle',
        error: null
      },
      true
    )
  })

  it('creates a padded group and removes members from old groups without deleting empty groups', () => {
    const canvas = createCanvas({
      components: [
        createComponent('component-1'),
        createComponent('component-2', { frame: { x: 560, y: 160, width: 200, height: 160 }, zIndex: 2 })
      ],
      groups: [createGroup('old-group', { memberIds: ['component-1'] })]
    })
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    const groupId = useCanvasStore.getState().createGroup('canvas-1', ['component-1', 'component-2'])
    const groups = useCanvasStore.getState().canvases['canvas-1'].groups
    const group = groups.find((item) => item.id === groupId)

    expect(groups.find((item) => item.id === 'old-group')?.memberIds).toEqual([])
    expect(group?.memberIds).toEqual(['component-1', 'component-2'])
    expect(group?.frame).toMatchObject({ x: 80, y: 62, width: 700, height: 378 })
  })

  it('moves a group frame and its member component frames together', () => {
    const canvas = createCanvas({
      components: [createComponent('component-1')],
      groups: [createGroup('group-1', { memberIds: ['component-1'] })]
    })
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    useCanvasStore.getState().moveGroup('canvas-1', 'group-1', { x: 120, y: 100 }, true)

    const nextCanvas = useCanvasStore.getState().canvases['canvas-1']
    expect(nextCanvas.groups[0].frame).toMatchObject({ x: 120, y: 100 })
    expect(nextCanvas.components[0].frame).toMatchObject({ x: 140, y: 158 })
  })

  it('reconciles component membership by center point and topmost group', () => {
    const canvas = createCanvas({
      components: [createComponent('component-1', { frame: { x: 720, y: 220, width: 180, height: 140 } })],
      groups: [
        createGroup('group-low', { frame: { x: 600, y: 120, width: 500, height: 360 }, zIndex: 1 }),
        createGroup('group-high', { frame: { x: 640, y: 160, width: 500, height: 360 }, zIndex: 3 })
      ]
    })
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    useCanvasStore.getState().updateComponentFrames('canvas-1', [{ componentId: 'component-1', frame: { x: 700, y: 220 }, reconcileGroup: true }], true)
    expect(useCanvasStore.getState().canvases['canvas-1'].groups.find((group) => group.id === 'group-high')?.memberIds).toEqual(['component-1'])
    expect(useCanvasStore.getState().canvases['canvas-1'].groups.find((group) => group.id === 'group-low')?.memberIds).toEqual([])

    useCanvasStore.getState().updateComponentFrames('canvas-1', [{ componentId: 'component-1', frame: { x: 20, y: 20 }, reconcileGroup: true }], true)
    expect(useCanvasStore.getState().canvases['canvas-1'].groups.every((group) => group.memberIds.length === 0)).toBe(true)
  })

  it('clamps group resizing around current member bounds and retains empty groups', () => {
    const canvas = createCanvas({
      components: [createComponent('component-1')],
      groups: [createGroup('group-1', { memberIds: ['component-1'] })]
    })
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    useCanvasStore.getState().updateGroupFrame('canvas-1', 'group-1', { x: 300, y: 300, width: 220, height: 132 }, true)
    expect(useCanvasStore.getState().canvases['canvas-1'].groups[0].frame).toEqual({ x: 80, y: 62, width: 460, height: 378 })

    useCanvasStore.getState().removeComponents('canvas-1', ['component-1'])
    expect(useCanvasStore.getState().canvases['canvas-1'].groups).toHaveLength(1)
    expect(useCanvasStore.getState().canvases['canvas-1'].groups[0].memberIds).toEqual([])
  })

  it('duplicates selected groups with their members and skips duplicate loose members', () => {
    const canvas = createCanvas({
      components: [
        createComponent('component-1'),
        createComponent('component-2', { frame: { x: 560, y: 160, width: 200, height: 160 }, zIndex: 2 })
      ],
      groups: [createGroup('group-1', { memberIds: ['component-1', 'component-2'] })]
    })
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    const duplicated = useCanvasStore.getState().duplicateSelection('canvas-1', ['component-1'], ['group-1'])
    const nextCanvas = useCanvasStore.getState().canvases['canvas-1']
    const duplicatedGroup = nextCanvas.groups.find((group) => group.id === duplicated.groupIds[0])

    expect(nextCanvas.components).toHaveLength(4)
    expect(nextCanvas.groups).toHaveLength(2)
    expect(duplicated.componentIds).toHaveLength(2)
    expect(duplicatedGroup?.memberIds).toEqual(duplicated.componentIds)
    expect(duplicatedGroup?.frame).toMatchObject({ x: 112, y: 94 })
  })
})
