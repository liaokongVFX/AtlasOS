import { webFrame } from 'electron'

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
