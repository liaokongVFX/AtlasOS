import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { BellRing, Bot, Check, ChevronDown, Puzzle, Settings, SlidersHorizontal, Upload, X, type LucideIcon } from 'lucide-react'
import { DEFAULT_APP_SHORTCUTS } from '@shared/constants'
import type { PetRuntimeState, PetSettings } from '@shared/pet'
import { localAssetUrl } from '@shared/local-assets'
import {
  formatKeyboardShortcut,
  keyboardShortcutFromEvent,
  normalizeKeyboardShortcut
} from '@shared/keyboard-shortcuts'
import type { AppShortcutSettings } from '@shared/schema'
import { LOCALES, useI18n, type I18nKey, type Locale } from '../i18n'
import { cn } from '../lib/utils'
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

type PetSettingsPatch = Partial<Omit<PetSettings, 'kanban' | 'agentBridge' | 'assetPack' | 'actionMap'>> & {
  kanban?: Partial<PetSettings['kanban']>
  agentBridge?: Partial<PetSettings['agentBridge']>
  assetPack?: Partial<PetSettings['assetPack']>
  actionMap?: Partial<PetSettings['actionMap']>
}

const PET_ACTION_OPTIONS = [
  { value: 'none', labelKey: 'settings.petActionNone' },
  { value: 'float', labelKey: 'settings.petActionFloat' },
  { value: 'pulse', labelKey: 'settings.petActionPulse' },
  { value: 'bounce', labelKey: 'settings.petActionBounce' },
  { value: 'shake', labelKey: 'settings.petActionShake' }
] as const satisfies readonly { value: PetSettings['actionMap']['idle']; labelKey: I18nKey }[]

type PetAction = PetSettings['actionMap']['idle']

function petMediaKind(path: string): PetSettings['assetPack']['idleKind'] {
  return /\.webm$/i.test(path) ? 'video' : 'image'
}

function petAssetName(src: string, fallback: string): string {
  if (!src) return fallback

  try {
    const path = new URL(src).searchParams.get('path') ?? src
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? src
  } catch {
    return src
  }
}

function PetAssetImportControl({
  disabled = false,
  label,
  onImport
}: {
  disabled?: boolean
  label: string
  onImport: (files: FileList | null) => void
}): JSX.Element {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="settings-pet-file-control">
      <input
        ref={inputRef}
        className="settings-pet-file-input"
        type="file"
        accept="image/png,image/gif,image/webp,video/webm,.png,.gif,.webp,.webm"
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          onImport(event.currentTarget.files)
          event.currentTarget.value = ''
        }}
      />
      <button
        type="button"
        className="settings-pet-file-button"
        disabled={disabled}
        aria-label={`${label} ${t('common.browse')}`}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={14} aria-hidden="true" />
        <span>{t('common.browse')}</span>
      </button>
    </div>
  )
}

