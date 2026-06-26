import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, clipboard, desktopCapturer, nativeImage, screen, shell, type DesktopCapturerSource } from 'electron'
import { z } from 'zod'
import {
  aiScreenshotImageInputSchema,
  aiOpenTranslatorInputSchema,
  aiStartScreenshotCaptureInputSchema,
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
  AI_SCREENSHOT_CAPTURE_SESSION_CHANNEL,
  aiSettingsSchema,
  aiTranslationSettingsSchema,
  DEFAULT_AI_TARGET_LANGUAGE,
  firstAiProfileModel,
  isAiAutoTargetLanguage,
  type AiProfile,
  type AiDailySummarySettings,
  type AiSettings,
  type AiScreenshotCaptureBounds,
  type AiScreenshotCaptureDisplay,
  type AiScreenshotCaptureSession,
  type AiScreenshotCaptureSource,
  type AiScreenshotImageInput,
  type AiScreenshotTextResult,
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
  loadCaptureRenderer: (targetWindow: BrowserWindow) => Promise<void>
  keyStore?: AiKeyStore
}

type TranslationApiResult = {
  text: string
}

type AiModelSelection = {
  profileId: string | null
  model: string | null
}

type ResolvedAiModelRequest = {
  profile: AiProfile
  model: string
  apiKey: string
  targetLanguage: string
}

type ParsedScreenshotImage = {
  dataUrl: string
  mediaType: 'image/png' | 'image/jpeg'
  base64: string
}

type TranslationPromptMode = 'standard' | 'retry-unchanged'
type TranslationTargetKind = 'auto' | 'chinese' | 'english' | 'other'

