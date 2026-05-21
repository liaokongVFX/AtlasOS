import { z } from 'zod'
import { browserBoundsSchema, canvasDocumentSchema, terminalCreateSchema } from './schema'

export const createCanvasInputSchema = z.object({
  name: z.string().min(1).max(80).optional()
})

export const canvasIdInputSchema = z.object({
  canvasId: z.string().min(1)
})

export const saveCanvasInputSchema = z.object({
  canvas: canvasDocumentSchema
})

export const chooseDirectoryInputSchema = z.object({
  title: z.string().optional()
})

export const listTreeInputSchema = z.object({
  rootPath: z.string().min(1),
  maxDepth: z.number().int().min(0).max(8).default(4)
})

export const fileOperationInputSchema = z.object({
  rootPath: z.string().min(1),
  targetPath: z.string().min(1),
  name: z.string().min(1).max(240).optional(),
  contents: z.string().optional()
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

export type SaveCanvasInput = z.infer<typeof saveCanvasInputSchema>
export type TerminalCreateInput = z.infer<typeof terminalCreateSchema>
