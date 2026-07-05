import { join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { app, BrowserWindow, Menu, nativeImage, session, shell, Tray, type NativeImage } from 'electron'
import { DEFAULT_LOCALE, type Locale } from '@shared/constants'
import { translateShared } from '@shared/locale-text'
import { CanvasPersistence } from './services/canvas-persistence'
import { FileSystemService } from './services/ipc-filesystem'
import { PtyService } from './services/pty-service'
import { RemoteServerService } from './services/remote-server-service'
import { BrowserService } from './services/browser-service'
import { AppSettingsService } from './services/app-settings-service'
import { AiTranslationService } from './services/ai-translation-service'
import { AppDatabaseService } from './services/app-database-service'
import { AgentUsageService } from './services/agent-usage-service'
import { PluginService } from './services/plugin-service'
import { WorkspaceDocumentService } from './services/workspace-document-service'
import { LauncherService } from './services/launcher-service'
import { PetService } from './services/pet-service'
import { SystemMetricsService } from './services/system-metrics-service'
import { GitService } from './services/git-service'
import { ClaudeHistoryService } from './services/claude-history-service'
import { CodexHistoryService } from './services/codex-history-service'
import { UpdateService } from './services/update-service'
import { applyAtlasBrowserNetworkPolicy, applyAtlasBrowserWebPreferences } from './services/browser-network-policy'
import { registerLocalAssetProtocol, registerLocalAssetScheme } from './services/local-asset-protocol'
import { createContentSecurityPolicy } from './security-policy'
import type { PetAlertTarget } from '@shared/pet'

let mainWindow: BrowserWindow | null = null
let mainWindowCreation: Promise<void> | null = null
let tray: Tray | null = null
let browserService: BrowserService | null = null
let fileSystemService: FileSystemService | null = null
let pluginService: PluginService | null = null
let ptyService: PtyService | null = null
let remoteServerService: RemoteServerService | null = null
let appSettingsService: AppSettingsService | null = null
let aiTranslationService: AiTranslationService | null = null
let appDatabaseService: AppDatabaseService | null = null
let petService: PetService | null = null
let updateService: UpdateService | null = null
let trayLocale: Locale = DEFAULT_LOCALE
let isQuitting = false

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const forceSoftwareRendering = process.env.ATLAS_FORCE_SOFTWARE_RENDERING === '1'
const atlasLogoPath = join(__dirname, '../../build/icon.png')
const atlasLogo16Path = join(__dirname, '../../build/icon-16.png')
const atlasLogo32Path = join(__dirname, '../../build/icon-32.png')

function isBrowserNavigableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isExternalProtocolUrl(url: string): boolean {
  return /^(mailto|tel):/i.test(url)
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return

  applyAtlasBrowserNetworkPolicy(contents)

  contents.on('zoom-changed', (event, zoomDirection) => {
    if (!browserService?.handleDomWebviewZoomChanged(contents, zoomDirection)) return

    event.preventDefault()
  })

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
  pluginService?.dispose()
  ptyService?.dispose()
  remoteServerService?.dispose()
  aiTranslationService?.dispose()
  appDatabaseService?.close()
  petService?.dispose()
  updateService?.dispose()

  browserService = null
  fileSystemService = null
  pluginService = null
  ptyService = null
  remoteServerService = null
  aiTranslationService = null
  appDatabaseService = null
  petService = null
  updateService = null
}

function configureAppRuntime(): void {
  if (process.platform === 'win32') {
    app.setAppUserModelId('dev.atlasos.workbench')
  }

  if (isDev) {
    const devUserData = join(process.cwd(), '.atlasos-dev', 'user-data')
    const devSessionData = join(process.cwd(), '.atlasos-dev', 'session-data')
    mkdirSync(devUserData, { recursive: true })
    mkdirSync(devSessionData, { recursive: true })
    app.setPath('userData', devUserData)
    app.setPath('sessionData', devSessionData)
  }

  if (forceSoftwareRendering) {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-gpu-compositing')
    app.commandLine.appendSwitch('disable-direct-composition')
  }
}

function pngDataUrlFromPath(filePath: string): string {
  return `data:image/png;base64,${readFileSync(filePath).toString('base64')}`
}

function createTrayIcon(): NativeImage {
  const icon = nativeImage.createFromPath(atlasLogo16Path)
  icon.addRepresentation({ scaleFactor: 2, dataURL: pngDataUrlFromPath(atlasLogo32Path) })
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

async function showSettings(): Promise<void> {
  const window = await ensureMainWindow()

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
  window.webContents.send('app:open-settings')
}

async function openPetTarget(target: PetAlertTarget): Promise<void> {
  const window = await ensureMainWindow()

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
  window.webContents.send('app:open-target', target)
}

function quitApp(): void {
  isQuitting = true
  app.quit()
}

function ensureTray(): void {
  if (tray) return

  tray = new Tray(createTrayIcon())
  updateTrayMenu()

  tray.on('double-click', () => {
    void showMainWindow()
  })

  if (process.platform === 'linux') {
    tray.on('click', () => {
      void showMainWindow()
    })
  }
}

function updateTrayMenu(): void {
  if (!tray) return

  tray.setToolTip(translateShared(trayLocale, 'main.trayTooltip'))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: translateShared(trayLocale, 'main.openAtlas'),
        click: () => {
          void showMainWindow()
        }
      },
      {
        label: translateShared(trayLocale, 'main.settings'),
        click: () => {
          void showSettings()
        }
      },
      { type: 'separator' },
      {
        label: translateShared(trayLocale, 'main.quitAtlas'),
        click: quitApp
      }
    ])
  )
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

