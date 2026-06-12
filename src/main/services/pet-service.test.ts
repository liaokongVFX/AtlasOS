import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import { DEFAULT_PET_SETTINGS, type PetAgentSession, type PetRuntimeState } from '@shared/pet'
import type { AppSettings, CanvasDocument } from '@shared/schema'
import { createDefaultTerminalCommandLibrary } from '@shared/terminal-commands'
import { DEFAULT_UPDATE_SETTINGS } from '@shared/updates'
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

const osMocks = vi.hoisted(() => ({
  homePath: ''
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

vi.mock('node:os', () => ({
  homedir: vi.fn(() => osMocks.homePath),
  default: {
    homedir: vi.fn(() => osMocks.homePath)
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'pet-service-test')
const userDataPath = join(testRoot, 'user-data')
const homePath = join(testRoot, 'home')
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
      canvasCreateComponent: 'Tab',
      canvasGroupSelection: 'Ctrl+G',
      canvasUngroupSelection: 'Ctrl+Shift+G'
    },
    pet: {
      ...DEFAULT_PET_SETTINGS,
      ...pet,
      position: { ...DEFAULT_PET_SETTINGS.position, ...pet.position },
      kanban: { ...DEFAULT_PET_SETTINGS.kanban, ...pet.kanban },
      alertSound: { ...DEFAULT_PET_SETTINGS.alertSound, ...pet.alertSound },
      agentBridge: { ...DEFAULT_PET_SETTINGS.agentBridge, ...pet.agentBridge },
      assetPack: { ...DEFAULT_PET_SETTINGS.assetPack, ...pet.assetPack },
      actionMap: { ...DEFAULT_PET_SETTINGS.actionMap, ...pet.actionMap }
    },
    terminalCommands: createDefaultTerminalCommandLibrary(),
    updates: { ...DEFAULT_UPDATE_SETTINGS }
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
    groups: [],
    createdAt: today,
    updatedAt: today
  }
}

function createCanvasWithTerminal(title = 'Agent terminal'): CanvasDocument {
  const canvas = createCanvas()
  const timestamp = dateString()
  canvas.components.push({
    id: 'terminal-1',
    type: 'terminal',
    title,
    frame: { x: 80, y: 80, width: 720, height: 420 },
    zIndex: 1,
    config: {},
    state: {},
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp
  })
  return canvas
}

function createService(input: {
  settings?: AppSettings
  canvases?: CanvasDocument[]
  onAgentProviderSessionResolved?: (context: {
    terminalSessionId: string
    source: string
    providerSessionId: string
    componentId: string
    canvasId?: string
    cwd?: string
  }) => void
} = {}) {
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
    openTarget,
    onAgentProviderSessionResolved: input.onAgentProviderSessionResolved
  })
  activeServices.add(service)

  return { service, persistence, appSettingsService, loadPetRenderer, openTarget }
}

function ipcHandler(channel: string): (event: unknown, payload: unknown) => Promise<unknown> {
  const handler = electronMocks.ipcHandle.mock.calls.find(([registeredChannel]) => registeredChannel === channel)?.[1]
  expect(handler).toBeDefined()
  return handler
}

function postAgentEvent(port: number, token: string, body: unknown, path = '/agent-hook/codex'): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
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

function providerAgentSessionId(terminalSessionId: string, source: 'codex' | 'claude', providerSessionId: string): string {
  return `${terminalSessionId}:${source}:${providerSessionId}`
}

function sanitizedForwarderEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('ATLAS_PET_') && !key.startsWith('ATLAS_TERMINAL_') && !key.startsWith('ATLAS_CANVAS_')
    )
  )
}

