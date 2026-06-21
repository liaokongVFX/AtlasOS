import { z } from 'zod'

export const REMOTE_SERVER_TEXT_FILE_MAX_BYTES = 1024 * 1024

export const remoteServerAuthTypeSchema = z.enum(['password', 'private-key'])

const optionalTrimmedString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
    z.string().trim().min(1).max(max).optional()
  )

export const remoteServerProfileSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1).max(120),
  authType: remoteServerAuthTypeSchema.default('password'),
  privateKeyPath: optionalTrimmedString(4096),
  passwordConfigured: z.boolean().default(false),
  passphraseConfigured: z.boolean().default(false),
  hostKeyFingerprint: optionalTrimmedString(240),
  updatedAt: z.string()
})

export const remoteServerSettingsSchema = z
  .object({
    profiles: z.array(remoteServerProfileSchema).default([])
  })
  .default({ profiles: [] })
  .superRefine((settings, context) => {
    const profileIds = new Set<string>()

    for (const [index, profile] of settings.profiles.entries()) {
      if (profileIds.has(profile.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Remote server profile ids must be unique',
          path: ['profiles', index, 'id']
        })
      }
      profileIds.add(profile.id)
    }
  })

export const remoteServerProfileDraftSchema = z.object({
  id: optionalTrimmedString(120),
  name: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1).max(120),
  authType: remoteServerAuthTypeSchema.default('password'),
  privateKeyPath: optionalTrimmedString(4096),
  password: z.string().max(20_000).optional(),
  passphrase: z.string().max(20_000).optional(),
  clearPassword: z.boolean().default(false),
  clearPassphrase: z.boolean().default(false)
})

export const remoteServerProfileIdInputSchema = z.object({
  profileId: z.string().trim().min(1).max(120)
})

export const remoteServerComponentInputSchema = z.object({
  componentId: z.string().trim().min(1).max(200)
})

export const remoteServerConnectInputSchema = remoteServerProfileIdInputSchema.extend({
  componentId: z.string().trim().min(1).max(200),
  canvasId: optionalTrimmedString(200),
  cols: z.number().int().min(10).default(100),
  rows: z.number().int().min(4).default(30),
  acceptHostKey: z.boolean().default(false),
  expectedHostKeyFingerprint: optionalTrimmedString(240)
})

export const remoteServerSessionInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(200)
})

export const remoteServerShellWriteInputSchema = remoteServerSessionInputSchema.extend({
  data: z.string()
})

export const remoteServerShellResizeInputSchema = remoteServerSessionInputSchema.extend({
  cols: z.number().int().min(10),
  rows: z.number().int().min(4)
})

export const remoteServerTreeInputSchema = remoteServerSessionInputSchema.extend({
  rootPath: z.string().trim().min(1).max(4096),
  targetPath: optionalTrimmedString(4096),
  maxDepth: z.number().int().min(0).max(16).default(1)
})

export const remoteServerFileOperationInputSchema = remoteServerSessionInputSchema.extend({
  rootPath: z.string().trim().min(1).max(4096),
  targetPath: z.string().trim().min(1).max(4096),
  name: optionalTrimmedString(240),
  contents: z.string().max(REMOTE_SERVER_TEXT_FILE_MAX_BYTES).optional(),
  recursive: z.boolean().default(false)
})

export const remoteServerRenameInputSchema = remoteServerFileOperationInputSchema.extend({
  name: z.string().trim().min(1).max(240)
})

export const remoteServerUploadInputSchema = remoteServerSessionInputSchema.extend({
  rootPath: z.string().trim().min(1).max(4096),
  targetPath: z.string().trim().min(1).max(4096),
  localPath: z.string().trim().min(1).max(4096),
  name: optionalTrimmedString(240)
})

export const remoteServerDownloadInputSchema = remoteServerSessionInputSchema.extend({
  rootPath: z.string().trim().min(1).max(4096),
  targetPath: z.string().trim().min(1).max(4096),
  localDirectory: z.string().trim().min(1).max(4096)
})

export const remoteServerDeleteProfileInputSchema = remoteServerProfileIdInputSchema
export const remoteServerSaveProfileInputSchema = z.object({
  profile: remoteServerProfileDraftSchema
})
export const remoteServerTestConnectionInputSchema = z.object({
  profile: remoteServerProfileDraftSchema
})

export type RemoteServerAuthType = z.infer<typeof remoteServerAuthTypeSchema>
export type RemoteServerProfile = z.infer<typeof remoteServerProfileSchema>
export type RemoteServerProfileDraft = z.infer<typeof remoteServerProfileDraftSchema>
export type RemoteServerSettings = z.infer<typeof remoteServerSettingsSchema>

export type RemoteServerConnectResult =
  | {
      status: 'connected'
      sessionId: string
      profileId: string
      homePath: string
      hostKeyFingerprint: string
    }
  | {
      status: 'host-key-untrusted'
      profileId: string
      hostKeyFingerprint: string
    }
  | {
      status: 'host-key-mismatch'
      profileId: string
      expectedHostKeyFingerprint: string
      actualHostKeyFingerprint: string
    }

export type RemoteServerStatusSnapshot = {
  profileId: string
  sessionId: string
  connection: 'connected' | 'disconnected'
  updatedAt: string
  hostname?: string
  username?: string
  os?: string
  kernel?: string
  uptime?: string
  loadAverage?: string
  cpuUsagePercent?: number
  memory?: {
    total: number
    used: number
    available: number
  }
  disk?: {
    path: string
    total: number
    used: number
    available: number
  }
  error?: string
}

export const DEFAULT_REMOTE_SERVER_SETTINGS: RemoteServerSettings = remoteServerSettingsSchema.parse({})
