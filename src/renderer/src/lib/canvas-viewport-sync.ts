export type CanvasViewportSyncSnapshot = {
  x: number
  y: number
  zoom: number
}

type CanvasViewportSyncListener = (viewport?: CanvasViewportSyncSnapshot) => void

const listeners = new Set<CanvasViewportSyncListener>()

export function subscribeCanvasViewportSync(listener: CanvasViewportSyncListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyCanvasViewportSync(viewport?: CanvasViewportSyncSnapshot): void {
  for (const listener of listeners) {
    listener(viewport)
  }
}
