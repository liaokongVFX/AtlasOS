import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { app, BrowserWindow, Menu, nativeImage, session, shell, Tray, type NativeImage } from 'electron'
import { CanvasPersistence } from './services/canvas-persistence'
import { FileSystemService } from './services/ipc-filesystem'
import { PtyService } from './services/pty-service'
import { BrowserService } from './services/browser-service'
import { WorkspaceDocumentService } from './services/workspace-document-service'
import { registerLocalAssetProtocol, registerLocalAssetScheme } from './services/local-asset-protocol'

let mainWindow: BrowserWindow | null = null
let mainWindowCreation: Promise<void> | null = null
let tray: Tray | null = null
let browserService: BrowserService | null = null
let fileSystemService: FileSystemService | null = null
let ptyService: PtyService | null = null
let isQuitting = false

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const trayIcon16 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAABgklEQVR4nGNgYGBg4BUQ9+EREDvFKyj2k1dQ/D9+LPYTolbcmwGmmZegJuyYh18sgIFHUOw0LgWyimpgjNMAAbGTDPic3dHd/7+9qw+fd34w4JJUUNX6/+bdh//vPnz6r6yui9MQBlwSU6bN+v/j1x8wnjx1JmkGaOoa///4+dv/w0dP/D905Pj/T1++/9fWNyXegPkLl4JtDs8s+R+UUgBmz1u4hDgDjEyt/3/9/vP/+4+f/zuuuP7fcfm1/6/evAOLgeQIGrBy7QawjYdf/v7vefgnGIPYILEVa9bjN8Da3vn/958QxdGHP/+fdO7l/4lnX/6POvz5//dff8ByIDU4Ddi6fTdY89xjt/6brHn0n09c4T+/mNx/49UP/s8/cQcst2XbLnQDxMAJycXDF6wAZJP9yhv/5aPK4Irko8v/26++DZYDqfHwCUAkJPSkLKJj/d94+Z3//GKycDEQGyQGksOSlMW9MaJHSBIzyrCJCUp4QXKkoLg3yDQSsvNJmGYAUm6m7l8hypkAAAAASUVORK5CYII='
const trayIcon32 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAADX0lEQVR4nMVXbUhTYRTe/92ld7q908zK/EoJM9BphSiEECmBH334URklJa36kTSUqLSi+lEEBUWl9AFBPwytJE3DLNEsnc2K8lucTi3Tbc7NDzzxvtOr1zvZvG72woG795zzPM8573b3HoFg3hIKkVREo0siGqkoV+moiEbgCMNYFI0aRTTKxxwCa4sSy5IpV6R3FOniYpCeEsuSOOQiGk07m3yeTTMihEIkXYnKrXRCR1EyiWDmzOE/WR4W0MQXYNfuRGK8u0CjRgHligx8AWpq66G2vgFWiWV8j0GPO8AreW/KQTBPTBHbs/8A7y4I+CS5uHnAF5WaEaBSfyd7KyYg42gWQz5rh44cXxkBYqkX/Gxp4whoaesAN+TlfAGK09kc8lk7ceqMcwVIZN7Q0d3DEH6oqYPqj7XM564eDUg91zlPgDL3Aqvi1PTDkLwvnbV3Nue8cwTIvHxA09vPELV1dAEtWU3eAU3NP5j9Pu0geHr7Ol5A3uVrrEqzlefA59hVYplZJ1m+/CvXHStgre9G+D00zBD8+TsCG+IyIKLSTGxNbCq0d3Yz/qFhHaz3D3acgBu3brMqbG3vhPjSXkZAXGkfNH2bOwZsOMchAvwCQ2BYZ2CBV/ZPEuKt7yyGn/He/JgRgxECgjYvX8C9B4UsYNPEFKTVWUhz1eOQox4nzyl1ZhgbZ78X7t4vWJ6A4JAw0I+aWKBl2rnqf41MQqtuErbNdKFcy+6CwWiCTaFy/gKePnvOAsQVJlbpCJmiegA+fVYRU1QPkr2E93pOFzAGLwHhkVEwZp5ggd2paSNE8rdGcA+OZGLdguQgLx8lvsJGDVu0eQIit8csXcCLktec6qOKughJQO5jTnxg7hPiiy7WgHFBF4qKXy1NQFRMLJjG2edZ8FVrqb7MAOLAME6O2H8L8eGYR80DnD+q6B07rQugrNyIyyuqONVHl2gIuL/y4aLVBCgLLF14qeV0AWNauxkL8BRk66fiFZ9JgMPf6EHsF7poHPbhGByLc+y6lIpolG8r0DM2DSIqxsBXcdMmKI7BsTjHVqyIRhftHkxcPHzsAbQ7lqLRCEV5uM+OZkkrPpq5SBIWzodJ+EvhbHJS+UJyRgQlk+BxiaKlDcsZWDikrsiAMfGZM22fWf8AlzWh1rEzJ7YAAAAASUVORK5CYII='

function isBrowserNavigableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isExternalProtocolUrl(url: string): boolean {
  return /^(mailto|tel):/i.test(url)
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return

  contents.setWindowOpenHandler(({ url }) => {
    if (isBrowserNavigableUrl(url)) {
      const target = mainWindow?.webContents
      if (target && !target.isDestroyed()) {
        target.send('browser:webview-open-tab-requested', {
          sourceWebContentsId: contents.id,
          url
        })
      }
    } else if (isExternalProtocolUrl(url)) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })
})

function disposeWindowServices(): void {
  browserService?.dispose()
  fileSystemService?.dispose()
  ptyService?.dispose()

  browserService = null
  fileSystemService = null
  ptyService = null
}

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

function createTrayIcon(): NativeImage {
  const icon = nativeImage.createFromDataURL(trayIcon16)
  icon.addRepresentation({ scaleFactor: 2, dataURL: trayIcon32 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  return icon
}

async function ensureMainWindow(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  mainWindowCreation ??= createWindow().finally(() => {
    mainWindowCreation = null
  })
  await mainWindowCreation

  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Failed to create the AtlasOS main window')
  }

  return mainWindow
}

async function showMainWindow(): Promise<void> {
  const window = await ensureMainWindow()

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

function quitApp(): void {
  isQuitting = true
  app.quit()
}

function ensureTray(): void {
  if (tray) return

  tray = new Tray(createTrayIcon())
  tray.setToolTip('AtlasOS - double-click to open')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open AtlasOS',
        click: () => {
          void showMainWindow()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit AtlasOS',
        click: quitApp
      }
    ])
  )

  tray.on('double-click', () => {
    void showMainWindow()
  })

  if (process.platform === 'linux') {
    tray.on('click', () => {
      void showMainWindow()
    })
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
            ? "default-src 'self' http://localhost:* ws://localhost:* data: blob:; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: atlas-file: https:; media-src 'self' data: blob: atlas-file:; frame-src http: https:;"
            : "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: atlas-file: https:; media-src 'self' data: blob: atlas-file:; frame-src http: https:;"
        ]
      }
    })
  })
}

async function createWindow(): Promise<void> {
  const persistence = new CanvasPersistence()
  await persistence.initialize()

  const window = new BrowserWindow({
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
      sandbox: true,
      webviewTag: true
    }
  })
  mainWindow = window

  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = params.src ?? ''
    const partition = params.partition ?? ''

    if (!isBrowserNavigableUrl(src) || !partition.startsWith('persist:atlas-browser-')) {
      event.preventDefault()
      return
    }

    delete webPreferences.preload
    webPreferences.contextIsolation = true
    webPreferences.nodeIntegration = false
    webPreferences.sandbox = true
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  new WorkspaceDocumentService(persistence).registerIpc()
  fileSystemService = new FileSystemService()
  fileSystemService.registerIpc()
  ptyService = new PtyService()
  ptyService.registerIpc()
  browserService = new BrowserService(window)
  browserService.registerIpc()

  window.on('close', (event) => {
    if (isQuitting) {
      disposeWindowServices()
      return
    }

    event.preventDefault()
    window.hide()
  })
  window.once('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  let didShow = false
  const revealWindow = (): void => {
    if (didShow || window.isDestroyed()) return
    didShow = true
    window.show()
    if (isDev && !window.webContents.isDestroyed()) window.webContents.openDevTools({ mode: 'detach' })
  }

  window.once('ready-to-show', revealWindow)
  window.webContents.once('did-finish-load', revealWindow)
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
    revealWindow()
  })

  await loadRenderer(window)
}

configureAppRuntime()

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  isQuitting = true
  app.quit()
} else {
  registerLocalAssetScheme()

  app.on('second-instance', () => {
    void app.whenReady().then(showMainWindow).catch((error) => {
      console.error('AtlasOS failed to show the existing window', error)
    })
  })

  app.whenReady().then(async () => {
    installSecurityDefaults()
    registerLocalAssetProtocol()
    await createWindow()
    ensureTray()

    app.on('activate', () => {
      void showMainWindow()
    })
  }).catch((error) => {
    console.error('AtlasOS failed to start', error)
    app.quit()
  })

  app.on('window-all-closed', () => {
    disposeWindowServices()

    if (!isQuitting && process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    disposeWindowServices()
  })

  app.on('will-quit', () => {
    tray?.destroy()
    tray = null
  })
}
