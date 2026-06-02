import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import { z } from 'zod'
import type { AtlasUpdateProgress, AtlasUpdateState } from '@shared/updates'
import { handleValidated } from './ipc-helpers'

const { autoUpdater } = electronUpdater

type UpdateWebContents = {
  isDestroyed: () => boolean
  send: (channel: string, ...args: unknown[]) => void
}

type BroadcastWindow = {
  isDestroyed: () => boolean
  webContents: UpdateWebContents
}

type UpdateWindow = BroadcastWindow & {
  close: () => void
  focus: () => void
  once: (event: 'closed', listener: () => void) => unknown
  show: () => void
}

type UpdateServiceOptions = {
  appVersion?: string
  createUpdateWindow?: () => UpdateWindow
  getWindows?: () => BroadcastWindow[]
  isDev?: boolean
  isPackaged?: boolean
  loadUpdateRenderer?: (window: UpdateWindow) => Promise<void>
  now?: () => Date
  platform?: NodeJS.Platform
  updater?: AppUpdater
}

const emptyInputSchema = z.object({})

function releaseNotesText(releaseNotes: UpdateInfo['releaseNotes']): string | null {
  if (typeof releaseNotes === 'string') return releaseNotes.trim() || null
  if (!Array.isArray(releaseNotes)) return null

  const notes = releaseNotes
    .map((entry) => entry.note?.trim())
    .filter((entry): entry is string => Boolean(entry))

  return notes.length > 0 ? notes.join('\n\n') : null
}

function updateMetadata(info: UpdateInfo): Pick<AtlasUpdateState, 'availableVersion' | 'releaseDate' | 'releaseName' | 'releaseNotes'> {
  return {
    availableVersion: info.version,
    releaseDate: info.releaseDate,
    releaseName: info.releaseName ?? null,
    releaseNotes: releaseNotesText(info.releaseNotes)
  }
}

function progressState(progress: ProgressInfo): AtlasUpdateProgress {
  return {
    bytesPerSecond: Math.max(0, Math.round(progress.bytesPerSecond)),
    percent: Math.min(100, Math.max(0, progress.percent)),
    total: Math.max(0, Math.round(progress.total)),
    transferred: Math.max(0, Math.round(progress.transferred))
  }
}

function errorMessage(error: unknown, fallback = 'Update check failed'): string {
  if (error instanceof Error && error.message) return error.message
  return typeof error === 'string' && error.trim() ? error : fallback
}

export class UpdateService {
  private readonly updater: AppUpdater
  private readonly createUpdateWindow?: () => UpdateWindow
  private readonly getWindows: () => BroadcastWindow[]
  private readonly isDev: boolean
  private readonly isPackaged: boolean
  private readonly loadUpdateRenderer?: (window: UpdateWindow) => Promise<void>
  private readonly now: () => Date
  private readonly platform: NodeJS.Platform
  private readonly listenerDisposers: Array<() => void> = []
  private updateWindow: UpdateWindow | null = null
  private state: AtlasUpdateState

  constructor(options: UpdateServiceOptions = {}) {
    this.updater = options.updater ?? autoUpdater
    this.createUpdateWindow = options.createUpdateWindow
    this.getWindows = options.getWindows ?? (() => BrowserWindow.getAllWindows())
    this.isDev = options.isDev ?? Boolean(process.env.ELECTRON_RENDERER_URL)
    this.isPackaged = options.isPackaged ?? app.isPackaged
    this.loadUpdateRenderer = options.loadUpdateRenderer
    this.now = options.now ?? (() => new Date())
    this.platform = options.platform ?? process.platform
    this.state = {
      status: 'idle',
      currentVersion: options.appVersion ?? app.getVersion(),
      updatedAt: this.timestamp()
    }

    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.registerUpdaterEvents()
  }

  registerIpc(): void {
    handleValidated('updates:get-state', emptyInputSchema, () => this.getState())
    handleValidated('updates:check', emptyInputSchema, () => this.check())
    handleValidated('updates:download', emptyInputSchema, () => this.download())
    handleValidated('updates:install-and-restart', emptyInputSchema, () => this.installAndRestart())
  }

  getState(): AtlasUpdateState {
    return { ...this.state, progress: this.state.progress ? { ...this.state.progress } : undefined }
  }

  async startAutoCheck(autoCheck: boolean): Promise<AtlasUpdateState> {
    if (!autoCheck) return this.getState()
    return this.check({ automatic: true })
  }

  async check(options: { automatic?: boolean } = {}): Promise<AtlasUpdateState> {
    if (!this.canUseUpdater()) {
      return this.setState({
        status: 'error',
        currentVersion: this.state.currentVersion,
        error: 'Updates are available only in packaged Windows builds.',
        lastCheckedAt: this.timestamp()
      })
    }

    this.setState({
      status: 'checking',
      currentVersion: this.state.currentVersion,
      lastCheckedAt: this.timestamp()
    })

    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.setState({
        status: 'error',
        currentVersion: this.state.currentVersion,
        error: errorMessage(error),
        lastCheckedAt: this.timestamp()
      })
      if (!options.automatic) void this.openUpdateWindow()
    }

