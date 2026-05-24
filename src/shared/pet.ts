import { z } from 'zod'

export const PET_ALERT_KINDS = ['kanban_due', 'agent_waiting', 'agent_completed', 'agent_error'] as const
export const PET_ALERT_SEVERITIES = ['info', 'warning', 'danger'] as const
export const PET_AGENT_SOURCES = ['codex', 'claude'] as const
export const PET_AGENT_STATUSES = ['running', 'waiting_for_confirmation', 'completed', 'error', 'idle_unknown'] as const
export const PET_MEDIA_KINDS = ['image', 'video'] as const
export const PET_ACTIONS = ['none', 'float', 'pulse', 'bounce', 'shake'] as const
export const PET_PANEL_SIDES = ['left', 'right'] as const

export const DEFAULT_PET_SETTINGS = {
  enabled: true,
  showNativeNotifications: true,
  showRunningAgents: true,
  position: { x: 36, y: 120 },
  size: 72,
  kanban: {
    enabled: true
  },
  agentBridge: {
    enabled: true
  },
  assetPack: {
    id: 'atlas-orb',
    name: 'Atlas Orb',
    idleSrc: '',
    idleKind: 'image',
    attentionSrc: '',
    attentionKind: 'image'
  },
  actionMap: {
    idle: 'float',
    attention: 'pulse'
  }
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
  createdAt: z.string(),
  readAt: z.string().optional(),
  snoozedUntil: z.string().optional(),
  dedupeKey: z.string().min(1)
})

export const petAgentSessionSchema = z.object({
  id: z.string().min(1),
  source: z.enum(PET_AGENT_SOURCES),
  status: z.enum(PET_AGENT_STATUSES),
  canvasId: z.string().min(1),
  componentId: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().optional(),
  lastActivityAt: z.string(),
  attentionReason: z.string().optional()
})

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
        attentionSrc: z.string().default(DEFAULT_PET_SETTINGS.assetPack.attentionSrc),
        attentionKind: z.enum(PET_MEDIA_KINDS).default(DEFAULT_PET_SETTINGS.assetPack.attentionKind)
      })
      .default(DEFAULT_PET_SETTINGS.assetPack),
    actionMap: z
      .object({
        idle: z.enum(PET_ACTIONS).default(DEFAULT_PET_SETTINGS.actionMap.idle),
        attention: z.enum(PET_ACTIONS).default(DEFAULT_PET_SETTINGS.actionMap.attention)
      })
      .default(DEFAULT_PET_SETTINGS.actionMap)
  })
  .default(DEFAULT_PET_SETTINGS)

export const petRuntimeStateSchema = z.object({
  settings: petSettingsSchema,
  alerts: z.array(petAlertSchema).default([]),
  agentSessions: z.array(petAgentSessionSchema).default([]),
  window: z
    .object({
      panelSide: z.enum(PET_PANEL_SIDES).default('right')
    })
    .default({ panelSide: 'right' }),
  bridge: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(0),
    token: z.string().min(1)
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
