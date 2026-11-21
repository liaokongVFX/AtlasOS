import { captureQuickInputEditor, type InsertIntoEditor } from '@shared/quick-input-editor'

const editors = new WeakMap<Element, InsertIntoEditor>()

export function registerQuickInputEditor(element: Element, insert: InsertIntoEditor): () => void {
  editors.set(element, insert)
  return () => editors.delete(element)
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== 'atlas:quick-input-editor' || event.ports.length !== 1) return
  const element = document.activeElement
  const handler = element && editors.get(element)
  if (element && (handler || element.classList.contains('xterm-helper-textarea'))) {
    captureQuickInputEditor(event.ports[0], (text, deliveryId) =>
      handler && editors.get(element) === handler ? handler(text, deliveryId) : 'unavailable')
  } else {
    captureQuickInputEditor(event.ports[0])
  }
})
