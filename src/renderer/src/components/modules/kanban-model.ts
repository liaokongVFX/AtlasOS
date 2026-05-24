export const KANBAN_STATE_VERSION = 1

export const KANBAN_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

export type KanbanPriority = (typeof KANBAN_PRIORITIES)[number]

export type KanbanCard = {
  id: string
  title: string
  description: string
  labels: string[]
  priority: KanbanPriority
  assignee: string
  dueDate: string
  createdAt: string
  updatedAt: string
}

export type KanbanColumn = {
  id: string
  title: string
  cardIds: string[]
  wipLimit: number | null
  createdAt: string
  updatedAt: string
}

export type KanbanView = {
  search: string
  labels: string[]
  assignees: string[]
  priorities: KanbanPriority[]
}

export type KanbanState = {
  schemaVersion: typeof KANBAN_STATE_VERSION
  columns: KanbanColumn[]
  cards: Record<string, KanbanCard>
  view: KanbanView
}

export type KanbanCardInput = Partial<Pick<KanbanCard, 'title' | 'description' | 'labels' | 'priority' | 'assignee' | 'dueDate'>>

export type KanbanColumnInput = {
  title?: string
  wipLimit?: number | string | null
}

export type KanbanText = {
  defaultColumns: ReadonlyArray<{ id: string; title: string }>
  defaultCardTitle: string
  defaultColumnTitle: string
}

export const DEFAULT_KANBAN_TEXT: KanbanText = {
  defaultColumns: [
    { id: 'backlog', title: '待办' },
    { id: 'doing', title: '进行中' },
    { id: 'done', title: '完成' }
  ],
  defaultCardTitle: '新卡片',
  defaultColumnTitle: '新列'
}

const MAX_WIP_LIMIT = 999

function nowIso(): string {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asTitle(value: unknown, fallback: string): string {
  const title = asString(value).trim()
  return title || fallback
}

function asDate(value: unknown): string {
  const date = asString(value).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

function asTimestamp(value: unknown, fallback: string): string {
  const timestamp = asString(value).trim()
  return timestamp || fallback
}

function normalizePriority(value: unknown): KanbanPriority {
  return KANBAN_PRIORITIES.includes(value as KanbanPriority) ? (value as KanbanPriority) : 'none'
}

export function normalizeKanbanLabels(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、\n]/) : []
  const labels = source
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  return [...new Set(labels)]
}

function normalizeWipLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null

  const limit = Math.round(numeric)
  if (limit < 1) return null
  return Math.min(limit, MAX_WIP_LIMIT)
}

function createDefaultView(): KanbanView {
  return {
    search: '',
    labels: [],
    assignees: [],
    priorities: []
  }
}

function normalizeView(value: unknown): KanbanView {
  if (!isRecord(value)) return createDefaultView()

  return {
    search: asString(value.search).trim(),
    labels: normalizeKanbanLabels(value.labels),
    assignees: normalizeKanbanLabels(value.assignees),
    priorities: Array.isArray(value.priorities)
      ? [...new Set(value.priorities.map(normalizePriority).filter((priority) => priority !== 'none'))]
      : []
  }
}

