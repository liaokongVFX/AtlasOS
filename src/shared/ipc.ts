import { z } from 'zod'
import { pluginConfigSchema, pluginIdSchema } from './plugins'
import { appSettingsSchema, browserBoundsSchema, canvasDocumentSchema, terminalCreateSchema } from './schema'

export const MAX_TERMINAL_PASTED_ASSET_BASE64_CHARS = 14 * 1024 * 1024

const base64PayloadPattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export const createCanvasInputSchema = z.object({
  name: z.string().min(1).max(80).optional()
})

export const canvasIdInputSchema = z.object({
  canvasId: z.string().min(1)
})

export const reorderCanvasesInputSchema = z.object({
  canvasOrder: z.array(z.string().min(1)).min(1)
})

export const saveCanvasInputSchema = z.object({
  canvas: canvasDocumentSchema
})

export const updateAppSettingsInputSchema = z.object({
  settings: appSettingsSchema
})

export const chooseDirectoryInputSchema = z.object({
  title: z.string().optional()
})

export const listTreeInputSchema = z.object({
  rootPath: z.string().min(1),
  targetPath: z.string().min(1).optional(),
  maxDepth: z.number().int().min(0).max(64).default(1)
})

export const fileOperationInputSchema = z.object({
  rootPath: z.string().min(1),
  targetPath: z.string().min(1),
  name: z.string().min(1).max(240).optional(),
  contents: z.string().optional()
})

export const filePathInputSchema = z.object({
  rootPath: z.string().min(1),
  targetPath: z.string().min(1)
})

export const moveFileInputSchema = z.object({
  rootPath: z.string().min(1),
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1)
})

export const searchFilesInputSchema = z.object({
  rootPath: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(50)
})

export const watchDirectoryInputSchema = z.object({
  rootPath: z.string().min(1)
})

export const terminalWriteInputSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string()
})

export const terminalResizeInputSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().min(10),
  rows: z.number().int().min(4)
})

export const terminalCloseInputSchema = z.object({
  sessionId: z.string().min(1)
})

export const terminalCloseComponentInputSchema = z.object({
  componentId: z.string().min(1)
})

export const terminalPersistAssetInputSchema = z.object({
  dataBase64: z.string().min(1).max(MAX_TERMINAL_PASTED_ASSET_BASE64_CHARS).regex(base64PayloadPattern),
  mimeType: z
    .string()
    .trim()
    .max(80)
    .regex(/^image\/[a-z0-9.+-]+$/i)
    .optional(),
  sourceName: z.string().min(1).max(240).optional()
})

export const terminalSaveClipboardImageInputSchema = z.object({})

export const terminalReadClipboardFilesInputSchema = z.object({})

export const browserCreateTabInputSchema = z.object({
  componentId: z.string().min(1),
  url: z.string().url().default('https://example.com'),
  partition: z.string().optional()
})

export const browserNavigateInputSchema = z.object({
  tabId: z.string().min(1),
  url: z.string().url()
})

export const browserTabInputSchema = z.object({
  tabId: z.string().min(1)
})

export const browserSelectorInputSchema = z.object({
  tabId: z.string().min(1),
  selector: z.string().min(1).max(500)
})

export const browserClickInputSchema = browserSelectorInputSchema

export const browserTypeInputSchema = browserSelectorInputSchema.extend({
  text: z.string()
})

export const browserBoundsInputSchema = browserBoundsSchema

export const pluginIdInputSchema = z.object({
  pluginId: pluginIdSchema
})

export const pluginInstallDirectoryInputSchema = z.object({
  sourcePath: z.string().min(1).optional(),
  dialogTitle: z.string().min(1).max(120).optional()
})

export const pluginRootDirectoryInputSchema = z.object({
  rootPath: z.string().min(1)
})

export const pluginConfigInputSchema = pluginIdInputSchema.extend({
  config: pluginConfigSchema
})

export const pluginInvokeInputSchema = pluginIdInputSchema.extend({
  command: z.string().min(1).max(120),
  input: z.unknown().optional()
})

export type SaveCanvasInput = z.infer<typeof saveCanvasInputSchema>
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsInputSchema>
export type TerminalCreateInput = z.infer<typeof terminalCreateSchema>
