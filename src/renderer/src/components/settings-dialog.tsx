import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { BellRing, Bot, Check, ChevronDown, Grid2X2, Puzzle, RefreshCcw, Settings, SlidersHorizontal, TerminalSquare, Trash2, Upload, X, type LucideIcon } from 'lucide-react'
import { DEFAULT_APP_SHORTCUTS } from '@shared/constants'
import { DEFAULT_PET_SPRITE_ANIMATION, petSettingsSchema, type PetRuntimeState, type PetSettings } from '@shared/pet'
import { localAssetUrl } from '@shared/local-assets'
import type { AtlasUpdateState } from '@shared/updates'
import {
  formatKeyboardShortcut,
  keyboardShortcutFromEvent,
  normalizeKeyboardShortcut
} from '@shared/keyboard-shortcuts'
import type { AppShortcutSettings } from '@shared/schema'
import { LOCALES, useI18n, type I18nKey, type Locale, type TFunction } from '../i18n'
import { cn } from '../lib/utils'
import { useAppSettingsStore } from '../store/app-settings-store'
import { AiSettingsPanel } from './ai-settings-panel'
import { ApplicationsSettingsPanel } from './applications-settings-panel'
import { PluginSettingsPanel } from './plugin-settings-panel'
import { TerminalCommandLibraryManager } from './terminal-command-library-manager'
import { TerminalEnvironmentEditor } from './terminal-environment-editor'

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

type PetAlertSoundPatch = Partial<PetSettings['alertSound']> & {
  src?: string
  name?: string
}

type PetSettingsPatch = Partial<Omit<PetSettings, 'kanban' | 'alertSound' | 'agentBridge' | 'assetPack' | 'actionMap'>> & {
  kanban?: Partial<PetSettings['kanban']>
  alertSound?: PetAlertSoundPatch
  agentBridge?: Partial<PetSettings['agentBridge']>
  assetPack?: Partial<PetSettings['assetPack']>
  actionMap?: Partial<PetSettings['actionMap']>
}

type PetHookInstallStatus = PetRuntimeState['bridge']['claudeHook']
type PetHookProvider = 'claude' | 'codex'
type PetAssetSlot = 'idle' | 'running' | 'attention'
type PetImportedAssetKind = 'media' | 'sprite'
type PetAlertSoundSlot = 'asking' | 'completion'

const PET_ACTION_OPTIONS = [
  { value: 'none', labelKey: 'settings.petActionNone' },
  { value: 'float', labelKey: 'settings.petActionFloat' },
  { value: 'pulse', labelKey: 'settings.petActionPulse' },
  { value: 'bounce', labelKey: 'settings.petActionBounce' },
  { value: 'shake', labelKey: 'settings.petActionShake' }
] as const satisfies readonly { value: PetSettings['actionMap']['idle']; labelKey: I18nKey }[]

type PetAction = PetSettings['actionMap']['idle']
const PET_ALERT_SOUND_ACCEPT = 'audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/flac,audio/ogg,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga'

function petMediaKind(path: string): Exclude<PetSettings['assetPack']['idleKind'], 'sprite'> {
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

function petAssetLabel(src: string, kind: PetSettings['assetPack']['idleKind'], fallback: string, spriteLabel: string): string {
  const name = petAssetName(src, fallback)
  return kind === 'sprite' ? `${name} - ${spriteLabel}` : name
}

function hasPetAlertSound(alertSound: PetSettings['alertSound'] | undefined): boolean {
  return Boolean(alertSound?.askingSrc || alertSound?.completionSrc)
}

function withLegacyPetAlertSoundFields(alertSound: PetSettings['alertSound']): PetSettings['alertSound'] & { src: string; name: string } {
  const src = alertSound.completionSrc || alertSound.askingSrc
  const name = alertSound.completionSrc ? alertSound.completionName : alertSound.askingName
  return { ...alertSound, src, name }
}

function normalizePetRuntimeState(state: PetRuntimeState): PetRuntimeState {
  return {
    ...state,
    settings: petSettingsSchema.parse(state.settings)
  }
}

function boundedNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max)
}

