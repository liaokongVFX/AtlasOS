export const QUICK_LAUNCHER_STATE_VERSION = 1

export const QUICK_LAUNCHER_ITEM_KINDS = ['app', 'file', 'folder', 'url', 'command'] as const

export type QuickLauncherPathKind = 'app' | 'file' | 'folder'
export type QuickLauncherCommandShell = 'cmd' | 'powershell'
export type QuickLauncherItemKind = (typeof QUICK_LAUNCHER_ITEM_KINDS)[number]

export type QuickLauncherPathItem = {
  id: string
  kind: QuickLauncherPathKind
  name: string
  targetPath: string
  createdAt: string
  updatedAt: string
}

export type QuickLauncherUrlItem = {
  id: string
  kind: 'url'
  name: string
  url: string
  createdAt: string
  updatedAt: string
}

export type QuickLauncherCommandItem = {
  id: string
  kind: 'command'
  name: string
  shell: QuickLauncherCommandShell
  command: string
  cwd?: string
  createdAt: string
  updatedAt: string
}

export type QuickLauncherItem = QuickLauncherPathItem | QuickLauncherUrlItem | QuickLauncherCommandItem

export type QuickLauncherTab = {
  id: string
  name: string
  itemIds: string[]
  createdAt: string
  updatedAt: string
}

export type QuickLauncherState = {
  schemaVersion: typeof QUICK_LAUNCHER_STATE_VERSION
  tabs: QuickLauncherTab[]
  items: Record<string, QuickLauncherItem>
  activeTabId: string
}

export type QuickLauncherText = {
  defaultTabName: string
  defaultItemName: string
}

export type QuickLauncherItemInput =
  | {
      kind: QuickLauncherPathKind
      name?: string
      targetPath?: string
    }
  | {
      kind: 'url'
      name?: string
      url?: string
    }
  | {
      kind: 'command'
      name?: string
      shell?: QuickLauncherCommandShell
      command?: string
      cwd?: string
    }

export type QuickLauncherSearchResult = {
  item: QuickLauncherItem
  tab: QuickLauncherTab
}

export const DEFAULT_QUICK_LAUNCHER_TEXT: QuickLauncherText = {
  defaultTabName: 'Favorites',
  defaultItemName: 'Shortcut'
}

const MAX_ITEM_NAME_LENGTH = 80
const MAX_TAB_NAME_LENGTH = 48

function nowIso(): string {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asTrimmedString(value: unknown, fallback = ''): string {
  return asString(value, fallback).trim()
}

function asTimestamp(value: unknown, fallback: string): string {
  return asTrimmedString(value) || fallback
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function safeName(value: unknown, fallback: string, maxLength = MAX_ITEM_NAME_LENGTH): string {
  return truncateText(asTrimmedString(value) || fallback, maxLength)
}

function itemKind(value: unknown): QuickLauncherItemKind | null {
  return QUICK_LAUNCHER_ITEM_KINDS.includes(value as QuickLauncherItemKind) ? (value as QuickLauncherItemKind) : null
}

function commandShell(value: unknown): QuickLauncherCommandShell {
  return value === 'cmd' || value === 'powershell' ? value : 'powershell'
}

function itemNameFallback(input: QuickLauncherItemInput, text: QuickLauncherText): string {
  if (input.kind === 'url') return basenameLike(input.url ?? '') || input.url || text.defaultItemName
  if (input.kind === 'command') return input.command?.split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || text.defaultItemName
  return basenameLike(input.targetPath ?? '') || text.defaultItemName
}

function basenameLike(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/, '')
  if (!trimmed) return ''

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed)
      return parsed.hostname || trimmed
    }
  } catch {
    return trimmed
  }

  return trimmed.split(/[\\/]/).at(-1) ?? trimmed
}

