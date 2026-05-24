import { useEffect, useMemo, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Bot, Puzzle, Settings, SlidersHorizontal, X, type LucideIcon } from 'lucide-react'
import { DEFAULT_APP_SHORTCUTS } from '@shared/constants'
import {
  formatKeyboardShortcut,
  keyboardShortcutFromEvent,
  keyboardShortcutsEqual,
  normalizeKeyboardShortcut
} from '@shared/keyboard-shortcuts'
import type { AppShortcutSettings } from '@shared/schema'
import { LOCALES, useI18n, type I18nKey, type Locale } from '../i18n'
import { useAppSettingsStore } from '../store/app-settings-store'
import { PluginSettingsPanel } from './plugin-settings-panel'

type SettingsSectionPanelProps = {
  active: boolean
}

type SettingsSectionDefinition<Id extends string = string> = {
  id: Id
  titleKey: I18nKey
  icon: LucideIcon
  Panel: ComponentType<SettingsSectionPanelProps>
}

type EmptySettingsPanelProps = {
  id: string
  titleKey: I18nKey
  messageKey: I18nKey
}

function EmptySettingsPanel({ id, titleKey, messageKey }: EmptySettingsPanelProps): JSX.Element {
  const { t } = useI18n()
  const titleId = `settings-${id}-title`

  return (
    <section className="settings-panel settings-panel--empty" aria-labelledby={titleId}>
      <div className="settings-panel__header">
        <h2 id={titleId}>{t(titleKey)}</h2>
        <p>{t(messageKey)}</p>
      </div>
    </section>
  )
}

type ShortcutErrors = Partial<Record<keyof AppShortcutSettings, I18nKey>>

function validateShortcutDraft(draft: AppShortcutSettings): { errors: ShortcutErrors; shortcuts: AppShortcutSettings | null } {
  const canvasDeselect = normalizeKeyboardShortcut(draft.canvasDeselect)
  const canvasFind = normalizeKeyboardShortcut(draft.canvasFind)
  const errors: ShortcutErrors = {}

  if (!canvasDeselect) errors.canvasDeselect = 'settings.shortcutInvalid'
  if (!canvasFind) errors.canvasFind = 'settings.shortcutInvalid'

  if (canvasDeselect && canvasFind && keyboardShortcutsEqual(canvasDeselect, canvasFind)) {
    errors.canvasFind = 'settings.shortcutAlreadyUsed'
  }

  if (Object.keys(errors).length > 0 || !canvasDeselect || !canvasFind) {
    return { errors, shortcuts: null }
  }

  return {
    errors,
    shortcuts: {
      canvasDeselect,
      canvasFind
    }
  }
}

