import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PtyService } from './pty-service'

type MockPty = {
  onData: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: (event: { exitCode: number; signal?: number }) => void
}

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  ipcOn: vi.fn(),
  webContentsFromId: vi.fn(),
  ownerContents: {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    removeListener: vi.fn()
  }
}))

const ptyMocks = vi.hoisted(() => {
  const instances: MockPty[] = []
  const spawn = vi.fn(() => {
    const dataListeners: Array<(data: string) => void> = []
    const exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = []
    const instance: MockPty = {
      onData: vi.fn((listener: (data: string) => void) => {
        dataListeners.push(listener)
        return { dispose: vi.fn() }
      }),
      onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListeners.push(listener)
        return { dispose: vi.fn() }
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      emitData: (data: string) => {
        for (const listener of dataListeners) listener(data)
      },
      emitExit: (event: { exitCode: number; signal?: number }) => {
        for (const listener of exitListeners) listener(event)
      }
    }
    instances.push(instance)
    return instance
  })
  return { instances, spawn }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'D:\\AtlasOS\\temp')
  },
  clipboard: {
    availableFormats: vi.fn(() => []),
    read: vi.fn(() => ''),
    readBookmark: vi.fn(() => ({ title: '', url: '' })),
    readBuffer: vi.fn(() => Buffer.alloc(0)),
    readImage: vi.fn(() => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      toPNG: () => Buffer.alloc(0)
    })),
    readText: vi.fn(() => '')
  },
  ipcMain: {
    handle: electronMocks.ipcHandle,
    on: electronMocks.ipcOn
  },
  webContents: {
    fromId: electronMocks.webContentsFromId
  }
}))

vi.mock('node-pty', () => ({
  spawn: ptyMocks.spawn
}))

function ipcHandler(channel: string): (event: unknown, payload: unknown) => Promise<unknown> {
  const handler = electronMocks.ipcHandle.mock.calls.find(([registeredChannel]) => registeredChannel === channel)?.[1]
  expect(handler).toBeDefined()
  return handler
}

