export const BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL = 'atlas-browser:zoom-request'
export const BROWSER_WEBVIEW_TRANSLATION_REQUEST_CHANNEL = 'atlas-browser:translation-request'
export const BROWSER_WEBVIEW_SCREENSHOT_CAPTURE_REQUEST_CHANNEL = 'atlas-browser:screenshot-capture-request'
export const BROWSER_ZOOM_DEFAULT_FACTOR = 1
export const BROWSER_ZOOM_MIN_FACTOR = 0.5
export const BROWSER_ZOOM_MAX_FACTOR = 3
export const BROWSER_ZOOM_STEP = 0.1

export function browserZoomDirectionFromWheel(event: Pick<WheelEvent, 'ctrlKey' | 'deltaX' | 'deltaY'>): -1 | 1 | null {
  if (!event.ctrlKey) return null

  const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
  if (delta === 0) return null

  return delta < 0 ? 1 : -1
}
