import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeHistoryService } from './claude-history-service'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.ipcHandle
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'claude-history-service-test')
const outsideRoot = join(process.cwd(), '.atlasos-dev', 'claude-history-service-outside')

async function writeJsonl(path: string, records: unknown[]): Promise<void> {
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

describe('ClaudeHistoryService', () => {
  beforeEach(async () => {
    electronMocks.ipcHandle.mockClear()
    await rm(testRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
  })

  it('merges Claude history, transcripts, metadata-only sessions, and folded subagents', async () => {
    const projectsRoot = join(testRoot, 'projects')
    const alphaProjectDir = join(projectsRoot, 'D--projects-alpha')
    const betaProjectDir = join(projectsRoot, 'D--projects-beta')
    const alphaTranscript = join(alphaProjectDir, 'alpha-session.jsonl')
    const outsideTranscript = join(outsideRoot, 'outside.jsonl')
    await mkdir(alphaProjectDir, { recursive: true })
    await mkdir(betaProjectDir, { recursive: true })
    await mkdir(join(alphaProjectDir, 'alpha-session', 'subagents'), { recursive: true })

    await writeJsonl(join(testRoot, 'history.jsonl'), [
      {
        project: 'D:\\projects\\alpha',
        sessionId: 'alpha-session',
        display: 'history prompt',
        timestamp: Date.parse('2026-05-01T10:00:00.000Z')
      },
      {
        project: 'D:\\projects\\beta',
        sessionId: 'missing-session',
        display: 'missing prompt',
        timestamp: Date.parse('2026-05-02T10:00:00.000Z')
      }
    ])

    await writeFile(
      join(alphaProjectDir, 'sessions-index.json'),
      JSON.stringify({
        version: 1,
        originalPath: 'D:\\projects\\alpha',
        entries: [
          {
            sessionId: 'alpha-session',
            fullPath: alphaTranscript,
            firstPrompt: 'indexed first prompt',
            summary: 'indexed summary',
            messageCount: 6,
            created: '2026-05-01T09:50:00.000Z',
            modified: '2026-05-01T10:10:00.000Z',
            projectPath: 'D:\\projects\\alpha',
            isSidechain: false
          }
        ]
      })
    )
    await writeFile(
      join(betaProjectDir, 'sessions-index.json'),
      JSON.stringify({
        version: 1,
        originalPath: 'D:\\projects\\beta',
        entries: [
          {
            sessionId: 'missing-session',
            fullPath: outsideTranscript,
            firstPrompt: 'indexed missing prompt',
            summary: 'metadata only title',
            messageCount: 4,
            created: '2026-05-02T09:50:00.000Z',
            modified: '2026-05-02T10:10:00.000Z',
            projectPath: 'D:\\projects\\beta',
            isSidechain: false
          }
        ]
      })
    )
    await writeJsonl(outsideTranscript, [{ type: 'ai-title', aiTitle: 'outside title', sessionId: 'missing-session' }])
    const alphaRecords = [
      { type: 'permission-mode', permissionMode: 'default', sessionId: 'alpha-session' },
      {
        type: 'user',
        uuid: 'user-1',
        timestamp: '2026-05-01T10:00:00.000Z',
        cwd: 'D:\\projects\\alpha\\packages\\app',
        sessionId: 'alpha-session',
        message: { role: 'user', content: 'real first prompt' }
      },
      {
        type: 'assistant',
        uuid: 'assistant-1',
        timestamp: '2026-05-01T10:01:00.000Z',
        cwd: 'D:\\projects\\alpha\\packages\\app',
        sessionId: 'alpha-session',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'assistant answer' },
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'git status' } },
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'clean', is_error: false }
          ]
        }
      },
      { type: 'system', subtype: 'turn_duration', sessionId: 'alpha-session', timestamp: '2026-05-01T10:02:00.000Z' },
      { type: 'ai-title', sessionId: 'alpha-session', aiTitle: 'AI Alpha Title' }
    ]
    await writeFile(alphaTranscript, `${alphaRecords.map((record) => JSON.stringify(record)).join('\n')}\n{malformed\n`)
    await writeJsonl(join(alphaProjectDir, 'alpha-session', 'subagents', 'agent-a1.jsonl'), [
      {
        type: 'user',
        uuid: 'child-user-1',
        timestamp: '2026-05-01T10:03:00.000Z',
        cwd: 'D:\\projects\\alpha',
        sessionId: 'alpha-session',
        agentId: 'a1',
        message: { role: 'user', content: 'child prompt' }
      },
      {
        type: 'assistant',
        uuid: 'child-assistant-1',
        timestamp: '2026-05-01T10:04:00.000Z',
        cwd: 'D:\\projects\\alpha',
        sessionId: 'alpha-session',
        agentId: 'a1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'child answer' }] }
      }
    ])

    const service = new ClaudeHistoryService(testRoot)
    const list = await service.list()
    const alpha = list.sessions.find((session) => session.sessionId === 'alpha-session')
    const missing = list.sessions.find((session) => session.sessionId === 'missing-session')

    expect(list.projects.map((project) => project.path)).toEqual(['D:\\projects\\beta', 'D:\\projects\\alpha'])
    expect(alpha).toMatchObject({
      title: 'AI Alpha Title',
      projectPath: 'D:\\projects\\alpha',
      cwd: 'D:\\projects\\alpha\\packages\\app',
      firstPrompt: 'real first prompt',
      messageCount: 6,
      childCount: 1,
      metadataOnly: false,
      hasTranscript: true
    })
    expect(missing).toMatchObject({
      title: 'metadata only title',
      metadataOnly: true,
      hasTranscript: false
    })

    const detail = await service.getSession('alpha-session')
    expect(detail.messages.map((message) => message.text)).toEqual(['real first prompt', 'assistant answer', 'git status', 'clean'])
    expect(detail.messages.find((message) => message.kind === 'tool_use')).toMatchObject({ collapsed: true, title: 'Tool: Bash' })
    expect(detail.childSessions).toHaveLength(1)
    expect(detail.childSessions[0].summary).toMatchObject({ isSidechain: true, title: 'child prompt' })
    expect(detail.childSessions[0].messages.map((message) => message.text)).toEqual(['child prompt', 'child answer'])

    await expect(service.getSession('missing-session')).resolves.toMatchObject({
      summary: {
        title: 'metadata only title',
        metadataOnly: true
      },
      messages: []
    })
  })

  it('registers the Claude history IPC channels', () => {
    new ClaudeHistoryService(testRoot).registerIpc()

    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('claude-history:list', expect.any(Function))
    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('claude-history:get-session', expect.any(Function))
  })
})
