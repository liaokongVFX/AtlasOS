import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { AppSettingsPatch } from '@shared/schema'
import { shortcutProblem } from '@shared/quick-input-shortcuts'
import { useI18n } from '../i18n'
import { useAppSettingsStore } from '../store/app-settings-store'
import { ShortcutRecorder } from './shortcut-recorder'

type SnippetDraft = { id: string | null; name: string; text: string; shortcut: string | null }

export function QuickInputSettingsPanel({ active }: { active: boolean }): JSX.Element {
  const { t, locale } = useI18n()
  const { settings, isLoaded, error: loadError, load, patch } = useAppSettingsStore()
  const { quickInput } = settings
  const [draft, setDraft] = useState<SnippetDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState<string[]>([])

  useEffect(() => {
    if (active && !isLoaded) void load()
  }, [active, isLoaded, load])

  useEffect(() => {
    if (!active || !window.atlas.quickInput?.systemShortcuts) return
    let current = true
    void window.atlas.quickInput.unavailableKeys().then(keys => {
      if (current) setUnavailable(keys)
    }).catch(cause => { if (current) setError(String(cause)) })
    return () => { current = false }
  }, [active, settings])

  function edit(snippet: SnippetDraft | null): void {
    setError('')
    setDraft(snippet)
  }

  async function save(change: AppSettingsPatch['quickInput']): Promise<void> {
    setError('')
    setSaving(true)
    try {
      await patch({ quickInput: change })
      setDraft(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function saveDraft(): void {
    if (!draft) return
    const { id, name, text, shortcut } = draft
    const snippets = id === null
      ? [...quickInput.snippets, { id: crypto.randomUUID(), name, text, shortcut }]
      : quickInput.snippets.map(snippet => snippet.id === id ? { ...snippet, name, text, shortcut } : snippet)
    void save({ snippets })
  }

  function record(key: string, forSnippet: boolean): void {
    const owner = forSnippet ? `snippet:${draft?.id ?? ''}` as const : 'window'
    const problem = shortcutProblem({ ...settings, locale }, owner, key)
    setError(problem ?? '')
    if (problem) return
    if (forSnippet && draft) setDraft({ ...draft, shortcut: key })
    else void save({ windowShortcut: key })
  }

  return (
    <section className="settings-panel general-settings" aria-labelledby="settings-quick-input-title">
      <div className="settings-panel__header">
        <h2 id="settings-quick-input-title">{t('settings.quickInput')}</h2>
        <p>{t('quickInput.settingsDescription')}</p>
      </div>
      <div className="general-settings__section-header">
        <div className="quick-input-settings__shortcut">
          <label className="general-settings__field">
            <span>{t('quickInput.windowShortcut')}</span>
            <ShortcutRecorder value={quickInput.windowShortcut ?? ''} placeholder={t('quickInput.unbound')}
              aria-describedby="quick-input-shortcut-description"
              disabled={!isLoaded || !!loadError || saving || !!draft || window.atlas.quickInput?.systemShortcuts === false}
              onChange={key => record(key, false)} />
          </label>
          <button type="button" className="tool-button" disabled={!quickInput.windowShortcut || !isLoaded || !!loadError || saving || !!draft}
            onClick={() => void save({ windowShortcut: null })}>{t('quickInput.clearWindowShortcut')}</button>
        </div>
        <p id="quick-input-shortcut-description">{t('settings.shortcutCaptureDescription')}</p>
        {quickInput.windowShortcut && unavailable.includes(quickInput.windowShortcut) && <small role="status">{t('quickInput.keyUnavailable')}</small>}
      </div>
      <div className="general-settings__section">
        <div className="quick-input-settings__toolbar">
          <h3>{t('quickInput.snippets')}</h3>
          <button
            type="button"
            className="tool-button"
            disabled={!isLoaded || !!loadError || saving || !!draft}
            onClick={() => edit({ id: null, name: '', text: '', shortcut: null })}
          >
            <Plus size={14} />{t('quickInput.addSnippet')}
          </button>
        </div>
        <ul className="quick-input-settings__list">
          {quickInput.snippets.map(snippet => (
            <li key={snippet.id} className="quick-input-settings__row">
              <div className="quick-input-settings__summary">
                <strong>{snippet.name}</strong>
                <small>{snippet.text}</small>
              </div>
              {snippet.shortcut && <kbd>{snippet.shortcut}</kbd>}
              {snippet.shortcut && unavailable.includes(snippet.shortcut) && <small role="status">{t('quickInput.keyUnavailable')}</small>}
              <button
                type="button"
                className="icon-button"
                aria-label={t('quickInput.editSnippet', { name: snippet.name })}
                title={t('quickInput.editSnippet', { name: snippet.name })}
                disabled={saving || !!draft}
                onClick={() => edit(snippet)}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('quickInput.deleteSnippet', { name: snippet.name })}
                title={t('quickInput.deleteSnippet', { name: snippet.name })}
                disabled={saving || !!draft}
                onClick={() => void save({ snippets: quickInput.snippets.filter(item => item.id !== snippet.id) })}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        {draft && (
          <form className="general-settings__section" onSubmit={event => {
            event.preventDefault()
            saveDraft()
          }}>
            <label className="general-settings__field">
              <span>{t('common.name')}</span>
              <input autoFocus required disabled={saving} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="general-settings__field">
              <span>{t('quickInput.text')}</span>
              <textarea className="quick-input-settings__text" required disabled={saving} rows={5} value={draft.text}
                onChange={event => setDraft({ ...draft, text: event.target.value })} />
            </label>
            <div className="quick-input-settings__shortcut">
              <label className="general-settings__field">
                <span>{t('quickInput.snippetShortcut')}</span>
                <ShortcutRecorder value={draft.shortcut ?? ''} placeholder={t('quickInput.unbound')}
                  aria-describedby="quick-input-shortcut-description"
                  disabled={saving || window.atlas.quickInput?.systemShortcuts === false}
                  onChange={key => record(key, true)} />
              </label>
              <button className="tool-button" type="button" disabled={saving || !draft.shortcut}
                onClick={() => { setError(''); setDraft({ ...draft, shortcut: null }) }}>{t('quickInput.clearSnippetShortcut')}</button>
            </div>
            <div className="general-settings__actions">
              <button className="tool-button" type="button" disabled={saving} onClick={() => edit(null)}>{t('common.cancel')}</button>
              <button className="primary-button" type="submit" disabled={saving || !draft.name.trim() || !draft.text}>{t('common.save')}</button>
            </div>
          </form>
        )}
        {loadError && <button className="tool-button" type="button" onClick={() => void load()}>{t('common.reload')}</button>}
        {(error || loadError) && <span className="general-settings__error" role="alert">{error || loadError}</span>}
      </div>
    </section>
  )
}