function GeneralSettingsPanel({ active }: SettingsSectionPanelProps): JSX.Element {
  const { locale, setLocale, t } = useI18n()
  const settings = useAppSettingsStore((state) => state.settings)
  const isLoaded = useAppSettingsStore((state) => state.isLoaded)
  const loadSettings = useAppSettingsStore((state) => state.load)
  const updateSettings = useAppSettingsStore((state) => state.update)
  const [draft, setDraft] = useState<AppShortcutSettings>(() => ({ ...DEFAULT_APP_SHORTCUTS }))
  const [errors, setErrors] = useState<ShortcutErrors>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (active && !isLoaded) void loadSettings()
  }, [active, isLoaded, loadSettings])

  useEffect(() => {
    if (!active) return

    setDraft(settings.shortcuts)
    setErrors({})
    setActionError(null)
  }, [active, settings.shortcuts])

  const updateShortcutDraft = (key: keyof AppShortcutSettings, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setActionError(null)
  }

  const captureShortcut = (event: ReactKeyboardEvent<HTMLInputElement>, key: keyof AppShortcutSettings): void => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return

    const shortcut = keyboardShortcutFromEvent(event.nativeEvent)
    if (!shortcut) return

    event.preventDefault()
    updateShortcutDraft(key, formatKeyboardShortcut(shortcut))
  }

  const saveShortcuts = async (): Promise<void> => {
    const validation = validateShortcutDraft(draft)
    setErrors(validation.errors)
    if (!validation.shortcuts) return

    setSaving(true)
    setActionError(null)

    try {
      const saved = await updateSettings({
        ...settings,
        shortcuts: validation.shortcuts
      })
      setDraft(saved.shortcuts)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const changeLanguage = async (nextLocale: Locale): Promise<void> => {
    setLocale(nextLocale)
    setActionError(null)

    try {
      await updateSettings({
        ...settings,
        locale: nextLocale
      })
    } catch (error) {
      setLocale(settings.locale)
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const isDirty =
    draft.canvasDeselect !== settings.shortcuts.canvasDeselect || draft.canvasFind !== settings.shortcuts.canvasFind

  return (
    <section className="settings-panel general-settings" aria-labelledby="settings-general-title">
      <div className="settings-panel__header">
        <h2 id="settings-general-title">{t('settings.general')}</h2>
      </div>

      <div className="general-settings__section" aria-labelledby="settings-language-title">
        <div className="general-settings__section-header">
          <h3 id="settings-language-title">{t('settings.languageTitle')}</h3>
          <p>{t('settings.languageDescription')}</p>
        </div>
        <div className="settings-language">
          <span>{t('settings.displayLanguage')}</span>
          <div className="settings-language__options" role="group" aria-label={t('settings.displayLanguage')}>
            {LOCALES.map((option) => (
              <button
                key={option}
                type="button"
                className={locale === option ? 'segmented segmented--active' : 'segmented'}
                aria-pressed={locale === option}
                onClick={() => void changeLanguage(option)}
              >
                {option === 'zh-CN' ? t('language.zh') : t('language.en')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="general-settings__section" aria-labelledby="settings-shortcuts-title">
        <h3 id="settings-shortcuts-title">{t('settings.keyboardShortcuts')}</h3>
        <div className="general-settings__fields">
          <label className="general-settings__field">
            <span>{t('settings.shortcutDeselectNodes')}</span>
            <input
              type="text"
              value={draft.canvasDeselect}
              onKeyDown={(event) => captureShortcut(event, 'canvasDeselect')}
              onChange={(event) => updateShortcutDraft('canvasDeselect', event.target.value)}
              aria-invalid={errors.canvasDeselect ? 'true' : undefined}
              aria-describedby={errors.canvasDeselect ? 'settings-shortcut-deselect-error' : undefined}
            />
            {errors.canvasDeselect ? <small id="settings-shortcut-deselect-error">{t(errors.canvasDeselect)}</small> : null}
          </label>

          <label className="general-settings__field">
            <span>{t('settings.shortcutFindNodes')}</span>
            <input
              type="text"
              value={draft.canvasFind}
              onKeyDown={(event) => captureShortcut(event, 'canvasFind')}
              onChange={(event) => updateShortcutDraft('canvasFind', event.target.value)}
              aria-invalid={errors.canvasFind ? 'true' : undefined}
              aria-describedby={errors.canvasFind ? 'settings-shortcut-find-error' : undefined}
            />
            {errors.canvasFind ? <small id="settings-shortcut-find-error">{t(errors.canvasFind)}</small> : null}
          </label>
        </div>

        <div className="general-settings__actions">
          {actionError ? <span className="general-settings__error">{actionError}</span> : null}
          <button type="button" className="primary-button" disabled={saving || !isDirty} onClick={() => void saveShortcuts()}>
            {saving ? t('saveState.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </section>
  )
}

function AiSettingsPanel(): JSX.Element {
  return <EmptySettingsPanel id="ai" titleKey="settings.ai" messageKey="settings.aiEmpty" />
}

const SETTINGS_SECTIONS = [
  {
    id: 'general',
    titleKey: 'settings.general',
    icon: SlidersHorizontal,
    Panel: GeneralSettingsPanel
  },
  {
    id: 'ai',
    titleKey: 'settings.ai',
    icon: Bot,
    Panel: AiSettingsPanel
  },
  {
    id: 'plugins',
    titleKey: 'plugin.plugins',
    icon: Puzzle,
    Panel: PluginSettingsPanel
  }
] as const satisfies readonly SettingsSectionDefinition[]

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

const DEFAULT_SETTINGS_SECTION_ID: SettingsSectionId = 'general'

function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && SETTINGS_SECTIONS.some((section) => section.id === value)
}

export function SettingsDialog(): JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION_ID)
  const activeSection = useMemo(
    () => SETTINGS_SECTIONS.find((section) => section.id === activeSectionId) ?? SETTINGS_SECTIONS[0],
    [activeSectionId]
  )

  useEffect(
    () =>
      window.atlas?.app?.onOpenSettings?.((request) => {
        if (isSettingsSectionId(request?.sectionId)) setActiveSectionId(request.sectionId)
        setOpen(true)
      }),
    []
  )

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="tool-button">
          <Settings size={16} />
          <span>{t('settings.open')}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content settings-dialog">
          <div className="settings-dialog__header">
            <div>
              <Dialog.Title className="dialog-title">{t('settings.open')}</Dialog.Title>
              <Dialog.Description className="sr-only">{t('settings.configure')}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label={t('settings.closeSettings')}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="settings-dialog__layout">
            <nav className="settings-dialog__sidebar" aria-label={t('settings.sections')}>
              {SETTINGS_SECTIONS.map((section) => {
                const Icon = section.icon
                const selected = activeSection.id === section.id

                return (
                  <button
                    key={section.id}
                    type="button"
                    className={['settings-dialog__section-button', selected ? 'settings-dialog__section-button--active' : '']
                      .filter(Boolean)
                      .join(' ')}
                    aria-current={selected ? 'page' : undefined}
                    onClick={() => setActiveSectionId(section.id)}
                  >
                    <Icon size={16} />
                    <span>{t(section.titleKey)}</span>
                  </button>
                )
              })}
            </nav>

            <main className="settings-dialog__content">
              {SETTINGS_SECTIONS.map((section) => {
                const Panel = section.Panel
                const selected = activeSection.id === section.id

                return (
                  <div key={section.id} className="settings-dialog__panel" hidden={!selected}>
                    <Panel active={open && selected} />
                  </div>
                )
              })}
            </main>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
