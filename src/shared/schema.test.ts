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
    expect(parsed.background.grid.enabled).toBe(true)
  })
})
