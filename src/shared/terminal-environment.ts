import { z } from 'zod'

export type TerminalEnvironment = Record<string, string>

export type TerminalEnvironmentParseIssueCode = 'duplicateName' | 'invalidName' | 'missingEquals' | 'tooManyVariables' | 'valueTooLong'

export type TerminalEnvironmentParseIssue = {
  code: TerminalEnvironmentParseIssueCode
  line: number
  name?: string
}

export const DEFAULT_TERMINAL_ENVIRONMENT: TerminalEnvironment = {}

export const MAX_TERMINAL_ENVIRONMENT_VARIABLES = 200
export const MAX_TERMINAL_ENVIRONMENT_NAME_LENGTH = 120
export const MAX_TERMINAL_ENVIRONMENT_VALUE_LENGTH = 20_000
export const TERMINAL_ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function terminalEnvironmentKey(name: string): string {
  return name.toUpperCase()
}

function sanitizeEnvironmentValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\0/g, '').slice(0, MAX_TERMINAL_ENVIRONMENT_VALUE_LENGTH)
}

export function isValidTerminalEnvironmentName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_TERMINAL_ENVIRONMENT_NAME_LENGTH && TERMINAL_ENVIRONMENT_NAME_PATTERN.test(name)
}

export function normalizeTerminalEnvironment(value: unknown): TerminalEnvironment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const environment: TerminalEnvironment = {}
  const assignedNames = new Map<string, string>()

  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim()
    if (!isValidTerminalEnvironmentName(name) || typeof rawValue !== 'string') continue

    const key = terminalEnvironmentKey(name)
    const previousName = assignedNames.get(key)
    if (previousName) delete environment[previousName]

    assignedNames.set(key, name)
    environment[name] = sanitizeEnvironmentValue(rawValue)
    if (Object.keys(environment).length >= MAX_TERMINAL_ENVIRONMENT_VARIABLES) break
  }

  return environment
}

export function mergeTerminalEnvironments(...environments: Array<TerminalEnvironment | undefined>): TerminalEnvironment {
  const merged: TerminalEnvironment = {}
  const assignedNames = new Map<string, string>()

  for (const environment of environments) {
    for (const [name, value] of Object.entries(environment ?? {})) {
      const key = terminalEnvironmentKey(name)
      const previousName = assignedNames.get(key)
      if (previousName) delete merged[previousName]

      assignedNames.set(key, name)
      merged[name] = value
    }
  }

  return merged
}

export function terminalEnvironmentEntries(environment: TerminalEnvironment): Array<[string, string]> {
  return Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))
}

export function normalizeTerminalEnvironmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const names: string[] = []
  const assignedNames = new Set<string>()

  for (const rawName of value) {
    if (typeof rawName !== 'string') continue

    const name = rawName.trim()
    if (!isValidTerminalEnvironmentName(name)) continue

    const key = terminalEnvironmentKey(name)
    if (assignedNames.has(key)) continue

    assignedNames.add(key)
    names.push(name)
    if (names.length >= MAX_TERMINAL_ENVIRONMENT_VARIABLES) break
  }

  return names
}

export function pickTerminalEnvironment(environment: TerminalEnvironment, names: readonly string[]): TerminalEnvironment {
  const selectedKeys = new Set(names.map(terminalEnvironmentKey))
  const selected: TerminalEnvironment = {}

  for (const [name, value] of Object.entries(environment)) {
    if (selectedKeys.has(terminalEnvironmentKey(name))) selected[name] = value
  }

  return selected
}

export function formatTerminalEnvironmentText(environment: TerminalEnvironment): string {
  return terminalEnvironmentEntries(environment)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')
}

export function parseTerminalEnvironmentText(text: string): { environment: TerminalEnvironment; issues: TerminalEnvironmentParseIssue[] } {
  const environment: TerminalEnvironment = {}
  const assignedNames = new Set<string>()
  const issues: TerminalEnvironmentParseIssue[] = []

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    if (Object.keys(environment).length >= MAX_TERMINAL_ENVIRONMENT_VARIABLES) {
      issues.push({ code: 'tooManyVariables', line: lineNumber })
      continue
    }

    const separatorIndex = rawLine.indexOf('=')
    if (separatorIndex === -1) {
      issues.push({ code: 'missingEquals', line: lineNumber })
      continue
    }

    const name = rawLine.slice(0, separatorIndex).trim()
    if (!isValidTerminalEnvironmentName(name)) {
      issues.push({ code: 'invalidName', line: lineNumber, name })
      continue
    }

    const key = terminalEnvironmentKey(name)
    if (assignedNames.has(key)) {
      issues.push({ code: 'duplicateName', line: lineNumber, name })
      continue
    }

    const value = rawLine.slice(separatorIndex + 1).replace(/\0/g, '')
    if (value.length > MAX_TERMINAL_ENVIRONMENT_VALUE_LENGTH) {
      issues.push({ code: 'valueTooLong', line: lineNumber, name })
      continue
    }

    assignedNames.add(key)
    environment[name] = value
  }

  return { environment, issues }
}

export const terminalEnvironmentSchema = z.unknown().optional().transform((value) => normalizeTerminalEnvironment(value))
