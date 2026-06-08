import { z } from 'zod'

export const PET_ALERT_KINDS = ['kanban_due', 'agent_waiting', 'agent_completed', 'agent_error'] as const
export const PET_ALERT_SEVERITIES = ['info', 'warning', 'danger'] as const
export const PET_AGENT_SOURCES = ['codex', 'claude'] as const
export const PET_AGENT_STATUSES = ['running', 'waiting_for_confirmation', 'completed', 'error', 'idle_unknown'] as const
export const PET_MEDIA_KINDS = ['image', 'video', 'sprite'] as const
export const PET_ACTIONS = ['none', 'float', 'pulse', 'bounce', 'shake'] as const
export const PET_PANEL_SIDES = ['left', 'right'] as const

export const DEFAULT_PET_SPRITE_ANIMATION = {
  frameCount: 8,
  fps: 8
} as const

export const DEFAULT_PET_SETTINGS = {
  enabled: true,
  showNativeNotifications: true,
  showRunningAgents: true,
  position: { x: 36, y: 120 },
  size: 72,
  kanban: {
    enabled: true
  },
  alertSound: {
    enabled: false,
    askingSrc: '',
    askingName: '',
    completionSrc: '',
    completionName: ''
  },
  agentBridge: {
    enabled: true
  },
  assetPack: {
    id: 'atlas-orb',
    name: 'Atlas Orb',
    idleSrc: '',
    idleKind: 'image',
    idleSprite: DEFAULT_PET_SPRITE_ANIMATION,
    runningSrc: '',
    runningKind: 'image',
    runningSprite: DEFAULT_PET_SPRITE_ANIMATION,
    attentionSrc: '',
    attentionKind: 'image',
    attentionSprite: DEFAULT_PET_SPRITE_ANIMATION
  },
  actionMap: {
    idle: 'float',
    running: 'bounce',
    attention: 'pulse'
  }
} as const

export const DEFAULT_PET_WINDOW_STATE = {
  panelSide: 'right',
  orbOffset: { x: 284, y: 12 }
} as const

export const petAlertTargetSchema = z.object({
  canvasId: z.string().min(1).optional(),
  componentId: z.string().min(1).optional(),
  cardId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional()
})

export const petAlertSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PET_ALERT_KINDS),
  severity: z.enum(PET_ALERT_SEVERITIES),
  title: z.string().min(1),
  body: z.string().default(''),
  target: petAlertTargetSchema.default({}),
  componentTitle: z.string().min(1).optional(),
  createdAt: z.string(),
  readAt: z.string().optional(),
  snoozedUntil: z.string().optional(),
  dedupeKey: z.string().min(1)
})

export const petAgentSessionSchema = z.object({
  id: z.string().min(1),
  terminalSessionId: z.string().min(1).optional(),
  providerSessionId: z.string().min(1).optional(),
  source: z.enum(PET_AGENT_SOURCES),
  status: z.enum(PET_AGENT_STATUSES),
  canvasId: z.string().min(1),
  componentId: z.string().min(1),
  componentTitle: z.string().min(1).optional(),
  title: z.string().min(1),
  cwd: z.string().optional(),
  lastActivityAt: z.string(),
  attentionReason: z.string().optional()
})

export const petSpriteAnimationSchema = z.object({
  frameCount: z.number().int().min(1).max(64).default(DEFAULT_PET_SPRITE_ANIMATION.frameCount),
  fps: z.number().int().min(1).max(30).default(DEFAULT_PET_SPRITE_ANIMATION.fps)
})

function normalizePetAlertSound(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value

  const record = value as Record<string, unknown>
  const legacySrc = typeof record.src === 'string' ? record.src : ''
  const legacyName = typeof record.name === 'string' ? record.name : ''

  return {
    ...record,
    askingSrc: typeof record.askingSrc === 'string' ? record.askingSrc : legacySrc,
    askingName: typeof record.askingName === 'string' ? record.askingName : legacyName,
    completionSrc: typeof record.completionSrc === 'string' ? record.completionSrc : legacySrc,
    completionName: typeof record.completionName === 'string' ? record.completionName : legacyName
  }
}

