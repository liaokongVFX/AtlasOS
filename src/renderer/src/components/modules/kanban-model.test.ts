import { describe, expect, it } from 'vitest'
import {
  createDefaultKanbanState,
  createKanbanCard,
  createKanbanColumn,
  getFilteredKanbanColumns,
  getKanbanSearchTokens,
  getKanbanStats,
  isKanbanColumnWipExceeded,
  moveKanbanCard,
  moveKanbanColumn,
  normalizeKanbanState,
  updateKanbanView
} from './kanban-model'

const TIMESTAMP = '2026-05-23T00:00:00.000Z'

describe('kanban model', () => {
  it('creates the default local board shape', () => {
    const state = createDefaultKanbanState(TIMESTAMP)

    expect(state.schemaVersion).toBe(1)
    expect(state.columns.map((column) => column.title)).toEqual(['Backlog', 'Doing', 'Done'])
    expect(state.cards).toEqual({})
    expect(state.view).toEqual({ search: '', labels: [], assignees: [], priorities: [] })
  })

  it('normalizes partial and invalid persisted state', () => {
    const state = normalizeKanbanState(
      {
        schemaVersion: 1,
        columns: [
          { id: 'todo', title: ' Todo ', cardIds: ['card-1', 'missing', 'card-1'], wipLimit: '2' },
          { id: 'todo', title: 'Duplicate' }
        ],
        cards: {
          'card-1': { title: ' Ship ', labels: ['bug', 'bug', ''], priority: 'urgent' },
          'card-2': { title: '', dueDate: 'not-a-date' },
          bad: null
        },
        view: { labels: ['bug', ''], priorities: ['urgent', 'unknown'] }
      },
      TIMESTAMP
    )

    expect(state.columns).toHaveLength(1)
    expect(state.columns[0]).toMatchObject({ id: 'todo', title: 'Todo', cardIds: ['card-1', 'card-2'], wipLimit: 2 })
    expect(state.cards['card-1']).toMatchObject({ title: 'Ship', labels: ['bug'], priority: 'urgent' })
    expect(state.cards['card-2']).toMatchObject({ title: '新卡片', dueDate: '' })
    expect(state.view).toMatchObject({ labels: ['bug'], priorities: ['urgent'] })
  })

  it('moves cards within and across columns', () => {
    let state = createDefaultKanbanState(TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-1', { title: 'One' }, TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-2', { title: 'Two' }, TIMESTAMP)
    state = createKanbanCard(state, 'backlog', 'card-3', { title: 'Three' }, TIMESTAMP)

    state = moveKanbanCard(state, 'card-1', 'backlog', 2, TIMESTAMP)
    expect(state.columns[0].cardIds).toEqual(['card-2', 'card-3', 'card-1'])

    state = moveKanbanCard(state, 'card-3', 'doing', 0, TIMESTAMP)
    expect(state.columns[0].cardIds).toEqual(['card-2', 'card-1'])
    expect(state.columns[1].cardIds).toEqual(['card-3'])
  })

  it('moves columns and reports stats/search tokens', () => {
    let state = createDefaultKanbanState(TIMESTAMP)
    state = createKanbanColumn(state, 'review', { title: 'Review' }, TIMESTAMP)
    state = createKanbanCard(state, 'review', 'card-1', { title: 'Audit flow', labels: ['QA'], assignee: 'Ada' }, TIMESTAMP)
    state = moveKanbanColumn(state, 'review', 1, TIMESTAMP)

    expect(state.columns.map((column) => column.id)).toEqual(['backlog', 'review', 'doing', 'done'])
    expect(getKanbanStats(state)).toEqual({ columnCount: 4, cardCount: 1 })
    expect(getKanbanSearchTokens(state)).toEqual(expect.arrayContaining(['Review', 'Audit flow', 'QA', 'Ada']))
  })

  it('filters by search, labels, assignees, and priorities', () => {
    let state = createDefaultKanbanState(TIMESTAMP)
    state = createKanbanCard(
      state,
      'backlog',
      'card-1',
      { title: 'Fix renderer', labels: ['bug'], priority: 'high', assignee: 'Ada' },
      TIMESTAMP
    )
    state = createKanbanCard(
      state,
      'backlog',
      'card-2',
      { title: 'Write docs', labels: ['docs'], priority: 'low', assignee: 'Lin' },
      TIMESTAMP
    )

    const filtered = getFilteredKanbanColumns(
      updateKanbanView(state, { search: 'fix', labels: ['bug'], assignees: ['Ada'], priorities: ['high'] })
    )

    expect(filtered[0].cardIds).toEqual(['card-1'])
  })

  it('detects WIP limit overflow softly', () => {
    let state = createDefaultKanbanState(TIMESTAMP)
    state = createKanbanCard(state, 'doing', 'card-1', { title: 'One' }, TIMESTAMP)
    state = createKanbanCard(state, 'doing', 'card-2', { title: 'Two' }, TIMESTAMP)
    state.columns[1].wipLimit = 1

    expect(isKanbanColumnWipExceeded(state.columns[1])).toBe(true)
  })
})
