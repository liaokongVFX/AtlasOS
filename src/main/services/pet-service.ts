import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, Notification, screen, type WebContents } from 'electron'
import { z } from 'zod'
import {
  petAgentEventInputSchema,
  petAlertInputSchema,
  petOpenTargetInputSchema,
  petSetInteractiveInputSchema,
  petSetPositionInputSchema,
  petSnoozeAlertInputSchema,
  petUpdateSettingsInputSchema,
  type PetAgentEventInput
} from '@shared/ipc'
import {
  petAlertSchema,
  petAgentSessionSchema,
  petRuntimeStateSchema,
  type PetAgentSession,
  type PetAlert,
  type PetAlertTarget,
  type PetRuntimeState
} from '@shared/pet'
import type { AppSettings, CanvasComponent, CanvasDocument } from '@shared/schema'
import { handleValidated } from './ipc-helpers'
import { CanvasPersistence } from './canvas-persistence'
import { AppSettingsService } from './app-settings-service'

type PetServiceOptions = {
  persistence: CanvasPersistence
  appSettingsService: AppSettingsService
  loadPetRenderer: (window: BrowserWindow) => Promise<void>
  openTarget: (target: PetAlertTarget) => Promise<void>
}

type StoredPetState = {
  bridgeToken: string
  alerts: PetAlert[]
}

const PET_STATE_DIR = 'pet'
const PET_STATE_FILE = 'state.json'
const MAX_ALERTS = 100
const KANBAN_SCAN_INTERVAL_MS = 60_000
const PET_ORB_SIZE = 72
const PET_WINDOW_PADDING = 12
const PET_PANEL_GAP = 12
const PET_PANEL_WIDTH = 260
const PET_ORB_OFFSET_X = PET_WINDOW_PADDING + PET_PANEL_WIDTH + PET_PANEL_GAP
const PET_WINDOW_WIDTH = PET_WINDOW_PADDING * 2 + PET_PANEL_WIDTH * 2 + PET_PANEL_GAP * 2 + PET_ORB_SIZE
const PET_WINDOW_HEIGHT = 420

type PetPanelSide = 'left' | 'right'

type PetWindowLayout = {
  x: number
  y: number
  panelSide: PetPanelSide
  orbPosition: {
    x: number
    y: number
  }
}

