import { describe, expect, it } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from './constants'
import { canvasDocumentSchema } from './schema'

describe('canvasDocumentSchema', () => {
  it('validates a minimal canvas document with default structures', () => {
    const timestamp = new Date().toISOString()
    const parsed = canvasDocumentSchema.parse({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      id: 'canvas-1',
      name: 'Home',
      viewport: DEFAULT_VIEWPORT,
      background: DEFAULT_CANVAS_BACKGROUND,
      components: [],
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect(parsed.id).toBe('canvas-1')
    expect(parsed.background.image.opacity).toBe(DEFAULT_CANVAS_BACKGROUND.image.opacity)
  })

  it('ignores legacy background grid settings', () => {
    const timestamp = new Date().toISOString()
    const parsed = canvasDocumentSchema.parse({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      id: 'canvas-1',
      name: 'Home',
      viewport: DEFAULT_VIEWPORT,
      background: {
        ...DEFAULT_CANVAS_BACKGROUND,
        grid: {
          enabled: true,
          size: 24,
          opacity: 0.14,
          variant: 'dots'
        }
      },
      components: [],
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect('grid' in parsed.background).toBe(false)
  })

  it('accepts kanban canvas components', () => {
    const timestamp = new Date().toISOString()
    const parsed = canvasDocumentSchema.parse({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      id: 'canvas-1',
      name: 'Home',
      viewport: DEFAULT_VIEWPORT,
      background: DEFAULT_CANVAS_BACKGROUND,
      components: [
        {
          id: 'kanban-1',
          type: 'kanban',
          title: 'Kanban',
          frame: { x: 0, y: 0, width: 920, height: 620 },
          config: {},
          state: {},
          bindings: {},
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect(parsed.components[0].type).toBe('kanban')
  })
})
