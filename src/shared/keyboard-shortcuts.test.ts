import { describe, expect, it } from 'vitest'
import { keyboardEventMatchesShortcut, normalizeKeyboardShortcut } from './keyboard-shortcuts'

describe('keyboard shortcuts', () => {
  it('normalizes supported shortcut strings', () => {
    expect(normalizeKeyboardShortcut('control + q')).toBe('Ctrl+Q')
    expect(normalizeKeyboardShortcut('cmd + shift + f')).toBe('Cmd+Shift+F')
    expect(normalizeKeyboardShortcut('Ctrl+Space')).toBe('Ctrl+Space')
  })

  it('matches keyboard events exactly against configured modifiers', () => {
    expect(keyboardEventMatchesShortcut(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true }), 'Ctrl+Q')).toBe(true)
    expect(keyboardEventMatchesShortcut(new KeyboardEvent('keydown', { key: 'q', metaKey: true }), 'Ctrl+Q')).toBe(false)
    expect(keyboardEventMatchesShortcut(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true }), 'Ctrl+F')).toBe(false)
  })

  it('rejects malformed shortcuts', () => {
    expect(normalizeKeyboardShortcut('Ctrl')).toBeNull()
    expect(normalizeKeyboardShortcut('Ctrl+F+Q')).toBeNull()
  })
})
