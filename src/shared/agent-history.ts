import { z } from 'zod'

export const agentHistoryTranscriptKindSchema = z.enum(['message', 'tool_use', 'tool_result'])
export const agentHistoryTranscriptRoleSchema = z.enum(['user', 'assistant', 'tool'])

export const agentHistoryTranscriptEntrySchema = z.object({
  id: z.string().min(1),
  role: agentHistoryTranscriptRoleSchema,
  kind: agentHistoryTranscriptKindSchema,
  timestamp: z.string().optional(),
  title: z.string().optional(),
  text: z.string(),
  collapsed: z.boolean().default(false),
  isError: z.boolean().optional()
})

export const agentHistorySessionSummarySchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  projectPath: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  firstPrompt: z.string().optional(),
  summary: z.string().optional(),
  messageCount: z.number().int().nonnegative(),
  childCount: z.number().int().nonnegative().default(0),
  metadataOnly: z.boolean(),
  hasTranscript: z.boolean(),
  isSidechain: z.boolean().default(false)
})

export const agentHistoryProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  sessionCount: z.number().int().nonnegative(),
  metadataOnlyCount: z.number().int().nonnegative(),
  lastActivityAt: z.string().optional()
})

export const agentHistoryChildSessionDetailSchema = z.object({
  summary: agentHistorySessionSummarySchema,
  messages: z.array(agentHistoryTranscriptEntrySchema)
})

export const agentHistorySessionDetailSchema = z.object({
  summary: agentHistorySessionSummarySchema,
  messages: z.array(agentHistoryTranscriptEntrySchema),
  childSessions: z.array(agentHistoryChildSessionDetailSchema)
})

export const agentHistoryListResultSchema = z.object({
  projects: z.array(agentHistoryProjectSummarySchema),
  sessions: z.array(agentHistorySessionSummarySchema)
})

export type AgentHistoryTranscriptEntry = z.infer<typeof agentHistoryTranscriptEntrySchema>
export type AgentHistorySessionSummary = z.infer<typeof agentHistorySessionSummarySchema>
export type AgentHistoryProjectSummary = z.infer<typeof agentHistoryProjectSummarySchema>
export type AgentHistoryChildSessionDetail = z.infer<typeof agentHistoryChildSessionDetailSchema>
export type AgentHistorySessionDetail = z.infer<typeof agentHistorySessionDetailSchema>
export type AgentHistoryListResult = z.infer<typeof agentHistoryListResultSchema>
