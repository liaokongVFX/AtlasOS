import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain, View, WebContentsView, type IpcMainEvent, type WebContents } from 'electron'
import {
  browserBoundsInputSchema,
  browserClickInputSchema,
  browserCreateTabInputSchema,
  browserNavigateInputSchema,
  browserSelectorInputSchema,
  browserSetZoomInputSchema,
  browserTabInputSchema,
  browserTypeInputSchema
} from '@shared/ipc'
import {
  BROWSER_WEBVIEW_CANVAS_ZOOM_REQUESTED_CHANNEL,
  BROWSER_WEBVIEW_SCREENSHOT_CAPTURE_REQUEST_CHANNEL,
  BROWSER_WEBVIEW_TRANSLATION_REQUEST_CHANNEL,
  BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL,
  BROWSER_ZOOM_DEFAULT_FACTOR,
  BROWSER_ZOOM_MAX_FACTOR,
  BROWSER_ZOOM_MIN_FACTOR,
  BROWSER_ZOOM_STEP,
  type BrowserWebviewCanvasZoomRequest
} from '@shared/browser'
import { applyAtlasBrowserNetworkPolicy, applyAtlasBrowserWebPreferences } from './browser-network-policy'
import { handleValidated } from './ipc-helpers'

type BrowserTab = {
  id: string
  componentId: string
  container: View
  loadSequence: number
  view: WebContentsView
  visible: boolean
}

