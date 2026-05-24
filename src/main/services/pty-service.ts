import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, clipboard, ipcMain, webContents, type WebContents } from 'electron'
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
import type { PetAgentSession, PetAgentSource, PetAgentStatus } from '@shared/pet'
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
  agentSource?: PetAgentSource
  agentStatus?: PetAgentStatus
  attentionReason?: string
}

type PtyAgentSessionEvent =
  | {
      type: 'upsert'
      session: PetAgentSession
    }
  | {
      type: 'remove'
      sessionId: string
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

function nowIso(): string {
  return new Date().toISOString()
}

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

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function detectAgentSource(value: string): PetAgentSource | null {
  if (/\bcodex\b/i.test(value)) return 'codex'
  if (/\bclaude(?:\s+code)?\b/i.test(value)) return 'claude'
  return null
}

function detectAgentStatusFromOutput(value: string): { status: PetAgentStatus; reason?: string } | null {
  const text = stripAnsi(value).toLowerCase()
  if (/(permission|approve|approval|confirm|continue\?|do you want|allow|y\/n|yes\/no)/i.test(text)) {
    return { status: 'waiting_for_confirmation', reason: 'Waiting for confirmation' }
  }
  if (/(failed|error|exception|cancelled|canceled)/i.test(text)) {
    return { status: 'error', reason: 'Reported an error' }
  }
  if (/(completed|complete|finished|done|all set)/i.test(text)) {
    return { status: 'completed', reason: 'Completed' }
  }
  return null
}

function updateInputBuffer(buffer: string, data: string): { buffer: string; commands: string[] } {
  const commands: string[] = []
  let nextBuffer = buffer

  for (const character of data) {
    if (character === '\r' || character === '\n') {
      const command = nextBuffer.trim()
      if (command) commands.push(command)
      nextBuffer = ''
      continue
    }

    if (character === '\b' || character === '\x7f') {
      nextBuffer = nextBuffer.slice(0, -1)
      continue
    }

    if (character >= ' ') nextBuffer += character
  }

  return { buffer: nextBuffer.slice(-512), commands }
}

export class PtyService {
  private readonly sessionsById = new Map<string, TerminalSession>()
  private readonly sessionsByComponentId = new Map<string, TerminalSession>()
  private readonly agentSessionListeners = new Set<(event: PtyAgentSessionEvent) => void>()
  private cleanupStarted = false

  onAgentSessionChanged(listener: (event: PtyAgentSessionEvent) => void): () => void {
    this.agentSessionListeners.add(listener)
    return () => this.agentSessionListeners.delete(listener)
  }

  registerIpc(): void {
    this.ensureAttachmentDir()
    handleValidated('terminal:create', terminalCreateSchema, (event, input) => {
      return this.acquireOrCreate(event.sender.id, input.componentId, input.canvasId, input.title, input.cwd, input.shell, input.cols, input.rows)
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

  private acquireOrCreate(
    ownerId: number,
    componentId: string,
    canvasId: string | undefined,
    title: string | undefined,
    cwdInput: string | undefined,
    shellInput: string | undefined,
    cols: number,
    rows: number
  ): { sessionId: string; cwd: string; shell: string } {
    const existing = this.sessionsByComponentId.get(componentId)
    if (existing) {
      try {
        existing.pty.resize(cols, rows)
      } catch (error) {
        console.warn(`Failed to resize existing PTY session ${existing.id}:`, error)
      }

      existing.ownerId = ownerId
      existing.canvasId = canvasId ?? existing.canvasId
      existing.title = title ?? existing.title
      return { sessionId: existing.id, cwd: existing.cwd, shell: existing.shell }
    }

    const cwd = cwdInput && existsSync(cwdInput) ? cwdInput : homedir()
    const shell = shellInput || defaultShell()
    const args = shellArgs(shell)

    let term: pty.IPty
    try {
      term = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to create PTY session with ${shell}: ${message}`)
    }

    const sessionId = randomUUID()
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
      inputBuffer: ''
    }

    this.sessionsById.set(sessionId, session)
    this.sessionsByComponentId.set(componentId, session)

    term.onData((data) => {
      this.updateCwdFromOutput(sessionId, data)
      this.updateAgentFromOutput(sessionId, data)
      this.sendToOwner(session.ownerId, 'terminal:data', { sessionId, data })
    })

    term.onExit((exit) => {
      const exitingSession = this.sessionsById.get(sessionId)
      if (exitingSession?.agentSource) {
        this.emitAgentSession(exitingSession, exit.exitCode === 0 ? 'completed' : 'error', exit.exitCode === 0 ? 'Completed' : `Exited with code ${exit.exitCode}`)
      }
      this.closeBySessionId(sessionId, false)
      this.sendToOwner(session.ownerId, 'terminal:exit', { sessionId, ...exit })
    })

    webContents.fromId(ownerId)?.once('destroyed', () => this.closeByOwner(ownerId))
    return { sessionId, cwd: session.cwd, shell: session.shell }
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

  private closeBySessionId(sessionId: string, kill = true): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return

    this.sessionsById.delete(sessionId)
    this.sessionsByComponentId.delete(session.componentId)
    if (session.agentSource) this.emitAgentSessionRemoved(sessionId)

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
      this.updateAgentFromInput(session, data)
      session.pty.write(data)
      return true
    } catch (error) {
      console.warn(`Failed to write to PTY session ${sessionId}:`, error)
      return false
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

  private sendToOwner(ownerId: number, channel: string, payload: unknown): void {
    const contents = webContents.fromId(ownerId)
    if (!contents || contents.isDestroyed()) return
    contents.send(channel, payload)
  }

  private updateAgentFromInput(session: TerminalSession, data: string): void {
    const result = updateInputBuffer(session.inputBuffer, data)
    session.inputBuffer = result.buffer

    for (const command of result.commands) {
      const source = detectAgentSource(command)
      if (!source) continue

      session.agentSource = source
      this.emitAgentSession(session, 'running')
    }
  }

  private updateAgentFromOutput(sessionId: string, data: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return

    const source = session.agentSource ?? detectAgentSource(data)
    if (!source) return

    session.agentSource = source
    const detectedStatus = detectAgentStatusFromOutput(data)
    this.emitAgentSession(session, detectedStatus?.status ?? session.agentStatus ?? 'running', detectedStatus?.reason)
  }

  private emitAgentSession(session: TerminalSession, status: PetAgentStatus, attentionReason?: string): void {
    if (!session.agentSource || !session.canvasId) return

    session.agentStatus = status
    session.attentionReason = attentionReason ?? session.attentionReason

    const snapshot: PetAgentSession = {
      id: session.id,
      source: session.agentSource,
      status,
      canvasId: session.canvasId,
      componentId: session.componentId,
      title: session.title || (session.agentSource === 'codex' ? 'Codex' : 'Claude Code'),
      cwd: session.cwd,
      lastActivityAt: nowIso(),
      attentionReason: session.attentionReason
    }

    for (const listener of this.agentSessionListeners) listener({ type: 'upsert', session: snapshot })
  }

  private emitAgentSessionRemoved(sessionId: string): void {
    for (const listener of this.agentSessionListeners) listener({ type: 'remove', sessionId })
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
