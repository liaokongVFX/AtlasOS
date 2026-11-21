import { useEffect, useRef, type InputHTMLAttributes } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { formatKeyboardShortcut, keyboardShortcutFromEvent, normalizeKeyboardShortcut } from '@shared/keyboard-shortcuts'
import { useI18n } from '../i18n'
import { readClipboardText } from '../lib/clipboard'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  onChange: (shortcut: string) => void
}

export function ShortcutRecorder({ onChange, ...props }: Props): JSX.Element {
  const { t } = useI18n()
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
  function paste(text: string): void {
    const key = text.trim()
    if (key) onChange(normalizeKeyboardShortcut(key) ?? key)
  }

  const field = <input {...props} className="general-settings__shortcut-input" inputMode="none"
    autoComplete="off" spellCheck={false}
    onChange={event => onChange(normalizeKeyboardShortcut(event.target.value) ?? event.target.value)}
    onPaste={event => {
      event.preventDefault()
      paste(event.clipboardData.getData('text/plain'))
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
      if (event.key === 'ContextMenu') return
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
  return <ContextMenu.Root>
    <ContextMenu.Trigger asChild disabled={props.disabled}>{field}</ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Content className="menu-content">
        <ContextMenu.Item className="menu-item" onSelect={() => { void readClipboardText()?.then(paste) }}>
          {t('settings.pasteShortcutName')}
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>
}
