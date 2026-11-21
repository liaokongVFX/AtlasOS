import { join } from 'node:path'
import { BrowserWindow, clipboard, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import type { QuickInputPanelState } from '@shared/quick-input-panel'
import type { QuickInputSnippet } from '@shared/schema'
import type { QuickInputTarget } from './windows-quick-input'

const PANEL_WIDTH = 520
const PANEL_HEIGHT = 388

type Options = {
  loadPanel(window: BrowserWindow): Promise<void>
  getSnippets(): Promise<QuickInputSnippet[]>
  captureTarget(): Promise<QuickInputTarget | null>
  waitForKeysReleased(): Promise<boolean>
}

type Request = {
  state: QuickInputPanelState
  target: QuickInputTarget | null
  phase: 'opening' | 'choosing' | 'confirming' | 'inserting' | 'failed'
}

export class QuickInputService {
  private window: BrowserWindow | null = null
  private loaded: Promise<void> | null = null
  private active: Request | null = null
  private sequence = 0

  constructor(private readonly options: Options) {
    ipcMain.handle('quick-input:get', (event) => this.fromPanel(event) ? this.active?.state ?? null : null)
    ipcMain.handle('quick-input:choose', (event, id, snippetId) => {
      const request = this.panelRequest(event, id)
      if (request?.phase !== 'choosing' || typeof snippetId !== 'string') return
      return this.submit(request, snippetId, true).catch(() => {
        if (this.active === request) this.finish()
      })
    })
    ipcMain.handle('quick-input:cancel', (event, id) => {
      const request = this.panelRequest(event, id)
      if (request?.phase === 'choosing' || request?.phase === 'failed') this.finish()
    })
    ipcMain.handle('quick-input:copy', (event, id) => {
      const request = this.panelRequest(event, id)
      if (request?.phase !== 'failed' || request.state.failure !== 'unavailable') return
      const snippet = request.state.snippets.find((item) => item.id === request.state.selectedId)
      if (snippet) clipboard.writeText(snippet.text)
      this.finish()
    })
  }

  open(): Promise<void> { return this.begin(null) }
  insertSnippet(snippetId: string): Promise<void> { return this.begin(snippetId) }

  isFocused(): boolean { return this.window?.isFocused() ?? false }

  private fromPanel(event: IpcMainInvokeEvent): boolean {
    return !!this.window && event.sender === this.window.webContents && event.senderFrame === event.sender.mainFrame
  }

  private panelRequest(event: IpcMainInvokeEvent, id: unknown): Request | null {
    return this.fromPanel(event) && this.isFocused() && this.active?.state.requestId === id ? this.active : null
  }

  private async begin(snippetId: string | null): Promise<void> {
    const previous = this.active
    if (previous && (snippetId !== null || !this.isFocused() ||
      (previous.phase !== 'choosing' && previous.phase !== 'failed'))) return
    const request: Request = {
      target: previous?.target ?? null, phase: 'opening',
      state: { requestId: ++this.sequence, snippets: [], failure: null, selectedId: null }
    }
    this.active = request
    try {
      if (!previous) {
        request.target = await this.options.captureTarget()
        if (this.active !== request) { request.target?.release(); return }
      }
      if (snippetId !== null) {
        await this.submit(request, snippetId, false)
      } else {
        request.state.snippets = await this.options.getSnippets()
        await this.show(request, !previous)
      }
    } catch {
      if (this.active === request) this.finish()
    }
  }

  private panel(): BrowserWindow {
    if (this.window) return this.window
    const window = new BrowserWindow({
      width: PANEL_WIDTH, height: PANEL_HEIGHT, show: false, resizable: false, frame: false, skipTaskbar: true,
      title: 'AtlasOS Quick Input', backgroundColor: '#010102',
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    this.window = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-redirect', (event) => event.preventDefault())
    window.on('blur', () => {
      if (this.active && this.active.phase !== 'inserting') this.finish()
    })
    window.on('closed', () => {
      this.window = null
      this.loaded = null
      this.finish()
    })
    this.loaded = this.options.loadPanel(window).catch((error) => { window.destroy(); throw error })
    return window
  }

  private async show(request: Request, verifyTarget: boolean, panelHandle = 0): Promise<void> {
    if (this.active !== request) return
    const window = this.panel()
    await this.loaded
    if (this.active !== request) return
    if (verifyTarget && request.target) {
      const focus = await request.target.focusState(panelHandle)
      if (focus === 'switched' || (focus === 'unavailable' && !request.state.failure)) {
        if (this.active === request) this.finish()
        return
      }
    }
    if (this.active !== request) return
    const point = request.target?.point
    const display = screen.getDisplayNearestPoint(point ? screen.screenToDipPoint(point) : screen.getCursorScreenPoint())
    const { x, y, width, height } = display.workArea
    const w = Math.min(PANEL_WIDTH, width)
    const h = Math.min(request.state.failure ? 220 : PANEL_HEIGHT, height)
    if (window.isMinimized()) window.restore()
    window.setBounds({ x: x + Math.round((width - w) / 2), y: y + Math.round((height - h) / 3), width: w, height: h })
    request.phase = request.state.failure ? 'failed' : 'choosing'
    window.webContents.send('quick-input:changed', request.state)
    window.show()
    window.focus()
  }

  private async submit(request: Request, id: string, fromPanel: boolean): Promise<void> {
    request.phase = 'confirming'
    const snippet = (await this.options.getSnippets()).find((item) => item.id === id)
    if (this.active !== request) return
    if (!snippet) { this.finish(); return }
    request.state.selectedId = id
    request.state.snippets = [snippet]
    const keysReleased = await this.options.waitForKeysReleased()
    if (this.active !== request || (fromPanel && !this.isFocused())) return
    if (!keysReleased || !request.target?.insert) {
      request.state.failure = 'unavailable'
      await this.show(request, !fromPanel)
      return
    }
    request.phase = 'inserting'
    const handle = fromPanel ? this.window!.getNativeWindowHandle().readUInt32LE() : 0
    if (fromPanel) this.window!.minimize()
    const result = await request.target.insert(snippet.text, handle).catch(() => 'unknown' as const)
    if (this.active !== request) return
    if (result === 'inserted') this.finish()
    else {
      // A fresh search may reuse the location, but must never repeat a possibly committed edit.
      if (result === 'unknown') request.target.insert = undefined
      request.state.failure = result
      await this.show(request, true, handle)
    }
  }

  private finish(): void {
    const request = this.active
    this.active = null
    request?.target?.release()
    if (this.window?.isFocused()) this.window.minimize()
    this.window?.hide()
  }

  dispose(): void {
    this.finish()
    this.window?.destroy()
    for (const action of ['get', 'choose', 'cancel', 'copy']) ipcMain.removeHandler('quick-input:' + action)
  }
}
