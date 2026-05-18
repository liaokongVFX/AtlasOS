import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { ipcMain, type WebContents } from 'electron'
import * as pty from 'node-pty'
import {
  terminalCloseInputSchema,
  terminalResizeInputSchema,
  terminalWriteInputSchema
} from '@shared/ipc'
import { terminalCreateSchema } from '@shared/schema'
import { handleValidated } from './ipc-helpers'

type TerminalSession = {
  id: string
  componentId: string
  ownerId: number
  pty: pty.IPty
}

function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

export class PtyService {
  private readonly sessions = new Map<string, TerminalSession>()

  registerIpc(): void {
    handleValidated('terminal:create', terminalCreateSchema, (event, input) => {
      const sessionId = randomUUID()
      const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : homedir()
      const shell = input.shell || defaultShell()
      let term: pty.IPty

      try {
        term = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: input.cols,
          rows: input.rows,
          cwd,
          env: process.env
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to create PTY session with ${shell}: ${message}`)
      }

      const session: TerminalSession = {
        id: sessionId,
        componentId: input.componentId,
        ownerId: event.sender.id,
        pty: term
      }
      this.sessions.set(sessionId, session)

      term.onData((data) => this.sendIfAlive(event.sender, 'terminal:data', { sessionId, data }))
      term.onExit((exit) => {
        this.sessions.delete(sessionId)
        this.sendIfAlive(event.sender, 'terminal:exit', { sessionId, ...exit })
      })

      event.sender.once('destroyed', () => this.closeByOwner(event.sender.id))
      return { sessionId, cwd, shell }
    })

    handleValidated('terminal:write', terminalWriteInputSchema, (_, input) => {
      return { ok: this.write(input.sessionId, input.data) }
    })

    handleValidated('terminal:resize', terminalResizeInputSchema, (_, input) => {
      return { ok: this.resize(input.sessionId, input.cols, input.rows) }
    })

    handleValidated('terminal:close', terminalCloseInputSchema, (_, input) => {
      this.close(input.sessionId)
      return { ok: true }
    })

    ipcMain.on('terminal:dispose-owner', (event) => this.closeByOwner(event.sender.id))
  }

  dispose(): void {
    for (const sessionId of this.sessions.keys()) {
      this.close(sessionId)
    }
  }

  private close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)

    try {
      session.pty.kill()
    } catch (error) {
      console.warn(`Failed to close PTY session ${sessionId}:`, error)
    }
  }

  private write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId)
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
    const session = this.sessions.get(sessionId)
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
    for (const session of this.sessions.values()) {
      if (session.ownerId === ownerId) {
        this.close(session.id)
      }
    }
  }

  private sendIfAlive(webContents: WebContents, channel: string, payload: unknown): void {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, payload)
    }
  }
}