type BrowserServiceOptions = {
  onGuestTranslationRequest?: (text: string) => void
  onGuestScreenshotCaptureRequest?: () => void
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

const HIDDEN_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
const BROWSER_CONTENT_BACKGROUND = '#ffffff'
const WEBVIEW_CANVAS_ZOOM_CHANGED_DELTA_PX = 100

function childBoundsForClippedContainer(containerBounds: BrowserBounds, contentBounds: BrowserBounds): BrowserBounds {
  return {
    x: contentBounds.x - containerBounds.x,
    y: contentBounds.y - containerBounds.y,
    width: contentBounds.width,
    height: contentBounds.height
  }
}

function clampZoomFactor(value: number): number {
  return Math.min(Math.max(value, BROWSER_ZOOM_MIN_FACTOR), BROWSER_ZOOM_MAX_FACTOR)
}

function normalizeCommittedZoomFactor(value: number): number {
  return Math.round(clampZoomFactor(value) * 100) / 100
}

function nextZoomFactor(current: number, direction: -1 | 1): number {
  return normalizeCommittedZoomFactor(current + direction * BROWSER_ZOOM_STEP)
}

function readZoomDirection(value: unknown): -1 | 1 | null {
  if (!value || typeof value !== 'object') return null

  const direction = (value as { direction?: unknown }).direction
  return direction === -1 || direction === 1 ? direction : null
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readWebviewCanvasZoomRequest(value: unknown): Omit<BrowserWebviewCanvasZoomRequest, 'sourceWebContentsId'> | null {
  if (!value || typeof value !== 'object') return null

  const input = value as Record<string, unknown>
  const clientX = readFiniteNumber(input.clientX)
  const clientY = readFiniteNumber(input.clientY)
  const deltaMode = readFiniteNumber(input.deltaMode)
  const deltaX = readFiniteNumber(input.deltaX) ?? 0
  const deltaY = readFiniteNumber(input.deltaY) ?? 0

  if (clientX === null || clientY === null || deltaMode === null) return null
  if (deltaMode !== 0 && deltaMode !== 1 && deltaMode !== 2) return null
  if (deltaX === 0 && deltaY === 0) return null

  return {
    clientX,
    clientY,
    deltaX,
    deltaY,
    deltaMode
  }
}

function isNavigationAbort(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as { errno?: unknown; message?: unknown }
  return candidate.errno === -3 || (typeof candidate.message === 'string' && candidate.message.includes('ERR_ABORTED'))
}

export class BrowserService {
  private readonly tabs = new Map<string, BrowserTab>()
  private screenshotCaptureRequestHandler: ((event: IpcMainEvent, payload: unknown) => void) | null = null
  private translationRequestHandler: ((event: IpcMainEvent, payload: unknown) => void) | null = null
  private zoomRequestHandler: ((event: IpcMainEvent, payload: unknown) => void) | null = null

  constructor(private readonly window: BrowserWindow, private readonly options: BrowserServiceOptions = {}) {}

  handleDomWebviewZoomChanged(webContents: WebContents, zoomDirection: 'in' | 'out'): boolean {
    if (webContents.getType() !== 'webview') return false

    this.emitWebviewCanvasZoomRequested({
      sourceWebContentsId: webContents.id,
      anchor: 'center',
      deltaMode: 0,
      deltaX: 0,
      deltaY: zoomDirection === 'in' ? -WEBVIEW_CANVAS_ZOOM_CHANGED_DELTA_PX : WEBVIEW_CANVAS_ZOOM_CHANGED_DELTA_PX
    })
    return true
  }

  registerIpc(): void {
    this.zoomRequestHandler = (event, payload) => this.handleGuestZoomRequest(event.sender, payload)
    ipcMain.on(BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL, this.zoomRequestHandler)
    this.translationRequestHandler = (event, payload) => this.handleGuestTranslationRequest(event.sender, payload)
    ipcMain.on(BROWSER_WEBVIEW_TRANSLATION_REQUEST_CHANNEL, this.translationRequestHandler)
    this.screenshotCaptureRequestHandler = (event) => this.handleGuestScreenshotCaptureRequest(event.sender)
    ipcMain.on(BROWSER_WEBVIEW_SCREENSHOT_CAPTURE_REQUEST_CHANNEL, this.screenshotCaptureRequestHandler)

    handleValidated('browser:create-tab', browserCreateTabInputSchema, async (_, input) => {
      const tabId = randomUUID()
      const partition = input.partition || `persist:atlas-browser-${input.componentId}-${tabId}`
      const container = new View()
      const webPreferences = {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
      applyAtlasBrowserWebPreferences(webPreferences)
      const view = new WebContentsView({ webPreferences })
      container.setBackgroundColor(BROWSER_CONTENT_BACKGROUND)
      view.setBackgroundColor(BROWSER_CONTENT_BACKGROUND)
      applyAtlasBrowserNetworkPolicy(view.webContents)

      view.webContents.setWindowOpenHandler(({ url }) => {
        this.emitOpenTabRequested({
          componentId: input.componentId,
          sourceTabId: tabId,
          url
        })
        return { action: 'deny' }
      })
      view.webContents.on('page-title-updated', (_, title) => this.emitUpdate(tabId, { title }))
      view.webContents.on('did-navigate', (_, url) => this.emitUpdate(tabId, { url }))
      view.webContents.on('did-navigate-in-page', (_, url) => this.emitUpdate(tabId, { url }))
      view.webContents.on('did-finish-load', () => this.emitUpdate(tabId, { isLoading: false }))
      view.webContents.on('did-start-loading', () => this.emitUpdate(tabId, { isLoading: true }))

      container.addChildView(view)
      this.window.contentView.addChildView(container)
      container.setVisible(false)
      container.setBounds(HIDDEN_BOUNDS)
      view.setBounds(HIDDEN_BOUNDS)
      const tab = { id: tabId, componentId: input.componentId, container, loadSequence: 0, view, visible: false }
      this.tabs.set(tabId, tab)
      this.loadTabUrl(tab, input.url)
      return { tabId, partition, url: input.url }
    })

    handleValidated('browser:set-bounds', browserBoundsInputSchema, (_, input) => {
      const tab = this.tabs.get(input.tabId)
      if (!tab) return { ok: false }
      this.setTabBounds(tab, input.visible, input.bounds, input.contentBounds ?? input.bounds)
      return { ok: true }
    })

    handleValidated('browser:navigate', browserNavigateInputSchema, async (_, input) => {
      const tab = this.getTab(input.tabId)
      this.loadTabUrl(tab, input.url)
      return { ok: true }
    })

    handleValidated('browser:back', browserTabInputSchema, (_, input) => {
      const contents = this.getTab(input.tabId).view.webContents
      if (contents.canGoBack()) contents.goBack()
      return { ok: true }
    })

    handleValidated('browser:forward', browserTabInputSchema, (_, input) => {
      const contents = this.getTab(input.tabId).view.webContents
      if (contents.canGoForward()) contents.goForward()
      return { ok: true }
    })

    handleValidated('browser:reload', browserTabInputSchema, (_, input) => {
      this.getTab(input.tabId).view.webContents.reload()
      return { ok: true }
    })

    handleValidated('browser:devtools', browserTabInputSchema, (_, input) => {
      this.getTab(input.tabId).view.webContents.openDevTools({ mode: 'detach' })
      return { ok: true }
    })

    handleValidated('browser:set-zoom', browserSetZoomInputSchema, (_, input) => {
      this.setTabZoom(this.getTab(input.tabId), input.zoomFactor)
      return { ok: true }
    })

    handleValidated('browser:capture', browserTabInputSchema, async (_, input) => {
      const image = await this.getTab(input.tabId).view.webContents.capturePage()
      return image.toDataURL()
    })

    handleValidated('browser:query-text', browserSelectorInputSchema, async (_, input) => {
      return this.getTab(input.tabId).view.webContents.executeJavaScript(
        `(() => {
          const element = document.querySelector(${jsString(input.selector)});
          return element ? element.textContent : null;
        })()`,
        true
      )
    })

    handleValidated('browser:click', browserClickInputSchema, async (_, input) => {
      return this.getTab(input.tabId).view.webContents.executeJavaScript(
        `(() => {
          const element = document.querySelector(${jsString(input.selector)});
          if (!element) return false;
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        })()`,
        true
      )
    })

    handleValidated('browser:type', browserTypeInputSchema, async (_, input) => {
      return this.getTab(input.tabId).view.webContents.executeJavaScript(
        `(() => {
          const element = document.querySelector(${jsString(input.selector)});
          if (!element) return false;
          element.focus();
          element.value = ${jsString(input.text)};
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`,
        true
      )
    })

    handleValidated('browser:close-tab', browserTabInputSchema, (_, input) => {
      this.close(input.tabId)
      return { ok: true }
    })
  }

  dispose(): void {
    if (this.translationRequestHandler) {
      ipcMain.removeListener(BROWSER_WEBVIEW_TRANSLATION_REQUEST_CHANNEL, this.translationRequestHandler)
      this.translationRequestHandler = null
    }

    if (this.zoomRequestHandler) {
      ipcMain.removeListener(BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL, this.zoomRequestHandler)
      this.zoomRequestHandler = null
    }

    if (this.screenshotCaptureRequestHandler) {
      ipcMain.removeListener(BROWSER_WEBVIEW_SCREENSHOT_CAPTURE_REQUEST_CHANNEL, this.screenshotCaptureRequestHandler)
      this.screenshotCaptureRequestHandler = null
    }

    for (const tabId of [...this.tabs.keys()]) {
      this.close(tabId)
    }
    this.tabs.clear()
  }

  private getTab(tabId: string): BrowserTab {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      throw new Error('Browser tab does not exist')
    }
    return tab
  }

  private close(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.tabs.delete(tabId)

    if (!this.window.isDestroyed()) {
      try {
        tab.container.removeChildView(tab.view)
        this.window.contentView.removeChildView(tab.container)
      } catch (error) {
        if (!this.window.isDestroyed()) {
          console.warn(`Failed to detach browser tab ${tabId}:`, error)
        }
      }
    }

    const webContents = this.getLiveWebContents(tab)
    if (!webContents) return

    try {
      webContents.close()
    } catch (error) {
      if (!webContents.isDestroyed()) {
        console.warn(`Failed to close browser tab ${tabId}:`, error)
      }
    }
  }

  private getLiveWebContents(tab: BrowserTab): WebContents | null {
    try {
      const webContents = tab.view.webContents
      return webContents.isDestroyed() ? null : webContents
    } catch {
      return null
    }
  }

  private loadTabUrl(tab: BrowserTab, url: string): void {
    const loadSequence = ++tab.loadSequence

    void tab.view.webContents.loadURL(url).catch((error: unknown) => {
      if (this.tabs.get(tab.id) !== tab || tab.loadSequence !== loadSequence) return
      if (isNavigationAbort(error)) return

      this.emitUpdate(tab.id, {
        isLoading: false,
        loadError: error instanceof Error ? error.message : String(error)
      })
    })
  }

  private tabForWebContents(webContents: WebContents): BrowserTab | null {
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents === webContents) return tab
    }

    return null
  }

  private getCurrentZoomFactor(webContents: WebContents): number {
    try {
      return webContents.getZoomFactor()
    } catch {
      return BROWSER_ZOOM_DEFAULT_FACTOR
    }
  }

  private handleGuestZoomRequest(webContents: WebContents, payload: unknown): void {
    const direction = readZoomDirection(payload)
    if (!direction) return

    const tab = this.tabForWebContents(webContents)
    if (tab) {
      this.setTabZoom(tab, nextZoomFactor(this.getCurrentZoomFactor(tab.view.webContents), direction))
      return
    }

    if (webContents.getType() !== 'webview') return

    const canvasZoomRequest = readWebviewCanvasZoomRequest(payload)
    if (canvasZoomRequest) {
      this.emitWebviewCanvasZoomRequested({
        sourceWebContentsId: webContents.id,
        ...canvasZoomRequest
      })
      return
    }

    const zoomFactor = this.setWebContentsZoom(webContents, nextZoomFactor(this.getCurrentZoomFactor(webContents), direction))
    if (zoomFactor !== null) {
      this.emitWebviewZoomUpdated({
        sourceWebContentsId: webContents.id,
        zoomFactor
      })
    }
  }

  private handleGuestTranslationRequest(webContents: WebContents, payload: unknown): void {
    const text = typeof payload === 'object' && payload !== null && 'text' in payload ? String(payload.text ?? '').trim() : ''
    if (!text) return

    const isKnownNativeTab = Boolean(this.tabForWebContents(webContents))
    const isDomWebview = webContents.getType() === 'webview'
    if (!isKnownNativeTab && !isDomWebview) return

    this.options.onGuestTranslationRequest?.(text)
  }

  private handleGuestScreenshotCaptureRequest(webContents: WebContents): void {
    const isKnownNativeTab = Boolean(this.tabForWebContents(webContents))
    const isDomWebview = webContents.getType() === 'webview'
    if (!isKnownNativeTab && !isDomWebview) return

    this.options.onGuestScreenshotCaptureRequest?.()
  }

  private setWebContentsZoom(webContents: WebContents, value: number): number | null {
    const zoomFactor = normalizeCommittedZoomFactor(value)

    try {
      webContents.setZoomFactor(zoomFactor)
    } catch {
      return null
    }

    return zoomFactor
  }

  private emitWebviewCanvasZoomRequested(payload: BrowserWebviewCanvasZoomRequest): void {
    if (this.window.isDestroyed()) return

    const webContents = this.window.webContents
    if (!webContents.isDestroyed()) {
      webContents.send(BROWSER_WEBVIEW_CANVAS_ZOOM_REQUESTED_CHANNEL, payload)
    }
  }

  private setTabZoom(tab: BrowserTab, value: number): void {
    const zoomFactor = this.setWebContentsZoom(tab.view.webContents, value)
    if (zoomFactor === null) return

    this.emitUpdate(tab.id, { zoomFactor })
  }

  private setTabBounds(tab: BrowserTab, visible: boolean, containerBounds: BrowserBounds, contentBounds: BrowserBounds): void {
    if (!visible) {
      tab.visible = false
      tab.view.setVisible(false)
      tab.view.setBounds(HIDDEN_BOUNDS)
      tab.container.setVisible(false)
      tab.container.setBounds(HIDDEN_BOUNDS)
      return
    }

    tab.visible = true
    tab.container.setBounds(containerBounds)
    tab.view.setBounds(childBoundsForClippedContainer(containerBounds, contentBounds))
    tab.view.setVisible(true)
    tab.container.setVisible(true)
  }

  private emitWebviewZoomUpdated(payload: { sourceWebContentsId: number; zoomFactor: number }): void {
    if (this.window.isDestroyed()) return

    const webContents = this.window.webContents
    if (!webContents.isDestroyed()) {
      webContents.send('browser:webview-zoom-updated', payload)
    }
  }

  private emitUpdate(tabId: string, patch: Record<string, unknown>): void {
    if (this.window.isDestroyed()) return

    const webContents = this.window.webContents
    if (!webContents.isDestroyed()) {
      webContents.send('browser:tab-updated', { tabId, patch })
    }
  }

  private emitOpenTabRequested(payload: { componentId: string; sourceTabId: string; url: string }): void {
    if (this.window.isDestroyed()) return

    const webContents = this.window.webContents
    if (!webContents.isDestroyed()) {
      webContents.send('browser:open-tab-requested', payload)
    }
  }
}
