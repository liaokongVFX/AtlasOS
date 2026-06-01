import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { claudeHistoryListInputSchema, claudeHistorySessionInputSchema } from '@shared/ipc'
import type {
  ClaudeHistoryChildSessionDetail,
  ClaudeHistoryListResult,
  ClaudeHistoryProjectSummary,
  ClaudeHistorySessionDetail,
  ClaudeHistorySessionSummary,
  ClaudeHistoryTranscriptEntry
} from '@shared/claude-history'
import { handleValidated } from './ipc-helpers'

type JsonRecord = Record<string, unknown>

type MutableSession = {
  id: string
  sessionId: string
  projectId: string
  projectPath: string
  cwd?: string
  aiTitle?: string
  summary?: string
  firstPrompt?: string
  historyDisplay?: string
  createdAt?: string
  updatedAt?: string
  messageCount: number
  metadataOnly: boolean
  hasTranscript: boolean
  isSidechain: boolean
  childSessionKeys: string[]
  messages: ClaudeHistoryTranscriptEntry[]
}

type ClaudeHistoryIndex = {
  projects: ClaudeHistoryProjectSummary[]
  sessions: ClaudeHistorySessionSummary[]
  sessionDetails: Map<string, MutableSession>
}

type ParsedTranscript = {
  id: string
  sessionId: string
  projectPath: string
  cwd?: string
  agentId?: string
  aiTitle?: string
  summary?: string
  firstPrompt?: string
  createdAt?: string
  updatedAt?: string
  messageCount: number
  messages: ClaudeHistoryTranscriptEntry[]
}

const UUID_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i
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

  const date = new Date(timestamp)
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

function decodeProjectDirectoryName(name: string): string {
  const driveMatch = /^([A-Za-z])--(.+)$/.exec(name)
  if (driveMatch) {
    return `${driveMatch[1].toUpperCase()}:\\${driveMatch[2].split('-').filter(Boolean).join('\\')}`
  }

  return name.replace(/--/g, ':\\').replace(/-/g, '\\')
}

function sessionTitle(session: MutableSession): string {
  return (
    optionalString(session.aiTitle) ??
    optionalString(session.summary) ??
    optionalString(session.firstPrompt) ??
    optionalString(session.historyDisplay) ??
    `Session ${session.sessionId.slice(0, 8)}`
  )
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

function textFromContent(content: unknown): string | undefined {
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

function summarizeToolInput(input: unknown): string {
  if (!isRecord(input)) return truncateText(safeStringify(input))

  const command = optionalString(input.command)
  if (command) return truncateText(command)

  const path = optionalString(input.file_path) ?? optionalString(input.path) ?? optionalString(input.cwd)
  if (path) return path

  const keys = Object.keys(input)
  return keys.length > 0 ? `Input: ${keys.join(', ')}` : 'No input'
}

function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') return truncateText(content)
  if (!Array.isArray(content)) return truncateText(safeStringify(content))

  const parts = content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''
      if (item.type === 'text') return optionalString(item.text) ?? ''
      return optionalString(item.content) ?? ''
    })
    .filter(Boolean)

  return truncateText(parts.join('\n\n') || safeStringify(content))
}

