import { z } from 'zod'

export const DEFAULT_UPDATE_SETTINGS = {
  autoCheck: true
} as const

export const updateSettingsSchema = z
  .object({
    autoCheck: z.boolean().default(DEFAULT_UPDATE_SETTINGS.autoCheck)
  })
  .default(DEFAULT_UPDATE_SETTINGS)

export type UpdateSettings = z.infer<typeof updateSettingsSchema>

export type AtlasUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type AtlasUpdateProgress = {
  bytesPerSecond: number
  percent: number
  total: number
  transferred: number
}

export type AtlasUpdateState = {
  status: AtlasUpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseName?: string | null
  releaseNotes?: string | null
  releaseDate?: string
  progress?: AtlasUpdateProgress
  error?: string
  lastCheckedAt?: string
  updatedAt: string
}
