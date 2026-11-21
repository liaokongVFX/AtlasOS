import { canvasShortcutLabels } from './canvas-shortcut-labels'
import { formatKeyboardShortcut, normalizeKeyboardShortcut, parseKeyboardShortcut } from './keyboard-shortcuts'
import type { AppSettings, AppShortcutSettings } from './schema'

export type ShortcutOwner = 'window' | `snippet:${string}` | keyof AppShortcutSettings
type ShortcutBinding = { owner: ShortcutOwner; key: string | null; label: string }

// Electron translates shifted punctuation to a base virtual key plus Shift on Windows.
const shiftedKeys: Record<string, string> = {
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', Plus: '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`'
}

export function windowsShortcutIdentity(normalized: string): string {
  const parts = parseKeyboardShortcut(normalized)
  const base = parts && shiftedKeys[parts.key]
  return parts && base ? formatKeyboardShortcut({ ...parts, key: base, shiftKey: true }) : normalized
}

export function shortcutBindings(settings: AppSettings): ShortcutBinding[] {
  const english = settings.locale === 'en-US'
  return [
    ...Object.entries(settings.shortcuts).map(([key, shortcut]) => {
      const owner = key as keyof AppShortcutSettings
      return { owner, key: shortcut, label: canvasShortcutLabels[owner][settings.locale] }
    }),
    { owner: 'window', key: settings.quickInput.windowShortcut, label: english ? 'Window shortcut' : '窗口快捷键' },
    ...settings.quickInput.snippets.map(snippet => ({
      owner: `snippet:${snippet.id}` as const, key: snippet.shortcut, label: snippet.name
    }))
  ]
}

export function shortcutProblem(settings: AppSettings, owner: ShortcutOwner, input: string): string | null {
  const english = settings.locale === 'en-US'
  const key = normalizeKeyboardShortcut(input)
  const parsed = parseKeyboardShortcut(input)
  if (!key || !parsed) return english ? 'Invalid shortcut.' : '无效快捷键。'
  if (owner === 'window' || owner.startsWith('snippet:')) {
    if (key === 'Ctrl+V') return english
      ? 'Ctrl+V is used to paste snippets into other applications. Choose another shortcut.'
      : '快捷输入需要用 Ctrl+V 向其他应用粘贴片段，请选择其他快捷键。'
    if (parsed.key === 'F12' || parsed.metaKey || ['Ctrl+Alt+Delete', 'Alt+Tab', 'Ctrl+Escape'].includes(key)) {
      return english ? `${key} is reserved by Windows.` : `${key} 是 Windows 保留快捷键。`
    }
    if (!parsed.altKey && !parsed.ctrlKey && !parsed.shiftKey && !/^F\d+$/.test(parsed.key)) {
      return english ? 'Use a function key or add a modifier (Ctrl, Alt or Shift).' : '请选择功能键，或添加 Ctrl、Alt、Shift 修饰键。'
    }
    if (parsed.shiftKey && !parsed.ctrlKey && !parsed.altKey && (parsed.key.length === 1 || ['Space', 'Plus'].includes(parsed.key))) {
      return english ? 'This shortcut is used for typing. Add Ctrl or Alt.' : '此组合用于正常输入，请添加 Ctrl 或 Alt。'
    }
    if (/[^\x20-\x7e]/.test(key)) return english ? 'This key is not supported by Windows shortcuts.' : 'Windows 快捷键不支持此按键。'
  }
  const identity = windowsShortcutIdentity(key)
  const conflict = shortcutBindings(settings).find(binding =>
    binding.owner !== owner && binding.key && windowsShortcutIdentity(binding.key) === identity)
  if (!conflict) return null
  return english ? `${key} is already used by “${conflict.label}”.` : `${key} 已用于「${conflict.label}」。`
}