    return this.getState()
  }

  async download(): Promise<AtlasUpdateState> {
    if (!this.canUseUpdater()) {
      const state = this.setState({
        status: 'error',
        currentVersion: this.state.currentVersion,
        error: 'Updates are available only in packaged Windows builds.',
        lastCheckedAt: this.timestamp()
      })
      void this.openUpdateWindow()
      return state
    }

    if (!this.state.availableVersion) {
      const state = this.setState({
        status: 'error',
        currentVersion: this.state.currentVersion,
        error: 'No update is ready to download.',
        lastCheckedAt: this.state.lastCheckedAt
      })
      void this.openUpdateWindow()
      return state
    }

    this.setState({
      ...this.keepUpdateMetadata(),
      status: 'downloading',
      currentVersion: this.state.currentVersion,
      progress: this.state.progress ?? {
        bytesPerSecond: 0,
        percent: 0,
        total: 0,
        transferred: 0
      }
    })
    void this.openUpdateWindow()

    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.setState({
        ...this.keepUpdateMetadata(),
        status: 'error',
        currentVersion: this.state.currentVersion,
        error: errorMessage(error, 'Update download failed'),
        lastCheckedAt: this.state.lastCheckedAt
      })
      void this.openUpdateWindow()
    }

    return this.getState()
  }

  installAndRestart(): { ok: true } {
    this.updater.quitAndInstall(false, true)
    return { ok: true }
  }

  dispose(): void {
    for (const dispose of this.listenerDisposers.splice(0)) dispose()
    if (this.updateWindow && !this.updateWindow.isDestroyed()) this.updateWindow.close()
    this.updateWindow = null
  }

  private canUseUpdater(): boolean {
    return !this.isDev && this.isPackaged && this.platform === 'win32'
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private setState(patch: Omit<AtlasUpdateState, 'updatedAt'>): AtlasUpdateState {
    this.state = {
      ...patch,
      updatedAt: this.timestamp()
    }
    this.broadcastState()
    return this.getState()
  }

  private keepUpdateMetadata(): Pick<AtlasUpdateState, 'availableVersion' | 'releaseDate' | 'releaseName' | 'releaseNotes'> {
    return {
      availableVersion: this.state.availableVersion,
      releaseDate: this.state.releaseDate,
      releaseName: this.state.releaseName,
      releaseNotes: this.state.releaseNotes
    }
  }

  private registerUpdaterEvents(): void {
    this.onUpdater('checking-for-update', () => {
      this.setState({
        status: 'checking',
        currentVersion: this.state.currentVersion,
        lastCheckedAt: this.timestamp()
      })
    })
    this.onUpdater('update-available', (info: UpdateInfo) => {
      this.setState({
        status: 'available',
        currentVersion: this.state.currentVersion,
        lastCheckedAt: this.state.lastCheckedAt ?? this.timestamp(),
        ...updateMetadata(info)
      })
      void this.openUpdateWindow()
    })
    this.onUpdater('update-not-available', (info: UpdateInfo) => {
      this.setState({
        status: 'not-available',
        currentVersion: this.state.currentVersion,
        lastCheckedAt: this.timestamp(),
        ...updateMetadata(info)
      })
    })
    this.onUpdater('download-progress', (progress: ProgressInfo) => {
      this.setState({
        ...this.keepUpdateMetadata(),
        status: 'downloading',
        currentVersion: this.state.currentVersion,
        lastCheckedAt: this.state.lastCheckedAt,
        progress: progressState(progress)
      })
      void this.openUpdateWindow()
    })
    this.onUpdater('update-downloaded', (info: UpdateInfo) => {
      this.setState({
        status: 'downloaded',
        currentVersion: this.state.currentVersion,
        lastCheckedAt: this.state.lastCheckedAt,
        progress: this.state.progress,
        ...updateMetadata(info)
      })
      void this.openUpdateWindow()
    })
    this.onUpdater('error', (error: Error) => {
      this.setState({
        ...this.keepUpdateMetadata(),
        status: 'error',
        currentVersion: this.state.currentVersion,
        error: errorMessage(error),
        lastCheckedAt: this.state.lastCheckedAt
      })
      void this.openUpdateWindow()
    })
  }

  private onUpdater<TArgs extends unknown[]>(channel: string, listener: (...args: TArgs) => void): void {
    const updater = this.updater as unknown as {
      on: (channel: string, listener: (...args: unknown[]) => void) => void
      removeListener: (channel: string, listener: (...args: unknown[]) => void) => void
    }
    const wrapped = listener as (...args: unknown[]) => void
    updater.on(channel, wrapped)
    this.listenerDisposers.push(() => updater.removeListener(channel, wrapped))
  }

  private broadcastState(): void {
    const state = this.getState()

    for (const window of this.getWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      window.webContents.send('updates:state-updated', state)
    }
  }

  private async openUpdateWindow(): Promise<void> {
    if (!this.createUpdateWindow || !this.loadUpdateRenderer) return

    if (!this.updateWindow || this.updateWindow.isDestroyed()) {
      const window = this.createUpdateWindow()
      this.updateWindow = window
      window.once('closed', () => {
        if (this.updateWindow === window) this.updateWindow = null
      })
      await this.loadUpdateRenderer(window)
    }

    if (this.updateWindow.isDestroyed()) return
    this.updateWindow.webContents.send('updates:state-updated', this.getState())
    this.updateWindow.show()
    this.updateWindow.focus()
  }
}
