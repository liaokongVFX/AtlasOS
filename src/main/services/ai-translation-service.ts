import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, clipboard, screen, shell } from 'electron'
import { z } from 'zod'
import {
  aiOpenTranslatorInputSchema,
  aiUpdateDailySummarySettingsInputSchema,
  aiProfileApiKeyInputSchema,
  aiProfileIdInputSchema,
  aiProfileSaveInputSchema,
  aiTranslateInputSchema,
  aiUpdateTranslationSettingsInputSchema
} from '@shared/ipc'
import {
  aiProfileDraftSchema,
  aiProfileSchema,
  aiDailySummarySettingsSchema,
  aiSettingsSchema,
  aiTranslationSettingsSchema,
  DEFAULT_AI_TARGET_LANGUAGE,
  firstAiProfileModel,
  isAiAutoTargetLanguage,
  type AiProfile,
  type AiDailySummarySettings,
  type AiSettings,
  type AiTranslationRequest,
  type AiTranslationSettings
} from '@shared/ai'
import { handleValidated } from './ipc-helpers'
import { AppSettingsService } from './app-settings-service'
import { AiKeyStore } from './ai-key-store'
import { captureWindowsSelectedText } from './windows-selection-capture'
import { startWindowsDoubleCtrlHook, type WindowsDoubleCtrlHookHandle } from './windows-double-ctrl-hook'

type AiTranslationServiceOptions = {
  appSettingsService: AppSettingsService
  getMainWindow: () => BrowserWindow | null
  loadTranslationRenderer: (targetWindow: BrowserWindow) => Promise<void>
  keyStore?: AiKeyStore
}

type TranslationApiResult = {
  text: string
}

type AiModelSelection = {
  profileId: string | null
  model: string | null
}

const TRANSLATION_WINDOW_WIDTH = 640
const TRANSLATION_WINDOW_HEIGHT = 440
const TRANSLATION_WINDOW_MARGIN = 16
const ANTHROPIC_VERSION = '2023-06-01'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/g, '')
}

function endpointUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function firstTextContent(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) return null
  if (typeof record.text === 'string') return record.text
  if (typeof record.content === 'string') return record.content
  return null
}

function parseOpenAiTranslation(value: unknown): string {
  const record = asRecord(value)
  const choices = Array.isArray(record?.choices) ? record.choices : []
  const firstChoice = asRecord(choices[0])
  const message = asRecord(firstChoice?.message)
  const content = typeof message?.content === 'string' ? message.content : null
  if (!content) throw new Error('OpenAI response did not include translated text')
  return content.trim()
}

function parseAnthropicTranslation(value: unknown): string {
  const record = asRecord(value)
  const content = Array.isArray(record?.content) ? record.content : []
  const text = content.map(firstTextContent).filter((part): part is string => Boolean(part)).join('')
  if (!text) throw new Error('Anthropic response did not include translated text')
  return text.trim()
}

function translationSystemPrompt(targetLanguage: string): string {
  if (isAiAutoTargetLanguage(targetLanguage)) {
    return [
      "Detect whether the user's text is primarily Chinese or English.",
      'If it is primarily Chinese, translate it into English.',
      'If it is primarily English, translate it into Simplified Chinese.',
      'For mixed Chinese and English text, translate the dominant source language into the other language while preserving names, code, URLs, and terms that should remain unchanged.',
      'Return only the translation.',
      'Preserve line breaks and formatting when useful.',
      'Do not add commentary, labels, or explanations.'
    ].join(' ')
  }

  return [
    `Translate the user's text into ${targetLanguage}.`,
    'Return only the translation.',
    'Preserve line breaks and formatting when useful.',
    'Do not add commentary, labels, or explanations.'
  ].join(' ')
}

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

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim().slice(0, 500)
  } catch {
    return ''
  }
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new Error(`AI request failed (${response.status}): ${body || response.statusText}`)
  }

  return response.json()
}

export class AiTranslationService {
  private readonly keyStore: AiKeyStore
  private translationWindow: BrowserWindow | null = null
  private activeRequest: AiTranslationRequest | null = null
  private systemHook: WindowsDoubleCtrlHookHandle | null = null
  private systemCaptureInFlight = false

