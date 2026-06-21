import { z } from 'zod'
import { ATLAS_SCHEMA_VERSION, DEFAULT_APP_SHORTCUTS, DEFAULT_CANVAS_BACKGROUND, DEFAULT_LOCALE, DEFAULT_VIEWPORT, LOCALES } from './constants'
import { aiSettingsSchema } from './ai'
import { normalizeKeyboardShortcut } from './keyboard-shortcuts'
import { petSettingsSchema } from './pet'
import { remoteServerSettingsSchema } from './remote-servers'
import { terminalCommandLibrarySchema } from './terminal-commands'
import { updateSettingsSchema } from './updates'

export const componentTypeSchema = z.string().min(1)

export const frameSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(160),
  height: z.number().min(120)
})

export const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().min(0.1).max(3)
})

export const canvasBackgroundSchema = z.object({
  color: z.string().default(DEFAULT_CANVAS_BACKGROUND.color),
  image: z
    .object({
      src: z.string().default(''),
      blur: z.number().min(0).max(24).default(DEFAULT_CANVAS_BACKGROUND.image.blur),
      fit: z.enum(['cover', 'contain', 'repeat']).default(DEFAULT_CANVAS_BACKGROUND.image.fit),
      fixed: z.boolean().default(DEFAULT_CANVAS_BACKGROUND.image.fixed)
    })
    .default(DEFAULT_CANVAS_BACKGROUND.image)
})

export const canvasComponentSchema = z.object({
  id: z.string().min(1),
  type: componentTypeSchema,
  title: z.string().min(1),
  frame: frameSchema,
  zIndex: z.number().int().nonnegative().default(0),
  config: z.record(z.string(), z.unknown()).default({}),
  state: z.record(z.string(), z.unknown()).default({}),
  bindings: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const canvasGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).default('Group'),
  notes: z.string().default(''),
  frame: frameSchema,
  zIndex: z.number().int().nonnegative().default(0),
  memberIds: z.array(z.string().min(1)).default([])
})

export const canvasDocumentSchema = z.object({
  schemaVersion: z.literal(ATLAS_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  viewport: viewportSchema.default(DEFAULT_VIEWPORT),
  background: canvasBackgroundSchema.default(DEFAULT_CANVAS_BACKGROUND),
  components: z.array(canvasComponentSchema).default([]),
  groups: z.array(canvasGroupSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const appStateSchema = z.object({
  schemaVersion: z.literal(ATLAS_SCHEMA_VERSION),
  activeCanvasId: z.string().nullable(),
  canvasOrder: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const keyboardShortcutSchema = z.string().trim().min(1).max(80).transform((value, context) => {
  const normalized = normalizeKeyboardShortcut(value)
  if (!normalized) {
    context.addIssue({
      code: 'custom',
      message: 'Shortcut must combine optional modifiers with one key'
    })
    return z.NEVER
  }

  return normalized
})

const appShortcutKeys = ['canvasDeselect', 'canvasFind', 'canvasCreateComponent', 'canvasGroupSelection', 'canvasUngroupSelection'] as const

export const appShortcutSettingsSchema = z
  .object({
    canvasDeselect: keyboardShortcutSchema.default(DEFAULT_APP_SHORTCUTS.canvasDeselect),
    canvasFind: keyboardShortcutSchema.default(DEFAULT_APP_SHORTCUTS.canvasFind),
    canvasCreateComponent: keyboardShortcutSchema.default(DEFAULT_APP_SHORTCUTS.canvasCreateComponent),
    canvasGroupSelection: keyboardShortcutSchema.default(DEFAULT_APP_SHORTCUTS.canvasGroupSelection),
    canvasUngroupSelection: keyboardShortcutSchema.default(DEFAULT_APP_SHORTCUTS.canvasUngroupSelection)
  })
  .default(DEFAULT_APP_SHORTCUTS)
  .superRefine((shortcuts, context) => {
    const usedShortcuts = new Set<string>()

    for (const key of appShortcutKeys) {
      if (usedShortcuts.has(shortcuts[key])) {
        context.addIssue({
          code: 'custom',
          message: 'Canvas shortcuts must be unique',
          path: [key]
        })
        continue
      }

      usedShortcuts.add(shortcuts[key])
    }
  })

export const appSettingsSchema = z.object({
  schemaVersion: z.literal(ATLAS_SCHEMA_VERSION).default(ATLAS_SCHEMA_VERSION),
  locale: z.enum(LOCALES).default(DEFAULT_LOCALE),
  shortcuts: appShortcutSettingsSchema,
  terminalCommands: terminalCommandLibrarySchema,
  pet: petSettingsSchema,
  updates: updateSettingsSchema,
  ai: aiSettingsSchema,
  remoteServers: remoteServerSettingsSchema
})

const appSettingsPatchField = <T>(schema: z.ZodType<T>) =>
  z.unknown().optional().transform((value) => (value === undefined ? undefined : schema.parse(value)))

export const appSettingsPatchSchema = z
  .object({
    schemaVersion: z.literal(ATLAS_SCHEMA_VERSION).optional(),
    locale: z.enum(LOCALES).optional(),
    shortcuts: appSettingsPatchField(appShortcutSettingsSchema),
    terminalCommands: appSettingsPatchField(terminalCommandLibrarySchema),
    pet: appSettingsPatchField(petSettingsSchema),
    updates: appSettingsPatchField(updateSettingsSchema),
    ai: appSettingsPatchField(aiSettingsSchema),
    remoteServers: appSettingsPatchField(remoteServerSettingsSchema)
  })
  .transform((patch) => Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)))

export type FileEntry = {
  id: string
  name: string
  path: string
  kind: 'file' | 'directory'
  size?: number
  modifiedAt?: string
  childrenLoaded?: boolean
  children?: FileEntry[]
}

export const fileEntrySchema: z.ZodType<FileEntry> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'directory']),
  size: z.number().optional(),
  modifiedAt: z.string().optional(),
  childrenLoaded: z.boolean().optional(),
  children: z.array(z.lazy(() => fileEntrySchema)).optional()
})

const browserRectangleSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative()
})

export const browserBoundsSchema = z.object({
  tabId: z.string(),
  visible: z.boolean(),
  bounds: browserRectangleSchema,
  contentBounds: browserRectangleSchema.optional()
})

export const terminalCreateSchema = z.object({
  componentId: z.string(),
  canvasId: z.string().optional(),
  title: z.string().optional(),
  cwd: z.string().optional(),
  shell: z.string().optional(),
  initialCommand: z.string().trim().min(1).max(8192).optional(),
  autoConfirmWorkspaceTrust: z.boolean().default(false),
  cols: z.number().int().min(10).default(100),
  rows: z.number().int().min(4).default(30)
})

export type ComponentType = z.infer<typeof componentTypeSchema>
export type Frame = z.infer<typeof frameSchema>
export type Viewport = z.infer<typeof viewportSchema>
export type CanvasBackground = z.infer<typeof canvasBackgroundSchema>
export type CanvasComponent = z.infer<typeof canvasComponentSchema>
export type CanvasGroup = z.infer<typeof canvasGroupSchema>
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>
export type AtlasAppState = z.infer<typeof appStateSchema>
export type AppShortcutSettings = z.infer<typeof appShortcutSettingsSchema>
export type AppSettings = z.infer<typeof appSettingsSchema>
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>
