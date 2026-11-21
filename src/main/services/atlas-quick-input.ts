import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MessageChannelMain, screen, webContents, type BrowserWindow } from 'electron'
import type { EditorInsertionResult, QuickInputFocus } from '@shared/quick-input-editor'
import type { QuickInputTarget } from './windows-quick-input'

const REPLY_TIMEOUT_MS = 1500
// Codex can hold a paste through a five-second startup probe and refresh that wait.
const DELIVERY_TIMEOUT_MS = 10000

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
  let live = true
  let pending: ((reply: unknown) => void) | undefined
  const invalidate = () => { live = false; pending?.(null); port1.close() }
  const receive = (timeout = REPLY_TIMEOUT_MS) => new Promise<unknown>((resolve) => {
    const timer = setTimeout(invalidate, timeout)
    pending = (reply) => { clearTimeout(timer); pending = undefined; resolve(reply) }
  })
  port1.on('message', ({ data }) => pending?.(data))
  port1.on('close', () => { live = false; pending?.(null) })
  port1.start()
  const captured = receive()
  contents.postMessage('quick-input:capture-editor', null, [port2])
  if (await captured !== true || contents.isDestroyed()) {
    port1.close()
    return null
  }

  const navigate = (details: Electron.WebContentsDidStartNavigationEventParams) => {
    if (details.isMainFrame) invalidate()
  }
  contents.on('did-start-navigation', navigate)
  contents.once('destroyed', invalidate)
  const current = async () => await focusedEditorContents(window) === contents && live && window.isFocused()
  const ask = (message: unknown, timeout = REPLY_TIMEOUT_MS) => {
    const response = receive(timeout)
    port1.postMessage(message)
    return response
  }
  const bounds = window.getBounds()
  return {
    point: screen.dipToScreenPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }),
    focusState: async (): Promise<QuickInputFocus> => {
      if (window.isDestroyed()) return 'unavailable'
      if (!window.isFocused()) return 'switched'
      if (!live || contents.isDestroyed()) return 'unavailable'
      if (!await current()) return 'switched'
      const state = await ask('current')
      return state === 'current' || state === 'switched' ? state : 'unavailable'
    },
    insert: async (text, panelHandle): Promise<EditorInsertionResult> => {
      if (panelHandle) {
        // Minimizing the Quick Input window lets Windows reactivate the original window.
        for (let i = 0; live && !window.isDestroyed() && !window.isFocused() && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10))
      }
      if (!await current()) return 'unavailable'
      const result = await ask({ text, expiresAt: Date.now() + DELIVERY_TIMEOUT_MS }, DELIVERY_TIMEOUT_MS + REPLY_TIMEOUT_MS)
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