function createColumn(id: string, title: string, timestamp: string): KanbanColumn {
  return {
    id,
    title,
    cardIds: [],
    wipLimit: null,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function createDefaultKanbanState(timestamp = nowIso(), text: KanbanText = DEFAULT_KANBAN_TEXT): KanbanState {
  return {
    schemaVersion: KANBAN_STATE_VERSION,
    columns: text.defaultColumns.map((column) => createColumn(column.id, column.title, timestamp)),
    cards: {},
    view: createDefaultView()
  }
}

function normalizeCard(id: string, value: unknown, timestamp: string, text: KanbanText): KanbanCard | null {
  if (!id || !isRecord(value)) return null

  const cardId = asString(value.id, id).trim() || id

  return {
    id: cardId,
    title: asTitle(value.title, text.defaultCardTitle),
    description: asString(value.description),
    labels: normalizeKanbanLabels(value.labels),
    priority: normalizePriority(value.priority),
    assignee: asString(value.assignee).trim(),
    dueDate: asDate(value.dueDate),
    createdAt: asTimestamp(value.createdAt, timestamp),
    updatedAt: asTimestamp(value.updatedAt, timestamp)
  }
}

function normalizeCards(value: unknown, timestamp: string, text: KanbanText): Record<string, KanbanCard> {
  if (!isRecord(value)) return {}

  const cards: Record<string, KanbanCard> = {}
  for (const [id, rawCard] of Object.entries(value)) {
    const card = normalizeCard(id, rawCard, timestamp, text)
    if (card) cards[card.id] = card
  }

  return cards
}

function normalizeColumns(value: unknown, cards: Record<string, KanbanCard>, timestamp: string, text: KanbanText): KanbanColumn[] {
  const rawColumns = Array.isArray(value) ? value : []
  const cardIds = new Set(Object.keys(cards))
  const assignedCardIds = new Set<string>()
  const columnIds = new Set<string>()
  const columns: KanbanColumn[] = []

  for (const rawColumn of rawColumns) {
    if (!isRecord(rawColumn)) continue

    const id = asString(rawColumn.id).trim()
    if (!id || columnIds.has(id)) continue

    const normalizedCardIds = Array.isArray(rawColumn.cardIds)
      ? rawColumn.cardIds
          .map((cardId) => asString(cardId).trim())
          .filter((cardId) => {
            if (!cardIds.has(cardId) || assignedCardIds.has(cardId)) return false
            assignedCardIds.add(cardId)
            return true
          })
      : []

    columnIds.add(id)
    columns.push({
      id,
      title: asTitle(rawColumn.title, text.defaultColumnTitle),
      cardIds: normalizedCardIds,
      wipLimit: normalizeWipLimit(rawColumn.wipLimit),
      createdAt: asTimestamp(rawColumn.createdAt, timestamp),
      updatedAt: asTimestamp(rawColumn.updatedAt, timestamp)
    })
  }

  const finalColumns = columns.length > 0 ? columns : createDefaultKanbanState(timestamp, text).columns
  const firstColumn = finalColumns[0]
  for (const cardId of cardIds) {
    if (!assignedCardIds.has(cardId)) firstColumn.cardIds.push(cardId)
  }

  return finalColumns
}

export function normalizeKanbanState(value: unknown, timestamp = nowIso(), text: KanbanText = DEFAULT_KANBAN_TEXT): KanbanState {
  if (!isRecord(value)) return createDefaultKanbanState(timestamp, text)

  const cards = normalizeCards(value.cards, timestamp, text)

  return {
    schemaVersion: KANBAN_STATE_VERSION,
    columns: normalizeColumns(value.columns, cards, timestamp, text),
    cards,
    view: normalizeView(value.view)
  }
}

export function kanbanStateEquals(first: KanbanState, second: KanbanState): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

export function findKanbanColumnForCard(state: KanbanState, cardId: string): KanbanColumn | null {
  return state.columns.find((column) => column.cardIds.includes(cardId)) ?? null
}

function cloneCards(cards: Record<string, KanbanCard>): Record<string, KanbanCard> {
  return Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, { ...card, labels: [...card.labels] }]))
}

function cloneState(state: KanbanState): KanbanState {
  return {
    schemaVersion: KANBAN_STATE_VERSION,
    columns: state.columns.map((column) => ({ ...column, cardIds: [...column.cardIds] })),
    cards: cloneCards(state.cards),
    view: {
      search: state.view.search,
      labels: [...state.view.labels],
      assignees: [...state.view.assignees],
      priorities: [...state.view.priorities]
    }
  }
}

function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) return max
  return Math.max(0, Math.min(Math.round(index), max))
}

