import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { codexHistoryListInputSchema, codexHistorySessionInputSchema } from '@shared/ipc'
import type {
  CodexHistoryListResult,
  CodexHistoryProjectSummary,
  CodexHistorySessionDetail,
  CodexHistorySessionSummary,
  CodexHistoryTranscriptEntry
} from '@shared/codex-history'
import { handleValidated } from './ipc-helpers'

type JsonRecord = Record<string, unknown>

type MutableSession = {
  id: string
  sessionId: string
  projectId: string
  projectPath: string
  cwd?: string
  title?: string
  firstPrompt?: string
  createdAt?: string
  updatedAt?: string
  messageCount: number
  metadataOnly: boolean
  hasTranscript: boolean
  isSidechain: false
  childSessionKeys: []
  messages: CodexHistoryTranscriptEntry[]
}

type CodexHistoryIndex = {
  projects: CodexHistoryProjectSummary[]
  sessions: CodexHistorySessionSummary[]
  sessionDetails: Map<string, MutableSession>
}

type ParsedRollout = {
  id: string
  sessionId: string
  projectPath: string
  cwd?: string
  title?: string
  firstPrompt?: string
  createdAt?: string
  updatedAt?: string
  isSidechain: boolean
  messages: CodexHistoryTranscriptEntry[]
}

const ROLLOUT_FILE_PATTERN = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/i
const MAX_TOOL_TEXT_LENGTH = 1400

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareIso(first: string | undefined, second: string | undefined): number {
  if (!first && !second) return 0
  if (!first) return -1
  if (!second) return 1
  return first.localeCompare(second)
}

function earliestIso(first: string | undefined, second: string | undefined): string | undefined {
  if (!first) return second
  if (!second) return first
  return first <= second ? first : second
}

function latestIso(first: string | undefined, second: string | undefined): string | undefined {
  if (!first) return second
  if (!second) return first
  return first >= second ? first : second
}

function isoFromTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  const timestamp = optionalNumber(value)
  if (timestamp === undefined) return undefined

  const date = new Date(timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '') || path
}

function projectIdForPath(path: string): string {
  return trimTrailingSeparators(path).toLowerCase()
}

function projectName(path: string): string {
  const trimmed = trimTrailingSeparators(path)
  return basename(trimmed) || trimmed
}

function sessionTitle(session: MutableSession): string {
  return optionalString(session.title) ?? optionalString(session.firstPrompt) ?? `Session ${session.sessionId.slice(0, 8)}`
}

