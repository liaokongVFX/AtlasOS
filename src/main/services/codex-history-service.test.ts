import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexHistoryService } from './codex-history-service'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.ipcHandle
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'codex-history-service-test')

async function writeJsonl(path: string, records: unknown[]): Promise<void> {
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

describe('CodexHistoryService', () => {
  beforeEach(async () => {
    electronMocks.ipcHandle.mockClear()
    await rm(testRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
  })

  it('merges Codex indexes, rollouts, unindexed sessions, metadata-only sessions, and visible transcripts', async () => {
    const alphaRollout = join(testRoot, 'sessions', '2026', '05', '30', 'rollout-2026-05-30T10-00-00-indexed-session.jsonl')
    const betaRollout = join(testRoot, 'sessions', '2026', '05', '30', 'rollout-2026-05-30T12-00-00-unindexed-session.jsonl')
    const fallbackRollout = join(testRoot, 'sessions', '2026', '05', '29', 'rollout-2026-05-29T09-00-00-fallback-session.jsonl')
    await mkdir(join(testRoot, 'sessions', '2026', '05', '30'), { recursive: true })
    await mkdir(join(testRoot, 'sessions', '2026', '05', '29'), { recursive: true })

    await writeJsonl(join(testRoot, 'session_index.jsonl'), [
      {
        id: 'indexed-session',
        thread_name: 'Indexed Codex thread',
        updated_at: '2026-05-30T10:10:00.000Z'
      },
      {
        id: 'metadata-session',
        thread_name: 'Index only Codex thread',
        updated_at: '2026-05-30T11:00:00.000Z'
      }
    ])

    await writeFile(
      alphaRollout,
      `${[
        {
          type: 'session_meta',
          timestamp: '2026-05-30T09:55:00.000Z',
          payload: {
            id: 'indexed-session',
            cwd: 'D:\\projects\\alpha',
            timestamp: '2026-05-30T09:55:00.000Z'
          }
        },
        {
          type: 'response_item',
          timestamp: '2026-05-30T09:56:00.000Z',
          payload: {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: 'hidden developer context' }]
          }
        },
        {
          type: 'event_msg',
          timestamp: '2026-05-30T10:00:00.000Z',
          payload: {
            type: 'user_message',
            message: 'Build it'
          }
        },
        {
          type: 'response_item',
          timestamp: '2026-05-30T10:01:00.000Z',
          payload: {
            type: 'function_call',
            name: 'shell_command',
            call_id: 'call-1',
            arguments: '{"command":"git status"}'
          }
        },
        {
          type: 'response_item',
          timestamp: '2026-05-30T10:02:00.000Z',
          payload: {
            type: 'function_call_output',
            call_id: 'call-1',
            output: 'clean'
          }
        },
        {
          type: 'event_msg',
          timestamp: '2026-05-30T10:03:00.000Z',
          payload: {
            type: 'agent_message',
            phase: 'commentary',
            message: 'Done'
          }
        },
        {
          type: 'event_msg',
          timestamp: '2026-05-30T10:04:00.000Z',
          payload: {
            type: 'token_count',
            info: { total_token_usage: 123 }
          }
        }
      ].map((record) => JSON.stringify(record)).join('\n')}\n{malformed\n`
    )
    await writeJsonl(betaRollout, [
      {
        type: 'session_meta',
        timestamp: '2026-05-30T12:00:00.000Z',
        payload: {
          id: 'unindexed-session',
          cwd: 'D:\\projects\\beta'
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-05-30T12:01:00.000Z',
        payload: {
          type: 'thread_name_updated',
          thread_name: 'Beta from rollout'
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-05-30T12:02:00.000Z',
        payload: {
          type: 'user_message',
          message: 'Unindexed prompt'
        }
      }
    ])
    await writeJsonl(fallbackRollout, [
      {
        type: 'response_item',
        timestamp: '2026-05-29T08:58:00.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>D:\\projects\\hidden</cwd>\n</environment_context>' }]
        }
      },
      {
        type: 'response_item',
        timestamp: '2026-05-29T08:59:00.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '# AGENTS.md instructions for D:\\projects\\hidden\n\nInternal repo guidance.' }]
        }
      },
      {
        type: 'response_item',
        timestamp: '2026-05-29T09:00:00.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Old prompt' }]
        }
      },
      {
        type: 'response_item',
        timestamp: '2026-05-29T09:01:00.000Z',
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: '*** Begin Patch'
        }
      },
      {
        type: 'response_item',
        timestamp: '2026-05-29T09:02:00.000Z',
        payload: {
          type: 'custom_tool_call_output',
          output: 'Success'
        }
      },
      {
        type: 'response_item',
        timestamp: '2026-05-29T09:03:00.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Old answer' }]
        }
      }
    ])

    const service = new CodexHistoryService(testRoot)
    const list = await service.list()
    const indexed = list.sessions.find((session) => session.sessionId === 'indexed-session')
    const metadataOnly = list.sessions.find((session) => session.sessionId === 'metadata-session')
    const unindexed = list.sessions.find((session) => session.sessionId === 'unindexed-session')

    expect(list.projects.map((project) => project.path)).toEqual(['D:\\projects\\beta', testRoot, 'D:\\projects\\alpha'])
    expect(indexed).toMatchObject({
      title: 'Indexed Codex thread',
      projectPath: 'D:\\projects\\alpha',
      cwd: 'D:\\projects\\alpha',
      firstPrompt: 'Build it',
      messageCount: 2,
      metadataOnly: false,
      hasTranscript: true
    })
    expect(metadataOnly).toMatchObject({
      title: 'Index only Codex thread',
      projectPath: testRoot,
      metadataOnly: true,
      hasTranscript: false
    })
    expect(unindexed).toMatchObject({
      title: 'Beta from rollout',
      projectPath: 'D:\\projects\\beta',
      metadataOnly: false,
      hasTranscript: true
    })

    const detail = await service.getSession('indexed-session')
    expect(detail.messages.map((message) => message.text)).toEqual(['Build it', '{"command":"git status"}', 'clean', 'Done'])
    expect(detail.messages.some((message) => message.text.includes('hidden developer context'))).toBe(false)
    expect(detail.messages.find((message) => message.kind === 'tool_use')).toMatchObject({
      collapsed: true,
      title: 'Tool: shell_command'
    })
    expect(detail.childSessions).toEqual([])

    const fallback = await service.getSession('fallback-session')
    expect(fallback.messages.map((message) => message.text)).toEqual(['Old prompt', '*** Begin Patch', 'Success', 'Old answer'])
    expect(fallback.summary.firstPrompt).toBe('Old prompt')
    expect(fallback.messages.find((message) => message.kind === 'tool_result')).toMatchObject({ collapsed: true, title: 'Tool result' })
  })

  it('registers the Codex history IPC channels', () => {
    new CodexHistoryService(testRoot).registerIpc()

    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('codex-history:list', expect.any(Function))
    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('codex-history:get-session', expect.any(Function))
  })
})