type RendererView = 'pet' | 'translation' | 'capture' | 'update'

async function loadRenderer(window: BrowserWindow, view?: RendererView): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = process.env.ELECTRON_RENDERER_URL
    await waitForRendererDevServer(url)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const targetUrl = new URL(url)
        if (view) targetUrl.searchParams.set('view', view)
        await window.loadURL(targetUrl.toString())
        return
      } catch (error) {
        if (attempt === 3) throw error
        console.warn(`Renderer load failed, retrying (${attempt}/3):`, error)
        await sleep(250)
      }
    }
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'), view ? { query: { view } } : undefined)
  }
}

function createUpdateWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 460,
    height: 300,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    title: 'AtlasOS Update',
    icon: atlasLogoPath,
    backgroundColor: '#010102',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  return window
}

function installSecurityDefaults(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [createContentSecurityPolicy(isDev)]
      }
    })
  })
}

async function createWindow(): Promise<void> {
  appSettingsService = new AppSettingsService()
  appDatabaseService = new AppDatabaseService()
  const settings = await appSettingsService.getSettings()
  trayLocale = settings.locale
  updateTrayMenu()

  const persistence = new CanvasPersistence(() => appSettingsService?.getSettings() ?? Promise.resolve(settings))
  await persistence.initialize()

  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'AtlasOS',
    icon: atlasLogoPath,
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

    applyAtlasBrowserWebPreferences(webPreferences)
    webPreferences.contextIsolation = true
    webPreferences.nodeIntegration = false
    webPreferences.sandbox = true
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  petService = new PetService({
    persistence,
    appSettingsService,
    loadPetRenderer: (targetWindow) => loadRenderer(targetWindow, 'pet'),
    openTarget: openPetTarget,
    onAgentProviderSessionResolved: (context) => ptyService?.recordAgentProviderSession(context),
    onAgentProviderSessionEnded: (context) => ptyService?.recordAgentProviderSessionEnded(context)
  })
  aiTranslationService = new AiTranslationService({
    appSettingsService,
    getMainWindow: () => mainWindow,
    loadTranslationRenderer: (targetWindow) => loadRenderer(targetWindow, 'translation'),
    loadCaptureRenderer: (targetWindow) => loadRenderer(targetWindow, 'capture')
  })
  aiTranslationService.registerIpc()

  new WorkspaceDocumentService(persistence, () => petService?.scanKanban()).registerIpc()
  fileSystemService = new FileSystemService()
  fileSystemService.registerIpc()
  ptyService = new PtyService({
    getAgentHookEnvironment: (context) => petService?.getAgentHookEnvironment(context) ?? {},
    onAgentCommandStarted: (context) => petService?.recordAgentCommandStarted(context),
    onSessionClosed: (sessionId) => petService?.removeAgentSession(sessionId)
  })
  ptyService.registerIpc()
  remoteServerService = new RemoteServerService({ appSettingsService })
  remoteServerService.registerIpc()
  browserService = new BrowserService(window, {
    onGuestTranslationRequest: (text) => {
      void aiTranslationService?.openTranslator(text, 'browser')
    },
    onGuestScreenshotCaptureRequest: () => {
      void aiTranslationService?.startScreenshotCapture('browser')
    }
  })
  browserService.registerIpc()
  new LauncherService().registerIpc()
  new SystemMetricsService().registerIpc()
  new GitService().registerIpc()
  new ClaudeHistoryService().registerIpc()
  new CodexHistoryService().registerIpc()
  new AgentUsageService({ databaseService: appDatabaseService, appSettingsService }).registerIpc()
  updateService = new UpdateService({
    isDev,
    isPackaged: app.isPackaged,
    createUpdateWindow,
    loadUpdateRenderer: (targetWindow) => loadRenderer(targetWindow as BrowserWindow, 'update')
  })
  updateService.registerIpc()
  appSettingsService.registerIpc((nextSettings) => {
    trayLocale = nextSettings.locale
    updateTrayMenu()
    void aiTranslationService?.refreshSystemHook()
  })
  pluginService = new PluginService()
  pluginService.registerIpc()
  await petService.start()

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
  void updateService.startAutoCheck(settings.updates.autoCheck).catch((error) => {
    console.error('AtlasOS automatic update check failed', error)
  })
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
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
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
