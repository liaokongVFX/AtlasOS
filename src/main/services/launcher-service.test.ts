import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LauncherService } from './launcher-service'

const electronMocks = vi.hoisted(() => ({
  getFileIcon: vi.fn(),
  ipcHandle: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve('')),
  readShortcutLink: vi.fn(),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getFileIcon: electronMocks.getFileIcon
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: electronMocks.openPath,
    readShortcutLink: electronMocks.readShortcutLink
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'launcher-service-test')

describe('LauncherService', () => {
  beforeEach(async () => {
    electronMocks.getFileIcon.mockClear()
    electronMocks.ipcHandle.mockClear()
    electronMocks.openExternal.mockClear()
    electronMocks.openPath.mockClear()
    electronMocks.readShortcutLink.mockClear()
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

  it('returns the selected app path with its native file icon', async () => {
    const iconDataUrl = 'data:image/png;base64,aWNvbg=='
    const appPath = join(testRoot, 'tool.exe')
    const nativeIcon = {
      isEmpty: vi.fn(() => false),
      toDataURL: vi.fn(() => iconDataUrl)
    }
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [appPath]
    })
    electronMocks.getFileIcon.mockResolvedValueOnce(nativeIcon)

    const service = new LauncherService()
    service.registerIpc()
    const chooseFileHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'launcher:choose-file')?.[1]

    await expect(chooseFileHandler({}, { kind: 'app' })).resolves.toEqual({
      path: appPath,
      iconDataUrl
    })
    expect(electronMocks.getFileIcon).toHaveBeenCalledWith(appPath, { size: 'normal' })
  })

  it('resolves Windows shortcuts before reading the selected app icon', async () => {
    const iconDataUrl = 'data:image/png;base64,dGFyZ2V0LWljb24='
    const shortcutPath = join(testRoot, 'Docker Desktop.lnk')
    const appPath = join(testRoot, 'Docker Desktop.exe')
    const nativeIcon = {
      isEmpty: vi.fn(() => false),
      toDataURL: vi.fn(() => iconDataUrl)
    }
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [shortcutPath]
    })
    electronMocks.readShortcutLink.mockReturnValueOnce({
      target: appPath
    })
    electronMocks.getFileIcon.mockResolvedValueOnce(nativeIcon)

    const service = new LauncherService('win32')
    service.registerIpc()
    const chooseFileHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'launcher:choose-file')?.[1]

    await expect(chooseFileHandler({}, { kind: 'app' })).resolves.toEqual({
      path: shortcutPath,
      iconDataUrl
    })
    expect(electronMocks.readShortcutLink).toHaveBeenCalledWith(shortcutPath)
    expect(electronMocks.getFileIcon).toHaveBeenCalledWith(appPath, { size: 'normal' })
    expect(electronMocks.getFileIcon).not.toHaveBeenCalledWith(shortcutPath, { size: 'normal' })
  })

  it('uses a shortcut explicit icon path before falling back to the shortcut target', async () => {
    const iconDataUrl = 'data:image/png;base64,ZXhwbGljaXQtaWNvbg=='
    const shortcutPath = join(testRoot, 'Docker Desktop.lnk')
    const appPath = join(testRoot, 'Docker Desktop.exe')
    const iconPath = join(testRoot, 'Docker Icon.exe')
    const nativeIcon = {
      isEmpty: vi.fn(() => false),
      toDataURL: vi.fn(() => iconDataUrl)
    }
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [shortcutPath]
    })
    electronMocks.readShortcutLink.mockReturnValueOnce({
      icon: iconPath,
      target: appPath
    })
    electronMocks.getFileIcon.mockResolvedValueOnce(nativeIcon)

    const service = new LauncherService('win32')
    service.registerIpc()
    const chooseFileHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'launcher:choose-file')?.[1]

    await expect(chooseFileHandler({}, { kind: 'app' })).resolves.toEqual({
      path: shortcutPath,
      iconDataUrl
    })
    expect(electronMocks.getFileIcon).toHaveBeenCalledWith(iconPath, { size: 'normal' })
    expect(electronMocks.getFileIcon).not.toHaveBeenCalledWith(appPath, { size: 'normal' })
  })

  it('keeps file selection usable when native icon lookup fails', async () => {
    const filePath = join(testRoot, 'notes.md')
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [filePath]
    })
    electronMocks.getFileIcon.mockRejectedValueOnce(new Error('no icon'))

    const service = new LauncherService()
    service.registerIpc()
    const chooseFileHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'launcher:choose-file')?.[1]

    await expect(chooseFileHandler({}, { kind: 'file' })).resolves.toEqual({
      path: filePath,
      iconDataUrl: null
    })
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

  it('opens cmd and PowerShell commands in visible Windows command line windows', async () => {
    const child = { unref: vi.fn() }
    const spawnProcess = vi.fn(() => child)
    const service = new LauncherService('win32', spawnProcess as never)

    await service.open({ kind: 'command', shell: 'cmd', command: 'echo hi', cwd: testRoot })
    await service.open({ kind: 'command', shell: 'powershell', command: 'Get-ChildItem' })

    expect(spawnProcess).toHaveBeenNthCalledWith(
      1,
      'cmd.exe',
      ['/d', '/s', '/c', 'start', '', 'cmd.exe', '/d', '/s', '/k', 'echo hi'],
      expect.objectContaining({
        cwd: testRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
    )
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      'cmd.exe',
      ['/d', '/s', '/c', 'start', '', 'powershell.exe', '-NoLogo', '-NoExit', '-Command', 'Get-ChildItem'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
    )
    expect(child.unref).toHaveBeenCalledTimes(2)
  })
})
