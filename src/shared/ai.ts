import { z } from 'zod'

export const AI_TARGET_LANGUAGE_OPTIONS = [
  'Auto',
  'Simplified Chinese',
  'Traditional Chinese',
  'English',
  'Japanese',
  'Korean',
  'French',
  'German',
  'Spanish'
] as const

export const AI_AUTO_TARGET_LANGUAGE = AI_TARGET_LANGUAGE_OPTIONS[0]
export const DEFAULT_AI_TARGET_LANGUAGE = 'Simplified Chinese'
export const AI_DOUBLE_CTRL_INTERVAL_MS = 450
export const MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS = 10 * 1024 * 1024
export const AI_SCREENSHOT_CAPTURE_SESSION_CHANNEL = 'ai:screenshot-capture-session'

export function isAiAutoTargetLanguage(targetLanguage: string): boolean {
  const normalized = targetLanguage.trim().toLowerCase()
  return (
    normalized === AI_AUTO_TARGET_LANGUAGE.toLowerCase() ||
    targetLanguage.trim() === '\u81ea\u52a8'
  )
}

export const aiProviderFormatSchema = z.enum(['openai', 'anthropic'])
export const aiModelSchema = z.string().trim().min(1).max(200)

const aiProfileObjectSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  format: aiProviderFormatSchema.default('openai'),
  baseUrl: z.string().trim().url().max(2048),
  models: z.array(aiModelSchema).min(1).max(80),
  apiKeyConfigured: z.boolean().default(false)
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function legacyProfileModel(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value.model === 'string' && value.model.trim()) return value.model.trim()
  if (!Array.isArray(value.models)) return null

  for (const model of value.models) {
    if (typeof model === 'string' && model.trim()) return model.trim()
  }

  return null
}

function migrateAiProfileInput(value: unknown): unknown {
  if (!isRecord(value) || Array.isArray(value.models)) return value

  const model = legacyProfileModel(value)
  return model ? { ...value, models: [model] } : value
}

function migrateAiApplicationSettings(value: unknown, profileModels: Map<string, string>): unknown {
  if (!isRecord(value)) return value
  if ('model' in value) return value
  if (typeof value.profileId !== 'string') return value

  const model = profileModels.get(value.profileId.trim())
  return model ? { ...value, model } : value
}

function migrateAiSettingsInput(value: unknown): unknown {
  if (value === null || value === undefined) return {}
  if (!isRecord(value)) return value

  const profiles = Array.isArray(value.profiles) ? value.profiles.map(migrateAiProfileInput) : value.profiles
  const profileModels = new Map<string, string>()

  if (Array.isArray(value.profiles)) {
    for (const profile of value.profiles) {
      if (!isRecord(profile) || typeof profile.id !== 'string') continue
      const model = legacyProfileModel(profile)
      if (model) profileModels.set(profile.id.trim(), model)
    }
  }

  return {
    ...value,
    profiles,
    translation: migrateAiApplicationSettings(value.translation, profileModels),
    dailySummary: migrateAiApplicationSettings(value.dailySummary, profileModels)
  }
}

export const aiProfileSchema = z.preprocess(migrateAiProfileInput, aiProfileObjectSchema)
export const aiProfileDraftSchema = z.preprocess(migrateAiProfileInput, aiProfileObjectSchema.omit({ apiKeyConfigured: true }))

const aiTranslationSettingsObjectSchema = z.object({
  profileId: z.string().trim().min(1).max(120).nullable().default(null),
  model: aiModelSchema.nullable().default(null),
  targetLanguage: z.string().trim().min(1).max(80).default(DEFAULT_AI_TARGET_LANGUAGE),
  appDoubleCtrlEnabled: z.boolean().default(true),
  systemDoubleCtrlEnabled: z.boolean().default(true)
})

const aiDailySummarySettingsObjectSchema = z.object({
  profileId: z.string().trim().min(1).max(120).nullable().default(null),
  model: aiModelSchema.nullable().default(null)
})

