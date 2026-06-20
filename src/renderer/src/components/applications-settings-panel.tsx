import { useEffect, useMemo, useState } from 'react'
import { Languages, NotebookText, Save, type LucideIcon } from 'lucide-react'
import {
  AI_AUTO_TARGET_LANGUAGE,
  AI_TARGET_LANGUAGE_OPTIONS,
  DEFAULT_AI_TARGET_LANGUAGE,
  firstAiProfileModel,
  type AiDailySummarySettings,
  type AiProfile,
  type AiSettings,
  type AiTranslationSettings
} from '@shared/ai'
import { useI18n, type I18nKey } from '../i18n'
import { cn } from '../lib/utils'
import { useAppSettingsStore } from '../store/app-settings-store'
import { AiSettingsSelect, type AiSettingsSelectOption } from './ai-settings-select'

type ApplicationsSettingsPanelProps = {
  active: boolean
}

type AiModelSelection = {
  profileId: string | null
  model: string | null
}

type ApplicationSettingsId = 'translation' | 'daily-summary'

type ApplicationSettingsDefinition = {
  id: ApplicationSettingsId
  titleKey: I18nKey
  descriptionKey: I18nKey
  icon: LucideIcon
}

const CUSTOM_TARGET_LANGUAGE = '__custom__'

const APPLICATION_SETTINGS: readonly ApplicationSettingsDefinition[] = [
  {
    id: 'translation',
    titleKey: 'settings.aiTranslation',
    descriptionKey: 'settings.aiTranslationDescription',
    icon: Languages
  },
  {
    id: 'daily-summary',
    titleKey: 'settings.aiDailySummary',
    descriptionKey: 'settings.aiDailySummaryDescription',
    icon: NotebookText
  }
] as const

function modelSelection(profile: AiProfile | undefined): AiModelSelection {
  return profile ? { profileId: profile.id, model: firstAiProfileModel(profile) } : { profileId: null, model: null }
}

function reconcileModelSelection<T extends AiModelSelection>(selection: T, profiles: AiProfile[]): T {
  if (!selection.profileId) return { ...selection, model: null }

  const selectedProfile = profiles.find((profile) => profile.id === selection.profileId)
  if (!selectedProfile) return { ...selection, ...modelSelection(profiles[0]) }
  if (selection.model && selectedProfile.models.includes(selection.model)) return selection

  return { ...selection, model: firstAiProfileModel(selectedProfile) }
}

