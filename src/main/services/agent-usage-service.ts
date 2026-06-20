import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { homedir } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_LOCALE, type Locale } from '@shared/constants'
import {
  agentUsageDayDetailSchema,
  agentUsageIndexStatusSchema,
  agentUsageYearResultSchema,
  type AgentUsageDailySummary,
  type AgentUsageDayDetail,
  type AgentUsageDistributionEntry,
  type AgentUsageIndexStatus,
  type AgentUsageProvider,
  type AgentUsageSessionDetail,
  type AgentUsageTokenMetrics,
  type AgentUsageTotals,
  type AgentUsageYearResult
} from '@shared/agent-usage'
import {
  agentUsageDayInputSchema,
  agentUsageGenerateSummaryInputSchema,
  agentUsageRefreshInputSchema,
  agentUsageYearInputSchema
} from '@shared/ipc'
import { aiSettingsSchema, type AiProfile } from '@shared/ai'
import { AppDatabaseService } from './app-database-service'
import { AppSettingsService } from './app-settings-service'
import { AiKeyStore } from './ai-key-store'
import { handleValidated } from './ipc-helpers'

type JsonRecord = Record<string, unknown>

type SourceFileData = {
  path: string
  provider: AgentUsageProvider
  kind: string
  content: string
  sha256: string
  size: number
  mtimeMs: number
  indexedAt: string
}

type IndexedSession = AgentUsageTokenMetrics & {
  provider: AgentUsageProvider
  sessionKey: string
  sessionId: string
  projectPath: string | null
  cwd: string | null
  title: string
  model: string | null
  isSidechain: boolean
  startedAt: string | null
  updatedAt: string | null
  messageCount: number
  toolCallCount: number
}

type IndexedEvent = AgentUsageTokenMetrics & {
  id: string
  provider: AgentUsageProvider
  sessionKey: string
  sessionId: string
  sourcePath: string
  day: string
  timestamp: string
  model: string | null
  projectPath: string | null
  cwd: string | null
  messageCount: number
  toolCallCount: number
}

type ParsedIndex = {
  sources: SourceFileData[]
  sessions: IndexedSession[]
  events: IndexedEvent[]
}

type SummarySnippet = {
  provider: AgentUsageProvider
  sessionKey: string
  sessionId: string
  projectPath: string | null
  cwd: string | null
  title: string | null
  model: string | null
  timestamp: string
  role: 'user' | 'assistant' | 'tool'
  text: string
}

type CodexTokenUsageTracker = {
  previousTotal: AgentUsageTokenMetrics | null
}

type CodexSessionState = {
  model: string | null
}

type AiTextRequest = {
  profile: AiProfile
  model: string
  apiKey: string
  system: string
  user: string
  maxTokens?: number
}

const ANTHROPIC_VERSION = '2023-06-01'
const SUMMARY_INPUT_CHAR_LIMIT = 120_000
const SUMMARY_CHUNK_CHAR_LIMIT = 42_000
const SUMMARY_MAX_CHUNKS = 6
const SNIPPET_TEXT_LIMIT = 4000
const LONG_BASE64_PATTERN = /\b[A-Za-z0-9+/]{120,}={0,2}\b/g
const ROLLOUT_FILE_PATTERN = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/i
const UUID_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptyTokens(): AgentUsageTokenMetrics {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  }
}

function clampToken(value: unknown): number {
  const number = optionalNumber(value)
  return number === undefined ? 0 : Math.max(0, Math.trunc(number))
}

function tokensTotal(tokens: Omit<AgentUsageTokenMetrics, 'totalTokens'>, reportedTotal?: unknown): number {
  const total = clampToken(reportedTotal)
  if (total > 0) return total

  return tokens.inputTokens + tokens.cachedInputTokens + tokens.cacheCreationInputTokens + tokens.outputTokens + tokens.reasoningOutputTokens
}

function addTokens(target: AgentUsageTokenMetrics, patch: AgentUsageTokenMetrics): void {
  target.inputTokens += patch.inputTokens
  target.cachedInputTokens += patch.cachedInputTokens
  target.cacheCreationInputTokens += patch.cacheCreationInputTokens
  target.outputTokens += patch.outputTokens
  target.reasoningOutputTokens += patch.reasoningOutputTokens
  target.totalTokens += patch.totalTokens
}

function subtractTokens(next: AgentUsageTokenMetrics, previous: AgentUsageTokenMetrics): AgentUsageTokenMetrics {
  const inputTokens = Math.max(0, next.inputTokens - previous.inputTokens)
  const cachedInputTokens = Math.max(0, next.cachedInputTokens - previous.cachedInputTokens)
  const cacheCreationInputTokens = Math.max(0, next.cacheCreationInputTokens - previous.cacheCreationInputTokens)
  const outputTokens = Math.max(0, next.outputTokens - previous.outputTokens)
  const reasoningOutputTokens = Math.max(0, next.reasoningOutputTokens - previous.reasoningOutputTokens)
  const totalTokens = Math.max(0, next.totalTokens - previous.totalTokens)

  return {
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: totalTokens || inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens + reasoningOutputTokens
  }
}

