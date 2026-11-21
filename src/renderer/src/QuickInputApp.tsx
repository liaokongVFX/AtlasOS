import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { QuickInputPanelState } from '@shared/quick-input-panel'
import { readStoredLocale, useI18n } from './i18n'

export function QuickInputApp(): JSX.Element {
  const { t, setLocale } = useI18n()
  const [state, setState] = useState<QuickInputPanelState | null>(null)
  const status = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    let active = true
    let receivedUpdate = false
    const unsubscribe = window.atlas.quickInput.onChanged((next) => {
      receivedUpdate = true
      setLocale(readStoredLocale())
      setState(next)
    })
    void window.atlas.quickInput.get().then((next) => {
      if (active && !receivedUpdate) setState(next)
    })
    return () => { active = false; unsubscribe() }
  }, [setLocale])

  useEffect(() => { status.current?.focus() }, [state])

  if (!state) return <main />
  const { requestId, failure, selectedId, snippets } = state
  const snippet = snippets.find(({ id }) => id === selectedId)
  return (
    <main className="quick-input-panel" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      if (event.key === 'Escape') {
        event.preventDefault()
        void window.atlas.quickInput.cancel(requestId)
      }
    }}>
      <h1>{t('quickInputPanel.title')}</h1>
      {failure ? (
        <>
          <p role="status" tabIndex={-1} ref={status}>{t(failure === 'unknown' ? 'quickInputPanel.unknown' : 'quickInputPanel.unavailable')}</p>
          <span>{snippet?.name}</span>
          {failure === 'unavailable' && <button className="secondary-button" onClick={() => void window.atlas.quickInput.copy(requestId)}>
            {t('quickInputPanel.copy')}
          </button>}
          {failure === 'unknown' && <button className="secondary-button" onClick={() => void window.atlas.quickInput.cancel(requestId)}>
            {t('common.close')}
          </button>}
        </>
      ) : <SnippetSearch key={requestId} state={state} />}
    </main>
  )
}

function SnippetSearch({ state }: { state: QuickInputPanelState }): JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const activeOption = useRef<HTMLLIElement>(null)
  const composing = useRef(false)
  const submitted = useRef(false)
  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return state.snippets
    const names = []
    const bodies = []
    for (const snippet of state.snippets) {
      if (snippet.name.toLowerCase().includes(term)) names.push(snippet)
      else if (snippet.text.toLowerCase().includes(term)) bodies.push(snippet)
    }
    return [...names, ...bodies]
  }, [query, state.snippets])

  useEffect(() => { activeOption.current?.scrollIntoView({ block: 'nearest' }) }, [activeIndex, query])

  function choose(id: string): void {
    if (submitted.current) return
    submitted.current = true
    void window.atlas.quickInput.choose(state.requestId, id)
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      event.stopPropagation()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex(index => Math.max(0, Math.min(results.length - 1, index + step)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!event.repeat && results[activeIndex]) choose(results[activeIndex].id)
    }
  }

  return (
    <>
      <input
        autoFocus
        type="text"
        role="combobox"
        aria-label={t('quickInputPanel.search')}
        placeholder={t('quickInputPanel.search')}
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="snippet-list"
        aria-activedescendant={results[activeIndex] ? `snippet-option-${activeIndex}` : undefined}
        value={query}
        onChange={event => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={() => { composing.current = false }}
        onKeyDown={handleSearchKey}
      />
      <ul id="snippet-list" role="listbox" aria-label={t('quickInput.snippets')}>
        {results.map((snippet, index) => (
          <li
            key={snippet.id}
            id={`snippet-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            ref={index === activeIndex ? activeOption : undefined}
            onMouseDown={event => event.preventDefault()}
            onClick={() => choose(snippet.id)}
          >
            <span className="quick-input-panel__summary">
              <strong>{snippet.name}</strong>
              <small>{snippet.text}</small>
            </span>
            {snippet.shortcut && <kbd>{snippet.shortcut}</kbd>}
          </li>
        ))}
      </ul>
      {results.length === 0 && <p role="status">{t(state.snippets.length ? 'quickInputPanel.noMatch' : 'quickInputPanel.empty')}</p>}
    </>
  )
}
