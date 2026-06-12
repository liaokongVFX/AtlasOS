import { z } from 'zod'

export const TERMINAL_COMMAND_LIBRARY_SCHEMA_VERSION = 1

export type TerminalCommandEntry = {
  id: string
  name: string
  command: string
  createdAt: string
  updatedAt: string
}

export type TerminalCommandCategory = {
  id: string
  name: string
  commandIds: string[]
  createdAt: string
  updatedAt: string
}

export type TerminalCommandLibrary = {
  schemaVersion: typeof TERMINAL_COMMAND_LIBRARY_SCHEMA_VERSION
  categories: TerminalCommandCategory[]
  commands: Record<string, TerminalCommandEntry>
  activeCategoryId: string
}

export type TerminalCommandInput = {
  name?: string
  command?: string
  categoryId?: string
}

export type TerminalCommandCategoryInput = {
  name?: string
}

export const DEFAULT_TERMINAL_COMMAND_LIBRARY: TerminalCommandLibrary = {
  schemaVersion: TERMINAL_COMMAND_LIBRARY_SCHEMA_VERSION,
  categories: [],
  commands: {},
  activeCategoryId: ''
}

const MAX_CATEGORY_NAME_LENGTH = 48
const MAX_COMMAND_NAME_LENGTH = 80
const MAX_COMMAND_LENGTH = 8192

