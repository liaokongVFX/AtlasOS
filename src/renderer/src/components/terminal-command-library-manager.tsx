import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { nanoid } from 'nanoid'
import { Check, ChevronDown, CornerDownRight, GripVertical, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useState, type CSSProperties, type FormEvent } from 'react'
import {
  createTerminalCommand,
  createTerminalCommandCategory,
  deleteTerminalCommand,
  deleteTerminalCommandCategory,
  moveTerminalCommand,
  moveTerminalCommandCategory,
  renameTerminalCommandCategory,
  setTerminalCommandActiveCategory,
  updateTerminalCommand,
  type TerminalCommandCategory,
  type TerminalCommandEntry,
  type TerminalCommandLibrary
} from '@shared/terminal-commands'
import { useI18n } from '../i18n'
import { cn } from '../lib/utils'
import { useAppSettingsStore } from '../store/app-settings-store'

type TerminalCommandLibraryManagerProps = {
  className?: string
  commandActionsDisabled?: boolean
  onExecuteCommand?: (command: string) => void
  onInsertCommand?: (command: string) => void
}

type DragData =
  | {
      type: 'category'
      categoryId: string
    }
  | {
      type: 'command'
      commandId: string
    }

type CategoryDialogState =
  | {
      mode: 'create'
    }
  | {
      mode: 'edit'
      categoryId: string
    }

type CommandDialogState =
  | {
      mode: 'create'
    }
  | {
      mode: 'edit'
      commandId: string
    }

type CategoryDraft = {
  name: string
}

type CommandDraft = {
  categoryId: string
  name: string
  command: string
}

const CATEGORY_DRAG_PREFIX = 'terminal-command-category:'
const COMMAND_DRAG_PREFIX = 'terminal-command:'

const DND_MEASURING = {
  droppable: {
    strategy: MeasuringStrategy.Always
  }
}

function categoryDragId(categoryId: string): string {
  return `${CATEGORY_DRAG_PREFIX}${categoryId}`
}

function commandDragId(commandId: string): string {
  return `${COMMAND_DRAG_PREFIX}${commandId}`
}

function readDragData(value: unknown): DragData | null {
  if (!value || typeof value !== 'object') return null

  const data = value as Partial<DragData>
  if (data.type === 'category' && typeof data.categoryId === 'string') return { type: 'category', categoryId: data.categoryId }
  if (data.type === 'command' && typeof data.commandId === 'string') return { type: 'command', commandId: data.commandId }
  return null
}

function activeCategory(library: TerminalCommandLibrary): TerminalCommandCategory | null {
  return library.categories.find((category) => category.id === library.activeCategoryId) ?? library.categories[0] ?? null
}

function commandDialogDraft(command: TerminalCommandEntry, categoryId: string): CommandDraft {
  return {
    categoryId,
    name: command.name,
    command: command.command
  }
}

function categoryForCommand(library: TerminalCommandLibrary, commandId: string): TerminalCommandCategory | null {
  return library.categories.find((category) => category.commandIds.includes(commandId)) ?? null
}

function CategoryOverlay({ active, category }: { active: boolean; category: TerminalCommandCategory }): JSX.Element {
  return (
    <div className={cn('terminal-command-category-tab terminal-command-category-tab--overlay', active && 'terminal-command-category-tab--active')}>
      <span>{category.name}</span>
    </div>
  )
}

function CommandOverlay({ command }: { command: TerminalCommandEntry }): JSX.Element {
  return (
    <div className="terminal-command-row terminal-command-row--overlay">
      <span className="terminal-command-row__drag" aria-hidden="true">
        <GripVertical size={14} />
      </span>
      <span className="terminal-command-row__main">
        <strong>{command.name}</strong>
        <small>{command.command}</small>
      </span>
    </div>
  )
}

function TerminalCommandDragOverlay({
  activeCategoryId,
  category,
  command
}: {
  activeCategoryId: string
  category: TerminalCommandCategory | null
  command: TerminalCommandEntry | null
}): JSX.Element {
  const overlayStyle: CSSProperties | undefined = category ? { width: 'max-content', height: 'auto' } : undefined
  const overlay = (
    <DragOverlay className="terminal-command-drag-overlay" dropAnimation={null} style={overlayStyle}>
      {category ? <CategoryOverlay active={category.id === activeCategoryId} category={category} /> : command ? <CommandOverlay command={command} /> : null}
    </DragOverlay>
  )

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body)
}