export const aiTranslationSettingsSchema = z.preprocess((value) => value ?? {}, aiTranslationSettingsObjectSchema)
export const aiTranslationSettingsPatchSchema = z.object({
  profileId: z.string().trim().min(1).max(120).nullable().optional(),
  model: aiModelSchema.nullable().optional(),
  targetLanguage: z.string().trim().min(1).max(80).optional(),
  appDoubleCtrlEnabled: z.boolean().optional(),
  systemDoubleCtrlEnabled: z.boolean().optional()
})
export const aiDailySummarySettingsSchema = z.preprocess((value) => value ?? {}, aiDailySummarySettingsObjectSchema)
export const aiDailySummarySettingsPatchSchema = z.object({
  profileId: z.string().trim().min(1).max(120).nullable().optional(),
  model: aiModelSchema.nullable().optional()
})

const aiSettingsObjectSchema = z
  .object({
    profiles: z.array(aiProfileSchema).default([]),
    translation: aiTranslationSettingsSchema,
    dailySummary: aiDailySummarySettingsSchema
  })
  .superRefine((settings, context) => {
    const profilesById = new Map<string, AiProfile>()

    for (const [index, profile] of settings.profiles.entries()) {
      if (profilesById.has(profile.id)) {
        context.addIssue({
          code: 'custom',
          message: 'AI profile ids must be unique',
          path: ['profiles', index, 'id']
        })
        continue
      }

      profilesById.set(profile.id, profile)
    }

    const validateSelection = (section: 'translation' | 'dailySummary', label: string): void => {
      const selection = settings[section]
      if (!selection.profileId) return

      const profile = profilesById.get(selection.profileId)
      if (!profile) {
        context.addIssue({
          code: 'custom',
          message: `${label} profile must exist`,
          path: [section, 'profileId']
        })
        return
      }

      if (!selection.model) {
        context.addIssue({
          code: 'custom',
          message: `${label} model must be selected`,
          path: [section, 'model']
        })
        return
      }

      if (!profile.models.includes(selection.model)) {
        context.addIssue({
          code: 'custom',
          message: `${label} model must belong to the selected profile`,
          path: [section, 'model']
        })
      }
    }

    validateSelection('translation', 'Translation')
    validateSelection('dailySummary', 'Daily summary')
  })

export const aiSettingsSchema = z.preprocess(migrateAiSettingsInput, aiSettingsObjectSchema)

export type AiProviderFormat = z.infer<typeof aiProviderFormatSchema>
export type AiProfile = z.infer<typeof aiProfileSchema>
export type AiProfileDraft = z.infer<typeof aiProfileDraftSchema>
export type AiTranslationSettings = z.infer<typeof aiTranslationSettingsSchema>
export type AiDailySummarySettings = z.infer<typeof aiDailySummarySettingsSchema>
export type AiSettings = z.infer<typeof aiSettingsSchema>

export function firstAiProfileModel(profile: Pick<AiProfile, 'models'>): string | null {
  return profile.models[0] ?? null
}

export type AiTranslationSource = 'app' | 'browser' | 'system'

export type AiTranslationRequest = {
  id: string
  text: string
  source: AiTranslationSource
  targetLanguage: string
  profileId: string | null
  model: string | null
  error?: string
  createdAt: string
}

export type AiScreenshotCaptureSource = AiTranslationSource

export type AiScreenshotCaptureBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type AiScreenshotCaptureDisplay = {
  id: string
  bounds: AiScreenshotCaptureBounds
  scaleFactor: number
  imageDataUrl: string
  imageSize: {
    width: number
    height: number
  }
}

export type AiScreenshotCaptureSession = {
  id: string
  source: AiScreenshotCaptureSource
  targetLanguage: string
  profileId: string | null
  model: string | null
  virtualBounds: AiScreenshotCaptureBounds
  displays: AiScreenshotCaptureDisplay[]
  createdAt: string
}

export type AiScreenshotImageInput = {
  sessionId: string
  imageDataUrl: string
}

export type AiScreenshotTextResult = {
  text: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = aiSettingsSchema.parse({})