function parseContentEntries(role: 'user' | 'assistant', content: unknown, timestamp: string | undefined, prefix: string): ClaudeHistoryTranscriptEntry[] {
  if (typeof content === 'string') {
    const text = optionalString(content)
    return text ? [{ id: prefix, role, kind: 'message', timestamp, text, collapsed: false }] : []
  }

  if (!Array.isArray(content)) return []

  const entries: ClaudeHistoryTranscriptEntry[] = []
  content.forEach((item, index) => {
    if (!isRecord(item)) return

    if (item.type === 'text') {
      const text = optionalString(item.text)
      if (text) entries.push({ id: `${prefix}-${index}`, role, kind: 'message', timestamp, text, collapsed: false })
      return
    }

    if (item.type === 'tool_use') {
      const name = optionalString(item.name) ?? 'tool'
      entries.push({
        id: `${prefix}-${index}`,
        role: 'tool',
        kind: 'tool_use',
        timestamp,
        title: `Tool: ${name}`,
        text: summarizeToolInput(item.input),
        collapsed: true
      })
      return
    }

    if (item.type === 'tool_result') {
      entries.push({
        id: `${prefix}-${index}`,
        role: 'tool',
        kind: 'tool_result',
        timestamp,
        title: 'Tool result',
        text: summarizeToolResult(item.content),
        collapsed: true,
        isError: item.is_error === true
      })
      return
    }

    if (item.type === 'image') {
      entries.push({
        id: `${prefix}-${index}`,
        role,
        kind: 'message',
        timestamp,
        title: 'Image',
        text: '[Image]',
        collapsed: true
      })
    }
  })

  return entries
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const root = resolve(rootPath)
  const target = resolve(targetPath)
  const pathRelativeToRoot = relative(root, target)
  return pathRelativeToRoot === '' || (!pathRelativeToRoot.startsWith('..') && !isAbsolute(pathRelativeToRoot))
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
      // Claude Code can leave partial lines during active writes; ignore malformed records.
    }
  }

  return records
}

function createMutableSession(input: {
  id: string
  sessionId: string
  projectPath: string
  isSidechain?: boolean
}): MutableSession {
  return {
    id: input.id,
    sessionId: input.sessionId,
    projectId: projectIdForPath(input.projectPath),
    projectPath: input.projectPath,
    messageCount: 0,
    metadataOnly: true,
    hasTranscript: false,
    isSidechain: input.isSidechain ?? false,
    childSessionKeys: [],
    messages: []
  }
}

function toSessionSummary(session: MutableSession): ClaudeHistorySessionSummary {
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
    summary: session.summary,
    messageCount: session.messageCount,
    childCount: session.childSessionKeys.length,
    metadataOnly: session.metadataOnly,
    hasTranscript: session.hasTranscript,
    isSidechain: session.isSidechain
  }
}

export class ClaudeHistoryService {
  constructor(private readonly claudeRoot = join(homedir(), '.claude')) {}

  registerIpc(): void {
    handleValidated('claude-history:list', claudeHistoryListInputSchema, () => this.list())
    handleValidated('claude-history:get-session', claudeHistorySessionInputSchema, (_, input) => this.getSession(input.sessionId))
  }

  async list(): Promise<ClaudeHistoryListResult> {
    const index = await this.loadIndex()
    return {
      projects: index.projects,
      sessions: index.sessions
    }
  }

  async getSession(sessionId: string): Promise<ClaudeHistorySessionDetail> {
    const index = await this.loadIndex()
    const session = [...index.sessionDetails.values()].find((candidate) => !candidate.isSidechain && candidate.sessionId === sessionId)

    if (!session) {
      throw new Error('Claude Code session not found')
    }

    const childSessions = session.childSessionKeys
      .map((key): ClaudeHistoryChildSessionDetail | null => {
        const childSession = index.sessionDetails.get(key)
        if (!childSession) return null
        return {
          summary: toSessionSummary(childSession),
          messages: childSession.messages
        }
      })
      .filter((child): child is ClaudeHistoryChildSessionDetail => Boolean(child))
      .sort((first, second) => compareIso(second.summary.updatedAt, first.summary.updatedAt))

    return {
      summary: toSessionSummary(session),
      messages: session.messages,
      childSessions
    }
  }

