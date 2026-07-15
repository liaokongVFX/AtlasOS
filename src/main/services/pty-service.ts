import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, clipboard, ipcMain, webContents } from 'electron'
import * as pty from 'node-pty'
import {
  MAX_TERMINAL_PASTED_ASSET_BASE64_CHARS,
  terminalCloseComponentInputSchema,
  terminalCloseInputSchema,
  terminalPersistAssetInputSchema,
  terminalReadClipboardFilesInputSchema,
  terminalSaveClipboardImageInputSchema,
  terminalResizeInputSchema,
  terminalWriteInputSchema
} from '@shared/ipc'
import { terminalCreateSchema } from '@shared/schema'
import {
  detectTerminalAgentCommand,
  terminalAgentCommandEventSchema,
  terminalAgentResumeCommand,
  terminalAgentSessionEndedEventSchema,
  type TerminalAgentSource
} from '@shared/terminal-agent'
import type { TerminalEnvironment } from '@shared/terminal-environment'
import { parseFileUriListPaths, readClipboardFilePathsFromNativeFormats } from './clipboard-files'
import { handleValidated } from './ipc-helpers'
import { buildPowerShellBootstrapScript, extractCwdMarkers } from './pty-cwd'
import { readWindowsClipboardFileDropPaths } from './windows-clipboard-files'

type TerminalSession = {
  id: string
  canvasId?: string
  componentId: string
  title?: string
  ownerId: number
  pty: pty.IPty
  shell: string
  cwd: string
  dataBuffer: string
  inputBuffer: string
  autoConfirmWorkspaceTrust: boolean
  didAutoConfirmWorkspaceTrust: boolean
}

type AgentHookEnvironmentContext = {
  sessionId: string
  canvasId?: string
  componentId: string
  title?: string
  cwd: string
}

type AgentCommandStartedContext = AgentHookEnvironmentContext & {
  source: TerminalAgentSource
  command: string
}

type AgentProviderSessionContext = {
  terminalSessionId: string
  source: TerminalAgentSource
  providerSessionId: string
  cwd?: string
}

type AgentProviderSessionEndedContext = AgentProviderSessionContext

type OwnerSessionCleanup = {
  sessionIds: Set<string>
  destroyedListener: () => void
}

type PtyServiceOptions = {
  getAgentHookEnvironment?: (context: AgentHookEnvironmentContext) => Record<string, string>
  onAgentCommandStarted?: (context: AgentCommandStartedContext) => void | Promise<void>
  onSessionClosed?: (sessionId: string) => void
}

type SavedClipboardImageResult =
  | {
      saved: true
      path: string
      width: number
      height: number
      byteLength: number
      formats: string[]
    }
  | {
      saved: false
      reason: 'empty'
      formats: string[]
    }

type NativeClipboardFilesResult = {
  paths: string[]
  formats: string[]
}

const STALE_PASTED_ASSET_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7
const MAX_PASTED_ASSET_BYTES = 10 * 1024 * 1024
const MAX_TERMINAL_INPUT_BUFFER_CHARS = 4096
const TERMINAL_ENV_BLOCKLIST = ['CODEX_THREAD_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'CODEX_SHELL'] as const
const TERMINAL_USER_ENV_BLOCKLIST = [
  ...TERMINAL_ENV_BLOCKLIST,
  'ATLAS_CANVAS_ID',
  'ATLAS_PET_BRIDGE_CONFIG',
  'ATLAS_PET_HOOK_FORWARDER',
  'ATLAS_TERMINAL_COMPONENT_ID',
  'ATLAS_TERMINAL_CWD',
  'ATLAS_TERMINAL_SESSION_ID',
  'ATLAS_TERMINAL_TITLE'
] as const
const TERMINAL_HOST_ENV_BLOCKLIST = [
  ...TERMINAL_USER_ENV_BLOCKLIST,
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'NO_COLOR'
] as const
const PASTED_IMAGE_EXTENSIONS_BY_MIME_TYPE = new Map([
  ['image/png', '.png'],
  ['image/x-png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/bmp', '.bmp'],
  ['image/x-ms-bmp', '.bmp'],
  ['image/tiff', '.tiff'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
  ['image/svg+xml', '.svg'],
  ['image/avif', '.avif'],
  ['image/x-icon', '.ico'],
  ['image/vnd.microsoft.icon', '.ico']
])

function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

function shellBaseName(shell: string): string {
  return basename(shell).toLowerCase()
}

function supportsCwdTracking(shell: string): boolean {
  const baseName = shellBaseName(shell)
  return baseName === 'powershell.exe' || baseName === 'powershell' || baseName === 'pwsh.exe' || baseName === 'pwsh'
}

function shellArgs(shell: string): string[] {
  if (!supportsCwdTracking(shell)) return []
  return ['-NoLogo', '-NoExit', '-Command', buildPowerShellBootstrapScript()]
}

function terminalPastedAssetDir(): string {
  return join(app.getPath('temp'), 'AtlasOS', 'terminal-pasted-assets')
}

function extensionForMimeType(mimeType?: string): string {
  if (!mimeType) return '.png'

  const extension = PASTED_IMAGE_EXTENSIONS_BY_MIME_TYPE.get(mimeType.trim().toLowerCase())
  if (!extension) {
    throw new Error('Unsupported pasted image type')
  }

  return extension
}

function readClipboardFormats(): string[] {
  try {
    return clipboard.availableFormats('clipboard')
  } catch {
    return []
  }
}

function uniqueExistingPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const path of paths) {
    if (!path || seen.has(path) || !existsSync(path)) continue
    seen.add(path)
    result.push(path)
  }

  return result
}