type WorkArea = {
  x: number
  y: number
  width: number
  height: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function todayDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(tmpPath, filePath)
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined
    if (code !== 'EEXIST' && code !== 'EPERM') throw error

    await rm(filePath, { force: true })
    await rename(tmpPath, filePath)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readCards(component: CanvasComponent): Record<string, Record<string, unknown>> {
  const kanban = component.state.kanban
  if (!isRecord(kanban) || !isRecord(kanban.cards)) return {}

  const cards: Record<string, Record<string, unknown>> = {}
  for (const [cardId, card] of Object.entries(kanban.cards)) {
    if (isRecord(card)) cards[cardId] = card
  }
  return cards
}

function readActiveKanbanCardIds(component: CanvasComponent): string[] {
  const kanban = component.state.kanban
  if (!isRecord(kanban) || !Array.isArray(kanban.columns)) return Object.keys(readCards(component))

  const ids: string[] = []
  for (const column of kanban.columns) {
    if (!isRecord(column) || asString(column.id) === 'done' || !Array.isArray(column.cardIds)) continue
    for (const cardId of column.cardIds) {
      if (typeof cardId === 'string') ids.push(cardId)
    }
  }
  return ids
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function nearestDisplayWorkArea(position: { x: number; y: number }): WorkArea {
  const nearestPoint = {
    x: position.x + Math.floor(PET_ORB_SIZE / 2),
    y: position.y + Math.floor(PET_ORB_SIZE / 2)
  }
  const display = screen.getDisplayNearestPoint(nearestPoint)
  return display.workArea
}

function petWindowLayout(settings: AppSettings): PetWindowLayout {
  const workArea = nearestDisplayWorkArea(settings.pet.position)
  const maxOrbX = workArea.x + workArea.width - PET_ORB_SIZE
  const maxOrbY = workArea.y + workArea.height - PET_ORB_SIZE
  const orbX = clamp(settings.pet.position.x, workArea.x, maxOrbX)
  const orbY = clamp(settings.pet.position.y, workArea.y, maxOrbY)
  const sideSpace = PET_PANEL_WIDTH + PET_PANEL_GAP
  const canOpenRight = workArea.x + workArea.width - (orbX + PET_ORB_SIZE) >= sideSpace
  const canOpenLeft = orbX - workArea.x >= sideSpace
  const panelSide: PetPanelSide = canOpenRight || !canOpenLeft ? 'right' : 'left'
  const maxWindowY = workArea.y + workArea.height - PET_WINDOW_HEIGHT

  return {
    x: orbX - PET_ORB_OFFSET_X,
    y: clamp(orbY - PET_WINDOW_PADDING, workArea.y, maxWindowY),
    panelSide,
    orbPosition: {
      x: orbX,
      y: orbY
    }
  }
}

function normalizeStoredState(value: unknown): StoredPetState {
  if (!isRecord(value)) return { bridgeToken: randomUUID(), alerts: [] }

  const alerts = Array.isArray(value.alerts)
    ? value.alerts.flatMap((alert) => {
        const result = petAlertSchema.safeParse(alert)
        return result.success ? [result.data] : []
      })
    : []

  return {
    bridgeToken: asString(value.bridgeToken) || randomUUID(),
    alerts: alerts.slice(0, MAX_ALERTS)
  }
}

function eventStatus(event: PetAgentEventInput['event']): PetAgentSession['status'] {
  if (event === 'waiting_for_confirmation') return 'waiting_for_confirmation'
  if (event === 'completed') return 'completed'
  if (event === 'error') return 'error'
  return 'running'
}

function alertForAgentEvent(event: PetAgentEventInput, session: PetAgentSession): PetAlert | null {
  if (event.event === 'running') return null

  const createdAt = nowIso()
  const severity = event.event === 'error' ? 'danger' : event.event === 'waiting_for_confirmation' ? 'warning' : 'info'
  const kind = event.event === 'error' ? 'agent_error' : event.event === 'completed' ? 'agent_completed' : 'agent_waiting'
  const title = event.title || `${event.source === 'codex' ? 'Codex' : 'Claude Code'} ${event.event.replace(/_/g, ' ')}`

  return {
    id: randomUUID(),
    kind,
    severity,
    title,
    body: event.body || session.cwd || '',
    target: {
      canvasId: session.canvasId,
      componentId: session.componentId,
      sessionId: session.id
    },
    createdAt,
    dedupeKey: `agent:${session.id}:${event.event}:${createdAt.slice(0, 16)}`
  }
}

export class PetService {
  private readonly stateDir = join(app.getPath('userData'), PET_STATE_DIR)
  private readonly statePath = join(this.stateDir, PET_STATE_FILE)
  private petWindow: BrowserWindow | null = null
  private storedState: StoredPetState = { bridgeToken: randomUUID(), alerts: [] }
  private agentSessions = new Map<string, PetAgentSession>()
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private bridgeServer: Server | null = null
  private bridgePort = 0

  constructor(private readonly options: PetServiceOptions) {}

  async start(): Promise<void> {
    this.storedState = await this.readStoredState()
    this.registerIpc()
    await this.ensureBridge()
    await this.ensurePetWindow()
    await this.scanKanban()

    if (!this.scanTimer) {
      this.scanTimer = setInterval(() => {
        void this.scanKanban()
      }, KANBAN_SCAN_INTERVAL_MS)
    }
  }

  dispose(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer)
      this.scanTimer = null
    }

    this.bridgeServer?.close()
    this.bridgeServer = null

    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.destroy()
    }
    this.petWindow = null
  }

  async scanKanban(): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (!settings.pet.enabled || !settings.pet.kanban.enabled) return

    const canvases = await this.options.persistence.listCanvases()
    const dueDate = todayDate()

    for (const canvas of canvases) {
      for (const component of canvas.components) {
        if (component.type !== 'kanban') continue
        this.scanKanbanComponent(canvas, component, dueDate)
      }
    }

    await this.persistAndBroadcast()
  }

  upsertAgentSession(session: PetAgentSession): void {
    const parsed = petAgentSessionSchema.safeParse(session)
    if (!parsed.success) return

    const previous = this.agentSessions.get(parsed.data.id)
    this.agentSessions.set(parsed.data.id, parsed.data)
    const statusChanged = previous?.status !== parsed.data.status
    if (statusChanged && ['waiting_for_confirmation', 'completed', 'error'].includes(parsed.data.status)) {
      this.addAlert(this.alertForAgentSession(parsed.data))
    }
    void this.persistAndBroadcast()
  }

  removeAgentSession(sessionId: string): void {
    if (!this.agentSessions.delete(sessionId)) return
    void this.broadcastState()
  }

  private registerIpc(): void {
    handleValidated('pet:get-state', z.object({}), async () => {
      await this.scanKanban()
      return this.getRuntimeState()
    })

    handleValidated('pet:update-settings', petUpdateSettingsInputSchema, async (_, input) => {
      const settings = await this.options.appSettingsService.getSettings()
      const saved = await this.options.appSettingsService.updateSettings({
        ...settings,
        pet: input.settings
      })
      await this.applySettings(saved)
      await this.persistAndBroadcast()
      return saved.pet
    })

    handleValidated('pet:ack-alert', petAlertInputSchema, async (_, input) => {
      this.markAlertRead(input.alertId)
      await this.persistAndBroadcast()
      return { ok: true }
    })

    handleValidated('pet:snooze-alert', petSnoozeAlertInputSchema, async (_, input) => {
      const alert = this.storedState.alerts.find((item) => item.id === input.alertId)
      if (alert) alert.snoozedUntil = new Date(Date.now() + input.minutes * 60_000).toISOString()
      await this.persistAndBroadcast()
      return { ok: true }
    })

    handleValidated('pet:set-position', petSetPositionInputSchema, async (_, input) => {
      const settings = await this.options.appSettingsService.getSettings()
      const nextSettings = {
        ...settings,
        pet: {
          ...settings.pet,
          position: { x: input.x, y: input.y }
        }
      }
      const layout = petWindowLayout(nextSettings)
      const saved = await this.options.appSettingsService.updateSettings({
        ...nextSettings,
        pet: {
          ...nextSettings.pet,
          position: layout.orbPosition
        }
      })
      this.petWindow?.setBounds({ x: layout.x, y: layout.y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT })
      await this.broadcastState()
      return saved.pet.position
    })

    handleValidated('pet:set-interactive', petSetInteractiveInputSchema, (_, input) => {
      this.setPetInteractive(input.interactive)
      return { ok: true }
    })

    handleValidated('pet:open-target', petOpenTargetInputSchema, async (_, input) => {
      await this.options.openTarget(input.target)
      return { ok: true }
    })

    handleValidated('pet:agent-event', petAgentEventInputSchema, async (_, input) => {
      await this.applyAgentEvent(input)
      return { ok: true }
    })

    handleValidated('pet:list-agent-sessions', z.object({}), () => [...this.agentSessions.values()])
  }

  private async ensurePetWindow(): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (!settings.pet.enabled) return

    const layout = petWindowLayout(settings)
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.setBounds({ x: layout.x, y: layout.y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT })
      this.petWindow.showInactive()
      return
    }

    const window = new BrowserWindow({
      x: layout.x,
      y: layout.y,
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    this.petWindow = window
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.setPetInteractive(false)

    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    window.once('closed', () => {
      if (this.petWindow === window) this.petWindow = null
    })

    await this.options.loadPetRenderer(window)
  }

  private setPetInteractive(interactive: boolean): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return
    this.petWindow.setIgnoreMouseEvents(!interactive, { forward: true })
  }

  private async applySettings(settings: AppSettings): Promise<void> {
    if (settings.pet.enabled) {
      await this.ensurePetWindow()
      await this.ensureBridge()
      const layout = petWindowLayout(settings)
      this.petWindow?.setBounds({ x: layout.x, y: layout.y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT })
    } else if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.hide()
    }

    if (!settings.pet.enabled || !settings.pet.agentBridge.enabled) {
      this.bridgeServer?.close()
      this.bridgeServer = null
      this.bridgePort = 0
    }
  }

  private scanKanbanComponent(canvas: CanvasDocument, component: CanvasComponent, dueDate: string): void {
    const cards = readCards(component)
    const activeCardIds = readActiveKanbanCardIds(component)

    for (const cardId of activeCardIds) {
      const card = cards[cardId]
      if (!card) continue

      const cardDueDate = asString(card.dueDate)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cardDueDate) || cardDueDate > dueDate) continue

      const title = asString(card.title).trim() || 'Kanban card'
      const dedupeKey = `kanban:${canvas.id}:${component.id}:${cardId}:${dueDate}`
      this.addAlert({
        id: randomUUID(),
        kind: 'kanban_due',
        severity: cardDueDate < dueDate ? 'warning' : 'info',
        title: cardDueDate < dueDate ? `Overdue: ${title}` : `Due today: ${title}`,
        body: `${canvas.name} / ${component.title}`,
        target: { canvasId: canvas.id, componentId: component.id, cardId },
        createdAt: nowIso(),
        dedupeKey
      })
    }
  }

  private addAlert(alert: PetAlert): boolean {
    if (this.storedState.alerts.some((item) => item.dedupeKey === alert.dedupeKey)) return false

    this.storedState.alerts = [alert, ...this.storedState.alerts].slice(0, MAX_ALERTS)
    void this.showNativeNotification(alert)
    return true
  }

  private markAlertRead(alertId: string): void {
    const alert = this.storedState.alerts.find((item) => item.id === alertId)
    if (!alert || alert.readAt) return
    alert.readAt = nowIso()
  }

  private alertForAgentSession(session: PetAgentSession): PetAlert {
    const titlePrefix = session.source === 'codex' ? 'Codex' : 'Claude Code'
    const statusLabel =
      session.status === 'waiting_for_confirmation'
        ? 'needs confirmation'
        : session.status === 'completed'
          ? 'completed'
          : session.status === 'error'
            ? 'reported an error'
            : 'updated'

    return {
      id: randomUUID(),
      kind: session.status === 'error' ? 'agent_error' : session.status === 'completed' ? 'agent_completed' : 'agent_waiting',
      severity: session.status === 'error' ? 'danger' : session.status === 'waiting_for_confirmation' ? 'warning' : 'info',
      title: `${titlePrefix} ${statusLabel}`,
      body: session.title,
      target: {
        canvasId: session.canvasId,
        componentId: session.componentId,
        sessionId: session.id
      },
      createdAt: nowIso(),
      dedupeKey: `agent:${session.id}:${session.status}:${todayDate()}`
    }
  }

  private async showNativeNotification(alert: PetAlert): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (!settings.pet.showNativeNotifications || !Notification.isSupported()) return

    const notification = new Notification({ title: alert.title, body: alert.body })
    notification.on('click', () => {
      this.markAlertRead(alert.id)
      void this.options.openTarget(alert.target)
      void this.persistAndBroadcast()
    })
    notification.show()
  }

  private async applyAgentEvent(event: PetAgentEventInput): Promise<void> {
    const sessionId = event.sessionId || event.componentId || randomUUID()
    const current = this.agentSessions.get(sessionId)
    const timestamp = nowIso()
    const session: PetAgentSession = {
      id: sessionId,
      source: event.source,
      status: eventStatus(event.event),
      canvasId: event.canvasId || current?.canvasId || 'unknown-canvas',
      componentId: event.componentId || current?.componentId || sessionId,
      title: event.title || current?.title || (event.source === 'codex' ? 'Codex' : 'Claude Code'),
      cwd: event.cwd || current?.cwd,
      lastActivityAt: timestamp,
      attentionReason: event.body || current?.attentionReason
    }

    const parsed = petAgentSessionSchema.safeParse(session)
    if (parsed.success) {
      this.agentSessions.set(parsed.data.id, parsed.data)
      const alert = alertForAgentEvent(event, parsed.data)
      if (alert) this.addAlert(alert)
      await this.persistAndBroadcast()
    }
  }

  private async ensureBridge(): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (!settings.pet.enabled || !settings.pet.agentBridge.enabled || this.bridgeServer) return

    this.bridgeServer = createServer((request, response) => {
      void this.handleBridgeRequest(request, response)
    })

    await new Promise<void>((resolve, reject) => {
      this.bridgeServer?.once('error', reject)
      this.bridgeServer?.listen(0, '127.0.0.1', () => {
        const address = this.bridgeServer?.address()
        this.bridgePort = typeof address === 'object' && address ? address.port : 0
        this.bridgeServer?.off('error', reject)
        resolve()
      })
    })
  }

  private async handleBridgeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== '/agent-event') {
      response.writeHead(404)
      response.end('not found')
      return
    }

    const token = request.headers['x-atlas-pet-token'] || request.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (token !== this.storedState.bridgeToken) {
      response.writeHead(401)
      response.end('unauthorized')
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      if (Buffer.concat(chunks).length > 32_768) {
        response.writeHead(413)
        response.end('too large')
        return
      }
    }

    try {
      const event = petAgentEventInputSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      await this.applyAgentEvent(event)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"ok":true}')
    } catch {
      response.writeHead(400)
      response.end('bad request')
    }
  }

  private async getRuntimeState(): Promise<PetRuntimeState> {
    const settings = await this.options.appSettingsService.getSettings()
    const layout = petWindowLayout(settings)
    return petRuntimeStateSchema.parse({
      settings: settings.pet,
      alerts: this.storedState.alerts,
      agentSessions: [...this.agentSessions.values()],
      window: {
        panelSide: layout.panelSide
      },
      bridge: {
        enabled: settings.pet.agentBridge.enabled,
        port: this.bridgePort,
        token: this.storedState.bridgeToken
      }
    })
  }

  private async broadcastState(): Promise<void> {
    const state = await this.getRuntimeState()
    const targets: Array<WebContents | null> = [this.petWindow?.webContents ?? null]
    for (const target of targets) {
      if (!target || target.isDestroyed()) continue
      target.send('pet:state-updated', state)
    }
  }

  private async persistAndBroadcast(): Promise<void> {
    await this.writeStoredState()
    await this.broadcastState()
  }

  private async readStoredState(): Promise<StoredPetState> {
    await mkdir(this.stateDir, { recursive: true })

    try {
      return normalizeStoredState(JSON.parse(await readFile(this.statePath, 'utf8')))
    } catch {
      const state = normalizeStoredState(null)
      await this.writeStoredState(state)
      return state
    }
  }

  private async writeStoredState(state = this.storedState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    await writeJsonAtomic(this.statePath, state)
  }
}
