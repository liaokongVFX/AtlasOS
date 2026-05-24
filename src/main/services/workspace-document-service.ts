import { z } from 'zod'
import {
  canvasIdInputSchema,
  createCanvasInputSchema,
  reorderCanvasesInputSchema,
  saveCanvasInputSchema
} from '@shared/ipc'
import { CanvasPersistence } from './canvas-persistence'
import { handleValidated } from './ipc-helpers'

export class WorkspaceDocumentService {
  constructor(
    private readonly persistence: CanvasPersistence,
    private readonly onWorkspaceChanged: () => void | Promise<void> = () => undefined
  ) {}

  registerIpc(): void {
    handleValidated('canvas:list', z.object({}), () => this.persistence.listCanvases())
    handleValidated('app-state:get', z.object({}), () => this.persistence.readAppState())
    handleValidated('canvas:get', canvasIdInputSchema, (_, input) => this.persistence.readCanvas(input.canvasId))
    handleValidated('canvas:create', createCanvasInputSchema, async (_, input) => {
      const result = await this.persistence.createCanvas(input.name)
      await this.onWorkspaceChanged()
      return result
    })
    handleValidated('canvas:save', saveCanvasInputSchema, async (_, input) => {
      const result = await this.persistence.saveCanvas(input.canvas)
      await this.onWorkspaceChanged()
      return result
    })
    handleValidated('canvas:set-active', canvasIdInputSchema, (_, input) => this.persistence.setActiveCanvas(input.canvasId))
    handleValidated('canvas:reorder', reorderCanvasesInputSchema, (_, input) => this.persistence.reorderCanvases(input.canvasOrder))
    handleValidated('canvas:delete', canvasIdInputSchema, async (_, input) => {
      const result = await this.persistence.deleteCanvas(input.canvasId)
      await this.onWorkspaceChanged()
      return result
    })
  }
}