  private async loadIndex(): Promise<ClaudeHistoryIndex> {
    const sessionDetails = new Map<string, MutableSession>()

    if (!existsSync(this.claudeRoot)) {
      return { projects: [], sessions: [], sessionDetails }
    }

    await this.readHistoryJsonl(sessionDetails)
    await this.readProjects(sessionDetails)

    const topLevelSessions = [...sessionDetails.values()]
      .filter((session) => !session.isSidechain)
      .sort((first, second) => compareIso(second.updatedAt, first.updatedAt))
      .map(toSessionSummary)

    const projectsById = new Map<string, ClaudeHistoryProjectSummary>()
    for (const session of topLevelSessions) {
      const current = projectsById.get(session.projectId)
      const project: ClaudeHistoryProjectSummary = current ?? {
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
    return { projects, sessions: topLevelSessions, sessionDetails }
  }

  private upsertSession(
    sessions: Map<string, MutableSession>,
    input: {
      id: string
      sessionId: string
      projectPath: string
      isSidechain?: boolean
    }
  ): MutableSession {
    const existing = sessions.get(input.id)
    if (existing) {
      existing.projectPath = existing.projectPath || input.projectPath
      existing.projectId = projectIdForPath(existing.projectPath)
      return existing
    }

    const session = createMutableSession(input)
    sessions.set(input.id, session)
    return session
  }

  private mergeSessionPatch(
    session: MutableSession,
    patch: Partial<Pick<MutableSession, 'cwd' | 'aiTitle' | 'summary' | 'firstPrompt' | 'historyDisplay' | 'createdAt' | 'updatedAt'>> & {
      messageCount?: number
    }
  ): void {
    session.cwd = optionalString(session.cwd) ?? optionalString(patch.cwd)
    session.aiTitle = optionalString(patch.aiTitle) ?? optionalString(session.aiTitle)
    session.summary = optionalString(session.summary) ?? optionalString(patch.summary)
    session.firstPrompt = optionalString(session.firstPrompt) ?? optionalString(patch.firstPrompt)
    session.historyDisplay = optionalString(session.historyDisplay) ?? optionalString(patch.historyDisplay)
    session.createdAt = earliestIso(session.createdAt, patch.createdAt)
    session.updatedAt = latestIso(session.updatedAt, patch.updatedAt)
    session.messageCount = Math.max(session.messageCount, patch.messageCount ?? 0)
  }

  private async readHistoryJsonl(sessions: Map<string, MutableSession>): Promise<void> {
    const historyPath = join(this.claudeRoot, 'history.jsonl')
    if (!existsSync(historyPath)) return

    const records = await readJsonl(historyPath)
    for (const record of records) {
      const sessionId = optionalString(record.sessionId)
      const projectPath = optionalString(record.project)
      if (!sessionId || !projectPath) continue

      const session = this.upsertSession(sessions, {
        id: sessionId,
        sessionId,
        projectPath
      })
      const timestamp = isoFromTimestamp(record.timestamp)
      this.mergeSessionPatch(session, {
        historyDisplay: optionalString(record.display),
        createdAt: timestamp,
        updatedAt: timestamp,
        messageCount: 1
      })
    }
  }

  private async readProjects(sessions: Map<string, MutableSession>): Promise<void> {
    const projectsRoot = join(this.claudeRoot, 'projects')
    if (!existsSync(projectsRoot)) return

    const projectDirs = await readdir(projectsRoot, { withFileTypes: true })
    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue

      const projectDirPath = join(projectsRoot, projectDir.name)
      const projectPath = await this.projectPathForDirectory(projectDirPath, projectDir.name)
      const parsedFiles = new Set<string>()

      await this.readSessionsIndex(projectDirPath, projectPath, sessions, parsedFiles)
      await this.readPrimaryTranscripts(projectDirPath, projectPath, sessions, parsedFiles)
      await this.readSidechainTranscripts(projectDirPath, projectPath, sessions, parsedFiles)
    }
  }

  private async projectPathForDirectory(projectDirPath: string, directoryName: string): Promise<string> {
    const indexPath = join(projectDirPath, 'sessions-index.json')

    if (existsSync(indexPath)) {
      try {
        const value = JSON.parse(await readFile(indexPath, 'utf8')) as unknown
        if (isRecord(value)) {
          const originalPath = optionalString(value.originalPath)
          if (originalPath) return originalPath
        }
      } catch {
        // Fall back to transcript cwd or directory-name decoding.
      }
    }

    return decodeProjectDirectoryName(directoryName)
  }

  private async readSessionsIndex(projectDirPath: string, fallbackProjectPath: string, sessions: Map<string, MutableSession>, parsedFiles: Set<string>): Promise<void> {
    const indexPath = join(projectDirPath, 'sessions-index.json')
    if (!existsSync(indexPath)) return

    let value: unknown
    try {
      value = JSON.parse(await readFile(indexPath, 'utf8')) as unknown
    } catch {
      return
    }

    if (!isRecord(value) || !Array.isArray(value.entries)) return

    for (const rawEntry of value.entries) {
      if (!isRecord(rawEntry)) continue

      const sessionId = optionalString(rawEntry.sessionId)
      if (!sessionId || rawEntry.isSidechain === true) continue

      const projectPath = optionalString(rawEntry.projectPath) ?? optionalString(value.originalPath) ?? fallbackProjectPath
      const session = this.upsertSession(sessions, { id: sessionId, sessionId, projectPath })
      this.mergeSessionPatch(session, {
        summary: optionalString(rawEntry.summary),
        firstPrompt: optionalString(rawEntry.firstPrompt),
        createdAt: isoFromTimestamp(rawEntry.created),
        updatedAt: isoFromTimestamp(rawEntry.modified),
        messageCount: Math.max(0, Math.trunc(optionalNumber(rawEntry.messageCount) ?? 0))
      })

      const fullPath = optionalString(rawEntry.fullPath)
      if (!fullPath || !isPathInside(this.claudeRoot, fullPath) || !existsSync(fullPath)) continue
      if (parsedFiles.has(resolve(fullPath))) continue

      const parsed = await this.parseTranscriptFile(fullPath, {
        projectPath,
        fallbackSessionId: sessionId
      })
      parsedFiles.add(resolve(fullPath))
      this.applyParsedTranscript(sessions, sessionId, parsed, false)
    }
  }

  private async readPrimaryTranscripts(projectDirPath: string, fallbackProjectPath: string, sessions: Map<string, MutableSession>, parsedFiles: Set<string>): Promise<void> {
    const entries = await readdir(projectDirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile() || !UUID_FILE_PATTERN.test(entry.name)) continue

      const transcriptPath = join(projectDirPath, entry.name)
      const resolvedPath = resolve(transcriptPath)
      if (parsedFiles.has(resolvedPath)) continue

      const parsed = await this.parseTranscriptFile(transcriptPath, {
        projectPath: fallbackProjectPath,
        fallbackSessionId: entry.name.replace(/\.jsonl$/i, '')
      })
      parsedFiles.add(resolvedPath)
      this.applyParsedTranscript(sessions, parsed.sessionId, parsed, false)
    }
  }

