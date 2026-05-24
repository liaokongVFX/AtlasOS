import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { nanoid } from 'nanoid'
import { createPortal } from 'react-dom'
import {
  CalendarDays,
  Check,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
  UserRound
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import { useI18n, type I18nKey, type TFunction } from '../../i18n'
import { cn } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'
import {
  clearKanbanView,
  createKanbanCard,
  createKanbanColumn,
  deleteKanbanCard,
  deleteKanbanColumn,
  findKanbanColumnForCard,
  getFilteredKanbanColumns,
  getKanbanFilterOptions,
  isKanbanColumnWipExceeded,
  kanbanStateEquals,
  KANBAN_PRIORITIES,
  moveKanbanCard,
  moveKanbanColumn,
  normalizeKanbanLabels,
  normalizeKanbanState,
  updateKanbanCard,
  updateKanbanColumn,
  updateKanbanView,
  type KanbanCard,
  type KanbanColumn,
  type KanbanText,
  type KanbanPriority,
  type KanbanState
} from './kanban-model'

type DragData =
  | {
      type: 'column'
      columnId: string
    }
  | {
      type: 'card'
      cardId: string
      columnId: string
    }

type CardDialogState =
  | {
      mode: 'create'
      columnId: string
    }
  | {
      mode: 'edit'
      cardId: string
    }

type ColumnDialogState =
  | {
      mode: 'create'
    }
  | {
      mode: 'edit'
      columnId: string
    }

const CARD_DRAG_PREFIX = 'kanban-card:'
const COLUMN_DRAG_PREFIX = 'kanban-column:'

const DUE_DATE_SHORTCUTS = [
  { labelKey: 'kanban.today', offsetDays: 0 },
  { labelKey: 'kanban.tomorrow', offsetDays: 1 },
  { labelKey: 'kanban.nextWeek', offsetDays: 7 }
] as const

const FILTER_PRIORITIES = KANBAN_PRIORITIES.filter((priority) => priority !== 'none')

function cardDragId(cardId: string): string {
  return `${CARD_DRAG_PREFIX}${cardId}`
}

function columnDragId(columnId: string): string {
  return `${COLUMN_DRAG_PREFIX}${columnId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readDragData(value: unknown): DragData | null {
  if (!isRecord(value)) return null

  if (value.type === 'column' && typeof value.columnId === 'string') {
    return { type: 'column', columnId: value.columnId }
  }

  if (value.type === 'card' && typeof value.cardId === 'string' && typeof value.columnId === 'string') {
    return { type: 'card', cardId: value.cardId, columnId: value.columnId }
  }

  return null
}

function localDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function relativeDateInputValue(offsetDays: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return localDateInputValue(date)
}

function todayDate(): string {
  return localDateInputValue(new Date())
}

function isOverdue(dueDate: string): boolean {
  return Boolean(dueDate && dueDate < todayDate())
}

function labelsInput(labels: string[]): string {
  return labels.join('，')
}

function activeFilterCount(state: KanbanState): number {
  return state.view.labels.length + state.view.assignees.length + state.view.priorities.length
}

function priorityLabel(priority: KanbanPriority, t: TFunction): string {
  return t(`kanban.priority.${priority}` as I18nKey)
}

function cardDropTarget(state: KanbanState, overData: DragData): { columnId: string; index: number } | null {
  if (overData.type === 'column') {
    const column = state.columns.find((item) => item.id === overData.columnId)
    return column ? { columnId: column.id, index: column.cardIds.length } : null
  }

  const column = state.columns.find((item) => item.id === overData.columnId)
  if (!column) return null

  const index = column.cardIds.indexOf(overData.cardId)
  return { columnId: column.id, index: index === -1 ? column.cardIds.length : index }
}

function ToggleFilter({
  checked,
  children,
  onChange
}: {
  checked: boolean
  children: ReactNode
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label className="kanban-filter-option">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

function PriorityBadge({ priority }: { priority: KanbanPriority }): JSX.Element {
  const { t } = useI18n()

  return <span className={cn('kanban-priority', `kanban-priority--${priority}`)}>{priorityLabel(priority, t)}</span>
}

function PriorityPicker({
  value,
  onChange
}: {
  value: KanbanPriority
  onChange: (priority: KanbanPriority) => void
}): JSX.Element {
  const { t } = useI18n()
  const labelId = useId()
  const valueId = useId()

  return (
    <div className="kanban-form-field">
      <span id={labelId}>{t('kanban.priority')}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="kanban-picker-trigger" aria-labelledby={`${labelId} ${valueId}`}>
            <PriorityBadge priority={value} />
            <span id={valueId} className="sr-only">
              {priorityLabel(value, t)}
            </span>
            <ChevronDown size={15} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content kanban-priority-menu" align="start" collisionPadding={12}>
            <DropdownMenu.RadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as KanbanPriority)}>
              {KANBAN_PRIORITIES.map((priority) => (
                <DropdownMenu.RadioItem key={priority} value={priority} className="menu-item kanban-priority-option">
                  <span className="kanban-priority-option__check" aria-hidden="true">
                    {value === priority ? <Check size={13} /> : null}
                  </span>
                  <PriorityBadge priority={priority} />
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function DueDatePicker({
  value,
  onChange
}: {
  value: string
  onChange: (date: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const labelId = useId()
  const valueId = useId()
  const overdue = isOverdue(value)

  return (
    <div className="kanban-form-field">
      <span id={labelId}>{t('kanban.dueDate')}</span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn('kanban-date-trigger', !value && 'kanban-date-trigger--empty', overdue && 'kanban-date-trigger--overdue')}
            aria-labelledby={`${labelId} ${valueId}`}
          >
            <CalendarDays size={15} />
            <span id={valueId}>{value || t('kanban.unset')}</span>
            <ChevronDown size={15} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="popover-content kanban-date-popover" align="start" sideOffset={8} collisionPadding={12}>
            <label className="kanban-date-picker">
              <span>{t('kanban.date')}</span>
              <input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={t('kanban.selectDueDate')} />
            </label>
            <div className="kanban-date-shortcuts">
              {DUE_DATE_SHORTCUTS.map((shortcut) => (
                <button key={shortcut.labelKey} type="button" className="kanban-date-shortcut" onClick={() => onChange(relativeDateInputValue(shortcut.offsetDays))}>
                  {t(shortcut.labelKey)}
                </button>
              ))}
            </div>
            <button type="button" className="tool-button kanban-date-clear" onClick={() => onChange('')} disabled={!value}>
              <X size={14} />
              <span>{t('kanban.clearDate')}</span>
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

function KanbanCardPreview({ card, overlay = false }: { card: KanbanCard; overlay?: boolean }): JSX.Element {
  const { t } = useI18n()
  const overdue = isOverdue(card.dueDate)

  return (
    <article className={cn('kanban-card', overlay && 'kanban-card--overlay', overdue && 'kanban-card--overdue')}>
      <div className="kanban-card__topline">
        <strong>{card.title}</strong>
        {card.priority !== 'none' ? <PriorityBadge priority={card.priority} /> : null}
      </div>
      {card.description ? <p>{card.description}</p> : null}
      {card.labels.length > 0 ? (
        <div className="kanban-card__labels">
          {card.labels.map((label) => (
            <span key={label} className="kanban-label">
              {label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="kanban-card__meta">
        {card.assignee ? (
          <span title={card.assignee}>
            <UserRound size={12} />
            {card.assignee}
          </span>
        ) : null}
        {card.dueDate ? (
          <span className={overdue ? 'kanban-card__meta-danger' : ''} title={overdue ? t('kanban.overdue') : t('kanban.dueDateTitle')}>
            <CalendarDays size={12} />
            {card.dueDate}
          </span>
        ) : null}
      </div>
    </article>
  )
}

function KanbanDragOverlay({
  card,
  column
}: {
  card: KanbanCard | null
  column: KanbanColumn | null
}): JSX.Element | null {
  const overlay = (
    <DragOverlay className="kanban-drag-overlay" dropAnimation={null}>
      {card ? <KanbanCardPreview card={card} overlay /> : null}
      {!card && column ? (
        <div className="kanban-column kanban-column--overlay">
          <header className="kanban-column__header">
            <div className="kanban-column__title">
              <strong>{column.title}</strong>
              <span>{column.cardIds.length}</span>
            </div>
          </header>
        </div>
      ) : null}
    </DragOverlay>
  )

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body)
}

function SortableKanbanCard({
  card,
  columnId,
  onOpen
}: {
  card: KanbanCard
  columnId: string
  onOpen: (cardId: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: cardDragId(card.id),
    data: { type: 'card', cardId: card.id, columnId } satisfies DragData
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  }
  const suppressClickRef = useRef(false)

  useEffect(() => {
    if (isDragging) {
      suppressClickRef.current = true
      return undefined
    }

    if (!suppressClickRef.current) return undefined

    const timeout = window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [isDragging])

  const openCard = useCallback(() => {
    onOpen(card.id)
  }, [card.id, onOpen])

  const handleCardClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      openCard()
    },
    [openCard]
  )

  const handleCardKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

      event.preventDefault()
      event.stopPropagation()
      openCard()
    },
    [openCard]
  )

  return (
    <div
      ref={setNodeRef}
      className={cn('kanban-card-shell nodrag', isDragging && 'kanban-card-shell--dragging')}
      style={style}
      aria-label={t('kanban.openOrDragCard', { title: card.title })}
      title={t('kanban.dragCardTitle')}
      onClick={handleCardClick}
      onKeyDownCapture={handleCardKeyDownCapture}
      {...attributes}
      {...listeners}
    >
      <KanbanCardPreview card={card} />
    </div>
  )
}

function SortableKanbanColumn({
  column,
  fullColumn,
  cards,
  filtersActive,
  onAddCard,
  onDeleteColumn,
  onEditColumn,
  onOpenCard
}: {
  column: KanbanColumn
  fullColumn: KanbanColumn
  cards: KanbanCard[]
  filtersActive: boolean
  onAddCard: (columnId: string) => void
  onDeleteColumn: (columnId: string) => void
  onEditColumn: (columnId: string) => void
  onOpenCard: (cardId: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: columnDragId(column.id),
    data: { type: 'column', columnId: column.id } satisfies DragData
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  }
  const wipExceeded = isKanbanColumnWipExceeded(fullColumn)

  return (
    <section
      ref={setNodeRef}
      className={cn('kanban-column', isDragging && 'kanban-column--dragging', wipExceeded && 'kanban-column--wip-exceeded')}
      style={style}
    >
      <header className="kanban-column__header">
        <button
          type="button"
          className="kanban-column__drag nodrag"
          aria-label={t('kanban.dragColumn', { column: column.title })}
          title={t('kanban.dragColumnTitle')}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <div className="kanban-column__title">
          <strong>{column.title}</strong>
          <span>
            {fullColumn.cardIds.length}
            {fullColumn.wipLimit !== null ? ` / ${fullColumn.wipLimit}` : ''}
          </span>
        </div>
        <button
          type="button"
          className="icon-button kanban-icon-button"
          title={t('kanban.addCard')}
          aria-label={t('kanban.addCardAria', { column: column.title })}
          onClick={() => onAddCard(column.id)}
        >
          <Plus size={14} />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="icon-button kanban-icon-button"
              title={t('kanban.columnSettings')}
              aria-label={t('kanban.columnSettingsAria', { column: column.title })}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content kanban-column-menu" collisionPadding={12}>
              <DropdownMenu.Item className="menu-item kanban-column-menu__item" onSelect={() => onEditColumn(column.id)}>
                <span>{t('kanban.renameAndLimit')}</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item menu-item--danger kanban-column-menu__item" onSelect={() => onDeleteColumn(column.id)}>
                <Trash2 size={14} />
                <span>{t('kanban.deleteColumn')}</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      {wipExceeded ? <div className="kanban-column__wip">{t('kanban.wipExceeded')}</div> : null}
      <SortableContext items={cards.map((card) => cardDragId(card.id))} strategy={verticalListSortingStrategy}>
        <div className="kanban-column__cards">
          {cards.map((card) => (
            <SortableKanbanCard key={card.id} card={card} columnId={column.id} onOpen={onOpenCard} />
          ))}
          {cards.length === 0 ? (
            <div className="kanban-column__empty">{filtersActive && fullColumn.cardIds.length > 0 ? t('kanban.noMatchingCards') : t('kanban.noCards')}</div>
          ) : null}
        </div>
      </SortableContext>
    </section>
  )
}

export function KanbanComponent({ component, updateState }: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const rawKanban = component.state.kanban
  const kanbanText = useMemo<KanbanText>(
    () => ({
      defaultColumns: [
        { id: 'backlog', title: t('kanban.defaultColumn.backlog') },
        { id: 'doing', title: t('kanban.defaultColumn.doing') },
        { id: 'done', title: t('kanban.defaultColumn.done') }
      ],
      defaultCardTitle: t('kanban.defaultCardTitle'),
      defaultColumnTitle: t('kanban.defaultColumnTitle')
    }),
    [t]
  )
  const kanban = useMemo(() => normalizeKanbanState(rawKanban, undefined, kanbanText), [rawKanban, kanbanText])
  const [dragPreview, setDragPreview] = useState<KanbanState | null>(null)
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null)
  const [cardDialog, setCardDialog] = useState<CardDialogState | null>(null)
  const [cardTitle, setCardTitle] = useState('')
  const [cardDescription, setCardDescription] = useState('')
  const [cardLabels, setCardLabels] = useState('')
  const [cardPriority, setCardPriority] = useState<KanbanPriority>('none')
  const [cardAssignee, setCardAssignee] = useState('')
  const [cardDueDate, setCardDueDate] = useState('')
  const [columnDialog, setColumnDialog] = useState<ColumnDialogState | null>(null)
  const [columnTitle, setColumnTitle] = useState('')
  const [columnWipLimit, setColumnWipLimit] = useState('')
  const [deleteColumnId, setDeleteColumnId] = useState<string | null>(null)
  const renderState = dragPreview ?? kanban
  const visibleColumns = useMemo(() => getFilteredKanbanColumns(renderState), [renderState])
  const filtersActive = activeFilterCount(renderState) > 0 || Boolean(renderState.view.search)
  const filterOptions = useMemo(() => getKanbanFilterOptions(renderState), [renderState])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const commitKanban = useCallback(
    (nextState: KanbanState, immediate = true) => {
      updateState({ kanban: nextState }, immediate)
    },
    [updateState]
  )

  useEffect(() => {
    if (JSON.stringify(rawKanban ?? null) !== JSON.stringify(kanban)) {
      commitKanban(kanban, true)
    }
  }, [commitKanban, kanban, rawKanban])

  const openCreateCard = useCallback((columnId: string) => {
    setCardDialog({ mode: 'create', columnId })
    setCardTitle('')
    setCardDescription('')
    setCardLabels('')
    setCardPriority('none')
    setCardAssignee('')
    setCardDueDate('')
  }, [])

  const openEditCard = useCallback(
    (cardId: string) => {
      const card = kanban.cards[cardId]
      if (!card) return

      setCardDialog({ mode: 'edit', cardId })
      setCardTitle(card.title)
      setCardDescription(card.description)
      setCardLabels(labelsInput(card.labels))
      setCardPriority(card.priority)
      setCardAssignee(card.assignee)
      setCardDueDate(card.dueDate)
    },
    [kanban.cards]
  )

  const closeCardDialog = useCallback(() => {
    setCardDialog(null)
  }, [])

  const submitCardDialog = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!cardDialog) return

      const input = {
        title: cardTitle,
        description: cardDescription,
        labels: normalizeKanbanLabels(cardLabels),
        priority: cardPriority,
        assignee: cardAssignee,
        dueDate: cardDueDate
      }

      const nextState =
        cardDialog.mode === 'create'
          ? createKanbanCard(kanban, cardDialog.columnId, nanoid(), input, undefined, kanbanText)
          : updateKanbanCard(kanban, cardDialog.cardId, input, undefined, kanbanText)

      commitKanban(nextState, true)
      closeCardDialog()
    },
    [cardAssignee, cardDescription, cardDialog, cardDueDate, cardLabels, cardPriority, cardTitle, closeCardDialog, commitKanban, kanban, kanbanText]
  )

  const deleteActiveCard = useCallback(() => {
    if (!cardDialog || cardDialog.mode !== 'edit') return
    commitKanban(deleteKanbanCard(kanban, cardDialog.cardId), true)
    closeCardDialog()
  }, [cardDialog, closeCardDialog, commitKanban, kanban])

  const openCreateColumn = useCallback(() => {
    setColumnDialog({ mode: 'create' })
    setColumnTitle('')
    setColumnWipLimit('')
  }, [])

  const openEditColumn = useCallback(
    (columnId: string) => {
      const column = kanban.columns.find((item) => item.id === columnId)
      if (!column) return

      setColumnDialog({ mode: 'edit', columnId })
      setColumnTitle(column.title)
      setColumnWipLimit(column.wipLimit === null ? '' : String(column.wipLimit))
    },
    [kanban.columns]
  )

  const closeColumnDialog = useCallback(() => {
    setColumnDialog(null)
  }, [])

  const submitColumnDialog = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!columnDialog) return

      const input = { title: columnTitle, wipLimit: columnWipLimit }
      const nextState =
        columnDialog.mode === 'create'
          ? createKanbanColumn(kanban, nanoid(), input, undefined, kanbanText)
          : updateKanbanColumn(kanban, columnDialog.columnId, input, undefined, kanbanText)

      commitKanban(nextState, true)
      closeColumnDialog()
    },
    [closeColumnDialog, columnDialog, columnTitle, columnWipLimit, commitKanban, kanban, kanbanText]
  )

  const confirmDeleteColumn = useCallback(() => {
    if (!deleteColumnId) return
    commitKanban(deleteKanbanColumn(kanban, deleteColumnId, kanbanText), true)
    setDeleteColumnId(null)
  }, [commitKanban, deleteColumnId, kanban, kanbanText])

  const setSearch = useCallback(
    (search: string) => {
      commitKanban(updateKanbanView(kanban, { search }), false)
    },
    [commitKanban, kanban]
  )

  const toggleStringFilter = useCallback(
    (key: 'labels' | 'assignees', value: string, checked: boolean) => {
      const current = renderState.view[key]
      const nextValues = checked ? [...current, value] : current.filter((item) => item !== value)
      commitKanban(updateKanbanView(kanban, { [key]: nextValues }), false)
    },
    [commitKanban, kanban, renderState.view]
  )

  const togglePriorityFilter = useCallback(
    (priority: KanbanPriority, checked: boolean) => {
      const nextValues = checked
        ? [...renderState.view.priorities, priority]
        : renderState.view.priorities.filter((item) => item !== priority)
      commitKanban(updateKanbanView(kanban, { priorities: nextValues }), false)
    },
    [commitKanban, kanban, renderState.view.priorities]
  )

  const clearFilters = useCallback(() => {
    commitKanban(clearKanbanView(kanban), false)
  }, [commitKanban, kanban])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDrag(readDragData(event.active.data.current))
  }, [])

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const activeData = readDragData(event.active.data.current)
      const overData = readDragData(event.over?.data.current)
      if (!activeData || activeData.type !== 'card' || !overData) return

      const currentState = dragPreview ?? kanban
      const target = cardDropTarget(currentState, overData)
      if (!target) return

      const sourceColumn = findKanbanColumnForCard(currentState, activeData.cardId)
      if (sourceColumn?.id === target.columnId && sourceColumn.cardIds.indexOf(activeData.cardId) === target.index) return

      const nextState = moveKanbanCard(currentState, activeData.cardId, target.columnId, target.index)
      if (!kanbanStateEquals(nextState, currentState)) setDragPreview(nextState)
    },
    [dragPreview, kanban]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeData = readDragData(event.active.data.current)
      const overData = readDragData(event.over?.data.current)
      let nextState: KanbanState | null = null

      if (activeData?.type === 'column' && overData?.type === 'column') {
        const targetIndex = renderState.columns.findIndex((column) => column.id === overData.columnId)
        if (targetIndex !== -1) nextState = moveKanbanColumn(kanban, activeData.columnId, targetIndex)
      }

      if (activeData?.type === 'card') {
        nextState = dragPreview
        if (!nextState && overData) {
          const target = cardDropTarget(kanban, overData)
          if (target) nextState = moveKanbanCard(kanban, activeData.cardId, target.columnId, target.index)
        }
      }

      if (nextState && !kanbanStateEquals(nextState, kanban)) {
        commitKanban(nextState, true)
      }

      setDragPreview(null)
      setActiveDrag(null)
    },
    [commitKanban, dragPreview, kanban, renderState.columns]
  )

  const handleDragCancel = useCallback(() => {
    setDragPreview(null)
    setActiveDrag(null)
  }, [])

  const activeOverlayCard = activeDrag?.type === 'card' ? renderState.cards[activeDrag.cardId] : null
  const activeOverlayColumn = activeDrag?.type === 'column' ? renderState.columns.find((column) => column.id === activeDrag.columnId) : null
  const deleteColumn = deleteColumnId ? kanban.columns.find((column) => column.id === deleteColumnId) : null

  return (
    <div className="kanban-module">
      <div className="kanban-toolbar">
        <div className="kanban-search">
          <Search size={15} />
          <input
            value={renderState.view.search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('kanban.searchCards')}
            aria-label={t('kanban.searchCards')}
          />
        </div>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className={cn('tool-button kanban-filter-button', activeFilterCount(renderState) > 0 && 'kanban-filter-button--active')}>
              <SlidersHorizontal size={15} />
              <span>{t('kanban.filter')}{activeFilterCount(renderState) > 0 ? ` ${activeFilterCount(renderState)}` : ''}</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="popover-content kanban-filter-popover" sideOffset={8} collisionPadding={12}>
              <div className="kanban-filter-group">
                <strong>{t('kanban.priority')}</strong>
                {FILTER_PRIORITIES.map((priority) => (
                  <ToggleFilter
                    key={priority}
                    checked={renderState.view.priorities.includes(priority)}
                    onChange={(checked) => togglePriorityFilter(priority, checked)}
                  >
                    {priorityLabel(priority, t)}
                  </ToggleFilter>
                ))}
              </div>
              {filterOptions.labels.length > 0 ? (
                <div className="kanban-filter-group">
                  <strong>{t('kanban.labels')}</strong>
                  {filterOptions.labels.map((label) => (
                    <ToggleFilter
                      key={label}
                      checked={renderState.view.labels.includes(label)}
                      onChange={(checked) => toggleStringFilter('labels', label, checked)}
                    >
                      {label}
                    </ToggleFilter>
                  ))}
                </div>
              ) : null}
              {filterOptions.assignees.length > 0 ? (
                <div className="kanban-filter-group">
                  <strong>{t('kanban.assignee')}</strong>
                  {filterOptions.assignees.map((assignee) => (
                    <ToggleFilter
                      key={assignee}
                      checked={renderState.view.assignees.includes(assignee)}
                      onChange={(checked) => toggleStringFilter('assignees', assignee, checked)}
                    >
                      {assignee}
                    </ToggleFilter>
                  ))}
                </div>
              ) : null}
              <button type="button" className="tool-button kanban-filter-clear" onClick={clearFilters} disabled={!filtersActive}>
                {t('kanban.clearFilters')}
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <button type="button" className="tool-button" onClick={openCreateColumn}>
          <Plus size={15} />
          <span>{t('kanban.addColumn')}</span>
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={renderState.columns.map((column) => columnDragId(column.id))} strategy={horizontalListSortingStrategy}>
          <div className="kanban-board">
            {visibleColumns.map((column) => {
              const fullColumn = renderState.columns.find((item) => item.id === column.id) ?? column
              const cards = column.cardIds.map((cardId) => renderState.cards[cardId]).filter((card): card is KanbanCard => Boolean(card))

              return (
                <SortableKanbanColumn
                  key={column.id}
                  column={column}
                  fullColumn={fullColumn}
                  cards={cards}
                  filtersActive={filtersActive}
                  onAddCard={openCreateCard}
                  onDeleteColumn={setDeleteColumnId}
                  onEditColumn={openEditColumn}
                  onOpenCard={openEditCard}
                />
              )
            })}
          </div>
        </SortableContext>
        <KanbanDragOverlay card={activeOverlayCard} column={activeOverlayColumn ?? null} />
      </DndContext>

      <Dialog.Root open={Boolean(cardDialog)} onOpenChange={(open) => !open && closeCardDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content kanban-dialog">
            <Dialog.Title className="dialog-title">{cardDialog?.mode === 'create' ? t('kanban.addCard') : t('kanban.editCard')}</Dialog.Title>
            <Dialog.Description className="sr-only">{t('kanban.editCardDescription')}</Dialog.Description>
            <form onSubmit={submitCardDialog} className="kanban-form">
              <label>
                <span>{t('kanban.title')}</span>
                <input value={cardTitle} autoFocus onChange={(event) => setCardTitle(event.target.value)} />
              </label>
              <label>
                <span>{t('kanban.description')}</span>
                <textarea value={cardDescription} onChange={(event) => setCardDescription(event.target.value)} />
              </label>
              <div className="kanban-form__grid">
                <PriorityPicker value={cardPriority} onChange={setCardPriority} />
                <DueDatePicker value={cardDueDate} onChange={setCardDueDate} />
              </div>
              <label>
                <span>{t('kanban.assignee')}</span>
                <input value={cardAssignee} onChange={(event) => setCardAssignee(event.target.value)} />
              </label>
              <label>
                <span>{t('kanban.labels')}</span>
                <input value={cardLabels} onChange={(event) => setCardLabels(event.target.value)} placeholder={t('kanban.labelsPlaceholder')} />
              </label>
              <div className="dialog-actions">
                {cardDialog?.mode === 'edit' ? (
                  <button type="button" className="tool-button danger" onClick={deleteActiveCard}>
                    <Trash2 size={16} />
                    <span>{t('common.delete')}</span>
                  </button>
                ) : null}
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {t('common.cancel')}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button" disabled={!cardTitle.trim()}>
                  {t('common.save')}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(columnDialog)} onOpenChange={(open) => !open && closeColumnDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content kanban-dialog kanban-dialog--narrow">
            <Dialog.Title className="dialog-title">{columnDialog?.mode === 'create' ? t('kanban.addColumn') : t('kanban.columnSettings')}</Dialog.Title>
            <Dialog.Description className="sr-only">{t('kanban.editColumnDescription')}</Dialog.Description>
            <form onSubmit={submitColumnDialog} className="kanban-form">
              <label>
                <span>{t('common.name')}</span>
                <input value={columnTitle} autoFocus onChange={(event) => setColumnTitle(event.target.value)} />
              </label>
              <label>
                <span>{t('kanban.wipLimit')}</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={columnWipLimit}
                  onChange={(event) => setColumnWipLimit(event.target.value)}
                  placeholder={t('kanban.unlimited')}
                />
              </label>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {t('common.cancel')}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button" disabled={!columnTitle.trim()}>
                  {t('common.save')}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(deleteColumn)} onOpenChange={(open) => !open && setDeleteColumnId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">{t('kanban.deleteColumnTitle')}</Dialog.Title>
            <Dialog.Description className="dialog-description">
              {t('kanban.deleteColumnDescription', {
                column: deleteColumn ? `"${deleteColumn.title}"` : t('kanban.thisColumn'),
                count: deleteColumn?.cardIds.length ?? 0
              })}
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="tool-button">
                  {t('common.cancel')}
                </button>
              </Dialog.Close>
              <button type="button" className="tool-button danger" onClick={confirmDeleteColumn}>
                <Trash2 size={16} />
                <span>{t('common.delete')}</span>
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
