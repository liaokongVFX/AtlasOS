import { describe, expect, it } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_LOCALE, DEFAULT_VIEWPORT } from './constants'
import { appSettingsSchema, canvasDocumentSchema } from './schema'

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

  it('accepts plugin canvas component types', () => {
    const timestamp = new Date().toISOString()
    const parsed = canvasDocumentSchema.parse({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      id: 'canvas-1',
      name: 'Home',
      viewport: DEFAULT_VIEWPORT,
      background: DEFAULT_CANVAS_BACKGROUND,
      components: [
        {
          id: 'plugin-1',
          type: 'acme.tools/timer',
          title: 'Timer',
          frame: { x: 0, y: 0, width: 420, height: 260 },
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

    expect(parsed.components[0].type).toBe('acme.tools/timer')
  })
})

describe('appSettingsSchema', () => {
  it('defaults canvas keyboard shortcuts', () => {
    expect(appSettingsSchema.parse({})).toEqual({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      locale: DEFAULT_LOCALE,
      shortcuts: {
        canvasDeselect: 'Ctrl+Q',
        canvasFind: 'Ctrl+F',
        canvasCreateComponent: 'Tab'
      },
      pet: {
        enabled: true,
        showNativeNotifications: true,
        showRunningAgents: true,
        position: { x: 36, y: 120 },
        size: 72,
        kanban: { enabled: true },
        agentBridge: { enabled: true },
        assetPack: { id: 'atlas-orb', name: 'Atlas Orb', idleSrc: '', idleKind: 'image', attentionSrc: '', attentionKind: 'image' },
        actionMap: { idle: 'float', attention: 'pulse' }
      }
    })
  })

  it('accepts supported locales', () => {
    expect(appSettingsSchema.parse({ locale: 'en-US' }).locale).toBe('en-US')
  })

  it('normalizes custom keyboard shortcuts', () => {
    expect(
      appSettingsSchema.parse({
        shortcuts: {
          canvasDeselect: 'ctrl + shift + x',
          canvasFind: 'alt + f'
        }
      }).shortcuts
    ).toEqual({
      canvasDeselect: 'Ctrl+Shift+X',
      canvasFind: 'Alt+F',
      canvasCreateComponent: 'Tab'
    })
  })

  it('rejects duplicate keyboard shortcuts', () => {
    expect(() =>
      appSettingsSchema.parse({
        shortcuts: {
          canvasDeselect: 'Ctrl+K',
          canvasFind: 'Ctrl+F',
          canvasCreateComponent: 'control + k'
        }
      })
    ).toThrow(/unique/)
  })
})