  constructor(private readonly options: AiTranslationServiceOptions) {
    this.keyStore = options.keyStore ?? new AiKeyStore()
  }

  registerIpc(): void {
    handleValidated('ai:get-settings', z.object({}), () => this.getSettings())
    handleValidated('ai:save-profile', aiProfileSaveInputSchema, (_, input) => this.saveProfile(input.profile, input.apiKey))
    handleValidated('ai:delete-profile', aiProfileIdInputSchema, (_, input) => this.deleteProfile(input.profileId))
    handleValidated('ai:set-profile-api-key', aiProfileApiKeyInputSchema, (_, input) => this.setProfileApiKey(input.profileId, input.apiKey))
    handleValidated('ai:clear-profile-api-key', aiProfileIdInputSchema, (_, input) => this.clearProfileApiKey(input.profileId))
    handleValidated('ai:update-translation-settings', aiUpdateTranslationSettingsInputSchema, (_, input) =>
      this.updateTranslationSettings(input.patch)
    )
    handleValidated('ai:update-daily-summary-settings', aiUpdateDailySummarySettingsInputSchema, (_, input) =>
      this.updateDailySummarySettings(input.patch)
    )
    handleValidated('ai:open-translator', aiOpenTranslatorInputSchema, (_, input) => this.openTranslator(input.text, input.source))
    handleValidated('ai:translate', aiTranslateInputSchema, (_, input) => this.translate(input.text, input.profileId, input.model, input.targetLanguage))
    handleValidated('ai:get-active-translation-request', z.object({}), () => this.activeRequest)
    handleValidated('ai:close-translator', z.object({}), () => {
      this.closeTranslator()
      return { ok: true }
    })

    void this.refreshSystemHook()
  }

  dispose(): void {
    this.stopSystemHook()

    if (this.translationWindow && !this.translationWindow.isDestroyed()) {
      this.translationWindow.close()
    }
    this.translationWindow = null
  }

  async refreshSystemHook(): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (settings.ai.translation.systemDoubleCtrlEnabled && process.platform === 'win32') {
      if (!this.systemHook) {
        this.systemHook = startWindowsDoubleCtrlHook(() => {
          void this.handleSystemDoubleCtrl()
        })
      }
      return
    }

