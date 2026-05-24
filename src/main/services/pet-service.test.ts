import { mkdir, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import { DEFAULT_PET_SETTINGS, type PetAgentSession, type PetRuntimeState } from '@shared/pet'
import type { AppSettings, CanvasDocument } from '@shared/schema'
import { PetService } from './pet-service'

type MockWindow = {
  options: Record<string, unknown>
  webContents: {
    send: ReturnType<typeof vi.fn>
    isDestroyed: () => boolean
  }
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  once: ReturnType<typeof vi.fn>
}

type MockNotification = {
  options: { title: string; body?: string }
  on: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  click: () => void
}

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  userDataPath: '',
  displays: [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  windows: [] as MockWindow[],
  notifications: [] as MockNotification[],
  notificationSupported: true
}))

vi.mock('electron', () => {
  class BrowserWindow {
    private destroyed = false
    options: Record<string, unknown>
    webContents = {
      send: vi.fn(),
      isDestroyed: () => this.destroyed
    }
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    setBounds = vi.fn()
    showInactive = vi.fn()
    hide = vi.fn()
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    isDestroyed = () => this.destroyed
    once = vi.fn()

    constructor(options: Record<string, unknown>) {
      this.options = options
      electronMocks.windows.push(this as unknown as MockWindow)
    }
  }

  class Notification {
    private listeners = new Map<string, () => void>()
    options: { title: string; body?: string }
    on = vi.fn((event: string, listener: () => void) => {
      this.listeners.set(event, listener)
    })
    show = vi.fn()
    click = () => {
      this.listeners.get('click')?.()
    }

    static isSupported(): boolean {
      return electronMocks.notificationSupported
    }

    constructor(options: { title: string; body?: string }) {
      this.options = options
      electronMocks.notifications.push(this as unknown as MockNotification)
    }
  }

  return {
    app: {
      getPath: vi.fn(() => electronMocks.userDataPath)
    },
    BrowserWindow,
    Notification,
    ipcMain: {
      handle: electronMocks.ipcHandle
    },
    screen: {
      getPrimaryDisplay: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 }
      })),
      getDisplayNearestPoint: vi.fn((point: { x: number; y: number }) => {
        const matchingDisplay = electronMocks.displays.find(({ workArea }) => {
          return point.x >= workArea.x && point.x < workArea.x + workArea.width && point.y >= workArea.y && point.y < workArea.y + workArea.height
        })
        if (matchingDisplay) return matchingDisplay

        return electronMocks.displays.reduce((nearest, display) => {
          const distanceToDisplay = ({ workArea }: { workArea: { x: number; y: number; width: number; height: number } }) => {
            const right = workArea.x + workArea.width
            const bottom = workArea.y + workArea.height
            const dx = point.x < workArea.x ? workArea.x - point.x : point.x > right ? point.x - right : 0
            const dy = point.y < workArea.y ? workArea.y - point.y : point.y > bottom ? point.y - bottom : 0
            return dx * dx + dy * dy
          }
          return distanceToDisplay(display) < distanceToDisplay(nearest) ? display : nearest
        }, electronMocks.displays[0])
      })
    }
  }
})

const testRoot = join(process.cwd(), '.atlasos-dev', 'pet-service-test')
const userDataPath = join(testRoot, 'user-data')
const activeServices = new Set<PetService>()

function dateString(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function createSettings(pet: Partial<AppSettings['pet']> = {}): AppSettings {
  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    locale: 'zh-CN',
    shortcuts: {
      canvasDeselect: 'Ctrl+Q',
      canvasFind: 'Ctrl+F',
      canvasCreateComponent: 'Tab'
    },
    pet: {
      ...DEFAULT_PET_SETTINGS,
      ...pet,
      position: { ...DEFAULT_PET_SETTINGS.position, ...pet.position },
      kanban: { ...DEFAULT_PET_SETTINGS.kanban, ...pet.kanban },
      agentBridge: { ...DEFAULT_PET_SETTINGS.agentBridge, ...pet.agentBridge },
      assetPack: { ...DEFAULT_PET_SETTINGS.assetPack, ...pet.assetPack },
      actionMap: { ...DEFAULT_PET_SETTINGS.actionMap, ...pet.actionMap }
    }
  }
}