function timestampToIso(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value.trim())
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }

  const timestamp = optionalNumber(value)
  if (timestamp === undefined) return undefined

  const date = new Date(timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function localDayFromIso(iso: string): string {
  const date = new Date(iso)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function earliestIso(first: string | null, second: string | null): string | null {
  if (!first) return second
  if (!second) return first
  return first <= second ? first : second
}

function latestIso(first: string | null, second: string | null): string | null {
  if (!first) return second
  if (!second) return first
  return first >= second ? first : second
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncateText(value: string, limit = SNIPPET_TEXT_LIMIT): string {
  const normalized = value.replace(/\s+\n/g, '\n').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit - 1).trimEnd()}...`
}

function projectIdForPath(path: string | null): string {
  return (path ?? '').replace(/[\\/]+$/, '').toLowerCase()
}

function projectName(path: string | null): string {
  if (!path) return 'Unknown'
  const trimmed = path.replace(/[\\/]+$/, '') || path
  return basename(trimmed) || trimmed
}

function decodeClaudeProjectDirectoryName(name: string): string {
  const driveMatch = /^([A-Za-z])--(.+)$/.exec(name)
  if (driveMatch) {
    return `${driveMatch[1].toUpperCase()}:\\${driveMatch[2].split('-').filter(Boolean).join('\\')}`
  }

  return name.replace(/--/g, ':\\').replace(/-/g, '\\')
}

function readJsonl(content: string): Array<{ record: JsonRecord; index: number }> {
  const records: Array<{ record: JsonRecord; index: number }> = []

  content.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return

    try {
      const value = JSON.parse(line) as unknown
      if (isRecord(value)) records.push({ record: value, index })
    } catch {
      // Claude and Codex can leave partial JSONL lines while sessions are active.
    }
  })

  return records
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = []
  if (!existsSync(root)) return files

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path)
      }
    }
  }

  await walk(root)
  return files
}

function textFromClaudeContent(content: unknown): string | undefined {
  if (typeof content === 'string') return optionalString(content)
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''
      if (item.type === 'text') return optionalString(item.text) ?? ''
      return ''
    })
    .filter(Boolean)
    .join('\n\n')

  return optionalString(text)
}

function toolSummaryFromClaudeContent(content: unknown): string[] {
  if (!Array.isArray(content)) return []

  return content
    .map((item) => {
      if (!isRecord(item)) return ''

      if (item.type === 'tool_use') {
        const name = optionalString(item.name) ?? 'tool'
        const input = isRecord(item.input) ? optionalString(item.input.command) ?? optionalString(item.input.path) ?? safeStringify(item.input) : safeStringify(item.input)
        return `Tool ${name}: ${truncateText(input, 1200)}`
      }

      if (item.type === 'tool_result') {
        return `Tool result: ${truncateText(typeof item.content === 'string' ? item.content : safeStringify(item.content), 1200)}`
      }

      return ''
    })
    .filter(Boolean)
}

function countClaudeToolCalls(content: unknown): number {
  if (!Array.isArray(content)) return 0
  return content.filter((item) => isRecord(item) && item.type === 'tool_use').length
}

function claudeUsageFromMessage(message: JsonRecord): AgentUsageTokenMetrics {
  const usage = isRecord(message.usage) ? message.usage : null
  if (!usage) return emptyTokens()

  const tokens = {
    inputTokens: clampToken(usage.input_tokens),
    cachedInputTokens: clampToken(usage.cache_read_input_tokens),
    cacheCreationInputTokens: clampToken(usage.cache_creation_input_tokens),
    outputTokens: clampToken(usage.output_tokens),
    reasoningOutputTokens: 0
  }

  return {
    ...tokens,
    totalTokens: tokensTotal(tokens)
  }
}

function codexUsageFromRecord(record: JsonRecord, tracker: CodexTokenUsageTracker): AgentUsageTokenMetrics | null {
  if (record.type !== 'event_msg' || !isRecord(record.payload)) return null
  if (record.payload.type !== 'token_count' || !isRecord(record.payload.info)) return null

  const info = record.payload.info
  const last = isRecord(info.last_token_usage) ? codexUsageObject(info.last_token_usage) : null
  const total = isRecord(info.total_token_usage) ? codexUsageObject(info.total_token_usage) : null

  if (last) {
    tracker.previousTotal = total ?? tracker.previousTotal
    return last
  }

  if (!total) return null
  const delta = tracker.previousTotal ? subtractTokens(total, tracker.previousTotal) : total
  tracker.previousTotal = total
  return delta.totalTokens > 0 ? delta : null
}

function codexUsageObject(value: JsonRecord): AgentUsageTokenMetrics {
  const tokens = {
    inputTokens: clampToken(value.input_tokens),
    cachedInputTokens: clampToken(value.cached_input_tokens),
    cacheCreationInputTokens: 0,
    outputTokens: clampToken(value.output_tokens),
    reasoningOutputTokens: clampToken(value.reasoning_output_tokens)
  }

  return {
    ...tokens,
    totalTokens: tokensTotal(tokens, value.total_tokens)
  }
}

function codexModelFromRecord(record: JsonRecord): string | null {
  if (record.type === 'turn_context' && isRecord(record.payload)) return optionalString(record.payload.model) ?? null

  if (record.type !== 'event_msg' || !isRecord(record.payload)) return null
  const payloadModel = optionalString(record.payload.model)
  if (payloadModel) return payloadModel
  if (!isRecord(record.payload.info)) return null

  return optionalString(record.payload.info.model) ?? null
}

function textFromCodexEventMessage(payload: JsonRecord): string | undefined {
  const message = optionalString(payload.message)
  if (message) return message

  if (!Array.isArray(payload.text_elements)) return undefined

  const text = payload.text_elements
    .map((item) => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''
      return optionalString(item.text) ?? ''
    })
    .filter(Boolean)
    .join('\n\n')

  return optionalString(text)
}

function textFromCodexResponseContent(content: unknown): string | undefined {
  if (typeof content === 'string') return optionalString(content)
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''
      if (item.type === 'input_text' || item.type === 'output_text' || item.type === 'text') return optionalString(item.text) ?? ''
      return ''
    })
    .filter(Boolean)
    .join('\n\n')

  return optionalString(text)
}

function isInternalCodexUserText(text: string): boolean {
  return (
    text.includes('# AGENTS.md instructions for') ||
    text.includes('<environment_context>') ||
    text.includes('<permissions instructions>') ||
    text.includes('<app-context>') ||
    text.includes('<developer_context>') ||
    text.includes('<skills_instructions>') ||
    text.includes('<plugins_instructions>')
  )
}

function codexToolSummary(payload: JsonRecord): string | null {
  const type = optionalString(payload.type)
  if (!type) return null

  if (type === 'function_call' || type === 'custom_tool_call') {
    const name = optionalString(payload.name) ?? 'tool'
    const input = type === 'function_call' ? payload.arguments : payload.input
    return `Tool ${name}: ${truncateText(typeof input === 'string' ? input : safeStringify(input), 1200)}`
  }

  if (type === 'tool_search_call') {
    return `Tool tool_search: ${truncateText(safeStringify(payload.arguments), 1200)}`
  }

  if (type === 'function_call_output' || type === 'custom_tool_call_output' || type === 'tool_search_output') {
    const output = payload.output ?? payload.result ?? payload.tools ?? payload
    return `Tool result: ${truncateText(typeof output === 'string' ? output : safeStringify(output), 1200)}`
  }

  return null
}

function isCodexToolCall(payload: JsonRecord): boolean {
  return payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'tool_search_call'
}

function sessionIdFromCodexRolloutPath(path: string): string | undefined {
  return ROLLOUT_FILE_PATTERN.exec(basename(path))?.[1]
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/g, '')
}

function endpointUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`
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

function firstTextContent(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  return null
}

function parseOpenAiText(value: unknown): string {
  const record = isRecord(value) ? value : null
  const choices = Array.isArray(record?.choices) ? record.choices : []
  const firstChoice = isRecord(choices[0]) ? choices[0] : null
  const message = isRecord(firstChoice?.message) ? firstChoice.message : null
  const content = typeof message?.content === 'string' ? message.content : null
  if (!content) throw new Error('OpenAI response did not include summary text')
  return content.trim()
}

function parseAnthropicText(value: unknown): string {
  const record = isRecord(value) ? value : null
  const content = Array.isArray(record?.content) ? record.content : []
  const text = content.map(firstTextContent).filter((part): part is string => Boolean(part)).join('')
  if (!text) throw new Error('Anthropic response did not include summary text')
  return text.trim()
}

function redactSummaryInput(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s'"]+/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, '$1[REDACTED]')
    .replace(/(x-api-key\s*:\s*)[^\s'"]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|secret|token|password)\s*[:=]\s*)[^\s'"]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(LONG_BASE64_PATTERN, '[REDACTED_BASE64]')
}

function rowString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export class AgentUsageService {
  private readonly claudeRoot: string
  private readonly codexRoot: string
  private readonly keyStore: AiKeyStore
  private refreshInFlight: Promise<AgentUsageIndexStatus> | null = null

  constructor(
    private readonly options: {
      databaseService: AppDatabaseService
      appSettingsService: AppSettingsService
      keyStore?: AiKeyStore
      claudeRoot?: string
      codexRoot?: string
    }
  ) {
    this.claudeRoot = options.claudeRoot ?? join(homedir(), '.claude')
    this.codexRoot = options.codexRoot ?? join(homedir(), '.codex')
    this.keyStore = options.keyStore ?? new AiKeyStore()
  }

  registerIpc(): void {
    handleValidated('agent-usage:refresh', agentUsageRefreshInputSchema, () => this.refresh())
    handleValidated('agent-usage:get-year', agentUsageYearInputSchema, (_, input) => this.getYear(input.year))
    handleValidated('agent-usage:get-day', agentUsageDayInputSchema, (_, input) => this.getDay(input.day))
    handleValidated('agent-usage:generate-summary', agentUsageGenerateSummaryInputSchema, (_, input) =>
      this.generateSummary(input.day, input.locale, input.regenerate)
    )
  }

  async refresh(): Promise<AgentUsageIndexStatus> {
    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = this.rebuildIndex().finally(() => {
      this.refreshInFlight = null
    })

    return this.refreshInFlight
  }

  getYear(year = new Date().getFullYear()): AgentUsageYearResult {
    const db = this.options.databaseService.database()
    const startDay = `${year}-01-01`
    const endDay = `${year}-12-31`
    const rows = db
      .prepare(
        `
          SELECT
            day,
            SUM(input_tokens) AS input_tokens,
            SUM(cached_input_tokens) AS cached_input_tokens,
            SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(reasoning_output_tokens) AS reasoning_output_tokens,
            SUM(total_tokens) AS total_tokens,
            SUM(message_count) AS message_count,
            SUM(tool_call_count) AS tool_call_count,
            COUNT(DISTINCT session_key) AS session_count,
            COUNT(DISTINCT CASE WHEN provider = 'claude' THEN session_key END) AS claude_session_count,
            COUNT(DISTINCT CASE WHEN provider = 'codex' THEN session_key END) AS codex_session_count
          FROM agent_usage_events
          WHERE day >= ? AND day <= ?
          GROUP BY day
          ORDER BY day ASC
        `
      )
      .all(startDay, endDay)

    return agentUsageYearResultSchema.parse({
      year,
      status: this.getStatus(),
      days: rows.map((row) => {
        const record = row as Record<string, unknown>
        return {
          day: String(record.day),
          ...this.tokensFromRow(record),
          messageCount: rowNumber(record, 'message_count'),
          toolCallCount: rowNumber(record, 'tool_call_count'),
          sessionCount: rowNumber(record, 'session_count'),
          claudeSessionCount: rowNumber(record, 'claude_session_count'),
          codexSessionCount: rowNumber(record, 'codex_session_count')
        }
      })
    })
  }

  getDay(day: string): AgentUsageDayDetail {
    const db = this.options.databaseService.database()
    const sessionRows = db
      .prepare(
        `
          SELECT
            s.provider,
            s.session_key,
            s.session_id,
            s.project_path,
            s.cwd,
            s.title,
            COALESCE(MAX(e.model), s.model) AS model,
            s.is_sidechain,
            MIN(e.timestamp) AS started_at,
            MAX(e.timestamp) AS updated_at,
            SUM(e.input_tokens) AS input_tokens,
            SUM(e.cached_input_tokens) AS cached_input_tokens,
            SUM(e.cache_creation_input_tokens) AS cache_creation_input_tokens,
            SUM(e.output_tokens) AS output_tokens,
            SUM(e.reasoning_output_tokens) AS reasoning_output_tokens,
            SUM(e.total_tokens) AS total_tokens,
            SUM(e.message_count) AS message_count,
            SUM(e.tool_call_count) AS tool_call_count
          FROM agent_usage_events e
          JOIN agent_usage_sessions s ON s.session_key = e.session_key
          WHERE e.day = ?
          GROUP BY s.session_key
          ORDER BY total_tokens DESC, updated_at DESC
        `
      )
      .all(day)

    const sessions = sessionRows.map((row) => this.sessionDetailFromRow(row as Record<string, unknown>))
    const totals = this.totalsFromSessions(sessions)
    const modelDistribution = this.distributionForDay(day, "COALESCE(e.model, s.model, 'Unknown')")
    const projectDistribution = this.distributionForDay(day, "COALESCE(e.project_path, s.project_path, s.cwd, 'Unknown')")

    return agentUsageDayDetailSchema.parse({
      day,
      status: this.getStatus(),
      totals,
      sessions,
      modelDistribution,
      projectDistribution: projectDistribution.map((entry) => ({
        ...entry,
        name: entry.name === 'Unknown' ? entry.name : projectName(entry.name)
      })),
      dailySummary: this.getDailySummary(day)
    })
  }

  async generateSummary(day: string, locale: Locale = DEFAULT_LOCALE, regenerate = false): Promise<AgentUsageDayDetail> {
    const sourceDigest = this.sourceDigestForDay(day)
    const cached = this.getDailySummary(day)
    if (cached && !regenerate && cached.sourceDigest === sourceDigest) return this.getDay(day)

    const snippets = await this.extractSummarySnippets(day)
    const now = new Date().toISOString()
    const settings = await this.options.appSettingsService.getSettings()
    const aiSettings = aiSettingsSchema.parse(settings.ai)
    const profileId = aiSettings.dailySummary.profileId
    const model = aiSettings.dailySummary.model

    let summary: string
    let profile: AiProfile | null = null

    if (snippets.length === 0) {
      summary = locale === 'zh-CN' ? '这一天没有找到可用于生成日报的 Claude 或 Codex 对话内容。' : 'No Claude or Codex transcript content was found for this day.'
    } else {
      if (!profileId) throw new Error('Choose a Daily Summary provider in AI settings first')
      if (!model) throw new Error('Choose a Daily Summary model in AI settings first')

      profile = aiSettings.profiles.find((candidate) => candidate.id === profileId) ?? null
      if (!profile) throw new Error('Daily Summary provider does not exist')
      if (!profile.models.includes(model)) throw new Error('Daily Summary model does not belong to the selected provider')

      const apiKey = await this.keyStore.readKey(profile.id)
      if (!apiKey) throw new Error(`API key is not configured for ${profile.name}`)

      const context = redactSummaryInput(this.summaryContext(day, snippets, locale))
      summary = await this.generateSummaryText(profile, model, apiKey, day, context, locale)
    }

    this.options.databaseService.database()
      .prepare(
        `
          INSERT INTO agent_usage_daily_summaries (
            day,
            summary,
            generated_at,
            profile_id,
            profile_name,
            model,
            locale,
            source_digest
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(day) DO UPDATE SET
            summary = excluded.summary,
            generated_at = excluded.generated_at,
            profile_id = excluded.profile_id,
            profile_name = excluded.profile_name,
            model = excluded.model,
            locale = excluded.locale,
            source_digest = excluded.source_digest
        `
      )
      .run(day, summary, now, profile?.id ?? null, profile?.name ?? null, model ?? null, locale, sourceDigest)

    return this.getDay(day)
  }

  getStatus(): AgentUsageIndexStatus {
    const row = this.options.databaseService.database().prepare('SELECT * FROM agent_usage_index_status WHERE id = 1').get() as Record<string, unknown> | undefined

    return agentUsageIndexStatusSchema.parse({
      indexedAt: rowString(row ?? {}, 'indexed_at'),
      isRefreshing: Boolean(this.refreshInFlight),
      sourceFileCount: rowNumber(row ?? {}, 'source_file_count'),
      sessionCount: rowNumber(row ?? {}, 'session_count'),
      usageEventCount: rowNumber(row ?? {}, 'usage_event_count'),
      dayCount: rowNumber(row ?? {}, 'day_count'),
      error: rowString(row ?? {}, 'error')
    })
  }

  private async rebuildIndex(): Promise<AgentUsageIndexStatus> {
    try {
      const parsed = await this.parseVisibleHistory()
      const indexedAt = new Date().toISOString()
      const dayCount = new Set(parsed.events.map((event) => event.day)).size

      this.options.databaseService.transaction((db) => {
        db.exec(`
          DELETE FROM agent_usage_events;
          DELETE FROM agent_usage_sessions;
          DELETE FROM agent_usage_source_files;
        `)

        const insertSource = db.prepare(`
          INSERT INTO agent_usage_source_files (source_path, provider, source_kind, sha256, size, mtime_ms, indexed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const source of parsed.sources) {
          insertSource.run(source.path, source.provider, source.kind, source.sha256, source.size, source.mtimeMs, source.indexedAt)
        }

        const insertSession = db.prepare(`
          INSERT INTO agent_usage_sessions (
            session_key,
            provider,
            session_id,
            project_path,
            cwd,
            title,
            model,
            is_sidechain,
            started_at,
            updated_at,
            message_count,
            tool_call_count,
            input_tokens,
            cached_input_tokens,
            cache_creation_input_tokens,
            output_tokens,
            reasoning_output_tokens,
            total_tokens
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const session of parsed.sessions) {
          insertSession.run(
            session.sessionKey,
            session.provider,
            session.sessionId,
            session.projectPath,
            session.cwd,
            session.title,
            session.model,
            session.isSidechain ? 1 : 0,
            session.startedAt,
            session.updatedAt,
            session.messageCount,
            session.toolCallCount,
            session.inputTokens,
            session.cachedInputTokens,
            session.cacheCreationInputTokens,
            session.outputTokens,
            session.reasoningOutputTokens,
            session.totalTokens
          )
        }

        const insertEvent = db.prepare(`
          INSERT INTO agent_usage_events (
            id,
            provider,
            session_key,
            session_id,
            source_path,
            day,
            timestamp,
            model,
            project_path,
            cwd,
            message_count,
            tool_call_count,
            input_tokens,
            cached_input_tokens,
            cache_creation_input_tokens,
            output_tokens,
            reasoning_output_tokens,
            total_tokens
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const event of parsed.events) {
          insertEvent.run(
            event.id,
            event.provider,
            event.sessionKey,
            event.sessionId,
            event.sourcePath,
            event.day,
            event.timestamp,
            event.model,
            event.projectPath,
            event.cwd,
            event.messageCount,
            event.toolCallCount,
            event.inputTokens,
            event.cachedInputTokens,
            event.cacheCreationInputTokens,
            event.outputTokens,
            event.reasoningOutputTokens,
            event.totalTokens
          )
        }

        db.prepare(
          `
            UPDATE agent_usage_index_status
            SET indexed_at = ?,
                source_file_count = ?,
                session_count = ?,
                usage_event_count = ?,
                day_count = ?,
                error = NULL
            WHERE id = 1
          `
        ).run(indexedAt, parsed.sources.length, parsed.sessions.length, parsed.events.length, dayCount)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.databaseService.database()
        .prepare('UPDATE agent_usage_index_status SET error = ? WHERE id = 1')
        .run(message)
      throw error
    }

    return this.getStatus()
  }

  private async parseVisibleHistory(): Promise<ParsedIndex> {
    const sources = await this.collectSourceFiles()
    const sessions = new Map<string, IndexedSession>()
    const events: IndexedEvent[] = []
    const claudeProjectPaths = new Map<string, string>()

    for (const source of sources) {
      if (source.provider === 'claude' && source.kind === 'claude-history') {
        this.parseClaudeHistoryFile(source, sessions)
      } else if (source.provider === 'claude') {
        await this.parseClaudeTranscriptFile(source, sessions, events, claudeProjectPaths)
      } else {
        this.parseCodexRolloutFile(source, sessions, events)
      }
    }

    return {
      sources,
      sessions: [...sessions.values()],
      events
    }
  }

  private async collectSourceFiles(): Promise<SourceFileData[]> {
    const indexedAt = new Date().toISOString()
    const sourceInputs: Array<{ path: string; provider: AgentUsageProvider; kind: string }> = []
    const claudeHistoryPath = join(this.claudeRoot, 'history.jsonl')
    if (existsSync(claudeHistoryPath)) sourceInputs.push({ path: claudeHistoryPath, provider: 'claude', kind: 'claude-history' })

    for (const file of await listJsonlFiles(join(this.claudeRoot, 'projects'))) {
      sourceInputs.push({ path: file, provider: 'claude', kind: 'claude-project' })
    }

    for (const file of await listJsonlFiles(join(this.codexRoot, 'sessions'))) {
      sourceInputs.push({ path: file, provider: 'codex', kind: 'codex-session' })
    }

    for (const file of await listJsonlFiles(join(this.codexRoot, 'archived_sessions'))) {
      sourceInputs.push({ path: file, provider: 'codex', kind: 'codex-archived-session' })
    }

    const sources: SourceFileData[] = []
    for (const input of sourceInputs) {
      const metadata = await stat(input.path).catch(() => null)
      if (!metadata?.isFile()) continue

      const content = await readFile(input.path, 'utf8').catch(() => null)
      if (content === null) continue

      sources.push({
        ...input,
        content,
        sha256: hashText(content),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        indexedAt
      })
    }

    return sources
  }

  private parseClaudeHistoryFile(source: SourceFileData, sessions: Map<string, IndexedSession>): void {
    for (const { record } of readJsonl(source.content)) {
      const sessionId = optionalString(record.sessionId)
      const projectPath = optionalString(record.project)
      if (!sessionId || !projectPath) continue

      const timestamp = timestampToIso(record.timestamp) ?? new Date(source.mtimeMs).toISOString()
      const session = this.upsertSession(sessions, {
        provider: 'claude',
        sessionKey: `claude:${sessionId}`,
        sessionId,
        projectPath,
        cwd: null,
        title: `Claude ${sessionId.slice(0, 8)}`,
        model: null,
        isSidechain: false
      })
      session.startedAt = earliestIso(session.startedAt, timestamp)
      session.updatedAt = latestIso(session.updatedAt, timestamp)
    }
  }

  private async parseClaudeTranscriptFile(
    source: SourceFileData,
    sessions: Map<string, IndexedSession>,
    events: IndexedEvent[],
    projectPathCache: Map<string, string>
  ): Promise<void> {
    const projectPath = await this.claudeProjectPathForFile(source.path, projectPathCache)
    const records = readJsonl(source.content)
    const fallbackSessionId = UUID_FILE_PATTERN.test(basename(source.path)) ? basename(source.path).replace(/\.jsonl$/i, '') : hashText(source.path).slice(0, 12)
    const fallbackTimestamp = new Date(source.mtimeMs).toISOString()
    const sidechainPath = source.path.toLowerCase().includes(`${join('subagents').toLowerCase()}`)
    const agentIdFromFile = basename(source.path).replace(/\.jsonl$/i, '')

    let currentSessionId = fallbackSessionId
    let currentCwd: string | null = null
    let currentTitle: string | null = null

    for (const { record, index } of records) {
      currentSessionId = optionalString(record.sessionId) ?? currentSessionId
      currentCwd = optionalString(record.cwd) ?? currentCwd
      const timestamp = timestampToIso(record.timestamp) ?? fallbackTimestamp

      if (record.type === 'ai-title') {
        currentTitle = optionalString(record.aiTitle) ?? currentTitle
        continue
      }

      if (record.type === 'summary') {
        currentTitle = currentTitle ?? optionalString(record.summary) ?? null
        continue
      }

      if (record.type === 'last-prompt') {
        continue
      }

      if (record.type !== 'user' && record.type !== 'assistant') continue
      if (!isRecord(record.message)) continue

      const role = record.message.role === 'assistant' ? 'assistant' : record.message.role === 'user' ? 'user' : null
      if (!role) continue

      const isSidechain = sidechainPath || record.isSidechain === true
      const agentId = optionalString(record.agentId) ?? agentIdFromFile
      const sessionKey = isSidechain ? `claude:${currentSessionId}:sidechain:${agentId}` : `claude:${currentSessionId}`
      const model = optionalString(record.message.model) ?? null
      this.upsertSession(sessions, {
        provider: 'claude',
        sessionKey,
        sessionId: currentSessionId,
        projectPath,
        cwd: currentCwd,
        title: currentTitle ?? `Claude ${currentSessionId.slice(0, 8)}`,
        model,
        isSidechain
      })

      const tokens = role === 'assistant' ? claudeUsageFromMessage(record.message) : emptyTokens()
      this.addEvent(sessions, events, {
        ...tokens,
        id: hashText(`${source.path}:${index}:claude-message`),
        provider: 'claude',
        sessionKey,
        sessionId: currentSessionId,
        sourcePath: source.path,
        day: localDayFromIso(timestamp),
        timestamp,
        model,
        projectPath,
        cwd: currentCwd,
        messageCount: 1,
        toolCallCount: countClaudeToolCalls(record.message.content)
      })
    }
  }

  private parseCodexRolloutFile(source: SourceFileData, sessions: Map<string, IndexedSession>, events: IndexedEvent[]): void {
    const records = readJsonl(source.content)
    const fallbackSessionId = sessionIdFromCodexRolloutPath(source.path) ?? hashText(source.path).slice(0, 12)
    const fallbackTimestamp = new Date(source.mtimeMs).toISOString()
    const tracker: CodexTokenUsageTracker = { previousTotal: null }
    const state: CodexSessionState = { model: null }
    let sessionId = fallbackSessionId
    let cwd: string | null = null
    let title: string | null = null
    let hasEventConversation = false
    const fallbackMessageEvents: IndexedEvent[] = []

    const ensureSession = (model: string | null): string => {
      const sessionKey = `codex:${sessionId}`
      this.upsertSession(sessions, {
        provider: 'codex',
        sessionKey,
        sessionId,
        projectPath: cwd ?? this.codexRoot,
        cwd,
        title: title ?? `Codex ${sessionId.slice(0, 8)}`,
        model,
        isSidechain: false
      })
      return sessionKey
    }

    for (const { record, index } of records) {
      const timestamp = timestampToIso(record.timestamp) ?? fallbackTimestamp
      state.model = codexModelFromRecord(record) ?? state.model

      if (record.type === 'session_meta' && isRecord(record.payload)) {
        sessionId = optionalString(record.payload.id) ?? sessionId
        cwd = optionalString(record.payload.cwd) ?? cwd
        const payloadTimestamp = timestampToIso(record.payload.timestamp)
        const sessionKey = ensureSession(state.model)
        const session = sessions.get(sessionKey)
        if (session && payloadTimestamp) {
          session.startedAt = earliestIso(session.startedAt, payloadTimestamp)
          session.updatedAt = latestIso(session.updatedAt, payloadTimestamp)
        }
        continue
      }

      if (record.type === 'turn_context' && isRecord(record.payload)) {
        cwd = optionalString(record.payload.cwd) ?? cwd
        ensureSession(state.model)
        continue
      }

      if (record.type === 'event_msg' && isRecord(record.payload)) {
        const eventType = optionalString(record.payload.type)

        if (eventType === 'thread_name_updated') {
          title = optionalString(record.payload.thread_name) ?? optionalString(record.payload.name) ?? optionalString(record.payload.title) ?? title
          ensureSession(state.model)
          continue
        }

        if (eventType === 'user_message' || eventType === 'agent_message') {
          const text = textFromCodexEventMessage(record.payload)
          hasEventConversation = true
          const sessionKey = ensureSession(state.model)
          this.addEvent(sessions, events, {
            ...emptyTokens(),
            id: hashText(`${source.path}:${index}:codex-message`),
            provider: 'codex',
            sessionKey,
            sessionId,
            sourcePath: source.path,
            day: localDayFromIso(timestamp),
            timestamp,
            model: state.model,
            projectPath: cwd ?? this.codexRoot,
            cwd,
            messageCount: text ? 1 : 0,
            toolCallCount: 0
          })
          continue
        }

        const tokens = codexUsageFromRecord(record, tracker)
        if (tokens) {
          const sessionKey = ensureSession(state.model)
          this.addEvent(sessions, events, {
            ...tokens,
            id: hashText(`${source.path}:${index}:codex-token-count`),
            provider: 'codex',
            sessionKey,
            sessionId,
            sourcePath: source.path,
            day: localDayFromIso(timestamp),
            timestamp,
            model: state.model,
            projectPath: cwd ?? this.codexRoot,
            cwd,
            messageCount: 0,
            toolCallCount: 0
          })
        }
        continue
      }

      if (record.type !== 'response_item' || !isRecord(record.payload)) continue

      const toolCallCount = isCodexToolCall(record.payload) ? 1 : 0
      if (toolCallCount > 0) {
        const sessionKey = ensureSession(state.model)
        this.addEvent(sessions, events, {
          ...emptyTokens(),
          id: hashText(`${source.path}:${index}:codex-tool-call`),
          provider: 'codex',
          sessionKey,
          sessionId,
          sourcePath: source.path,
          day: localDayFromIso(timestamp),
          timestamp,
          model: state.model,
          projectPath: cwd ?? this.codexRoot,
          cwd,
          messageCount: 0,
          toolCallCount
        })
      }

      if (record.payload.type !== 'message') continue
      const role = record.payload.role === 'assistant' ? 'assistant' : record.payload.role === 'user' ? 'user' : null
      if (!role) continue

      const text = textFromCodexResponseContent(record.payload.content)
      if (!text || (role === 'user' && isInternalCodexUserText(text))) continue

      const sessionKey = ensureSession(state.model)
      fallbackMessageEvents.push({
        ...emptyTokens(),
        id: hashText(`${source.path}:${index}:codex-fallback-message`),
        provider: 'codex',
        sessionKey,
        sessionId,
        sourcePath: source.path,
        day: localDayFromIso(timestamp),
        timestamp,
        model: state.model,
        projectPath: cwd ?? this.codexRoot,
        cwd,
        messageCount: 1,
        toolCallCount: 0
      })
    }

    if (!hasEventConversation) {
      for (const event of fallbackMessageEvents) this.addEvent(sessions, events, event)
    }
  }

  private upsertSession(
    sessions: Map<string, IndexedSession>,
    input: {
      provider: AgentUsageProvider
      sessionKey: string
      sessionId: string
      projectPath: string | null
      cwd: string | null
      title: string
      model: string | null
      isSidechain: boolean
    }
  ): IndexedSession {
    const existing = sessions.get(input.sessionKey)
    if (existing) {
      existing.projectPath = existing.projectPath || input.projectPath
      existing.cwd = existing.cwd || input.cwd
      existing.title = existing.title.startsWith(`${input.provider === 'claude' ? 'Claude' : 'Codex'} `) ? input.title : existing.title
      existing.model = existing.model || input.model
      return existing
    }

    const session: IndexedSession = {
      ...emptyTokens(),
      provider: input.provider,
      sessionKey: input.sessionKey,
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      cwd: input.cwd,
      title: truncateText(input.title, 180) || input.sessionId,
      model: input.model,
      isSidechain: input.isSidechain,
      startedAt: null,
      updatedAt: null,
      messageCount: 0,
      toolCallCount: 0
    }
    sessions.set(session.sessionKey, session)
    return session
  }

  private addEvent(sessions: Map<string, IndexedSession>, events: IndexedEvent[], event: IndexedEvent): void {
    const session = sessions.get(event.sessionKey)
    if (session) {
      session.startedAt = earliestIso(session.startedAt, event.timestamp)
      session.updatedAt = latestIso(session.updatedAt, event.timestamp)
      session.model = session.model || event.model
      session.projectPath = session.projectPath || event.projectPath
      session.cwd = session.cwd || event.cwd
      session.messageCount += event.messageCount
      session.toolCallCount += event.toolCallCount
      addTokens(session, event)
    }

    events.push(event)
  }

  private async claudeProjectPathForFile(path: string, cache: Map<string, string>): Promise<string> {
    const projectsRoot = join(this.claudeRoot, 'projects')
    const pathRelativeToProjects = relative(projectsRoot, path)
    const projectDirectoryName = pathRelativeToProjects.split(/[\\/]/)[0]
    if (!projectDirectoryName || projectDirectoryName.startsWith('..')) return this.claudeRoot
    const cached = cache.get(projectDirectoryName)
    if (cached) return cached

    const projectDirPath = join(projectsRoot, projectDirectoryName)
    const indexPath = join(projectDirPath, 'sessions-index.json')
    let projectPath = decodeClaudeProjectDirectoryName(projectDirectoryName)

    try {
      const value = JSON.parse(await readFile(indexPath, 'utf8')) as unknown
      if (isRecord(value)) projectPath = optionalString(value.originalPath) ?? projectPath
    } catch {
      // Directory-name decoding is good enough when Claude's index is unavailable.
    }

    cache.set(projectDirectoryName, projectPath)
    return projectPath
  }

  private tokensFromRow(row: Record<string, unknown>): AgentUsageTokenMetrics {
    return {
      inputTokens: rowNumber(row, 'input_tokens'),
      cachedInputTokens: rowNumber(row, 'cached_input_tokens'),
      cacheCreationInputTokens: rowNumber(row, 'cache_creation_input_tokens'),
      outputTokens: rowNumber(row, 'output_tokens'),
      reasoningOutputTokens: rowNumber(row, 'reasoning_output_tokens'),
      totalTokens: rowNumber(row, 'total_tokens')
    }
  }

  private sessionDetailFromRow(row: Record<string, unknown>): AgentUsageSessionDetail {
    return {
      ...this.tokensFromRow(row),
      provider: rowString(row, 'provider') === 'codex' ? 'codex' : 'claude',
      sessionKey: rowString(row, 'session_key') ?? '',
      sessionId: rowString(row, 'session_id') ?? '',
      projectPath: rowString(row, 'project_path'),
      cwd: rowString(row, 'cwd'),
      title: rowString(row, 'title') ?? 'Session',
      model: rowString(row, 'model'),
      isSidechain: rowNumber(row, 'is_sidechain') === 1,
      startedAt: rowString(row, 'started_at'),
      updatedAt: rowString(row, 'updated_at'),
      messageCount: rowNumber(row, 'message_count'),
      toolCallCount: rowNumber(row, 'tool_call_count')
    }
  }

  private totalsFromSessions(sessions: AgentUsageSessionDetail[]): AgentUsageTotals {
    const totals: AgentUsageTotals = {
      ...emptyTokens(),
      messageCount: 0,
      toolCallCount: 0,
      sessionCount: sessions.length,
      claudeSessionCount: 0,
      codexSessionCount: 0
    }

    for (const session of sessions) {
      addTokens(totals, session)
      totals.messageCount += session.messageCount
      totals.toolCallCount += session.toolCallCount
      if (session.provider === 'claude') totals.claudeSessionCount += 1
      if (session.provider === 'codex') totals.codexSessionCount += 1
    }

    return totals
  }

  private distributionForDay(day: string, expression: string): AgentUsageDistributionEntry[] {
    const rows = this.options.databaseService.database()
      .prepare(
        `
          SELECT
            ${expression} AS name,
            COUNT(DISTINCT e.session_key) AS count,
            SUM(e.total_tokens) AS total_tokens
          FROM agent_usage_events e
          JOIN agent_usage_sessions s ON s.session_key = e.session_key
          WHERE e.day = ?
          GROUP BY name
          ORDER BY total_tokens DESC, count DESC, name ASC
          LIMIT 12
        `
      )
      .all(day)

    return rows.map((row) => {
      const record = row as Record<string, unknown>
      return {
        name: rowString(record, 'name') ?? 'Unknown',
        count: rowNumber(record, 'count'),
        totalTokens: rowNumber(record, 'total_tokens')
      }
    })
  }

  private getDailySummary(day: string): AgentUsageDailySummary | null {
    const row = this.options.databaseService.database()
      .prepare('SELECT * FROM agent_usage_daily_summaries WHERE day = ?')
      .get(day) as Record<string, unknown> | undefined

    if (!row) return null

    return {
      day,
      summary: rowString(row, 'summary') ?? '',
      generatedAt: rowString(row, 'generated_at') ?? '',
      profileId: rowString(row, 'profile_id'),
      profileName: rowString(row, 'profile_name'),
      model: rowString(row, 'model'),
      locale: rowString(row, 'locale') ?? DEFAULT_LOCALE,
      sourceDigest: rowString(row, 'source_digest') ?? ''
    }
  }

  private sourceDigestForDay(day: string): string {
    const rows = this.options.databaseService.database()
      .prepare(
        `
          SELECT DISTINCT sf.source_path, sf.sha256, sf.size, sf.mtime_ms
          FROM agent_usage_events e
          JOIN agent_usage_source_files sf ON sf.source_path = e.source_path
          WHERE e.day = ?
          ORDER BY sf.source_path ASC
        `
      )
      .all(day)

    return hashText(JSON.stringify(rows))
  }

  private async extractSummarySnippets(day: string): Promise<SummarySnippet[]> {
    const rows = this.options.databaseService.database()
      .prepare(
        `
          SELECT DISTINCT source_path, provider
          FROM agent_usage_events
          WHERE day = ?
          ORDER BY source_path ASC
        `
      )
      .all(day)

    const snippets: SummarySnippet[] = []
    const claudeProjectPaths = new Map<string, string>()

    for (const row of rows) {
      const sourcePath = rowString(row as Record<string, unknown>, 'source_path')
      const provider = rowString(row as Record<string, unknown>, 'provider')
      if (!sourcePath || (provider !== 'claude' && provider !== 'codex')) continue

      const metadata = await stat(sourcePath).catch(() => null)
      const content = await readFile(sourcePath, 'utf8').catch(() => null)
      if (!metadata || content === null) continue

      const source: SourceFileData = {
        path: sourcePath,
        provider,
        kind: provider,
        content,
        sha256: hashText(content),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        indexedAt: new Date().toISOString()
      }

      if (provider === 'claude') {
        snippets.push(...(await this.extractClaudeSnippets(source, day, claudeProjectPaths)))
      } else {
        snippets.push(...this.extractCodexSnippets(source, day))
      }
    }

    return snippets.sort((first, second) => first.timestamp.localeCompare(second.timestamp))
  }

  private async extractClaudeSnippets(source: SourceFileData, day: string, projectPathCache: Map<string, string>): Promise<SummarySnippet[]> {
    const projectPath = await this.claudeProjectPathForFile(source.path, projectPathCache)
    const fallbackSessionId = UUID_FILE_PATTERN.test(basename(source.path)) ? basename(source.path).replace(/\.jsonl$/i, '') : hashText(source.path).slice(0, 12)
    const fallbackTimestamp = new Date(source.mtimeMs).toISOString()
    const sidechainPath = source.path.toLowerCase().includes(`${join('subagents').toLowerCase()}`)
    const agentIdFromFile = basename(source.path).replace(/\.jsonl$/i, '')
    const snippets: SummarySnippet[] = []
    let sessionId = fallbackSessionId
    let cwd: string | null = null
    let title: string | null = null

    for (const { record } of readJsonl(source.content)) {
      sessionId = optionalString(record.sessionId) ?? sessionId
      cwd = optionalString(record.cwd) ?? cwd

      if (record.type === 'ai-title') {
        title = optionalString(record.aiTitle) ?? title
        continue
      }
      if (record.type === 'summary') {
        title = title ?? optionalString(record.summary) ?? null
        continue
      }

      if (record.type !== 'user' && record.type !== 'assistant') continue
      if (!isRecord(record.message)) continue

      const role = record.message.role === 'assistant' ? 'assistant' : record.message.role === 'user' ? 'user' : null
      if (!role) continue

      const timestamp = timestampToIso(record.timestamp) ?? fallbackTimestamp
      if (localDayFromIso(timestamp) !== day) continue

      const isSidechain = sidechainPath || record.isSidechain === true
      const sessionKey = isSidechain ? `claude:${sessionId}:sidechain:${optionalString(record.agentId) ?? agentIdFromFile}` : `claude:${sessionId}`
      const model = optionalString(record.message.model) ?? null
      const text = textFromClaudeContent(record.message.content)
      if (text) {
        snippets.push({
          provider: 'claude',
          sessionKey,
          sessionId,
          projectPath,
          cwd,
          title,
          model,
          timestamp,
          role,
          text: truncateText(text)
        })
      }

      for (const toolText of toolSummaryFromClaudeContent(record.message.content)) {
        snippets.push({
          provider: 'claude',
          sessionKey,
          sessionId,
          projectPath,
          cwd,
          title,
          model,
          timestamp,
          role: 'tool',
          text: toolText
        })
      }
    }

    return snippets
  }

  private extractCodexSnippets(source: SourceFileData, day: string): SummarySnippet[] {
    const fallbackSessionId = sessionIdFromCodexRolloutPath(source.path) ?? hashText(source.path).slice(0, 12)
    const fallbackTimestamp = new Date(source.mtimeMs).toISOString()
    const eventSnippets: SummarySnippet[] = []
    const fallbackSnippets: SummarySnippet[] = []
    const toolSnippets: SummarySnippet[] = []
    let sessionId = fallbackSessionId
    let cwd: string | null = null
    let title: string | null = null
    let model: string | null = null

    for (const { record } of readJsonl(source.content)) {
      const timestamp = timestampToIso(record.timestamp) ?? fallbackTimestamp
      model = codexModelFromRecord(record) ?? model

      if (record.type === 'session_meta' && isRecord(record.payload)) {
        sessionId = optionalString(record.payload.id) ?? sessionId
        cwd = optionalString(record.payload.cwd) ?? cwd
        continue
      }

      if (record.type === 'turn_context' && isRecord(record.payload)) {
        cwd = optionalString(record.payload.cwd) ?? cwd
        continue
      }

      if (record.type === 'event_msg' && isRecord(record.payload)) {
        if (record.payload.type === 'thread_name_updated') {
          title = optionalString(record.payload.thread_name) ?? optionalString(record.payload.name) ?? optionalString(record.payload.title) ?? title
          continue
        }

        if ((record.payload.type === 'user_message' || record.payload.type === 'agent_message') && localDayFromIso(timestamp) === day) {
          const text = textFromCodexEventMessage(record.payload)
          if (!text) continue

          eventSnippets.push({
            provider: 'codex',
            sessionKey: `codex:${sessionId}`,
            sessionId,
            projectPath: cwd ?? this.codexRoot,
            cwd,
            title,
            model,
            timestamp,
            role: record.payload.type === 'user_message' ? 'user' : 'assistant',
            text: truncateText(text)
          })
        }
        continue
      }

      if (record.type !== 'response_item' || !isRecord(record.payload) || localDayFromIso(timestamp) !== day) continue

      const toolText = codexToolSummary(record.payload)
      if (toolText) {
        toolSnippets.push({
          provider: 'codex',
          sessionKey: `codex:${sessionId}`,
          sessionId,
          projectPath: cwd ?? this.codexRoot,
          cwd,
          title,
          model,
          timestamp,
          role: 'tool',
          text: toolText
        })
        continue
      }

      if (record.payload.type !== 'message') continue
      const role = record.payload.role === 'assistant' ? 'assistant' : record.payload.role === 'user' ? 'user' : null
      if (!role) continue

      const text = textFromCodexResponseContent(record.payload.content)
      if (!text || (role === 'user' && isInternalCodexUserText(text))) continue

      fallbackSnippets.push({
        provider: 'codex',
        sessionKey: `codex:${sessionId}`,
        sessionId,
        projectPath: cwd ?? this.codexRoot,
        cwd,
        title,
        model,
        timestamp,
        role,
        text: truncateText(text)
      })
    }

    return [...(eventSnippets.length > 0 ? eventSnippets : fallbackSnippets), ...toolSnippets]
  }

  private summaryContext(day: string, snippets: SummarySnippet[], locale: Locale): string {
    const lines: string[] = [
      `Date: ${day}`,
      `Locale: ${locale}`,
      'The following are redacted local Claude and Codex transcript excerpts grouped by provider/session/project.',
      ''
    ]
    let currentGroup = ''

    for (const snippet of snippets) {
      const group = `${snippet.provider}:${snippet.sessionKey}`
      if (group !== currentGroup) {
        currentGroup = group
        lines.push('')
        lines.push(`## ${snippet.provider.toUpperCase()} ${snippet.title ?? snippet.sessionId}`)
        lines.push(`Session: ${snippet.sessionId}${snippet.sessionKey.includes('sidechain') ? ' (child/subagent)' : ''}`)
        if (snippet.model) lines.push(`Model: ${snippet.model}`)
        lines.push(`Project: ${snippet.projectPath ?? snippet.cwd ?? 'Unknown'}`)
      }

      const time = new Date(snippet.timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      lines.push(`[${time}] ${snippet.role}: ${snippet.text}`)
    }

    return lines.join('\n').slice(0, SUMMARY_INPUT_CHAR_LIMIT)
  }

  private async generateSummaryText(profile: AiProfile, model: string, apiKey: string, day: string, context: string, locale: Locale): Promise<string> {
    const chunks = this.chunkSummaryInput(context)
    const languageInstruction =
      locale === 'zh-CN'
        ? '请用中文输出一份结构清晰、简洁但信息密度高的日报。'
        : 'Write the report in clear, concise English.'
    const system = [
      'You write daily engineering work reports from local Claude and Codex transcripts.',
      'Group related work by project/session when useful.',
      'Mention important decisions, implementation work, verification, blockers, and next steps.',
      'Do not reveal secrets or raw credentials.',
      languageInstruction
    ].join(' ')

    if (chunks.length === 1) {
      return this.requestAiText({
        profile,
        model,
        apiKey,
        system,
        user: `Create the daily report for ${day} from this transcript context:\n\n${chunks[0]}`,
        maxTokens: 2200
      })
    }

    const partialSummaries: string[] = []
    for (let index = 0; index < chunks.length; index += 1) {
      partialSummaries.push(
        await this.requestAiText({
          profile,
          model,
          apiKey,
          system,
          user: `Summarize part ${index + 1}/${chunks.length} of the ${day} transcript. Preserve concrete work items and decisions.\n\n${chunks[index]}`,
          maxTokens: 1200
        })
      )
    }

    return this.requestAiText({
      profile,
      model,
      apiKey,
      system,
      user: `Merge these partial summaries into one daily report for ${day}:\n\n${partialSummaries.join('\n\n---\n\n')}`,
      maxTokens: 2200
    })
  }

  private chunkSummaryInput(context: string): string[] {
    if (context.length <= SUMMARY_CHUNK_CHAR_LIMIT) return [context]

    const chunks: string[] = []
    for (let offset = 0; offset < context.length && chunks.length < SUMMARY_MAX_CHUNKS; offset += SUMMARY_CHUNK_CHAR_LIMIT) {
      chunks.push(context.slice(offset, offset + SUMMARY_CHUNK_CHAR_LIMIT))
    }

    if (context.length > SUMMARY_CHUNK_CHAR_LIMIT * SUMMARY_MAX_CHUNKS) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n\n[Transcript truncated because the day exceeded the local summary budget.]`
    }

    return chunks
  }

  private async requestAiText({ profile, model, apiKey, system, user, maxTokens = 2048 }: AiTextRequest): Promise<string> {
    if (profile.format === 'anthropic') {
      const payload = await requestJson(endpointUrl(profile.baseUrl, '/messages'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
          temperature: 0.2,
          system,
          messages: [{ role: 'user', content: user }]
        })
      })

      return parseAnthropicText(payload)
    }

    const payload = await requestJson(endpointUrl(profile.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })

    return parseOpenAiText(payload)
  }
}
