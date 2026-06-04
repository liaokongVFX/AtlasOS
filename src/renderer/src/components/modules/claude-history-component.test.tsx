import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import type { ClaudeHistoryListResult, ClaudeHistorySessionDetail } from '@shared/claude-history'
import { I18nProvider } from '../../i18n'
import { ClaudeHistoryComponent } from './claude-history-component'

const addComponentMock = vi.hoisted(() => vi.fn())

vi.mock('../../store/canvas-store', () => ({
  useCanvasStore: (selector: (state: { addComponent: typeof addComponentMock }) => unknown) => selector({ addComponent: addComponentMock })
}))

const component: CanvasComponent = {
  id: 'claude-history-1',
  type: 'claude-history',
  title: 'Claude History',
  frame: { x: 100, y: 120, width: 1040, height: 680 },
  zIndex: 1,
  config: {},
  state: {},
  bindings: {},
  createdAt: '2026-05-29T00:00:00.000Z',
  updatedAt: '2026-05-29T00:00:00.000Z'
}

const listResult: ClaudeHistoryListResult = {
  projects: [
    {
      id: 'd:\\projects\\alpha',
      name: 'alpha',
      path: 'D:\\projects\\alpha',
      sessionCount: 2,
      metadataOnlyCount: 1,
      lastActivityAt: '2026-05-29T10:00:00.000Z'
    }
  ],
  sessions: [
    {
      id: 'alpha-session',
      sessionId: 'alpha-session',
      projectId: 'd:\\projects\\alpha',
      projectPath: 'D:\\projects\\alpha',
      title: 'Alpha session',
      cwd: 'D:\\projects\\alpha',
      createdAt: '2026-05-29T09:00:00.000Z',
      updatedAt: '2026-05-29T10:00:00.000Z',
      firstPrompt: 'Build it',
      messageCount: 2,
      childCount: 1,
      metadataOnly: false,
      hasTranscript: true,
      isSidechain: false
    },
    {
      id: 'missing-session',
      sessionId: 'missing-session',
      projectId: 'd:\\projects\\alpha',
      projectPath: 'D:\\projects\\alpha',
      title: 'Missing transcript',
      updatedAt: '2026-05-29T08:00:00.000Z',
      firstPrompt: 'Old prompt',
      summary: 'Old summary',
      messageCount: 1,
      childCount: 0,
      metadataOnly: true,
      hasTranscript: false,
      isSidechain: false
    }
  ]
}

const alphaDetail: ClaudeHistorySessionDetail = {
  summary: listResult.sessions[0],
  messages: [
    {
      id: 'm1',
      role: 'user',
      kind: 'message',
      timestamp: '2026-05-29T09:00:00.000Z',
      text: 'Build it',
      collapsed: false
    },
    {
      id: 'm2',
      role: 'tool',
      kind: 'tool_use',
      timestamp: '2026-05-29T09:01:00.000Z',
      title: 'Tool: Bash',
      text: 'git status',
      collapsed: true
    }
  ],
  childSessions: [
    {
      summary: {
        ...listResult.sessions[0],
        id: 'alpha-session:a1',
        title: 'Subagent task',
        isSidechain: true
      },
      messages: [
        {
          id: 'c1',
          role: 'assistant',
          kind: 'message',
          text: 'Child answer',
          collapsed: false
        }
      ]
    }
  ]
}

const missingDetail: ClaudeHistorySessionDetail = {
  summary: listResult.sessions[1],
  messages: [],
  childSessions: []
}

function renderClaudeHistory(): void {
  render(
    <I18nProvider locale="en-US">
      <ClaudeHistoryComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
      />
    </I18nProvider>
  )
}

describe('ClaudeHistoryComponent', () => {
  beforeEach(() => {
    addComponentMock.mockReset()
    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        claudeHistory: {
          list: vi.fn().mockResolvedValue(listResult),
          getSession: vi.fn(({ sessionId }: { sessionId: string }) =>
            Promise.resolve(sessionId === 'missing-session' ? missingDetail : alphaDetail)
          )
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders projects, sessions, transcripts, folded subagents, and creates terminal nodes', async () => {
    renderClaudeHistory()

    expect((await screen.findAllByText('alpha')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Alpha session')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Build it')).toBeInTheDocument()
    expect(screen.getAllByText('Tool: Bash')).toHaveLength(2)
    expect(screen.getByText('Subagent task')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resume this session' }))
    expect(addComponentMock).toHaveBeenCalledWith(
      'terminal',
      { x: 1164, y: 120 },
      {
        title: 'Claude: Alpha session',
        config: {
          cwd: 'D:\\projects\\alpha',
          initialCommand: 'claude --resume alpha-session'
        },
        state: {
          cwd: 'D:\\projects\\alpha',
          agentRestore: expect.objectContaining({
            source: 'claude',
            sessionId: 'alpha-session',
            command: 'claude --resume alpha-session',
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
    renderClaudeHistory()

    const sessionList = await screen.findByLabelText('Sessions')
    fireEvent.click(within(sessionList).getByRole('button', { name: /Missing transcript/ }))

    expect(await screen.findByText('Index only')).toBeInTheDocument()
    expect(screen.getByText('The full transcript file for this session is not available in the local history directory.')).toBeInTheDocument()
    expect(screen.getByText('Old summary')).toBeInTheDocument()
    expect(screen.getByText('Old prompt')).toBeInTheDocument()
  })

  it('reloads projects when refresh is clicked', async () => {
    const refreshedHistory: ClaudeHistoryListResult = {
      projects: [
        {
          id: 'd:\\projects\\beta',
          name: 'beta',
          path: 'D:\\projects\\beta',
          sessionCount: 0,
          metadataOnlyCount: 0,
          lastActivityAt: '2026-05-29T11:00:00.000Z'
        }
      ],
      sessions: []
    }
    vi.mocked(window.atlas.claudeHistory.list).mockResolvedValueOnce(listResult).mockResolvedValueOnce(refreshedHistory)

    renderClaudeHistory()

    expect((await screen.findAllByText('alpha')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText('Refresh history'))

    expect((await screen.findAllByText('beta')).length).toBeGreaterThan(0)
    expect(window.atlas.claudeHistory.list).toHaveBeenCalledTimes(2)
  })
})
