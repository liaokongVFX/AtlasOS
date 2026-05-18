import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { app, BrowserWindow, session, shell } from 'electron'
import { CanvasPersistence } from './services/canvas-persistence'
import { FileSystemService } from './services/ipc-filesystem'
import { PtyService } from './services/pty-service'
import { BrowserService } from './services/browser-service'
import { WorkspaceDocumentService } from './services/workspace-document-service'

let mainWindow: BrowserWindow | null = null
let browserService: BrowserService | null = null
let fileSystemService: FileSystemService | null = null
let ptyService: PtyService | null = null

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)

function configureAppRuntime(): void {
  if (isDev) {
    const devUserData = join(process.cwd(), '.atlasos-dev', 'user-data')
    const devSessionData = join(process.cwd(), '.atlasos-dev', 'session-data')
    mkdirSync(devUserData, { recursive: true })
    mkdirSync(devSessionData, { recursive: true })
    app.setPath('userData', devUserData)
    app.setPath('sessionData', devSessionData)

    // Electron 42 can hard-fail the GPU process on some Windows VM/sandbox setups.
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-gpu-compositing')
    app.commandLine.appendSwitch('disable-direct-composition')
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRendererDevServer(url: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (response.ok) return
    } catch {
      // Vite can print its local URL a hair before Electron's process can connect.
    }

    await sleep(150)
  }

  throw new Error(`Timed out waiting for renderer dev server: ${url}`)
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = process.env.ELECTRON_RENDERER_URL
    await waitForRendererDevServer(url)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await window.loadURL(url)
        return
      } catch (error) {
        if (attempt === 3) throw error
        console.warn(`Renderer load failed, retrying (${attempt}/3):`, error)
        await sleep(250)
      }
    }
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function installSecurityDefaults(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self' http://localhost:* ws://localhost:* data: blob:; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: https:;"
            : "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: https:;"
        ]
      }
    })
  })
}

async function createWindow(): Promise<void> {
  const persistence = new CanvasPersistence()
  await persistence.initialize()

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'AtlasOS',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  new WorkspaceDocumentService(persistence).registerIpc()
  fileSystemService = new FileSystemService()
  fileSystemService.registerIpc()
  ptyService = new PtyService()
  ptyService.registerIpc()
  browserService = new BrowserService(mainWindow)
  browserService.registerIpc()

  let didShow = false
  const revealWindow = (): void => {
    if (didShow || !mainWindow || mainWindow.isDestroyed()) return
    didShow = true
    mainWindow.show()
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.once('ready-to-show', revealWindow)
  mainWindow.webContents.once('did-finish-load', revealWindow)
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
    revealWindow()
  })

  await loadRenderer(mainWindow)
}

configureAppRuntime()

app.whenReady().then(async () => {
  installSecurityDefaults()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
}).catch((error) => {
  console.error('AtlasOS failed to start', error)
  app.quit()
})

app.on('window-all-closed', () => {
  browserService?.dispose()
  fileSystemService?.dispose()
  ptyService?.dispose()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