    this.stopSystemHook()
  }

  async getSettings(): Promise<AiSettings> {
    const settings = await this.options.appSettingsService.getSettings()
    return this.withKeyStatus(settings.ai)
  }

  async saveProfile(profileInput: unknown, apiKey?: string): Promise<AiSettings> {
    const draft = aiProfileDraftSchema.parse({
      ...(profileInput as Record<string, unknown>),
      baseUrl: normalizeBaseUrl((profileInput as { baseUrl?: string }).baseUrl ?? '')
    })

    if (apiKey?.trim()) await this.keyStore.setKey(draft.id, apiKey)

    return this.updateAiSettings(async (settings) => {
      const profile = aiProfileSchema.parse({
        ...draft,
        apiKeyConfigured: await this.keyStore.hasKey(draft.id)
      })
      const profiles = settings.profiles.some((candidate) => candidate.id === profile.id)
        ? settings.profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
        : [...settings.profiles, profile]
      const translation = reconcileModelSelection(
        settings.translation.profileId ? settings.translation : { ...settings.translation, ...modelSelection(profile) },
        profiles
      )
      const dailySummary = reconcileModelSelection(
        settings.dailySummary.profileId ? settings.dailySummary : { ...settings.dailySummary, ...modelSelection(profile) },
        profiles
      )

      return { ...settings, profiles, translation, dailySummary }
    })
  }

  async deleteProfile(profileId: string): Promise<AiSettings> {
    await this.keyStore.clearKey(profileId)

    return this.updateAiSettings(async (settings) => {
      const profiles = settings.profiles.filter((profile) => profile.id !== profileId)
      const translation = reconcileModelSelection(settings.translation, profiles)
      const dailySummary = reconcileModelSelection(settings.dailySummary, profiles)

      return { ...settings, profiles, translation, dailySummary }
    })
  }

  async setProfileApiKey(profileId: string, apiKey: string): Promise<AiSettings> {
    await this.requireProfile(profileId)
    await this.keyStore.setKey(profileId, apiKey)
    return this.getSettings()
  }

  async clearProfileApiKey(profileId: string): Promise<AiSettings> {
    await this.requireProfile(profileId)
    await this.keyStore.clearKey(profileId)
    return this.getSettings()
  }

  async updateTranslationSettings(patch: Partial<AiTranslationSettings>): Promise<AiSettings> {
    return this.updateAiSettings(async (settings) => ({
      ...settings,
      translation: reconcileModelSelection(aiTranslationSettingsSchema.parse({ ...settings.translation, ...patch }), settings.profiles)
    }))
  }

  async updateDailySummarySettings(patch: Partial<AiDailySummarySettings>): Promise<AiSettings> {
    return this.updateAiSettings(async (settings) => ({
      ...settings,
      dailySummary: reconcileModelSelection(aiDailySummarySettingsSchema.parse({ ...settings.dailySummary, ...patch }), settings.profiles)
    }))
  }

  async openTranslator(text: string, source: AiTranslationRequest['source']): Promise<AiTranslationRequest> {
    const settings = await this.getSettings()
    return this.openTranslationRequest({
      id: randomUUID(),
      text: text.trim(),
      source,
      targetLanguage: settings.translation.targetLanguage,
      profileId: settings.translation.profileId,
      model: settings.translation.model,
      createdAt: new Date().toISOString()
    })
  }

  async translate(text: string, profileIdInput?: string, modelInput?: string, targetLanguageInput?: string): Promise<TranslationApiResult> {
    const settings = await this.getSettings()
    const profileId = profileIdInput ?? settings.translation.profileId
    const model = modelInput?.trim() || settings.translation.model
    const targetLanguage = targetLanguageInput?.trim() || settings.translation.targetLanguage || DEFAULT_AI_TARGET_LANGUAGE
    if (!profileId) throw new Error('Choose a translation provider in AI settings first')
    if (!model) throw new Error('Choose a translation model in AI settings first')

    const profile = settings.profiles.find((candidate) => candidate.id === profileId)
    if (!profile) throw new Error('Translation provider does not exist')
    if (!profile.models.includes(model)) throw new Error('Translation model does not belong to the selected provider')

    const apiKey = await this.keyStore.readKey(profile.id)
    if (!apiKey) throw new Error(`API key is not configured for ${profile.name}`)

    if (profile.format === 'anthropic') {
      return { text: await this.translateWithAnthropic(profile, model, apiKey, text, targetLanguage) }
    }

    return { text: await this.translateWithOpenAi(profile, model, apiKey, text, targetLanguage) }
  }

  closeTranslator(): void {
    if (this.translationWindow && !this.translationWindow.isDestroyed()) {
      this.translationWindow.hide()
    }
  }

  private async translateWithOpenAi(profile: AiProfile, model: string, apiKey: string, text: string, targetLanguage: string): Promise<string> {
    const payload = await requestJson(endpointUrl(profile.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: translationSystemPrompt(targetLanguage) },
          { role: 'user', content: text }
        ]
      })
    })

    return parseOpenAiTranslation(payload)
  }

  private async translateWithAnthropic(profile: AiProfile, model: string, apiKey: string, text: string, targetLanguage: string): Promise<string> {
    const payload = await requestJson(endpointUrl(profile.baseUrl, '/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        system: translationSystemPrompt(targetLanguage),
        messages: [{ role: 'user', content: text }]
      })
    })

    return parseAnthropicTranslation(payload)
  }

  private async requireProfile(profileId: string): Promise<AiProfile> {
    const settings = await this.getSettings()
    const profile = settings.profiles.find((candidate) => candidate.id === profileId)
    if (!profile) throw new Error('AI profile does not exist')
    return profile
  }

  private async updateAiSettings(update: (settings: AiSettings) => Promise<AiSettings>): Promise<AiSettings> {
    const appSettings = await this.options.appSettingsService.updateSettingsWith(async (currentSettings) => {
      const nextAiSettings = aiSettingsSchema.parse(await update(currentSettings.ai))
      return {
        ...currentSettings,
        ai: nextAiSettings
      }
    })
    await this.refreshSystemHook()
    return this.withKeyStatus(appSettings.ai)
  }

  private async withKeyStatus(settings: AiSettings): Promise<AiSettings> {
    const profiles = await Promise.all(
      settings.profiles.map(async (profile) => ({
        ...profile,
        apiKeyConfigured: await this.keyStore.hasKey(profile.id)
      }))
    )

    return aiSettingsSchema.parse({ ...settings, profiles })
  }

  private async handleSystemDoubleCtrl(): Promise<void> {
    if (this.systemCaptureInFlight || this.isAtlasWindowFocused()) return

    const settings = await this.getSettings()
    if (!settings.translation.systemDoubleCtrlEnabled) return

    this.systemCaptureInFlight = true
    try {
      const text = await captureWindowsSelectedText({ clipboard })
      await this.openTranslator(text, 'system')
    } catch (error) {
      await this.openTranslationRequest({
        id: randomUUID(),
        text: '',
        source: 'system',
        targetLanguage: settings.translation.targetLanguage,
        profileId: settings.translation.profileId,
        model: settings.translation.model,
        error: error instanceof Error ? error.message : String(error),
        createdAt: new Date().toISOString()
      })
    } finally {
      this.systemCaptureInFlight = false
    }
  }

  private isAtlasWindowFocused(): boolean {
    const mainWindow = this.options.getMainWindow()
    return Boolean(
      (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) ||
        (this.translationWindow && !this.translationWindow.isDestroyed() && this.translationWindow.isFocused())
    )
  }

  private async openTranslationRequest(request: AiTranslationRequest): Promise<AiTranslationRequest> {
    this.activeRequest = request
    const window = await this.ensureTranslationWindow()
    this.positionTranslationWindow(window)
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    this.emitTranslationRequest()
    return request
  }

  private async ensureTranslationWindow(): Promise<BrowserWindow> {
    if (this.translationWindow && !this.translationWindow.isDestroyed()) return this.translationWindow

    const window = new BrowserWindow({
      width: TRANSLATION_WINDOW_WIDTH,
      height: TRANSLATION_WINDOW_HEIGHT,
      minWidth: 420,
      minHeight: 360,
      title: 'AtlasOS Translation',
      frame: false,
      resizable: true,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#010102',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    this.translationWindow = window
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    window.once('closed', () => {
      if (this.translationWindow === window) this.translationWindow = null
    })
    window.webContents.on('did-finish-load', () => this.emitTranslationRequest())

    await this.options.loadTranslationRenderer(window)
    return window
  }

  private positionTranslationWindow(window: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const workArea = display.workArea
    const x = Math.min(Math.max(cursor.x + 18, workArea.x + TRANSLATION_WINDOW_MARGIN), workArea.x + workArea.width - TRANSLATION_WINDOW_WIDTH - TRANSLATION_WINDOW_MARGIN)
    const y = Math.min(Math.max(cursor.y + 18, workArea.y + TRANSLATION_WINDOW_MARGIN), workArea.y + workArea.height - TRANSLATION_WINDOW_HEIGHT - TRANSLATION_WINDOW_MARGIN)
    window.setBounds({ x, y, width: TRANSLATION_WINDOW_WIDTH, height: TRANSLATION_WINDOW_HEIGHT })
  }

  private emitTranslationRequest(): void {
    if (!this.activeRequest || !this.translationWindow || this.translationWindow.isDestroyed()) return

    const webContents = this.translationWindow.webContents
    if (!webContents.isDestroyed()) {
      webContents.send('ai:translation-request', this.activeRequest)
    }
  }

  private stopSystemHook(): void {
    this.systemHook?.dispose()
    this.systemHook = null
  }
}