function normalizeTerminalOutputForMatching(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, ' ')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function terminalBaseEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  removeEnvironmentVariables(env, TERMINAL_HOST_ENV_BLOCKLIST)
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'AtlasOS'
  env.TERM_PROGRAM_VERSION = app.getVersion()
  return env
}

function removeEnvironmentVariables(env: NodeJS.ProcessEnv, names: readonly string[]): void {
  const blocklist = new Set(names.map((name) => name.toUpperCase()))
  for (const name of Object.keys(env)) {
    if (blocklist.has(name.toUpperCase())) delete env[name]
  }
}

function userTerminalEnvironment(input: TerminalEnvironment): NodeJS.ProcessEnv {
  const env = { ...input }
  removeEnvironmentVariables(env, TERMINAL_USER_ENV_BLOCKLIST)
  return env
}

function applyEnvironmentVariables(env: NodeJS.ProcessEnv, values: NodeJS.ProcessEnv | undefined): void {
  for (const [name, value] of Object.entries(values ?? {})) {
    removeEnvironmentVariables(env, [name])
    env[name] = value
  }
}

function terminalEnvironment(
  userEnvironment: TerminalEnvironment,
  hookEnvironment: NodeJS.ProcessEnv | undefined
): NodeJS.ProcessEnv {
  const env = terminalBaseEnvironment()
  applyEnvironmentVariables(env, userTerminalEnvironment(userEnvironment))
  applyEnvironmentVariables(env, hookEnvironment)
  return env
}

export class PtyService {
  private readonly sessionsById = new Map<string, TerminalSession>()
  private readonly sessionsByComponentId = new Map<string, TerminalSession>()
  private readonly ownerCleanupById = new Map<number, OwnerSessionCleanup>()
  private cleanupStarted = false

  constructor(private readonly options: PtyServiceOptions = {}) {}

  registerIpc(): void {
    this.ensureAttachmentDir()
    handleValidated('terminal:create', terminalCreateSchema, (event, input) => {
      return this.acquireOrCreate(
        event.sender.id,
        input.componentId,
        input.canvasId,
        input.title,
        input.cwd,
        input.shell,
        input.initialCommand,
        input.environment,
        input.autoConfirmWorkspaceTrust,
        input.cols,
        input.rows
      )
    })

    handleValidated('terminal:write', terminalWriteInputSchema, (_, input) => {
      return { ok: this.write(input.sessionId, input.data) }
    })

    handleValidated('terminal:resize', terminalResizeInputSchema, (_, input) => {
      return { ok: this.resize(input.sessionId, input.cols, input.rows) }
    })

    handleValidated('terminal:close', terminalCloseInputSchema, (_, input) => {
      this.closeBySessionId(input.sessionId)
      return { ok: true }
    })

    handleValidated('terminal:close-component', terminalCloseComponentInputSchema, (_, input) => {
      this.closeByComponentId(input.componentId)
      return { ok: true }
    })

    handleValidated('terminal:save-pasted-asset', terminalPersistAssetInputSchema, async (_, input) => {
      if (input.dataBase64.length > MAX_TERMINAL_PASTED_ASSET_BASE64_CHARS) {
        throw new Error('Pasted image is too large')
      }

      const buffer = Buffer.from(input.dataBase64, 'base64')
      const targetPath = await this.savePastedImageBuffer(buffer, input.mimeType)
      return { path: targetPath }
    })

    handleValidated('terminal:save-clipboard-image', terminalSaveClipboardImageInputSchema, async () => {
      return this.saveClipboardImage()
    })

    handleValidated('terminal:read-clipboard-files', terminalReadClipboardFilesInputSchema, async () => {
      return this.readClipboardFiles()
    })

    ipcMain.on('terminal:dispose-owner', (event) => this.closeByOwner(event.sender.id))
  }

