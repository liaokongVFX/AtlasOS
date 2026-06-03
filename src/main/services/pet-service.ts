import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app, BrowserWindow, Notification, screen, type WebContents } from 'electron'
import { z } from 'zod'
import {
  petAlertInputSchema,
  petClearAlertsInputSchema,
  petOpenTargetInputSchema,
  petSetInteractiveInputSchema,
  petSetPositionInputSchema,
  petSnoozeAlertInputSchema,
  petUpdateSettingsInputSchema
} from '@shared/ipc'
import {
  petAlertSchema,
  petAgentSessionSchema,
  petRuntimeStateSchema,
  type PetAgentSource,
  type PetAgentStatus,
  type PetAgentSession,
  type PetAlert,
  type PetAlertTarget,
  type PetRuntimeState
} from '@shared/pet'
import type { AppSettings, CanvasComponent, CanvasDocument } from '@shared/schema'
import { handleValidated } from './ipc-helpers'
import { CanvasPersistence } from './canvas-persistence'
import { AppSettingsService } from './app-settings-service'

type PetServiceOptions = {
  persistence: CanvasPersistence
  appSettingsService: AppSettingsService
  loadPetRenderer: (window: BrowserWindow) => Promise<void>
  openTarget: (target: PetAlertTarget) => Promise<void>
  onAgentProviderSessionResolved?: (context: AgentProviderSessionResolvedContext) => void
}

type StoredPetState = {
  bridgeToken: string
  alerts: PetAlert[]
}

type AgentHookBridgeEnvironmentContext = {
  sessionId: string
  canvasId?: string
  componentId: string
  title?: string
  cwd: string
}

type AgentCommandStartedContext = AgentHookBridgeEnvironmentContext & {
  source: PetAgentSource
}

type AgentProviderSessionResolvedContext = {
  terminalSessionId: string
  source: PetAgentSource
  providerSessionId: string
  componentId: string
  canvasId?: string
  cwd?: string
}

type AgentHookRequestContext = {
  hookName?: string
  sessionId?: string
  componentId?: string
  canvasId?: string
  cwd?: string
  title?: string
}

type AgentBridgeRoute = {
  source: PetAgentSource
  context: AgentHookRequestContext
}

type AgentHookEventKind = Extract<PetAgentStatus, 'running' | 'waiting_for_confirmation' | 'completed' | 'error' | 'idle_unknown'>

type AgentHookEventInput = {
  source: PetAgentSource
  event: AgentHookEventKind
  hookName: string
  title?: string
  sessionTitle?: string
  body?: string
  sessionId?: string
  terminalSessionId?: string
  providerSessionId?: string
  componentId?: string
  canvasId?: string
  cwd?: string
}

type NormalizedAgentHookEvent = { kind: 'event'; event: AgentHookEventInput } | { kind: 'ignored' }

const PET_STATE_DIR = 'pet'
const PET_STATE_FILE = 'state.json'
const PET_HOOK_FORWARDER_FILE = 'agent-hook-forwarder.cjs'
const PET_HOOK_BRIDGE_FILE = 'agent-hook-bridge.json'
const CLAUDE_SETTINGS_DIR = '.claude'
const CLAUDE_SETTINGS_FILE = 'settings.json'
const CODEX_SETTINGS_DIR = '.codex'
const CODEX_HOOKS_FILE = 'hooks.json'
const CODEX_CONFIG_FILE = 'config.toml'
const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'PermissionDenied',
  'Elicitation',
  'ElicitationResult',
  'Stop',
  'StopFailure',
  'SessionEnd',
  'TaskCreated',
  'TaskCompleted',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop'
] as const
const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop'
] as const
const MAX_ALERTS = 100
const KANBAN_SCAN_INTERVAL_MS = 60_000
const CODEX_HOOK_TIMEOUT_SEC = 5
const PET_ORB_SIZE = 72
const PET_WINDOW_PADDING = 12
const PET_PANEL_GAP = 12
const PET_PANEL_WIDTH = 260
const PET_ORB_OFFSET_X = PET_WINDOW_PADDING + PET_PANEL_WIDTH + PET_PANEL_GAP
const PET_WINDOW_WIDTH = PET_WINDOW_PADDING * 2 + PET_PANEL_WIDTH * 2 + PET_PANEL_GAP * 2 + PET_ORB_SIZE
const PET_WINDOW_HEIGHT = 420
const AGENT_HOOK_FORWARDER_SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { URL, URLSearchParams } = require('node:url')

const source = String(process.argv[2] || process.env.ATLAS_PET_SOURCE || '').toLowerCase()
const hookName = String(process.argv[3] || process.env.ATLAS_PET_HOOK_EVENT || '')

if (!['claude', 'codex'].includes(source)) process.exit(0)

const terminalSessionId = process.env.ATLAS_TERMINAL_SESSION_ID
const terminalComponentId = process.env.ATLAS_TERMINAL_COMPONENT_ID
if (!terminalSessionId || !terminalComponentId) process.exit(0)

const bridgeConfigPath = process.env.ATLAS_PET_BRIDGE_CONFIG || path.join(__dirname, 'agent-hook-bridge.json')

function readBridgeConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(bridgeConfigPath, 'utf8'))
    if (!config || config.enabled === false) return {}
    return config
  } catch {
    return {}
  }
}

const bridgeConfig = readBridgeConfig()
const bridgeUrl = process.env.ATLAS_PET_BRIDGE_URL || bridgeConfig.bridgeUrl
const token = process.env.ATLAS_PET_BRIDGE_TOKEN || bridgeConfig.token

if (!bridgeUrl || !token) process.exit(0)

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  const query = new URLSearchParams()
  const fields = {
    sessionId: 'ATLAS_TERMINAL_SESSION_ID',
    componentId: 'ATLAS_TERMINAL_COMPONENT_ID',
    canvasId: 'ATLAS_CANVAS_ID',
    cwd: 'ATLAS_TERMINAL_CWD',
    title: 'ATLAS_TERMINAL_TITLE'
  }

  for (const [key, envName] of Object.entries(fields)) {
    const value = process.env[envName]
    if (value) query.set(key, value)
  }
  if (hookName) query.set('hookName', hookName)

  const baseUrl = bridgeUrl.endsWith('/') ? bridgeUrl.slice(0, -1) : bridgeUrl
  const endpoint = new URL(baseUrl + '/' + source)
  endpoint.search = query.toString()
  const body = input.trim() || '{}'
  const request = http.request(
    endpoint,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-atlas-pet-token': token
      }
    },
    (response) => {
      response.resume()
      response.on('end', () => process.exit(0))
    }
  )

  request.setTimeout(2000, () => {
    request.destroy()
    process.exit(0)
  })
  request.on('error', () => process.exit(0))
  request.end(body)
})

