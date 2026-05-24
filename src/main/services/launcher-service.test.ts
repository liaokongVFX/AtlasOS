import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LauncherService } from './launcher-service'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve('')),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: electronMocks.openPath
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'launcher-service-test')

describe('LauncherService', () => {
  beforeEach(async () => {
    electronMocks.ipcHandle.mockClear()
    electronMocks.openExternal.mockClear()
    electronMocks.openPath.mockClear()
    electronMocks.showOpenDialog.mockClear()
    await rm(testRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('opens existing files, folders, and apps through Electron shell.openPath', async () => {
    const filePath = join(testRoot, 'notes.md')
    const appPath = join(testRoot, 'tool.exe')
    const folderPath = join(testRoot, 'folder')
    await writeFile(filePath, 'notes')
    await writeFile(appPath, '')
    await mkdir(folderPath)

    const service = new LauncherService()

    await service.open({ kind: 'file', targetPath: filePath })
    await service.open({ kind: 'app', targetPath: appPath })
    await service.open({ kind: 'folder', targetPath: folderPath })

    expect(electronMocks.openPath).toHaveBeenCalledWith(filePath)
    expect(electronMocks.openPath).toHaveBeenCalledWith(appPath)
    expect(electronMocks.openPath).toHaveBeenCalledWith(folderPath)
  })

  it('rejects missing paths before asking Electron to open them', async () => {
    const service = new LauncherService()

    await expect(service.open({ kind: 'file', targetPath: join(testRoot, 'missing.txt') })).rejects.toThrow()

    expect(electronMocks.openPath).not.toHaveBeenCalled()
  })

  it('opens only http and https URLs externally', async () => {
    const service = new LauncherService()

    await service.open({ kind: 'url', url: 'https://example.com/docs' })
    await expect(service.open({ kind: 'url', url: 'file:///C:/secret.txt' })).rejects.toThrow(/http or https/)

    expect(electronMocks.openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('spawns cmd and PowerShell command windows that remain open', async () => {
    const child = { unref: vi.fn() }
    const spawnProcess = vi.fn(() => child)
    const service = new LauncherService('win32', spawnProcess as never)

    await service.open({ kind: 'command', shell: 'cmd', command: 'echo hi', cwd: testRoot })
    await service.open({ kind: 'command', shell: 'powershell', command: 'Get-ChildItem' })

    expect(spawnProcess).toHaveBeenNthCalledWith(
      1,
      'cmd.exe',
      ['/d', '/s', '/k', 'echo hi'],
      expect.objectContaining({
        cwd: testRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
    )
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      'powershell.exe',
      ['-NoLogo', '-NoExit', '-Command', 'Get-ChildItem'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
    )
    expect(child.unref).toHaveBeenCalledTimes(2)
  })
})
