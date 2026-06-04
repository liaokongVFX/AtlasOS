import { ipcRenderer, webFrame } from 'electron'
import {
  BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL,
  browserZoomDirectionFromWheel
} from '@shared/browser'

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
