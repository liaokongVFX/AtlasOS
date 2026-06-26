import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  MAX_TERMINAL_ENVIRONMENT_VARIABLES,
  MAX_TERMINAL_ENVIRONMENT_VALUE_LENGTH,
  isValidTerminalEnvironmentName,
  normalizeTerminalEnvironmentNames,
  terminalEnvironmentEntries,
  terminalEnvironmentKey,
  type TerminalEnvironment
} from '@shared/terminal-environment'
import { useI18n } from '../i18n'

type TerminalEnvironmentRow = {
  id: string
  name: string
  value: string
}

type TerminalEnvironmentEditorResult = {
  environment: TerminalEnvironment
  selectedGlobalNames?: string[]
}

type TerminalEnvironmentEditorProps = {
  className?: string
  description?: string
  disabled?: boolean
  globalEnvironment?: TerminalEnvironment
  initialEnvironment?: TerminalEnvironment
  initialSelectedGlobalNames?: string[]
  onSave: (result: TerminalEnvironmentEditorResult) => Promise<void> | void
  saveLabel?: string
  showGlobalSelection?: boolean
}

type ValidationIssue = {
  id: string
  message: string
}

const EMPTY_TERMINAL_ENVIRONMENT: TerminalEnvironment = {}

function createRowId(): string {
  return Math.random().toString(36).slice(2)
}

function environmentRows(environment: TerminalEnvironment): TerminalEnvironmentRow[] {
  return terminalEnvironmentEntries(environment).map(([name, value]) => ({ id: createRowId(), name, value }))
}

function partitionEnvironmentRows(environment: TerminalEnvironment, selectedNames: readonly string[]): {
  globalOverrideRows: TerminalEnvironmentRow[]
  rows: TerminalEnvironmentRow[]
} {
  const selectedKeys = new Set(selectedNames.map(terminalEnvironmentKey))
  const globalOverrideRows: TerminalEnvironmentRow[] = []
  const rows: TerminalEnvironmentRow[] = []

  for (const row of environmentRows(environment)) {
    if (selectedKeys.has(terminalEnvironmentKey(row.name))) {
      globalOverrideRows.push(row)
    } else {
      rows.push(row)
    }
  }

  return { globalOverrideRows, rows }
}

function rowsToEnvironment(rows: TerminalEnvironmentRow[]): TerminalEnvironment {
  const environment: TerminalEnvironment = {}

  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    environment[name] = row.value.replace(/\0/g, '').slice(0, MAX_TERMINAL_ENVIRONMENT_VALUE_LENGTH)
  }

  return environment
}

function sameEnvironment(left: TerminalEnvironment, right: TerminalEnvironment): boolean {
  const leftEntries = terminalEnvironmentEntries(left)
  const rightEntries = terminalEnvironmentEntries(right)
  if (leftEntries.length !== rightEntries.length) return false

  return leftEntries.every(([name, value], index) => {
    const [rightName, rightValue] = rightEntries[index]
    return terminalEnvironmentKey(name) === terminalEnvironmentKey(rightName) && value === rightValue
  })
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false

  const rightKeys = new Set(right.map(terminalEnvironmentKey))
  return left.every((name) => rightKeys.has(terminalEnvironmentKey(name)))
}

function environmentValue(environment: TerminalEnvironment, name: string): string | undefined {
  const key = terminalEnvironmentKey(name)
  const entry = Object.entries(environment).find(([entryName]) => terminalEnvironmentKey(entryName) === key)
  return entry?.[1]
}

function selectedGlobalNames(globalEnvironment: TerminalEnvironment, value: string[] | undefined): string[] {
  const normalized = normalizeTerminalEnvironmentNames(value)
  const availableKeys = new Set(Object.keys(globalEnvironment).map(terminalEnvironmentKey))
  return normalized.filter((name) => availableKeys.has(terminalEnvironmentKey(name)))
}

