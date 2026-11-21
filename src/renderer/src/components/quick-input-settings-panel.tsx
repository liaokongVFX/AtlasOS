import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { QuickInputSnippet } from '@shared/schema'
import { useI18n } from '../i18n'
import { useAppSettingsStore } from '../store/app-settings-store'

type SnippetDraft = { id: string | null; name: string; text: string }

export function QuickInputSettingsPanel({ active }: { active: boolean }): JSX.Element {
  const { t } = useI18n()
  const { settings: { quickInput }, isLoaded, error: loadError, load, patch } = useAppSettingsStore()
  const [draft, setDraft] = useState<SnippetDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (active && !isLoaded) void load()
  }, [active, isLoaded, load])

  function edit(snippet: SnippetDraft | null): void {
    setError('')
    setDraft(snippet)
  }

  async function save(snippets: QuickInputSnippet[]): Promise<void> {
    setError('')
    setSaving(true)
    try {
      await patch({ quickInput: { snippets } })
      setDraft(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function saveDraft(): void {
    if (!draft) return
    const { id, name, text } = draft
    const snippets = id === null
      ? [...quickInput.snippets, { id: crypto.randomUUID(), name, text, shortcut: null }]
      : quickInput.snippets.map(snippet => snippet.id === id ? { ...snippet, name, text } : snippet)
    void save(snippets)
  }

  return (
    <section className="settings-panel general-settings" aria-labelledby="settings-quick-input-title">
      <div className="settings-panel__header">
        <h2 id="settings-quick-input-title">{t('settings.quickInput')}</h2>
        <p>{t('quickInput.settingsDescription')}</p>
      </div>
      <div className="general-settings__field">
        <span>{t('quickInput.windowShortcut')}</span>
        <kbd>{quickInput.windowShortcut ?? t('quickInput.unbound')}</kbd>
      </div>
      <div className="general-settings__section">
        <div className="quick-input-settings__toolbar">
          <h3>{t('quickInput.snippets')}</h3>
          <button
            type="button"
            className="tool-button"
            disabled={!isLoaded || !!loadError || saving || !!draft}
            onClick={() => edit({ id: null, name: '', text: '' })}
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
                onClick={() => void save(quickInput.snippets.filter(item => item.id !== snippet.id))}
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
