import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MessageChannelMain, screen, webContents, type BrowserWindow } from 'electron'
import type { QuickInputResult, QuickInputTarget } from './windows-quick-input'

async function focusedEditorContents(window: BrowserWindow) {
  if (window.isDestroyed() || !window.isFocused()) return null
  const host = window.webContents
  const canvasUrl = process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  if (host.getURL().split('#')[0] !== canvasUrl) return null
  // getFocusedWebContents can return a background guest while the canvas editor has focus.
  const guestId = await host.executeJavaScript(`(() => {
    const element = document.activeElement
    return element?.tagName === 'WEBVIEW' && element.checkVisibility() ? element.getWebContentsId() : null
  })()`).catch(() => undefined)
  if (guestId === null) return host
  const guest = typeof guestId === 'number' && webContents.fromId(guestId)
  return guest && guest.getType() === 'webview' && guest.hostWebContents === host ? guest : null
}

export async function captureAtlasQuickInputTarget(window: BrowserWindow): Promise<QuickInputTarget | null> {
  const contents = await focusedEditorContents(window)
  if (!contents) return null

  const { port1, port2 } = new MessageChannelMain()
  let pending: ((reply: unknown) => void) | undefined
  const receive = () => new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => { pending = undefined; resolve(null) }, 1500)
    pending = (reply) => { clearTimeout(timer); pending = undefined; resolve(reply) }
  })
  port1.on('message', ({ data }) => pending?.(data))
  port1.on('close', () => pending?.(null))
  port1.start()
  const captured = receive()
  contents.postMessage('quick-input:capture-editor', null, [port2])
  if (await captured !== true || contents.isDestroyed()) {
    port1.close()
    return null
  }

  let live = true
  const invalidate = () => { live = false; port1.close() }
  const navigate = (details: Electron.WebContentsDidStartNavigationEventParams) => {
    if (details.isMainFrame) invalidate()
  }
  contents.on('did-start-navigation', navigate)
  contents.once('destroyed', invalidate)
  const current = async () => live && await focusedEditorContents(window) === contents
  const ask = (message: unknown) => {
    const response = receive()
    port1.postMessage(message)
    return response
  }
  const bounds = window.getBounds()
  return {
    point: screen.dipToScreenPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }),
    isCurrent: async () => await current() && await ask('current') === true,
    insert: async (text, panelHandle): Promise<QuickInputResult> => {
      if (panelHandle) {
        // Minimizing the Quick Input window lets Windows reactivate the original window.
        for (let i = 0; live && !window.isDestroyed() && !window.isFocused() && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10))
      }
      if (!await current()) return 'unavailable'
      const result = await ask({ text })
      return result === 'inserted' || result === 'unavailable' ? result : 'unknown'
    },
    release: () => {
      invalidate()
      if (!contents.isDestroyed()) {
        contents.off('did-start-navigation', navigate)
        contents.off('destroyed', invalidate)
      }
    }
  }
}