function truncateText(value: string, maxLength = MAX_TOOL_TEXT_LENGTH): string {
  const normalized = value.replace(/\s+\n/g, '\n').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function textFromEventMessage(payload: JsonRecord): string | undefined {
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

function textFromResponseContent(content: unknown): string | undefined {
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

function isInternalFallbackUserText(text: string): boolean {
  const normalized = text.trim()
  return (
    normalized.includes('# AGENTS.md instructions for') ||
    normalized.includes('<environment_context>') ||
    normalized.includes('<permissions instructions>') ||
    normalized.includes('<app-context>') ||
    normalized.includes('<developer_context>') ||
    normalized.includes('<skills_instructions>') ||
    normalized.includes('<plugins_instructions>')
  )
}

function summarizeToolValue(value: unknown): string {
  if (typeof value === 'string') return truncateText(value)
  return truncateText(safeStringify(value))
}

function toolEntryFromResponseItem(payload: JsonRecord, timestamp: string | undefined, prefix: string): CodexHistoryTranscriptEntry | null {
  const type = optionalString(payload.type)
  if (!type) return null

  if (type === 'function_call' || type === 'custom_tool_call') {
    const name = optionalString(payload.name) ?? 'tool'
    const text = type === 'function_call' ? summarizeToolValue(payload.arguments) : summarizeToolValue(payload.input)
    return {
      id: prefix,
      role: 'tool',
      kind: 'tool_use',
      timestamp,
      title: `Tool: ${name}`,
      text,
      collapsed: true
    }
  }

  if (type === 'tool_search_call') {
    return {
      id: prefix,
      role: 'tool',
      kind: 'tool_use',
      timestamp,
      title: 'Tool: tool_search',
      text: summarizeToolValue(payload.arguments),
      collapsed: true
    }
  }

  if (type === 'function_call_output' || type === 'custom_tool_call_output' || type === 'tool_search_output') {
    const output = payload.output ?? payload.result ?? payload.tools ?? payload
    return {
      id: prefix,
      role: 'tool',
      kind: 'tool_result',
      timestamp,
      title: 'Tool result',
      text: summarizeToolValue(output),
      collapsed: true,
      isError: payload.status === 'failed' || payload.is_error === true
    }
  }

  return null
}

async function readJsonl(path: string): Promise<JsonRecord[]> {
  const contents = await readFile(path, 'utf8')
  const records: JsonRecord[] = []

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue

    try {
      const value = JSON.parse(line) as unknown
      if (isRecord(value)) records.push(value)
    } catch {
      // Codex can leave partial lines while an active session is being written.
    }
  }

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

function sessionIdFromRolloutPath(path: string): string | undefined {
  const match = ROLLOUT_FILE_PATTERN.exec(basename(path))
  return match?.[1]
}

function isSidechainPath(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .includes('subagents')
}

function isSidechainRecord(record: JsonRecord): boolean {
  return record.isSidechain === true || (isRecord(record.payload) && record.payload.isSidechain === true)
}

function createMutableSession(input: { id: string; sessionId: string; projectPath: string }): MutableSession {
  return {
    id: input.id,
    sessionId: input.sessionId,
    projectId: projectIdForPath(input.projectPath),
    projectPath: input.projectPath,
    messageCount: 0,
    metadataOnly: true,
    hasTranscript: false,
    isSidechain: false,
    childSessionKeys: [],
    messages: []
  }
}

function toSessionSummary(session: MutableSession): CodexHistorySessionSummary {
  return {
    id: session.id,
    sessionId: session.sessionId,
    projectId: session.projectId,
    projectPath: session.projectPath,
    title: sessionTitle(session),
    cwd: session.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    firstPrompt: session.firstPrompt,
    messageCount: session.messageCount,
    childCount: 0,
    metadataOnly: session.metadataOnly,
    hasTranscript: session.hasTranscript,
    isSidechain: false
  }
}

export class CodexHistoryService {
  constructor(private readonly codexRoot = join(homedir(), '.codex')) {}

  registerIpc(): void {
    handleValidated('codex-history:list', codexHistoryListInputSchema, () => this.list())
    handleValidated('codex-history:get-session', codexHistorySessionInputSchema, (_, input) => this.getSession(input.sessionId))
  }

  async list(): Promise<CodexHistoryListResult> {
    const index = await this.loadIndex()
    return {
      projects: index.projects,
      sessions: index.sessions
    }
  }

  async getSession(sessionId: string): Promise<CodexHistorySessionDetail> {
    const index = await this.loadIndex()
    const session = index.sessionDetails.get(sessionId)

    if (!session) {
      throw new Error('Codex session not found')
    }

    return {
      summary: toSessionSummary(session),
      messages: session.messages,
      childSessions: []
    }
  }

  private async loadIndex(): Promise<CodexHistoryIndex> {
    const sessionDetails = new Map<string, MutableSession>()

    if (!existsSync(this.codexRoot)) {
      return { projects: [], sessions: [], sessionDetails }
    }

    await this.readSessionIndex(sessionDetails)
    await this.readRollouts(sessionDetails)

    const sessions = [...sessionDetails.values()]
      .sort((first, second) => compareIso(second.updatedAt, first.updatedAt))
      .map(toSessionSummary)

    const projectsById = new Map<string, CodexHistoryProjectSummary>()
    for (const session of sessions) {
      const current = projectsById.get(session.projectId)
      const project: CodexHistoryProjectSummary = current ?? {
        id: session.projectId,
        name: projectName(session.projectPath),
        path: session.projectPath,
        sessionCount: 0,
        metadataOnlyCount: 0,
        lastActivityAt: undefined
      }

      project.sessionCount += 1
      if (session.metadataOnly) project.metadataOnlyCount += 1
      project.lastActivityAt = latestIso(project.lastActivityAt, session.updatedAt)
      projectsById.set(session.projectId, project)
    }

    const projects = [...projectsById.values()].sort((first, second) => compareIso(second.lastActivityAt, first.lastActivityAt))
    return { projects, sessions, sessionDetails }
  }

  private upsertSession(sessions: Map<string, MutableSession>, input: { id: string; sessionId: string; projectPath: string }): MutableSession {
    const existing = sessions.get(input.id)
    if (existing) {
      if (existing.projectPath === this.codexRoot && input.projectPath !== this.codexRoot) {
        existing.projectPath = input.projectPath
        existing.projectId = projectIdForPath(input.projectPath)
      }
      return existing
    }

    const session = createMutableSession(input)
    sessions.set(input.id, session)
    return session
  }

  private async readSessionIndex(sessions: Map<string, MutableSession>): Promise<void> {
    const indexPath = join(this.codexRoot, 'session_index.jsonl')
    if (!existsSync(indexPath)) return

    const records = await readJsonl(indexPath)
    for (const record of records) {
      const sessionId = optionalString(record.id)
      if (!sessionId) continue

      const session = this.upsertSession(sessions, {
        id: sessionId,
        sessionId,
        projectPath: this.codexRoot
      })
      session.title = optionalString(record.thread_name) ?? session.title
      session.updatedAt = latestIso(session.updatedAt, isoFromTimestamp(record.updated_at))
      session.createdAt = earliestIso(session.createdAt, isoFromTimestamp(record.updated_at))
    }
  }

  private async readRollouts(sessions: Map<string, MutableSession>): Promise<void> {
    const files = await listJsonlFiles(join(this.codexRoot, 'sessions'))
    for (const file of files) {
      const sessionId = sessionIdFromRolloutPath(file)
      if (!sessionId) continue

      const parsed = await this.parseRolloutFile(file, sessionId)
      if (parsed.isSidechain) continue

      const session = this.upsertSession(sessions, {
        id: parsed.id,
        sessionId: parsed.sessionId,
        projectPath: parsed.projectPath
      })

      session.cwd = optionalString(parsed.cwd) ?? session.cwd
      session.title = session.title ?? optionalString(parsed.title)
      session.firstPrompt = session.firstPrompt ?? optionalString(parsed.firstPrompt)
      session.createdAt = earliestIso(session.createdAt, parsed.createdAt)
      session.updatedAt = latestIso(session.updatedAt, parsed.updatedAt)
      session.messageCount = Math.max(session.messageCount, parsed.messages.filter((message) => message.role !== 'tool').length)
      session.metadataOnly = false
      session.hasTranscript = true
      session.messages = parsed.messages
    }
  }

  private async parseRolloutFile(path: string, fallbackSessionId: string): Promise<ParsedRollout> {
    const records = await readJsonl(path)
    const metadata = await stat(path).catch(() => null)
    let sessionId = fallbackSessionId
    let cwd: string | undefined
    let title: string | undefined
    let firstPrompt: string | undefined
    let createdAt: string | undefined
    let updatedAt: string | undefined
    let hasEventConversation = false
    let hasFallbackConversation = false
    const eventEntries: CodexHistoryTranscriptEntry[] = []
    const fallbackEntries: CodexHistoryTranscriptEntry[] = []
    let isSidechain = isSidechainPath(path)

    records.forEach((record, index) => {
      if (isSidechainRecord(record)) isSidechain = true

      const timestamp = isoFromTimestamp(record.timestamp)
      createdAt = earliestIso(createdAt, timestamp)
      updatedAt = latestIso(updatedAt, timestamp)

      if (record.type === 'session_meta' && isRecord(record.payload)) {
        sessionId = optionalString(record.payload.id) ?? sessionId
        cwd = optionalString(record.payload.cwd) ?? cwd
        const payloadTimestamp = isoFromTimestamp(record.payload.timestamp)
        createdAt = earliestIso(createdAt, payloadTimestamp)
        updatedAt = latestIso(updatedAt, payloadTimestamp)
        return
      }

      if (record.type === 'turn_context' && isRecord(record.payload)) {
        cwd = optionalString(record.payload.cwd) ?? cwd
        return
      }

      if (record.type === 'event_msg' && isRecord(record.payload)) {
        const eventType = optionalString(record.payload.type)

        if (eventType === 'thread_name_updated') {
          title = optionalString(record.payload.thread_name) ?? optionalString(record.payload.name) ?? optionalString(record.payload.title) ?? title
          return
        }

        if (eventType === 'user_message' || eventType === 'agent_message') {
          const text = textFromEventMessage(record.payload)
          if (!text) return

          const role = eventType === 'user_message' ? 'user' : 'assistant'
          if (role === 'user' && !firstPrompt) firstPrompt = text
          hasEventConversation = true
          eventEntries.push({
            id: `${sessionId}-event-${index}`,
            role,
            kind: 'message',
            timestamp,
            text,
            collapsed: false
          })
        }
        return
      }

      if (record.type !== 'response_item' || !isRecord(record.payload)) return

      const toolEntry = toolEntryFromResponseItem(record.payload, timestamp, `${sessionId}-tool-${index}`)
      if (toolEntry) {
        eventEntries.push(toolEntry)
        fallbackEntries.push(toolEntry)
        return
      }

      if (record.payload.type !== 'message') return
      const role = record.payload.role === 'assistant' ? 'assistant' : record.payload.role === 'user' ? 'user' : null
      if (!role) return

      const text = textFromResponseContent(record.payload.content)
      if (!text) return
      if (role === 'user' && isInternalFallbackUserText(text)) return

      if (role === 'user' && !firstPrompt) firstPrompt = text
      hasFallbackConversation = true
      fallbackEntries.push({
        id: `${sessionId}-fallback-${index}`,
        role,
        kind: 'message',
        timestamp,
        text,
        collapsed: false
      })
    })

    const fallbackMtime = metadata ? new Date(metadata.mtimeMs).toISOString() : undefined
    const messages = hasEventConversation || !hasFallbackConversation ? eventEntries : fallbackEntries
    const projectPath = cwd ?? this.codexRoot

    return {
      id: sessionId,
      sessionId,
      projectPath,
      cwd,
      title,
      firstPrompt,
      createdAt: createdAt ?? fallbackMtime,
      updatedAt: updatedAt ?? fallbackMtime,
      isSidechain,
      messages
    }
  }
}