function SortableCategoryTab({
  active,
  category,
  onActivate
}: {
  active: boolean
  category: TerminalCommandCategory
  onActivate: () => void
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: categoryDragId(category.id),
    data: { type: 'category', categoryId: category.id } satisfies DragData
  })
  const style: CSSProperties = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn('terminal-command-category-tab', active && 'terminal-command-category-tab--active', isDragging && 'terminal-command-category-tab--dragging')}
      style={style}
      onClick={onActivate}
      {...attributes}
      {...listeners}
    >
      <span>{category.name}</span>
    </button>
  )
}

function SortableCommandRow({
  command,
  commandActionsDisabled,
  onDelete,
  onEdit,
  onExecute,
  onInsert
}: {
  command: TerminalCommandEntry
  commandActionsDisabled: boolean
  onDelete: () => void
  onEdit: () => void
  onExecute?: () => void
  onInsert?: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: commandDragId(command.id),
    data: { type: 'command', commandId: command.id } satisfies DragData
  })
  const style: CSSProperties = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition,
    visibility: isDragging ? 'hidden' : undefined
  }

  return (
    <article ref={setNodeRef} className="terminal-command-row" style={style}>
      <button
        type="button"
        className="terminal-command-row__drag"
        title={t('terminalCommands.dragCommand', { name: command.name })}
        aria-label={t('terminalCommands.dragCommand', { name: command.name })}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <button type="button" className="terminal-command-row__main" onClick={onEdit}>
        <strong>{command.name}</strong>
        <small>{command.command}</small>
      </button>
      <div className="terminal-command-row__actions">
        {onInsert ? (
          <button
            type="button"
            className="terminal-command-icon-button"
            disabled={commandActionsDisabled}
            onClick={onInsert}
            title={t('terminalCommands.insertCommand')}
            aria-label={t('terminalCommands.insertCommand')}
          >
            <CornerDownRight size={13} />
          </button>
        ) : null}
        {onExecute ? (
          <button
            type="button"
            className="terminal-command-icon-button terminal-command-icon-button--primary"
            disabled={commandActionsDisabled}
            onClick={onExecute}
            title={t('terminalCommands.executeCommand')}
            aria-label={t('terminalCommands.executeCommand')}
          >
            <Play size={13} />
          </button>
        ) : null}
        <button
          type="button"
          className="terminal-command-icon-button"
          onClick={onEdit}
          title={t('terminalCommands.editCommand')}
          aria-label={t('terminalCommands.editCommand')}
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className="terminal-command-icon-button danger"
          onClick={onDelete}
          title={t('terminalCommands.deleteCommand')}
          aria-label={t('terminalCommands.deleteCommand')}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  )
}

