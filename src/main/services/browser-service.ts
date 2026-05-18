import { randomUUID } from 'node:crypto'
import { BrowserWindow, WebContentsView, session, shell } from 'electron'
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
  view: WebContentsView
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

export class BrowserService {
  private readonly tabs = new Map<string, BrowserTab>()

  constructor(private readonly window: BrowserWindow) {}

  registerIpc(): void {
    handleValidated('browser:create-tab', browserCreateTabInputSchema, async (_, input) => {
      const tabId = randomUUID()
      const partition = input.partition || `persist:atlas-browser-${input.componentId}-${tabId}`
      const view = new WebContentsView({
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      })

      view.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url)
        return { action: 'deny' }
      })
      view.webContents.on('page-title-updated', (_, title) => this.emitUpdate(tabId, { title }))
      view.webContents.on('did-navigate', (_, url) => this.emitUpdate(tabId, { url }))
      view.webContents.on('did-navigate-in-page', (_, url) => this.emitUpdate(tabId, { url }))
      view.webContents.on('did-finish-load', () => this.emitUpdate(tabId, { isLoading: false }))
      view.webContents.on('did-start-loading', () => this.emitUpdate(tabId, { isLoading: true }))

      this.window.contentView.addChildView(view)
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      this.tabs.set(tabId, { id: tabId, componentId: input.componentId, view })
      await view.webContents.loadURL(input.url)
      return { tabId, partition, url: input.url }
    })

    handleValidated('browser:set-bounds', browserBoundsInputSchema, (_, input) => {
      const tab = this.tabs.get(input.tabId)
      if (!tab) return { ok: false }
      tab.view.setBounds(input.visible ? input.bounds : { x: 0, y: 0, width: 0, height: 0 })
      return { ok: true }
    })

    handleValidated('browser:navigate', browserNavigateInputSchema, async (_, input) => {
      const tab = this.getTab(input.tabId)
      await tab.view.webContents.loadURL(input.url)
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
    for (const tabId of this.tabs.keys()) {
      this.close(tabId)
    }
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
    this.window.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    this.tabs.delete(tabId)
  }

  private emitUpdate(tabId: string, patch: Record<string, unknown>): void {
    if (!this.window.webContents.isDestroyed()) {
      this.window.webContents.send('browser:tab-updated', { tabId, patch })
    }
  }
}
