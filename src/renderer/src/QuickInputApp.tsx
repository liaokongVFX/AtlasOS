import { useEffect, useRef, useState } from 'react'
import type { QuickInputPanelState } from '@shared/quick-input-panel'
import { useI18n } from './i18n'

export function QuickInputApp(): JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<QuickInputPanelState | null>(null)
  const option = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    let receivedUpdate = false
    const unsubscribe = window.atlas.quickInput.onChanged((next) => {
      receivedUpdate = true
      setState(next)
    })
    void window.atlas.quickInput.get().then((next) => {
      if (active && !receivedUpdate) setState(next)
    })
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => { option.current?.focus() }, [state])

  if (!state) return <main />
  const { requestId, failure, selectedId, snippets } = state
  const snippet = snippets.find(({ id }) => id === selectedId) ?? snippets[0]
  return (
    <main className="quick-input-panel" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      if (event.key === 'Escape') {
        event.preventDefault()
        void window.atlas.quickInput.cancel(requestId)
      }
      if (event.key === 'Enter' && !failure && snippet) {
        event.preventDefault()
        if (!event.repeat) void window.atlas.quickInput.choose(requestId, snippet.id)
      }
    }}>
      <h1>{t('quickInputPanel.title')}</h1>
      {failure ? (
        <>
          <p role="status">{t(failure === 'unknown' ? 'quickInputPanel.unknown' : 'quickInputPanel.unavailable')}</p>
          <span>{snippet?.name}</span>
          {failure === 'unavailable' && <button className="secondary-button" ref={option} onClick={() => void window.atlas.quickInput.copy(requestId)}>
            {t('quickInputPanel.copy')}
          </button>}
          {failure === 'unknown' && <button className="secondary-button" ref={option} onClick={() => void window.atlas.quickInput.cancel(requestId)}>
            {t('common.close')}
          </button>}
        </>
      ) : snippet && (
        <button className="secondary-button" ref={option} onClick={() => void window.atlas.quickInput.choose(requestId, snippet.id)}>
          {snippet.name}
        </button>
      )}
    </main>
  )
}