function createBlankRow(rows: TerminalEnvironmentRow[]): TerminalEnvironmentRow {
  const existingKeys = new Set(rows.map((row) => terminalEnvironmentKey(row.name.trim())).filter(Boolean))
  let name = 'CUSTOM_VAR'
  let index = 2
  while (existingKeys.has(terminalEnvironmentKey(name))) {
    name = `CUSTOM_VAR_${index}`
    index += 1
  }
  return { id: createRowId(), name, value: '' }
}

function upsertEnvironmentRow(rows: TerminalEnvironmentRow[], name: string, value: string): TerminalEnvironmentRow[] {
  const key = terminalEnvironmentKey(name)
  const existing = rows.find((row) => terminalEnvironmentKey(row.name.trim()) === key)

  if (existing) {
    return rows.map((row) => (row.id === existing.id ? { ...row, value } : row))
  }

  return [...rows, { id: createRowId(), name, value }]
}

function removeEnvironmentRow(rows: TerminalEnvironmentRow[], name: string): TerminalEnvironmentRow[] {
  const key = terminalEnvironmentKey(name)
  return rows.filter((row) => terminalEnvironmentKey(row.name.trim()) !== key)
}

export function TerminalEnvironmentEditor({
  className,
  description,
  disabled = false,
  globalEnvironment = EMPTY_TERMINAL_ENVIRONMENT,
  initialEnvironment,
  initialSelectedGlobalNames,
  onSave,
  saveLabel,
  showGlobalSelection = false
}: TerminalEnvironmentEditorProps): JSX.Element {
  const { t } = useI18n()
  const normalizedGlobalEnvironment = globalEnvironment ?? EMPTY_TERMINAL_ENVIRONMENT
  const normalizedInitialEnvironment = initialEnvironment ?? EMPTY_TERMINAL_ENVIRONMENT
  const initialGlobalNames = useMemo(
    () => selectedGlobalNames(normalizedGlobalEnvironment, initialSelectedGlobalNames),
    [normalizedGlobalEnvironment, initialSelectedGlobalNames]
  )
  const initialPartitionedRows = useMemo(
    () => partitionEnvironmentRows(normalizedInitialEnvironment, showGlobalSelection ? initialGlobalNames : []),
    [normalizedInitialEnvironment, initialGlobalNames, showGlobalSelection]
  )
  const initialRows = initialPartitionedRows.rows
  const initialGlobalOverrideRows = initialPartitionedRows.globalOverrideRows
  const [rows, setRows] = useState<TerminalEnvironmentRow[]>(initialRows)
  const [globalOverrideRows, setGlobalOverrideRows] = useState<TerminalEnvironmentRow[]>(initialGlobalOverrideRows)
  const [selectedNames, setSelectedNames] = useState<string[]>(initialGlobalNames)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRows(initialRows)
    setGlobalOverrideRows(initialGlobalOverrideRows)
    setSelectedNames(initialGlobalNames)
    setActionError(null)
  }, [initialGlobalNames, initialGlobalOverrideRows, initialRows])

  const nodeEnvironment = useMemo(() => rowsToEnvironment(rows), [rows])
  const environment = useMemo(() => rowsToEnvironment([...globalOverrideRows, ...rows]), [globalOverrideRows, rows])
  const globalEntries = useMemo(() => terminalEnvironmentEntries(normalizedGlobalEnvironment), [normalizedGlobalEnvironment])
  const selectedKeys = useMemo(() => new Set(selectedNames.map(terminalEnvironmentKey)), [selectedNames])
  const overriddenKeys = useMemo(() => new Set(Object.keys(environment).map(terminalEnvironmentKey)), [environment])
  const selectedCount = selectedNames.length
  const variableKeys = useMemo(
    () => new Set([...selectedNames, ...Object.keys(nodeEnvironment)].map(terminalEnvironmentKey)),
    [nodeEnvironment, selectedNames]
  )
  const variableCount = variableKeys.size
  const atVariableLimit = variableCount >= MAX_TERMINAL_ENVIRONMENT_VARIABLES

  const issues = useMemo<ValidationIssue[]>(() => {
    const nextIssues: ValidationIssue[] = []
    const assignedNames = new Map<string, string>()

    if (variableCount > MAX_TERMINAL_ENVIRONMENT_VARIABLES) {
      nextIssues.push({
        id: 'too-many-variables',
        message: t('terminalEnvironment.errorTooManyVariablesEditor', { count: MAX_TERMINAL_ENVIRONMENT_VARIABLES })
      })
    }

    for (const row of [...globalOverrideRows, ...rows]) {
      const name = row.name.trim()
      if (!name && !row.value) continue

      if (!isValidTerminalEnvironmentName(name)) {
        nextIssues.push({ id: row.id, message: t('terminalEnvironment.errorInvalidVariableName') })
        continue
      }

      const key = terminalEnvironmentKey(name)
      const previousName = assignedNames.get(key)
      if (previousName) {
        nextIssues.push({ id: row.id, message: t('terminalEnvironment.errorDuplicateName', { name: previousName }) })
        continue
      }

      assignedNames.set(key, name)
      if (row.value.length > MAX_TERMINAL_ENVIRONMENT_VALUE_LENGTH) {
        nextIssues.push({ id: row.id, message: t('terminalEnvironment.errorValueTooLong', { name }) })
      }
    }

    return nextIssues
  }, [globalOverrideRows, rows, t, variableCount])
  const initialEnvironmentValue = useMemo(() => rowsToEnvironment([...initialGlobalOverrideRows, ...initialRows]), [initialGlobalOverrideRows, initialRows])
  const rowsDirty = !sameEnvironment(environment, initialEnvironmentValue)
  const selectionDirty = showGlobalSelection && !sameStringSet(selectedNames, initialGlobalNames)
  const isDirty = rowsDirty || selectionDirty
  const hasIssues = issues.length > 0

  const updateRow = (id: string, patch: Partial<Pick<TerminalEnvironmentRow, 'name' | 'value'>>): void => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
    setActionError(null)
  }

  const removeRow = (id: string): void => {
    setRows((current) => current.filter((row) => row.id !== id))
    setActionError(null)
  }

  const addRow = (): void => {
    setRows((current) => [...current, createBlankRow([...globalOverrideRows, ...current])])
    setActionError(null)
  }

  const toggleGlobalName = (name: string): void => {
    const key = terminalEnvironmentKey(name)

    if (selectedNames.some((selectedName) => terminalEnvironmentKey(selectedName) === key)) {
      setSelectedNames((current) => current.filter((selectedName) => terminalEnvironmentKey(selectedName) !== key))
      setGlobalOverrideRows((current) => removeEnvironmentRow(current, name))
    } else {
      const existingRow = rows.find((row) => terminalEnvironmentKey(row.name.trim()) === key)
      setSelectedNames((current) => (current.some((selectedName) => terminalEnvironmentKey(selectedName) === key) ? current : [...current, name]))
      if (existingRow) {
        setRows((current) => current.filter((row) => row.id !== existingRow.id))
        setGlobalOverrideRows((current) => {
          const globalValue = environmentValue(normalizedGlobalEnvironment, name)
          return existingRow.value === globalValue ? removeEnvironmentRow(current, name) : upsertEnvironmentRow(current, name, existingRow.value)
        })
      }
    }
    setActionError(null)
  }

  const overrideGlobalName = (name: string, value: string): void => {
    setGlobalOverrideRows((current) => {
      const globalValue = environmentValue(normalizedGlobalEnvironment, name)
      return value === globalValue ? removeEnvironmentRow(current, name) : upsertEnvironmentRow(current, name, value)
    })
    setActionError(null)
  }

  const save = async (): Promise<void> => {
    if (hasIssues || !isDirty) return

    setSaving(true)
    setActionError(null)

    try {
      await onSave({
        environment,
        selectedGlobalNames: showGlobalSelection ? selectedNames : undefined
      })
      const savedRows = partitionEnvironmentRows(environment, showGlobalSelection ? selectedNames : [])
      setRows(savedRows.rows)
      setGlobalOverrideRows(savedRows.globalOverrideRows)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['terminal-environment-editor', className].filter(Boolean).join(' ')}>
      {description ? <p className="terminal-environment-editor__description">{description}</p> : null}

      {showGlobalSelection ? (
        <div className="terminal-environment-editor__group">
          <div className="terminal-environment-editor__group-header">
            <span>{t('terminalEnvironment.globalVariables')}</span>
            <small>{t('terminalEnvironment.selectedCount', { count: selectedCount })}</small>
          </div>
          {globalEntries.length > 0 ? (
            <div className="terminal-environment-editor__global-list">
              {globalEntries.map(([name, value]) => {
                const checked = selectedKeys.has(terminalEnvironmentKey(name))
                const overridden = overriddenKeys.has(terminalEnvironmentKey(name))
                const effectiveValue = environmentValue(environment, name) ?? value

                return (
                  <div key={name} className="terminal-environment-editor__global-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled || saving || (!checked && atVariableLimit)}
                      aria-label={name}
                      onChange={() => toggleGlobalName(name)}
                    />
                    <span>{name}</span>
                    <input
                      value={effectiveValue}
                      disabled={disabled || saving || !checked}
                      aria-label={t('terminalEnvironment.valueFor', { name })}
                      onChange={(event) => overrideGlobalName(name, event.target.value)}
                    />
                    <small>{overridden ? t('terminalEnvironment.overridden') : t('terminalEnvironment.fromSettings')}</small>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="terminal-environment-editor__empty">{t('terminalEnvironment.noGlobalVariables')}</p>
          )}
        </div>
      ) : null}

      <div className="terminal-environment-editor__group">
        <div className="terminal-environment-editor__group-header">
          <span>{showGlobalSelection ? t('terminalEnvironment.nodeVariables') : t('terminalEnvironment.variables')}</span>
          <button type="button" className="secondary-button" disabled={disabled || saving || atVariableLimit} onClick={addRow}>
            <Plus size={14} />
            <span>{t('terminalEnvironment.addVariable')}</span>
          </button>
        </div>

        <div className="terminal-environment-editor__rows">
          {rows.map((row, index) => (
            <div key={row.id} className="terminal-environment-editor__row">
              <span className="terminal-environment-editor__row-index" aria-hidden="true">
                {index + 1}
              </span>
              <input
                value={row.name}
                disabled={disabled || saving}
                placeholder={t('terminalEnvironment.keyPlaceholder')}
                aria-label={t('terminalEnvironment.key')}
                onChange={(event) => updateRow(row.id, { name: event.target.value })}
              />
              <input
                value={row.value}
                disabled={disabled || saving}
                placeholder={t('terminalEnvironment.valuePlaceholder')}
                aria-label={t('terminalEnvironment.value')}
                onChange={(event) => updateRow(row.id, { value: event.target.value })}
              />
              <button type="button" className="icon-button" disabled={disabled || saving} aria-label={t('common.remove')} onClick={() => removeRow(row.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {rows.length === 0 ? <p className="terminal-environment-editor__empty">{t('terminalEnvironment.noVariables')}</p> : null}
        </div>
      </div>

      <div className="terminal-environment-editor__footer">
        <span>{t('terminalEnvironment.variableCount', { count: variableCount })}</span>
        <button type="button" className="primary-button" disabled={disabled || saving || !isDirty || hasIssues} onClick={() => void save()}>
          {saving ? t('saveState.saving') : saveLabel ?? t('common.save')}
        </button>
      </div>
      {hasIssues ? (
        <div className="terminal-environment-editor__errors" role="alert">
          {issues.slice(0, 4).map((issue) => (
            <span key={`${issue.id}:${issue.message}`}>{issue.message}</span>
          ))}
        </div>
      ) : null}
      {actionError ? <span className="terminal-environment-editor__action-error">{actionError}</span> : null}
    </div>
  )
}
