import { useEffect, useId, useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, KeyRound, Plus, Save, Trash2 } from 'lucide-react'
import {
  AI_AUTO_TARGET_LANGUAGE,
  AI_TARGET_LANGUAGE_OPTIONS,
  DEFAULT_AI_TARGET_LANGUAGE,
  type AiProfile,
  type AiProfileDraft,
  type AiProviderFormat,
  type AiSettings,
  type AiTranslationSettings
} from '@shared/ai'
import { useI18n } from '../i18n'
import { useAppSettingsStore } from '../store/app-settings-store'

type AiSettingsPanelProps = {
  active: boolean
}

type AiSettingsSelectOption = {
  label: string
  value: string
}

const CUSTOM_TARGET_LANGUAGE = '__custom__'

function createProfileId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}`
}

function defaultBaseUrl(format: AiProviderFormat): string {
  return format === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'
}

function createDraftProfile(): AiProfileDraft {
  return {
    id: createProfileId(),
    name: 'Translator',
    format: 'openai',
    baseUrl: defaultBaseUrl('openai'),
    model: ''
  }
}

function draftFromProfile(profile: AiProfile): AiProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    format: profile.format,
    baseUrl: profile.baseUrl,
    model: profile.model
  }
}

function AiSettingsSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string
  onChange: (value: string) => void
  options: AiSettingsSelectOption[]
  value: string
}): JSX.Element {
  const labelId = useId()
  const valueId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  return (
    <div className="general-settings__field">
      <span id={labelId}>{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="ai-settings__menu-trigger" aria-labelledby={`${labelId} ${valueId}`}>
            <span id={valueId}>{selectedOption?.label ?? ''}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content ai-settings__menu" align="start" collisionPadding={12}>
            <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
              {options.map((option) => {
                const selected = option.value === value

                return (
                  <DropdownMenu.RadioItem
                    key={option.value}
                    value={option.value}
                    className={['menu-item ai-settings__menu-option', selected ? 'ai-settings__menu-option--selected' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span>{option.label}</span>
                    <span className="ai-settings__menu-option-check" aria-hidden="true">
                      {selected ? <Check size={13} /> : null}
                    </span>
                  </DropdownMenu.RadioItem>
                )
              })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

export function AiSettingsPanel({ active }: AiSettingsPanelProps): JSX.Element {
  const { t } = useI18n()
  const loadAppSettings = useAppSettingsStore((state) => state.load)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AiProfileDraft>(() => createDraftProfile())
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [translationDraft, setTranslationDraft] = useState<AiTranslationSettings>({
    profileId: null,
    targetLanguage: DEFAULT_AI_TARGET_LANGUAGE,
    appDoubleCtrlEnabled: true,
    systemDoubleCtrlEnabled: true
  })
  const [customTargetLanguage, setCustomTargetLanguage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedProfile = useMemo(
    () => settings?.profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [selectedProfileId, settings?.profiles]
  )
  const isProfileDirty = selectedProfile
    ? JSON.stringify(draft) !== JSON.stringify(draftFromProfile(selectedProfile)) || Boolean(apiKeyDraft.trim())
    : Boolean(draft.name.trim() && draft.baseUrl.trim() && draft.model.trim())
  const isTranslationDirty = settings ? JSON.stringify(translationDraft) !== JSON.stringify(settings.translation) : false
  const targetLanguageChoice = AI_TARGET_LANGUAGE_OPTIONS.includes(translationDraft.targetLanguage as (typeof AI_TARGET_LANGUAGE_OPTIONS)[number])
    ? translationDraft.targetLanguage
    : CUSTOM_TARGET_LANGUAGE
  const formatOptions = useMemo<AiSettingsSelectOption[]>(
    () => [
      { value: 'openai', label: t('settings.aiFormatOpenAi') },
      { value: 'anthropic', label: t('settings.aiFormatAnthropic') }
    ],
    [t]
  )
  const translationProfileOptions = useMemo<AiSettingsSelectOption[]>(
    () => [
      { value: '', label: t('settings.aiNoTranslationProfile') },
      ...(settings?.profiles ?? []).map((profile) => ({ value: profile.id, label: profile.name }))
    ],
    [settings?.profiles, t]
  )
  const targetLanguageOptions = useMemo<AiSettingsSelectOption[]>(
    () => [
      ...AI_TARGET_LANGUAGE_OPTIONS.map((language) => ({
        value: language,
        label: language === AI_AUTO_TARGET_LANGUAGE ? t('settings.aiTargetLanguageAuto') : language
      })),
      { value: CUSTOM_TARGET_LANGUAGE, label: t('settings.aiTargetLanguageCustom') }
    ],
    [t]
  )

  const loadSettings = async (): Promise<void> => {
    const nextSettings = await window.atlas.ai.getSettings()
    setSettings(nextSettings)
    setTranslationDraft(nextSettings.translation)
    setCustomTargetLanguage(
      AI_TARGET_LANGUAGE_OPTIONS.includes(nextSettings.translation.targetLanguage as (typeof AI_TARGET_LANGUAGE_OPTIONS)[number])
        ? ''
        : nextSettings.translation.targetLanguage
    )
    setSelectedProfileId((currentId) =>
      currentId && nextSettings.profiles.some((profile) => profile.id === currentId) ? currentId : nextSettings.profiles[0]?.id ?? null
    )
  }

  useEffect(() => {
    if (!active) return
    void loadSettings().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)))
  }, [active])

  useEffect(() => {
    if (!selectedProfile) return
    setDraft(draftFromProfile(selectedProfile))
    setApiKeyDraft('')
  }, [selectedProfile])

  const run = async (action: () => Promise<AiSettings>): Promise<void> => {
    setBusy(true)
    setError(null)

    try {
      const nextSettings = await action()
      setSettings(nextSettings)
      setTranslationDraft(nextSettings.translation)
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
    setApiKeyDraft('')
    setSelectedProfileId(nextDraft.id)
    setError(null)
  }

  const saveProfile = (): void => {
    void run(async () => {
      const nextSettings = await window.atlas.ai.saveProfile(draft, apiKeyDraft.trim() || undefined)
      setSelectedProfileId(draft.id)
      setApiKeyDraft('')
      return nextSettings
    })
  }

  const deleteProfile = (profileId: string): void => {
    if (!window.confirm(t('settings.aiDeleteProfileConfirm'))) return
    void run(() => window.atlas.ai.deleteProfile(profileId))
  }

  const clearApiKey = (): void => {
    if (!selectedProfile) return
    void run(() => window.atlas.ai.clearProfileApiKey(selectedProfile.id))
  }

  const saveTranslationSettings = (): void => {
    const targetLanguage = targetLanguageChoice === CUSTOM_TARGET_LANGUAGE ? customTargetLanguage.trim() : translationDraft.targetLanguage
    void run(() =>
      window.atlas.ai.updateTranslationSettings({
        ...translationDraft,
        targetLanguage: targetLanguage || DEFAULT_AI_TARGET_LANGUAGE
      })
    )
  }

  const updateDraft = (patch: Partial<AiProfileDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const updateFormat = (format: AiProviderFormat): void => {
    setDraft((current) => ({
      ...current,
      format,
      baseUrl: current.baseUrl === defaultBaseUrl(current.format) ? defaultBaseUrl(format) : current.baseUrl
    }))
  }

  const chooseTargetLanguage = (value: string): void => {
    if (value === CUSTOM_TARGET_LANGUAGE) {
      const customValue = targetLanguageChoice === CUSTOM_TARGET_LANGUAGE ? customTargetLanguage : translationDraft.targetLanguage
      setCustomTargetLanguage(customValue)
      setTranslationDraft((current) => ({ ...current, targetLanguage: customValue || '' }))
      return
    }

    setTranslationDraft((current) => ({ ...current, targetLanguage: value }))
    setCustomTargetLanguage('')
  }

  return (
    <section className="settings-panel ai-settings" aria-labelledby="settings-ai-title">
      <div className="settings-panel__header">
        <div>
          <h2 id="settings-ai-title">{t('settings.ai')}</h2>
          <p>{t('settings.aiDescription')}</p>
        </div>
      </div>

      <div className="ai-settings__layout">
        <aside className="ai-settings__profiles" aria-label={t('settings.aiProfiles')}>
          <button type="button" className="tool-button ai-settings__add" onClick={addProfile} disabled={busy}>
            <Plus size={15} />
            <span>{t('settings.aiAddProfile')}</span>
          </button>

          {(settings?.profiles ?? []).map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={['ai-settings__profile-row', selectedProfileId === profile.id ? 'ai-settings__profile-row--selected' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelectedProfileId(profile.id)}
            >
              <span>{profile.name}</span>
              <small>{profile.format}</small>
            </button>
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
              <span>{t('settings.aiModel')}</span>
              <input value={draft.model} placeholder="model-id" onChange={(event) => updateDraft({ model: event.target.value })} />
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

          <section className="general-settings__section" aria-labelledby="settings-ai-translation-title">
            <div className="general-settings__section-header">
              <h3 id="settings-ai-translation-title">{t('settings.aiTranslation')}</h3>
              <p>{t('settings.aiTranslationDescription')}</p>
            </div>

            <AiSettingsSelect
              label={t('settings.aiTranslationProfile')}
              value={translationDraft.profileId ?? ''}
              options={translationProfileOptions}
              onChange={(value) => setTranslationDraft((current) => ({ ...current, profileId: value || null }))}
            />

            <AiSettingsSelect
              label={t('settings.aiTargetLanguage')}
              value={targetLanguageChoice}
              options={targetLanguageOptions}
              onChange={chooseTargetLanguage}
            />

            {targetLanguageChoice === CUSTOM_TARGET_LANGUAGE ? (
              <label className="general-settings__field">
                <span>{t('settings.aiTargetLanguageCustom')}</span>
                <input
                  value={customTargetLanguage}
                  onChange={(event) => {
                    setCustomTargetLanguage(event.target.value)
                    setTranslationDraft((current) => ({ ...current, targetLanguage: event.target.value }))
                  }}
                />
              </label>
            ) : null}

            <label className="settings-toggle-row">
              <span>
                <strong>{t('settings.aiAppDoubleCtrl')}</strong>
                <small>{t('settings.aiAppDoubleCtrlDescription')}</small>
              </span>
              <input
                type="checkbox"
                checked={translationDraft.appDoubleCtrlEnabled}
                onChange={(event) => setTranslationDraft((current) => ({ ...current, appDoubleCtrlEnabled: event.target.checked }))}
              />
            </label>

            <label className="settings-toggle-row">
              <span>
                <strong>{t('settings.aiSystemDoubleCtrl')}</strong>
                <small>{t('settings.aiSystemDoubleCtrlDescription')}</small>
              </span>
              <input
                type="checkbox"
                checked={translationDraft.systemDoubleCtrlEnabled}
                onChange={(event) => setTranslationDraft((current) => ({ ...current, systemDoubleCtrlEnabled: event.target.checked }))}
              />
            </label>

            <div className="ai-settings__actions">
              {error ? <span className="general-settings__error">{error}</span> : null}
              <button type="button" className="tool-button primary" disabled={busy || !isTranslationDirty} onClick={saveTranslationSettings}>
                <Save size={15} />
                <span>{t('common.save')}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
