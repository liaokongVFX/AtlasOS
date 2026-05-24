import { EventEmitter } from 'node:events'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_PLUGIN_API_VERSION, pluginRendererModuleUrl } from '@shared/plugins'
import { PluginService } from './plugin-service'

const electronMocks = vi.hoisted(() => ({
  dialogShowOpenDialog: vi.fn(),
  ipcHandle: vi.fn(),
  protocolHandle: vi.fn(),
  protocolHandler: null as ((request: Request) => Promise<Response> | Response) | null,
  protocolIsHandled: vi.fn(() => false),
  registerSchemesAsPrivileged: vi.fn(),
  userDataPath: '',
  utilityFork: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMocks.userDataPath)
  },
  dialog: {
    showOpenDialog: electronMocks.dialogShowOpenDialog
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  },
  protocol: {
    handle: vi.fn((scheme: string, handler: (request: Request) => Promise<Response> | Response) => {
      electronMocks.protocolHandle(scheme, handler)
      electronMocks.protocolHandler = handler
    }),
    isProtocolHandled: electronMocks.protocolIsHandled,
    registerSchemesAsPrivileged: electronMocks.registerSchemesAsPrivileged
  },
  utilityProcess: {
    fork: electronMocks.utilityFork
  }
}))

type FakeUtilityProcess = {
  stdout: EventEmitter
  stderr: EventEmitter
  on: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emit: (eventName: string, ...args: unknown[]) => boolean
}

const testRoot = join(process.cwd(), '.atlasos-dev', 'plugin-service-test')
const userDataPath = join(testRoot, 'user-data')

function createUtilityProcess(): FakeUtilityProcess {
  const emitter = new EventEmitter()
  const child = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: vi.fn((eventName: string, listener: (...args: unknown[]) => void) => {
      emitter.on(eventName, listener)
      return child
    }),
    postMessage: vi.fn(),
    kill: vi.fn(() => {
      emitter.emit('exit', 0)
    }),
    emit: (eventName: string, ...args: unknown[]) => emitter.emit(eventName, ...args)
  }

  return child
}

async function writePluginSource(
  directory: string,
  patch: Record<string, unknown> = {},
  files: Record<string, string> = { 'dist/renderer.js': 'export function registerPlugin() {}' }
): Promise<void> {
  await mkdir(directory, { recursive: true })

  for (const [relativePath, contents] of Object.entries(files)) {
    const targetPath = join(directory, relativePath)
    await mkdir(join(targetPath, '..'), { recursive: true })
    await writeFile(targetPath, contents, 'utf8')
  }

  await writeFile(
    join(directory, 'atlas-plugin.json'),
    `${JSON.stringify(
      {
        id: 'acme.timer',
        name: 'Timer',
        version: '1.0.0',
        atlasApiVersion: ATLAS_PLUGIN_API_VERSION,
        renderer: { entry: 'dist/renderer.js' },
        nodes: [
          {
            id: 'focus-timer',
            title: 'Focus Timer',
            defaultFrame: { x: 120, y: 120, width: 360, height: 240 }
          }
        ],
        ...patch
      },
      null,
      2
    )}\n`,
    'utf8'
  )
}

