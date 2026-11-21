export type EditorInsertionResult = 'inserted' | 'unavailable' | 'unknown'
export type InsertIntoEditor = (text: string) => EditorInsertionResult

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
  const current = () => document.hasFocus() && location.href === url && !!element?.isConnected && document.activeElement === element
  function insert(text: string): EditorInsertionResult {
    if (!current() || !element?.checkVisibility()) return 'unavailable'
    if (field) {
      if (field.disabled || field.readOnly || field.selectionStart !== start || field.selectionEnd !== end) return 'unavailable'
    } else if (!anchor || !focus || !element.contains(anchor) || !element.contains(focus) ||
      selection?.anchorNode !== anchor || selection?.focusNode !== focus ||
      selection?.anchorOffset !== anchorOffset || selection?.focusOffset !== focusOffset) {
      return 'unavailable'
    }
    if (customInsert) return customInsert(text)
    if (!field && !(element instanceof HTMLElement && element.isContentEditable)) return 'unavailable'
    if (text.includes('\r')) return 'unavailable'
    if (field) {
      if (start == null || end == null) return 'unavailable'
      if (field instanceof HTMLInputElement && (text.includes('\n') || !['text', 'search', 'tel', 'password'].includes(field.type))) return 'unavailable'
      if (field.maxLength >= 0 && field.value.length - (end - start) + text.length > field.maxLength) return 'unavailable'
    }
    // Chromium applies this command synchronously to the checked selection and records one undo edit.
    return document.execCommand('insertText', false, text) ? 'inserted' : 'unavailable'
  }

  port.onmessage = ({ data }) => {
    if (data === 'current') port.postMessage(current())
    else if (typeof data?.text === 'string') {
      try { port.postMessage(insert(data.text)) } catch { port.postMessage('unknown') }
      port.close()
    }
  }
  port.postMessage(current())
}
