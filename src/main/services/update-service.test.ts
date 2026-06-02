import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateService } from './update-service'

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
  getVersion: vi.fn(() => '0.1.0'),
  ipcHandle: vi.fn(),
  isPackaged: true
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronMocks.isPackaged
    },
    getVersion: electronMocks.getVersion
  },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: new EventEmitter()
}))

type MockUpdateWindow = {
  close: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  }
}

class MockUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  checkForUpdates = vi.fn()
  downloadUpdate = vi.fn()
  quitAndInstall = vi.fn()
}

const updateInfo = {
  version: '0.2.0',
  files: [],
  path: 'AtlasOS Setup 0.2.0.exe',
  sha512: 'sha512',
  releaseDate: '2026-06-02T00:00:00.000Z',
  releaseName: 'AtlasOS 0.2.0',
  releaseNotes: 'Update notes'
}

function createWindow(): MockUpdateWindow {
  return {
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    show: vi.fn(),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    }
  }
}

function createService(updater = new MockUpdater(), options: Partial<NonNullable<ConstructorParameters<typeof UpdateService>[0]>> = {}) {
  const mainWindow = createWindow()
  const updateWindow = createWindow()
  const loadUpdateRenderer = vi.fn(() => Promise.resolve())
  const createUpdateWindow = vi.fn(() => updateWindow)
  const service = new UpdateService({
    appVersion: '0.1.0',
    createUpdateWindow,
    getWindows: () => [mainWindow as never],
    isDev: false,
    isPackaged: true,
    loadUpdateRenderer: loadUpdateRenderer as never,
    now: () => new Date('2026-06-02T00:00:00.000Z'),
    platform: 'win32',
    updater: updater as never,
    ...options
  })

  return { createUpdateWindow, loadUpdateRenderer, mainWindow, service, updateWindow, updater }
}

describe('UpdateService', () => {
  beforeEach(() => {
    electronMocks.getAllWindows.mockReset()
    electronMocks.getVersion.mockReturnValue('0.1.0')
    electronMocks.ipcHandle.mockReset()
    electronMocks.isPackaged = true
  })

  it('registers update IPC channels', () => {
    const { service } = createService()

    service.registerIpc()

    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('updates:get-state', expect.any(Function))
    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('updates:check', expect.any(Function))
    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('updates:download', expect.any(Function))
    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('updates:install-and-restart', expect.any(Function))
  })

  it('keeps auto download disabled and prompts when an update is available', async () => {
    const updater = new MockUpdater()
    let resolveCheck: (value: null) => void = () => undefined
    updater.checkForUpdates.mockReturnValue(new Promise((resolve) => {
      resolveCheck = resolve
    }))
    const { createUpdateWindow, service, updateWindow } = createService(updater)

    const check = service.check()
    updater.emit('update-available', updateInfo)
    resolveCheck(null)
    const state = await check

    expect(updater.autoDownload).toBe(false)
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(createUpdateWindow).toHaveBeenCalledTimes(1)
    expect(updateWindow.webContents.send).toHaveBeenCalledWith('updates:state-updated', expect.objectContaining({
      status: 'available',
      availableVersion: '0.2.0',
      releaseNotes: 'Update notes'
    }))
    expect(state.status).toBe('available')
  })

  it('broadcasts download progress after the user starts downloading', async () => {
    const updater = new MockUpdater()
    let resolveDownload: (value: string[]) => void = () => undefined
    updater.downloadUpdate.mockReturnValue(new Promise((resolve) => {
      resolveDownload = resolve
    }))
    const { mainWindow, service } = createService(updater)

    updater.emit('update-available', updateInfo)
    const download = service.download()
    updater.emit('download-progress', {
      bytesPerSecond: 2048,
      delta: 1024,
      percent: 42.4,
      total: 10_000,
      transferred: 4_240
    })
    resolveDownload([])
    await download

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('updates:state-updated', expect.objectContaining({
      status: 'downloading',
      progress: {
        bytesPerSecond: 2048,
        percent: 42.4,
        total: 10000,
        transferred: 4240
      }
    }))
  })

  it('marks downloaded updates installable and delegates restart installation', () => {
    const updater = new MockUpdater()
    const { service } = createService(updater)

    updater.emit('update-downloaded', updateInfo)

    expect(service.getState()).toMatchObject({
      status: 'downloaded',
      availableVersion: '0.2.0'
    })
    expect(service.installAndRestart()).toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('preserves updater errors in state and opens the update window for manual checks', async () => {
    const updater = new MockUpdater()
    updater.checkForUpdates.mockRejectedValue(new Error('offline'))
    const { createUpdateWindow, service } = createService(updater)

    const state = await service.check()

    expect(state).toMatchObject({
      status: 'error',
      error: 'offline'
    })
    expect(createUpdateWindow).toHaveBeenCalledTimes(1)
  })

  it('skips update checks outside packaged Windows builds without throwing', async () => {
    const updater = new MockUpdater()
    const { service } = createService(updater, {
      isDev: true,
      isPackaged: false,
      platform: 'win32'
    })

    await expect(service.check()).resolves.toMatchObject({
      status: 'error',
      error: 'Updates are available only in packaged Windows builds.'
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})