export function createKanbanColumn(
  state: KanbanState,
  id: string,
  input: KanbanColumnInput = {},
  timestamp = nowIso(),
  text: KanbanText = DEFAULT_KANBAN_TEXT
): KanbanState {
  const next = cloneState(state)
  next.columns.push({
    id,
    title: asTitle(input.title, text.defaultColumnTitle),
    cardIds: [],
    wipLimit: normalizeWipLimit(input.wipLimit),
    createdAt: timestamp,
    updatedAt: timestamp
  })
  return next
}

export function updateKanbanColumn(
  state: KanbanState,
  columnId: string,
  input: KanbanColumnInput,
  timestamp = nowIso(),
  text: KanbanText = DEFAULT_KANBAN_TEXT
): KanbanState {
  const next = cloneState(state)
  const column = next.columns.find((item) => item.id === columnId)
  if (!column) return state

  if (input.title !== undefined) column.title = asTitle(input.title, text.defaultColumnTitle)
  if (input.wipLimit !== undefined) column.wipLimit = normalizeWipLimit(input.wipLimit)
  column.updatedAt = timestamp
  return next
}

export function deleteKanbanColumn(state: KanbanState, columnId: string, text: KanbanText = DEFAULT_KANBAN_TEXT): KanbanState {
  const target = state.columns.find((column) => column.id === columnId)
  if (!target) return state

  const removedCardIds = new Set(target.cardIds)
  const next = cloneState(state)
  next.columns = next.columns.filter((column) => column.id !== columnId)
  for (const cardId of removedCardIds) {
    delete next.cards[cardId]
  }

  if (next.columns.length === 0) {
    return createDefaultKanbanState(nowIso(), text)
  }

  return next
}

export function moveKanbanColumn(state: KanbanState, columnId: string, targetIndex: number, timestamp = nowIso()): KanbanState {
  const sourceIndex = state.columns.findIndex((column) => column.id === columnId)
  if (sourceIndex === -1) return state

  const next = cloneState(state)
  const [column] = next.columns.splice(sourceIndex, 1)
  next.columns.splice(clampIndex(targetIndex, next.columns.length), 0, {
    ...column,
    updatedAt: timestamp
  })
  return next
}

export function createKanbanCard(
  state: KanbanState,
  columnId: string,
  id: string,
  input: KanbanCardInput = {},
  timestamp = nowIso(),
  text: KanbanText = DEFAULT_KANBAN_TEXT
): KanbanState {
  const column = state.columns.find((item) => item.id === columnId)
  if (!column) return state

  const next = cloneState(state)
  next.cards[id] = {
    id,
    title: asTitle(input.title, text.defaultCardTitle),
    description: asString(input.description),
    labels: normalizeKanbanLabels(input.labels),
    priority: normalizePriority(input.priority),
    assignee: asString(input.assignee).trim(),
    dueDate: asDate(input.dueDate),
    createdAt: timestamp,
    updatedAt: timestamp
  }

  next.columns.find((item) => item.id === columnId)?.cardIds.push(id)
  return next
}

export function updateKanbanCard(
  state: KanbanState,
  cardId: string,
  input: KanbanCardInput,
  timestamp = nowIso(),
  text: KanbanText = DEFAULT_KANBAN_TEXT
): KanbanState {
  if (!state.cards[cardId]) return state

  const next = cloneState(state)
  const card = next.cards[cardId]

  if (input.title !== undefined) card.title = asTitle(input.title, text.defaultCardTitle)
  if (input.description !== undefined) card.description = asString(input.description)
  if (input.labels !== undefined) card.labels = normalizeKanbanLabels(input.labels)
  if (input.priority !== undefined) card.priority = normalizePriority(input.priority)
  if (input.assignee !== undefined) card.assignee = asString(input.assignee).trim()
  if (input.dueDate !== undefined) card.dueDate = asDate(input.dueDate)
  card.updatedAt = timestamp

  return next
}