describe('PtyService hook bridge support', () => {
  beforeEach(() => {
    electronMocks.ipcHandle.mockReset()
    electronMocks.ipcOn.mockReset()
    electronMocks.ownerContents.send.mockReset()
    electronMocks.ownerContents.isDestroyed.mockReturnValue(false)
    electronMocks.ownerContents.once.mockReset()
    electronMocks.ownerContents.removeListener.mockReset()
    electronMocks.webContentsFromId.mockReset()
    electronMocks.webContentsFromId.mockReturnValue(electronMocks.ownerContents)
    ptyMocks.spawn.mockClear()
    ptyMocks.instances.splice(0, ptyMocks.instances.length)
  })

  it('does not leak the host Codex runtime identity into spawned terminal environments', async () => {
    const previousThreadId = process.env.CODEX_THREAD_ID
    const previousOriginator = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE
    const previousShell = process.env.CODEX_SHELL
    const previousHome = process.env.CODEX_HOME
    const previousApiKey = process.env.CODEX_API_KEY
    process.env.CODEX_THREAD_ID = 'host-thread'
    process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = 'Codex Desktop'
    process.env.CODEX_SHELL = '1'
    process.env.CODEX_HOME = 'C:\\Users\\xhwz2\\.codex'
    process.env.CODEX_API_KEY = 'test-key'

    try {
      const service = new PtyService()
      service.registerIpc()

      const create = ipcHandler('terminal:create')
      await create(
        { sender: { id: 7 } },
        { componentId: 'terminal-1', canvasId: 'canvas-1', title: 'Terminal', cwd: process.cwd(), cols: 80, rows: 24 }
      )

      const spawnOptions = (ptyMocks.spawn.mock.calls[0] as unknown[])[2] as { env: NodeJS.ProcessEnv }
      const env = spawnOptions.env
      expect(env.CODEX_THREAD_ID).toBeUndefined()
      expect(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE).toBeUndefined()
      expect(env.CODEX_SHELL).toBeUndefined()
      expect(env.CODEX_HOME).toBe('C:\\Users\\xhwz2\\.codex')
      expect(env.CODEX_API_KEY).toBe('test-key')

      service.dispose()
    } finally {
      if (previousThreadId === undefined) delete process.env.CODEX_THREAD_ID
      else process.env.CODEX_THREAD_ID = previousThreadId
      if (previousOriginator === undefined) delete process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE
      else process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = previousOriginator
      if (previousShell === undefined) delete process.env.CODEX_SHELL
      else process.env.CODEX_SHELL = previousShell
      if (previousHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousHome
      if (previousApiKey === undefined) delete process.env.CODEX_API_KEY
      else process.env.CODEX_API_KEY = previousApiKey
    }
  })

  it('reports a Codex command as a ready agent before provider hooks fire', async () => {
    const onAgentCommandStarted = vi.fn()
    const service = new PtyService({ onAgentCommandStarted })
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    const write = ipcHandler('terminal:write')
    const terminal = (await create(
      { sender: { id: 7 } },
      { componentId: 'terminal-1', canvasId: 'canvas-1', title: 'Codex terminal', cwd: process.cwd(), cols: 80, rows: 24 }
    )) as { sessionId: string; cwd: string }

    await write({}, { sessionId: terminal.sessionId, data: 'codex\r' })

    expect(ptyMocks.instances[0].write).toHaveBeenCalledWith('codex\r')
    expect(onAgentCommandStarted).toHaveBeenCalledWith({
      source: 'codex',
      command: 'codex',
      sessionId: terminal.sessionId,
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      title: 'Codex terminal',
      cwd: terminal.cwd
    })
    expect(electronMocks.ownerContents.send).toHaveBeenCalledWith('terminal:agent-command', {
      source: 'codex',
      command: 'codex',
      sessionId: terminal.sessionId,
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      cwd: terminal.cwd
    })

    service.dispose()
  })

  it('reports provider session ids as terminal restore commands', async () => {
    const service = new PtyService()
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    const terminal = (await create(
      { sender: { id: 7 } },
      { componentId: 'terminal-1', canvasId: 'canvas-1', title: 'Codex terminal', cwd: process.cwd(), cols: 80, rows: 24 }
    )) as { sessionId: string; cwd: string }

    service.recordAgentProviderSession({
      terminalSessionId: terminal.sessionId,
      source: 'codex',
      providerSessionId: '019e8407-5fbf-7f53-94da-b95c110a8110',
      cwd: 'D:\\projects\\AtlasOS'
    })

    expect(electronMocks.ownerContents.send).toHaveBeenCalledWith('terminal:agent-command', {
      source: 'codex',
      command: 'codex resume 019e8407-5fbf-7f53-94da-b95c110a8110',
      sessionId: terminal.sessionId,
      canvasId: 'canvas-1',
      componentId: 'terminal-1',
      cwd: 'D:\\projects\\AtlasOS'
    })

    service.dispose()
  })

  it('reports supported agent commands from initial commands and quoted executable paths', async () => {
    const onAgentCommandStarted = vi.fn()
    const service = new PtyService({ onAgentCommandStarted })
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    const terminal = (await create(
      { sender: { id: 7 } },
      {
        componentId: 'terminal-1',
        canvasId: 'canvas-1',
        title: 'Resume Codex',
        cwd: process.cwd(),
        initialCommand: '& "C:\\Users\\xhwz2\\AppData\\Roaming\\npm\\codex.cmd" resume codex-session',
        cols: 80,
        rows: 24
      }
    )) as { sessionId: string; didRunInitialCommand?: boolean }

    expect(terminal.didRunInitialCommand).toBe(true)
    expect(ptyMocks.instances[0].write).toHaveBeenCalledWith('& "C:\\Users\\xhwz2\\AppData\\Roaming\\npm\\codex.cmd" resume codex-session\r')
    expect(onAgentCommandStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'codex',
        command: '& "C:\\Users\\xhwz2\\AppData\\Roaming\\npm\\codex.cmd" resume codex-session',
        sessionId: terminal.sessionId,
        componentId: 'terminal-1',
        title: 'Resume Codex'
      })
    )

    service.dispose()
  })

  it('does not report ordinary terminal input that merely mentions Codex', async () => {
    const onAgentCommandStarted = vi.fn()
    const service = new PtyService({ onAgentCommandStarted })
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    const write = ipcHandler('terminal:write')
    const terminal = (await create(
      { sender: { id: 7 } },
      { componentId: 'terminal-1', canvasId: 'canvas-1', title: 'Terminal', cols: 80, rows: 24 }
    )) as { sessionId: string }

    await write({}, { sessionId: terminal.sessionId, data: 'echo codex\r' })
    await write({}, { sessionId: terminal.sessionId, data: 'codex --help\r' })

    expect(onAgentCommandStarted).not.toHaveBeenCalled()

    service.dispose()
  })

  it('keeps terminal output decoupled from agent status updates', async () => {
    const onSessionClosed = vi.fn()
    const service = new PtyService({ onSessionClosed })
    service.registerIpc()

    expect('onAgentSessionChanged' in (service as unknown as Record<string, unknown>)).toBe(false)

    const create = ipcHandler('terminal:create')
    const write = ipcHandler('terminal:write')
    const terminal = (await create(
      { sender: { id: 7 } },
      { componentId: 'terminal-1', canvasId: 'canvas-1', title: 'Terminal', cols: 80, rows: 24 }
    )) as { sessionId: string }

    await write({}, { sessionId: terminal.sessionId, data: 'claude\r' })
    ptyMocks.instances[0].emitData('Claude Code needs permission\r\nError: failed\r\nCompleted\r\n')

    expect(ptyMocks.instances[0].write).toHaveBeenCalledWith('claude\r')
    expect(electronMocks.ownerContents.send).toHaveBeenCalledWith('terminal:data', {
      sessionId: terminal.sessionId,
      data: 'Claude Code needs permission\r\nError: failed\r\nCompleted\r\n'
    })
    expect(onSessionClosed).not.toHaveBeenCalled()

    service.dispose()
  })

  it('writes an initial command only when creating a fresh PTY session', async () => {
    const service = new PtyService()
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    const firstSession = (await create(
      { sender: { id: 7 } },
      {
        componentId: 'terminal-1',
        canvasId: 'canvas-1',
        title: 'Claude',
        cwd: process.cwd(),
        initialCommand: 'claude --resume alpha-session',
        cols: 80,
        rows: 24
      }
    )) as { sessionId: string; didRunInitialCommand?: boolean }

    expect(firstSession.didRunInitialCommand).toBe(true)
    expect(ptyMocks.instances[0].write).toHaveBeenCalledWith('claude --resume alpha-session\r')

    const secondSession = (await create(
      { sender: { id: 8 } },
      {
        componentId: 'terminal-1',
        canvasId: 'canvas-1',
        title: 'Claude reused',
        initialCommand: 'claude --resume alpha-session',
        cols: 100,
        rows: 30
      }
    )) as { sessionId: string; didRunInitialCommand?: boolean }

    expect(secondSession.sessionId).toBe(firstSession.sessionId)
    expect(secondSession.didRunInitialCommand).toBe(false)
    expect(ptyMocks.spawn).toHaveBeenCalledTimes(1)
    expect(ptyMocks.instances[0].write).toHaveBeenCalledTimes(1)
    expect(ptyMocks.instances[0].resize).toHaveBeenCalledWith(100, 30)

    service.dispose()
  })

  it('uses one owner destroyed listener for multiple PTY sessions in the same WebContents', async () => {
    const service = new PtyService()
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    for (let index = 0; index < 11; index += 1) {
      await create(
        { sender: { id: 7 } },
        { componentId: `terminal-${index}`, canvasId: 'canvas-1', title: 'Terminal', cols: 80, rows: 24 }
      )
    }

    expect(electronMocks.ownerContents.once).toHaveBeenCalledTimes(1)

    const destroyedListener = electronMocks.ownerContents.once.mock.calls[0][1]
    service.dispose()

    expect(electronMocks.ownerContents.removeListener).toHaveBeenCalledWith('destroyed', destroyedListener)
  })

  it('auto-confirms Claude workspace trust prompts only for restored agent terminals', async () => {
    const service = new PtyService()
    service.registerIpc()
    const rawClaudeTrustPrompt = [
      '\x1b[8;2HQuick\x1b[1Csafety\x1b[1Ccheck:\x1b[1CIs\x1b[1Cthis\x1b[1Ca\x1b[1Cproject\x1b[1Cyou\x1b[1Ccreated\x1b[1Cor\x1b[1Cone\x1b[1Cyou\x1b[1Ctrust?',
      '\x1b[16;2H>\x1b[1C1.\x1b[1CYes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder',
      '\x1b[19;2HEnter\x1b[1Cto\x1b[1Cconfirm\x1b[1C.\x1b[1CEsc\x1b[1Cto\x1b[1Ccancel'
    ].join('')

    const create = ipcHandler('terminal:create')
    await create(
      { sender: { id: 7 } },
      {
        componentId: 'terminal-1',
        canvasId: 'canvas-1',
        title: 'Claude',
        cwd: process.cwd(),
        initialCommand: 'claude --resume alpha-session',
        autoConfirmWorkspaceTrust: true,
        cols: 80,
        rows: 24
      }
    )

    ptyMocks.instances[0].emitData(rawClaudeTrustPrompt)

    expect(ptyMocks.instances[0].write).toHaveBeenNthCalledWith(1, 'claude --resume alpha-session\r')
    expect(ptyMocks.instances[0].write).toHaveBeenNthCalledWith(2, '\r')

    await create(
      { sender: { id: 7 } },
      {
        componentId: 'terminal-2',
        canvasId: 'canvas-1',
        title: 'Claude manual',
        cwd: process.cwd(),
        initialCommand: 'claude --resume beta-session',
        cols: 80,
        rows: 24
      }
    )

    ptyMocks.instances[1].emitData('Quick safety check: Is this a project you created or one you trust?\r\n> 1. Yes, I trust this folder\r\nEnter to confirm\r\n')

    expect(ptyMocks.instances[1].write).toHaveBeenCalledTimes(1)
    expect(ptyMocks.instances[1].write).toHaveBeenCalledWith('claude --resume beta-session\r')

    service.dispose()
  })

  it('auto-confirms an existing restored Claude terminal if the prompt arrived before reuse', async () => {
    const service = new PtyService()
    service.registerIpc()
    const rawClaudeTrustPrompt = [
      '\x1b[8;2HQuick\x1b[1Csafety\x1b[1Ccheck:\x1b[1CIs\x1b[1Cthis\x1b[1Ca\x1b[1Cproject\x1b[1Cyou\x1b[1Ccreated\x1b[1Cor\x1b[1Cone\x1b[1Cyou\x1b[1Ctrust?',
      '\x1b[16;2H>\x1b[1C1.\x1b[1CYes,\x1b[1CI\x1b[1Ctrust\x1b[1Cthis\x1b[1Cfolder',
      '\x1b[19;2HEnter\x1b[1Cto\x1b[1Cconfirm'
    ].join('')

    const create = ipcHandler('terminal:create')
    const firstSession = (await create(
      { sender: { id: 7 } },
      {
        componentId: 'terminal-1',
        canvasId: 'canvas-1',
        title: 'Claude',
        cwd: process.cwd(),
        initialCommand: 'claude --resume alpha-session',
        cols: 80,
        rows: 24
      }
    )) as { sessionId: string }

    ptyMocks.instances[0].emitData(rawClaudeTrustPrompt)
    expect(ptyMocks.instances[0].write).toHaveBeenCalledTimes(1)

    const reusedSession = (await create(
      { sender: { id: 7 } },
      {
        componentId: 'terminal-1',
        canvasId: 'canvas-1',
        title: 'Claude',
        autoConfirmWorkspaceTrust: true,
        cols: 100,
        rows: 30
      }
    )) as { sessionId: string; didRunInitialCommand?: boolean }

    expect(reusedSession.sessionId).toBe(firstSession.sessionId)
    expect(reusedSession.didRunInitialCommand).toBe(false)
    expect(ptyMocks.instances[0].write).toHaveBeenNthCalledWith(2, '\r')

    service.dispose()
  })

  it('injects Atlas hook bridge environment into PTY sessions', async () => {
    const service = new PtyService({
      getAgentHookEnvironment: ({ sessionId, canvasId, componentId, cwd }) => ({
        ATLAS_PET_BRIDGE_URL: 'http://127.0.0.1:4567/agent-hook',
        ATLAS_PET_BRIDGE_TOKEN: 'token',
        ATLAS_TERMINAL_SESSION_ID: sessionId,
        ATLAS_CANVAS_ID: canvasId ?? '',
        ATLAS_TERMINAL_COMPONENT_ID: componentId,
        ATLAS_TERMINAL_CWD: cwd
      })
    })
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    const cwd = process.cwd()
    const terminal = (await create(
      { sender: { id: 7 } },
      { componentId: 'terminal-1', canvasId: 'canvas-1', title: 'Terminal', cwd, cols: 80, rows: 24 }
    )) as { sessionId: string }

    expect(ptyMocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          ATLAS_PET_BRIDGE_URL: 'http://127.0.0.1:4567/agent-hook',
          ATLAS_PET_BRIDGE_TOKEN: 'token',
          ATLAS_TERMINAL_SESSION_ID: terminal.sessionId,
          ATLAS_CANVAS_ID: 'canvas-1',
          ATLAS_TERMINAL_COMPONENT_ID: 'terminal-1',
          ATLAS_TERMINAL_CWD: cwd
        })
      })
    )

    service.dispose()
  })

  it('cleans up the matching pet session when the PTY session exits', async () => {
    const onSessionClosed = vi.fn()
    const service = new PtyService({ onSessionClosed })
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    const terminal = (await create(
      { sender: { id: 7 } },
      { componentId: 'terminal-1', canvasId: 'canvas-1', title: 'Terminal', cols: 80, rows: 24 }
    )) as { sessionId: string }

    ptyMocks.instances[0].emitExit({ exitCode: 1 })

    expect(onSessionClosed).toHaveBeenCalledWith(terminal.sessionId)
    expect(electronMocks.ownerContents.send).toHaveBeenCalledWith('terminal:exit', {
      sessionId: terminal.sessionId,
      exitCode: 1
    })

    service.dispose()
  })

  it('cleans up the matching pet session when the terminal component closes', async () => {
    const onSessionClosed = vi.fn()
    const service = new PtyService({ onSessionClosed })
    service.registerIpc()

    const create = ipcHandler('terminal:create')
    const closeComponent = ipcHandler('terminal:close-component')
    const terminal = (await create(
      { sender: { id: 7 } },
      { componentId: 'terminal-1', canvasId: 'canvas-1', title: 'Terminal', cols: 80, rows: 24 }
    )) as { sessionId: string }

    await closeComponent({}, { componentId: 'terminal-1' })

    expect(onSessionClosed).toHaveBeenCalledWith(terminal.sessionId)
    expect(ptyMocks.instances[0].kill).toHaveBeenCalled()

    service.dispose()
  })
})
