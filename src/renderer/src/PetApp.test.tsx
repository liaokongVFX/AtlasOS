import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PET_SETTINGS, DEFAULT_PET_WINDOW_STATE, type PetRuntimeState } from '@shared/pet'
import { PetApp } from './PetApp'

const petApi = {
  getState: vi.fn(),
  updateSettings: vi.fn(),
  ackAlert: vi.fn(),
  clearAlerts: vi.fn(),
  snoozeAlert: vi.fn(),
  setPosition: vi.fn(),
  setInteractive: vi.fn(),
  openTarget: vi.fn(),
  listAgentSessions: vi.fn(),
  onStateUpdated: vi.fn()
}

function createState(): PetRuntimeState {
  return {
    settings: {
      ...DEFAULT_PET_SETTINGS,
      showRunningAgents: true
    },
    alerts: [
      {
        id: 'alert-1',
        kind: 'agent_waiting',
        severity: 'warning',
        title: 'Claude Code is asking',
        body: 'Terminal',
        target: { canvasId: 'canvas-1', componentId: 'terminal-1', sessionId: 'session-1' },
        createdAt: '2026-05-29T10:00:00.000Z',
        dedupeKey: 'agent:session-1:waiting_for_confirmation:2026-05-29T10:00:00.000Z'
      }
    ],
    agentSessions: [
      {
        id: 'session-1',
        source: 'claude',
        status: 'waiting_for_confirmation',
        canvasId: 'canvas-1',
        componentId: 'terminal-1',
        title: 'Terminal',
        cwd: 'D:\\projects\\AtlasOS',
        lastActivityAt: '2026-05-29T10:00:00.000Z',
        attentionReason: 'Waiting for input'
      }
    ],
    window: { ...DEFAULT_PET_WINDOW_STATE, orbOffset: { ...DEFAULT_PET_WINDOW_STATE.orbOffset } },
    bridge: {
      enabled: true,
      port: 7237,
      token: 'token',
      claudeHook: {
        installed: true,
        settingsPath: 'C:\\Users\\xhwz2\\.claude\\settings.json',
        command: 'node',
        args: ['D:\\AtlasOS\\agent-hook-forwarder.cjs', 'claude'],
        displayCommand: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" "claude"',
        events: ['SessionStart'],
        installedEvents: ['SessionStart']
      },
      codexHook: {
        installed: true,
        settingsPath: 'C:\\Users\\xhwz2\\.codex\\hooks.json',
        command: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" codex',
        args: [],
        displayCommand: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" codex',
        events: ['SessionStart'],
        installedEvents: ['SessionStart']
      }
    }
  }
}

function createCompletedState(): PetRuntimeState {
  return {
    ...createState(),
    alerts: [
      {
        id: 'alert-1',
        kind: 'agent_completed',
        severity: 'info',
        title: 'Claude Code completed',
        body: 'Terminal',
        target: { canvasId: 'canvas-1', componentId: 'terminal-1', sessionId: 'session-1' },
        createdAt: '2026-05-29T10:00:05.000Z',
        dedupeKey: 'agent:session-1:completed:2026-05-29T10:00:05.000Z'
      }
    ],
    agentSessions: [
      {
        id: 'session-1',
        source: 'claude',
        status: 'completed',
        canvasId: 'canvas-1',
        componentId: 'terminal-1',
        title: 'Terminal',
        cwd: 'D:\\projects\\AtlasOS',
        lastActivityAt: '2026-05-29T10:00:05.000Z'
      }
    ]
  }
}

function createReadyState(): PetRuntimeState {
  return {
    ...createState(),
    alerts: [],
    agentSessions: [
      {
        id: 'session-1',
        source: 'claude',
        status: 'idle_unknown',
        canvasId: 'canvas-1',
        componentId: 'terminal-1',
        title: 'Terminal',
        cwd: 'D:\\projects\\AtlasOS',
        lastActivityAt: '2026-05-29T10:00:00.000Z'
      }
    ]
  }
}

function createRunningState(): PetRuntimeState {
  const state = createReadyState()
  return {
    ...state,
    agentSessions: [
      {
        ...state.agentSessions[0],
        status: 'running'
      }
    ]
  }
}