function normalizeItem(id: string, value: unknown, timestamp: string, text: QuickLauncherText): QuickLauncherItem | null {
  if (!id || !isRecord(value)) return null

  const kind = itemKind(value.kind)
  if (!kind) return null

  const createdAt = asTimestamp(value.createdAt, timestamp)
  const updatedAt = asTimestamp(value.updatedAt, createdAt)

  if (kind === 'url') {
    const url = asTrimmedString(value.url)
    if (!url) return null

    return {
      id,
      kind,
      name: safeName(value.name, basenameLike(url) || text.defaultItemName),
      url,
      createdAt,
      updatedAt
    }
  }

  if (kind === 'command') {
    const command = asTrimmedString(value.command)
    if (!command) return null

    const cwd = asTrimmedString(value.cwd)
    return {
      id,
      kind,
      name: safeName(value.name, command.split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || text.defaultItemName),
      shell: commandShell(value.shell),
      command,
      cwd: cwd || undefined,
      createdAt,
      updatedAt
    }
  }

  const targetPath = asTrimmedString(value.targetPath)
  if (!targetPath) return null

  return {
    id,
    kind,
    name: safeName(value.name, basenameLike(targetPath) || text.defaultItemName),
    targetPath,
    createdAt,
    updatedAt
  }
}

function normalizeItems(value: unknown, timestamp: string, text: QuickLauncherText): Record<string, QuickLauncherItem> {
  if (!isRecord(value)) return {}

  const items: Record<string, QuickLauncherItem> = {}
  for (const [id, rawItem] of Object.entries(value)) {
    const normalized = normalizeItem(id, rawItem, timestamp, text)
    if (normalized) items[normalized.id] = normalized
  }

  return items
}

function createDefaultTab(id: string, name: string, timestamp: string, itemIds: string[] = []): QuickLauncherTab {
  return {
    id,
    name,
    itemIds,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function normalizeTabs(value: unknown, items: Record<string, QuickLauncherItem>, timestamp: string, text: QuickLauncherText): QuickLauncherTab[] {
  const rawTabs = Array.isArray(value) ? value : []
  const knownItemIds = new Set(Object.keys(items))
  const assignedItemIds = new Set<string>()
  const tabIds = new Set<string>()
  const tabs: QuickLauncherTab[] = []

  for (const rawTab of rawTabs) {
    if (!isRecord(rawTab)) continue

    const id = asTrimmedString(rawTab.id)
    if (!id || tabIds.has(id)) continue

    const itemIds = Array.isArray(rawTab.itemIds)
      ? rawTab.itemIds
          .map((itemId) => asTrimmedString(itemId))
          .filter((itemId) => {
            if (!knownItemIds.has(itemId) || assignedItemIds.has(itemId)) return false
            assignedItemIds.add(itemId)
            return true
          })
      : []

    tabIds.add(id)
    tabs.push({
      id,
      name: safeName(rawTab.name, `${text.defaultTabName} ${tabs.length + 1}`, MAX_TAB_NAME_LENGTH),
      itemIds,
      createdAt: asTimestamp(rawTab.createdAt, timestamp),
      updatedAt: asTimestamp(rawTab.updatedAt, timestamp)
    })
  }

  const finalTabs = tabs.length > 0 ? tabs : [createDefaultTab('default', text.defaultTabName, timestamp)]
  const firstTab = finalTabs[0]
  for (const itemId of knownItemIds) {
    if (!assignedItemIds.has(itemId)) firstTab.itemIds.push(itemId)
  }

  return finalTabs
}

function cloneState(state: QuickLauncherState): QuickLauncherState {
  return {
    schemaVersion: QUICK_LAUNCHER_STATE_VERSION,
    tabs: state.tabs.map((tab) => ({ ...tab, itemIds: [...tab.itemIds] })),
    items: Object.fromEntries(Object.entries(state.items).map(([id, item]) => [id, { ...item }])) as Record<string, QuickLauncherItem>,
    activeTabId: state.activeTabId
  }
}

function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) return max
  return Math.max(0, Math.min(Math.round(index), max))
}

function moveValue<T>(values: T[], sourceIndex: number, targetIndex: number): T[] {
  if (sourceIndex < 0 || sourceIndex >= values.length) return values

  const nextValues = [...values]
  const [value] = nextValues.splice(sourceIndex, 1)
  nextValues.splice(clampIndex(targetIndex, nextValues.length), 0, value)
  return nextValues
}

