import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import { appSettingsSchema, appStateSchema, canvasDocumentSchema, type AtlasAppState, type AppSettings, type CanvasDocument } from '@shared/schema'
import { translateShared } from '@shared/locale-text'

const APP_STATE_FILE = 'app-state.json'
const CANVASES_DIR = 'canvases'
const JSON_WRITE_RETRY_DELAYS_MS = [10, 25, 50]

function nowIso(): string {
  return new Date().toISOString()
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmpPath, filePath)
      return
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code !== 'EEXIST' && code !== 'EPERM') throw error

      await rm(filePath, { force: true })
      try {
        await rename(tmpPath, filePath)
        return
      } catch (renameError) {
        const renameCode = typeof renameError === 'object' && renameError !== null && 'code' in renameError ? renameError.code : undefined
        const delay = JSON_WRITE_RETRY_DELAYS_MS[attempt]
        if (delay === undefined || (renameCode !== 'EPERM' && renameCode !== 'ENOENT')) throw renameError
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
}

const pendingJsonWrites = new Map<string, Promise<void>>()

async function writeJsonQueued(filePath: string, write: () => Promise<void>): Promise<void> {
  const previous = pendingJsonWrites.get(filePath) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(write)
  pendingJsonWrites.set(filePath, next)
  try {
    await next
  } finally {
    if (pendingJsonWrites.get(filePath) === next) pendingJsonWrites.delete(filePath)
  }
}

function createCanvasDocument(name: string): CanvasDocument {
  const timestamp = nowIso()

  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    id: randomUUID(),
    name,
    viewport: { ...DEFAULT_VIEWPORT },
    background: {
      color: DEFAULT_CANVAS_BACKGROUND.color,
      image: { ...DEFAULT_CANVAS_BACKGROUND.image }
    },
    components: [],
    groups: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export class CanvasPersistence {
  private readonly rootDir = join(app.getPath('userData'), 'workspace-documents')
  private readonly canvasDir = join(this.rootDir, CANVASES_DIR)
  private readonly appStatePath = join(this.rootDir, APP_STATE_FILE)

  constructor(private readonly readSettings: () => Promise<AppSettings> = async () => appSettingsSchema.parse({})) {}

  private async homeCanvasName(): Promise<string> {
    const settings = await this.readSettings()
    return translateShared(settings.locale, 'canvas.homeName')
  }

  private async newCanvasName(index: number): Promise<string> {
    const settings = await this.readSettings()
    return translateShared(settings.locale, 'canvas.newCanvasName', { index })
  }

  async initialize(): Promise<void> {
    await mkdir(this.canvasDir, { recursive: true })

    try {
      await this.readAppState()
    } catch {
      const canvas = createCanvasDocument(await this.homeCanvasName())
      await this.writeCanvas(canvas)
      await this.writeAppState({
        schemaVersion: ATLAS_SCHEMA_VERSION,
        activeCanvasId: canvas.id,
        canvasOrder: [canvas.id],
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    }
  }

  async readAppState(): Promise<AtlasAppState> {
    const raw = await readFile(this.appStatePath, 'utf8')
    return appStateSchema.parse(JSON.parse(raw))
  }

  async listCanvases(): Promise<CanvasDocument[]> {
    const appState = await this.readAppState()
    const canvases = await Promise.all(appState.canvasOrder.map((canvasId) => this.readCanvas(canvasId).catch(() => null)))
    return canvases.filter((canvas): canvas is CanvasDocument => Boolean(canvas))
  }

  async readCanvas(canvasId: string): Promise<CanvasDocument> {
    const raw = await readFile(this.canvasPath(canvasId), 'utf8')
    return canvasDocumentSchema.parse(JSON.parse(raw))
  }

  async createCanvas(name?: string): Promise<{ appState: AtlasAppState; canvas: CanvasDocument }> {
    const appState = await this.readAppState()
    const canvas = createCanvasDocument(name?.trim() || (await this.newCanvasName(appState.canvasOrder.length + 1)))

    await this.writeCanvas(canvas)
    const nextState = {
      ...appState,
      activeCanvasId: canvas.id,
      canvasOrder: [...appState.canvasOrder, canvas.id],
      updatedAt: nowIso()
    }
    await this.writeAppState(nextState)

    return { appState: nextState, canvas }
  }

  async saveCanvas(canvas: CanvasDocument): Promise<CanvasDocument> {
    const parsed = canvasDocumentSchema.parse({
      ...canvas,
      updatedAt: nowIso()
    })
    await this.writeCanvas(parsed)
    return parsed
  }

  async setActiveCanvas(canvasId: string): Promise<AtlasAppState> {
    const appState = await this.readAppState()
    if (!appState.canvasOrder.includes(canvasId)) {
      throw new Error('Canvas does not exist')
    }
    const nextState = { ...appState, activeCanvasId: canvasId, updatedAt: nowIso() }
    await this.writeAppState(nextState)
    return nextState
  }

  async reorderCanvases(canvasOrder: string[]): Promise<AtlasAppState> {
    const appState = await this.readAppState()
    const knownCanvasIds = new Set(appState.canvasOrder)
    const nextOrder = [...new Set(canvasOrder)]

    if (nextOrder.length !== appState.canvasOrder.length || nextOrder.some((canvasId) => !knownCanvasIds.has(canvasId))) {
      throw new Error('Canvas order does not match existing canvases')
    }

    const nextState = {
      ...appState,
      canvasOrder: nextOrder,
      updatedAt: nowIso()
    }
    await this.writeAppState(nextState)
    return nextState
  }

  async deleteCanvas(canvasId: string): Promise<AtlasAppState> {
    const appState = await this.readAppState()
    const nextOrder = appState.canvasOrder.filter((id) => id !== canvasId)

    if (nextOrder.length === 0) {
      const replacement = createCanvasDocument(await this.homeCanvasName())
      await this.writeCanvas(replacement)
      nextOrder.push(replacement.id)
    }

    await rm(this.canvasPath(canvasId), { force: true })
    const nextState = {
      ...appState,
      activeCanvasId: appState.activeCanvasId === canvasId ? nextOrder[0] : appState.activeCanvasId,
      canvasOrder: nextOrder,
      updatedAt: nowIso()
    }
    await this.writeAppState(nextState)
    return nextState
  }

  private canvasPath(canvasId: string): string {
    return join(this.canvasDir, `${canvasId}.json`)
  }

  private async writeCanvas(canvas: CanvasDocument): Promise<void> {
    const filePath = this.canvasPath(canvas.id)
    await writeJsonQueued(filePath, () => writeJsonAtomic(filePath, canvas))
  }

  private async writeAppState(appState: AtlasAppState): Promise<void> {
    await writeJsonQueued(this.appStatePath, () => writeJsonAtomic(this.appStatePath, appStateSchema.parse(appState)))
  }
}