function PetActionPicker({
  disabled = false,
  label,
  onChange,
  value
}: {
  disabled?: boolean
  label: string
  onChange: (action: PetAction) => void
  value: PetAction
}): JSX.Element {
  const { t } = useI18n()
  const selectedOption = PET_ACTION_OPTIONS.find((option) => option.value === value) ?? PET_ACTION_OPTIONS[0]

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button type="button" className="settings-pet-action-trigger" disabled={disabled} aria-label={label}>
          <span>{t(selectedOption.labelKey)}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu-content settings-pet-action-menu" align="end" collisionPadding={12}>
          <DropdownMenu.RadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as PetAction)}>
            {PET_ACTION_OPTIONS.map((option) => {
              const selected = option.value === value

              return (
                <DropdownMenu.RadioItem
                  key={option.value}
                  value={option.value}
                  className={cn('menu-item settings-pet-action-option', selected && 'settings-pet-action-option--selected')}
                >
                  <span className="settings-pet-action-option__check" aria-hidden="true">
                    {selected ? <Check size={13} /> : null}
                  </span>
                  <span>{t(option.labelKey)}</span>
                </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
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

const SHORTCUT_FIELDS = [
  { key: 'canvasDeselect', labelKey: 'settings.shortcutDeselectNodes' },
  { key: 'canvasFind', labelKey: 'settings.shortcutFindNodes' },
  { key: 'canvasCreateComponent', labelKey: 'settings.shortcutCreateComponent' }
] as const satisfies readonly { key: keyof AppShortcutSettings; labelKey: I18nKey }[]

function validateShortcutDraft(draft: AppShortcutSettings): { errors: ShortcutErrors; shortcuts: AppShortcutSettings | null } {
  const errors: ShortcutErrors = {}
  const shortcuts: Partial<AppShortcutSettings> = {}
  const usedShortcuts = new Set<string>()

  for (const field of SHORTCUT_FIELDS) {
    const shortcut = normalizeKeyboardShortcut(draft[field.key])
    if (!shortcut) {
      errors[field.key] = 'settings.shortcutInvalid'
      continue
    }

    if (usedShortcuts.has(shortcut)) {
      errors[field.key] = 'settings.shortcutAlreadyUsed'
      continue
    }

    usedShortcuts.add(shortcut)
    shortcuts[field.key] = shortcut
  }

  if (Object.keys(errors).length > 0) {
    return { errors, shortcuts: null }
  }

  return {
    errors,
    shortcuts: shortcuts as AppShortcutSettings
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

  const isDirty = SHORTCUT_FIELDS.some((field) => draft[field.key] !== settings.shortcuts[field.key])

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
          {SHORTCUT_FIELDS.map((field) => {
            const error = errors[field.key]
            const errorId = `settings-shortcut-${field.key}-error`

            return (
              <label key={field.key} className="general-settings__field">
                <span>{t(field.labelKey)}</span>
                <input
                  type="text"
                  value={draft[field.key]}
                  onKeyDown={(event) => captureShortcut(event, field.key)}
                  onChange={(event) => updateShortcutDraft(field.key, event.target.value)}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? errorId : undefined}
                />
                {error ? <small id={errorId}>{t(error)}</small> : null}
              </label>
            )
          })}
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

function PetSettingsPanel({ active }: SettingsSectionPanelProps): JSX.Element {
  const { t } = useI18n()
  const [runtimeState, setRuntimeState] = useState<PetRuntimeState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return undefined

    void window.atlas.pet.getState().then(setRuntimeState).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    })

    return window.atlas.pet.onStateUpdated(setRuntimeState)
  }, [active])

  const updatePetSettings = async (patch: PetSettingsPatch): Promise<void> => {
    if (!runtimeState) return

    setSaving(true)
    setError(null)

    try {
      const saved = await window.atlas.pet.updateSettings({
        ...runtimeState.settings,
        ...patch,
        kanban: { ...runtimeState.settings.kanban, ...patch.kanban },
        agentBridge: { ...runtimeState.settings.agentBridge, ...patch.agentBridge },
        assetPack: { ...runtimeState.settings.assetPack, ...patch.assetPack },
        actionMap: { ...runtimeState.settings.actionMap, ...patch.actionMap }
      })
      setRuntimeState((current) => (current ? { ...current, settings: saved } : current))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSaving(false)
    }
  }

  const hookSnippet = runtimeState
    ? [
        `POST http://127.0.0.1:${runtimeState.bridge.port}/agent-event`,
        `x-atlas-pet-token: ${runtimeState.bridge.token}`,
        '{"source":"codex","event":"waiting_for_confirmation","title":"Codex needs approval"}'
      ].join('\n')
    : ''

  const importPetAsset = async (slot: 'idle' | 'attention', files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (!file) return

    const path = window.atlas.filesystem.getPathForFile(file)
    if (!path) {
      setError(t('settings.petFilePathError'))
      return
    }

    const patch: Partial<PetSettings['assetPack']> = {
      id: 'custom-local',
      name: file.name || t('settings.petCustomAssetName')
    }
    const src = localAssetUrl(path, path)
    if (slot === 'idle') {
      patch.idleSrc = src
      patch.idleKind = petMediaKind(file.name || path)
    } else {
      patch.attentionSrc = src
      patch.attentionKind = petMediaKind(file.name || path)
    }

    await updatePetSettings({ assetPack: patch })
  }

  return (
    <section className="settings-panel general-settings" aria-labelledby="settings-pet-title">
      <div className="settings-panel__header">
        <h2 id="settings-pet-title">{t('settings.pet')}</h2>
        <p>{t('settings.petDescription')}</p>
      </div>

      <div className="general-settings__section">
        <label className="settings-toggle-row">
          <span>
            <strong>{t('settings.petEnableWindow')}</strong>
            <small>{t('settings.petEnableWindowDescription')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState?.settings.enabled ?? false}
            disabled={!runtimeState || saving}
            onChange={(event) => void updatePetSettings({ enabled: event.target.checked })}
          />
        </label>
        <label className="settings-toggle-row">
          <span>
            <strong>{t('settings.petNativeNotifications')}</strong>
            <small>{t('settings.petNativeNotificationsDescription')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState?.settings.showNativeNotifications ?? false}
            disabled={!runtimeState || saving}
            onChange={(event) => void updatePetSettings({ showNativeNotifications: event.target.checked })}
          />
        </label>
        <label className="settings-toggle-row">
          <span>
            <strong>{t('settings.petRunningAgents')}</strong>
            <small>{t('settings.petRunningAgentsDescription')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState?.settings.showRunningAgents ?? false}
            disabled={!runtimeState || saving}
            onChange={(event) => void updatePetSettings({ showRunningAgents: event.target.checked })}
          />
        </label>
      </div>

      <div className="general-settings__section">
        <div className="general-settings__section-header">
          <h3>{t('settings.petHookBridge')}</h3>
          <p>{t('settings.petHookBridgeDescription')}</p>
        </div>
        <pre className="settings-code-block">{hookSnippet || t('settings.petHookBridgeUnavailable')}</pre>
      </div>

      <div className="general-settings__section">
        <div className="general-settings__section-header">
          <h3>{t('settings.petAssetPack')}</h3>
          <p>{t('settings.petAssetPackDescription')}</p>
        </div>
        <div className="settings-pet-assets">
          <div className="settings-pet-asset-row">
            <span>
              <strong>{t('settings.petIdleAsset')}</strong>
              <small>{petAssetName(runtimeState?.settings.assetPack.idleSrc ?? '', t('settings.petDefaultAssetName'))}</small>
            </span>
            <PetAssetImportControl
              label={t('settings.petIdleAsset')}
              disabled={!runtimeState || saving}
              onImport={(files) => void importPetAsset('idle', files)}
            />
          </div>
          <div className="settings-pet-asset-row">
            <span>
              <strong>{t('settings.petAttentionAsset')}</strong>
              <small>{petAssetName(runtimeState?.settings.assetPack.attentionSrc ?? '', t('settings.petDefaultAssetName'))}</small>
            </span>
            <PetAssetImportControl
              label={t('settings.petAttentionAsset')}
              disabled={!runtimeState || saving}
              onImport={(files) => void importPetAsset('attention', files)}
            />
          </div>
        </div>
      </div>

      <div className="general-settings__section">
        <div className="general-settings__section-header">
          <h3>{t('settings.petActionMapping')}</h3>
          <p>{t('settings.petActionMappingDescription')}</p>
        </div>
        <div className="settings-pet-assets">
          <div className="settings-pet-action-row">
            <span>
              <strong>{t('settings.petIdleMotion')}</strong>
              <small>{t('settings.petIdleMotionDescription')}</small>
            </span>
            <PetActionPicker
              label={t('settings.petIdleMotion')}
              value={runtimeState?.settings.actionMap.idle ?? 'float'}
              disabled={!runtimeState || saving}
              onChange={(action) => void updatePetSettings({ actionMap: { idle: action } })}
            />
          </div>
          <div className="settings-pet-action-row">
            <span>
              <strong>{t('settings.petAttentionMotion')}</strong>
              <small>{t('settings.petAttentionMotionDescription')}</small>
            </span>
            <PetActionPicker
              label={t('settings.petAttentionMotion')}
              value={runtimeState?.settings.actionMap.attention ?? 'pulse'}
              disabled={!runtimeState || saving}
              onChange={(action) => void updatePetSettings({ actionMap: { attention: action } })}
            />
          </div>
        </div>
      </div>

      {error ? <span className="general-settings__error">{error}</span> : null}
    </section>
  )
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
    id: 'pet',
    titleKey: 'settings.pet',
    icon: BellRing,
    Panel: PetSettingsPanel
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

type SettingsDialogProps = {
  showTrigger?: boolean
}

function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && SETTINGS_SECTIONS.some((section) => section.id === value)
}

export function SettingsDialog({ showTrigger = true }: SettingsDialogProps): JSX.Element {
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
      {showTrigger ? (
        <Dialog.Trigger asChild>
          <button type="button" className="tool-button">
            <Settings size={16} />
            <span>{t('settings.open')}</span>
          </button>
        </Dialog.Trigger>
      ) : null}
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