  dispose(): void {
    for (const sessionId of [...this.sessionsById.keys()]) {
      this.closeBySessionId(sessionId)
    }
  }

  recordAgentProviderSession(context: AgentProviderSessionContext): void {
    const session = this.sessionsById.get(context.terminalSessionId)
    if (!session) return

    const command = terminalAgentResumeCommand(context.source, context.providerSessionId)
    if (!command) return

    const event = terminalAgentCommandEventSchema.parse({
      sessionId: session.id,
      componentId: session.componentId,
      canvasId: session.canvasId,
      source: context.source,
      cwd: context.cwd || session.cwd,
      command
    })
    this.sendToOwner(session.ownerId, 'terminal:agent-command', event)
  }

  recordAgentProviderSessionEnded(context: AgentProviderSessionEndedContext): void {
    const session = this.sessionsById.get(context.terminalSessionId)
    if (!session) return

    const event = terminalAgentSessionEndedEventSchema.parse({
      sessionId: session.id,
      componentId: session.componentId,
      canvasId: session.canvasId,
      source: context.source,
      providerSessionId: context.providerSessionId,
      cwd: context.cwd || session.cwd
    })
    this.sendToOwner(session.ownerId, 'terminal:agent-session-ended', event)
  }

  private acquireOrCreate(
    ownerId: number,
    componentId: string,
    canvasId: string | undefined,
    title: string | undefined,
    cwdInput: string | undefined,
    shellInput: string | undefined,
    initialCommand: string | undefined,
    environmentInput: TerminalEnvironment,
    autoConfirmWorkspaceTrust: boolean,
    cols: number,
    rows: number
  ): { sessionId: string; cwd: string; shell: string; didRunInitialCommand?: boolean } {
    const existing = this.sessionsByComponentId.get(componentId)
    if (existing) {
      const previousOwnerId = existing.ownerId
      try {
        existing.pty.resize(cols, rows)
      } catch (error) {
        console.warn(`Failed to resize existing PTY session ${existing.id}:`, error)
      }

      existing.ownerId = ownerId
      if (previousOwnerId !== ownerId) {
        this.untrackOwnerSession(previousOwnerId, existing.id)
        this.trackOwnerSession(ownerId, existing.id)
      }
      existing.canvasId = canvasId ?? existing.canvasId
      existing.title = title ?? existing.title
      if (autoConfirmWorkspaceTrust) {
        existing.autoConfirmWorkspaceTrust = true
        this.autoConfirmWorkspaceTrustPrompt(existing.id)
      }
      return { sessionId: existing.id, cwd: existing.cwd, shell: existing.shell, didRunInitialCommand: false }
    }

    const cwd = cwdInput && existsSync(cwdInput) ? cwdInput : homedir()
    const shell = shellInput || defaultShell()
    const args = shellArgs(shell)

    const sessionId = randomUUID()
    const env = terminalEnvironment(
      environmentInput,
      this.options.getAgentHookEnvironment?.({ sessionId, canvasId, componentId, title, cwd })
    )
    let term: pty.IPty
    try {
      term = pty.spawn(shell, args, {
        name: env.TERM || 'xterm-256color',
        cols,
        rows,
        cwd,
        env
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to create PTY session with ${shell}: ${message}`)
    }

    const session: TerminalSession = {
      id: sessionId,
      canvasId,
      componentId,
      title,
      ownerId,
      pty: term,
      shell,
      cwd,
      dataBuffer: '',
      inputBuffer: '',
      autoConfirmWorkspaceTrust,
      didAutoConfirmWorkspaceTrust: false
    }

    this.sessionsById.set(sessionId, session)
    this.sessionsByComponentId.set(componentId, session)
    this.trackOwnerSession(ownerId, sessionId)

    term.onData((data) => {
      this.updateCwdFromOutput(sessionId, data)
      this.autoConfirmWorkspaceTrustPrompt(sessionId)
      this.sendToOwner(session.ownerId, 'terminal:data', { sessionId, data })
    })

    term.onExit((exit) => {
      this.closeBySessionId(sessionId, false)
      this.sendToOwner(session.ownerId, 'terminal:exit', { sessionId, ...exit })
    })

    let didRunInitialCommand = false
    if (initialCommand) {
      try {
        term.write(`${initialCommand}\r`)
        this.reportAgentCommandStarted(session, initialCommand)
        didRunInitialCommand = true
      } catch (error) {
        console.warn(`Failed to write initial command to PTY session ${sessionId}:`, error)
      }
    }

    return { sessionId, cwd: session.cwd, shell: session.shell, didRunInitialCommand }
  }

  private updateCwdFromOutput(sessionId: string, data: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return

    session.dataBuffer = `${session.dataBuffer}${data}`.slice(-8192)
    const markers = extractCwdMarkers(session.dataBuffer)
    const nextCwd = markers.at(-1)
    if (!nextCwd || nextCwd === session.cwd) return

    session.cwd = nextCwd
    this.sendToOwner(session.ownerId, 'terminal:cwd', { sessionId, cwd: nextCwd })
  }

  private autoConfirmWorkspaceTrustPrompt(sessionId: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session?.autoConfirmWorkspaceTrust || session.didAutoConfirmWorkspaceTrust) return

    const output = normalizeTerminalOutputForMatching(session.dataBuffer)
    if (!output.includes('quick safety check') || !output.includes('yes, i trust this folder') || !output.includes('enter to confirm')) return

    session.didAutoConfirmWorkspaceTrust = true
    try {
      session.pty.write('\r')
    } catch (error) {
      console.warn(`Failed to auto-confirm workspace trust for PTY session ${sessionId}:`, error)
    }
  }

  private closeBySessionId(sessionId: string, kill = true): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return

    this.sessionsById.delete(sessionId)
    this.sessionsByComponentId.delete(session.componentId)
    this.untrackOwnerSession(session.ownerId, sessionId)
    this.options.onSessionClosed?.(sessionId)

    if (!kill) return

    try {
      session.pty.kill()
    } catch (error) {
      console.warn(`Failed to close PTY session ${sessionId}:`, error)
    }
  }

  private closeByComponentId(componentId: string): void {
    const session = this.sessionsByComponentId.get(componentId)
    if (!session) return
    this.closeBySessionId(session.id)
  }

  private write(sessionId: string, data: string): boolean {
    const session = this.sessionsById.get(sessionId)
    if (!session) return false

    try {
      session.pty.write(data)
      this.trackTerminalInput(session, data)
      return true
    } catch (error) {
      console.warn(`Failed to write to PTY session ${sessionId}:`, error)
      return false
    }
  }

  private trackTerminalInput(session: TerminalSession, data: string): void {
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        const command = session.inputBuffer
        session.inputBuffer = ''
        this.reportAgentCommandStarted(session, command)
      } else if (char === '\b' || char === '\x7f') {
        session.inputBuffer = session.inputBuffer.slice(0, -1)
      } else if (char === '\x03' || char === '\x04' || char === '\x15' || char === '\x1b') {
        session.inputBuffer = ''
      } else if (char >= ' ' || char === '\t') {
        session.inputBuffer = `${session.inputBuffer}${char}`.slice(-MAX_TERMINAL_INPUT_BUFFER_CHARS)
      }
    }
  }

  private reportAgentCommandStarted(session: TerminalSession, command: string): void {
    const agentCommand = detectTerminalAgentCommand(command)
    if (!agentCommand) return

    const event = terminalAgentCommandEventSchema.parse({
      sessionId: session.id,
      componentId: session.componentId,
      canvasId: session.canvasId,
      source: agentCommand.source,
      cwd: session.cwd,
      command: agentCommand.command
    })
    this.sendToOwner(session.ownerId, 'terminal:agent-command', event)

    try {
      const result = this.options.onAgentCommandStarted?.({
        source: agentCommand.source,
        command: agentCommand.command,
        sessionId: session.id,
        canvasId: session.canvasId,
        componentId: session.componentId,
        title: session.title,
        cwd: session.cwd
      })
      void Promise.resolve(result).catch((error) => {
        console.warn(`Failed to report ${agentCommand.source} command start for PTY session ${session.id}:`, error)
      })
    } catch (error) {
      console.warn(`Failed to report ${agentCommand.source} command start for PTY session ${session.id}:`, error)
    }
  }

  private resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessionsById.get(sessionId)
    if (!session) return false

    try {
      session.pty.resize(cols, rows)
      return true
    } catch (error) {
      console.warn(`Failed to resize PTY session ${sessionId}:`, error)
      return false
    }
  }

  private closeByOwner(ownerId: number): void {
    for (const session of [...this.sessionsById.values()]) {
      if (session.ownerId === ownerId) {
        this.closeBySessionId(session.id)
      }
    }
  }

  private trackOwnerSession(ownerId: number, sessionId: string): void {
    const existing = this.ownerCleanupById.get(ownerId)
    if (existing) {
      existing.sessionIds.add(sessionId)
      return
    }

    const contents = webContents.fromId(ownerId)
    if (!contents || contents.isDestroyed()) return

    const cleanup: OwnerSessionCleanup = {
      sessionIds: new Set([sessionId]),
      destroyedListener: () => this.closeByOwner(ownerId)
    }
    this.ownerCleanupById.set(ownerId, cleanup)
    contents.once('destroyed', cleanup.destroyedListener)
  }

  private untrackOwnerSession(ownerId: number, sessionId: string): void {
    const cleanup = this.ownerCleanupById.get(ownerId)
    if (!cleanup) return

    cleanup.sessionIds.delete(sessionId)
    if (cleanup.sessionIds.size > 0) return

    this.ownerCleanupById.delete(ownerId)
    const contents = webContents.fromId(ownerId)
    if (contents && !contents.isDestroyed()) {
      contents.removeListener('destroyed', cleanup.destroyedListener)
    }
  }

  private sendToOwner(ownerId: number, channel: string, payload: unknown): void {
    const contents = webContents.fromId(ownerId)
    if (!contents || contents.isDestroyed()) return
    contents.send(channel, payload)
  }

  private async savePastedImageBuffer(buffer: Buffer, mimeType = 'image/png'): Promise<string> {
    if (buffer.length === 0) {
      throw new Error('Pasted image is empty')
    }

    if (buffer.length > MAX_PASTED_ASSET_BYTES) {
      throw new Error('Pasted image is too large')
    }

    const assetDir = terminalPastedAssetDir()
    await mkdir(assetDir, { recursive: true })
    const extension = extensionForMimeType(mimeType)
    const targetPath = join(assetDir, `atlas-terminal-${Date.now()}-${randomUUID()}${extension}`)

    await writeFile(targetPath, buffer, { flag: 'wx' })
    return targetPath
  }

  private async saveClipboardImage(): Promise<SavedClipboardImageResult> {
    const formats = readClipboardFormats()
    const image = clipboard.readImage('clipboard')

    if (image.isEmpty()) {
      return { saved: false, reason: 'empty', formats }
    }

    const size = image.getSize()
    const buffer = image.toPNG()
    const targetPath = await this.savePastedImageBuffer(buffer, 'image/png')

    return {
      saved: true,
      path: targetPath,
      width: size.width,
      height: size.height,
      byteLength: buffer.length,
      formats
    }
  }

  private readClipboardFilesFromSpecializedElectronApis(): string[] {
    const paths: string[] = []

    try {
      const bookmark = clipboard.readBookmark()
      if (bookmark.url) paths.push(...parseFileUriListPaths(bookmark.url))
    } catch {
      // Ignore unavailable specialized clipboard formats and continue through fallbacks.
    }

    try {
      const text = clipboard.readText('clipboard')
      if (text) paths.push(...parseFileUriListPaths(text))
    } catch {
      // Ignore unavailable specialized clipboard formats and continue through fallbacks.
    }

    return paths
  }

  private async readClipboardFiles(): Promise<NativeClipboardFilesResult> {
    const formats = readClipboardFormats()
    const paths = readClipboardFilePathsFromNativeFormats(
      formats,
      (format) => {
        try {
          return clipboard.readBuffer(format)
        } catch {
          return Buffer.alloc(0)
        }
      },
      (format) => {
        try {
          return clipboard.read(format)
        } catch {
          return ''
        }
      }
    )

    const electronRawPaths = [...paths, ...this.readClipboardFilesFromSpecializedElectronApis()]
    let existingPaths = uniqueExistingPaths(electronRawPaths)

    if (existingPaths.length === 0) {
      const windowsFileDrop = await readWindowsClipboardFileDropPaths()
      existingPaths = uniqueExistingPaths(windowsFileDrop.paths)
    }

    return { paths: existingPaths, formats }
  }

  private ensureAttachmentDir(): void {
    const assetDir = terminalPastedAssetDir()
    void mkdir(assetDir, { recursive: true })

    if (this.cleanupStarted) return
    this.cleanupStarted = true
    void this.cleanupStalePastedAssets()
  }

  private async cleanupStalePastedAssets(): Promise<void> {
    try {
      const assetDir = terminalPastedAssetDir()
      await mkdir(assetDir, { recursive: true })
      const entries = await readdir(assetDir, { withFileTypes: true })
      const cutoff = Date.now() - STALE_PASTED_ASSET_MAX_AGE_MS

      await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const fullPath = join(assetDir, entry.name)

            try {
              const metadata = await stat(fullPath)
              if (metadata.mtimeMs < cutoff) {
                await unlink(fullPath)
              }
            } catch {
              return
            }
          })
      )
    } catch {
      return
    }
  }
}
