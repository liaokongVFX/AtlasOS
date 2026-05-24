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
import { parseFileUriListPaths, readClipboardFilePathsFromNativeFormats } from './clipboard-files'
import { handleValidated } from './ipc-helpers'
import { buildPowerShellBootstrapScript, extractCwdMarkers } from './pty-cwd'
import { readWindowsClipboardFileDropPaths, type WindowsClipboardFileDropResult } from './windows-clipboard-files'

type TerminalSession = {
  id: string
  componentId: string
  ownerId: number
  pty: pty.IPty
  shell: string
  cwd: string
  dataBuffer: string
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

type ClipboardFormatReadDiagnostic = {
  format: string
  bufferBytes?: number
  textLength?: number
  bufferError?: string
  textError?: string
}

type ClipboardSpecializedReadDiagnostic = {
  kind: string
  length?: number
  error?: string
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
  } catch (error) {
    console.warn('Failed to inspect terminal clipboard formats:', error)
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

export class PtyService {
  private readonly sessionsById = new Map<string, TerminalSession>()
  private readonly sessionsByComponentId = new Map<string, TerminalSession>()
  private cleanupStarted = false

  registerIpc(): void {
    this.ensureAttachmentDir()
    handleValidated('terminal:create', terminalCreateSchema, (event, input) => {
      return this.acquireOrCreate(event.sender.id, input.componentId, input.cwd, input.shell, input.cols, input.rows)
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
      componentId,
      ownerId,
      pty: term,
      shell,
      cwd,
      dataBuffer: ''
    }

    this.sessionsById.set(sessionId, session)
    this.sessionsByComponentId.set(componentId, session)

    term.onData((data) => {
      this.updateCwdFromOutput(sessionId, data)
      this.sendToOwner(session.ownerId, 'terminal:data', { sessionId, data })
    })

    term.onExit((exit) => {
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
      console.info('[AtlasOS terminal paste] native clipboard image empty', { formats })
      return { saved: false, reason: 'empty', formats }
    }

    const size = image.getSize()
    const buffer = image.toPNG()
    const targetPath = await this.savePastedImageBuffer(buffer, 'image/png')

    console.info('[AtlasOS terminal paste] saved native clipboard image', {
      path: targetPath,
      width: size.width,
      height: size.height,
      byteLength: buffer.length,
      formats
    })

    return {
      saved: true,
      path: targetPath,
      width: size.width,
      height: size.height,
      byteLength: buffer.length,
      formats
    }
  }

  private readClipboardFilesFromSpecializedElectronApis(reads: ClipboardSpecializedReadDiagnostic[]): string[] {
    const paths: string[] = []

    try {
      const bookmark = clipboard.readBookmark()
      reads.push({ kind: 'bookmark-url', length: bookmark.url.length })
      if (bookmark.url) paths.push(...parseFileUriListPaths(bookmark.url))
    } catch (error) {
      reads.push({ kind: 'bookmark-url', error: error instanceof Error ? error.message : String(error) })
    }

    try {
      const text = clipboard.readText('clipboard')
      reads.push({ kind: 'plain-text', length: text.length })
      if (text) paths.push(...parseFileUriListPaths(text))
    } catch (error) {
      reads.push({ kind: 'plain-text', error: error instanceof Error ? error.message : String(error) })
    }

    return paths
  }

  private async readClipboardFiles(): Promise<NativeClipboardFilesResult> {
    const formats = readClipboardFormats()
    const reads: ClipboardFormatReadDiagnostic[] = []
    const specializedReads: ClipboardSpecializedReadDiagnostic[] = []
    const diagnosticFor = (format: string): ClipboardFormatReadDiagnostic => {
      const existing = reads.find((entry) => entry.format === format)
      if (existing) return existing

      const entry: ClipboardFormatReadDiagnostic = { format }
      reads.push(entry)
      return entry
    }

    const paths = readClipboardFilePathsFromNativeFormats(
      formats,
      (format) => {
        const diagnostic = diagnosticFor(format)

        try {
          const buffer = clipboard.readBuffer(format)
          diagnostic.bufferBytes = buffer.length
          return buffer
        } catch (error) {
          diagnostic.bufferError = error instanceof Error ? error.message : String(error)
          return Buffer.alloc(0)
        }
      },
      (format) => {
        const diagnostic = diagnosticFor(format)

        try {
          const text = clipboard.read(format)
          diagnostic.textLength = text.length
          return text
        } catch (error) {
          diagnostic.textError = error instanceof Error ? error.message : String(error)
          return ''
        }
      }
    )

    const electronRawPaths = [...paths, ...this.readClipboardFilesFromSpecializedElectronApis(specializedReads)]
    let existingPaths = uniqueExistingPaths(electronRawPaths)
    let windowsFileDrop: WindowsClipboardFileDropResult | null = null

    if (existingPaths.length === 0) {
      windowsFileDrop = await readWindowsClipboardFileDropPaths()
      existingPaths = uniqueExistingPaths(windowsFileDrop.paths)
    }

    console.info('[AtlasOS terminal paste] native clipboard files inspected', {
      count: existingPaths.length,
      formats,
      electronPathCandidates: electronRawPaths.length,
      reads,
      specializedReads,
      windowsFileDrop: windowsFileDrop
        ? {
            candidateCount: windowsFileDrop.paths.length,
            nativeFormats: windowsFileDrop.nativeFormats,
            diagnostic: windowsFileDrop.diagnostic
          }
        : { attempted: false }
    })

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
            } catch (error) {
              console.warn(`Failed to inspect pasted terminal asset ${fullPath}:`, error)
            }
          })
      )
    } catch (error) {
      console.warn('Failed to clean stale terminal pasted assets:', error)
    }
  }
}