describe('PluginService', () => {
  beforeEach(async () => {
    electronMocks.dialogShowOpenDialog.mockReset()
    electronMocks.ipcHandle.mockClear()
    electronMocks.protocolHandle.mockClear()
    electronMocks.protocolHandler = null
    electronMocks.protocolIsHandled.mockReturnValue(false)
    electronMocks.userDataPath = userDataPath
    electronMocks.utilityFork.mockReset()

    await rm(testRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('installs a local plugin directory as disabled and exposes a renderer module URL', async () => {
    const sourcePath = join(testRoot, 'timer-plugin')
    await writePluginSource(sourcePath)

    const service = new PluginService()
    const info = await service.installDirectory(sourcePath)

    expect(info).toMatchObject({
      id: 'acme.timer',
      enabled: false,
      config: {},
      status: 'disabled',
      rendererEntryUrl: 'atlas-plugin://acme.timer/dist/renderer.js'
    })
  })

  it('discovers plugin folders copied into the configured plugin root', async () => {
    const rootPath = join(testRoot, 'copied-plugins')
    const sourcePath = join(rootPath, 'timer-plugin')
    await writePluginSource(sourcePath)

    const service = new PluginService()
    await service.setRootDirectory(rootPath)
    const plugins = await service.listPlugins()

    expect(await service.getSettings()).toEqual({ rootPath })
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({
      id: 'acme.timer',
      sourcePath,
      enabled: false,
      status: 'disabled'
    })
  })

  it('refreshes existing discovered plugins when renderer files change', async () => {
    const rootPath = join(testRoot, 'copied-plugins')
    const sourcePath = join(rootPath, 'timer-plugin')
    await writePluginSource(sourcePath, {}, { 'dist/renderer.js': 'export const value = 1' })

    const service = new PluginService()
    await service.setRootDirectory(rootPath)
    const firstScan = await service.scanRootDirectory()

    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(join(sourcePath, 'dist', 'renderer.js'), 'export const value = 2', 'utf8')

    const secondScan = await service.scanRootDirectory()

    expect(Date.parse(secondScan[0].updatedAt)).toBeGreaterThan(Date.parse(firstScan[0].updatedAt))
  })

  it('refreshes directly installed plugins when renderer files change', async () => {
    const sourcePath = join(testRoot, 'timer-plugin')
    await writePluginSource(sourcePath, {}, { 'dist/renderer.js': 'export const value = 1' })

    const service = new PluginService()
    const firstInstall = await service.installDirectory(sourcePath)
    expect(firstInstall).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(join(sourcePath, 'dist', 'renderer.js'), 'export const value = 2', 'utf8')

    const secondList = await service.listPlugins()

    expect(Date.parse(secondList[0].updatedAt)).toBeGreaterThan(Date.parse(firstInstall?.updatedAt ?? ''))
  })

  it('persists schema-driven plugin configuration and exposes defaults', async () => {
    const sourcePath = join(testRoot, 'timer-plugin')
    await writePluginSource(sourcePath, {
      configuration: [
        {
          id: 'intervalMinutes',
          label: 'Interval minutes',
          type: 'number',
          default: 25,
          min: 1,
          max: 120
        },
        {
          id: 'playSound',
          label: 'Play sound',
          type: 'boolean',
          default: true
        }
      ]
    })

    const service = new PluginService()
    const installed = await service.installDirectory(sourcePath)
    expect(installed?.config).toEqual({ intervalMinutes: 25, playSound: true })

    const updated = await service.updatePluginConfig('acme.timer', { intervalMinutes: 45, playSound: false })
    expect(updated.config).toEqual({ intervalMinutes: 45, playSound: false })
  })

  it('starts the native utility process on enable and kills it on disable', async () => {
    const sourcePath = join(testRoot, 'timer-plugin')
    await writePluginSource(
      sourcePath,
      { native: { entry: 'native/main.js' } },
      {
        'dist/renderer.js': 'export function registerPlugin() {}',
        'native/main.js': 'process.parentPort.on("message", () => {})'
      }
    )
    const child = createUtilityProcess()
    electronMocks.utilityFork.mockReturnValue(child)

    const service = new PluginService()
    await service.installDirectory(sourcePath)
    const enabled = await service.enablePlugin('acme.timer')

    expect(enabled.status).toBe('running')
    expect(electronMocks.utilityFork).toHaveBeenCalledWith(join(sourcePath, 'native/main.js'), [], {
      cwd: sourcePath,
      serviceName: 'AtlasOS Plugin Timer',
      stdio: 'pipe'
    })

    child.emit('spawn')

    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'atlas:init',
        pluginId: 'acme.timer'
      })
    )

    await service.disablePlugin('acme.timer')

    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('forwards native invoke requests and resolves matching replies', async () => {
    const sourcePath = join(testRoot, 'timer-plugin')
    await writePluginSource(
      sourcePath,
      { native: { entry: 'native/main.js' } },
      {
        'dist/renderer.js': 'export function registerPlugin() {}',
        'native/main.js': 'process.parentPort.on("message", () => {})'
      }
    )
    const child = createUtilityProcess()
    electronMocks.utilityFork.mockReturnValue(child)

    const service = new PluginService()
    await service.installDirectory(sourcePath)
    await service.enablePlugin('acme.timer')

    const resultPromise = service.invoke('acme.timer', 'ping', { value: 42 })

    await vi.waitFor(() => {
      expect(child.postMessage.mock.calls.some(([message]) => message.type === 'atlas:invoke')).toBe(true)
    })

    const invokeMessage = child.postMessage.mock.calls.find(([message]) => message.type === 'atlas:invoke')?.[0]

    expect(invokeMessage).toMatchObject({
      type: 'atlas:invoke',
      command: 'ping',
      input: { value: 42 }
    })

    child.emit('message', {
      type: 'atlas:invoke-result',
      requestId: invokeMessage.requestId,
      ok: true,
      result: { pong: true }
    })

    await expect(resultPromise).resolves.toEqual({ pong: true })
  })

  it('serves renderer modules only after the plugin is enabled', async () => {
    const sourcePath = join(testRoot, 'timer-plugin')
    await writePluginSource(sourcePath, {}, { 'dist/renderer.js': 'export const value = 42' })

    const service = new PluginService()
    await service.installDirectory(sourcePath)

    const url = pluginRendererModuleUrl('acme.timer', 'dist/renderer.js')
    const disabledResponse = await service.createRendererModuleResponse(new Request(url))

    expect(disabledResponse.status).toBe(403)

    await service.enablePlugin('acme.timer')
    const enabledResponse = await service.createRendererModuleResponse(new Request(url))

    expect(enabledResponse.status).toBe(200)
    expect(enabledResponse.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(await enabledResponse.text()).toBe('export const value = 42')
  })
})
