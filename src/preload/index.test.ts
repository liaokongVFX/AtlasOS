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
})
