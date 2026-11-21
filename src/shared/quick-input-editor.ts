export type EditorInsertionResult = 'inserted' | 'unavailable' | 'unknown'
export type QuickInputFocus = 'current' | 'switched' | 'unavailable'
export type InsertIntoEditor = (text: string, deliveryId: string) => EditorInsertionResult | Promise<EditorInsertionResult>

// The port belongs to a single request and document. It is never exposed to a guest page.
export function captureQuickInputEditor(port: MessagePort, customInsert?: InsertIntoEditor): void {
  const element = document.activeElement
  const field = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement ? element : null
  const start = field?.selectionStart
  const end = field?.selectionEnd
  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  const focus = selection?.focusNode
  const anchorOffset = selection?.anchorOffset
  const focusOffset = selection?.focusOffset
  const url = location.href
  function focusState(): QuickInputFocus {
    if (location.href !== url || !element?.isConnected) return 'unavailable'
    return document.hasFocus() && document.activeElement === element ? 'current' : 'switched'
  }
  function insert(text: string, expiresAt: number, deliveryId: string): ReturnType<InsertIntoEditor> {
    if (!(Date.now() < expiresAt) || focusState() !== 'current' || !element?.checkVisibility()) return 'unavailable'
    if (field) {
      if (field.disabled || field.readOnly || field.selectionStart !== start || field.selectionEnd !== end) return 'unavailable'
    } else if (!anchor || !focus || !element.contains(anchor) || !element.contains(focus) ||
      selection?.anchorNode !== anchor || selection?.focusNode !== focus ||
      selection?.anchorOffset !== anchorOffset || selection?.focusOffset !== focusOffset) {
      return 'unavailable'
    }
    if (customInsert) return customInsert(text, deliveryId)
    if (!field && !(element instanceof HTMLElement && element.isContentEditable)) return 'unavailable'
    if (text.includes('\r')) return 'unavailable'
    if (field) {
      if (start == null || end == null) return 'unavailable'
      if (field instanceof HTMLInputElement && (text.includes('\n') || !['text', 'search', 'tel', 'password'].includes(field.type))) return 'unavailable'
      if (field.maxLength >= 0 && field.value.length - (end - start) + text.length > field.maxLength) return 'unavailable'
      const before = field.value
      const expected = before.slice(0, start) + text + before.slice(end)
      const accepted = document.execCommand('insertText', false, text)
      if (!field.isConnected) return 'unknown'
      if (!accepted && field.value === before) return 'unavailable'
      return accepted && field.value === expected ? 'inserted' : 'unknown'
    }
    // Chromium applies this command synchronously to the checked selection and records one undo edit.
    return document.execCommand('insertText', false, text) ? 'inserted' : 'unavailable'
  }

  let consumed = false
  port.onmessage = async ({ data }) => {
    if (data === 'current') port.postMessage(focusState())
    else if (typeof data?.text === 'string' && !consumed) {
      consumed = true
      let result: EditorInsertionResult
      const cancel = () => port.postMessage('cancel-delivery')
      if (customInsert) element?.addEventListener('blur', cancel)
      try { result = await insert(data.text, data.expiresAt, data.deliveryId) } catch { result = 'unknown' }
      finally { if (customInsert) element?.removeEventListener('blur', cancel) }
      consumed = result !== 'unavailable'
      port.postMessage(result)
    }
  }
  port.postMessage(focusState() === 'current')
}