function nowIso(): string {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function safeName(value: unknown, fallback: string, maxLength: number): string {
  return truncateText(asTrimmedString(value) || fallback, maxLength)
}

function commandNameFallback(command: string): string {
  return command.split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || 'Command'
}

function cloneLibrary(library: TerminalCommandLibrary): TerminalCommandLibrary {
  return {
    schemaVersion: TERMINAL_COMMAND_LIBRARY_SCHEMA_VERSION,
    categories: library.categories.map((category) => ({ ...category, commandIds: [...category.commandIds] })),
    commands: Object.fromEntries(Object.entries(library.commands).map(([id, command]) => [id, { ...command }])),
    activeCategoryId: library.activeCategoryId
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

function normalizeCommand(id: string, value: unknown, timestamp: string): TerminalCommandEntry | null {
  if (!id || !isRecord(value)) return null

  const command = truncateText(asTrimmedString(value.command), MAX_COMMAND_LENGTH)
  if (!command) return null

  const createdAt = asTimestamp(value.createdAt, timestamp)
  const updatedAt = asTimestamp(value.updatedAt, createdAt)

  return {
    id,
    name: safeName(value.name, commandNameFallback(command), MAX_COMMAND_NAME_LENGTH),
    command,
    createdAt,
    updatedAt
  }
}

function normalizeCommands(value: unknown, timestamp: string): Record<string, TerminalCommandEntry> {
  if (!isRecord(value)) return {}

  const commands: Record<string, TerminalCommandEntry> = {}
  for (const [id, rawCommand] of Object.entries(value)) {
    const normalized = normalizeCommand(id, rawCommand, timestamp)
    if (normalized) commands[normalized.id] = normalized
  }

  return commands
}

function normalizeCategories(value: unknown, commands: Record<string, TerminalCommandEntry>, timestamp: string): TerminalCommandCategory[] {
  const rawCategories = Array.isArray(value) ? value : []
  const knownCommandIds = new Set(Object.keys(commands))
  const assignedCommandIds = new Set<string>()
  const categoryIds = new Set<string>()
  const categories: TerminalCommandCategory[] = []

  for (const rawCategory of rawCategories) {
    if (!isRecord(rawCategory)) continue

    const id = asTrimmedString(rawCategory.id)
    if (!id || categoryIds.has(id)) continue

    const commandIds = Array.isArray(rawCategory.commandIds)
      ? rawCategory.commandIds
          .map((commandId) => asTrimmedString(commandId))
          .filter((commandId) => {
            if (!knownCommandIds.has(commandId) || assignedCommandIds.has(commandId)) return false
            assignedCommandIds.add(commandId)
            return true
          })
      : []

    categoryIds.add(id)
    categories.push({
      id,
      name: safeName(rawCategory.name, `Category ${categories.length + 1}`, MAX_CATEGORY_NAME_LENGTH),
      commandIds,
      createdAt: asTimestamp(rawCategory.createdAt, timestamp),
      updatedAt: asTimestamp(rawCategory.updatedAt, timestamp)
    })
  }

  return categories
}

function assignedCommands(categories: TerminalCommandCategory[], commands: Record<string, TerminalCommandEntry>): Record<string, TerminalCommandEntry> {
  const assignedIds = new Set(categories.flatMap((category) => category.commandIds))
  return Object.fromEntries(Object.entries(commands).filter(([id]) => assignedIds.has(id)))
}

function activeCategoryId(value: unknown, categories: TerminalCommandCategory[]): string {
  const id = asTrimmedString(value)
  if (id && categories.some((category) => category.id === id)) return id
  return categories[0]?.id ?? ''
}

export function createDefaultTerminalCommandLibrary(): TerminalCommandLibrary {
  return {
    ...DEFAULT_TERMINAL_COMMAND_LIBRARY,
    categories: [],
    commands: {}
  }
}

export function normalizeTerminalCommandLibrary(value: unknown, timestamp = nowIso()): TerminalCommandLibrary {
  if (!isRecord(value)) return createDefaultTerminalCommandLibrary()

  const commands = normalizeCommands(value.commands, timestamp)
  const categories = normalizeCategories(value.categories, commands, timestamp)
  const assigned = assignedCommands(categories, commands)

  return {
    schemaVersion: TERMINAL_COMMAND_LIBRARY_SCHEMA_VERSION,
    categories,
    commands: assigned,
    activeCategoryId: activeCategoryId(value.activeCategoryId, categories)
  }
}

export const terminalCommandLibrarySchema = z.unknown().optional().transform((value) => normalizeTerminalCommandLibrary(value))

export function createTerminalCommandCategory(
  library: TerminalCommandLibrary,
  id: string,
  input: TerminalCommandCategoryInput,
  timestamp = nowIso()
): TerminalCommandLibrary {
  const next = cloneLibrary(library)
  next.categories.push({
    id,
    name: safeName(input.name, `Category ${next.categories.length + 1}`, MAX_CATEGORY_NAME_LENGTH),
    commandIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  })
  next.activeCategoryId = id
  return next
}

export function renameTerminalCommandCategory(
  library: TerminalCommandLibrary,
  categoryId: string,
  input: TerminalCommandCategoryInput,
  timestamp = nowIso()
): TerminalCommandLibrary {
  const category = library.categories.find((item) => item.id === categoryId)
  if (!category) return library

  const next = cloneLibrary(library)
  const nextCategory = next.categories.find((item) => item.id === categoryId)
  if (!nextCategory) return library

  nextCategory.name = safeName(input.name, category.name, MAX_CATEGORY_NAME_LENGTH)
  nextCategory.updatedAt = timestamp
  return next
}

export function deleteTerminalCommandCategory(library: TerminalCommandLibrary, categoryId: string): TerminalCommandLibrary {
  const category = library.categories.find((item) => item.id === categoryId)
  if (!category) return library

  const next = cloneLibrary(library)
  const removedCommandIds = new Set(category.commandIds)
  next.categories = next.categories.filter((item) => item.id !== categoryId)
  for (const commandId of removedCommandIds) delete next.commands[commandId]
  if (next.activeCategoryId === categoryId) next.activeCategoryId = next.categories[0]?.id ?? ''
  return next
}

export function moveTerminalCommandCategory(library: TerminalCommandLibrary, categoryId: string, targetIndex: number): TerminalCommandLibrary {
  const sourceIndex = library.categories.findIndex((category) => category.id === categoryId)
  if (sourceIndex === -1) return library

  const next = cloneLibrary(library)
  return {
    ...next,
    categories: moveValue(next.categories, sourceIndex, targetIndex)
  }
}

export function setTerminalCommandActiveCategory(library: TerminalCommandLibrary, categoryId: string): TerminalCommandLibrary {
  if (!library.categories.some((category) => category.id === categoryId)) return library

  return {
    ...cloneLibrary(library),
    activeCategoryId: categoryId
  }
}

export function createTerminalCommand(
  library: TerminalCommandLibrary,
  categoryId: string,
  id: string,
  input: TerminalCommandInput,
  timestamp = nowIso()
): TerminalCommandLibrary {
  const category = library.categories.find((item) => item.id === categoryId)
  if (!category) return library

  const command = truncateText(asTrimmedString(input.command), MAX_COMMAND_LENGTH)
  if (!command) return library

  const next = cloneLibrary(library)
  next.commands[id] = {
    id,
    name: safeName(input.name, commandNameFallback(command), MAX_COMMAND_NAME_LENGTH),
    command,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  next.categories = next.categories.map((item) =>
    item.id === categoryId
      ? {
          ...item,
          commandIds: [...item.commandIds, id],
          updatedAt: timestamp
        }
      : item
  )
  next.activeCategoryId = categoryId
  return next
}

export function updateTerminalCommand(
  library: TerminalCommandLibrary,
  commandId: string,
  input: TerminalCommandInput,
  timestamp = nowIso()
): TerminalCommandLibrary {
  const current = library.commands[commandId]
  if (!current) return library

  const command = truncateText(asTrimmedString(input.command, current.command), MAX_COMMAND_LENGTH)
  if (!command) return library

  const currentCategory = library.categories.find((category) => category.commandIds.includes(commandId))
  const nextCategory = input.categoryId ? library.categories.find((category) => category.id === input.categoryId) : currentCategory
  if (!currentCategory || !nextCategory) return library

  const next = cloneLibrary(library)
  next.commands[commandId] = {
    ...current,
    name: safeName(input.name, commandNameFallback(command), MAX_COMMAND_NAME_LENGTH),
    command,
    updatedAt: timestamp
  }

  if (currentCategory.id !== nextCategory.id) {
    next.categories = next.categories.map((category) => {
      if (category.id === currentCategory.id) {
        return {
          ...category,
          commandIds: category.commandIds.filter((id) => id !== commandId),
          updatedAt: timestamp
        }
      }
      if (category.id === nextCategory.id) {
        return {
          ...category,
          commandIds: [...category.commandIds, commandId],
          updatedAt: timestamp
        }
      }
      return category
    })
    next.activeCategoryId = nextCategory.id
  }

  return next
}

export function deleteTerminalCommand(library: TerminalCommandLibrary, commandId: string): TerminalCommandLibrary {
  if (!library.commands[commandId]) return library

  const next = cloneLibrary(library)
  delete next.commands[commandId]
  next.categories = next.categories.map((category) => ({ ...category, commandIds: category.commandIds.filter((id) => id !== commandId) }))
  return next
}

export function moveTerminalCommand(
  library: TerminalCommandLibrary,
  categoryId: string,
  commandId: string,
  targetIndex: number
): TerminalCommandLibrary {
  const category = library.categories.find((item) => item.id === categoryId)
  if (!category || !category.commandIds.includes(commandId)) return library

  const next = cloneLibrary(library)
  next.categories = next.categories.map((item) =>
    item.id === categoryId
      ? {
          ...item,
          commandIds: moveValue(item.commandIds, item.commandIds.indexOf(commandId), targetIndex)
        }
      : item
  )
  return next
}

export function getTerminalCommandLibraryStats(library: TerminalCommandLibrary): { categoryCount: number; commandCount: number } {
  return {
    categoryCount: library.categories.length,
    commandCount: Object.keys(library.commands).length
  }
}