  private async readSidechainTranscripts(projectDirPath: string, fallbackProjectPath: string, sessions: Map<string, MutableSession>, parsedFiles: Set<string>): Promise<void> {
    const entries = await readdir(projectDirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const subagentsPath = join(projectDirPath, entry.name, 'subagents')
      if (!existsSync(subagentsPath)) continue

      const subagentFiles = await readdir(subagentsPath, { withFileTypes: true })
      for (const subagentFile of subagentFiles) {
        if (!subagentFile.isFile() || !subagentFile.name.endsWith('.jsonl')) continue

        const transcriptPath = join(subagentsPath, subagentFile.name)
        const resolvedPath = resolve(transcriptPath)
        if (parsedFiles.has(resolvedPath)) continue

        const parsed = await this.parseTranscriptFile(transcriptPath, {
          projectPath: fallbackProjectPath,
          fallbackSessionId: entry.name
        })
        parsedFiles.add(resolvedPath)
        const childId = parsed.agentId ?? subagentFile.name.replace(/\.jsonl$/i, '')
        const childKey = `${parsed.sessionId}:${childId}`
        this.applyParsedTranscript(sessions, childKey, parsed, true)

        const parent = this.upsertSession(sessions, {
          id: parsed.sessionId,
          sessionId: parsed.sessionId,
          projectPath: parsed.projectPath
        })
        if (!parent.childSessionKeys.includes(childKey)) parent.childSessionKeys.push(childKey)
        this.mergeSessionPatch(parent, {
          cwd: parsed.cwd,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt
        })
      }
    }
  }

