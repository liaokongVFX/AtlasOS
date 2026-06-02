import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexHistoryListResult, CodexHistorySessionDetail } from '@shared/codex-history'
import type { CanvasComponent } from '@shared/schema'
import { I18nProvider } from '../../i18n'
import { CodexHistoryComponent } from './codex-history-component'

const addComponentMock = vi.hoisted(() => vi.fn())

vi.mock('../../store/canvas-store', () => ({
  useCanvasStore: (selector: (state: { addComponent: typeof addComponentMock }) => unknown) => selector({ addComponent: addComponentMock })
}))

const component: CanvasComponent = {
  id: 'codex-history-1',
  type: 'codex-history',
  title: 'Codex History',
  frame: { x: 100, y: 120, width: 1040, height: 680 },
  zIndex: 1,
  config: {},
  state: {},
  bindings: {},
  createdAt: '2026-05-30T00:00:00.000Z',
  updatedAt: '2026-05-30T00:00:00.000Z'
}

const listResult: CodexHistoryListResult = {
  projects: [
    {
      id: 'd:\\projects\\alpha',
      name: 'alpha',
      path: 'D:\\projects\\alpha',
      sessionCount: 2,
      metadataOnlyCount: 1,
      lastActivityAt: '2026-05-30T10:00:00.000Z'
    }
  ],
  sessions: [
    {
      id: 'codex-session',
      sessionId: 'codex-session',
      projectId: 'd:\\projects\\alpha',
      projectPath: 'D:\\projects\\alpha',
      title: 'Codex session',
      cwd: 'D:\\projects\\alpha',
      createdAt: '2026-05-30T09:00:00.000Z',
      updatedAt: '2026-05-30T10:00:00.000Z',
      firstPrompt: 'Build codex',
      messageCount: 2,
      childCount: 0,
      metadataOnly: false,
      hasTranscript: true,
      isSidechain: false
    },
    {
      id: 'metadata-session',
      sessionId: 'metadata-session',
      projectId: 'd:\\projects\\alpha',
      projectPath: 'D:\\projects\\alpha',
      title: 'Metadata only',
      updatedAt: '2026-05-30T08:00:00.000Z',
      firstPrompt: 'Old codex prompt',
      messageCount: 0,
      childCount: 0,
      metadataOnly: true,
      hasTranscript: false,
      isSidechain: false
    }
  ]
}

const codexDetail: CodexHistorySessionDetail = {
  summary: listResult.sessions[0],
  messages: [
    {
      id: 'm1',
      role: 'user',
      kind: 'message',
      timestamp: '2026-05-30T09:00:00.000Z',
      text: 'Build codex',
      collapsed: false
    },
    {
      id: 'm2',
      role: 'tool',
      kind: 'tool_use',
      timestamp: '2026-05-30T09:01:00.000Z',
      title: 'Tool: shell_command',
      text: '{"command":"npm test"}',
      collapsed: true
    },
    {
      id: 'm3',
      role: 'assistant',
      kind: 'message',
      timestamp: '2026-05-30T09:02:00.000Z',
      text: 'Done',
      collapsed: false
    }
  ],
  childSessions: []
}

const metadataDetail: CodexHistorySessionDetail = {
  summary: listResult.sessions[1],
  messages: [],
  childSessions: []
}

function renderCodexHistory(): void {
  render(
    <I18nProvider locale="en-US">
      <CodexHistoryComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
      />
    </I18nProvider>
  )
}

describe('CodexHistoryComponent', () => {
  beforeEach(() => {
    addComponentMock.mockReset()
    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        codexHistory: {
          list: vi.fn().mockResolvedValue(listResult),
          getSession: vi.fn(({ sessionId }: { sessionId: string }) =>
            Promise.resolve(sessionId === 'metadata-session' ? metadataDetail : codexDetail)
          )
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders projects, sessions, transcripts, and creates Codex terminal nodes', async () => {
    renderCodexHistory()

    expect((await screen.findAllByText('alpha')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Codex session')).toBeInTheDocument()
    expect(await screen.findByText('Build codex')).toBeInTheDocument()
    expect(screen.getAllByText('Tool: shell_command')).toHaveLength(2)
    expect(screen.getByText('Done')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resume this session' }))
    expect(addComponentMock).toHaveBeenCalledWith(
      'terminal',
      { x: 1164, y: 120 },
      {
        title: 'Codex: Codex session',
        config: {
          cwd: 'D:\\projects\\alpha',
          initialCommand: 'codex resume codex-session'
        },
        state: {
          cwd: 'D:\\projects\\alpha',
          agentRestore: expect.objectContaining({
            source: 'codex',
            sessionId: 'codex-session',
            command: 'codex resume codex-session',
            cwd: 'D:\\projects\\alpha'
          })
        }
      }
    )

    fireEvent.click(screen.getByLabelText('Open terminal in project directory'))
    expect(addComponentMock).toHaveBeenLastCalledWith(
      'terminal',
      { x: 1164, y: 120 },
      {
        title: 'alpha',
        config: { cwd: 'D:\\projects\\alpha' },
        state: { cwd: 'D:\\projects\\alpha' }
      }
    )
  })

  it('shows metadata-only session state when the transcript is unavailable', async () => {
    renderCodexHistory()

    const sessionList = await screen.findByLabelText('Sessions')
    fireEvent.click(within(sessionList).getByRole('button', { name: /Metadata only/ }))

    expect(await screen.findByText('Index only')).toBeInTheDocument()
    expect(screen.getByText('The full transcript file for this session is not available in the local history directory.')).toBeInTheDocument()
    expect(screen.getByText('Old codex prompt')).toBeInTheDocument()
  })

  it('reloads projects when refresh is clicked', async () => {
    const refreshedHistory: CodexHistoryListResult = {
      projects: [
        {
          id: 'd:\\projects\\beta',
          name: 'beta',
          path: 'D:\\projects\\beta',
          sessionCount: 0,
          metadataOnlyCount: 0,
          lastActivityAt: '2026-05-30T11:00:00.000Z'
        }
      ],
      sessions: []
    }
    vi.mocked(window.atlas.codexHistory.list).mockResolvedValueOnce(listResult).mockResolvedValueOnce(refreshedHistory)

    renderCodexHistory()

    expect((await screen.findAllByText('alpha')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText('Refresh history'))

    expect((await screen.findAllByText('beta')).length).toBeGreaterThan(0)
    expect(window.atlas.codexHistory.list).toHaveBeenCalledTimes(2)
  })
})
