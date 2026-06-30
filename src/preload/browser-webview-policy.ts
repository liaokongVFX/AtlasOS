import { ipcRenderer, webFrame } from 'electron'
import {
  BROWSER_WEBVIEW_SCREENSHOT_CAPTURE_REQUEST_CHANNEL,
  BROWSER_WEBVIEW_TRANSLATION_REQUEST_CHANNEL,
  BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL,
  browserZoomRequestFromWheel
} from '@shared/browser'

const AI_DOUBLE_CTRL_INTERVAL_MS = 450

const disableBrowserWebRtc = `
(() => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        writable: true,
        value: undefined
      });
    } catch {
      try {
        window[name] = undefined;
      } catch {}
    }
  }
})();
`

void webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: disableBrowserWebRtc }]).catch(() => undefined)

let lastCtrlUpAt = 0

function selectedInputText(element: Element | null): string {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return ''
  if (element instanceof HTMLInputElement && element.type === 'password') return ''

  const start = element.selectionStart ?? 0
  const end = element.selectionEnd ?? 0
  if (end <= start) return ''

  return element.value.slice(start, end).trim()
}

function selectedText(): string {
  return selectedInputText(document.activeElement) || window.getSelection()?.toString().trim() || ''
}

document.addEventListener(
  'wheel',
  (event) => {
    const request = browserZoomRequestFromWheel(event)
    if (!request) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation?.()
    ipcRenderer.send(BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL, request)
  },
  { capture: true, passive: false }
)

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Control') lastCtrlUpAt = 0
  },
  { capture: true }
)

document.addEventListener(
  'keyup',
  (event) => {
    if (event.key !== 'Control') return

    const now = Date.now()
    if (lastCtrlUpAt > 0 && now - lastCtrlUpAt <= AI_DOUBLE_CTRL_INTERVAL_MS) {
      lastCtrlUpAt = 0
      const text = selectedText()
      if (text) {
        ipcRenderer.send(BROWSER_WEBVIEW_TRANSLATION_REQUEST_CHANNEL, { text })
      } else {
        ipcRenderer.send(BROWSER_WEBVIEW_SCREENSHOT_CAPTURE_REQUEST_CHANNEL, {})
      }
      return
    }

    lastCtrlUpAt = now
  },
  { capture: true }
)
