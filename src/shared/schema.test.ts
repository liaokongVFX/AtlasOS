import { describe, expect, it } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_LOCALE, DEFAULT_VIEWPORT } from './constants'
import { appSettingsSchema, canvasDocumentSchema, terminalCreateSchema } from './schema'

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
    expect(parsed.background.image.blur).toBe(DEFAULT_CANVAS_BACKGROUND.image.blur)
    expect(parsed.groups).toEqual([])
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

  it('ignores legacy background image opacity settings', () => {
    const timestamp = new Date().toISOString()
    const parsed = canvasDocumentSchema.parse({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      id: 'canvas-1',
      name: 'Home',
      viewport: DEFAULT_VIEWPORT,
      background: {
        ...DEFAULT_CANVAS_BACKGROUND,
        image: {
          ...DEFAULT_CANVAS_BACKGROUND.image,
          opacity: 0.14
        }
      },
      components: [],
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect('opacity' in parsed.background.image).toBe(false)
    expect(parsed.background.image.blur).toBe(DEFAULT_CANVAS_BACKGROUND.image.blur)
  })

  it('accepts CSS gradient background fills', () => {
    const timestamp = new Date().toISOString()
    const gradient = 'linear-gradient(135deg, #010102, #11141b)'
    const parsed = canvasDocumentSchema.parse({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      id: 'canvas-1',
      name: 'Home',
      viewport: DEFAULT_VIEWPORT,
      background: {
        ...DEFAULT_CANVAS_BACKGROUND,
        color: gradient
      },
      components: [],
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect(parsed.background.color).toBe(gradient)
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

  it('validates canvas groups with notes and member ids', () => {
    const timestamp = new Date().toISOString()
    const parsed = canvasDocumentSchema.parse({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      id: 'canvas-1',
      name: 'Home',
      viewport: DEFAULT_VIEWPORT,
      background: DEFAULT_CANVAS_BACKGROUND,
      components: [],
      groups: [
        {
          id: 'group-1',
          title: '  Research  ',
          notes: 'Follow up ideas',
          frame: { x: 12, y: 24, width: 360, height: 220 },
          zIndex: 2,
          memberIds: ['component-1']
        }
      ],
      createdAt: timestamp,
      updatedAt: timestamp
    })

    expect(parsed.groups[0]).toMatchObject({
      id: 'group-1',
      title: 'Research',
      notes: 'Follow up ideas',
      memberIds: ['component-1']
    })
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
        canvasCreateComponent: 'Tab',
        canvasGroupSelection: 'Ctrl+G',
        canvasUngroupSelection: 'Ctrl+Shift+G'
      },
      updates: {
        autoCheck: true
      },
      pet: {
        enabled: true,
        showNativeNotifications: true,
        showRunningAgents: true,
        position: { x: 36, y: 120 },
        size: 72,
        kanban: { enabled: true },
        agentBridge: { enabled: true },
        assetPack: {
          id: 'atlas-orb',
          name: 'Atlas Orb',
          idleSrc: '',
          idleKind: 'image',
          idleSprite: { frameCount: 8, fps: 8 },
          runningSrc: '',
          runningKind: 'image',
          runningSprite: { frameCount: 8, fps: 8 },
          attentionSrc: '',
          attentionKind: 'image',
          attentionSprite: { frameCount: 8, fps: 8 }
        },
        actionMap: { idle: 'float', running: 'bounce', attention: 'pulse' }
      }
    })
  })

  it('defaults update settings for older app settings files', () => {
    expect(
      appSettingsSchema.parse({
        shortcuts: {
          canvasDeselect: 'Ctrl+Q',
          canvasFind: 'Ctrl+F',
          canvasCreateComponent: 'Tab',
          canvasGroupSelection: 'Ctrl+G',
          canvasUngroupSelection: 'Ctrl+Shift+G'
        }
      }).updates
    ).toEqual({ autoCheck: true })
  })

  it('accepts supported locales', () => {
    expect(appSettingsSchema.parse({ locale: 'en-US' }).locale).toBe('en-US')
  })

  it('accepts pet sprite sheet settings', () => {
    const parsed = appSettingsSchema.parse({
      pet: {
        assetPack: {
          idleSrc: 'atlas-file://preview?path=idle-sprite.png',
          idleKind: 'sprite',
          idleSprite: { frameCount: 6, fps: 12 }
        }
      }
    })

    expect(parsed.pet.assetPack.idleKind).toBe('sprite')
    expect(parsed.pet.assetPack.idleSprite).toEqual({ frameCount: 6, fps: 12 })
    expect(parsed.pet.assetPack.runningSprite).toEqual({ frameCount: 8, fps: 8 })
    expect(parsed.pet.assetPack.attentionSprite).toEqual({ frameCount: 8, fps: 8 })
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
      canvasCreateComponent: 'Tab',
      canvasGroupSelection: 'Ctrl+G',
      canvasUngroupSelection: 'Ctrl+Shift+G'
    })
  })

  it('rejects duplicate keyboard shortcuts', () => {
    expect(() =>
      appSettingsSchema.parse({
        shortcuts: {
          canvasDeselect: 'Ctrl+K',
          canvasFind: 'Ctrl+F',
          canvasCreateComponent: 'Tab',
          canvasGroupSelection: 'control + k'
        }
      })
    ).toThrow(/unique/)
  })
})

describe('terminalCreateSchema', () => {
  it('accepts and trims one-shot initial commands', () => {
    const input = terminalCreateSchema.parse({
      componentId: 'terminal-1',
      initialCommand: '  claude --resume alpha-session  ',
      cols: 80,
      rows: 24
    })

    expect(input.initialCommand).toBe('claude --resume alpha-session')
    expect(input.autoConfirmWorkspaceTrust).toBe(false)
  })

  it('accepts explicit workspace trust auto-confirmation for restored terminals', () => {
    expect(
      terminalCreateSchema.parse({
        componentId: 'terminal-1',
        autoConfirmWorkspaceTrust: true,
        cols: 80,
        rows: 24
      }).autoConfirmWorkspaceTrust
    ).toBe(true)
  })

  it('rejects blank one-shot initial commands', () => {
    expect(() =>
      terminalCreateSchema.parse({
        componentId: 'terminal-1',
        initialCommand: '   ',
        cols: 80,
        rows: 24
      })
    ).toThrow()
  })
})