export function deleteKanbanCard(state: KanbanState, cardId: string): KanbanState {
  if (!state.cards[cardId]) return state

  const next = cloneState(state)
  delete next.cards[cardId]
  next.columns = next.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((id) => id !== cardId)
  }))
  return next
}

export function moveKanbanCard(
  state: KanbanState,
  cardId: string,
  targetColumnId: string,
  targetIndex: number,
  timestamp = nowIso()
): KanbanState {
  if (!state.cards[cardId] || !state.columns.some((column) => column.id === targetColumnId)) return state

  const next = cloneState(state)
  next.columns = next.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((id) => id !== cardId)
  }))

  const targetColumn = next.columns.find((column) => column.id === targetColumnId)
  if (!targetColumn) return state

  targetColumn.cardIds.splice(clampIndex(targetIndex, targetColumn.cardIds.length), 0, cardId)
  targetColumn.updatedAt = timestamp
  next.cards[cardId].updatedAt = timestamp
  return next
}

export function updateKanbanView(state: KanbanState, view: Partial<KanbanView>): KanbanState {
  const next = cloneState(state)
  next.view = {
    search: view.search !== undefined ? asString(view.search).trim() : next.view.search,
    labels: view.labels !== undefined ? normalizeKanbanLabels(view.labels) : next.view.labels,
    assignees: view.assignees !== undefined ? normalizeKanbanLabels(view.assignees) : next.view.assignees,
    priorities:
      view.priorities !== undefined
        ? [...new Set(view.priorities.map(normalizePriority).filter((priority) => priority !== 'none'))]
        : next.view.priorities
  }
  return next
}

export function clearKanbanView(state: KanbanState): KanbanState {
  return {
    ...cloneState(state),
    view: createDefaultView()
  }
}

export function isKanbanColumnWipExceeded(column: KanbanColumn): boolean {
  return column.wipLimit !== null && column.cardIds.length > column.wipLimit
}

function normalizedText(value: string): string {
  return value.trim().toLowerCase()
}

function cardMatchesView(card: KanbanCard, view: KanbanView): boolean {
  const search = normalizedText(view.search)
  if (search) {
    const haystack = [card.title, card.description, card.assignee, card.dueDate, card.priority, ...card.labels]
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(search)) return false
  }

  if (view.labels.length > 0 && !card.labels.some((label) => view.labels.includes(label))) return false
  if (view.assignees.length > 0 && !view.assignees.includes(card.assignee)) return false
  if (view.priorities.length > 0 && !view.priorities.includes(card.priority)) return false

  return true
}

export function getFilteredKanbanColumns(state: KanbanState): KanbanColumn[] {
  return state.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((cardId) => {
      const card = state.cards[cardId]
      return card ? cardMatchesView(card, state.view) : false
    })
  }))
}

export function getKanbanFilterOptions(state: KanbanState): Pick<KanbanView, 'labels' | 'assignees'> {
  const labels = new Set<string>()
  const assignees = new Set<string>()

  for (const card of Object.values(state.cards)) {
    for (const label of card.labels) labels.add(label)
    if (card.assignee) assignees.add(card.assignee)
  }

  return {
    labels: [...labels].sort((first, second) => first.localeCompare(second)),
    assignees: [...assignees].sort((first, second) => first.localeCompare(second))
  }
}

export function getKanbanStats(state: KanbanState): { columnCount: number; cardCount: number } {
  return {
    columnCount: state.columns.length,
    cardCount: Object.keys(state.cards).length
  }
}

export function getKanbanSearchTokens(state: KanbanState): string[] {
  return [
    ...state.columns.map((column) => column.title),
    ...Object.values(state.cards).flatMap((card) => [card.title, card.description, card.assignee, card.dueDate, card.priority, ...card.labels])
  ].filter(Boolean)
}
