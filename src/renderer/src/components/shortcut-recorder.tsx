import { useEffect, useRef, type InputHTMLAttributes } from 'react'
import { formatKeyboardShortcut, keyboardShortcutFromEvent, normalizeKeyboardShortcut } from '@shared/keyboard-shortcuts'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  onChange: (shortcut: string) => void
}

export function ShortcutRecorder({ onChange, ...props }: Props): JSX.Element {
  const unsubscribe = useRef<(() => void) | null>(null)
  const change = useRef(onChange)
  change.current = onChange

  function stopRecording(): void {
    if (!unsubscribe.current) return
    unsubscribe.current()
    unsubscribe.current = null
    window.atlas.quickInput.setRecording(false)
  }

  useEffect(() => stopRecording, [])
  return <input {...props} className="general-settings__shortcut-input" inputMode="none"
    autoComplete="off" spellCheck={false}
    onChange={event => onChange(normalizeKeyboardShortcut(event.target.value) ?? event.target.value)}
    onPaste={event => {
      event.preventDefault()
      const text = event.clipboardData.getData('text/plain').trim()
      onChange(normalizeKeyboardShortcut(text) ?? text)
    }}
    onFocus={event => {
      event.currentTarget.select()
      if (!window.atlas.quickInput?.systemShortcuts) return
      unsubscribe.current = window.atlas.quickInput.onRecorded(key => change.current(key))
      window.atlas.quickInput.setRecording(true)
    }}
    onBlur={stopRecording}
    onKeyDownCapture={event => {
      event.stopPropagation()
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v') return
      if (event.shiftKey && !event.ctrlKey && !event.altKey && event.key === 'Insert') return
      event.preventDefault()
      if (event.nativeEvent.isComposing || event.repeat) return
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.currentTarget.blur()
        return
      }
      const shortcut = keyboardShortcutFromEvent(event.nativeEvent)
      if (shortcut) onChange(formatKeyboardShortcut(shortcut))
    }}
  />
}
