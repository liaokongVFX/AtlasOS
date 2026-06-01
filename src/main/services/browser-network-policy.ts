import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebContents } from 'electron'
import type { WebPreferences } from 'electron/main'

const ATLAS_BROWSER_WEBRTC_IP_HANDLING_POLICY = 'disable_non_proxied_udp'
const ATLAS_BROWSER_WEBVIEW_PRELOAD = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../preload/browser-webview-policy.js'
)

export function applyAtlasBrowserWebPreferences(webPreferences: WebPreferences): void {
  webPreferences.preload = ATLAS_BROWSER_WEBVIEW_PRELOAD
}

export function applyAtlasBrowserNetworkPolicy(webContents: Pick<WebContents, 'setWebRTCIPHandlingPolicy'>): void {
  // Browser nodes embed arbitrary pages; keep WebRTC APIs available but block direct UDP/STUN candidate gathering.
  webContents.setWebRTCIPHandlingPolicy(ATLAS_BROWSER_WEBRTC_IP_HANDLING_POLICY)
}
