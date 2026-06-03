import { describe, expect, it } from 'vitest'
import {
  createMindMapTemplateSkeletons,
  createSketchScene,
  getMindMapTemplateOrigin,
  getSketchSearchTokens,
  normalizeSketchScene,
  sketchElementCount,
  sketchSceneToInitialData,
  SKETCH_SCENE_SCHEMA_VERSION,
  SKETCH_THEME,
  SKETCH_VIEW_BACKGROUND
} from './sketch-model'

describe('sketch model', () => {
  it('creates an empty dark sketch scene from invalid state', () => {
    const scene = normalizeSketchScene(null)

    expect(scene).toEqual({
      schemaVersion: SKETCH_SCENE_SCHEMA_VERSION,
      elements: [],
      appState: {
        theme: SKETCH_THEME,
        viewBackgroundColor: SKETCH_VIEW_BACKGROUND
      },
      files: {}
    })
  })

  it('normalizes persisted scenes and drops transient runtime state', () => {
    const circularState: Record<string, unknown> = {}
    circularState.self = circularState
    const scene = normalizeSketchScene({
      schemaVersion: 1,
      elements: [
        { id: 'text-1', type: 'text', text: 'Launch plan', x: 10, y: 20, width: 100, height: 40 },
        { id: 'bad-1', x: 1 }
      ],
      appState: {
        theme: 'light',
        viewBackgroundColor: '#ffffff',
        selectedElementIds: { 'text-1': true },
        collaborators: new Map(),
        circularState,
        customHandler: () => undefined,
        scrollX: 12
      },
      files: {
        file1: {
          id: 'file1',
          dataURL: 'data:image/png;base64,abc',
          mimeType: 'image/png',
          created: 1,
          lastRetrieved: 1
        },
        broken: { id: 'broken' }
      }
    })

    expect(scene.elements).toHaveLength(1)
    expect(scene.appState).toMatchObject({
      theme: SKETCH_THEME,
      viewBackgroundColor: SKETCH_VIEW_BACKGROUND,
      scrollX: 12
    })
    expect(scene.appState).not.toHaveProperty('selectedElementIds')
    expect(scene.appState).not.toHaveProperty('collaborators')
    expect(scene.appState).not.toHaveProperty('circularState')
    expect(scene.appState).not.toHaveProperty('customHandler')
    expect(Object.keys(scene.files)).toEqual(['file1'])
  })

  it('creates Excalidraw initial data from the persisted scene', () => {
    const scene = createSketchScene([{ id: 'rect-1', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }], { theme: 'light' }, {})
    const initialData = sketchSceneToInitialData(scene)

    expect(initialData.elements).toEqual(scene.elements)
    expect(initialData.files).toEqual({})
    expect(initialData.appState).toMatchObject({
      theme: SKETCH_THEME,
      viewBackgroundColor: SKETCH_VIEW_BACKGROUND
    })
  })

  it('builds a stable editable mind-map skeleton', () => {
    const skeletons = createMindMapTemplateSkeletons(
      {
        center: 'Feature',
        branches: ['Why', 'How', 'Risk', 'Next']
      },
      { x: 10, y: 20 }
    )

    expect(skeletons).toHaveLength(9)
    expect(skeletons[0]).toMatchObject({
      type: 'rectangle',
      id: 'atlas-mind-map-center',
      label: { text: 'Feature' }
    })
    expect(skeletons.slice(5)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'arrow',
          start: { id: 'atlas-mind-map-center', type: 'rectangle' },
          end: { id: 'atlas-mind-map-branch-1', type: 'rectangle' }
        })
      ])
    )
  })

  it('places inserted templates to the right of existing content', () => {
    const origin = getMindMapTemplateOrigin([
      { id: 'rect-1', type: 'rectangle', x: 100, y: 40, width: 200, height: 120, isDeleted: false },
      { id: 'rect-2', type: 'rectangle', x: 500, y: 80, width: 160, height: 120, isDeleted: true }
    ] as never)

    expect(origin).toEqual({ x: 420, y: 40 })
  })

  it('reports text search tokens and visible element count', () => {
    const scene = normalizeSketchScene({
      elements: [
        { id: 'text-1', type: 'text', text: 'Hidden roadmap', x: 0, y: 0, width: 120, height: 40, isDeleted: false },
        { id: 'rect-1', type: 'rectangle', x: 0, y: 0, width: 80, height: 40, isDeleted: true }
      ]
    })

    expect(sketchElementCount(scene)).toBe(1)
    expect(getSketchSearchTokens(scene)).toEqual(expect.arrayContaining(['sketch', 'mind map', 'Hidden roadmap']))
  })
})