if (process.stdin.isTTY) process.stdin.emit('end')
`

const JSON_WRITE_RETRY_DELAYS_MS = [10, 25, 50]

type PetPanelSide = 'left' | 'right'

type PetWindowLayout = {
  x: number
  y: number
  panelSide: PetPanelSide
  orbOffset: {
    x: number
    y: number
  }
  orbPosition: {
    x: number
    y: number
  }
}

type WorkArea = {
  x: number
  y: number
  width: number
  height: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function todayDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmpPath, filePath)
      return
    } catch (error) {
      const code = isRecord(error) ? error.code : undefined
      if (code !== 'EEXIST' && code !== 'EPERM') throw error

      await rm(filePath, { force: true })
      try {
        await rename(tmpPath, filePath)
        return
      } catch (renameError) {
        const renameCode = isRecord(renameError) ? renameError.code : undefined
        const delay = JSON_WRITE_RETRY_DELAYS_MS[attempt]
        if (delay === undefined || (renameCode !== 'EPERM' && renameCode !== 'ENOENT')) throw renameError
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function isAgentAttentionAlert(alert: PetAlert): boolean {
  return alert.kind === 'agent_waiting' || alert.kind === 'agent_error'
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asOptionalString(record[key])
    if (value) return value
  }
  return undefined
}

function canonicalHookEventName(value: unknown): string | undefined {
  const raw = asOptionalString(value)
  if (!raw) return undefined

  const compact = raw.replace(/[^a-z0-9]/gi, '').toLowerCase()
  const known: Record<string, string> = {
    elicitation: 'Elicitation',
    elicitationrequest: 'Elicitation',
    elicitationresult: 'ElicitationResult',
    notification: 'Notification',
    permissiondenied: 'PermissionDenied',
    permissionrequest: 'PermissionRequest',
    postcompact: 'PostCompact',
    posttooluse: 'PostToolUse',
    posttoolusefailure: 'PostToolUseFailure',
    precompact: 'PreCompact',
    pretooluse: 'PreToolUse',
    sessionend: 'SessionEnd',
    sessionstart: 'SessionStart',
    stop: 'Stop',
    stopfailure: 'StopFailure',
    subagentstart: 'SubagentStart',
    subagentstop: 'SubagentStop',
    taskcreated: 'TaskCreated',
    taskcompleted: 'TaskCompleted',
    userpromptsubmit: 'UserPromptSubmit'
  }
  return known[compact] ?? raw
}

function isAgentSource(value: string | undefined): value is PetAgentSource {
  return value === 'codex' || value === 'claude'
}

function notificationStatus(payload: Record<string, unknown>): AgentHookEventKind | null {
  const notificationType = firstString(payload, ['notification_type', 'notificationType', 'type'])
  const compactType = notificationType?.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (compactType === 'permissionprompt' || compactType === 'elicitationdialog') return 'waiting_for_confirmation'
  if (compactType === 'idleprompt') return null
  if (compactType === 'sessionend' || compactType === 'taskcompleted' || compactType === 'completed') return 'completed'
  if (compactType === 'error' || compactType === 'failure' || compactType === 'failed') return 'error'

  const message = firstString(payload, ['message', 'notification_message', 'notificationMessage', 'body', 'reason'])
  if (!message) return null

  if (/\b(completed?|done|finished|succeeded|succeeds?|success|ended|stopped)\b/i.test(message)) return 'completed'
  if (/\b(api error|errors?|failed|failure|exception|crashed|rate[-\s]?limit|quota|billing|authentication|unauthorized|timeout|timed out|connection)\b/i.test(message)) {
    return 'error'
  }

  return null
}

function isAgentInputRequestToolName(toolName: string): boolean {
  return /^(askuserquestion|elicitation|requestuserinput)$/i.test(toolName.replace(/[^a-z0-9]/gi, ''))
}

function hookToolInputDetail(toolInput: Record<string, unknown>): string | undefined {
  const detail = firstString(toolInput, ['command', 'description', 'question', 'prompt', 'file_path', 'path'])
  if (detail) return detail

  const question = Array.isArray(toolInput.questions) ? toolInput.questions.find(isRecord) : undefined
  return question ? firstString(question, ['question', 'header', 'prompt', 'description']) : undefined
}

function hookEventStatus(hookName: string, payload: Record<string, unknown>): AgentHookEventKind | null {
  if (hookName === 'Notification') return notificationStatus(payload)

  if (hookName === 'PermissionRequest' || hookName === 'Elicitation') {
    return 'waiting_for_confirmation'
  }

  if (hookName === 'PreToolUse') {
    const toolName = firstString(payload, ['tool_name', 'toolName'])
    if (toolName && isAgentInputRequestToolName(toolName)) return 'waiting_for_confirmation'
  }

  if (hookName === 'StopFailure') return 'error'
  if (hookName === 'Stop' || hookName === 'SessionEnd' || hookName === 'TaskCompleted') return 'completed'
  if (hookName === 'SessionStart') return 'idle_unknown'
  if (
    hookName === 'UserPromptSubmit' ||
    hookName === 'PreToolUse' ||
    hookName === 'PostToolUse' ||
    hookName === 'PostToolUseFailure' ||
    hookName === 'PermissionDenied' ||
    hookName === 'ElicitationResult' ||
    hookName === 'TaskCreated' ||
    hookName === 'PreCompact' ||
    hookName === 'PostCompact' ||
    hookName === 'SubagentStart' ||
    hookName === 'SubagentStop'
  ) {
    return 'running'
  }

  return null
}

function shouldRecordProviderSession(hookName: string): boolean {
  return hookName !== 'SubagentStart' && hookName !== 'SubagentStop'
}

function hookBody(hookName: string, payload: Record<string, unknown>): string | undefined {
  if (hookName === 'StopFailure') {
    const error = firstString(payload, ['error', 'error_type', 'errorType'])
    const detail = firstString(payload, ['error_details', 'errorDetails', 'error_message', 'errorMessage', 'message', 'last_assistant_message', 'lastAssistantMessage'])
    const body = error && detail ? `${error}: ${detail}` : detail || error
    if (body) return body.slice(0, 1000)
  }

  const message = firstString(payload, [
    'message',
    'notification_message',
    'reason',
    'stopReason',
    'error_details',
    'errorDetails',
    'error',
    'error_message',
    'permissionDecisionReason'
  ])
  if (message) return message.slice(0, 1000)

  const toolName = firstString(payload, ['tool_name', 'toolName'])
  const toolInput = isRecord(payload.tool_input) ? payload.tool_input : isRecord(payload.toolInput) ? payload.toolInput : null
  const detail = toolInput ? hookToolInputDetail(toolInput) : undefined
  if (toolName) return detail ? `${toolName}: ${detail}`.slice(0, 1000) : toolName

  return hookName
}

function normalizeAgentHookEvent(source: PetAgentSource, payload: unknown, context: AgentHookRequestContext): NormalizedAgentHookEvent | null {
  if (!isRecord(payload)) return null
  if (!context.sessionId || !context.componentId) return { kind: 'ignored' }

  const hookName = canonicalHookEventName(firstString(payload, ['hook_event_name', 'hookEventName', 'event_name', 'eventName', 'event']) || context.hookName)
  if (!hookName) return null

  const event = hookEventStatus(hookName, payload)
  if (!event) return hookName === 'Notification' ? { kind: 'ignored' } : null

  const componentId = context.componentId
  const canvasId = context.canvasId
  const cwd = context.cwd || firstString(payload, ['cwd', 'workspace_dir', 'workspaceDir'])
  const terminalSessionId = context.sessionId
  const providerSessionId = firstString(payload, ['session_id', 'sessionId', 'thread_id', 'threadId'])
  const sessionId = agentSessionId(source, terminalSessionId, providerSessionId)

  return {
    kind: 'event',
    event: {
      source,
      event,
      hookName,
      sessionId,
      terminalSessionId,
      providerSessionId,
      componentId,
      canvasId,
      sessionTitle: context.title || firstString(payload, ['session_title', 'sessionTitle', 'thread_title', 'threadTitle', 'title']),
      cwd,
      body: hookBody(hookName, payload)
    }
  }
}

function routeContext(url: URL): AgentHookRequestContext {
  return {
    hookName: canonicalHookEventName(url.searchParams.get('hookName') ?? url.searchParams.get('eventName') ?? undefined),
    sessionId: asOptionalString(url.searchParams.get('sessionId') ?? undefined),
    componentId: asOptionalString(url.searchParams.get('componentId') ?? undefined),
    canvasId: asOptionalString(url.searchParams.get('canvasId') ?? undefined),
    cwd: asOptionalString(url.searchParams.get('cwd') ?? undefined),
    title: asOptionalString(url.searchParams.get('title') ?? undefined)
  }
}

function parseAgentBridgeRoute(requestUrl: string | undefined): AgentBridgeRoute | null {
  const url = new URL(requestUrl || '/', 'http://127.0.0.1')
  const context = routeContext(url)

  const hookMatch = /^\/agent-hook\/([^/]+)$/.exec(url.pathname)
  const hookSource = hookMatch?.[1]?.toLowerCase()
  if (isAgentSource(hookSource)) {
    return { source: hookSource, context }
  }

  return null
}

function claudeSettingsDir(): string {
  return join(homedir(), CLAUDE_SETTINGS_DIR)
}

function claudeSettingsPath(): string {
  return join(claudeSettingsDir(), CLAUDE_SETTINGS_FILE)
}

function codexSettingsDir(): string {
  return join(homedir(), CODEX_SETTINGS_DIR)
}

function codexHooksPath(): string {
  return join(codexSettingsDir(), CODEX_HOOKS_FILE)
}

function codexConfigPath(): string {
  return join(codexSettingsDir(), CODEX_CONFIG_FILE)
}

function quoteCommandArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function hookArgs(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => (typeof item === 'string' ? [item] : [])) : []
}

function commandContainsAtlasProviderHook(source: PetAgentSource, command: string): boolean {
  return command.includes(PET_HOOK_FORWARDER_FILE) && new RegExp(`\\b${source}\\b`, 'i').test(command)
}

function isAtlasProviderHook(source: PetAgentSource, value: unknown): boolean {
  if (!isRecord(value)) return false

  const command = asString(value.command)
  if (commandContainsAtlasProviderHook(source, command)) return true

  const args = hookArgs(value.args)
  return args.some((arg) => arg.includes(PET_HOOK_FORWARDER_FILE)) && args.some((arg) => new RegExp(`^${source}$`, 'i').test(arg))
}

function isRunnableAtlasProviderHook(source: PetAgentSource, value: unknown, eventName?: string): boolean {
  if (!isAtlasProviderHook(source, value)) return false
  if (source !== 'codex') return true
  if (!isRecord(value)) return false

  return (
    value.type === 'command' &&
    typeof value.command === 'string' &&
    value.async === false &&
    (!eventName || commandContainsAtlasProviderHook('codex', value.command) && new RegExp(`\\b${eventName}\\b`, 'i').test(value.command))
  )
}

function atlasClaudeHook(command: string, args: string[]): Record<string, unknown> {
  return {
    type: 'command',
    command,
    args,
    async: true,
    timeout: 5
  }
}

function atlasCodexHook(command: string): Record<string, unknown> {
  return {
    type: 'command',
    command,
    commandWindows: null,
    async: false,
    timeoutSec: CODEX_HOOK_TIMEOUT_SEC,
    statusMessage: null
  }
}

function normalizeHookGroup(source: PetAgentSource, value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null

  const hooks = Array.isArray(value.hooks) ? value.hooks.filter((hook) => !isAtlasProviderHook(source, hook)) : []
  const nextGroup = { ...value, hooks }
  return hooks.length > 0 ? nextGroup : null
}

function installHookForEvent(source: PetAgentSource, value: unknown, hook: Record<string, unknown>): Array<Record<string, unknown>> {
  const groups = Array.isArray(value) ? value : []
  const preservedGroups = groups.flatMap((group) => {
    const normalized = normalizeHookGroup(source, group)
    return normalized ? [normalized] : []
  })

  return [
    ...preservedGroups,
    {
      matcher: '',
      hooks: [hook]
    }
  ]
}

const pendingJsonWrites = new Map<string, Promise<void>>()

async function writeJsonQueued(filePath: string, value: unknown): Promise<void> {
  const previous = pendingJsonWrites.get(filePath) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => writeJsonAtomic(filePath, value))
  pendingJsonWrites.set(filePath, next)
  try {
    await next
  } finally {
    if (pendingJsonWrites.get(filePath) === next) pendingJsonWrites.delete(filePath)
  }
}

function removeAtlasProviderHooks(source: PetAgentSource, hooks: Record<string, unknown>): Record<string, unknown> {
  const nextHooks: Record<string, unknown> = { ...hooks }
  for (const [eventName, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) continue

    const groups = value.flatMap((group) => {
      const normalized = normalizeHookGroup(source, group)
      return normalized ? [normalized] : []
    })
    if (groups.length > 0) {
      nextHooks[eventName] = groups
    } else {
      delete nextHooks[eventName]
    }
  }
  return nextHooks
}

function eventHasAtlasProviderHook(source: PetAgentSource, value: unknown): boolean {
  if (!Array.isArray(value)) return false

  return value.some((group) => {
    if (!isRecord(group) || !Array.isArray(group.hooks)) return false
    return group.hooks.some((hook) => isAtlasProviderHook(source, hook))
  })
}

function eventHasRunnableAtlasProviderHook(source: PetAgentSource, value: unknown, eventName?: string): boolean {
  if (!Array.isArray(value)) return false

  return value.some((group) => {
    if (!isRecord(group) || !Array.isArray(group.hooks)) return false
    return group.hooks.some((hook) => isRunnableAtlasProviderHook(source, hook, eventName))
  })
}

function codexHooksDisabled(configText: string): boolean {
  let section = ''
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim()
    if (!line) continue

    const sectionMatch = /^\[([^\]]+)\]$/.exec(line)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      continue
    }

    if (section === 'features' && /^hooks\s*=\s*false\b/i.test(line)) return true
    if (!section && /^codex_hooks\s*=\s*false\b/i.test(line)) return true
  }

  return false
}

function readCards(component: CanvasComponent): Record<string, Record<string, unknown>> {
  const kanban = component.state.kanban
  if (!isRecord(kanban) || !isRecord(kanban.cards)) return {}

  const cards: Record<string, Record<string, unknown>> = {}
  for (const [cardId, card] of Object.entries(kanban.cards)) {
    if (isRecord(card)) cards[cardId] = card
  }
  return cards
}

function readActiveKanbanCardIds(component: CanvasComponent): string[] {
  const kanban = component.state.kanban
  if (!isRecord(kanban) || !Array.isArray(kanban.columns)) return Object.keys(readCards(component))

  const ids: string[] = []
  for (const column of kanban.columns) {
    if (!isRecord(column) || asString(column.id) === 'done' || !Array.isArray(column.cardIds)) continue
    for (const cardId of column.cardIds) {
      if (typeof cardId === 'string') ids.push(cardId)
    }
  }
  return ids
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function nearestDisplayWorkArea(position: { x: number; y: number }): WorkArea {
  const nearestPoint = {
    x: position.x + Math.floor(PET_ORB_SIZE / 2),
    y: position.y + Math.floor(PET_ORB_SIZE / 2)
  }
  const display = screen.getDisplayNearestPoint(nearestPoint)
  return display.workArea
}

function petWindowLayout(settings: AppSettings): PetWindowLayout {
  const workArea = nearestDisplayWorkArea(settings.pet.position)
  const maxOrbX = workArea.x + workArea.width - PET_ORB_SIZE
  const maxOrbY = workArea.y + workArea.height - PET_ORB_SIZE
  const orbX = clamp(settings.pet.position.x, workArea.x, maxOrbX)
  const orbY = clamp(settings.pet.position.y, workArea.y, maxOrbY)
  const sideSpace = PET_PANEL_WIDTH + PET_PANEL_GAP
  const canOpenRight = workArea.x + workArea.width - (orbX + PET_ORB_SIZE) >= sideSpace
  const canOpenLeft = orbX - workArea.x >= sideSpace
  const panelSide: PetPanelSide = canOpenRight || !canOpenLeft ? 'right' : 'left'
  const maxWindowY = workArea.y + workArea.height - PET_WINDOW_HEIGHT
  const windowY = clamp(orbY - PET_WINDOW_PADDING, workArea.y, maxWindowY)

  return {
    x: orbX - PET_ORB_OFFSET_X,
    y: windowY,
    panelSide,
    orbOffset: {
      x: PET_ORB_OFFSET_X,
      y: orbY - windowY
    },
    orbPosition: {
      x: orbX,
      y: orbY
    }
  }
}

function normalizeStoredState(value: unknown): StoredPetState {
  if (!isRecord(value)) return { bridgeToken: randomUUID(), alerts: [] }

  const alerts = Array.isArray(value.alerts)
    ? value.alerts.flatMap((alert) => {
        const result = petAlertSchema.safeParse(alert)
        if (!result.success) return []
        return isAgentAttentionAlert(result.data) && !result.data.readAt ? [{ ...result.data, readAt: nowIso() }] : [result.data]
      })
    : []

  return {
    bridgeToken: asString(value.bridgeToken) || randomUUID(),
    alerts: alerts.slice(0, MAX_ALERTS)
  }
}

function eventStatus(event: AgentHookEventInput['event']): PetAgentSession['status'] {
  if (event === 'waiting_for_confirmation') return 'waiting_for_confirmation'
  if (event === 'completed') return 'completed'
  if (event === 'error') return 'error'
  if (event === 'idle_unknown') return 'idle_unknown'
  return 'running'
}

function isTerminalAgentStatus(status: PetAgentSession['status'] | undefined): boolean {
  return status === 'completed' || status === 'error'
}

function visibleAgentSessions(agentSessions: Map<string, PetAgentSession>): PetAgentSession[] {
  return [...agentSessions.values()].filter((session) => session.status !== 'completed')
}

function agentSessionId(source: PetAgentSource, terminalSessionId: string, providerSessionId: string | undefined): string {
  return providerSessionId ? `${terminalSessionId}:${source}:${providerSessionId}` : terminalSessionId
}

function canRestartTerminalAgentStatus(event: AgentHookEventInput): boolean {
  return event.hookName === 'UserPromptSubmit' || event.hookName === 'SessionStart'
}

function shouldIgnoreAgentStatusTransition(current: PetAgentSession | undefined, event: AgentHookEventInput): boolean {
  const nextStatus = eventStatus(event.event)
  return isTerminalAgentStatus(current?.status) && (nextStatus === 'running' || nextStatus === 'idle_unknown') && !canRestartTerminalAgentStatus(event)
}

function agentEventLabel(event: AgentHookEventInput['event']): string {
  if (event === 'waiting_for_confirmation') return 'is asking'
  if (event === 'completed') return 'completed'
  if (event === 'error') return 'reported an error'
  if (event === 'idle_unknown') return 'is ready'
  return 'is running'
}

function alertForAgentEvent(event: AgentHookEventInput, session: PetAgentSession): PetAlert | null {
  if (event.event === 'running' || event.event === 'idle_unknown') return null

  const createdAt = nowIso()
  const severity = event.event === 'error' ? 'danger' : event.event === 'waiting_for_confirmation' ? 'warning' : 'info'
  const kind = event.event === 'error' ? 'agent_error' : event.event === 'completed' ? 'agent_completed' : 'agent_waiting'
  const title = event.title || `${event.source === 'codex' ? 'Codex' : 'Claude Code'} ${agentEventLabel(event.event)}`

  return {
    id: randomUUID(),
    kind,
    severity,
    title,
    body: event.body || session.cwd || '',
    target: {
      canvasId: session.canvasId,
      componentId: session.componentId,
      sessionId: session.id
    },
    createdAt,
    dedupeKey: `agent:${session.id}:${event.event}:${session.lastActivityAt}`
  }
}

export class PetService {
  private readonly stateDir = join(app.getPath('userData'), PET_STATE_DIR)
  private readonly statePath = join(this.stateDir, PET_STATE_FILE)
  private readonly hookForwarderPath = join(this.stateDir, PET_HOOK_FORWARDER_FILE)
  private readonly hookBridgeConfigPath = join(this.stateDir, PET_HOOK_BRIDGE_FILE)
  private petWindow: BrowserWindow | null = null
  private storedState: StoredPetState = { bridgeToken: randomUUID(), alerts: [] }
  private agentSessions = new Map<string, PetAgentSession>()
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private bridgeServer: Server | null = null
  private bridgePort = 0

  constructor(private readonly options: PetServiceOptions) {}

  async start(): Promise<void> {
    this.storedState = await this.readStoredState()
    await this.writeHookForwarder()
    this.registerIpc()
    await this.ensureBridge()
    await this.writeHookBridgeConfig()
    await this.ensurePetWindow()
    await this.scanKanban()

    if (!this.scanTimer) {
      this.scanTimer = setInterval(() => {
        void this.scanKanban()
      }, KANBAN_SCAN_INTERVAL_MS)
    }
  }

  getAgentHookEnvironment(context: AgentHookBridgeEnvironmentContext): Record<string, string> {
    if (!this.bridgePort) return {}

    const env: Record<string, string> = {
      ATLAS_PET_BRIDGE_URL: `http://127.0.0.1:${this.bridgePort}/agent-hook`,
      ATLAS_PET_BRIDGE_TOKEN: this.storedState.bridgeToken,
      ATLAS_PET_BRIDGE_CONFIG: this.hookBridgeConfigPath,
      ATLAS_PET_HOOK_FORWARDER: this.hookForwarderPath,
      ATLAS_TERMINAL_SESSION_ID: context.sessionId,
      ATLAS_TERMINAL_COMPONENT_ID: context.componentId,
      ATLAS_TERMINAL_CWD: context.cwd
    }

    if (context.canvasId) env.ATLAS_CANVAS_ID = context.canvasId
    if (context.title) env.ATLAS_TERMINAL_TITLE = context.title
    return env
  }

  recordAgentCommandStarted(context: AgentCommandStartedContext): void {
    const current = this.agentSessions.get(context.sessionId)
    if (current && current.status !== 'completed' && current.status !== 'error') return

    this.upsertAgentSession({
      id: context.sessionId,
      terminalSessionId: context.sessionId,
      source: context.source,
      status: 'idle_unknown',
      canvasId: context.canvasId || 'unknown-canvas',
      componentId: context.componentId,
      title: context.title || (context.source === 'codex' ? 'Codex' : 'Claude Code'),
      cwd: context.cwd,
      lastActivityAt: nowIso()
    })
  }

  async installClaudeHooks(): Promise<PetRuntimeState['bridge']['claudeHook']> {
    const settings = await this.readClaudeSettingsFile()
    const hooks = isRecord(settings.hooks) ? removeAtlasProviderHooks('claude', settings.hooks) : {}
    const command = this.claudeHookCommand()
    const args = this.claudeHookArgs()
    const hook = atlasClaudeHook(command, args)

    for (const eventName of CLAUDE_HOOK_EVENTS) {
      hooks[eventName] = installHookForEvent('claude', hooks[eventName], hook)
    }

    await mkdir(claudeSettingsDir(), { recursive: true })
    await writeJsonAtomic(claudeSettingsPath(), { ...settings, hooks })
    const status = await this.getClaudeHookStatus()
    await this.broadcastState()
    return status
  }

  async installCodexHooks(): Promise<PetRuntimeState['bridge']['codexHook']> {
    const settings = await this.readCodexHooksFile()
    const hooks = isRecord(settings.hooks) ? removeAtlasProviderHooks('codex', settings.hooks) : {}

    for (const eventName of CODEX_HOOK_EVENTS) {
      const hook = atlasCodexHook(this.codexHookCommand(eventName))
      hooks[eventName] = installHookForEvent('codex', hooks[eventName], hook)
    }

    await mkdir(codexSettingsDir(), { recursive: true })
    await writeJsonAtomic(codexHooksPath(), { ...settings, hooks })
    const status = await this.getCodexHookStatus()
    await this.broadcastState()
    return status
  }

  dispose(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer)
      this.scanTimer = null
    }

    this.bridgeServer?.close()
    this.bridgeServer = null

    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.destroy()
    }
    this.petWindow = null
  }

  async scanKanban(): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (!settings.pet.enabled || !settings.pet.kanban.enabled) return

    const canvases = await this.options.persistence.listCanvases()
    const dueDate = todayDate()

    for (const canvas of canvases) {
      for (const component of canvas.components) {
        if (component.type !== 'kanban') continue
        this.scanKanbanComponent(canvas, component, dueDate)
      }
    }

    await this.persistAndBroadcast()
  }

  upsertAgentSession(session: PetAgentSession): void {
    const parsed = petAgentSessionSchema.safeParse(session)
    if (!parsed.success) return

    const previous = this.agentSessions.get(parsed.data.id)
    this.agentSessions.set(parsed.data.id, parsed.data)
    const statusChanged = previous?.status !== parsed.data.status
    if (statusChanged) {
      this.markAgentAttentionAlertsRead(parsed.data.id)
      if (['waiting_for_confirmation', 'completed', 'error'].includes(parsed.data.status)) {
        this.addAlert(this.alertForAgentSession(parsed.data))
      }
    }
    this.persistAndBroadcastInBackground()
  }

  removeAgentSession(sessionId: string): void {
    let removed = false
    for (const [id, session] of [...this.agentSessions]) {
      if (id !== sessionId && session.terminalSessionId !== sessionId) continue
      this.agentSessions.delete(id)
      removed = true
    }
    if (!removed) return
    void this.broadcastState()
  }

  private registerIpc(): void {
    handleValidated('pet:get-state', z.object({}), async () => {
      await this.scanKanban()
      return this.getRuntimeState()
    })

    handleValidated('pet:update-settings', petUpdateSettingsInputSchema, async (_, input) => {
      const settings = await this.options.appSettingsService.getSettings()
      const saved = await this.options.appSettingsService.updateSettings({
        ...settings,
        pet: input.settings
      })
      await this.applySettings(saved)
      await this.persistAndBroadcast()
      return saved.pet
    })

    handleValidated('pet:ack-alert', petAlertInputSchema, async (_, input) => {
      this.markAlertRead(input.alertId)
      await this.persistAndBroadcast()
      return { ok: true }
    })

    handleValidated('pet:clear-alerts', petClearAlertsInputSchema, async (_, input) => {
      this.markAlertsRead(input.alertIds)
      await this.persistAndBroadcast()
      return { ok: true }
    })

    handleValidated('pet:snooze-alert', petSnoozeAlertInputSchema, async (_, input) => {
      const alert = this.storedState.alerts.find((item) => item.id === input.alertId)
      if (alert) alert.snoozedUntil = new Date(Date.now() + input.minutes * 60_000).toISOString()
      await this.persistAndBroadcast()
      return { ok: true }
    })

    handleValidated('pet:set-position', petSetPositionInputSchema, async (_, input) => {
      const settings = await this.options.appSettingsService.getSettings()
      const nextSettings = {
        ...settings,
        pet: {
          ...settings.pet,
          position: { x: input.x, y: input.y }
        }
      }
      const layout = petWindowLayout(nextSettings)
      const saved = await this.options.appSettingsService.updateSettings({
        ...nextSettings,
        pet: {
          ...nextSettings.pet,
          position: layout.orbPosition
        }
      })
      this.petWindow?.setBounds({ x: layout.x, y: layout.y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT })
      await this.broadcastState()
      return saved.pet.position
    })

    handleValidated('pet:set-interactive', petSetInteractiveInputSchema, (_, input) => {
      this.setPetInteractive(input.interactive)
      return { ok: true }
    })

    handleValidated('pet:open-target', petOpenTargetInputSchema, async (_, input) => {
      await this.options.openTarget(input.target)
      return { ok: true }
    })

    handleValidated('pet:install-claude-hooks', z.object({}), () => this.installClaudeHooks())
    handleValidated('pet:install-codex-hooks', z.object({}), () => this.installCodexHooks())

    handleValidated('pet:list-agent-sessions', z.object({}), () => visibleAgentSessions(this.agentSessions))
  }

  private async ensurePetWindow(): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (!settings.pet.enabled) return

    const layout = petWindowLayout(settings)
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.setBounds({ x: layout.x, y: layout.y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT })
      this.petWindow.showInactive()
      return
    }

    const window = new BrowserWindow({
      x: layout.x,
      y: layout.y,
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    this.petWindow = window
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.setPetInteractive(false)

    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    window.once('closed', () => {
      if (this.petWindow === window) this.petWindow = null
    })

    await this.options.loadPetRenderer(window)
  }

  private setPetInteractive(interactive: boolean): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return
    this.petWindow.setIgnoreMouseEvents(!interactive, { forward: true })
  }

  private async applySettings(settings: AppSettings): Promise<void> {
    if (settings.pet.enabled) {
      await this.ensurePetWindow()
      await this.ensureBridge()
      const layout = petWindowLayout(settings)
      this.petWindow?.setBounds({ x: layout.x, y: layout.y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT })
    } else if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.hide()
    }

    if (!settings.pet.enabled || !settings.pet.agentBridge.enabled) {
      this.bridgeServer?.close()
      this.bridgeServer = null
      this.bridgePort = 0
    }
    await this.writeHookBridgeConfig()
  }

  private scanKanbanComponent(canvas: CanvasDocument, component: CanvasComponent, dueDate: string): void {
    const cards = readCards(component)
    const activeCardIds = readActiveKanbanCardIds(component)

    for (const cardId of activeCardIds) {
      const card = cards[cardId]
      if (!card) continue

      const cardDueDate = asString(card.dueDate)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cardDueDate) || cardDueDate > dueDate) continue

      const title = asString(card.title).trim() || 'Kanban card'
      const dedupeKey = `kanban:${canvas.id}:${component.id}:${cardId}:${dueDate}`
      this.addAlert({
        id: randomUUID(),
        kind: 'kanban_due',
        severity: cardDueDate < dueDate ? 'warning' : 'info',
        title: cardDueDate < dueDate ? `Overdue: ${title}` : `Due today: ${title}`,
        body: `${canvas.name} / ${component.title}`,
        target: { canvasId: canvas.id, componentId: component.id, cardId },
        createdAt: nowIso(),
        dedupeKey
      })
    }
  }

  private addAlert(alert: PetAlert): boolean {
    if (this.storedState.alerts.some((item) => item.dedupeKey === alert.dedupeKey)) return false

    this.storedState.alerts = [alert, ...this.storedState.alerts].slice(0, MAX_ALERTS)
    void this.showNativeNotification(alert)
    return true
  }

  private markAlertRead(alertId: string): void {
    this.markAlertsRead([alertId])
  }

  private markAlertsRead(alertIds?: string[]): void {
    const ids = alertIds ? new Set(alertIds) : null
    const timestamp = nowIso()
    for (const alert of this.storedState.alerts) {
      if (alert.readAt || (ids && !ids.has(alert.id))) continue
      alert.readAt = timestamp
    }
  }

  private markAgentAttentionAlertsRead(sessionId: string): void {
    const timestamp = nowIso()
    for (const alert of this.storedState.alerts) {
      if (alert.readAt || alert.target.sessionId !== sessionId || !isAgentAttentionAlert(alert)) continue
      alert.readAt = timestamp
    }
  }

  private alertForAgentSession(session: PetAgentSession): PetAlert {
    const titlePrefix = session.source === 'codex' ? 'Codex' : 'Claude Code'
    const statusLabel =
      session.status === 'waiting_for_confirmation'
        ? 'is asking'
        : session.status === 'completed'
          ? 'completed'
          : session.status === 'error'
            ? 'reported an error'
            : 'updated'

    return {
      id: randomUUID(),
      kind: session.status === 'error' ? 'agent_error' : session.status === 'completed' ? 'agent_completed' : 'agent_waiting',
      severity: session.status === 'error' ? 'danger' : session.status === 'waiting_for_confirmation' ? 'warning' : 'info',
      title: `${titlePrefix} ${statusLabel}`,
      body: session.attentionReason || session.title,
      target: {
        canvasId: session.canvasId,
        componentId: session.componentId,
        sessionId: session.id
      },
      createdAt: nowIso(),
      dedupeKey: `agent:${session.id}:${session.status}:${session.lastActivityAt}`
    }
  }

  private async showNativeNotification(alert: PetAlert): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (!settings.pet.showNativeNotifications || !Notification.isSupported()) return

    const notification = new Notification({ title: alert.title, body: alert.body })
    notification.on('click', () => {
      this.markAlertRead(alert.id)
      void this.options.openTarget(alert.target)
      this.persistAndBroadcastInBackground()
    })
    notification.show()
  }

  private async applyAgentEvent(event: AgentHookEventInput): Promise<void> {
    const sessionId = event.sessionId || event.componentId || randomUUID()
    const terminalSessionId = event.terminalSessionId || sessionId
    const current = this.agentSessions.get(sessionId)
    if (shouldIgnoreAgentStatusTransition(current, event)) return

    const timestamp = nowIso()
    const session: PetAgentSession = {
      id: sessionId,
      terminalSessionId,
      providerSessionId: event.providerSessionId,
      source: event.source,
      status: eventStatus(event.event),
      canvasId: event.canvasId || current?.canvasId || 'unknown-canvas',
      componentId: event.componentId || current?.componentId || sessionId,
      title: event.sessionTitle || current?.title || event.title || (event.source === 'codex' ? 'Codex' : 'Claude Code'),
      cwd: event.cwd || current?.cwd,
      lastActivityAt: timestamp,
      attentionReason: event.event === 'waiting_for_confirmation' || event.event === 'error' ? event.body || current?.attentionReason : undefined
    }

    const parsed = petAgentSessionSchema.safeParse(session)
    if (parsed.success) {
      const previous = this.agentSessions.get(parsed.data.id)
      this.removeTerminalAgentPlaceholder(terminalSessionId, parsed.data.id, parsed.data.source)
      this.agentSessions.set(parsed.data.id, parsed.data)
      if (event.providerSessionId && shouldRecordProviderSession(event.hookName)) {
        this.options.onAgentProviderSessionResolved?.({
          terminalSessionId,
          source: parsed.data.source,
          providerSessionId: event.providerSessionId,
          componentId: parsed.data.componentId,
          canvasId: parsed.data.canvasId,
          cwd: parsed.data.cwd
        })
      }
      const statusChanged = previous?.status !== parsed.data.status
      if (statusChanged) {
        this.markAgentAttentionAlertsRead(parsed.data.id)
        const alert = alertForAgentEvent(event, parsed.data)
        if (alert) this.addAlert(alert)
      }
      await this.persistAndBroadcast()
    }
  }

  private removeTerminalAgentPlaceholder(terminalSessionId: string, sessionId: string, source: PetAgentSource): void {
    if (terminalSessionId === sessionId) return

    const placeholder = this.agentSessions.get(terminalSessionId)
    if (!placeholder || placeholder.source !== source || placeholder.status !== 'idle_unknown') return
    if (placeholder.terminalSessionId && placeholder.terminalSessionId !== terminalSessionId) return

    this.agentSessions.delete(terminalSessionId)
  }

  private claudeHookCommand(): string {
    return 'node'
  }

  private claudeHookArgs(): string[] {
    return [this.hookForwarderPath, 'claude']
  }

  private claudeHookDisplayCommand(): string {
    return [this.claudeHookCommand(), ...this.claudeHookArgs().map(quoteCommandArgument)].join(' ')
  }

  private codexHookCommand(eventName?: string): string {
    return ['node', quoteCommandArgument(this.hookForwarderPath), 'codex', eventName].filter(Boolean).join(' ')
  }

  private async readClaudeSettingsFile(): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(claudeSettingsPath(), 'utf8')
      if (!raw.trim()) return {}

      const parsed = JSON.parse(raw)
      if (!isRecord(parsed)) throw new Error('Claude Code settings must be a JSON object')
      return parsed
    } catch (error) {
      const code = isRecord(error) ? error.code : undefined
      if (code === 'ENOENT') return {}
      throw error
    }
  }

  private async readCodexHooksFile(): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(codexHooksPath(), 'utf8')
      if (!raw.trim()) return {}

      const parsed = JSON.parse(raw)
      if (!isRecord(parsed)) throw new Error('Codex hooks file must be a JSON object')
      return parsed
    } catch (error) {
      const code = isRecord(error) ? error.code : undefined
      if (code === 'ENOENT') return {}
      throw error
    }
  }

  private async getCodexHookIssue(): Promise<string | undefined> {
    try {
      const config = await readFile(codexConfigPath(), 'utf8')
      if (codexHooksDisabled(config)) return 'Codex hooks are disabled in config.toml.'
    } catch (error) {
      const code = isRecord(error) ? error.code : undefined
      if (code !== 'ENOENT') return error instanceof Error ? error.message : String(error)
    }

    return undefined
  }

  private async getClaudeHookStatus(): Promise<PetRuntimeState['bridge']['claudeHook']> {
    const command = this.claudeHookCommand()
    const args = this.claudeHookArgs()
    let installedEvents: string[] = []
    let issue: string | undefined

    try {
      const settings = await this.readClaudeSettingsFile()
      const hooks = isRecord(settings.hooks) ? settings.hooks : {}
      installedEvents = CLAUDE_HOOK_EVENTS.filter((eventName) => eventHasAtlasProviderHook('claude', hooks[eventName]))
      if (settings.disableAllHooks === true) {
        issue = 'Claude Code hooks are disabled by disableAllHooks.'
      }
    } catch (error) {
      issue = error instanceof Error ? error.message : String(error)
    }

    return {
      installed: installedEvents.length === CLAUDE_HOOK_EVENTS.length && !issue,
      settingsPath: claudeSettingsPath(),
      command,
      args,
      displayCommand: this.claudeHookDisplayCommand(),
      events: [...CLAUDE_HOOK_EVENTS],
      installedEvents,
      issue
    }
  }

  private async getCodexHookStatus(): Promise<PetRuntimeState['bridge']['codexHook']> {
    const command = this.codexHookCommand()
    let installedEvents: string[] = []
    let issue = await this.getCodexHookIssue()

    try {
      const settings = await this.readCodexHooksFile()
      const hooks = isRecord(settings.hooks) ? settings.hooks : {}
      const configuredEvents = CODEX_HOOK_EVENTS.filter((eventName) => eventHasAtlasProviderHook('codex', hooks[eventName]))
      installedEvents = CODEX_HOOK_EVENTS.filter((eventName) => eventHasRunnableAtlasProviderHook('codex', hooks[eventName], eventName))
      if (!issue && configuredEvents.length > 0 && installedEvents.length < CODEX_HOOK_EVENTS.length) {
        issue = 'Atlas Codex hooks need reinstalling.'
      }
    } catch (error) {
      issue = error instanceof Error ? error.message : String(error)
    }

    return {
      installed: installedEvents.length === CODEX_HOOK_EVENTS.length && !issue,
      settingsPath: codexHooksPath(),
      command,
      args: [],
      displayCommand: command,
      events: [...CODEX_HOOK_EVENTS],
      installedEvents,
      issue
    }
  }

  private async ensureBridge(): Promise<void> {
    const settings = await this.options.appSettingsService.getSettings()
    if (!settings.pet.enabled || !settings.pet.agentBridge.enabled || this.bridgeServer) return

    this.bridgeServer = createServer((request, response) => {
      void this.handleBridgeRequest(request, response)
    })

    await new Promise<void>((resolve, reject) => {
      this.bridgeServer?.once('error', reject)
      this.bridgeServer?.listen(0, '127.0.0.1', () => {
        const address = this.bridgeServer?.address()
        this.bridgePort = typeof address === 'object' && address ? address.port : 0
        this.bridgeServer?.off('error', reject)
        resolve()
      })
    })
  }

  private async handleBridgeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = parseAgentBridgeRoute(request.url)
    if (request.method !== 'POST' || !route) {
      response.writeHead(404)
      response.end('not found')
      return
    }

    const token = request.headers['x-atlas-pet-token'] || request.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (token !== this.storedState.bridgeToken) {
      response.writeHead(401)
      response.end('unauthorized')
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      if (Buffer.concat(chunks).length > 32_768) {
        response.writeHead(413)
        response.end('too large')
        return
      }
    }

    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const normalized = normalizeAgentHookEvent(route.source, payload, route.context)
      if (!normalized) throw new Error('Unsupported agent hook payload')
      if (normalized.kind === 'event') await this.applyAgentEvent(normalized.event)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"ok":true}')
    } catch {
      response.writeHead(400)
      response.end('bad request')
    }
  }

  private async getRuntimeState(): Promise<PetRuntimeState> {
    const settings = await this.options.appSettingsService.getSettings()
    const layout = petWindowLayout(settings)
    const [claudeHook, codexHook] = await Promise.all([this.getClaudeHookStatus(), this.getCodexHookStatus()])
    return petRuntimeStateSchema.parse({
      settings: settings.pet,
      alerts: this.storedState.alerts,
      agentSessions: visibleAgentSessions(this.agentSessions),
      window: {
        panelSide: layout.panelSide,
        orbOffset: layout.orbOffset
      },
      bridge: {
        enabled: settings.pet.agentBridge.enabled,
        port: this.bridgePort,
        token: this.storedState.bridgeToken,
        claudeHook,
        codexHook
      }
    })
  }

  private async broadcastState(): Promise<void> {
    const state = await this.getRuntimeState()
    const targets: Array<WebContents | null> = [this.petWindow?.webContents ?? null]
    for (const target of targets) {
      if (!target || target.isDestroyed()) continue
      target.send('pet:state-updated', state)
    }
  }

  private async persistAndBroadcast(): Promise<void> {
    await this.writeStoredState()
    await this.broadcastState()
  }

  private persistAndBroadcastInBackground(): void {
    void this.persistAndBroadcast().catch((error) => {
      console.warn('Failed to persist pet state:', error)
    })
  }

  private async readStoredState(): Promise<StoredPetState> {
    await mkdir(this.stateDir, { recursive: true })

    try {
      return normalizeStoredState(JSON.parse(await readFile(this.statePath, 'utf8')))
    } catch {
      const state = normalizeStoredState(null)
      await this.writeStoredState(state)
      return state
    }
  }

  private async writeHookForwarder(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    await writeFile(this.hookForwarderPath, AGENT_HOOK_FORWARDER_SCRIPT, 'utf8')
  }

  private async writeHookBridgeConfig(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    await writeJsonAtomic(
      this.hookBridgeConfigPath,
      this.bridgePort
        ? {
            enabled: true,
            bridgeUrl: `http://127.0.0.1:${this.bridgePort}/agent-hook`,
            token: this.storedState.bridgeToken
          }
        : { enabled: false }
    )
  }

  private async writeStoredState(state = this.storedState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    await writeJsonQueued(this.statePath, state)
  }
}
