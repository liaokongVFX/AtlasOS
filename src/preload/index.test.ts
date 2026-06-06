import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(),
  readText: vi.fn(() => ''),
  writeText: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: {
    readText: electronMocks.readText,
    writeText: electronMocks.writeText
  },
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener
  },
  webUtils: {
    getPathForFile: electronMocks.getPathForFile
  }
}))

describe('preload atlas API', () => {
  beforeEach(() => {
    vi.resetModules()
    electronMocks.exposeInMainWorld.mockClear()
    electronMocks.invoke.mockReset()
    electronMocks.on.mockReset()
    electronMocks.removeListener.mockReset()
  })

  it('exposes Claude and Codex history methods through narrow IPC channels', async () => {
    await import('./index')
    const atlasApi = electronMocks.exposeInMainWorld.mock.calls[0][1]

    electronMocks.invoke.mockResolvedValueOnce({ projects: [], sessions: [] })
    await atlasApi.claudeHistory.list()
    expect(electronMocks.invoke).toHaveBeenCalledWith('claude-history:list', {})

    electronMocks.invoke.mockResolvedValueOnce({ summary: {}, messages: [], childSessions: [] })
    await atlasApi.claudeHistory.getSession({ sessionId: 'alpha-session' })
    expect(electronMocks.invoke).toHaveBeenCalledWith('claude-history:get-session', { sessionId: 'alpha-session' })

    electronMocks.invoke.mockResolvedValueOnce({ projects: [], sessions: [] })
    await atlasApi.codexHistory.list()
    expect(electronMocks.invoke).toHaveBeenCalledWith('codex-history:list', {})

    electronMocks.invoke.mockResolvedValueOnce({ summary: {}, messages: [], childSessions: [] })
    await atlasApi.codexHistory.getSession({ sessionId: 'codex-session' })
    expect(electronMocks.invoke).toHaveBeenCalledWith('codex-history:get-session', { sessionId: 'codex-session' })
  })

  it('exposes agent hook installers through narrow IPC channels', async () => {
    await import('./index')
    const atlasApi = electronMocks.exposeInMainWorld.mock.calls[0][1]

    electronMocks.invoke.mockResolvedValueOnce({})
    await atlasApi.pet.installClaudeHooks()
    expect(electronMocks.invoke).toHaveBeenCalledWith('pet:install-claude-hooks', {})

    electronMocks.invoke.mockResolvedValueOnce({})
    await atlasApi.pet.installCodexHooks()
    expect(electronMocks.invoke).toHaveBeenCalledWith('pet:install-codex-hooks', {})

    electronMocks.invoke.mockResolvedValueOnce({})
    await atlasApi.pet.clearAlerts(['alert-1'])
    expect(electronMocks.invoke).toHaveBeenCalledWith('pet:clear-alerts', { alertIds: ['alert-1'] })
  })

  it('passes explicit filesystem watch target paths through IPC', async () => {
    await import('./index')
    const atlasApi = electronMocks.exposeInMainWorld.mock.calls[0][1]

    electronMocks.invoke.mockResolvedValueOnce({ watchId: 'watch-1' })
    await atlasApi.filesystem.watch('D:\\repo', 'D:\\repo\\src')

    expect(electronMocks.invoke).toHaveBeenCalledWith('filesystem:watch', {
      rootPath: 'D:\\repo',
      targetPath: 'D:\\repo\\src'
    })
  })

  it('exposes update actions and state events through narrow IPC channels', async () => {
    await import('./index')
    const atlasApi = electronMocks.exposeInMainWorld.mock.calls[0][1]
    const listener = vi.fn()

    electronMocks.invoke.mockResolvedValueOnce({ status: 'idle', currentVersion: '0.1.0', updatedAt: '2026-06-02T00:00:00.000Z' })
    await atlasApi.updates.getState()
    expect(electronMocks.invoke).toHaveBeenCalledWith('updates:get-state', {})

    electronMocks.invoke.mockResolvedValueOnce({ status: 'checking', currentVersion: '0.1.0', updatedAt: '2026-06-02T00:00:00.000Z' })
    await atlasApi.updates.check()
    expect(electronMocks.invoke).toHaveBeenCalledWith('updates:check', {})

    electronMocks.invoke.mockResolvedValueOnce({ status: 'downloading', currentVersion: '0.1.0', updatedAt: '2026-06-02T00:00:00.000Z' })
    await atlasApi.updates.download()
    expect(electronMocks.invoke).toHaveBeenCalledWith('updates:download', {})

    electronMocks.invoke.mockResolvedValueOnce({ ok: true })
    await atlasApi.updates.installAndRestart()
    expect(electronMocks.invoke).toHaveBeenCalledWith('updates:install-and-restart', {})

    const dispose = atlasApi.updates.onStateUpdated(listener)
    const wrapped = electronMocks.on.mock.calls.find(([channel]) => channel === 'updates:state-updated')?.[1]
    expect(wrapped).toBeDefined()

    wrapped({}, { status: 'available', currentVersion: '0.1.0', availableVersion: '0.2.0', updatedAt: '2026-06-02T00:00:00.000Z' })
    expect(listener).toHaveBeenCalledWith({
      status: 'available',
      currentVersion: '0.1.0',
      availableVersion: '0.2.0',
      updatedAt: '2026-06-02T00:00:00.000Z'
    })

    dispose()
    expect(electronMocks.removeListener).toHaveBeenCalledWith('updates:state-updated', wrapped)
  })

  it('scopes terminal agent command events to the requested session', async () => {
    await import('./index')
    const atlasApi = electronMocks.exposeInMainWorld.mock.calls[0][1]
    const listener = vi.fn()

    atlasApi.terminal.onAgentCommand('session-1', listener)
    const wrapped = electronMocks.on.mock.calls.find(([channel]) => channel === 'terminal:agent-command')?.[1]
    expect(wrapped).toBeDefined()

    wrapped({}, {
      sessionId: 'session-2',
      componentId: 'terminal-2',
      source: 'codex',
      command: 'codex resume other'
    })
    wrapped({}, {
      sessionId: 'session-1',
      componentId: 'terminal-1',
      source: 'claude',
      cwd: 'D:\\projects\\AtlasOS',
      command: 'claude --resume alpha-session'
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      componentId: 'terminal-1',
      source: 'claude',
      cwd: 'D:\\projects\\AtlasOS',
      command: 'claude --resume alpha-session'
    })
  })
})
