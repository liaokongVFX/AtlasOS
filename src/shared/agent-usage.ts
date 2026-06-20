import { z } from 'zod'

export const agentUsageProviderSchema = z.enum(['claude', 'codex'])
export const agentUsageDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const agentUsageTokenMetricsSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  cacheCreationInputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  reasoningOutputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0)
})

export const agentUsageTotalsSchema = agentUsageTokenMetricsSchema.extend({
  messageCount: z.number().int().nonnegative().default(0),
  toolCallCount: z.number().int().nonnegative().default(0),
  sessionCount: z.number().int().nonnegative().default(0),
  claudeSessionCount: z.number().int().nonnegative().default(0),
  codexSessionCount: z.number().int().nonnegative().default(0)
})

export const agentUsageIndexStatusSchema = z.object({
  indexedAt: z.string().nullable(),
  isRefreshing: z.boolean().default(false),
  sourceFileCount: z.number().int().nonnegative().default(0),
  sessionCount: z.number().int().nonnegative().default(0),
  usageEventCount: z.number().int().nonnegative().default(0),
  dayCount: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null)
})

export const agentUsageDayBucketSchema = agentUsageTotalsSchema.extend({
  day: agentUsageDaySchema
})

export const agentUsageDailySummarySchema = z.object({
  day: agentUsageDaySchema,
  summary: z.string(),
  generatedAt: z.string(),
  profileId: z.string().nullable(),
  profileName: z.string().nullable(),
  model: z.string().nullable(),
  locale: z.string(),
  sourceDigest: z.string()
})

export const agentUsageSessionDetailSchema = agentUsageTokenMetricsSchema.extend({
  provider: agentUsageProviderSchema,
  sessionKey: z.string().min(1),
  sessionId: z.string().min(1),
  projectPath: z.string().nullable(),
  cwd: z.string().nullable(),
  title: z.string(),
  model: z.string().nullable(),
  isSidechain: z.boolean(),
  startedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative()
})

export const agentUsageDistributionEntrySchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
})

export const agentUsageYearResultSchema = z.object({
  year: z.number().int(),
  status: agentUsageIndexStatusSchema,
  days: z.array(agentUsageDayBucketSchema)
})

export const agentUsageDayDetailSchema = z.object({
  day: agentUsageDaySchema,
  status: agentUsageIndexStatusSchema,
  totals: agentUsageTotalsSchema,
  sessions: z.array(agentUsageSessionDetailSchema),
  modelDistribution: z.array(agentUsageDistributionEntrySchema),
  projectDistribution: z.array(agentUsageDistributionEntrySchema),
  dailySummary: agentUsageDailySummarySchema.nullable()
})

export type AgentUsageProvider = z.infer<typeof agentUsageProviderSchema>
export type AgentUsageTokenMetrics = z.infer<typeof agentUsageTokenMetricsSchema>
export type AgentUsageTotals = z.infer<typeof agentUsageTotalsSchema>
export type AgentUsageIndexStatus = z.infer<typeof agentUsageIndexStatusSchema>
export type AgentUsageDayBucket = z.infer<typeof agentUsageDayBucketSchema>
export type AgentUsageDailySummary = z.infer<typeof agentUsageDailySummarySchema>
export type AgentUsageSessionDetail = z.infer<typeof agentUsageSessionDetailSchema>
export type AgentUsageDistributionEntry = z.infer<typeof agentUsageDistributionEntrySchema>
export type AgentUsageYearResult = z.infer<typeof agentUsageYearResultSchema>
export type AgentUsageDayDetail = z.infer<typeof agentUsageDayDetailSchema>
