import type { TerminalWriteInput } from '@shared/ipc'
import type { EditorInsertionResult } from '@shared/quick-input-editor'

export type QuickInputDelivery = { expiresAt: number; signal: AbortSignal; finish(result: EditorInsertionResult): void }
type QueuedInput = { input: TerminalWriteInput; delivery?: QuickInputDelivery }

// Codex's Windows color probe reads and requeues console input. ConPTY can
// append part of a paste between that read and replay, reordering the draft.
export class CodexStartupPaste {
  private phase: 'idle' | 'starting' | 'probing' | 'ready' = 'idle'
  private pending: QueuedInput[] = []
  private timeout?: ReturnType<typeof setTimeout>

  constructor(private readonly write: (input: TerminalWriteInput) => EditorInsertionResult) {}

  begin(): void {
    if (this.phase === 'idle') this.phase = 'starting'
  }

  observe(output: string, newDataStart: number): void {
    const controls = /\x1b\[\?2004[hl]|\x1b\]11;\?(?:\x07|\x1b\\)|\x1b\[\?2026h/g
    // Include enough of the previous chunk to recognize a split sequence.
    controls.lastIndex = Math.max(0, newDataStart - 8)
    for (const match of output.matchAll(controls)) {
      if (match.index + match[0].length <= newDataStart) continue
      switch (match[0]) {
        case '\x1b[?2004l':
          this.reset()
          break
        case '\x1b[?2004h':
          this.begin()
          break
        case '\x1b[?2026h':
          if (this.phase === 'probing') this.phase = 'ready'
          break
        default: // OSC 11 query
          this.phase = 'probing'
          this.timeout?.refresh()
          break
      }
    }
    if (this.phase === 'ready' && this.pending.length) this.flush()
  }

  defer(input: TerminalWriteInput, delivery?: QuickInputDelivery): boolean {
    if (this.phase === 'idle' || this.phase === 'ready') return false
    const { data } = input
    if (data === '\x03') {
      this.clearPending()
      return false
    }
    // Let terminal replies reach the color probe while user input is queued.
    if (data.startsWith('\x1b]') || /^\x1b\[[?>\d;]*[cRn]$/.test(data)) return false
    if (!this.pending.length && !(data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~'))) return false
    const entry: QueuedInput = { input, delivery }
    this.pending.push(entry)
    if (delivery) {
      const cancel = () => {
        this.pending = this.pending.filter(item => item !== entry)
        entry.delivery!.finish('unavailable')
      }
      const expiry = setTimeout(cancel, delivery.expiresAt - Date.now())
      entry.delivery = { ...delivery, finish(result) {
        clearTimeout(expiry)
        delivery.signal.removeEventListener('abort', cancel)
        delivery.finish(result)
      } }
      delivery.signal.addEventListener('abort', cancel, { once: true })
    }
    // Older clients may never query colors or use synchronized rendering.
    this.timeout ??= setTimeout(() => this.flush(), 5000)
    return true
  }

  reset(): void {
    this.phase = 'idle'
    this.clearPending()
  }

  private clearPending(): void {
    clearTimeout(this.timeout)
    this.timeout = undefined
    for (const entry of this.pending.splice(0)) entry.delivery?.finish('unavailable')
  }

  private flush(): void {
    const pending = this.pending.splice(0)
    this.clearPending()
    this.phase = 'ready'
    for (const { input, delivery } of pending) {
      if (delivery && (delivery.signal.aborted || Date.now() >= delivery.expiresAt)) delivery.finish('unavailable')
      else {
        const result = this.write(input)
        delivery?.finish(result)
      }
    }
  }
}