export const petSettingsSchema = z
  .object({
    enabled: z.boolean().default(DEFAULT_PET_SETTINGS.enabled),
    showNativeNotifications: z.boolean().default(DEFAULT_PET_SETTINGS.showNativeNotifications),
    showRunningAgents: z.boolean().default(DEFAULT_PET_SETTINGS.showRunningAgents),
    position: z
      .object({
        x: z.number().int().default(DEFAULT_PET_SETTINGS.position.x),
        y: z.number().int().default(DEFAULT_PET_SETTINGS.position.y)
      })
      .default(DEFAULT_PET_SETTINGS.position),
    size: z.number().int().min(48).max(140).default(DEFAULT_PET_SETTINGS.size),
    kanban: z
      .object({
        enabled: z.boolean().default(DEFAULT_PET_SETTINGS.kanban.enabled)
      })
      .default(DEFAULT_PET_SETTINGS.kanban),
    alertSound: z
      .preprocess(
        normalizePetAlertSound,
        z.object({
          enabled: z.boolean().default(DEFAULT_PET_SETTINGS.alertSound.enabled),
          askingSrc: z.string().default(DEFAULT_PET_SETTINGS.alertSound.askingSrc),
          askingName: z.string().default(DEFAULT_PET_SETTINGS.alertSound.askingName),
          completionSrc: z.string().default(DEFAULT_PET_SETTINGS.alertSound.completionSrc),
          completionName: z.string().default(DEFAULT_PET_SETTINGS.alertSound.completionName)
        })
      )
      .default(DEFAULT_PET_SETTINGS.alertSound),
    agentBridge: z
      .object({
        enabled: z.boolean().default(DEFAULT_PET_SETTINGS.agentBridge.enabled)
      })
      .default(DEFAULT_PET_SETTINGS.agentBridge),
    assetPack: z
      .object({
        id: z.string().min(1).default(DEFAULT_PET_SETTINGS.assetPack.id),
        name: z.string().min(1).default(DEFAULT_PET_SETTINGS.assetPack.name),
        idleSrc: z.string().default(DEFAULT_PET_SETTINGS.assetPack.idleSrc),
        idleKind: z.enum(PET_MEDIA_KINDS).default(DEFAULT_PET_SETTINGS.assetPack.idleKind),
        idleSprite: petSpriteAnimationSchema.default(DEFAULT_PET_SETTINGS.assetPack.idleSprite),
        runningSrc: z.string().default(DEFAULT_PET_SETTINGS.assetPack.runningSrc),
        runningKind: z.enum(PET_MEDIA_KINDS).default(DEFAULT_PET_SETTINGS.assetPack.runningKind),
        runningSprite: petSpriteAnimationSchema.default(DEFAULT_PET_SETTINGS.assetPack.runningSprite),
        attentionSrc: z.string().default(DEFAULT_PET_SETTINGS.assetPack.attentionSrc),
        attentionKind: z.enum(PET_MEDIA_KINDS).default(DEFAULT_PET_SETTINGS.assetPack.attentionKind),
        attentionSprite: petSpriteAnimationSchema.default(DEFAULT_PET_SETTINGS.assetPack.attentionSprite)
      })
      .default(DEFAULT_PET_SETTINGS.assetPack),
    actionMap: z
      .object({
        idle: z.enum(PET_ACTIONS).default(DEFAULT_PET_SETTINGS.actionMap.idle),
        running: z.enum(PET_ACTIONS).default(DEFAULT_PET_SETTINGS.actionMap.running),
        attention: z.enum(PET_ACTIONS).default(DEFAULT_PET_SETTINGS.actionMap.attention)
      })
      .default(DEFAULT_PET_SETTINGS.actionMap)
  })
  .default(DEFAULT_PET_SETTINGS)

export const petHookInstallStatusSchema = z.object({
  installed: z.boolean(),
  settingsPath: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  displayCommand: z.string(),
  events: z.array(z.string()),
  installedEvents: z.array(z.string()),
  issue: z.string().optional()
})

export const petRuntimeStateSchema = z.object({
  settings: petSettingsSchema,
  alerts: z.array(petAlertSchema).default([]),
  agentSessions: z.array(petAgentSessionSchema).default([]),
  window: z
    .object({
      panelSide: z.enum(PET_PANEL_SIDES).default(DEFAULT_PET_WINDOW_STATE.panelSide),
      orbOffset: z
        .object({
          x: z.number().int().default(DEFAULT_PET_WINDOW_STATE.orbOffset.x),
          y: z.number().int().default(DEFAULT_PET_WINDOW_STATE.orbOffset.y)
        })
        .default(DEFAULT_PET_WINDOW_STATE.orbOffset)
    })
    .default(DEFAULT_PET_WINDOW_STATE),
  bridge: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(0),
    token: z.string().min(1),
    claudeHook: petHookInstallStatusSchema,
    codexHook: petHookInstallStatusSchema
  })
})

export type PetAlertKind = z.infer<typeof petAlertSchema>['kind']
export type PetAlertSeverity = z.infer<typeof petAlertSchema>['severity']
export type PetAlertTarget = z.infer<typeof petAlertTargetSchema>
export type PetAlert = z.infer<typeof petAlertSchema>
export type PetAgentSource = z.infer<typeof petAgentSessionSchema>['source']
export type PetAgentStatus = z.infer<typeof petAgentSessionSchema>['status']
export type PetAgentSession = z.infer<typeof petAgentSessionSchema>
export type PetSettings = z.infer<typeof petSettingsSchema>
export type PetRuntimeState = z.infer<typeof petRuntimeStateSchema>