function runHookForwarder(
  scriptPath: string,
  source: 'claude' | 'codex',
  body: unknown,
  hookName?: string,
  env: NodeJS.ProcessEnv = {}
): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, source, ...(hookName ? [hookName] : [])], {
      cwd: process.cwd(),
      env: { ...sanitizedForwarderEnv(), ...env },
      stdio: ['pipe', 'ignore', 'pipe']
    })
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Hook forwarder timed out'))
    }, 5000)

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('exit', (exitCode) => {
      clearTimeout(timeout)
      resolve({ exitCode, stderr })
    })
    child.stdin.end(JSON.stringify(body))
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
    osMocks.homePath = homePath

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
    expect(state.window.orbOffset).toEqual({ x: 284, y: 12 })

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

    const bottomState = (await getState({}, {})) as PetRuntimeState
    expect(bottomState.settings.position).toEqual({ x: 3128, y: 952 })
    expect(bottomState.window.orbOffset).toEqual({ x: 284, y: 348 })

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

  it('clears selected and all alerts through IPC', async () => {
    const { service } = createService({ canvases: [createCanvas()] })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const clearAlerts = ipcHandler('pet:clear-alerts')
    const state = (await getState({}, {})) as PetRuntimeState
    const [firstAlert, secondAlert] = state.alerts

    await clearAlerts({}, { alertIds: [firstAlert.id] })

    let updatedState = (await getState({}, {})) as typeof state
    expect(updatedState.alerts.find((item) => item.id === firstAlert.id)?.readAt).toBeDefined()
    expect(updatedState.alerts.find((item) => item.id === secondAlert.id)?.readAt).toBeUndefined()

    await clearAlerts({}, {})

    updatedState = (await getState({}, {})) as typeof state
    expect(updatedState.alerts.every((alert) => alert.readAt)).toBe(true)

    service.dispose()
  })

  it('adds the current canvas component title to visible agent sessions', async () => {
    const canvas = createCanvasWithTerminal('Review agent window')
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        kanban: { enabled: false },
        agentBridge: { enabled: false }
      }),
      canvases: [canvas]
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const listAgentSessions = ipcHandler('pet:list-agent-sessions')

    service.recordAgentCommandStarted({
      source: 'codex',
      sessionId: 'session-1',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex task',
      cwd: 'D:\\projects\\AtlasOS'
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    let state = (await getState({}, {})) as PetRuntimeState
    expect(state.agentSessions[0]).toMatchObject({
      id: 'session-1',
      title: 'Codex task',
      componentTitle: 'Review agent window'
    })

    canvas.components.find((component) => component.id === 'terminal-1')!.title = 'Renamed agent window'
    await service.scanKanban()

    state = (await getState({}, {})) as PetRuntimeState
    expect(state.agentSessions[0]).toMatchObject({
      id: 'session-1',
      title: 'Codex task',
      componentTitle: 'Renamed agent window'
    })

    const listedSessions = (await listAgentSessions({}, {})) as PetRuntimeState['agentSessions']
    expect(listedSessions[0]).toMatchObject({
      id: 'session-1',
      componentTitle: 'Renamed agent window'
    })

    service.dispose()
  })

  it('adds the current terminal title to agent alerts and native notifications', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: true,
        kanban: { enabled: false },
        agentBridge: { enabled: true }
      }),
      canvases: [createCanvasWithTerminal('Review agent window')]
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState

    const accepted = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        hook_event_name: 'PermissionRequest',
        tool_name: 'Shell',
        tool_input: { command: 'npm test' },
        cwd: 'D:\\projects\\AtlasOS'
      },
      '/agent-hook/codex?sessionId=session-1&canvasId=canvas-1&componentId=terminal-1&title=Codex'
    )
    expect(accepted.statusCode).toBe(200)

    const updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.alerts[0]).toMatchObject({
      kind: 'agent_waiting',
      title: 'Codex is asking',
      body: 'Shell: npm test',
      componentTitle: 'Review agent window',
      target: { sessionId: 'session-1' }
    })
    expect(electronMocks.notifications[0].options).toEqual({
      title: 'Codex is asking',
      body: 'Review agent window - Shell: npm test'
    })

    service.dispose()
  })

  it('accepts only token-authorized provider hook bridge events', async () => {
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
        hook_event_name: 'PermissionRequest',
        tool_name: 'Shell',
        tool_input: { command: 'npm test' },
        cwd: 'D:\\projects\\AtlasOS'
      },
      '/agent-hook/codex?sessionId=session-1&canvasId=canvas-1&componentId=terminal-1&title=Codex%20run'
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

  it('treats Claude session start as ready until the user submits work', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const agentId = providerAgentSessionId('session-1', 'claude', 'claude-provider-session')

    const started = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'SessionStart', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      '/agent-hook/claude?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Claude%20Code'
    )
    expect(started.statusCode).toBe(200)

    let updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions[0]).toMatchObject({
      id: agentId,
      terminalSessionId: 'session-1',
      providerSessionId: 'claude-provider-session',
      source: 'claude',
      status: 'idle_unknown',
      title: 'Claude Code',
      cwd: 'D:\\projects\\AtlasOS'
    })
    expect(updatedState.alerts.filter((alert) => alert.target.sessionId === agentId)).toHaveLength(0)

    const submitted = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'UserPromptSubmit', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      '/agent-hook/claude?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Claude%20Code'
    )
    expect(submitted.statusCode).toBe(200)

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions[0]).toMatchObject({ id: agentId, status: 'running' })
    expect(updatedState.alerts.filter((alert) => alert.target.sessionId === agentId)).toHaveLength(0)

    service.dispose()
  })

  it('keeps Claude running while task and background stop hooks are still active', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const path = '/agent-hook/claude?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Claude%20Code'
    const agentId = providerAgentSessionId('session-1', 'claude', 'claude-provider-session')

    const submitted = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'UserPromptSubmit', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      path
    )
    expect(submitted.statusCode).toBe(200)

    const taskCompleted = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'TaskCompleted', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      path
    )
    expect(taskCompleted.statusCode).toBe(200)

    const backgroundStop = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        hook_event_name: 'Stop',
        session_id: 'claude-provider-session',
        background_tasks: [{ id: 'task-1', prompt: 'Continue checking the repo' }],
        cwd: 'D:\\projects\\AtlasOS'
      },
      path
    )
    expect(backgroundStop.statusCode).toBe(200)

    let updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      id: agentId,
      status: 'running',
      title: 'Claude Code'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_completed')).toBeUndefined()

    const finalStop = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'Stop', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      path
    )
    expect(finalStop.statusCode).toBe(200)

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      id: agentId,
      status: 'completed',
      title: 'Claude Code'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_completed')).toMatchObject({
      title: 'Claude Code completed'
    })

    service.dispose()
  })

  it('tracks concurrent Claude provider sessions in the same terminal cwd independently', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const path = '/agent-hook/claude?sessionId=terminal-session&componentId=terminal-1&canvasId=canvas-1&title=Claude%20Code'

    for (const providerSessionId of ['claude-provider-a', 'claude-provider-b']) {
      const submitted = await postAgentEvent(
        state.bridge.port,
        state.bridge.token,
        { hook_event_name: 'UserPromptSubmit', session_id: providerSessionId, cwd: 'D:\\projects\\AtlasOS' },
        path
      )
      expect(submitted.statusCode).toBe(200)
    }

    let updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.map((session) => session.id).sort()).toEqual([
      providerAgentSessionId('terminal-session', 'claude', 'claude-provider-a'),
      providerAgentSessionId('terminal-session', 'claude', 'claude-provider-b')
    ])
    expect(updatedState.agentSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          terminalSessionId: 'terminal-session',
          providerSessionId: 'claude-provider-a',
          status: 'running',
          cwd: 'D:\\projects\\AtlasOS'
        }),
        expect.objectContaining({
          terminalSessionId: 'terminal-session',
          providerSessionId: 'claude-provider-b',
          status: 'running',
          cwd: 'D:\\projects\\AtlasOS'
        })
      ])
    )

    service.removeAgentSession('terminal-session')
    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions).toHaveLength(0)

    service.dispose()
  })

  it('installs Claude Code hook config while preserving existing hooks', async () => {
    await mkdir(join(homePath, '.claude'), { recursive: true })
    await writeFile(
      join(homePath, '.claude', 'settings.json'),
      JSON.stringify({
        theme: 'dark',
        hooks: {
          ElicitationRequest: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'node "C:\\old\\agent-hook-forwarder.cjs" claude' }]
            }
          ],
          PreToolUse: [
            {
              matcher: 'Write',
              hooks: [
                { type: 'command', command: 'echo keep-existing-hook' },
                { type: 'command', command: 'node "C:\\old\\agent-hook-forwarder.cjs" claude' }
              ]
            }
          ]
        }
      }),
      'utf8'
    )
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const installClaudeHooks = ipcHandler('pet:install-claude-hooks')
    const getState = ipcHandler('pet:get-state')

    const status = (await installClaudeHooks({}, {})) as PetRuntimeState['bridge']['claudeHook']
    expect(status.installed).toBe(true)
    expect(status.settingsPath).toBe(join(homePath, '.claude', 'settings.json'))
    expect(status.command).toBe('node')
    expect(status.args).toEqual([expect.stringContaining('agent-hook-forwarder.cjs'), 'claude'])
    expect(status.displayCommand).toContain('agent-hook-forwarder.cjs')

    const savedSettings = JSON.parse(await readFile(join(homePath, '.claude', 'settings.json'), 'utf8'))
    expect(savedSettings.theme).toBe('dark')
    expect(savedSettings.hooks.PreToolUse[0]).toMatchObject({
      matcher: 'Write',
      hooks: [{ type: 'command', command: 'echo keep-existing-hook' }]
    })
    expect(savedSettings.hooks.ElicitationRequest).toBeUndefined()
    for (const eventName of status.events) {
      expect(savedSettings.hooks[eventName].at(-1)).toMatchObject({
        matcher: '',
        hooks: [{ type: 'command', command: status.command, args: status.args, async: true, timeout: 5 }]
      })
    }

    const state = (await getState({}, {})) as PetRuntimeState
    expect(state.bridge.claudeHook.installed).toBe(true)

    service.dispose()
  })

  it('reports installed Claude hooks as unavailable when Claude hooks are disabled', async () => {
    await mkdir(join(homePath, '.claude'), { recursive: true })
    await writeFile(join(homePath, '.claude', 'settings.json'), JSON.stringify({ disableAllHooks: true }), 'utf8')
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const installClaudeHooks = ipcHandler('pet:install-claude-hooks')

    const status = (await installClaudeHooks({}, {})) as PetRuntimeState['bridge']['claudeHook']
    expect(status.installed).toBe(false)
    expect(status.issue).toContain('disableAllHooks')
    expect(status.installedEvents).toEqual(status.events)

    service.dispose()
  })

  it('installs Codex hook config while preserving existing hooks', async () => {
    await mkdir(join(homePath, '.codex'), { recursive: true })
    await writeFile(
      join(homePath, '.codex', 'hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command: 'node "C:\\old\\agent-hook-forwarder.cjs" codex',
                  commandWindows: null,
                  async: true,
                  timeoutSec: 5,
                  statusMessage: null
                }
              ]
            }
          ],
          PreToolUse: [
            {
              matcher: 'Write',
              hooks: [
                { type: 'command', command: 'echo keep-existing-codex-hook' },
                { type: 'command', command: 'node "C:\\old\\agent-hook-forwarder.cjs" codex' }
              ]
            }
          ]
        }
      }),
      'utf8'
    )
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const installCodexHooks = ipcHandler('pet:install-codex-hooks')
    const getState = ipcHandler('pet:get-state')

    const beforeInstall = (await getState({}, {})) as PetRuntimeState
    expect(beforeInstall.bridge.codexHook.installed).toBe(false)
    expect(beforeInstall.bridge.codexHook.issue).toContain('reinstalling')

    const status = (await installCodexHooks({}, {})) as PetRuntimeState['bridge']['codexHook']
    expect(status.installed).toBe(true)
    expect(status.issue).toBeUndefined()
    expect(status.settingsPath).toBe(join(homePath, '.codex', 'hooks.json'))
    expect(status.command).toContain('agent-hook-forwarder.cjs')
    expect(status.command).toContain('codex')
    expect(status.args).toEqual([])

    const savedSettings = JSON.parse(await readFile(join(homePath, '.codex', 'hooks.json'), 'utf8'))
    expect(savedSettings.hooks.PreToolUse[0]).toMatchObject({
      matcher: 'Write',
      hooks: [{ type: 'command', command: 'echo keep-existing-codex-hook' }]
    })
    for (const eventName of status.events) {
      expect(savedSettings.hooks[eventName].at(-1)).toMatchObject({
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `${status.command} ${eventName}`,
            commandWindows: null,
            async: false,
            timeoutSec: 5,
            statusMessage: null
          }
        ]
      })
      expect(savedSettings.hooks[eventName].at(-1).hooks[0].command).toContain(eventName)
    }

    const state = (await getState({}, {})) as PetRuntimeState
    expect(state.bridge.codexHook.installed).toBe(true)

    service.dispose()
  })

  it('ignores provider hooks outside Atlas terminals while accepting Atlas terminal hooks', async () => {
    const onAgentProviderSessionResolved = vi.fn()
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      }),
      onAgentProviderSessionResolved
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const forwarderPath = join(userDataPath, 'pet', 'agent-hook-forwarder.cjs')
    const bridgeConfig = JSON.parse(await readFile(join(userDataPath, 'pet', 'agent-hook-bridge.json'), 'utf8'))
    const codexAgentId = providerAgentSessionId('session-1', 'codex', 'codex-thread-1')
    expect(bridgeConfig).toMatchObject({
      enabled: true,
      bridgeUrl: `http://127.0.0.1:${state.bridge.port}/agent-hook`,
      token: state.bridge.token
    })

    const externalBridgeEvent = await postAgentEvent(state.bridge.port, state.bridge.token, {
      hook_event_name: 'Stop',
      threadId: 'external-codex-thread',
      cwd: 'D:\\projects\\AtlasOS',
      title: 'External Codex task'
    })
    expect(externalBridgeEvent.statusCode).toBe(200)

    const externalForwarderEvent = await runHookForwarder(forwarderPath, 'codex', {
      threadId: 'external-codex-thread',
      cwd: 'D:\\projects\\AtlasOS',
      title: 'External Codex task'
    }, 'UserPromptSubmit')
    expect(externalForwarderEvent).toMatchObject({ exitCode: 0, stderr: '' })

    let updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions).toHaveLength(0)
    expect(updatedState.alerts.filter((alert) => alert.target.sessionId === 'external-codex-thread')).toHaveLength(0)
    expect(onAgentProviderSessionResolved).not.toHaveBeenCalled()

    const atlasTerminalEnv = {
      ATLAS_TERMINAL_SESSION_ID: 'session-1',
      ATLAS_TERMINAL_COMPONENT_ID: 'terminal-1',
      ATLAS_CANVAS_ID: 'canvas-1',
      ATLAS_TERMINAL_CWD: 'D:\\projects\\AtlasOS',
      ATLAS_TERMINAL_TITLE: 'Codex task'
    }

    const started = await runHookForwarder(forwarderPath, 'codex', {
      threadId: 'codex-thread-1',
      cwd: 'D:\\projects\\AtlasOS',
      title: 'Codex task'
    }, 'UserPromptSubmit', atlasTerminalEnv)
    expect(started).toMatchObject({ exitCode: 0, stderr: '' })

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === codexAgentId)).toMatchObject({
      terminalSessionId: 'session-1',
      providerSessionId: 'codex-thread-1',
      source: 'codex',
      status: 'running',
      title: 'Codex task',
      cwd: 'D:\\projects\\AtlasOS'
    })
    expect(onAgentProviderSessionResolved).toHaveBeenCalledWith({
      terminalSessionId: 'session-1',
      source: 'codex',
      providerSessionId: 'codex-thread-1',
      componentId: 'terminal-1',
      canvasId: 'canvas-1',
      cwd: 'D:\\projects\\AtlasOS'
    })

    const permissionRequest = await runHookForwarder(forwarderPath, 'codex', {
      eventName: 'permissionRequest',
      threadId: 'codex-thread-1',
      toolName: 'Shell',
      toolInput: { command: 'npm test' },
      cwd: 'D:\\projects\\AtlasOS',
      title: 'Codex task'
    }, 'PermissionRequest', atlasTerminalEnv)
    expect(permissionRequest).toMatchObject({ exitCode: 0, stderr: '' })

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === codexAgentId)).toMatchObject({
      source: 'codex',
      status: 'waiting_for_confirmation',
      attentionReason: 'Shell: npm test'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === codexAgentId && alert.kind === 'agent_waiting')).toMatchObject({
      title: 'Codex is asking',
      body: 'Shell: npm test'
    })

    const completed = await runHookForwarder(forwarderPath, 'codex', {
      eventName: 'stop',
      threadId: 'codex-thread-1',
      cwd: 'D:\\projects\\AtlasOS',
      title: 'Codex task'
    }, 'Stop', atlasTerminalEnv)
    expect(completed).toMatchObject({ exitCode: 0, stderr: '' })

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === codexAgentId)).toMatchObject({
      source: 'codex',
      status: 'completed',
      title: 'Codex task'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === codexAgentId && alert.kind === 'agent_completed')).toMatchObject({
      title: 'Codex completed'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === codexAgentId && alert.kind === 'agent_waiting')?.readAt).toBeDefined()

    service.dispose()
  })

  it('keeps Atlas terminal hooks connected when the pet window is disabled and re-enabled', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const updateSettings = ipcHandler('pet:update-settings')
    const initialState = (await getState({}, {})) as PetRuntimeState
    const forwarderPath = join(userDataPath, 'pet', 'agent-hook-forwarder.cjs')

    await updateSettings({}, { settings: { ...initialState.settings, enabled: false } })
    const terminalEnv = service.getAgentHookEnvironment({
      sessionId: 'session-1',
      componentId: 'terminal-1',
      canvasId: 'canvas-1',
      title: 'Codex task',
      cwd: 'D:\\projects\\AtlasOS'
    })

    expect(terminalEnv).toMatchObject({
      ATLAS_PET_BRIDGE_CONFIG: join(userDataPath, 'pet', 'agent-hook-bridge.json'),
      ATLAS_PET_HOOK_FORWARDER: forwarderPath,
      ATLAS_TERMINAL_SESSION_ID: 'session-1',
      ATLAS_TERMINAL_COMPONENT_ID: 'terminal-1',
      ATLAS_CANVAS_ID: 'canvas-1',
      ATLAS_TERMINAL_CWD: 'D:\\projects\\AtlasOS',
      ATLAS_TERMINAL_TITLE: 'Codex task'
    })
    expect(terminalEnv.ATLAS_PET_BRIDGE_URL).toBeUndefined()
    expect(terminalEnv.ATLAS_PET_BRIDGE_TOKEN).toBeUndefined()

    await updateSettings({}, { settings: { ...initialState.settings, enabled: true } })

    const agentId = providerAgentSessionId('session-1', 'codex', 'codex-thread-reopened')
    const permissionRequest = await runHookForwarder(
      forwarderPath,
      'codex',
      {
        eventName: 'permissionRequest',
        threadId: 'codex-thread-reopened',
        toolName: 'Shell',
        toolInput: { command: 'npm test' },
        cwd: 'D:\\projects\\AtlasOS',
        title: 'Codex task'
      },
      'PermissionRequest',
      {
        ...terminalEnv,
        ATLAS_PET_BRIDGE_URL: 'http://127.0.0.1:9/agent-hook',
        ATLAS_PET_BRIDGE_TOKEN: 'stale-token'
      }
    )
    expect(permissionRequest).toMatchObject({ exitCode: 0, stderr: '' })

    let updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      terminalSessionId: 'session-1',
      providerSessionId: 'codex-thread-reopened',
      source: 'codex',
      status: 'waiting_for_confirmation',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex task',
      cwd: 'D:\\projects\\AtlasOS',
      attentionReason: 'Shell: npm test'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_waiting')).toMatchObject({
      title: 'Codex is asking',
      body: 'Shell: npm test'
    })

    const completed = await runHookForwarder(
      forwarderPath,
      'codex',
      {
        eventName: 'stop',
        threadId: 'codex-thread-reopened',
        cwd: 'D:\\projects\\AtlasOS',
        title: 'Codex task'
      },
      'Stop',
      terminalEnv
    )
    expect(completed).toMatchObject({ exitCode: 0, stderr: '' })

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      id: agentId,
      status: 'completed',
      title: 'Codex task'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_completed')).toMatchObject({
      title: 'Codex completed'
    })

    service.dispose()
  })

  it('reports installed Codex hooks as unavailable when Codex hooks are disabled', async () => {
    await mkdir(join(homePath, '.codex'), { recursive: true })
    await writeFile(join(homePath, '.codex', 'config.toml'), '[features]\nhooks = false\n', 'utf8')
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const installCodexHooks = ipcHandler('pet:install-codex-hooks')

    const status = (await installCodexHooks({}, {})) as PetRuntimeState['bridge']['codexHook']
    expect(status.installed).toBe(false)
    expect(status.issue).toContain('disabled')
    expect(status.installedEvents).toEqual(status.events)

    service.dispose()
  })

  it('normalizes provider hook payloads through the bridge', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const codexAgentId = providerAgentSessionId('session-1', 'codex', 'codex-provider-session')
    const claudeAgentId = providerAgentSessionId('session-2', 'claude', 'claude-provider-session')
    const claudeCompletedAgentId = providerAgentSessionId('session-3', 'claude', 'claude-completed-session')

    const accepted = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        hook_event_name: 'PermissionRequest',
        session_id: 'codex-provider-session',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        cwd: 'D:\\projects\\AtlasOS'
      },
      '/agent-hook/codex?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Codex'
    )
    expect(accepted.statusCode).toBe(200)

    let updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions[0]).toMatchObject({
      id: codexAgentId,
      terminalSessionId: 'session-1',
      providerSessionId: 'codex-provider-session',
      source: 'codex',
      status: 'waiting_for_confirmation',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex',
      cwd: 'D:\\projects\\AtlasOS',
      attentionReason: 'Bash: npm test'
    })
    expect(updatedState.alerts[0]).toMatchObject({
      kind: 'agent_waiting',
      body: 'Bash: npm test',
      target: { sessionId: codexAgentId }
    })

    const resumed = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'UserPromptSubmit', session_id: 'codex-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      '/agent-hook/codex?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Codex'
    )
    expect(resumed.statusCode).toBe(200)

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions[0]).toMatchObject({ id: codexAgentId, status: 'running' })
    expect(updatedState.alerts.filter((alert) => alert.kind === 'agent_waiting' && !alert.readAt)).toHaveLength(0)

    const claudeNotification = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        session_id: 'claude-provider-session',
        message: 'Claude needs your input',
        cwd: 'D:\\projects\\AtlasOS'
      },
      '/agent-hook/claude?sessionId=session-2&componentId=terminal-2&canvasId=canvas-1&title=Claude%20Code'
    )
    expect(claudeNotification.statusCode).toBe(200)

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === claudeAgentId)).toMatchObject({
      terminalSessionId: 'session-2',
      providerSessionId: 'claude-provider-session',
      source: 'claude',
      status: 'waiting_for_confirmation',
      title: 'Claude Code',
      attentionReason: 'Claude needs your input'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === claudeAgentId)).toMatchObject({
      title: 'Claude Code is asking',
      body: 'Claude needs your input',
      kind: 'agent_waiting'
    })

    const completionLikeNotification = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'Notification', session_id: 'claude-completed-session', message: 'Claude completed the run', cwd: 'D:\\projects\\AtlasOS' },
      '/agent-hook/claude?sessionId=session-3&componentId=terminal-3&canvasId=canvas-1&title=Claude%20Code'
    )
    expect(completionLikeNotification.statusCode).toBe(200)

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === claudeCompletedAgentId)).toBeUndefined()
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === claudeCompletedAgentId && alert.kind === 'agent_completed')).toBeUndefined()

    const claudeCompleted = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'Stop', session_id: 'claude-completed-session', cwd: 'D:\\projects\\AtlasOS' },
      '/agent-hook/claude?sessionId=session-3&componentId=terminal-3&canvasId=canvas-1&title=Claude%20Code'
    )
    expect(claudeCompleted.statusCode).toBe(200)

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === claudeCompletedAgentId)).toMatchObject({
      terminalSessionId: 'session-3',
      providerSessionId: 'claude-completed-session',
      source: 'claude',
      status: 'completed',
      title: 'Claude Code'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === claudeCompletedAgentId)).toMatchObject({
      title: 'Claude Code completed',
      kind: 'agent_completed'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === claudeCompletedAgentId && alert.kind === 'agent_waiting')).toBeUndefined()

    service.dispose()
  })

  it('surfaces Claude API failure hooks as agent error alerts', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const agentId = providerAgentSessionId('session-1', 'claude', 'claude-provider-session')

    const failed = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        hook_event_name: 'StopFailure',
        session_id: 'claude-provider-session',
        error: 'rate_limit',
        error_details: 'API quota exhausted',
        cwd: 'D:\\projects\\AtlasOS'
      },
      '/agent-hook/claude?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Claude%20Code'
    )
    expect(failed.statusCode).toBe(200)

    const updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      source: 'claude',
      status: 'error',
      title: 'Claude Code',
      attentionReason: 'rate_limit: API quota exhausted'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId)).toMatchObject({
      title: 'Claude Code reported an error',
      body: 'rate_limit: API quota exhausted',
      kind: 'agent_error',
      severity: 'danger'
    })

    service.dispose()
  })

  it('marks Codex request_user_input tool hooks as asking until the tool returns', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const path = '/agent-hook/codex?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Codex'
    const agentId = providerAgentSessionId('session-1', 'codex', 'codex-provider-session')

    const question = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        hook_event_name: 'PreToolUse',
        session_id: 'codex-provider-session',
        tool_name: 'request_user_input',
        tool_input: {
          questions: [
            {
              id: 'confirm_path',
              header: 'Confirm path',
              question: 'Use D:\\projects\\AtlasOS?'
            }
          ]
        },
        cwd: 'D:\\projects\\AtlasOS'
      },
      path
    )
    expect(question.statusCode).toBe(200)

    let updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      source: 'codex',
      status: 'waiting_for_confirmation',
      title: 'Codex',
      attentionReason: 'request_user_input: Use D:\\projects\\AtlasOS?'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_waiting')).toMatchObject({
      title: 'Codex is asking',
      body: 'request_user_input: Use D:\\projects\\AtlasOS?'
    })

    const answer = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        hook_event_name: 'PostToolUse',
        session_id: 'codex-provider-session',
        tool_name: 'request_user_input',
        tool_input: { questions: [{ question: 'Use D:\\projects\\AtlasOS?' }] },
        tool_response: { answers: { confirm_path: { answers: ['yes'] } } },
        cwd: 'D:\\projects\\AtlasOS'
      },
      path
    )
    expect(answer.statusCode).toBe(200)

    updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      source: 'codex',
      status: 'running',
      title: 'Codex'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_waiting')?.readAt).toBeDefined()

    service.dispose()
  })

  it('keeps completed Claude sessions completed when a later idle prompt notification arrives', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const agentId = providerAgentSessionId('session-1', 'claude', 'claude-provider-session')

    const completed = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'Stop', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      '/agent-hook/claude?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Claude%20Code'
    )
    expect(completed.statusCode).toBe(200)

    const idlePrompt = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      {
        hook_event_name: 'Notification',
        notification_type: 'idle_prompt',
        session_id: 'claude-provider-session',
        message: 'Claude is waiting for your input',
        cwd: 'D:\\projects\\AtlasOS'
      },
      '/agent-hook/claude?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Claude%20Code'
    )
    expect(idlePrompt.statusCode).toBe(200)

    const updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      id: agentId,
      status: 'completed',
      title: 'Claude Code'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId)).toMatchObject({
      title: 'Claude Code completed',
      kind: 'agent_completed'
    })
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_waiting')).toBeUndefined()

    service.dispose()
  })

  it('does not revive completed Claude sessions from trailing hook events', async () => {
    const { service } = createService({
      settings: createSettings({
        showNativeNotifications: false,
        agentBridge: { enabled: true }
      })
    })

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState
    const path = '/agent-hook/claude?sessionId=session-1&componentId=terminal-1&canvasId=canvas-1&title=Claude%20Code'
    const agentId = providerAgentSessionId('session-1', 'claude', 'claude-provider-session')

    const completed = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'Stop', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      path
    )
    expect(completed.statusCode).toBe(200)

    const elicitationResult = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'ElicitationResult', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      path
    )
    expect(elicitationResult.statusCode).toBe(200)

    const postToolUse = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'PostToolUse', session_id: 'claude-provider-session', tool_name: 'AskUserQuestion', cwd: 'D:\\projects\\AtlasOS' },
      path
    )
    expect(postToolUse.statusCode).toBe(200)

    const duplicateStop = await postAgentEvent(
      state.bridge.port,
      state.bridge.token,
      { hook_event_name: 'Stop', session_id: 'claude-provider-session', cwd: 'D:\\projects\\AtlasOS' },
      path
    )
    expect(duplicateStop.statusCode).toBe(200)

    const updatedState = (await getState({}, {})) as PetRuntimeState
    expect(updatedState.agentSessions.find((session) => session.id === agentId)).toMatchObject({
      id: agentId,
      status: 'completed',
      title: 'Claude Code'
    })
    expect(updatedState.alerts.filter((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_completed')).toHaveLength(1)
    expect(updatedState.alerts.find((alert) => alert.target.sessionId === agentId && alert.kind === 'agent_waiting')).toBeUndefined()

    service.dispose()
  })

  it('creates a fresh visible alert when an agent asks again after being acknowledged', async () => {
    const { service } = createService()
    const baseSession: Omit<PetAgentSession, 'status' | 'lastActivityAt'> = {
      id: 'session-1',
      source: 'claude',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Claude Code',
      cwd: 'D:\\projects\\AtlasOS'
    }

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const ackAlert = ipcHandler('pet:ack-alert')

    service.upsertAgentSession({ ...baseSession, status: 'waiting_for_confirmation', lastActivityAt: '2026-05-29T10:00:00.000Z' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    let state = (await getState({}, {})) as PetRuntimeState
    const firstAlert = state.alerts.find((alert) => alert.kind === 'agent_waiting')
    expect(firstAlert).toMatchObject({ title: 'Claude Code is asking', target: { sessionId: 'session-1' } })

    await ackAlert({}, { alertId: firstAlert?.id })
    service.upsertAgentSession({ ...baseSession, status: 'running', lastActivityAt: '2026-05-29T10:00:01.000Z' })
    service.upsertAgentSession({ ...baseSession, status: 'waiting_for_confirmation', lastActivityAt: '2026-05-29T10:00:02.000Z' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    state = (await getState({}, {})) as PetRuntimeState
    const unreadWaitingAlerts = state.alerts.filter((alert) => alert.kind === 'agent_waiting' && !alert.readAt)
    expect(unreadWaitingAlerts).toHaveLength(1)
    expect(unreadWaitingAlerts[0].id).not.toBe(firstAlert?.id)

    service.dispose()
  })

  it('resolves stale agent attention alerts when the agent returns to running', async () => {
    const { service } = createService()
    const baseSession: Omit<PetAgentSession, 'status' | 'lastActivityAt'> = {
      id: 'session-1',
      source: 'claude',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Claude Code',
      cwd: 'D:\\projects\\AtlasOS'
    }

    await service.start()
    const getState = ipcHandler('pet:get-state')

    service.upsertAgentSession({ ...baseSession, status: 'error', lastActivityAt: '2026-05-29T10:00:00.000Z' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    let state = (await getState({}, {})) as PetRuntimeState
    expect(state.alerts.find((alert) => alert.kind === 'agent_error' && !alert.readAt)).toMatchObject({
      title: 'Claude Code reported an error',
      target: { sessionId: 'session-1' }
    })

    service.upsertAgentSession({ ...baseSession, status: 'running', lastActivityAt: '2026-05-29T10:00:01.000Z' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    state = (await getState({}, {})) as PetRuntimeState
    expect(state.agentSessions[0]).toMatchObject({ id: 'session-1', status: 'running' })
    expect(state.alerts.filter((alert) => ['agent_error', 'agent_waiting'].includes(alert.kind) && !alert.readAt)).toHaveLength(0)
    expect(state.alerts.find((alert) => alert.kind === 'agent_error')?.readAt).toBeDefined()

    service.dispose()
  })

  it('records a terminal-started Codex session as ready without creating an alert', async () => {
    const { service } = createService()

    await service.start()
    const getState = ipcHandler('pet:get-state')

    service.recordAgentCommandStarted({
      source: 'codex',
      sessionId: 'session-1',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex',
      cwd: 'D:\\projects\\AtlasOS'
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const state = (await getState({}, {})) as PetRuntimeState
    expect(state.agentSessions).toHaveLength(1)
    expect(state.agentSessions[0]).toMatchObject({
      id: 'session-1',
      source: 'codex',
      status: 'idle_unknown',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex',
      cwd: 'D:\\projects\\AtlasOS'
    })
    expect(state.alerts.filter((alert) => alert.target.sessionId === 'session-1')).toHaveLength(0)

    service.dispose()
  })

  it('removes a terminal agent session when its PTY session closes', async () => {
    const { service } = createService()

    await service.start()
    const getState = ipcHandler('pet:get-state')

    service.recordAgentCommandStarted({
      source: 'claude',
      sessionId: 'session-1',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Claude Code',
      cwd: 'D:\\projects\\AtlasOS'
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    let state = (await getState({}, {})) as PetRuntimeState
    expect(state.agentSessions).toHaveLength(1)

    service.upsertAgentSession({
      id: providerAgentSessionId('session-1', 'claude', 'claude-provider-session'),
      terminalSessionId: 'session-1',
      providerSessionId: 'claude-provider-session',
      source: 'claude',
      status: 'completed',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Claude Code',
      cwd: 'D:\\projects\\AtlasOS',
      lastActivityAt: '2026-05-29T10:00:01.000Z'
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    state = (await getState({}, {})) as PetRuntimeState
    expect(state.agentSessions.map((session) => session.id).sort()).toEqual([
      'session-1',
      providerAgentSessionId('session-1', 'claude', 'claude-provider-session')
    ])

    service.removeAgentSession('session-1')
    state = (await getState({}, {})) as PetRuntimeState
    expect(state.agentSessions).toHaveLength(0)

    service.dispose()
  })

  it('returns a completed terminal agent to ready when the agent command starts again', async () => {
    const { service } = createService()
    const baseSession: Omit<PetAgentSession, 'status' | 'lastActivityAt'> = {
      id: 'session-1',
      source: 'codex',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex',
      cwd: 'D:\\projects\\AtlasOS'
    }

    await service.start()
    const getState = ipcHandler('pet:get-state')

    service.upsertAgentSession({ ...baseSession, status: 'completed', lastActivityAt: '2026-05-29T10:00:00.000Z' })
    service.recordAgentCommandStarted({
      source: 'codex',
      sessionId: 'session-1',
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex',
      cwd: 'D:\\projects\\AtlasOS'
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const state = (await getState({}, {})) as PetRuntimeState
    expect(state.agentSessions[0]).toMatchObject({ id: 'session-1', status: 'idle_unknown' })
    expect(state.alerts.filter((alert) => alert.target.sessionId === 'session-1' && alert.kind === 'agent_completed')).toHaveLength(1)

    service.dispose()
  })

  it('does not surface persisted transient agent attention alerts after restart', async () => {
    await mkdir(join(userDataPath, 'pet'), { recursive: true })
    await writeFile(
      join(userDataPath, 'pet', 'state.json'),
      JSON.stringify({
        bridgeToken: 'test-token',
        alerts: [
          {
            id: 'alert-1',
            kind: 'agent_error',
            severity: 'danger',
            title: 'Claude Code reported an error',
            body: 'Terminal',
            target: { canvasId: 'canvas-1', componentId: 'terminal-1', sessionId: 'session-1' },
            createdAt: '2026-05-29T10:00:00.000Z',
            dedupeKey: 'agent:session-1:error:2026-05-29T10:00:00.000Z'
          }
        ]
      }),
      'utf8'
    )
    const { service } = createService()

    await service.start()
    const getState = ipcHandler('pet:get-state')
    const state = (await getState({}, {})) as PetRuntimeState

    expect(state.alerts[0]).toMatchObject({ id: 'alert-1', kind: 'agent_error' })
    expect(state.alerts[0].readAt).toBeDefined()

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