function PetAssetImportControl({
  accept = 'image/png,image/gif,image/webp,video/webm,.png,.gif,.webp,.webm',
  buttonLabel,
  disabled = false,
  label,
  onImport
}: {
  accept?: string
  buttonLabel: string
  disabled?: boolean
  label: string
  onImport: (files: FileList | null) => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="settings-pet-file-control">
      <input
        ref={inputRef}
        className="settings-pet-file-input"
        type="file"
        accept={accept}
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
        aria-label={`${label} ${buttonLabel}`}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={14} aria-hidden="true" />
        <span>{buttonLabel}</span>
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

function PetSpriteFields({
  disabled = false,
  fps,
  frameCount,
  onChange
}: {
  disabled?: boolean
  fps: number
  frameCount: number
  onChange: (patch: Partial<PetSettings['assetPack']['idleSprite']>) => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <span className="settings-pet-sprite-fields">
      <label>
        <span>{t('settings.petSpriteFrameCount')}</span>
        <input
          type="number"
          min={1}
          max={64}
          value={frameCount}
          disabled={disabled}
          onChange={(event) => {
            if (!Number.isFinite(event.currentTarget.valueAsNumber)) return
            onChange({ frameCount: boundedNumber(event.currentTarget.valueAsNumber, 1, 64) })
          }}
        />
      </label>
      <label>
        <span>{t('settings.petSpriteFps')}</span>
        <input
          type="number"
          min={1}
          max={30}
          value={fps}
          disabled={disabled}
          onChange={(event) => {
            if (!Number.isFinite(event.currentTarget.valueAsNumber)) return
            onChange({ fps: boundedNumber(event.currentTarget.valueAsNumber, 1, 30) })
          }}
        />
      </label>
    </span>
  )
}

function PetHookStatusRow({
  disabled = false,
  installing = false,
  installLabelKey,
  installedLabelKey,
  missingLabelKey,
  onInstall,
  repairLabelKey,
  status
}: {
  disabled?: boolean
  installing?: boolean
  installLabelKey: I18nKey
  installedLabelKey: I18nKey
  missingLabelKey: I18nKey
  onInstall: () => void
  repairLabelKey: I18nKey
  status: PetHookInstallStatus
}): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="settings-pet-hook-row">
      <span>
        <strong>{status.installed ? t(installedLabelKey) : t(missingLabelKey)}</strong>
        <small>{status.issue || `${t('settings.petHookPath')} ${status.settingsPath}`}</small>
      </span>
      <button type="button" className="settings-pet-file-button" disabled={disabled || installing} onClick={onInstall}>
        {installing ? t('saveState.saving') : status.installed ? t(repairLabelKey) : t(installLabelKey)}
      </button>
    </div>
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
const SHORTCUT_DESCRIPTION_ID = 'settings-shortcuts-description'

const SHORTCUT_FIELDS = [
  { key: 'canvasDeselect', labelKey: 'settings.shortcutDeselectNodes' },
  { key: 'canvasFind', labelKey: 'settings.shortcutFindNodes' },
  { key: 'canvasCreateComponent', labelKey: 'settings.shortcutCreateComponent' },
  { key: 'canvasGroupSelection', labelKey: 'settings.shortcutGroupSelection' },
  { key: 'canvasUngroupSelection', labelKey: 'settings.shortcutUngroupSelection' }
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

function updateStatusLabel(t: TFunction, state: AtlasUpdateState | null): string {
  if (!state) return t('saveState.idle')

  switch (state.status) {
    case 'available':
      return t('update.availableTitle')
    case 'checking':
      return t('update.checkingTitle')
    case 'downloaded':
      return t('update.downloadedTitle')
    case 'downloading':
      return t('update.downloadingTitle')
    case 'error':
      return `${t('update.errorTitle')}: ${state.error ?? t('update.errorBody')}`
    case 'not-available':
      return t('update.upToDate')
    default:
      return t('saveState.idle')
  }
}

function formatUpdateTime(value: string | undefined, locale: Locale): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function GeneralSettingsPanel({ active }: SettingsSectionPanelProps): JSX.Element {
  const { locale, setLocale, t } = useI18n()
  const settings = useAppSettingsStore((state) => state.settings)
  const isLoaded = useAppSettingsStore((state) => state.isLoaded)
  const loadSettings = useAppSettingsStore((state) => state.load)
  const patchSettings = useAppSettingsStore((state) => state.patch)
  const [draft, setDraft] = useState<AppShortcutSettings>(() => ({ ...DEFAULT_APP_SHORTCUTS }))
  const [errors, setErrors] = useState<ShortcutErrors>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<AtlasUpdateState | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
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

  useEffect(() => {
    if (!active) return undefined

    void window.atlas.updates.getState().then(setUpdateState).catch((error) => {
      setActionError(error instanceof Error ? error.message : String(error))
    })

    return window.atlas.updates.onStateUpdated(setUpdateState)
  }, [active])

  const updateShortcutDraft = (key: keyof AppShortcutSettings, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setActionError(null)
  }

  const captureShortcut = (event: ReactKeyboardEvent<HTMLInputElement>, key: keyof AppShortcutSettings): void => {
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      event.currentTarget.blur()
      return
    }

    if (event.nativeEvent.isComposing) return

    const shortcut = keyboardShortcutFromEvent(event.nativeEvent)
    if (!shortcut) return

    updateShortcutDraft(key, formatKeyboardShortcut(shortcut))
    event.currentTarget.select()
  }

  const saveShortcuts = async (): Promise<void> => {
    const validation = validateShortcutDraft(draft)
    setErrors(validation.errors)
    if (!validation.shortcuts) return

    setSaving(true)
    setActionError(null)

    try {
      const saved = await patchSettings({
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
      await patchSettings({
        locale: nextLocale
      })
    } catch (error) {
      setLocale(settings.locale)
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const setAutoCheckUpdates = async (autoCheck: boolean): Promise<void> => {
    setSaving(true)
    setActionError(null)

    try {
      await patchSettings({
        updates: {
          ...settings.updates,
          autoCheck
        }
      })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const checkForUpdates = async (): Promise<void> => {
    setCheckingUpdates(true)
    setActionError(null)

    try {
      setUpdateState(await window.atlas.updates.check())
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setCheckingUpdates(false)
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

      <div className="general-settings__section" aria-labelledby="settings-updates-title">
        <div className="general-settings__section-header">
          <h3 id="settings-updates-title">{t('settings.updates')}</h3>
          <p>{t('settings.updateAutoCheckDescription')}</p>
        </div>
        <label className="settings-toggle-row">
          <span>
            <strong>{t('settings.updateAutoCheck')}</strong>
            <small>{t('settings.updateAutoCheckDescription')}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.updates.autoCheck}
            disabled={saving}
            onChange={(event) => void setAutoCheckUpdates(event.target.checked)}
          />
        </label>
        <div className="settings-update-summary">
          <span>
            <strong>{t('settings.updateCurrentVersion')}</strong>
            <small>{updateState?.currentVersion ?? '-'}</small>
          </span>
          <span>
            <strong>{t('settings.updateStatus')}</strong>
            <small>{updateStatusLabel(t, updateState)}</small>
          </span>
          <span>
            <strong>{t('settings.updateLastChecked')}</strong>
            <small>{formatUpdateTime(updateState?.lastCheckedAt, locale) || t('settings.updateNeverChecked')}</small>
          </span>
          <button type="button" className="settings-update-check-button" disabled={checkingUpdates} onClick={() => void checkForUpdates()}>
            <RefreshCcw size={14} aria-hidden="true" />
            <span>{checkingUpdates ? t('update.checkingTitle') : t('settings.updateCheckNow')}</span>
          </button>
        </div>
      </div>

      <div className="general-settings__section" aria-labelledby="settings-shortcuts-title">
        <div className="general-settings__section-header">
          <h3 id="settings-shortcuts-title">{t('settings.keyboardShortcuts')}</h3>
          <p id={SHORTCUT_DESCRIPTION_ID}>{t('settings.shortcutCaptureDescription')}</p>
        </div>
        <div className="general-settings__fields">
          {SHORTCUT_FIELDS.map((field) => {
            const error = errors[field.key]
            const errorId = `settings-shortcut-${field.key}-error`
            const describedBy = [SHORTCUT_DESCRIPTION_ID, error ? errorId : null].filter(Boolean).join(' ')

            return (
              <label key={field.key} className="general-settings__field">
                <span>{t(field.labelKey)}</span>
                <input
                  type="text"
                  className="general-settings__shortcut-input"
                  value={draft[field.key]}
                  readOnly
                  inputMode="none"
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDownCapture={(event) => captureShortcut(event, field.key)}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={describedBy}
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

function TerminalCommandsSettingsPanel(): JSX.Element {
  const { t } = useI18n()

  return (
    <section className="settings-panel terminal-commands-settings" aria-labelledby="settings-terminal-commands-title">
      <div className="settings-panel__header">
        <h2 id="settings-terminal-commands-title">{t('settings.terminalCommands')}</h2>
        <p>{t('settings.terminalCommandsDescription')}</p>
      </div>
      <TerminalCommandLibraryManager className="terminal-command-library--settings" />
    </section>
  )
}

function TerminalEnvironmentSettingsPanel({ active }: SettingsSectionPanelProps): JSX.Element {
  const { t } = useI18n()
  const settings = useAppSettingsStore((state) => state.settings)
  const isLoaded = useAppSettingsStore((state) => state.isLoaded)
  const loadSettings = useAppSettingsStore((state) => state.load)
  const patchSettings = useAppSettingsStore((state) => state.patch)

  useEffect(() => {
    if (active && !isLoaded) void loadSettings()
  }, [active, isLoaded, loadSettings])

  return (
    <section className="settings-panel terminal-environment-settings" aria-labelledby="settings-terminal-environment-title">
      <div className="settings-panel__header">
        <h2 id="settings-terminal-environment-title">{t('settings.terminalEnvironment')}</h2>
        <p>{t('settings.terminalEnvironmentDescription')}</p>
      </div>
      <TerminalEnvironmentEditor
        initialEnvironment={settings.terminalEnvironment}
        onSave={async ({ environment }) => {
          await patchSettings({ terminalEnvironment: environment })
        }}
      />
    </section>
  )
}

function PetSettingsPanel({ active }: SettingsSectionPanelProps): JSX.Element {
  const { t } = useI18n()
  const [runtimeState, setRuntimeState] = useState<PetRuntimeState | null>(null)
  const [saving, setSaving] = useState(false)
  const [installingHook, setInstallingHook] = useState<PetHookProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return undefined

    void window.atlas.pet.getState().then((state) => setRuntimeState(normalizePetRuntimeState(state))).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    })

    return window.atlas.pet.onStateUpdated((state) => setRuntimeState(normalizePetRuntimeState(state)))
  }, [active])

  const updatePetSettings = async (patch: PetSettingsPatch): Promise<void> => {
    if (!runtimeState) return

    setSaving(true)
    setError(null)

    try {
      const nextAlertSound = { ...runtimeState.settings.alertSound, ...patch.alertSound }
      const nextSettings = {
        ...runtimeState.settings,
        ...patch,
        kanban: { ...runtimeState.settings.kanban, ...patch.kanban },
        alertSound: patch.alertSound ? withLegacyPetAlertSoundFields(nextAlertSound) : nextAlertSound,
        agentBridge: { ...runtimeState.settings.agentBridge, ...patch.agentBridge },
        assetPack: { ...runtimeState.settings.assetPack, ...patch.assetPack },
        actionMap: { ...runtimeState.settings.actionMap, ...patch.actionMap }
      }
      const saved = petSettingsSchema.parse(await window.atlas.pet.updateSettings(nextSettings))
      setRuntimeState((current) => (current ? { ...current, settings: saved } : current))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSaving(false)
    }
  }

  const installProviderHooks = async (provider: PetHookProvider): Promise<void> => {
    setInstallingHook(provider)
    setError(null)

    try {
      if (provider === 'claude') {
        const claudeHook = await window.atlas.pet.installClaudeHooks()
        setRuntimeState((current) => (current ? { ...current, bridge: { ...current.bridge, claudeHook } } : current))
      } else {
        const codexHook = await window.atlas.pet.installCodexHooks()
        setRuntimeState((current) => (current ? { ...current, bridge: { ...current.bridge, codexHook } } : current))
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setInstallingHook(null)
    }
  }

  const claudeHook = runtimeState?.bridge.claudeHook
  const codexHook = runtimeState?.bridge.codexHook

  const importPetAsset = async (slot: PetAssetSlot, kind: PetImportedAssetKind, files: FileList | null): Promise<void> => {
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
      patch.idleKind = kind === 'sprite' ? 'sprite' : petMediaKind(file.name || path)
      if (kind === 'sprite') patch.idleSprite = DEFAULT_PET_SPRITE_ANIMATION
    } else if (slot === 'running') {
      patch.runningSrc = src
      patch.runningKind = kind === 'sprite' ? 'sprite' : petMediaKind(file.name || path)
      if (kind === 'sprite') patch.runningSprite = DEFAULT_PET_SPRITE_ANIMATION
    } else {
      patch.attentionSrc = src
      patch.attentionKind = kind === 'sprite' ? 'sprite' : petMediaKind(file.name || path)
      if (kind === 'sprite') patch.attentionSprite = DEFAULT_PET_SPRITE_ANIMATION
    }

    await updatePetSettings({ assetPack: patch })
  }

  const importPetAlertSound = async (slot: PetAlertSoundSlot, files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (!file) return

    const path = window.atlas.filesystem.getPathForFile(file)
    if (!path) {
      setError(t('settings.petFilePathError'))
      return
    }

    const src = localAssetUrl(path, path)
    const name = file.name || petAssetName(path, t('settings.petReminderSoundCustomName'))
    const patch: PetAlertSoundPatch =
      slot === 'asking'
        ? { enabled: true, askingSrc: src, askingName: name }
        : { enabled: true, completionSrc: src, completionName: name }

    await updatePetSettings({ alertSound: patch })
  }

  const clearPetAlertSound = (slot: PetAlertSoundSlot): void => {
    if (!runtimeState) return

    const otherSrc = slot === 'asking' ? runtimeState.settings.alertSound.completionSrc : runtimeState.settings.alertSound.askingSrc
    const otherName = slot === 'asking' ? runtimeState.settings.alertSound.completionName : runtimeState.settings.alertSound.askingName
    void updatePetSettings({
      alertSound:
        slot === 'asking'
          ? { enabled: otherSrc ? runtimeState.settings.alertSound.enabled : false, askingSrc: '', askingName: '' }
          : { enabled: otherSrc ? runtimeState.settings.alertSound.enabled : false, completionSrc: '', completionName: '' }
    })
  }

  const clearPetAsset = (slot: PetAssetSlot): void => {
    const patch: Partial<PetSettings['assetPack']> =
      slot === 'idle'
        ? { idleSrc: '', idleKind: 'image', idleSprite: DEFAULT_PET_SPRITE_ANIMATION }
        : slot === 'running'
          ? { runningSrc: '', runningKind: 'image', runningSprite: DEFAULT_PET_SPRITE_ANIMATION }
          : { attentionSrc: '', attentionKind: 'image', attentionSprite: DEFAULT_PET_SPRITE_ANIMATION }

    void updatePetSettings({ assetPack: patch })
  }

  const updateSpriteSettings = (slot: PetAssetSlot, patch: Partial<PetSettings['assetPack']['idleSprite']>): void => {
    if (!runtimeState) return

    if (slot === 'idle') {
      void updatePetSettings({
        assetPack: {
          idleSprite: { ...runtimeState.settings.assetPack.idleSprite, ...patch }
        }
      })
      return
    }

    if (slot === 'running') {
      void updatePetSettings({
        assetPack: {
          runningSprite: { ...runtimeState.settings.assetPack.runningSprite, ...patch }
        }
      })
      return
    }

    void updatePetSettings({
      assetPack: {
        attentionSprite: { ...runtimeState.settings.assetPack.attentionSprite, ...patch }
      }
    })
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
          <h3>{t('settings.petReminderSound')}</h3>
          <p>{t('settings.petReminderSoundDescription')}</p>
        </div>
        <div className="settings-pet-assets">
          <label className="settings-toggle-row">
            <span>
              <strong>{t('settings.petReminderSoundEnabled')}</strong>
              <small>{t('settings.petReminderSoundEnabledDescription')}</small>
            </span>
            <input
              type="checkbox"
              checked={runtimeState?.settings.alertSound.enabled ?? false}
              disabled={!runtimeState || saving || !hasPetAlertSound(runtimeState.settings.alertSound)}
              onChange={(event) => void updatePetSettings({ alertSound: { enabled: event.target.checked } })}
            />
          </label>
          <div className="settings-pet-action-row">
            <span>
              <strong>{t('settings.petReminderSoundAsking')}</strong>
              <small>
                {runtimeState?.settings.alertSound.askingName ||
                  petAssetName(
                    runtimeState?.settings.alertSound.askingSrc ?? '',
                    runtimeState?.settings.alertSound.completionSrc ? t('settings.petReminderSoundUsingCompletion') : t('settings.petReminderSoundNone')
                  )}
              </small>
            </span>
            <div className="settings-pet-import-actions">
              <PetAssetImportControl
                label={t('settings.petReminderSoundAsking')}
                buttonLabel={t('common.browse')}
                accept={PET_ALERT_SOUND_ACCEPT}
                disabled={!runtimeState || saving}
                onImport={(files) => void importPetAlertSound('asking', files)}
              />
              <button
                type="button"
                className="settings-pet-file-button"
                disabled={!runtimeState?.settings.alertSound.askingSrc || saving}
                aria-label={`${t('settings.petReminderSoundAsking')} ${t('settings.petClearAsset')}`}
                onClick={() => clearPetAlertSound('asking')}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{t('settings.petClearAsset')}</span>
              </button>
            </div>
          </div>
          <div className="settings-pet-action-row">
            <span>
              <strong>{t('settings.petReminderSoundCompletion')}</strong>
              <small>
                {runtimeState?.settings.alertSound.completionName ||
                  petAssetName(
                    runtimeState?.settings.alertSound.completionSrc ?? '',
                    runtimeState?.settings.alertSound.askingSrc ? t('settings.petReminderSoundUsingAsking') : t('settings.petReminderSoundNone')
                  )}
              </small>
            </span>
            <div className="settings-pet-import-actions">
              <PetAssetImportControl
                label={t('settings.petReminderSoundCompletion')}
                buttonLabel={t('common.browse')}
                accept={PET_ALERT_SOUND_ACCEPT}
                disabled={!runtimeState || saving}
                onImport={(files) => void importPetAlertSound('completion', files)}
              />
              <button
                type="button"
                className="settings-pet-file-button"
                disabled={!runtimeState?.settings.alertSound.completionSrc || saving}
                aria-label={`${t('settings.petReminderSoundCompletion')} ${t('settings.petClearAsset')}`}
                onClick={() => clearPetAlertSound('completion')}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{t('settings.petClearAsset')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="general-settings__section">
        <div className="general-settings__section-header">
          <h3>{t('settings.petHookBridge')}</h3>
          <p>{t('settings.petHookBridgeDescription')}</p>
        </div>
        {claudeHook ? (
          <PetHookStatusRow
            disabled={!runtimeState || saving}
            installing={installingHook === 'claude'}
            installLabelKey="settings.petClaudeHookInstall"
            installedLabelKey="settings.petClaudeHookInstalled"
            missingLabelKey="settings.petClaudeHookMissing"
            onInstall={() => void installProviderHooks('claude')}
            repairLabelKey="settings.petClaudeHookRepair"
            status={claudeHook}
          />
        ) : null}
        {codexHook ? (
          <PetHookStatusRow
            disabled={!runtimeState || saving}
            installing={installingHook === 'codex'}
            installLabelKey="settings.petCodexHookInstall"
            installedLabelKey="settings.petCodexHookInstalled"
            missingLabelKey="settings.petCodexHookMissing"
            onInstall={() => void installProviderHooks('codex')}
            repairLabelKey="settings.petCodexHookRepair"
            status={codexHook}
          />
        ) : null}
        {!claudeHook && !codexHook ? <p className="settings-muted">{t('settings.petHookBridgeUnavailable')}</p> : null}
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
              <small>
                {petAssetLabel(
                  runtimeState?.settings.assetPack.idleSrc ?? '',
                  runtimeState?.settings.assetPack.idleKind ?? 'image',
                  t('settings.petDefaultAssetName'),
                  t('settings.petSpriteSheet')
                )}
              </small>
              {runtimeState?.settings.assetPack.idleKind === 'sprite' ? (
                <PetSpriteFields
                  disabled={saving}
                  frameCount={runtimeState.settings.assetPack.idleSprite.frameCount}
                  fps={runtimeState.settings.assetPack.idleSprite.fps}
                  onChange={(patch) => updateSpriteSettings('idle', patch)}
                />
              ) : null}
            </span>
            <div className="settings-pet-import-actions">
              <PetAssetImportControl
                label={t('settings.petIdleAsset')}
                buttonLabel={t('common.browse')}
                disabled={!runtimeState || saving}
                onImport={(files) => void importPetAsset('idle', 'media', files)}
              />
              <PetAssetImportControl
                label={t('settings.petIdleAsset')}
                buttonLabel={t('settings.petSpriteBrowse')}
                accept="image/png,image/webp,.png,.webp"
                disabled={!runtimeState || saving}
                onImport={(files) => void importPetAsset('idle', 'sprite', files)}
              />
              <button
                type="button"
                className="settings-pet-file-button"
                disabled={!runtimeState?.settings.assetPack.idleSrc || saving}
                aria-label={`${t('settings.petIdleAsset')} ${t('settings.petClearAsset')}`}
                onClick={() => clearPetAsset('idle')}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{t('settings.petClearAsset')}</span>
              </button>
            </div>
          </div>
          <div className="settings-pet-asset-row">
            <span>
              <strong>{t('settings.petRunningAsset')}</strong>
              <small>
                {petAssetLabel(
                  runtimeState?.settings.assetPack.runningSrc ?? '',
                  runtimeState?.settings.assetPack.runningKind ?? 'image',
                  t('settings.petDefaultAssetName'),
                  t('settings.petSpriteSheet')
                )}
              </small>
              {runtimeState?.settings.assetPack.runningKind === 'sprite' ? (
                <PetSpriteFields
                  disabled={saving}
                  frameCount={runtimeState.settings.assetPack.runningSprite.frameCount}
                  fps={runtimeState.settings.assetPack.runningSprite.fps}
                  onChange={(patch) => updateSpriteSettings('running', patch)}
                />
              ) : null}
            </span>
            <div className="settings-pet-import-actions">
              <PetAssetImportControl
                label={t('settings.petRunningAsset')}
                buttonLabel={t('common.browse')}
                disabled={!runtimeState || saving}
                onImport={(files) => void importPetAsset('running', 'media', files)}
              />
              <PetAssetImportControl
                label={t('settings.petRunningAsset')}
                buttonLabel={t('settings.petSpriteBrowse')}
                accept="image/png,image/webp,.png,.webp"
                disabled={!runtimeState || saving}
                onImport={(files) => void importPetAsset('running', 'sprite', files)}
              />
              <button
                type="button"
                className="settings-pet-file-button"
                disabled={!runtimeState?.settings.assetPack.runningSrc || saving}
                aria-label={`${t('settings.petRunningAsset')} ${t('settings.petClearAsset')}`}
                onClick={() => clearPetAsset('running')}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{t('settings.petClearAsset')}</span>
              </button>
            </div>
          </div>
          <div className="settings-pet-asset-row">
            <span>
              <strong>{t('settings.petAttentionAsset')}</strong>
              <small>
                {petAssetLabel(
                  runtimeState?.settings.assetPack.attentionSrc ?? '',
                  runtimeState?.settings.assetPack.attentionKind ?? 'image',
                  t('settings.petDefaultAssetName'),
                  t('settings.petSpriteSheet')
                )}
              </small>
              {runtimeState?.settings.assetPack.attentionKind === 'sprite' ? (
                <PetSpriteFields
                  disabled={saving}
                  frameCount={runtimeState.settings.assetPack.attentionSprite.frameCount}
                  fps={runtimeState.settings.assetPack.attentionSprite.fps}
                  onChange={(patch) => updateSpriteSettings('attention', patch)}
                />
              ) : null}
            </span>
            <div className="settings-pet-import-actions">
              <PetAssetImportControl
                label={t('settings.petAttentionAsset')}
                buttonLabel={t('common.browse')}
                disabled={!runtimeState || saving}
                onImport={(files) => void importPetAsset('attention', 'media', files)}
              />
              <PetAssetImportControl
                label={t('settings.petAttentionAsset')}
                buttonLabel={t('settings.petSpriteBrowse')}
                accept="image/png,image/webp,.png,.webp"
                disabled={!runtimeState || saving}
                onImport={(files) => void importPetAsset('attention', 'sprite', files)}
              />
              <button
                type="button"
                className="settings-pet-file-button"
                disabled={!runtimeState?.settings.assetPack.attentionSrc || saving}
                aria-label={`${t('settings.petAttentionAsset')} ${t('settings.petClearAsset')}`}
                onClick={() => clearPetAsset('attention')}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{t('settings.petClearAsset')}</span>
              </button>
            </div>
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
              <strong>{t('settings.petRunningMotion')}</strong>
              <small>{t('settings.petRunningMotionDescription')}</small>
            </span>
            <PetActionPicker
              label={t('settings.petRunningMotion')}
              value={runtimeState?.settings.actionMap.running ?? 'bounce'}
              disabled={!runtimeState || saving}
              onChange={(action) => void updatePetSettings({ actionMap: { running: action } })}
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
    id: 'applications',
    titleKey: 'settings.applications',
    icon: Grid2X2,
    Panel: ApplicationsSettingsPanel
  },
  {
    id: 'terminal-commands',
    titleKey: 'settings.terminalCommands',
    icon: TerminalSquare,
    Panel: TerminalCommandsSettingsPanel
  },
  {
    id: 'terminal-environment',
    titleKey: 'settings.terminalEnvironment',
    icon: TerminalSquare,
    Panel: TerminalEnvironmentSettingsPanel
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
        <Dialog.Content className="dialog-content settings-dialog" onInteractOutside={(event) => event.preventDefault()}>
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
