import { ipcRenderer, webFrame } from 'electron'
import {
  BROWSER_WEBVIEW_TRANSLATION_REQUEST_CHANNEL,
  BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL,
  browserZoomDirectionFromWheel
} from '@shared/browser'
import { AI_DOUBLE_CTRL_INTERVAL_MS } from '@shared/ai'

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

function selectedText(): string {
  return window.getSelection()?.toString().trim() ?? ''
}

document.addEventListener(
  'wheel',
  (event) => {
    const direction = browserZoomDirectionFromWheel(event)
    if (!direction) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation?.()
    ipcRenderer.send(BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL, { direction })
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
      if (text) ipcRenderer.send(BROWSER_WEBVIEW_TRANSLATION_REQUEST_CHANNEL, { text })
      return
    }

    lastCtrlUpAt = now
  },
  { capture: true }
)