function CategoryPicker({
  categories,
  onChange,
  value
}: {
  categories: TerminalCommandCategory[]
  onChange: (categoryId: string) => void
  value: string
}): JSX.Element {
  const { t } = useI18n()
  const selectedCategory = categories.find((category) => category.id === value) ?? categories[0]

  return (
    <div className="terminal-command-form-field">
      <span>{t('terminalCommands.category')}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="terminal-command-category-trigger">
            <span>{selectedCategory?.name ?? t('terminalCommands.noCategories')}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content terminal-command-category-menu" align="start" collisionPadding={12}>
            <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
              {categories.map((category) => (
                <DropdownMenu.RadioItem
                  key={category.id}
                  value={category.id}
                  className={cn('menu-item terminal-command-category-option', category.id === value && 'terminal-command-category-option--selected')}
                >
                  <span>{category.name}</span>
                  <span className="terminal-command-category-option__check" aria-hidden="true">
                    {category.id === value ? <Check size={13} /> : null}
                  </span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

export function TerminalCommandLibraryManager({
  className,
  commandActionsDisabled = false,
  onExecuteCommand,
  onInsertCommand
}: TerminalCommandLibraryManagerProps): JSX.Element {
  const { t } = useI18n()
  const settings = useAppSettingsStore((state) => state.settings)
  const updateSettings = useAppSettingsStore((state) => state.update)
  const library = settings.terminalCommands
  const selectedCategory = activeCategory(library)
  const commands = selectedCategory
    ? selectedCategory.commandIds.map((commandId) => library.commands[commandId]).filter((command): command is TerminalCommandEntry => Boolean(command))
    : []
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState | null>(null)
  const [commandDialog, setCommandDialog] = useState<CommandDialogState | null>(null)
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null)
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>({ name: '' })
  const [commandDraft, setCommandDraft] = useState<CommandDraft>({ categoryId: '', name: '', command: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeCategoryDragId, setActiveCategoryDragId] = useState<string | null>(null)
  const [activeCommandDragId, setActiveCommandDragId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const activeDragCategory = activeCategoryDragId ? library.categories.find((category) => category.id === activeCategoryDragId) ?? null : null
  const activeDragCommand = activeCommandDragId ? library.commands[activeCommandDragId] ?? null : null
  const showCommandActions = Boolean(onInsertCommand || onExecuteCommand)
  const currentDeleteCategory = deleteCategoryId ? library.categories.find((category) => category.id === deleteCategoryId) ?? null : null
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const activeData = readDragData(args.active.data.current)
    if (!activeData) return closestCenter(args)

    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => container.id !== args.active.id && readDragData(container.data.current)?.type === activeData.type)
    })
  }, [])

  const commitLibrary = useCallback(
    async (nextLibrary: TerminalCommandLibrary): Promise<void> => {
      setSaving(true)
      setActionError(null)

      try {
        await updateSettings({
          ...settings,
          terminalCommands: nextLibrary
        })
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error))
      } finally {
        setSaving(false)
      }
    },
    [settings, updateSettings]
  )

  const openCreateCategory = useCallback(() => {
    setCategoryDraft({ name: '' })
    setFormError(null)
    setCategoryDialog({ mode: 'create' })
  }, [])

  const openEditCategory = useCallback(() => {
    if (!selectedCategory) return

    setCategoryDraft({ name: selectedCategory.name })
    setFormError(null)
    setCategoryDialog({ mode: 'edit', categoryId: selectedCategory.id })
  }, [selectedCategory])

  const openCreateCommand = useCallback(() => {
    if (!selectedCategory) return

    setCommandDraft({ categoryId: selectedCategory.id, name: '', command: '' })
    setFormError(null)
    setCommandDialog({ mode: 'create' })
  }, [selectedCategory])

  const openEditCommand = useCallback(
    (commandId: string) => {
      const command = library.commands[commandId]
      const category = categoryForCommand(library, commandId)
      if (!command || !category) return

      setCommandDraft(commandDialogDraft(command, category.id))
      setFormError(null)
      setCommandDialog({ mode: 'edit', commandId })
    },
    [library]
  )

  const submitCategoryDialog = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!categoryDialog) return
      if (!categoryDraft.name.trim()) {
        setFormError(t('terminalCommands.categoryRequired'))
        return
      }

      const nextLibrary =
        categoryDialog.mode === 'create'
          ? createTerminalCommandCategory(library, nanoid(), categoryDraft)
          : renameTerminalCommandCategory(library, categoryDialog.categoryId, categoryDraft)

      void commitLibrary(nextLibrary)
      setCategoryDialog(null)
      setFormError(null)
    },
    [categoryDialog, categoryDraft, commitLibrary, library, t]
  )

  const submitCommandDialog = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!commandDialog) return
      if (!commandDraft.categoryId) {
        setFormError(t('terminalCommands.categoryRequired'))
        return
      }
      if (!commandDraft.command.trim()) {
        setFormError(t('terminalCommands.commandRequired'))
        return
      }

      const nextLibrary =
        commandDialog.mode === 'create'
          ? createTerminalCommand(library, commandDraft.categoryId, nanoid(), commandDraft)
          : updateTerminalCommand(library, commandDialog.commandId, commandDraft)

      void commitLibrary(nextLibrary)
      setCommandDialog(null)
      setFormError(null)
    },
    [commandDialog, commandDraft, commitLibrary, library, t]
  )

  const requestDeleteCategory = useCallback(() => {
    if (!selectedCategory) return
    if (selectedCategory.commandIds.length > 0) {
      setDeleteCategoryId(selectedCategory.id)
      return
    }

    void commitLibrary(deleteTerminalCommandCategory(library, selectedCategory.id))
  }, [commitLibrary, library, selectedCategory])

  const confirmDeleteCategory = useCallback(() => {
    if (!deleteCategoryId) return

    void commitLibrary(deleteTerminalCommandCategory(library, deleteCategoryId))
    setDeleteCategoryId(null)
  }, [commitLibrary, deleteCategoryId, library])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeData = readDragData(event.active.data.current)
    setActiveCategoryDragId(activeData?.type === 'category' ? activeData.categoryId : null)
    setActiveCommandDragId(activeData?.type === 'command' ? activeData.commandId : null)
  }, [])

  const clearDragOverlay = useCallback(() => {
    setActiveCategoryDragId(null)
    setActiveCommandDragId(null)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearDragOverlay()
      const activeData = readDragData(event.active.data.current)
      const overData = readDragData(event.over?.data.current)
      if (!activeData || !overData) return

      if (activeData.type === 'category' && overData.type === 'category') {
        const targetIndex = library.categories.findIndex((category) => category.id === overData.categoryId)
        void commitLibrary(moveTerminalCommandCategory(library, activeData.categoryId, targetIndex))
        return
      }

      if (activeData.type === 'command' && overData.type === 'command' && selectedCategory) {
        const targetIndex = selectedCategory.commandIds.indexOf(overData.commandId)
        void commitLibrary(moveTerminalCommand(library, selectedCategory.id, activeData.commandId, targetIndex))
      }
    },
    [clearDragOverlay, commitLibrary, library, selectedCategory]
  )

  const activateCategory = useCallback(
    (categoryId: string) => {
      void commitLibrary(setTerminalCommandActiveCategory(library, categoryId))
    },
    [commitLibrary, library]
  )

  return (
    <div className={cn('terminal-command-library', showCommandActions && 'terminal-command-library--with-actions', className)}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={DND_MEASURING}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDragOverlay}
      >
        <div className="terminal-command-library__toolbar">
          <SortableContext items={library.categories.map((category) => categoryDragId(category.id))} strategy={horizontalListSortingStrategy}>
            <div className="terminal-command-library__categories" aria-label={t('terminalCommands.categories')}>
              {library.categories.map((category) => (
                <SortableCategoryTab
                  key={category.id}
                  category={category}
                  active={category.id === selectedCategory?.id}
                  onActivate={() => activateCategory(category.id)}
                />
              ))}
            </div>
          </SortableContext>
          <div className="terminal-command-library__toolbar-actions">
            <button
              type="button"
              className="icon-button terminal-command-toolbar-button"
              onClick={openCreateCategory}
              disabled={saving}
              title={t('terminalCommands.addCategory')}
              aria-label={t('terminalCommands.addCategory')}
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="icon-button terminal-command-toolbar-button"
              onClick={openEditCategory}
              disabled={saving || !selectedCategory}
              title={t('terminalCommands.editCategory')}
              aria-label={t('terminalCommands.editCategory')}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="icon-button terminal-command-toolbar-button danger"
              onClick={requestDeleteCategory}
              disabled={saving || !selectedCategory}
              title={t('terminalCommands.deleteCategory')}
              aria-label={t('terminalCommands.deleteCategory')}
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              className="icon-button primary terminal-command-toolbar-button"
              onClick={openCreateCommand}
              disabled={saving || !selectedCategory}
              title={t('terminalCommands.addCommand')}
              aria-label={t('terminalCommands.addCommand')}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {actionError ? <div className="module-error terminal-command-library__error">{actionError}</div> : null}

        <div className="terminal-command-library__body">
          {selectedCategory ? (
            <SortableContext items={selectedCategory.commandIds.map(commandDragId)} strategy={rectSortingStrategy}>
              <div className={cn('terminal-command-list', commands.length === 0 && 'terminal-command-list--empty')}>
                {commands.map((command) => (
                  <SortableCommandRow
                    key={command.id}
                    command={command}
                    commandActionsDisabled={commandActionsDisabled}
                    onDelete={() => void commitLibrary(deleteTerminalCommand(library, command.id))}
                    onEdit={() => openEditCommand(command.id)}
                    onExecute={onExecuteCommand ? () => onExecuteCommand(command.command) : undefined}
                    onInsert={onInsertCommand ? () => onInsertCommand(command.command) : undefined}
                  />
                ))}
                {commands.length === 0 ? <div className="terminal-command-empty">{t('terminalCommands.noCommands')}</div> : null}
              </div>
            </SortableContext>
          ) : (
            <div className="terminal-command-empty terminal-command-empty--library">
              <span>{t('terminalCommands.noCategories')}</span>
              <button type="button" className="tool-button" onClick={openCreateCategory}>
                <Plus size={14} />
                <span>{t('terminalCommands.addCategory')}</span>
              </button>
            </div>
          )}
        </div>

        <TerminalCommandDragOverlay activeCategoryId={library.activeCategoryId} category={activeDragCategory} command={activeDragCommand} />
      </DndContext>

      <Dialog.Root open={Boolean(categoryDialog)} onOpenChange={(open) => !open && setCategoryDialog(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content terminal-command-dialog">
            <Dialog.Title className="dialog-title">
              {categoryDialog?.mode === 'edit' ? t('terminalCommands.editCategory') : t('terminalCommands.addCategory')}
            </Dialog.Title>
            <Dialog.Description className="sr-only">{t('terminalCommands.categoryDialogDescription')}</Dialog.Description>
            {formError ? <div className="module-error terminal-command-dialog__error">{formError}</div> : null}
            <form className="terminal-command-form" onSubmit={submitCategoryDialog}>
              <label className="terminal-command-form-field">
                <span>{t('terminalCommands.categoryName')}</span>
                <input
                  value={categoryDraft.name}
                  onChange={(event) => {
                    setCategoryDraft({ name: event.target.value })
                    setFormError(null)
                  }}
                  placeholder={t('terminalCommands.categoryNamePlaceholder')}
                  autoFocus
                />
              </label>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {t('common.cancel')}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button primary">
                  {categoryDialog?.mode === 'edit' ? t('common.save') : t('common.create')}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(commandDialog)} onOpenChange={(open) => !open && setCommandDialog(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content terminal-command-dialog">
            <Dialog.Title className="dialog-title">
              {commandDialog?.mode === 'edit' ? t('terminalCommands.editCommand') : t('terminalCommands.addCommand')}
            </Dialog.Title>
            <Dialog.Description className="sr-only">{t('terminalCommands.commandDialogDescription')}</Dialog.Description>
            {formError ? <div className="module-error terminal-command-dialog__error">{formError}</div> : null}
            <form className="terminal-command-form" onSubmit={submitCommandDialog}>
              <CategoryPicker
                categories={library.categories}
                value={commandDraft.categoryId}
                onChange={(categoryId) => setCommandDraft((current) => ({ ...current, categoryId }))}
              />
              <label className="terminal-command-form-field">
                <span>{t('terminalCommands.commandName')}</span>
                <input
                  value={commandDraft.name}
                  onChange={(event) => setCommandDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t('terminalCommands.commandNamePlaceholder')}
                  autoFocus
                />
              </label>
              <label className="terminal-command-form-field">
                <span>{t('terminalCommands.command')}</span>
                <textarea
                  value={commandDraft.command}
                  onChange={(event) => {
                    setCommandDraft((current) => ({ ...current, command: event.target.value }))
                    setFormError(null)
                  }}
                  placeholder={t('terminalCommands.commandPlaceholder')}
                />
              </label>
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {t('common.cancel')}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button primary" disabled={!commandDraft.command.trim()}>
                  {commandDialog?.mode === 'edit' ? t('common.save') : t('common.create')}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(currentDeleteCategory)} onOpenChange={(open) => !open && setDeleteCategoryId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content terminal-command-dialog">
            <Dialog.Title className="dialog-title">{t('terminalCommands.deleteCategoryTitle')}</Dialog.Title>
            <Dialog.Description className="dialog-description">
              {currentDeleteCategory
                ? t('terminalCommands.deleteCategoryDescription', {
                    name: currentDeleteCategory.name,
                    count: currentDeleteCategory.commandIds.length
                  })
                : null}
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="tool-button">
                  {t('common.cancel')}
                </button>
              </Dialog.Close>
              <button type="button" className="tool-button danger" onClick={confirmDeleteCategory}>
                {t('common.delete')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
