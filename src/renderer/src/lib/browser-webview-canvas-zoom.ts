import type { BrowserWebviewCanvasZoomRequest } from '@shared/browser'

export const BROWSER_WEBVIEW_CANVAS_ZOOM_EVENT = 'atlas:browser-webview-canvas-zoom'

export type BrowserWebviewCanvasZoomInput = Omit<BrowserWebviewCanvasZoomRequest, 'sourceWebContentsId'>

export function webviewCanvasZoomInputFromRequest(
  webview: Electron.WebviewTag,
  request: BrowserWebviewCanvasZoomRequest
): BrowserWebviewCanvasZoomInput | null {
  const bounds = webview.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0 || webview.clientWidth <= 0 || webview.clientHeight <= 0) return null

  return {
    clientX: bounds.left + request.clientX * (bounds.width / webview.clientWidth),
    clientY: bounds.top + request.clientY * (bounds.height / webview.clientHeight),
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
