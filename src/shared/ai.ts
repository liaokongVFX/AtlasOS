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

export function isAiAutoTargetLanguage(targetLanguage: string): boolean {
  const normalized = targetLanguage.trim().toLowerCase()
  return (
    normalized === AI_AUTO_TARGET_LANGUAGE.toLowerCase() ||
    targetLanguage.trim() === '\u81ea\u52a8'
  )
}

export const aiProviderFormatSchema = z.enum(['openai', 'anthropic'])

export const aiProfileSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  format: aiProviderFormatSchema.default('openai'),
  baseUrl: z.string().trim().url().max(2048),
  model: z.string().trim().min(1).max(200),
  apiKeyConfigured: z.boolean().default(false)
})

export const aiProfileDraftSchema = aiProfileSchema.omit({ apiKeyConfigured: true })

const aiTranslationSettingsObjectSchema = z.object({
  profileId: z.string().trim().min(1).max(120).nullable().default(null),
  targetLanguage: z.string().trim().min(1).max(80).default(DEFAULT_AI_TARGET_LANGUAGE),
  appDoubleCtrlEnabled: z.boolean().default(true),
  systemDoubleCtrlEnabled: z.boolean().default(true)
})

export const aiTranslationSettingsSchema = z.preprocess((value) => value ?? {}, aiTranslationSettingsObjectSchema)
export const aiTranslationSettingsPatchSchema = aiTranslationSettingsObjectSchema.partial()

const aiSettingsObjectSchema = z
  .object({
    profiles: z.array(aiProfileSchema).default([]),
    translation: aiTranslationSettingsSchema
  })
  .superRefine((settings, context) => {
    const profileIds = new Set<string>()

    for (const [index, profile] of settings.profiles.entries()) {
      if (profileIds.has(profile.id)) {
        context.addIssue({
          code: 'custom',
          message: 'AI profile ids must be unique',
          path: ['profiles', index, 'id']
        })
        continue
      }

      profileIds.add(profile.id)
    }

    const translationProfileId = settings.translation.profileId
    if (translationProfileId && !profileIds.has(translationProfileId)) {
      context.addIssue({
        code: 'custom',
        message: 'Translation profile must exist',
        path: ['translation', 'profileId']
      })
    }
  })

export const aiSettingsSchema = z.preprocess((value) => value ?? {}, aiSettingsObjectSchema)

export type AiProviderFormat = z.infer<typeof aiProviderFormatSchema>
export type AiProfile = z.infer<typeof aiProfileSchema>
export type AiProfileDraft = z.infer<typeof aiProfileDraftSchema>
export type AiTranslationSettings = z.infer<typeof aiTranslationSettingsSchema>
export type AiSettings = z.infer<typeof aiSettingsSchema>

export type AiTranslationSource = 'app' | 'browser' | 'system'

export type AiTranslationRequest = {
  id: string
  text: string
  source: AiTranslationSource
  targetLanguage: string
  profileId: string | null
  error?: string
  createdAt: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = aiSettingsSchema.parse({})