describe('PetApp', () => {
  beforeEach(() => {
    for (const mock of Object.values(petApi)) mock.mockReset()
    petApi.getState.mockResolvedValue(createState())
    petApi.ackAlert.mockResolvedValue({ ok: true })
    petApi.clearAlerts.mockResolvedValue({ ok: true })
    petApi.setInteractive.mockResolvedValue({ ok: true })
    petApi.setPosition.mockResolvedValue(DEFAULT_PET_SETTINGS.position)
    petApi.onStateUpdated.mockReturnValue(() => undefined)

    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: { pet: petApi }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('labels asking agents without double-counting the matching alert', async () => {
    const { container } = render(<PetApp />)

    const orb = await screen.findByRole('button', { name: 'AtlasOS pet' })
    expect(await screen.findByText('1')).toHaveClass('pet-orb__badge')

    fireEvent.pointerEnter(orb.parentElement as Element)

    expect(await screen.findByText('Claude Code is asking')).toBeInTheDocument()
    expect(screen.getByText('asking')).toBeInTheDocument()
    expect(container.querySelector('.pet-row__dot--waiting_for_confirmation')).toBeInTheDocument()
  })

  it('labels newly started agents as ready instead of running', async () => {
    petApi.getState.mockResolvedValue(createReadyState())

    render(<PetApp />)

    const orb = await screen.findByRole('button', { name: 'AtlasOS pet' })
    expect(screen.queryByText('1')).not.toBeInTheDocument()

    fireEvent.pointerEnter(orb.parentElement as Element)

    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(screen.queryByText('running')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing needs attention.')).toBeInTheDocument()
  })

  it('keeps completed alerts while clearing completed agents from the running list', async () => {
    petApi.getState.mockResolvedValue(createCompletedState())

    render(<PetApp />)

    const orb = await screen.findByRole('button', { name: 'AtlasOS pet' })
    expect(await screen.findByText('1')).toHaveClass('pet-orb__badge')

    fireEvent.pointerEnter(orb.parentElement as Element)

    expect(await screen.findByText('Claude Code completed')).toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
    expect(screen.getByText('No Codex or Claude sessions.')).toBeInTheDocument()
    expect(screen.queryByText('asking')).not.toBeInTheDocument()
  })

  it('uses the running asset while agents are running without attention', async () => {
    petApi.getState.mockResolvedValue({
      ...createRunningState(),
      settings: {
        ...DEFAULT_PET_SETTINGS,
        assetPack: {
          ...DEFAULT_PET_SETTINGS.assetPack,
          idleSrc: 'atlas-file://preview?path=idle-sprite.png',
          idleKind: 'sprite',
          idleSprite: { frameCount: 8, fps: 8 },
          runningSrc: 'atlas-file://preview?path=running-sprite.png',
          runningKind: 'sprite',
          runningSprite: { frameCount: 4, fps: 8 },
          attentionSrc: 'atlas-file://preview?path=attention-sprite.png',
          attentionKind: 'sprite',
          attentionSprite: { frameCount: 8, fps: 8 }
        },
        actionMap: {
          ...DEFAULT_PET_SETTINGS.actionMap,
          running: 'shake'
        }
      }
    })

    const { container } = render(<PetApp />)

    const orb = await screen.findByRole('button', { name: 'AtlasOS pet' })
    expect(orb).toHaveClass('pet-orb--motion-shake')
    expect(orb).not.toHaveClass('pet-orb--attention')
    expect(container.querySelector<HTMLImageElement>('.pet-orb__sprite-strip')?.getAttribute('src')).toBe('atlas-file://preview?path=running-sprite.png')
  })

  it('keeps informational completed alerts on the idle asset', async () => {
    petApi.getState.mockResolvedValue({
      ...createCompletedState(),
      settings: {
        ...DEFAULT_PET_SETTINGS,
        assetPack: {
          ...DEFAULT_PET_SETTINGS.assetPack,
          idleSrc: 'atlas-file://preview?path=idle-sprite.png',
          idleKind: 'sprite',
          idleSprite: { frameCount: 8, fps: 8 },
          attentionSrc: 'atlas-file://preview?path=attention-sprite.png',
          attentionKind: 'sprite',
          attentionSprite: { frameCount: 8, fps: 8 }
        }
      }
    })

    const { container } = render(<PetApp />)

    const orb = await screen.findByRole('button', { name: 'AtlasOS pet' })
    expect(orb).not.toHaveClass('pet-orb--attention')
    expect(await screen.findByText('1')).toHaveClass('pet-orb__badge')
    expect(container.querySelector<HTMLImageElement>('.pet-orb__sprite-strip')?.getAttribute('src')).toBe('atlas-file://preview?path=idle-sprite.png')
  })

  it('renders horizontal sprite sheet assets with playback metadata', async () => {
    petApi.getState.mockResolvedValue({
      ...createReadyState(),
      settings: {
        ...DEFAULT_PET_SETTINGS,
        assetPack: {
          ...DEFAULT_PET_SETTINGS.assetPack,
          idleSrc: 'atlas-file://preview?path=idle-sprite.png',
          idleKind: 'sprite',
          idleSprite: { frameCount: 6, fps: 12 }
        }
      }
    })

    const { container } = render(<PetApp />)

    expect(await screen.findByAltText('Atlas Orb')).toHaveClass('pet-orb__sprite-strip')
    expect(container.querySelector('.pet-orb')).toHaveClass('pet-orb--asset')
    expect(container.querySelector('.pet-orb__core')).not.toBeInTheDocument()
    const sprite = container.querySelector<HTMLElement>('.pet-orb__sprite')
    expect(sprite?.style.getPropertyValue('--pet-sprite-frame-count')).toBe('6')
    expect(sprite?.style.getPropertyValue('--pet-sprite-strip-width')).toBe('600%')
    expect(sprite?.style.getPropertyValue('--pet-sprite-duration')).toBe('0.5s')
  })

  it('positions the orb from the runtime window offset', async () => {
    petApi.getState.mockResolvedValue({
      ...createReadyState(),
      window: {
        panelSide: 'right',
        orbOffset: { x: 284, y: 348 }
      }
    })

    render(<PetApp />)

    const orb = await screen.findByRole('button', { name: 'AtlasOS pet' })
    expect(orb).toHaveStyle({
      left: '284px',
      top: '348px'
    })
  })

  it('dismisses individual alerts and clears visible alerts from the panel', async () => {
    render(<PetApp />)

    const orb = await screen.findByRole('button', { name: 'AtlasOS pet' })
    fireEvent.pointerEnter(orb.parentElement as Element)

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss Claude Code is asking' }))
    await waitFor(() => expect(petApi.ackAlert).toHaveBeenCalledWith('alert-1'))
    expect(petApi.openTarget).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Clear alerts' }))
    await waitFor(() => expect(petApi.clearAlerts).toHaveBeenCalledWith(['alert-1']))
  })
})