function createCanvas(): CanvasDocument {
  const today = dateString()
  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    id: 'canvas-1',
    name: 'Main canvas',
    viewport: DEFAULT_VIEWPORT,
    background: DEFAULT_CANVAS_BACKGROUND,
    components: [
      {
        id: 'kanban-1',
        type: 'kanban',
        title: 'Team board',
        frame: { x: 0, y: 0, width: 920, height: 620 },
        zIndex: 0,
        config: {},
        state: {
          kanban: {
            columns: [
              { id: 'backlog', title: 'Backlog', cardIds: ['due', 'overdue', 'future'], wipLimit: null },
              { id: 'done', title: 'Done', cardIds: ['done'], wipLimit: null }
            ],
            cards: {
              due: { title: 'Due card', dueDate: today },
              overdue: { title: 'Overdue card', dueDate: dateString(-1) },
              future: { title: 'Future card', dueDate: dateString(1) },
              done: { title: 'Done card', dueDate: today }
            }
          }
        },
        bindings: {},
        createdAt: today,
        updatedAt: today
      }
    ],
    createdAt: today,
    updatedAt: today
  }
}

function createService(input: { settings?: AppSettings; canvases?: CanvasDocument[] } = {}) {
  let settings = input.settings ?? createSettings({ showNativeNotifications: false, agentBridge: { enabled: false } })
  const loadPetRenderer = vi.fn(async () => undefined)
  const openTarget = vi.fn(async () => undefined)
  const persistence = {
    listCanvases: vi.fn(async () => input.canvases ?? [])
  }
  const appSettingsService = {
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async (nextSettings: AppSettings) => {
      settings = nextSettings
      return settings
    })
  }
  const service = new PetService({
    persistence: persistence as never,
    appSettingsService: appSettingsService as never,
    loadPetRenderer,
    openTarget
  })
  activeServices.add(service)

  return { service, persistence, appSettingsService, loadPetRenderer, openTarget }
}

function ipcHandler(channel: string): (event: unknown, payload: unknown) => Promise<unknown> {
  const handler = electronMocks.ipcHandle.mock.calls.find(([registeredChannel]) => registeredChannel === channel)?.[1]
  expect(handler).toBeDefined()
  return handler
}

function postAgentEvent(port: number, token: string, body: unknown): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/agent-event',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-atlas-pet-token': token
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )

    req.on('error', reject)
    req.end(payload)
  })
}

