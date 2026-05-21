type CanvasViewportSyncListener = () => void

const listeners = new Set<CanvasViewportSyncListener>()

export function subscribeCanvasViewportSync(listener: CanvasViewportSyncListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyCanvasViewportSync(): void {
  for (const listener of listeners) {
    listener()
  }
}