export function createDefaultQuickLauncherState(timestamp = nowIso(), text: QuickLauncherText = DEFAULT_QUICK_LAUNCHER_TEXT): QuickLauncherState {
  const defaultTab = createDefaultTab('default', text.defaultTabName, timestamp)

  return {
    schemaVersion: QUICK_LAUNCHER_STATE_VERSION,
    tabs: [defaultTab],
    items: {},
    activeTabId: defaultTab.id
  }
}

export function normalizeQuickLauncherState(
  value: unknown,
  timestamp = nowIso(),
  text: QuickLauncherText = DEFAULT_QUICK_LAUNCHER_TEXT
): QuickLauncherState {
  if (!isRecord(value)) return createDefaultQuickLauncherState(timestamp, text)

  const items = normalizeItems(value.items, timestamp, text)
  const tabs = normalizeTabs(value.tabs, items, timestamp, text)
  const activeTabId = tabs.some((tab) => tab.id === value.activeTabId) ? asString(value.activeTabId) : tabs[0].id

  return {
    schemaVersion: QUICK_LAUNCHER_STATE_VERSION,
    tabs,
    items,
    activeTabId
  }
}

export function quickLauncherStateEquals(first: QuickLauncherState, second: QuickLauncherState): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

export function createQuickLauncherTab(
  state: QuickLauncherState,
  id: string,
  name: string,
  timestamp = nowIso(),
  text: QuickLauncherText = DEFAULT_QUICK_LAUNCHER_TEXT
): QuickLauncherState {
  const next = cloneState(state)
  const tabName = safeName(name, `${text.defaultTabName} ${next.tabs.length + 1}`, MAX_TAB_NAME_LENGTH)
  next.tabs.push(createDefaultTab(id, tabName, timestamp))
  next.activeTabId = id
  return next
}

export function renameQuickLauncherTab(
  state: QuickLauncherState,
  tabId: string,
  name: string,
  timestamp = nowIso(),
  text: QuickLauncherText = DEFAULT_QUICK_LAUNCHER_TEXT
): QuickLauncherState {
  const next = cloneState(state)
  const tab = next.tabs.find((item) => item.id === tabId)
  if (!tab) return state

  tab.name = safeName(name, text.defaultTabName, MAX_TAB_NAME_LENGTH)
  tab.updatedAt = timestamp
  return next
}

export function deleteQuickLauncherTab(state: QuickLauncherState, tabId: string): QuickLauncherState {
  const tab = state.tabs.find((item) => item.id === tabId)
  if (!tab || state.tabs.length <= 1) return state

  const removedItemIds = new Set(tab.itemIds)
  const next = cloneState(state)
  next.tabs = next.tabs.filter((item) => item.id !== tabId)
  for (const itemId of removedItemIds) delete next.items[itemId]
  if (next.activeTabId === tabId) next.activeTabId = next.tabs[0].id
  return next
}

export function moveQuickLauncherTab(state: QuickLauncherState, tabId: string, targetIndex: number): QuickLauncherState {
  const sourceIndex = state.tabs.findIndex((tab) => tab.id === tabId)
  if (sourceIndex === -1) return state

  const next = cloneState(state)
  next.tabs = moveValue(next.tabs, sourceIndex, targetIndex)
  return next
}

export function setQuickLauncherActiveTab(state: QuickLauncherState, tabId: string): QuickLauncherState {
  if (!state.tabs.some((tab) => tab.id === tabId)) return state

  return {
    ...cloneState(state),
    activeTabId: tabId
  }
}

