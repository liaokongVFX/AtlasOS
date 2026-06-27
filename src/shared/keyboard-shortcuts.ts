const MODIFIER_ALIASES = {
  alt: 'alt',
  option: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  shift: 'shift'
} as const

const KEY_ALIASES: Record<string, string> = {
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  down: 'ArrowDown',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  end: 'End',
  home: 'Home',
  left: 'ArrowLeft',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  '+': 'Plus',
  plus: 'Plus',
  right: 'ArrowRight',
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
  up: 'ArrowUp'
}

type ModifierName = (typeof MODIFIER_ALIASES)[keyof typeof MODIFIER_ALIASES]

export type ParsedKeyboardShortcut = {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

function normalizeKeyToken(token: string): string | null {
  if (token === ' ') return 'Space'

  const compact = token.trim()
  if (!compact) return null

  const lower = compact.toLowerCase()
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower]
  if (compact.length === 1) return compact.toUpperCase()
  if (/^f(?:[1-9]|1[0-2])$/i.test(compact)) return compact.toUpperCase()

  return null
}

function isModifierToken(token: string): token is keyof typeof MODIFIER_ALIASES {
  return token in MODIFIER_ALIASES
}

export function parseKeyboardShortcut(input: string): ParsedKeyboardShortcut | null {
  const parts = input
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const modifiers = new Set<ModifierName>()
  let key: string | null = null

  for (const part of parts) {
    const lower = part.toLowerCase()

    if (isModifierToken(lower)) {
      modifiers.add(MODIFIER_ALIASES[lower])
      continue
    }

    if (key) return null
    key = normalizeKeyToken(part)
    if (!key) return null
  }

  if (!key) return null

  return {
    altKey: modifiers.has('alt'),
    ctrlKey: modifiers.has('ctrl'),
    key,
    metaKey: modifiers.has('meta'),
    shiftKey: modifiers.has('shift')
  }
}

export function formatKeyboardShortcut(shortcut: ParsedKeyboardShortcut): string {
  return [
    shortcut.ctrlKey ? 'Ctrl' : null,
    shortcut.metaKey ? 'Cmd' : null,
    shortcut.altKey ? 'Alt' : null,
    shortcut.shiftKey ? 'Shift' : null,
    shortcut.key
  ]
    .filter((part): part is string => Boolean(part))
    .join('+')
}

export function normalizeKeyboardShortcut(input: string): string | null {
  const shortcut = parseKeyboardShortcut(input)
  return shortcut ? formatKeyboardShortcut(shortcut) : null
}

export function keyboardShortcutsEqual(first: string, second: string): boolean {
  const normalizedFirst = normalizeKeyboardShortcut(first)
  const normalizedSecond = normalizeKeyboardShortcut(second)
  return Boolean(normalizedFirst && normalizedSecond && normalizedFirst === normalizedSecond)
}

export function keyboardEventMatchesShortcut(event: KeyboardEvent, input: string): boolean {
  const shortcut = parseKeyboardShortcut(input)
  if (!shortcut) return false

  const eventKey = normalizeKeyToken(event.key)
  if (!eventKey || eventKey !== shortcut.key) return false

  return (
    event.altKey === shortcut.altKey &&
    event.ctrlKey === shortcut.ctrlKey &&
    event.metaKey === shortcut.metaKey &&
    event.shiftKey === shortcut.shiftKey
  )
}

export function keyboardShortcutFromEvent(event: KeyboardEvent): ParsedKeyboardShortcut | null {
  const key = normalizeKeyToken(event.key)
  if (!key) return null

  return {
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    key,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey
  }
}
