import type { IBuffer, Terminal } from '@xterm/xterm'

// xterm exposes scrollback for reading, but has no public API for inserting
// styled history rows. Keep the xterm 6 buffer dependency at this boundary.
type StoredLine = { translateToString(trimRight: boolean): string }
type NativeBuffer = {
  lines: { get(i: number): StoredLine; splice(start: number, count: number, ...lines: StoredLine[]): void }
  ybase: number
  ydisp: number
  savedY: number
}

const compact = (text: string): string => text.replace(/\s+/gu, '')

function indexRows(count: number, read: (row: number) => string) {
  const starts: number[] = []
  const parts: string[] = []
  let offset = 0
  for (let row = 0; row < count; row++) {
    starts.push(offset)
    const part = compact(read(row))
    parts.push(part)
    offset += part.length
  }
  return { starts, text: parts.join('') }
}

function closestOccurrence(text: string, fragment: string, expected: number): number {
  if (!fragment) return -1
  const next = text.indexOf(fragment, Math.max(0, expected))
  const previous = text.lastIndexOf(fragment, Math.max(0, expected))
  if (next < 0) return previous
  if (previous < 0 || next - expected < expected - previous) return next
  return previous
}

function readingAnchor(buffer: IBuffer) {
  const row = buffer.viewportY
  if (row >= buffer.baseY) return undefined
  let first = row
  while (first < buffer.length && !buffer.getLine(first)?.translateToString(true).trim()) first++
  const context = indexRows(Math.min(12, buffer.length - first), i => buffer.getLine(first + i)!.translateToString(true))
  return { text: context.text.slice(0, 160), blankRows: first - row, fraction: row / buffer.baseY }
}

export function installTerminalResizeHistory(terminal: Terminal, scheduleFit: () => void) {
  const service = (terminal as Terminal & {
    _core?: { _bufferService?: { buffer: NativeBuffer; scrollLines(delta: number): void } }
  })._core?._bufferService
  let pending: {
    anchor: ReturnType<typeof readingAnchor>
    userScrolled?: boolean
    purged?: StoredLine[]
    screenChars: number
    synchronized?: boolean
  } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let fitDeferred = false

  function reset(): void {
    clearTimeout(timer)
    pending = undefined
    if (fitDeferred) {
      fitDeferred = false
      scheduleFit()
    }
  }

  function finish(): void {
    const replay = pending
    reset()
    const buffer = terminal.buffer.active
    const native = service?.buffer
    if (!replay?.purged || buffer.type !== 'normal' || !native || !buffer.baseY) return
    const current = () => indexRows(buffer.length, i => buffer.getLine(i)!.translateToString(true))
    let rendered = current()
    const notice = 'toviewthefulltranscript'
    const end = rendered.text.indexOf(notice)
    if (rendered.text.startsWith('Earliermessagesareavailable') && end >= 0 && replay.purged.length) {
      // Codex explicitly announced a capped replay. Join it to the retained
      // prefix at a shared line boundary, accounting for different wrapping.
      const old = indexRows(replay.purged.length, i => replay.purged![i].translateToString(true))
      const first = rendered.starts.findIndex(offset => offset >= end + notice.length)
      const searchEnd = Math.min(buffer.baseY, first + Math.max(160, terminal.cols))
      for (let row = first; row >= 0 && row < searchEnd; row++) {
        const offset = rendered.starts[row]
        const fragment = rendered.text.slice(offset, offset + 160)
        if (fragment.length < 40) break
        const match = closestOccurrence(old.text, fragment, old.text.length + replay.screenChars - rendered.text.length + offset)
        const cut = match < 0 ? -1 : old.starts.indexOf(match)
        if (cut < 0) continue
        const capacity = (terminal.options.scrollback ?? 0) - (buffer.baseY - row)
        const prefix = replay.purged.slice(Math.max(0, cut - Math.max(0, capacity)), cut)
        const delta = prefix.length - row
        native.lines.splice(0, row, ...prefix)
        native.ybase += delta
        native.savedY = Math.max(0, native.savedY + delta)
        if (replay.userScrolled) service.scrollLines(delta)
        rendered = current()
        break
      }
    }
    if (replay.anchor) {
      const { text, blankRows, fraction } = replay.anchor
      const estimated = Math.round(fraction * buffer.baseY)
      const pos = closestOccurrence(rendered.text, text, rendered.starts[estimated] ?? 0)
      if (pos >= 0) service.scrollLines(rendered.starts.findLastIndex(start => start <= pos) - blankRows - native.ydisp)
    } else if (!replay.userScrolled) {
      service.scrollLines(native.ybase - native.ydisp)
    }
    terminal.refresh(0, terminal.rows - 1)
  }

  const erase = terminal.parser.registerCsiHandler({ final: 'J' }, params => {
    const buffer = terminal.buffer.active
    const native = service?.buffer
    if (params[0] !== 3 || !pending || buffer.type !== 'normal' || !native) return false
    if (pending.purged && buffer.baseY) reset()
    else if (buffer.baseY) {
      pending.purged = Array.from({ length: buffer.baseY }, (_, i) => native.lines.get(i))
    }
    return false // Always let xterm perform the original erase.
  })
  const beginFrame = terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
    if (params.some(mode => mode === 47 || mode === 1047 || mode === 1049)) reset()
    if (params.includes(2026) && pending?.purged) {
      pending.synchronized = true
      clearTimeout(timer)
      timer = setTimeout(reset, 5000)
    }
    return false
  })
  const endFrame = terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
    if (params.includes(2026) && pending?.synchronized) {
      pending.synchronized = false
      if (terminal.buffer.active.baseY) finish()
    }
    return false
  })
  const writes = terminal.onWriteParsed(() => {
    if (!pending?.purged || pending.synchronized || !terminal.buffer.active.baseY) return
    clearTimeout(timer)
    timer = setTimeout(finish, 80)
  })
  const cancelReading = () => {
    if (pending) {
      pending.anchor = undefined
      pending.userScrolled = true
    }
  }
  const element = terminal.element
  element?.addEventListener('wheel', cancelReading, true)
  element?.addEventListener('pointerdown', cancelReading, true)
  element?.addEventListener('keydown', cancelReading, true)
  return {
    beforeResize(): boolean {
      // Changing the grid mid-replay would leave the retained rows at the old width.
      if (pending?.purged) {
        fitDeferred = true
        return false
      }
      const anchor = pending?.anchor
      reset()
      const buffer = terminal.buffer.active
      if (buffer.type !== 'normal' || !buffer.baseY) return true
      const screenChars = indexRows(buffer.length - buffer.baseY, i => buffer.getLine(buffer.baseY + i)!.translateToString(true)).text.length
      pending = { anchor: anchor ?? readingAnchor(buffer), screenChars }
      // Codex debounces its resize replay. An unrelated future clear must win.
      timer = setTimeout(reset, 1500)
      return true
    },
    dispose() {
      fitDeferred = false
      reset()
      erase.dispose()
      beginFrame.dispose()
      endFrame.dispose()
      writes.dispose()
      element?.removeEventListener('wheel', cancelReading, true)
      element?.removeEventListener('pointerdown', cancelReading, true)
      element?.removeEventListener('keydown', cancelReading, true)
    }
  }
}
