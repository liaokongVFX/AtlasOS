import { z } from 'zod'
import { ATLAS_SCHEMA_VERSION, COMPONENT_TYPES, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from './constants'

export const componentTypeSchema = z.enum(COMPONENT_TYPES)

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
  grid: z
    .object({
      enabled: z.boolean().default(DEFAULT_CANVAS_BACKGROUND.grid.enabled),
      size: z.number().min(8).max(96).default(DEFAULT_CANVAS_BACKGROUND.grid.size),
      opacity: z.number().min(0).max(1).default(DEFAULT_CANVAS_BACKGROUND.grid.opacity),
      variant: z.enum(['dots', 'lines', 'cross']).default(DEFAULT_CANVAS_BACKGROUND.grid.variant)
    })
    .default(DEFAULT_CANVAS_BACKGROUND.grid),
  image: z
    .object({
      src: z.string().default(''),
      opacity: z.number().min(0).max(1).default(DEFAULT_CANVAS_BACKGROUND.image.opacity),
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

export const canvasDocumentSchema = z.object({
  schemaVersion: z.literal(ATLAS_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  viewport: viewportSchema.default(DEFAULT_VIEWPORT),
  background: canvasBackgroundSchema.default(DEFAULT_CANVAS_BACKGROUND),
  components: z.array(canvasComponentSchema).default([]),
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

export type FileEntry = {
  id: string
  name: string
  path: string
  kind: 'file' | 'directory'
  size?: number
  modifiedAt?: string
  children?: FileEntry[]
}

export const fileEntrySchema: z.ZodType<FileEntry> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'directory']),
  size: z.number().optional(),
  modifiedAt: z.string().optional(),
  children: z.array(z.lazy(() => fileEntrySchema)).optional()
})

export const browserBoundsSchema = z.object({
  tabId: z.string(),
  visible: z.boolean(),
  bounds: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative()
  })
})

export const terminalCreateSchema = z.object({
  componentId: z.string(),
  cwd: z.string().optional(),
  shell: z.string().optional(),
  cols: z.number().int().min(10).default(100),
  rows: z.number().int().min(4).default(30)
})

export type ComponentType = z.infer<typeof componentTypeSchema>
export type Frame = z.infer<typeof frameSchema>
export type Viewport = z.infer<typeof viewportSchema>
export type CanvasBackground = z.infer<typeof canvasBackgroundSchema>
export type CanvasComponent = z.infer<typeof canvasComponentSchema>
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>
export type AtlasAppState = z.infer<typeof appStateSchema>