export function createQuickLauncherItem(
  state: QuickLauncherState,
  tabId: string,
  id: string,
  input: QuickLauncherItemInput,
  timestamp = nowIso(),
  text: QuickLauncherText = DEFAULT_QUICK_LAUNCHER_TEXT
): QuickLauncherState {
  const targetTab = state.tabs.find((tab) => tab.id === tabId)
  if (!targetTab) return state

  const item = createItem(id, input, timestamp, text)
  const next = cloneState(state)
  next.items[item.id] = item
  next.tabs = next.tabs.map((tab) =>
    tab.id === tabId
      ? {
          ...tab,
          itemIds: [...tab.itemIds, item.id],
          updatedAt: timestamp
        }
      : tab
  )
  return next
}

export function updateQuickLauncherItem(
  state: QuickLauncherState,
  itemId: string,
  input: QuickLauncherItemInput,
  timestamp = nowIso(),
  text: QuickLauncherText = DEFAULT_QUICK_LAUNCHER_TEXT
): QuickLauncherState {
  const current = state.items[itemId]
  if (!current) return state

  const next = cloneState(state)
  next.items[itemId] = {
    ...createItem(itemId, input, timestamp, text),
    createdAt: current.createdAt,
    updatedAt: timestamp
  }
  return next
}

export function deleteQuickLauncherItem(state: QuickLauncherState, itemId: string): QuickLauncherState {
  if (!state.items[itemId]) return state

  const next = cloneState(state)
  delete next.items[itemId]
  next.tabs = next.tabs.map((tab) => ({ ...tab, itemIds: tab.itemIds.filter((id) => id !== itemId) }))
  return next
}

export function moveQuickLauncherItem(state: QuickLauncherState, tabId: string, itemId: string, targetIndex: number): QuickLauncherState {
  const tab = state.tabs.find((item) => item.id === tabId)
  if (!tab || !tab.itemIds.includes(itemId)) return state

  const next = cloneState(state)
  next.tabs = next.tabs.map((item) =>
    item.id === tabId
      ? {
          ...item,
          itemIds: moveValue(item.itemIds, item.itemIds.indexOf(itemId), targetIndex)
        }
      : item
  )
  return next
}

export function quickLauncherItemSummary(item: QuickLauncherItem): string {
  if (item.kind === 'url') return item.url
  if (item.kind === 'command') return item.cwd ? `${item.shell}: ${item.command} @ ${item.cwd}` : `${item.shell}: ${item.command}`
  return item.targetPath
}

export function searchQuickLauncherItems(state: QuickLauncherState, query: string): QuickLauncherSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  return state.tabs.flatMap((tab) =>
    tab.itemIds
      .map((itemId) => state.items[itemId])
      .filter((item): item is QuickLauncherItem => Boolean(item))
      .filter((item) => {
        const haystack = [tab.name, item.kind, item.name, quickLauncherItemSummary(item)]
          .join(' ')
          .toLowerCase()
        return haystack.includes(normalizedQuery)
      })
      .map((item) => ({ item, tab }))
  )
}

export function getQuickLauncherSearchTokens(state: QuickLauncherState): string[] {
  return [
    ...state.tabs.map((tab) => tab.name),
    ...Object.values(state.items).flatMap((item) => [item.name, item.kind, quickLauncherItemSummary(item)])
  ].filter(Boolean)
}

export function getQuickLauncherStats(state: QuickLauncherState): { tabCount: number; itemCount: number } {
  return {
    tabCount: state.tabs.length,
    itemCount: Object.keys(state.items).length
  }
}

function createItem(id: string, input: QuickLauncherItemInput, timestamp: string, text: QuickLauncherText): QuickLauncherItem {
  const name = safeName(input.name, itemNameFallback(input, text))

  if (input.kind === 'url') {
    return {
      id,
      kind: input.kind,
      name,
      url: asTrimmedString(input.url),
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }

  if (input.kind === 'command') {
    const cwd = asTrimmedString(input.cwd)
    return {
      id,
      kind: input.kind,
      name,
      shell: input.shell ?? 'powershell',
      command: asTrimmedString(input.command),
      cwd: cwd || undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }

  return {
    id,
    kind: input.kind,
    name,
    targetPath: asTrimmedString(input.targetPath),
    createdAt: timestamp,
    updatedAt: timestamp
  }
}