export function ApplicationsSettingsPanel({ active }: ApplicationsSettingsPanelProps): JSX.Element {
  const { t } = useI18n()
  const loadAppSettings = useAppSettingsStore((state) => state.load)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [activeApplicationId, setActiveApplicationId] = useState<ApplicationSettingsId>('translation')
  const [translationDraft, setTranslationDraft] = useState<AiTranslationSettings>({
    profileId: null,
    model: null,
    targetLanguage: DEFAULT_AI_TARGET_LANGUAGE,
    appDoubleCtrlEnabled: true,
    systemDoubleCtrlEnabled: true
  })
  const [dailySummaryDraft, setDailySummaryDraft] = useState<AiDailySummarySettings>({
    profileId: null,
    model: null
  })
  const [customTargetLanguage, setCustomTargetLanguage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeApplication = APPLICATION_SETTINGS.find((application) => application.id === activeApplicationId) ?? APPLICATION_SETTINGS[0]
  const isTranslationDirty = settings ? JSON.stringify(translationDraft) !== JSON.stringify(settings.translation) : false
  const isDailySummaryDirty = settings ? JSON.stringify(dailySummaryDraft) !== JSON.stringify(settings.dailySummary) : false
  const targetLanguageChoice = AI_TARGET_LANGUAGE_OPTIONS.includes(translationDraft.targetLanguage as (typeof AI_TARGET_LANGUAGE_OPTIONS)[number])
    ? translationDraft.targetLanguage
    : CUSTOM_TARGET_LANGUAGE

  const translationProfileOptions = useMemo<AiSettingsSelectOption[]>(
    () => [
      { value: '', label: t('settings.aiNoTranslationProfile') },
      ...(settings?.profiles ?? []).map((profile) => ({ value: profile.id, label: profile.name }))
    ],
    [settings?.profiles, t]
  )
  const dailySummaryProfileOptions = useMemo<AiSettingsSelectOption[]>(
    () => [
      { value: '', label: t('settings.aiNoDailySummaryProfile') },
      ...(settings?.profiles ?? []).map((profile) => ({ value: profile.id, label: profile.name }))
    ],
    [settings?.profiles, t]
  )
  const translationModelOptions = useMemo<AiSettingsSelectOption[]>(() => {
    const profile = settings?.profiles.find((candidate) => candidate.id === translationDraft.profileId)
    return [
      { value: '', label: t('settings.aiNoModel') },
      ...(profile?.models ?? []).map((model) => ({ value: model, label: model }))
    ]
  }, [settings?.profiles, t, translationDraft.profileId])
  const dailySummaryModelOptions = useMemo<AiSettingsSelectOption[]>(() => {
    const profile = settings?.profiles.find((candidate) => candidate.id === dailySummaryDraft.profileId)
    return [
      { value: '', label: t('settings.aiNoModel') },
      ...(profile?.models ?? []).map((model) => ({ value: model, label: model }))
    ]
  }, [dailySummaryDraft.profileId, settings?.profiles, t])
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

  const applySettings = (nextSettings: AiSettings): void => {
    setSettings(nextSettings)
    setTranslationDraft(nextSettings.translation)
    setDailySummaryDraft(nextSettings.dailySummary)
    setCustomTargetLanguage(
      AI_TARGET_LANGUAGE_OPTIONS.includes(nextSettings.translation.targetLanguage as (typeof AI_TARGET_LANGUAGE_OPTIONS)[number])
        ? ''
        : nextSettings.translation.targetLanguage
    )
  }

  const loadSettings = async (): Promise<void> => {
    const nextSettings = await window.atlas.ai.getSettings()
    applySettings(nextSettings)
  }

  useEffect(() => {
    if (!active) return
    void loadSettings().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)))
  }, [active])

  const run = async (action: () => Promise<AiSettings>): Promise<void> => {
    setBusy(true)
    setError(null)

    try {
      const nextSettings = await action()
      applySettings(nextSettings)
      await loadAppSettings()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBusy(false)
    }
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

  const chooseTranslationProfile = (profileId: string): void => {
    const profiles = settings?.profiles ?? []
    setTranslationDraft((current) => reconcileModelSelection({ ...current, profileId: profileId || null }, profiles))
  }

  const chooseDailySummaryProfile = (profileId: string): void => {
    const profiles = settings?.profiles ?? []
    setDailySummaryDraft((current) => reconcileModelSelection({ ...current, profileId: profileId || null }, profiles))
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

  const saveDailySummarySettings = (): void => {
    void run(() => window.atlas.ai.updateDailySummarySettings(dailySummaryDraft))
  }

  return (
    <section className="settings-panel applications-settings" aria-labelledby="settings-applications-title">
      <div className="settings-panel__header">
        <div>
          <h2 id="settings-applications-title">{t('settings.applications')}</h2>
          <p>{t('settings.applicationsDescription')}</p>
        </div>
      </div>

      <div className="applications-settings__body">
        <aside className="applications-settings__menu" aria-label={t('settings.applications')}>
          {APPLICATION_SETTINGS.map((application) => {
            const Icon = application.icon
            const selected = application.id === activeApplicationId

            return (
              <button
                key={application.id}
                type="button"
                className={cn('applications-settings__menu-button', selected && 'applications-settings__menu-button--active')}
                onClick={() => setActiveApplicationId(application.id)}
                aria-current={selected ? 'page' : undefined}
              >
                <Icon size={15} />
                <span>
                  <strong>{t(application.titleKey)}</strong>
                  <small>{t(application.descriptionKey)}</small>
                </span>
              </button>
            )
          })}
        </aside>

        <div className="applications-settings__detail">
          <section className="general-settings__section" aria-labelledby={`settings-application-${activeApplication.id}`}>
            <div className="general-settings__section-header">
              <h3 id={`settings-application-${activeApplication.id}`}>{t(activeApplication.titleKey)}</h3>
              <p>{t(activeApplication.descriptionKey)}</p>
            </div>

            {activeApplicationId === 'translation' ? (
              <>
                <AiSettingsSelect
                  label={t('settings.aiTranslationProfile')}
                  value={translationDraft.profileId ?? ''}
                  options={translationProfileOptions}
                  onChange={chooseTranslationProfile}
                />

                <AiSettingsSelect
                  label={t('settings.aiTranslationModel')}
                  value={translationDraft.model ?? ''}
                  options={translationModelOptions}
                  onChange={(value) => setTranslationDraft((current) => ({ ...current, model: value || null }))}
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
              </>
            ) : (
              <>
                <AiSettingsSelect
                  label={t('settings.aiDailySummaryProfile')}
                  value={dailySummaryDraft.profileId ?? ''}
                  options={dailySummaryProfileOptions}
                  onChange={chooseDailySummaryProfile}
                />

                <AiSettingsSelect
                  label={t('settings.aiDailySummaryModel')}
                  value={dailySummaryDraft.model ?? ''}
                  options={dailySummaryModelOptions}
                  onChange={(value) => setDailySummaryDraft((current) => ({ ...current, model: value || null }))}
                />

                <div className="ai-settings__actions">
                  {error ? <span className="general-settings__error">{error}</span> : null}
                  <button type="button" className="tool-button primary" disabled={busy || !isDailySummaryDirty} onClick={saveDailySummarySettings}>
                    <Save size={15} />
                    <span>{t('common.save')}</span>
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}