const TRANSLATION_WINDOW_WIDTH = 640
const TRANSLATION_WINDOW_HEIGHT = 440
const TRANSLATION_WINDOW_MARGIN = 16
const ANTHROPIC_VERSION = '2023-06-01'
const CJK_TEXT_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/
const LATIN_WORD_PATTERN = /[A-Za-z][A-Za-z'-]*/g

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

function parseOpenAiImageText(value: unknown): string {
  const record = asRecord(value)
  const choices = Array.isArray(record?.choices) ? record.choices : []
  const firstChoice = asRecord(choices[0])
  const message = asRecord(firstChoice?.message)
  const content = typeof message?.content === 'string' ? message.content : null
  if (content === null) throw new Error('OpenAI response did not include screenshot text')
  return content.trim()
}

function parseAnthropicImageText(value: unknown): string {
  const record = asRecord(value)
  const content = Array.isArray(record?.content) ? record.content : []
  const parts = content.map(firstTextContent).filter((part): part is string => part !== null)
  if (parts.length === 0) throw new Error('Anthropic response did not include screenshot text')
  return parts.join('').trim()
}

function normalizedTargetLanguageInstruction(targetLanguage: string): string {
  const trimmed = targetLanguage.trim()
  const normalized = trimmed.toLowerCase()
  if (
    ['simplified chinese', 'chinese', 'zh', 'zh-cn', 'zh-hans'].includes(normalized) ||
    ['\u4e2d\u6587', '\u7b80\u4f53\u4e2d\u6587', '\u7b80\u4f53'].includes(trimmed)
  ) {
    return 'Simplified Chinese (\u7b80\u4f53\u4e2d\u6587)'
  }
  if (
    ['traditional chinese', 'zh-tw', 'zh-hk', 'zh-hant'].includes(normalized) ||
    ['\u7e41\u4f53\u4e2d\u6587', '\u7e41\u9ad4\u4e2d\u6587', '\u7e41\u4f53', '\u7e41\u9ad4'].includes(trimmed)
  ) {
    return 'Traditional Chinese (\u7e41\u9ad4\u4e2d\u6587)'
  }

  return trimmed
}

function translationTargetKind(targetLanguage: string): TranslationTargetKind {
  if (isAiAutoTargetLanguage(targetLanguage)) return 'auto'

  const normalized = targetLanguage.trim().toLowerCase()
  if (
    ['simplified chinese', 'traditional chinese', 'chinese', 'zh', 'zh-cn', 'zh-hans', 'zh-tw', 'zh-hk', 'zh-hant'].includes(normalized) ||
    ['\u4e2d\u6587', '\u7b80\u4f53\u4e2d\u6587', '\u7b80\u4f53', '\u7e41\u4f53\u4e2d\u6587', '\u7e41\u9ad4\u4e2d\u6587', '\u7e41\u4f53', '\u7e41\u9ad4'].includes(targetLanguage.trim())
  ) {
    return 'chinese'
  }
  if (['english', 'en', 'en-us', 'en-gb'].includes(normalized)) return 'english'

  return 'other'
}

function hasCjkText(text: string): boolean {
  return CJK_TEXT_PATTERN.test(text)
}

function hasSentenceLikeLatinText(text: string): boolean {
  const words = text.match(LATIN_WORD_PATTERN) ?? []
  const letterCount = words.join('').length
  return letterCount >= 8 && (words.length >= 2 || /[.!?]/.test(text))
}

function comparableTranslationText(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function shouldRetryUnchangedTranslation(sourceText: string, translatedText: string, targetLanguage: string): boolean {
  if (!sourceText.trim() || !translatedText.trim()) return false
  if (comparableTranslationText(sourceText) !== comparableTranslationText(translatedText)) return false

  const targetKind = translationTargetKind(targetLanguage)
  if (targetKind === 'chinese') return hasSentenceLikeLatinText(sourceText)
  if (targetKind === 'english') return hasCjkText(sourceText)
  if (targetKind !== 'auto') return false

  return hasCjkText(sourceText) || (hasSentenceLikeLatinText(sourceText) && !hasCjkText(sourceText))
}

function translationSystemPrompt(targetLanguage: string, mode: TranslationPromptMode = 'standard'): string {
  const retryPrefix =
    mode === 'retry-unchanged'
      ? ['Your previous response copied the source text unchanged. Correct that mistake now.']
      : []

  if (isAiAutoTargetLanguage(targetLanguage)) {
    return [
      ...retryPrefix,
      "Detect whether the user's text is primarily Chinese or English.",
      'If it is primarily Chinese, translate it into English.',
      'If it is primarily English, translate it into Simplified Chinese.',
      'For mixed Chinese and English text, translate the dominant source language into the other language while preserving names, code, URLs, and terms that should remain unchanged.',
      'Do not return the source text unchanged when it is not already in the target language.',
      'For English sentences translated into Simplified Chinese, the output must contain Chinese characters.',
      'Return only the translation.',
      'Preserve line breaks and formatting when useful.',
      'Do not add commentary, labels, or explanations.'
    ].join(' ')
  }

  const target = normalizedTargetLanguageInstruction(targetLanguage)
  const targetKind = translationTargetKind(targetLanguage)
  return [
    ...retryPrefix,
    `Translate the user's text into ${target}.`,
    `If the source text is not already in ${target}, you must translate it and must not return the source text unchanged.`,
    'Preserve only proper nouns, product names, code, commands, URLs, file paths, and identifiers that should remain unchanged.',
    ...(targetKind === 'chinese' ? ['For English sentences or phrases, the output must use Chinese characters rather than English wording.'] : []),
    'Return only the translation.',
    'Preserve line breaks and formatting when useful.',
    'Do not add commentary, labels, or explanations.'
  ].join(' ')
}

function screenshotOcrSystemPrompt(): string {
  return [
    'Extract all readable text visible in the screenshot.',
    'Return only the extracted text.',
    'Preserve line breaks and reading order when useful.',
    'Do not add labels, commentary, or explanations.',
    'If there is no readable text, return an empty response.'
  ].join(' ')
}

function parseScreenshotImageDataUrl(dataUrl: string): ParsedScreenshotImage {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('Screenshot image must be a PNG or JPEG data URL')

  return {
    dataUrl,
    mediaType: match[1] as ParsedScreenshotImage['mediaType'],
    base64: match[2]
  }
}

function captureBoundsFromRectangle(rectangle: Electron.Rectangle): AiScreenshotCaptureBounds {
  return {
    x: Math.round(rectangle.x),
    y: Math.round(rectangle.y),
    width: Math.round(rectangle.width),
    height: Math.round(rectangle.height)
  }
}

function virtualBoundsForDisplays(displays: Electron.Display[]): AiScreenshotCaptureBounds {
  const minX = Math.min(...displays.map((display) => display.bounds.x))
  const minY = Math.min(...displays.map((display) => display.bounds.y))
  const maxX = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width))
  const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height))

  return captureBoundsFromRectangle({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  })
}

