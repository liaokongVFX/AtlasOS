import { describe, expect, it } from 'vitest'
import {
  createDefaultQuickLauncherState,
  createQuickLauncherItem,
  createQuickLauncherTab,
  deleteQuickLauncherTab,
  moveQuickLauncherItem,
  moveQuickLauncherTab,
  normalizeQuickLauncherState,
  updateQuickLauncherItem
} from './quick-launcher-model'

const TIMESTAMP = '2026-05-24T00:00:00.000Z'
const TEXT = {
  defaultTabName: '常用',
  defaultItemName: '快捷项'
}

describe('quick launcher model', () => {
  it('creates a default launcher state for empty input', () => {
    const state = normalizeQuickLauncherState({}, TIMESTAMP, TEXT)

    expect(state).toEqual({
      schemaVersion: 1,
      tabs: [
        {
          id: 'default',
          name: '常用',
          itemIds: [],
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP
        }
      ],
      items: {},
      activeTabId: 'default'
    })
  })

  it('normalizes damaged tabs and keeps valid unassigned items reachable', () => {
    const state = normalizeQuickLauncherState(
      {
        activeTabId: 'missing',
        tabs: [
          { id: 'work', name: '', itemIds: ['app-1', 'app-1', 'missing'] },
          { id: 'work', name: 'duplicate', itemIds: [] }
        ],
        items: {
          'app-1': { kind: 'app', name: '', targetPath: 'C:\\Tools\\Code.exe' },
          'url-1': { kind: 'url', name: 'Docs', url: 'https://example.com/docs' },
          broken: { kind: 'file', name: 'Broken' }
        }
      },
      TIMESTAMP,
      TEXT
    )

    expect(state.activeTabId).toBe('work')
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({
      id: 'work',
      name: '常用 1',
      itemIds: ['app-1', 'url-1']
    })
    expect(state.items['app-1']).toMatchObject({ name: 'Code.exe', targetPath: 'C:\\Tools\\Code.exe' })
    expect(state.items.broken).toBeUndefined()
  })

  it('creates, updates, and deletes tab-owned shortcuts', () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP, TEXT)
    state = createQuickLauncherTab(state, 'work', 'Work', TIMESTAMP, TEXT)
    state = createQuickLauncherItem(
      state,
      'work',
      'item-1',
      { kind: 'command', name: 'Dev server', shell: 'powershell', command: 'npm run dev', cwd: 'D:\\repo' },
      TIMESTAMP,
      TEXT
    )
    state = updateQuickLauncherItem(state, 'item-1', { kind: 'url', name: 'Docs', url: 'https://example.com' }, TIMESTAMP, TEXT)

    expect(state.items['item-1']).toMatchObject({
      kind: 'url',
      name: 'Docs',
      url: 'https://example.com'
    })

    state = deleteQuickLauncherTab(state, 'work')

    expect(state.tabs.map((tab) => tab.id)).toEqual(['default'])
    expect(state.items['item-1']).toBeUndefined()
    expect(deleteQuickLauncherTab(state, 'default')).toBe(state)
  })

  it('sorts tabs and shortcuts', () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP, TEXT)
    state = createQuickLauncherTab(state, 'docs', 'Docs', TIMESTAMP, TEXT)
    state = createQuickLauncherItem(state, 'default', 'terminal', { kind: 'app', name: 'Terminal', targetPath: 'C:\\Windows\\System32\\cmd.exe' }, TIMESTAMP, TEXT)
    state = createQuickLauncherItem(state, 'default', 'notes', { kind: 'file', name: 'Notes', targetPath: 'D:\\notes.md' }, TIMESTAMP, TEXT)
    state = createQuickLauncherItem(state, 'docs', 'api', { kind: 'url', name: 'API docs', url: 'https://example.com/api' }, TIMESTAMP, TEXT)

    state = moveQuickLauncherTab(state, 'docs', 0)
    state = moveQuickLauncherItem(state, 'default', 'notes', 0)

    expect(state.tabs.map((tab) => tab.id)).toEqual(['docs', 'default'])
    expect(state.tabs.find((tab) => tab.id === 'default')?.itemIds).toEqual(['notes', 'terminal'])
  })

  it('preserves safe native icon data for path shortcuts', () => {
    const iconDataUrl = 'data:image/png;base64,aWNvbg=='
    let state = createDefaultQuickLauncherState(TIMESTAMP, TEXT)
    state = createQuickLauncherItem(
      state,
      'default',
      'terminal',
      { kind: 'app', name: 'Terminal', targetPath: 'C:\\Windows\\System32\\cmd.exe', iconDataUrl },
      TIMESTAMP,
      TEXT
    )
    state = updateQuickLauncherItem(
      state,
      'terminal',
      { kind: 'app', name: 'Command Prompt', targetPath: 'C:\\Windows\\System32\\cmd.exe', iconDataUrl },
      TIMESTAMP,
      TEXT
    )

    expect(state.items.terminal).toMatchObject({
      kind: 'app',
      iconDataUrl
    })

    const normalized = normalizeQuickLauncherState(
      {
        tabs: [{ id: 'default', itemIds: ['terminal'] }],
        items: {
          terminal: { kind: 'app', targetPath: 'C:\\Windows\\System32\\cmd.exe', iconDataUrl },
          unsafe: { kind: 'app', targetPath: 'C:\\Tools\\unsafe.exe', iconDataUrl: 'data:text/plain;base64,aWNvbg==' }
        }
      },
      TIMESTAMP,
      TEXT
    )

    expect(normalized.items.terminal).toMatchObject({ iconDataUrl })
    expect(normalized.items.unsafe).not.toHaveProperty('iconDataUrl')
  })
})
