import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { ipcMain, webContents, type WebContents } from 'electron'
import * as pty from 'node-pty'
import {
  terminalCloseComponentInputSchema,
  terminalCloseInputSchema,
  terminalResizeInputSchema,
  terminalWriteInputSchema
} from '@shared/ipc'
import { terminalCreateSchema } from '@shared/schema'
import { handleValidated } from './ipc-helpers'
import { buildPowerShellBootstrapScript, extractCwdMarkers } from './pty-cwd'

type TerminalSession = {
  id: string
  componentId: string
  ownerId: number
  pty: pty.IPty
  shell: string
  cwd: string
  dataBuffer: string
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

export class PtyService {
  private readonly sessionsById = new Map<string, TerminalSession>()
  private readonly sessionsByComponentId = new Map<string, TerminalSession>()

  registerIpc(): void {
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
}
