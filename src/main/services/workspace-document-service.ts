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
  constructor(private readonly persistence: CanvasPersistence) {}

  registerIpc(): void {
    handleValidated('canvas:list', z.object({}), () => this.persistence.listCanvases())
    handleValidated('app-state:get', z.object({}), () => this.persistence.readAppState())
    handleValidated('canvas:get', canvasIdInputSchema, (_, input) => this.persistence.readCanvas(input.canvasId))
    handleValidated('canvas:create', createCanvasInputSchema, (_, input) => this.persistence.createCanvas(input.name))
    handleValidated('canvas:save', saveCanvasInputSchema, (_, input) => this.persistence.saveCanvas(input.canvas))
    handleValidated('canvas:set-active', canvasIdInputSchema, (_, input) => this.persistence.setActiveCanvas(input.canvasId))
    handleValidated('canvas:reorder', reorderCanvasesInputSchema, (_, input) => this.persistence.reorderCanvases(input.canvasOrder))
    handleValidated('canvas:delete', canvasIdInputSchema, (_, input) => this.persistence.deleteCanvas(input.canvasId))
  }
}