describe('PetService', () => {
  beforeEach(async () => {
    electronMocks.ipcHandle.mockClear()
    electronMocks.displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
    electronMocks.windows.splice(0, electronMocks.windows.length)
    electronMocks.notifications.splice(0, electronMocks.notifications.length)
    electronMocks.notificationSupported = true
    electronMocks.userDataPath = userDataPath

    await rm(testRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
  })

  afterEach(() => {
    for (const service of activeServices) service.dispose()
    activeServices.clear()
  })

  it('creates a transparent click-through pet window', async () => {
    const { service, loadPetRenderer } = createService()

    await service.start()

    const window = electronMocks.windows[0]
    expect(window.options).toMatchObject({
      width: 640,
      height: 420,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000'
    })
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true })
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    expect(loadPetRenderer).toHaveBeenCalledWith(window)

    service.dispose()
  })

  it('anchors the orb on the nearest display and opens the panel left at the right edge', async () => {
    electronMocks.displays = [
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      { workArea: { x: 1920, y: 0, width: 1280, height: 1024 } }
    ]
    const { service, appSettingsService } = createService({
      settings: createSettings({
        position: { x: 3060, y: 140 },
        showNativeNotifications: false,
        agentBridge: { enabled: false }
      })
    })

    await service.start()

    const window = electronMocks.windows[0]
    expect(window.options).toMatchObject({
      x: 2776,
      y: 128,
      width: 640,
      height: 420
    })

    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    expect(state.window.panelSide).toBe('left')

    const setPosition = ipcHandler('pet:set-position')
    await setPosition({}, { x: 3200, y: 1100 })

    expect(appSettingsService.updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pet: expect.objectContaining({
          position: { x: 3128, y: 952 }
        })
      })
    )
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 2844, y: 604, width: 640, height: 420 })

    service.dispose()
  })

  it('keeps the orb window anchor stable when the panel side changes', async () => {
    const { service } = createService({
      settings: createSettings({
        position: { x: 1500, y: 140 },
        showNativeNotifications: false,
        agentBridge: { enabled: false }
      })
    })

    await service.start()

    const window = electronMocks.windows[0]
    expect(window.options).toMatchObject({ x: 1216, y: 128 })

    const setPosition = ipcHandler('pet:set-position')
    await setPosition({}, { x: 1600, y: 140 })
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 1316, y: 128, width: 640, height: 420 })

    await setPosition({}, { x: 1560, y: 140 })
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 1276, y: 128, width: 640, height: 420 })

    service.dispose()
  })

  it('creates daily Kanban due alerts while ignoring future and done cards', async () => {
    const { service } = createService({ canvases: [createCanvas()] })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState

    expect(state.alerts.map((alert) => alert.target.cardId).sort()).toEqual(['due', 'overdue'])
    expect(state.alerts.map((alert) => alert.title)).toEqual(expect.arrayContaining(['Due today: Due card', 'Overdue: Overdue card']))

    await service.scanKanban()
    const dedupedState = (await getState({}, {})) as typeof state
    expect(dedupedState.alerts).toHaveLength(2)

    service.dispose()
  })

  it('marks and snoozes alerts through IPC', async () => {
    const { service } = createService({ canvases: [createCanvas()] })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const ackAlert = ipcHandler('pet:ack-alert')
    const snoozeAlert = ipcHandler('pet:snooze-alert')
    const state = (await getState({}, {})) as PetRuntimeState
    const [alert] = state.alerts

    await ackAlert({}, { alertId: alert.id })
    await snoozeAlert({}, { alertId: alert.id, minutes: 15 })

    const updatedState = (await getState({}, {})) as typeof state
    const updatedAlert = updatedState.alerts.find((item) => item.id === alert.id)
    expect(updatedAlert?.readAt).toBeDefined()
    expect(updatedAlert?.snoozedUntil).toBeDefined()

    service.dispose()
  })

  it('accepts only token-authorized agent bridge events', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState

    const rejected = await postAgentEvent(state.bridge.port, 'wrong', {})
    expect(rejected.statusCode).toBe(401)

    const accepted = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        source: 'codex',
        event: 'waiting_for_confirmation',
        sessionId: 'session-1',
        canvasId: 'canvas-1',
        componentId: 'terminal-1',
        title: 'Codex run',
        cwd: 'D:\\projects\\AtlasOS'
      }
    )
    expect(accepted.statusCode).toBe(200)

    const updatedState = (await getState({}, {})) as typeof state
    expect(updatedState.agentSessions[0]).toMatchObject({
      id: 'session-1',
      source: 'codex',
      status: 'waiting_for_confirmation',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex run'
    })
    expect(updatedState.alerts[0]).toMatchObject({ kind: 'agent_waiting', target: { sessionId: 'session-1' } })

    service.dispose()
  })

  it('opens the alert target when a native notification is clicked', async () => {
    const { service, openTarget } = createService({
      settings: createSettings({
        showNativeNotifications: true,
        agentBridge: { enabled: false }
      })
    })
    const session: PetAgentSession = {
      id: 'session-1',
      source: 'claude',
      status: 'waiting_for_confirmation',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Claude Code',
      cwd: 'D:\\projects\\AtlasOS',
      lastActivityAt: new Date().toISOString()
    }

    await service.start()
    service.upsertAgentSession(session)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(electronMocks.notifications).toHaveLength(1)
    expect(electronMocks.notifications[0].show).toHaveBeenCalled()

    electronMocks.notifications[0].click()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(openTarget).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      sessionId: 'session-1'
    })

    service.dispose()
  })
})