function thumbnailSizeForDisplays(displays: Electron.Display[]): Electron.Size {
  return {
    width: Math.max(1, ...displays.map((display) => Math.round(display.bounds.width * display.scaleFactor))),
    height: Math.max(1, ...displays.map((display) => Math.round(display.bounds.height * display.scaleFactor)))
  }
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
  private captureWindow: BrowserWindow | null = null
  private activeRequest: AiTranslationRequest | null = null
  private activeScreenshotSession: AiScreenshotCaptureSession | null = null
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
    handleValidated('ai:start-screenshot-capture', aiStartScreenshotCaptureInputSchema, (_, input) => this.startScreenshotCapture(input.source))
    handleValidated('ai:get-active-screenshot-capture', z.object({}), () => this.activeScreenshotSession)
    handleValidated('ai:ocr-screenshot', aiScreenshotImageInputSchema, (_, input) => this.ocrScreenshot(input))
    handleValidated('ai:translate-screenshot', aiScreenshotImageInputSchema, (_, input) => this.translateScreenshot(input))
    handleValidated('ai:copy-screenshot-image', aiScreenshotImageInputSchema, (_, input) => this.copyScreenshotImage(input))
    handleValidated('ai:close-screenshot-capture', z.object({}), () => {
      this.closeScreenshotCapture()
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
    this.destroyScreenshotCaptureWindow()
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
    const { profile, model, apiKey, targetLanguage } = await this.resolveAiModelRequest(profileIdInput, modelInput, targetLanguageInput)

    if (profile.format === 'anthropic') {
      return { text: await this.translateWithAnthropic(profile, model, apiKey, text, targetLanguage) }
    }

    return { text: await this.translateWithOpenAi(profile, model, apiKey, text, targetLanguage) }
  }

  async startScreenshotCapture(source: AiScreenshotCaptureSource): Promise<AiScreenshotCaptureSession> {
    this.closeScreenshotCapture()

    const settings = (await this.options.appSettingsService.getSettings()).ai
    if (!this.isScreenshotCaptureEnabled(settings, source)) {
      throw new Error('Screenshot capture is disabled in AI translation settings')
    }

    const displays = screen.getAllDisplays()
    if (displays.length === 0) throw new Error('No displays are available for screenshot capture')

    const virtualBounds = virtualBoundsForDisplays(displays)
    const windowPromise = this.ensureScreenshotCaptureWindow()
    const captureDisplays = await this.captureDisplays(displays)
    const session: AiScreenshotCaptureSession = {
      id: randomUUID(),
      source,
      targetLanguage: settings.translation.targetLanguage,
      profileId: settings.translation.profileId,
      model: settings.translation.model,
      virtualBounds,
      displays: captureDisplays,
      createdAt: new Date().toISOString()
    }

    this.activeScreenshotSession = session
    try {
      const window = await windowPromise
      this.positionScreenshotCaptureWindow(window, session.virtualBounds)
      this.emitScreenshotCaptureSession(session)
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      return session
    } catch (error) {
      this.activeScreenshotSession = null
      throw error
    }
  }

  async ocrScreenshot(input: AiScreenshotImageInput): Promise<AiScreenshotTextResult> {
    const session = this.requireActiveScreenshotSession(input.sessionId)
    const { profile, model, apiKey } = await this.resolveAiModelRequest(session.profileId, session.model, session.targetLanguage)
    const image = parseScreenshotImageDataUrl(input.imageDataUrl)
    const prompt = screenshotOcrSystemPrompt()
    const text =
      profile.format === 'anthropic'
        ? await this.requestAnthropicImageText(profile, model, apiKey, image, prompt, 'Extract the readable text from this screenshot.')
        : await this.requestOpenAiImageText(profile, model, apiKey, image, prompt, 'Extract the readable text from this screenshot.')

    return { text }
  }

  async translateScreenshot(input: AiScreenshotImageInput): Promise<AiScreenshotTextResult> {
    const session = this.requireActiveScreenshotSession(input.sessionId)
    const { profile, model, apiKey, targetLanguage } = await this.resolveAiModelRequest(session.profileId, session.model, session.targetLanguage)
    const image = parseScreenshotImageDataUrl(input.imageDataUrl)
    const extractedText =
      profile.format === 'anthropic'
        ? await this.requestAnthropicImageText(profile, model, apiKey, image, screenshotOcrSystemPrompt(), 'Extract the readable text from this screenshot.')
        : await this.requestOpenAiImageText(profile, model, apiKey, image, screenshotOcrSystemPrompt(), 'Extract the readable text from this screenshot.')

    if (!extractedText) return { text: '' }

    const text =
      profile.format === 'anthropic'
        ? await this.translateWithAnthropic(profile, model, apiKey, extractedText, targetLanguage)
        : await this.translateWithOpenAi(profile, model, apiKey, extractedText, targetLanguage)

    return { text }
  }

  copyScreenshotImage(input: AiScreenshotImageInput): { ok: true } {
    this.requireActiveScreenshotSession(input.sessionId)
    const image = nativeImage.createFromDataURL(input.imageDataUrl)
    if (image.isEmpty()) throw new Error('Screenshot image is empty')

    clipboard.writeImage(image, 'clipboard')
    return { ok: true }
  }

  closeTranslator(): void {
    if (this.translationWindow && !this.translationWindow.isDestroyed()) {
      this.translationWindow.hide()
    }
  }

  closeScreenshotCapture(): void {
    this.activeScreenshotSession = null
    const window = this.captureWindow

    if (window && !window.isDestroyed()) {
      this.emitScreenshotCaptureSession(null)
      window.hide()
    }
  }

  private async resolveAiModelRequest(
    profileIdInput?: string | null,
    modelInput?: string | null,
    targetLanguageInput?: string
  ): Promise<ResolvedAiModelRequest> {
    const settings = await this.getSettings()
    const profileId = profileIdInput === undefined ? settings.translation.profileId : profileIdInput
    const model = modelInput === undefined ? settings.translation.model : modelInput?.trim() || null
    const targetLanguage = targetLanguageInput?.trim() || settings.translation.targetLanguage || DEFAULT_AI_TARGET_LANGUAGE
    if (!profileId) throw new Error('Choose a translation provider in AI settings first')
    if (!model) throw new Error('Choose a translation model in AI settings first')

    const profile = settings.profiles.find((candidate) => candidate.id === profileId)
    if (!profile) throw new Error('Translation provider does not exist')
    if (!profile.models.includes(model)) throw new Error('Translation model does not belong to the selected provider')

    const apiKey = await this.keyStore.readKey(profile.id)
    if (!apiKey) throw new Error(`API key is not configured for ${profile.name}`)

    return { profile, model, apiKey, targetLanguage }
  }

  private isScreenshotCaptureEnabled(settings: AiSettings, source: AiScreenshotCaptureSource): boolean {
    return source === 'system' ? settings.translation.systemDoubleCtrlEnabled : settings.translation.appDoubleCtrlEnabled
  }

  private requireActiveScreenshotSession(sessionId: string): AiScreenshotCaptureSession {
    if (!this.activeScreenshotSession || this.activeScreenshotSession.id !== sessionId) {
      throw new Error('Screenshot capture session is no longer active')
    }

    return this.activeScreenshotSession
  }

  private async captureDisplays(displays: Electron.Display[]): Promise<AiScreenshotCaptureDisplay[]> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: thumbnailSizeForDisplays(displays),
      fetchWindowIcons: false
    })
    return displays.map((display, index) => this.captureDisplay(display, index, sources))
  }

  private captureDisplay(
    display: Electron.Display,
    displayIndex: number,
    sources: DesktopCapturerSource[]
  ): AiScreenshotCaptureDisplay {
    const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[displayIndex] ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error(`Unable to capture display ${display.id}`)

    const imageSize = source.thumbnail.getSize()
    return {
      id: String(display.id),
      bounds: captureBoundsFromRectangle(display.bounds),
      scaleFactor: display.scaleFactor,
      imageDataUrl: source.thumbnail.toDataURL(),
      imageSize: {
        width: imageSize.width,
        height: imageSize.height
      }
    }
  }

  private async requestOpenAiImageText(
    profile: AiProfile,
    model: string,
    apiKey: string,
    image: ParsedScreenshotImage,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
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
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: image.dataUrl } }
            ]
          }
        ]
      })
    })

    return parseOpenAiImageText(payload)
  }

  private async requestAnthropicImageText(
    profile: AiProfile,
    model: string,
    apiKey: string,
    image: ParsedScreenshotImage,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
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
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: image.mediaType,
                  data: image.base64
                }
              },
              { type: 'text', text: userPrompt }
            ]
          }
        ]
      })
    })

    return parseAnthropicImageText(payload)
  }

  private async translateWithOpenAi(
    profile: AiProfile,
    model: string,
    apiKey: string,
    text: string,
    targetLanguage: string,
    mode: TranslationPromptMode = 'standard'
  ): Promise<string> {
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
          { role: 'system', content: translationSystemPrompt(targetLanguage, mode) },
          { role: 'user', content: text }
        ]
      })
    })

    const translatedText = parseOpenAiTranslation(payload)
    if (mode === 'standard' && shouldRetryUnchangedTranslation(text, translatedText, targetLanguage)) {
      return this.translateWithOpenAi(profile, model, apiKey, text, targetLanguage, 'retry-unchanged')
    }

    return translatedText
  }

  private async translateWithAnthropic(
    profile: AiProfile,
    model: string,
    apiKey: string,
    text: string,
    targetLanguage: string,
    mode: TranslationPromptMode = 'standard'
  ): Promise<string> {
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
        system: translationSystemPrompt(targetLanguage, mode),
        messages: [{ role: 'user', content: text }]
      })
    })

    const translatedText = parseAnthropicTranslation(payload)
    if (mode === 'standard' && shouldRetryUnchangedTranslation(text, translatedText, targetLanguage)) {
      return this.translateWithAnthropic(profile, model, apiKey, text, targetLanguage, 'retry-unchanged')
    }

    return translatedText
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
      const text = await captureWindowsSelectedText({ clipboard, copyCommand: this.systemHook?.sendCopyCommand })
      await this.openTranslator(text, 'system')
    } catch (error) {
      try {
        await this.startScreenshotCapture('system')
      } catch (captureError) {
        const message = captureError instanceof Error ? captureError.message : String(captureError)
        await this.openTranslationRequest({
          id: randomUUID(),
          text: '',
          source: 'system',
          targetLanguage: settings.translation.targetLanguage,
          profileId: settings.translation.profileId,
          model: settings.translation.model,
          error: message || (error instanceof Error ? error.message : String(error)),
          createdAt: new Date().toISOString()
        })
      }
    } finally {
      this.systemCaptureInFlight = false
    }
  }

  private isAtlasWindowFocused(): boolean {
    const mainWindow = this.options.getMainWindow()
    return Boolean(
      (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) ||
        (this.translationWindow && !this.translationWindow.isDestroyed() && this.translationWindow.isFocused()) ||
        (this.captureWindow && !this.captureWindow.isDestroyed() && this.captureWindow.isFocused())
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

  private async ensureScreenshotCaptureWindow(): Promise<BrowserWindow> {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) return this.captureWindow

    const session = this.activeScreenshotSession
    const bounds = session?.virtualBounds ?? { x: 0, y: 0, width: 1200, height: 800 }
    const window = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 320,
      minHeight: 240,
      title: 'AtlasOS Screenshot Capture',
      frame: false,
      thickFrame: false,
      useContentSize: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
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

    this.captureWindow = window
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    window.once('closed', () => {
      if (this.captureWindow === window) {
        this.captureWindow = null
        this.activeScreenshotSession = null
      }
    })

    await this.options.loadCaptureRenderer(window)
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

  private positionScreenshotCaptureWindow(window: BrowserWindow, bounds: AiScreenshotCaptureBounds): void {
    window.setContentBounds(bounds)
  }

  private emitTranslationRequest(): void {
    if (!this.activeRequest || !this.translationWindow || this.translationWindow.isDestroyed()) return

    const webContents = this.translationWindow.webContents
    if (!webContents.isDestroyed()) {
      webContents.send('ai:translation-request', this.activeRequest)
    }
  }

  private emitScreenshotCaptureSession(session: AiScreenshotCaptureSession | null): void {
    if (!this.captureWindow || this.captureWindow.isDestroyed()) return

    const webContents = this.captureWindow.webContents
    if (!webContents.isDestroyed()) {
      webContents.send(AI_SCREENSHOT_CAPTURE_SESSION_CHANNEL, session)
    }
  }

  private destroyScreenshotCaptureWindow(): void {
    this.activeScreenshotSession = null
    const window = this.captureWindow
    this.captureWindow = null

    if (window && !window.isDestroyed()) {
      window.close()
    }
  }

  private stopSystemHook(): void {
    this.systemHook?.dispose()
    this.systemHook = null
  }
}
