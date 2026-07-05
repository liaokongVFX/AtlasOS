import type { BrowserWebviewCanvasZoomRequest } from '@shared/browser'

export const BROWSER_WEBVIEW_CANVAS_ZOOM_EVENT = 'atlas:browser-webview-canvas-zoom'

export type BrowserWebviewCanvasZoomInput = {
  clientX: number
  clientY: number
  deltaMode: number
  deltaX: number
  deltaY: number
}

export function webviewCanvasZoomInputFromRequest(
  webview: Electron.WebviewTag,
  request: BrowserWebviewCanvasZoomRequest
): BrowserWebviewCanvasZoomInput | null {
  const bounds = webview.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0 || webview.clientWidth <= 0 || webview.clientHeight <= 0) return null

  const guestClientX = typeof request.clientX === 'number' && Number.isFinite(request.clientX) ? request.clientX : null
  const guestClientY = typeof request.clientY === 'number' && Number.isFinite(request.clientY) ? request.clientY : null
  const hasGuestPointer = request.anchor !== 'center' && guestClientX !== null && guestClientY !== null

  return {
    clientX: hasGuestPointer ? bounds.left + guestClientX * (bounds.width / webview.clientWidth) : bounds.left + bounds.width / 2,
    clientY: hasGuestPointer ? bounds.top + guestClientY * (bounds.height / webview.clientHeight) : bounds.top + bounds.height / 2,
    deltaMode: request.deltaMode,
    deltaX: request.deltaX,
    deltaY: request.deltaY
  }
}

export function dispatchBrowserWebviewCanvasZoom(input: BrowserWebviewCanvasZoomInput): void {
  window.dispatchEvent(new CustomEvent<BrowserWebviewCanvasZoomInput>(BROWSER_WEBVIEW_CANVAS_ZOOM_EVENT, { detail: input }))
}

export function subscribeBrowserWebviewCanvasZoom(listener: (input: BrowserWebviewCanvasZoomInput) => void): () => void {
  const handleEvent = (event: Event): void => {
    const detail = event instanceof CustomEvent ? event.detail : null
    if (!detail || typeof detail !== 'object') return

    listener(detail as BrowserWebviewCanvasZoomInput)
  }

  window.addEventListener(BROWSER_WEBVIEW_CANVAS_ZOOM_EVENT, handleEvent)
  return () => window.removeEventListener(BROWSER_WEBVIEW_CANVAS_ZOOM_EVENT, handleEvent)
}
