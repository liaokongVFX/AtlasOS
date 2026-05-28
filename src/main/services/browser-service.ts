import { randomUUID } from 'node:crypto'
import { BrowserWindow, View, WebContentsView, type WebContents } from 'electron'
import {
  browserBoundsInputSchema,
  browserClickInputSchema,
  browserCreateTabInputSchema,
  browserNavigateInputSchema,
  browserSelectorInputSchema,
  browserTabInputSchema,
  browserTypeInputSchema
} from '@shared/ipc'
import { handleValidated } from './ipc-helpers'

type BrowserTab = {
  id: string
  componentId: string
  container: View
  loadSequence: number
  view: WebContentsView
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

function childBoundsForClippedContainer(containerBounds: BrowserBounds, contentBounds: BrowserBounds): BrowserBounds {
  return {
    x: contentBounds.x - containerBounds.x,
    y: contentBounds.y - containerBounds.y,
    width: contentBounds.width,
    height: contentBounds.height
  }
}

export class BrowserService {
  private readonly tabs = new Map<string, BrowserTab>()

  constructor(private readonly window: BrowserWindow) {}

  registerIpc(): void {
    handleValidated('browser:create-tab', browserCreateTabInputSchema, async (_, input) => {
      const tabId = randomUUID()
      const partition = input.partition || `persist:atlas-browser-${input.componentId}-${tabId}`
      const container = new View()
      const view = new WebContentsView({
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      })
      container.setBackgroundColor(BROWSER_CONTENT_BACKGROUND)
      view.setBackgroundColor(BROWSER_CONTENT_BACKGROUND)

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
      container.setBounds(HIDDEN_BOUNDS)
      view.setBounds(HIDDEN_BOUNDS)
      const tab = { id: tabId, componentId: input.componentId, container, loadSequence: 0, view }
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

      this.emitUpdate(tab.id, {
        isLoading: false,
        loadError: error instanceof Error ? error.message : String(error)
      })
    })
  }

  private setTabBounds(tab: BrowserTab, visible: boolean, containerBounds: BrowserBounds, contentBounds: BrowserBounds): void {
    if (!visible) {
      tab.view.setBounds(HIDDEN_BOUNDS)
      tab.container.setBounds(HIDDEN_BOUNDS)
      return
    }

    tab.container.setBounds(containerBounds)
    tab.view.setBounds(childBoundsForClippedContainer(containerBounds, contentBounds))
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
