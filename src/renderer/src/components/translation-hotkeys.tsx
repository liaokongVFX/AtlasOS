import { useEffect, useRef } from 'react'
import { AI_DOUBLE_CTRL_INTERVAL_MS } from '@shared/ai'
import { useAppSettingsStore } from '../store/app-settings-store'

function selectedInputText(element: Element | null): string {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return ''
  if (element instanceof HTMLInputElement && element.type === 'password') return ''

  const start = element.selectionStart ?? 0
  const end = element.selectionEnd ?? 0
  if (end <= start) return ''

  return element.value.slice(start, end).trim()
}

function selectedDocumentText(): string {
  const inputSelection = selectedInputText(document.activeElement)
  if (inputSelection) return inputSelection

  return window.getSelection()?.toString().trim() ?? ''
}

export function TranslationHotkeys(): null {
  const appDoubleCtrlEnabled = useAppSettingsStore((state) => state.settings.ai.translation.appDoubleCtrlEnabled)
  const lastCtrlUpAtRef = useRef(0)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Control') lastCtrlUpAtRef.current = 0
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!appDoubleCtrlEnabled || event.defaultPrevented || event.key !== 'Control') return

      const now = Date.now()
      if (lastCtrlUpAtRef.current > 0 && now - lastCtrlUpAtRef.current <= AI_DOUBLE_CTRL_INTERVAL_MS) {
        lastCtrlUpAtRef.current = 0
        const text = selectedDocumentText()
        if (text) void window.atlas.ai.openTranslator({ text, source: 'app' })
        return
      }

      lastCtrlUpAtRef.current = now
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [appDoubleCtrlEnabled])

  return null
}