  private async parseTranscriptFile(
    transcriptPath: string,
    context: {
      projectPath: string
      fallbackSessionId: string
    }
  ): Promise<ParsedTranscript> {
    const records = await readJsonl(transcriptPath)
    const metadata = await stat(transcriptPath).catch(() => null)
    let sessionId = context.fallbackSessionId
    let projectPath = context.projectPath
    let cwd: string | undefined
    let agentId: string | undefined
    let aiTitle: string | undefined
    let summary: string | undefined
    let firstPrompt: string | undefined
    let createdAt: string | undefined
    let updatedAt: string | undefined
    let messageCount = 0
    const messages: ClaudeHistoryTranscriptEntry[] = []

    records.forEach((record, index) => {
      sessionId = optionalString(record.sessionId) ?? sessionId
      cwd = optionalString(record.cwd) ?? cwd
      agentId = optionalString(record.agentId) ?? agentId
      const timestamp = isoFromTimestamp(record.timestamp)
      createdAt = earliestIso(createdAt, timestamp)
      updatedAt = latestIso(updatedAt, timestamp)

      if (record.type === 'ai-title') {
        aiTitle = optionalString(record.aiTitle) ?? aiTitle
        return
      }

      if (record.type === 'summary') {
        summary = optionalString(record.summary) ?? summary
        return
      }

      if (record.type === 'last-prompt') {
        firstPrompt = firstPrompt ?? optionalString(record.lastPrompt)
        return
      }

      if (record.type !== 'user' && record.type !== 'assistant') return
      if (!isRecord(record.message)) return

      const role = record.message.role === 'assistant' ? 'assistant' : record.message.role === 'user' ? 'user' : null
      if (!role) return

      const content = record.message.content
      const plainText = textFromContent(content)
      if (role === 'user' && !firstPrompt && plainText) firstPrompt = plainText

      const parsedMessages = parseContentEntries(role, content, timestamp, optionalString(record.uuid) ?? `${sessionId}-${index}`)
      if (parsedMessages.length > 0) {
        messages.push(...parsedMessages)
        messageCount += 1
      }
    })

    const fallbackMtime = metadata ? new Date(metadata.mtimeMs).toISOString() : undefined
    return {
      id: sessionId,
      sessionId,
      projectPath,
      cwd,
      agentId,
      aiTitle,
      summary,
      firstPrompt,
      createdAt: createdAt ?? fallbackMtime,
      updatedAt: updatedAt ?? fallbackMtime,
      messageCount,
      messages
    }
  }

  private applyParsedTranscript(sessions: Map<string, MutableSession>, key: string, parsed: ParsedTranscript, isSidechain: boolean): void {
    const session = this.upsertSession(sessions, {
      id: key,
      sessionId: parsed.sessionId,
      projectPath: parsed.projectPath,
      isSidechain
    })

    this.mergeSessionPatch(session, {
      cwd: parsed.cwd,
      aiTitle: parsed.aiTitle,
      summary: parsed.summary,
      firstPrompt: parsed.firstPrompt,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      messageCount: parsed.messageCount
    })
    session.cwd = optionalString(parsed.cwd) ?? session.cwd
    session.aiTitle = optionalString(parsed.aiTitle) ?? session.aiTitle
    session.summary = optionalString(parsed.summary) ?? session.summary
    session.firstPrompt = optionalString(parsed.firstPrompt) ?? session.firstPrompt
    session.hasTranscript = true
    session.metadataOnly = false
    session.messages = parsed.messages
  }
}
