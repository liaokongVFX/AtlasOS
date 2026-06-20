import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Plus, Save, Trash2 } from 'lucide-react'
import {
  firstAiProfileModel,
  type AiProfile,
  type AiProfileDraft,
  type AiProviderFormat,
  type AiSettings
} from '@shared/ai'
import { useI18n } from '../i18n'
import { useAppSettingsStore } from '../store/app-settings-store'
import { AiSettingsSelect, type AiSettingsSelectOption } from './ai-settings-select'

type AiSettingsPanelProps = {
  active: boolean
}

function createProfileId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}`
}

function defaultBaseUrl(format: AiProviderFormat): string {
  return format === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'
}

function createDraftProfile(): AiProfileDraft {
  return {
    id: createProfileId(),
    name: 'AI Provider',
    format: 'openai',
    baseUrl: defaultBaseUrl('openai'),
    models: []
  }
}

function draftFromProfile(profile: AiProfile): AiProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    format: profile.format,
    baseUrl: profile.baseUrl,
    models: profile.models
  }
}

function modelsText(models: string[]): string {
  return models.join('\n')
}

function modelsFromText(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n|,/g).map((model) => model.trim()).filter(Boolean)))
}

function profileSummary(profile: AiProfile): string {
  const model = firstAiProfileModel(profile) ?? '-'
  return `${profile.format} / ${model} / ${profile.baseUrl}`
}

export function AiSettingsPanel({ active }: AiSettingsPanelProps): JSX.Element {
  const { t } = useI18n()
  const loadAppSettings = useAppSettingsStore((state) => state.load)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AiProfileDraft>(() => createDraftProfile())
  const [modelsDraft, setModelsDraft] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedProfile = useMemo(
    () => settings?.profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [selectedProfileId, settings?.profiles]
  )
  const isProfileDirty = selectedProfile
    ? JSON.stringify(draft) !== JSON.stringify(draftFromProfile(selectedProfile)) || Boolean(apiKeyDraft.trim())
    : Boolean(draft.name.trim() && draft.baseUrl.trim() && draft.models.length > 0)
  const formatOptions = useMemo<AiSettingsSelectOption[]>(
    () => [
      { value: 'openai', label: t('settings.aiFormatOpenAi') },
      { value: 'anthropic', label: t('settings.aiFormatAnthropic') }
    ],
    [t]
  )

  const applySettings = (nextSettings: AiSettings, preferredProfileId?: string | null): void => {
    const nextSelectedProfile =
      (preferredProfileId ? nextSettings.profiles.find((profile) => profile.id === preferredProfileId) : null) ?? nextSettings.profiles[0] ?? null

    setSettings(nextSettings)
    setSelectedProfileId(nextSelectedProfile?.id ?? null)
    setDraft(nextSelectedProfile ? draftFromProfile(nextSelectedProfile) : createDraftProfile())
    setModelsDraft(nextSelectedProfile ? modelsText(nextSelectedProfile.models) : '')
    setApiKeyDraft('')
  }

  const loadSettings = async (): Promise<void> => {
    const nextSettings = await window.atlas.ai.getSettings()
    applySettings(nextSettings, selectedProfileId)
  }

  useEffect(() => {
    if (!active) return
    void loadSettings().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)))
  }, [active])

  useEffect(() => {
    if (!selectedProfile) return
    setDraft(draftFromProfile(selectedProfile))
    setModelsDraft(modelsText(selectedProfile.models))
    setApiKeyDraft('')
  }, [selectedProfile])

  const run = async (action: () => Promise<AiSettings>, preferredProfileId?: string | null): Promise<void> => {
    setBusy(true)
    setError(null)

    try {
      const nextSettings = await action()
      applySettings(nextSettings, preferredProfileId === undefined ? selectedProfileId : preferredProfileId)
      await loadAppSettings()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBusy(false)
    }
  }

  const addProfile = (): void => {
    const nextDraft = createDraftProfile()
    setDraft(nextDraft)
    setModelsDraft('')
    setApiKeyDraft('')
    setSelectedProfileId(nextDraft.id)
    setError(null)
  }

  const saveProfile = (): void => {
    void run(async () => {
      const nextSettings = await window.atlas.ai.saveProfile(draft, apiKeyDraft.trim() || undefined)
      return nextSettings
    }, draft.id)
  }

  const deleteProfile = (profileId: string): void => {
    if (!window.confirm(t('settings.aiDeleteProfileConfirm'))) return
    void run(() => window.atlas.ai.deleteProfile(profileId), profileId === selectedProfileId ? null : selectedProfileId)
  }

  const clearApiKey = (): void => {
    if (!selectedProfile) return
    void run(() => window.atlas.ai.clearProfileApiKey(selectedProfile.id))
  }

  const updateDraft = (patch: Partial<AiProfileDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const updateModels = (value: string): void => {
    setModelsDraft(value)
    updateDraft({ models: modelsFromText(value) })
  }

  const updateFormat = (format: AiProviderFormat): void => {
    setDraft((current) => ({
      ...current,
      format,
      baseUrl: current.baseUrl === defaultBaseUrl(current.format) ? defaultBaseUrl(format) : current.baseUrl
    }))
  }

  return (
    <section className="settings-panel ai-settings" aria-labelledby="settings-ai-title">
      <div className="settings-panel__header">
        <div>
          <h2 id="settings-ai-title">{t('settings.ai')}</h2>
          <p>{t('settings.aiDescription')}</p>
        </div>
      </div>

      <div className="ai-settings__body">
        <div className="ai-settings__providers-panel">
          <aside className="ai-settings__profiles" aria-label={t('settings.aiProfiles')}>
            <button type="button" className="tool-button ai-settings__add" onClick={addProfile} disabled={busy}>
              <Plus size={15} />
              <span>{t('settings.aiAddProfile')}</span>
            </button>

            {(settings?.profiles ?? []).map((profile) => (
              <div
                key={profile.id}
                className={['ai-settings__profile-row', selectedProfileId === profile.id ? 'ai-settings__profile-row--selected' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <button type="button" className="ai-settings__profile-select" onClick={() => setSelectedProfileId(profile.id)}>
                  <span>{profile.name}</span>
                  <small>{profileSummary(profile)}</small>
                </button>
                <button
                  type="button"
                  className="icon-button ai-settings__profile-delete"
                  title={t('common.remove')}
                  aria-label={t('common.remove')}
                  disabled={busy}
                  onClick={() => deleteProfile(profile.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            {settings?.profiles.length === 0 ? <div className="plugin-settings__empty">{t('settings.aiNoProfiles')}</div> : null}
          </aside>

          <div className="ai-settings__detail">
            <section className="general-settings__section" aria-labelledby="settings-ai-profile-title">
              <div className="general-settings__section-header">
                <h3 id="settings-ai-profile-title">{t('settings.aiProfile')}</h3>
                <p>{t('settings.aiProfileDescription')}</p>
              </div>

              <label className="general-settings__field">
                <span>{t('settings.aiProfileName')}</span>
                <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
              </label>

              <AiSettingsSelect label={t('settings.aiFormat')} value={draft.format} options={formatOptions} onChange={(value) => updateFormat(value as AiProviderFormat)} />

              <label className="general-settings__field">
                <span>{t('settings.aiBaseUrl')}</span>
                <input value={draft.baseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => updateDraft({ baseUrl: event.target.value })} />
              </label>

              <label className="general-settings__field">
                <span>{t('settings.aiModels')}</span>
                <textarea
                  className="ai-settings__models-input"
                  value={modelsDraft}
                  placeholder="gpt-5.4&#10;gpt-5.4-mini"
                  rows={4}
                  onKeyDownCapture={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => updateModels(event.target.value)}
                />
                <small className="general-settings__field-hint">{t('settings.aiModelsDescription')}</small>
              </label>

              <label className="general-settings__field">
                <span>{t('settings.aiApiKey')}</span>
                <input
                  type="password"
                  value={apiKeyDraft}
                  placeholder={selectedProfile?.apiKeyConfigured ? t('settings.aiApiKeyConfigured') : t('settings.aiApiKeyPlaceholder')}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                />
              </label>

              <div className="ai-settings__actions">
                {error ? <span className="general-settings__error">{error}</span> : null}
                <button type="button" className="tool-button" disabled={!selectedProfile?.apiKeyConfigured || busy} onClick={clearApiKey}>
                  <KeyRound size={15} />
                  <span>{t('settings.aiClearApiKey')}</span>
                </button>
                {selectedProfile ? (
                  <button type="button" className="tool-button danger" disabled={busy} onClick={() => deleteProfile(selectedProfile.id)}>
                    <Trash2 size={15} />
                    <span>{t('common.remove')}</span>
                  </button>
                ) : null}
                <button type="button" className="tool-button primary" disabled={busy || !isProfileDirty} onClick={saveProfile}>
                  <Save size={15} />
                  <span>{t('common.save')}</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  )
}
