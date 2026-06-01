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
import {
  AppWindow,
  Check,
  ChevronDown,
  File,
  Folder,
  Globe2,
  PanelTopOpen,
  Pencil,
  Plus,
  TerminalSquare,
  Trash2,
  X,
  type LucideIcon
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
  type TouchEvent,
  type WheelEvent
} from 'react'
import { createPortal } from 'react-dom'
import { useI18n, type I18nKey } from '../../i18n'
import { cn, normalizeUrl } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'
import {
  createQuickLauncherItem,
  createQuickLauncherTab,
  deleteQuickLauncherItem,
  deleteQuickLauncherTab,
  moveQuickLauncherItem,
  moveQuickLauncherTab,
  normalizeQuickLauncherState,
  renameQuickLauncherTab,
  setQuickLauncherActiveTab,
  updateQuickLauncherItem,
  type QuickLauncherCommandShell,
  type QuickLauncherItem,
  type QuickLauncherItemInput,
  type QuickLauncherItemKind,
  type QuickLauncherState,
  type QuickLauncherTab,
  type QuickLauncherText
} from './quick-launcher-model'

type DragData =
  | {
      type: 'tab'
      tabId: string
    }
  | {
      type: 'item'
      itemId: string
    }

type ItemDialogState =
  | {
      mode: 'create'
    }
  | {
      mode: 'edit'
      itemId: string
    }

type ItemDraft = {
  kind: QuickLauncherItemKind
  name: string
  targetPath: string
  url: string
  shell: QuickLauncherCommandShell
  command: string
  cwd: string
  iconDataUrl?: string
}

const TAB_DRAG_PREFIX = 'quick-launcher-tab:'
const ITEM_DRAG_PREFIX = 'quick-launcher-item:'

const ITEM_KIND_OPTIONS: { kind: QuickLauncherItemKind; labelKey: I18nKey }[] = [
  { kind: 'app', labelKey: 'quickLauncher.kind.app' },
  { kind: 'file', labelKey: 'quickLauncher.kind.file' },
  { kind: 'folder', labelKey: 'quickLauncher.kind.folder' },
  { kind: 'url', labelKey: 'quickLauncher.kind.url' },
  { kind: 'command', labelKey: 'quickLauncher.kind.command' }
]

const ITEM_ICONS: Record<QuickLauncherItemKind, LucideIcon> = {
  app: AppWindow,
  file: File,
  folder: Folder,
  url: Globe2,
  command: TerminalSquare
}

const COMMAND_SHELL_OPTIONS: { shell: QuickLauncherCommandShell; label: string }[] = [
  { shell: 'powershell', label: 'PowerShell' },
  { shell: 'cmd', label: 'cmd' }
]

const DND_MEASURING = {
  droppable: {
    strategy: MeasuringStrategy.Always
  }
}

const LAUNCH_DEBOUNCE_MS = 800
const WHEEL_LINE_SIZE = 16

function tabDragId(tabId: string): string {
  return `${TAB_DRAG_PREFIX}${tabId}`
}

function itemDragId(itemId: string): string {
  return `${ITEM_DRAG_PREFIX}${itemId}`
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function wheelDeltaToPixels(event: WheelEvent<HTMLElement>): number {
  const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
  if (event.deltaMode === 1) return delta * WHEEL_LINE_SIZE
  if (event.deltaMode === 2) return delta * event.currentTarget.clientWidth
  return delta
}

function readDragData(value: unknown): DragData | null {
  if (!value || typeof value !== 'object') return null

  const data = value as Partial<DragData>
  if (data.type === 'tab' && typeof data.tabId === 'string') return { type: 'tab', tabId: data.tabId }
  if (data.type === 'item' && typeof data.itemId === 'string') return { type: 'item', itemId: data.itemId }
  return null
}

function launcherStateShape(value: Record<string, unknown>): Pick<QuickLauncherState, 'schemaVersion' | 'tabs' | 'items' | 'activeTabId'> {
  return {
    schemaVersion: value.schemaVersion as QuickLauncherState['schemaVersion'],
    tabs: value.tabs as QuickLauncherState['tabs'],
    items: value.items as QuickLauncherState['items'],
    activeTabId: value.activeTabId as string
  }
}

function pathBaseName(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).at(-1) ?? trimmed
}

function emptyDraft(kind: QuickLauncherItemKind = 'app'): ItemDraft {
  return {
    kind,
    name: '',
    targetPath: '',
    url: '',
    shell: 'powershell',
    command: '',
    cwd: '',
    iconDataUrl: undefined
  }
}

function draftFromItem(item: QuickLauncherItem): ItemDraft {
  if (item.kind === 'url') {
    return {
      ...emptyDraft(item.kind),
      name: item.name,
      url: item.url
    }
  }

  if (item.kind === 'command') {
    return {
      ...emptyDraft(item.kind),
      name: item.name,
      shell: item.shell,
      command: item.command,
      cwd: item.cwd ?? ''
    }
  }

  return {
    ...emptyDraft(item.kind),
    name: item.name,
    targetPath: item.targetPath,
    iconDataUrl: item.iconDataUrl
  }
}

function draftToInput(draft: ItemDraft): QuickLauncherItemInput {
  if (draft.kind === 'url') {
    return {
      kind: draft.kind,
      name: draft.name,
      url: draft.url
    }
  }

  if (draft.kind === 'command') {
    return {
      kind: draft.kind,
      name: draft.name,
      shell: draft.shell,
      command: draft.command,
      cwd: draft.cwd
    }
  }

  return {
    kind: draft.kind,
    name: draft.name,
    targetPath: draft.targetPath,
    iconDataUrl: draft.iconDataUrl
  }
}

function itemLaunchInput(item: QuickLauncherItem): Parameters<typeof window.atlas.launcher.open>[0] {
  if (item.kind === 'url') return { kind: 'url', url: normalizeUrl(item.url) }
  if (item.kind === 'command') return { kind: 'command', shell: item.shell, command: item.command, cwd: item.cwd }
  return { kind: item.kind, targetPath: item.targetPath }
}

function tabNameInputSize(name: string): number {
  return Math.max(4, Math.min(name.length, 18))
}

function pathItemIcon(item: QuickLauncherItem): string | undefined {
  return item.kind === 'app' || item.kind === 'file' || item.kind === 'folder' ? item.iconDataUrl : undefined
}

function LauncherTileVisual({ item }: { item: QuickLauncherItem }): JSX.Element {
  const Icon = ITEM_ICONS[item.kind]
  const iconDataUrl = pathItemIcon(item)

  return (
    <>
      <span className="quick-launcher-tile__icon" aria-hidden="true">
        {iconDataUrl ? <img src={iconDataUrl} alt="" draggable={false} /> : <Icon size={20} />}
      </span>
      <span className="quick-launcher-tile__name">{item.name}</span>
    </>
  )
}

function LauncherTabOverlayVisual({ active, canDelete, tab }: { active: boolean; canDelete: boolean; tab: QuickLauncherTab }): JSX.Element {
  const showDelete = active && canDelete

  return (
    <div className={cn('quick-launcher-tab quick-launcher-tab--overlay', active && 'quick-launcher-tab--active', showDelete && 'quick-launcher-tab--with-delete')}>
      <span className="quick-launcher-tab__label">
        <span>{tab.name}</span>
      </span>
      {showDelete ? (
        <span className="quick-launcher-tab__delete" aria-hidden="true">
          <X size={12} />
        </span>
      ) : null}
    </div>
  )
}

function QuickLauncherDragOverlay({
  activeTabId,
  canDeleteTab,
  item,
  tab
}: {
  activeTabId: string
  canDeleteTab: boolean
  item: QuickLauncherItem | null
  tab: QuickLauncherTab | null
}): JSX.Element {
  const overlayStyle: CSSProperties | undefined = tab ? { width: 'max-content', height: 'auto' } : undefined
  const overlay = (
    <DragOverlay className="quick-launcher-drag-overlay" dropAnimation={null} style={overlayStyle}>
      {tab ? (
        <LauncherTabOverlayVisual active={tab.id === activeTabId} canDelete={canDeleteTab} tab={tab} />
      ) : item ? (
        <article className="quick-launcher-tile quick-launcher-tile--overlay">
          <div className="quick-launcher-tile__launch">
            <LauncherTileVisual item={item} />
          </div>
        </article>
      ) : null}
    </DragOverlay>
  )

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body)
}

function QuickLauncherKindPicker({
  disabled = false,
  onChange,
  value
}: {
  disabled?: boolean
  onChange: (kind: QuickLauncherItemKind) => void
  value: QuickLauncherItemKind
}): JSX.Element {
  const { t } = useI18n()
  const labelId = useId()
  const valueId = useId()
  const selectedOption = ITEM_KIND_OPTIONS.find((option) => option.kind === value) ?? ITEM_KIND_OPTIONS[0]
  const SelectedIcon = ITEM_ICONS[selectedOption.kind]

  return (
    <div className="quick-launcher-form-field">
      <span id={labelId}>{t('quickLauncher.type')}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          <button type="button" className="quick-launcher-kind-trigger" aria-labelledby={`${labelId} ${valueId}`}>
            <span className="quick-launcher-kind-trigger__value" id={valueId}>
              <SelectedIcon size={15} />
              <span>{t(selectedOption.labelKey)}</span>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content quick-launcher-kind-menu" align="start" collisionPadding={12}>
            {ITEM_KIND_OPTIONS.map((option) => {
              const Icon = ITEM_ICONS[option.kind]
              const selected = option.kind === value

              return (
                <DropdownMenu.Item
                  key={option.kind}
                  className={cn('menu-item quick-launcher-kind-option', selected && 'quick-launcher-kind-option--selected')}
                  onSelect={() => onChange(option.kind)}
                >
                  <Icon size={14} />
                  <span>{t(option.labelKey)}</span>
                  <span className="quick-launcher-kind-option__check" aria-hidden="true">
                    {selected ? <Check size={13} /> : null}
                  </span>
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function QuickLauncherShellPicker({ onChange, value }: { onChange: (shell: QuickLauncherCommandShell) => void; value: QuickLauncherCommandShell }): JSX.Element {
  const { t } = useI18n()
  const labelId = useId()
  const valueId = useId()
  const selectedOption = COMMAND_SHELL_OPTIONS.find((option) => option.shell === value) ?? COMMAND_SHELL_OPTIONS[0]

  return (
    <div className="quick-launcher-form-field">
      <span id={labelId}>{t('quickLauncher.shell')}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="quick-launcher-kind-trigger quick-launcher-shell-trigger" aria-labelledby={`${labelId} ${valueId}`}>
            <span className="quick-launcher-kind-trigger__value" id={valueId}>
              <TerminalSquare size={15} />
              <span>{selectedOption.label}</span>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-content quick-launcher-shell-menu" align="start" collisionPadding={12}>
            <DropdownMenu.RadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as QuickLauncherCommandShell)}>
              {COMMAND_SHELL_OPTIONS.map((option) => {
                const selected = option.shell === value
                return (
                  <DropdownMenu.RadioItem
                    key={option.shell}
                    value={option.shell}
                    className={cn('menu-item quick-launcher-shell-option', selected && 'quick-launcher-shell-option--selected')}
                  >
                    <TerminalSquare size={13} />
                    <span>{option.label}</span>
                    <span className="quick-launcher-shell-option__check" aria-hidden="true">
                      {selected ? <Check size={13} /> : null}
                    </span>
                  </DropdownMenu.RadioItem>
                )
              })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function SortableLauncherTab({
  active,
  canDelete,
  editing,
  onActivate,
  onCommitName,
  onDelete,
  onEdit,
  tab
}: {
  active: boolean
  canDelete: boolean
  editing: boolean
  onActivate: () => void
  onCommitName: (name: string) => void
  onDelete: () => void
  onEdit: () => void
  tab: QuickLauncherTab
}): JSX.Element {
  const { t } = useI18n()
  const [draftName, setDraftName] = useState(tab.name)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabDragId(tab.id),
    data: { type: 'tab', tabId: tab.id } satisfies DragData,
    disabled: { draggable: editing }
  })
  const style: CSSProperties = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition
  }

  useEffect(() => {
    if (!editing) setDraftName(tab.name)
  }, [editing, tab.name])

  useEffect(() => {
    if (!editing) return undefined

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [editing])

  const commit = useCallback(() => {
    onCommitName(draftName)
  }, [draftName, onCommitName])

  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter') {
        event.preventDefault()
        commit()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDraftName(tab.name)
        onCommitName(tab.name)
      }
    },
    [commit, onCommitName, tab.name]
  )
  const showDelete = active && canDelete

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'quick-launcher-tab',
        active && 'quick-launcher-tab--active',
        editing && 'quick-launcher-tab--editing',
        showDelete && 'quick-launcher-tab--with-delete',
        isDragging && 'quick-launcher-tab--dragging'
      )}
      style={style}
      onClick={editing ? undefined : onActivate}
      onDoubleClick={editing ? undefined : onEdit}
      {...attributes}
      {...listeners}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="quick-launcher-tab__input"
          value={draftName}
          size={tabNameInputSize(draftName)}
          onBlur={commit}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={keyDown}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          aria-label={t('quickLauncher.renameTab')}
        />
      ) : (
        <span className="quick-launcher-tab__label">
          <span>{tab.name}</span>
        </span>
      )}
      {showDelete ? (
        <button
          type="button"
          className="quick-launcher-tab__delete"
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          aria-label={t('quickLauncher.deleteTab', { name: tab.name })}
          title={t('quickLauncher.deleteTab', { name: tab.name })}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}

function SortableLauncherTile({
  item,
  launching,
  onDelete,
  onEdit,
  onLaunch
}: {
  item: QuickLauncherItem
  launching: boolean
  onDelete: () => void
  onEdit: () => void
  onLaunch: () => void
}): JSX.Element {
  const { t } = useI18n()
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemDragId(item.id),
    data: { type: 'item', itemId: item.id } satisfies DragData
  })
  const handleLaunchMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    listeners?.onMouseDown?.(event)
  }
  const handleLaunchTouchStart = (event: TouchEvent<HTMLButtonElement>) => {
    listeners?.onTouchStart?.(event)
  }
  const style: CSSProperties = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition,
    visibility: isDragging ? 'hidden' : undefined
  }

  return (
    <article
      ref={setNodeRef}
      className={cn('quick-launcher-tile quick-launcher-tile--sortable', launching && 'quick-launcher-tile--launching', isDragging && 'quick-launcher-tile--dragging')}
      style={style}
    >
      <div className="quick-launcher-tile__actions">
        <button
          type="button"
          className="quick-launcher-tile__icon-button"
          onClick={onEdit}
          onPointerDown={(event) => event.stopPropagation()}
          title={t('quickLauncher.editItem')}
          aria-label={t('quickLauncher.editItem')}
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className="quick-launcher-tile__icon-button danger"
          onClick={onDelete}
          onPointerDown={(event) => event.stopPropagation()}
          title={t('quickLauncher.deleteItem')}
          aria-label={t('quickLauncher.deleteItem')}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <button
        type="button"
        className="quick-launcher-tile__launch"
        disabled={launching}
        onClick={onLaunch}
        onMouseDown={handleLaunchMouseDown}
        onTouchStart={handleLaunchTouchStart}
        aria-label={t('quickLauncher.launchItem', { name: item.name })}
      >
        <LauncherTileVisual item={item} />
      </button>
    </article>
  )
}

export function QuickLauncherComponent({ component, updateState }: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const launcherText = useMemo<QuickLauncherText>(
    () => ({
      defaultTabName: t('quickLauncher.defaultTabName'),
      defaultItemName: t('quickLauncher.defaultItemName')
    }),
    [t]
  )
  const launcher = useMemo(() => normalizeQuickLauncherState(component.state, undefined, launcherText), [component.state, launcherText])
  const activeTab = launcher.tabs.find((tab) => tab.id === launcher.activeTabId) ?? launcher.tabs[0]
  const activeItems = activeTab.itemIds.map((itemId) => launcher.items[itemId]).filter((item): item is QuickLauncherItem => Boolean(item))
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [deleteTabId, setDeleteTabId] = useState<string | null>(null)
  const [itemDialog, setItemDialog] = useState<ItemDialogState | null>(null)
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft())
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [launchingItemIds, setLaunchingItemIds] = useState<Set<string>>(() => new Set())
  const [activeTabDragId, setActiveTabDragId] = useState<string | null>(null)
  const [activeItemDragId, setActiveItemDragId] = useState<string | null>(null)
  const launchingItemIdsRef = useRef(new Set<string>())
  const launchLockTimersRef = useRef(new Map<string, number>())
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const activeDragTab = activeTabDragId ? launcher.tabs.find((tab) => tab.id === activeTabDragId) ?? null : null
  const activeDragItem = activeItemDragId ? launcher.items[activeItemDragId] ?? null : null
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const activeData = readDragData(args.active.data.current)
    if (!activeData) return closestCenter(args)

    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => container.id !== args.active.id && readDragData(container.data.current)?.type === activeData.type)
    })
  }, [])

  const commitLauncher = useCallback(
    (nextState: QuickLauncherState, immediate = true) => {
      updateState(nextState, immediate)
    },
    [updateState]
  )

  useEffect(() => {
    const currentShape = launcherStateShape(component.state)
    if (JSON.stringify(currentShape) !== JSON.stringify(launcher)) {
      commitLauncher(launcher, true)
    }
  }, [commitLauncher, component.state, launcher])

  useEffect(
    () => () => {
      for (const timerId of launchLockTimersRef.current.values()) {
        window.clearTimeout(timerId)
      }
      launchLockTimersRef.current.clear()
      launchingItemIdsRef.current.clear()
    },
    []
  )

  const activateTab = useCallback(
    (tabId: string) => {
      commitLauncher(setQuickLauncherActiveTab(launcher, tabId), true)
    },
    [commitLauncher, launcher]
  )

  const addTab = useCallback(() => {
    commitLauncher(createQuickLauncherTab(launcher, nanoid(), `${launcherText.defaultTabName} ${launcher.tabs.length + 1}`, undefined, launcherText), true)
  }, [commitLauncher, launcher, launcherText])

  const commitTabName = useCallback(
    (tabId: string, name: string) => {
      setEditingTabId(null)
      commitLauncher(renameQuickLauncherTab(launcher, tabId, name, undefined, launcherText), true)
    },
    [commitLauncher, launcher, launcherText]
  )

  const requestDeleteTab = useCallback(
    (tabId: string) => {
      const tab = launcher.tabs.find((item) => item.id === tabId)
      if (!tab || launcher.tabs.length <= 1) return

      if (tab.itemIds.length > 0) {
        setDeleteTabId(tabId)
        return
      }

      commitLauncher(deleteQuickLauncherTab(launcher, tabId), true)
    },
    [commitLauncher, launcher]
  )

  const confirmDeleteTab = useCallback(() => {
    if (!deleteTabId) return
    commitLauncher(deleteQuickLauncherTab(launcher, deleteTabId), true)
    setDeleteTabId(null)
  }, [commitLauncher, deleteTabId, launcher])

  const openCreateItem = useCallback(() => {
    setDraft(emptyDraft())
    setFormError(null)
    setItemDialog({ mode: 'create' })
  }, [])

  const openEditItem = useCallback(
    (itemId: string) => {
      const item = launcher.items[itemId]
      if (!item) return

      setDraft(draftFromItem(item))
      setFormError(null)
      setItemDialog({ mode: 'edit', itemId })
    },
    [launcher.items]
  )

  const closeItemDialog = useCallback(() => {
    setItemDialog(null)
    setFormError(null)
  }, [])

  const deleteItem = useCallback(
    (itemId: string) => {
      commitLauncher(deleteQuickLauncherItem(launcher, itemId), true)
    },
    [commitLauncher, launcher]
  )

  const browseForTarget = useCallback(async () => {
    try {
      if (draft.kind === 'app' || draft.kind === 'file') {
        const result = await window.atlas.launcher.chooseFile({ kind: draft.kind })
        if (!result) return

        setDraft((current) => ({
          ...current,
          targetPath: result.path,
          iconDataUrl: result.iconDataUrl ?? undefined,
          name: current.name.trim() ? current.name : pathBaseName(result.path)
        }))
        return
      }

      if (draft.kind === 'folder') {
        const path = await window.atlas.filesystem.chooseDirectory(t('quickLauncher.chooseFolder'))
        if (!path) return

        setDraft((current) => ({
          ...current,
          targetPath: path,
          iconDataUrl: undefined,
          name: current.name.trim() ? current.name : pathBaseName(path)
        }))
      }
    } catch (browseError) {
      setFormError(browseError instanceof Error ? browseError.message : t('quickLauncher.failedChooseFile'))
    }
  }, [draft.kind, t])

  const browseForCwd = useCallback(async () => {
    try {
      const path = await window.atlas.filesystem.chooseDirectory(t('quickLauncher.cwd'))
      if (path) setDraft((current) => ({ ...current, cwd: path }))
    } catch (browseError) {
      setFormError(browseError instanceof Error ? browseError.message : t('quickLauncher.failedChooseFile'))
    }
  }, [t])

  const submitItemDialog = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!itemDialog) return

      if ((draft.kind === 'app' || draft.kind === 'file' || draft.kind === 'folder') && !draft.targetPath.trim()) {
        setFormError(t('quickLauncher.pathRequired'))
        return
      }
      if (draft.kind === 'url' && !draft.url.trim()) {
        setFormError(t('quickLauncher.urlRequired'))
        return
      }
      if (draft.kind === 'command' && !draft.command.trim()) {
        setFormError(t('quickLauncher.commandRequired'))
        return
      }

      const input = draftToInput(draft)
      const nextState =
        itemDialog.mode === 'create'
          ? createQuickLauncherItem(launcher, activeTab.id, nanoid(), input, undefined, launcherText)
          : updateQuickLauncherItem(launcher, itemDialog.itemId, input, undefined, launcherText)

      commitLauncher(nextState, true)
      closeItemDialog()
    },
    [activeTab.id, closeItemDialog, commitLauncher, draft, itemDialog, launcher, launcherText, t]
  )

  const launchItem = useCallback(
    async (item: QuickLauncherItem) => {
      if (launchingItemIdsRef.current.has(item.id)) return

      launchingItemIdsRef.current.add(item.id)
      setLaunchingItemIds((current) => {
        const next = new Set(current)
        next.add(item.id)
        return next
      })

      try {
        await window.atlas.launcher.open(itemLaunchInput(item))
        setError(null)
      } catch (launchError) {
        const message = launchError instanceof Error ? launchError.message : String(launchError)
        setError(t('quickLauncher.failedLaunch', { name: item.name, message }))
      } finally {
        const timerId = window.setTimeout(() => {
          launchLockTimersRef.current.delete(item.id)
          launchingItemIdsRef.current.delete(item.id)
          setLaunchingItemIds((current) => {
            if (!current.has(item.id)) return current
            const next = new Set(current)
            next.delete(item.id)
            return next
          })
        }, LAUNCH_DEBOUNCE_MS)
        launchLockTimersRef.current.set(item.id, timerId)
      }
    },
    [t]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeData = readDragData(event.active.data.current)
    setActiveTabDragId(activeData?.type === 'tab' ? activeData.tabId : null)
    setActiveItemDragId(activeData?.type === 'item' ? activeData.itemId : null)
  }, [])

  const clearDragOverlay = useCallback(() => {
    setActiveTabDragId(null)
    setActiveItemDragId(null)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearDragOverlay()
      const activeData = readDragData(event.active.data.current)
      const overData = readDragData(event.over?.data.current)
      if (!activeData || !overData) return

      if (activeData.type === 'tab' && overData.type === 'tab') {
        const targetIndex = launcher.tabs.findIndex((tab) => tab.id === overData.tabId)
        commitLauncher(moveQuickLauncherTab(launcher, activeData.tabId, targetIndex), true)
        return
      }

      if (activeData.type === 'item' && overData.type === 'item') {
        const targetIndex = activeTab.itemIds.indexOf(overData.itemId)
        commitLauncher(moveQuickLauncherItem(launcher, activeTab.id, activeData.itemId, targetIndex), true)
      }
    },
    [activeTab.id, activeTab.itemIds, clearDragOverlay, commitLauncher, launcher]
  )
  const handleTabStripWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) return

    const tabStrip = event.currentTarget
    const maxScrollLeft = tabStrip.scrollWidth - tabStrip.clientWidth
    if (maxScrollLeft <= 0) return

    const delta = wheelDeltaToPixels(event)
    if (delta === 0) return

    const nextScrollLeft = clampNumber(tabStrip.scrollLeft + delta, 0, maxScrollLeft)
    if (nextScrollLeft === tabStrip.scrollLeft) return

    event.preventDefault()
    tabStrip.scrollLeft = nextScrollLeft
  }, [])

  const deleteTab = deleteTabId ? launcher.tabs.find((tab) => tab.id === deleteTabId) : null

  return (
    <div className="quick-launcher-module">
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={DND_MEASURING}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDragOverlay}
      >
        <div className="quick-launcher-toolbar">
          <SortableContext items={launcher.tabs.map((tab) => tabDragId(tab.id))} strategy={horizontalListSortingStrategy}>
            <div className="quick-launcher-tabs" aria-label={t('quickLauncher.tabs')} onWheel={handleTabStripWheel}>
              {launcher.tabs.map((tab) => (
                <SortableLauncherTab
                  key={tab.id}
                  tab={tab}
                  active={tab.id === launcher.activeTabId}
                  canDelete={launcher.tabs.length > 1}
                  editing={editingTabId === tab.id}
                  onActivate={() => activateTab(tab.id)}
                  onCommitName={(name) => commitTabName(tab.id, name)}
                  onDelete={() => requestDeleteTab(tab.id)}
                  onEdit={() => setEditingTabId(tab.id)}
                />
              ))}
            </div>
          </SortableContext>
          <button type="button" className="icon-button quick-launcher-add-tab" onClick={addTab} title={t('quickLauncher.addTab')} aria-label={t('quickLauncher.addTab')}>
            <PanelTopOpen size={15} />
          </button>
          <button
            type="button"
            className="icon-button primary quick-launcher-add-item"
            onClick={openCreateItem}
            title={t('quickLauncher.addItem')}
            aria-label={t('quickLauncher.addItem')}
          >
            <Plus size={15} />
          </button>
        </div>

        {error ? <div className="module-error">{error}</div> : null}

        <div className="quick-launcher-content">
          <SortableContext items={activeTab.itemIds.map(itemDragId)} strategy={rectSortingStrategy}>
            <div className={cn('quick-launcher-grid', activeItems.length === 0 && 'quick-launcher-grid--empty')}>
              {activeItems.map((item) => (
                <SortableLauncherTile
                  key={item.id}
                  item={item}
                  launching={launchingItemIds.has(item.id)}
                  onDelete={() => deleteItem(item.id)}
                  onEdit={() => openEditItem(item.id)}
                  onLaunch={() => void launchItem(item)}
                />
              ))}
              {activeItems.length === 0 ? <div className="quick-launcher-empty">{t('quickLauncher.noItems')}</div> : null}
            </div>
          </SortableContext>
        </div>
        <QuickLauncherDragOverlay
          activeTabId={launcher.activeTabId}
          canDeleteTab={launcher.tabs.length > 1}
          item={activeDragItem}
          tab={activeDragTab}
        />
      </DndContext>

      <Dialog.Root open={Boolean(itemDialog)} onOpenChange={(open) => !open && closeItemDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content quick-launcher-dialog">
            <Dialog.Title className="dialog-title">
              {itemDialog?.mode === 'edit' ? t('quickLauncher.editItem') : t('quickLauncher.addItem')}
            </Dialog.Title>
            <Dialog.Description className="sr-only">{t('quickLauncher.itemDialogDescription')}</Dialog.Description>
            {formError ? <div className="module-error quick-launcher-dialog__error">{formError}</div> : null}
            <form className="quick-launcher-form" onSubmit={submitItemDialog}>
              <QuickLauncherKindPicker
                value={draft.kind}
                disabled={itemDialog?.mode === 'edit'}
                onChange={(kind) => setDraft((current) => ({ ...emptyDraft(kind), name: current.name }))}
              />
              <label>
                <span>{t('common.name')}</span>
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={t('quickLauncher.namePlaceholder')} autoFocus />
              </label>
              {draft.kind === 'app' || draft.kind === 'file' || draft.kind === 'folder' ? (
                <label>
                  <span>{t('quickLauncher.targetPath')}</span>
                  <div className="quick-launcher-form__browse">
                    <input
                      value={draft.targetPath}
                      onChange={(event) => setDraft((current) => ({ ...current, targetPath: event.target.value, iconDataUrl: undefined }))}
                      placeholder={t('quickLauncher.pathPlaceholder')}
                    />
                    <button type="button" className="tool-button" onClick={() => void browseForTarget()}>
                      {t('common.browse')}
                    </button>
                  </div>
                </label>
              ) : null}
              {draft.kind === 'url' ? (
                <label>
                  <span>{t('quickLauncher.url')}</span>
                  <input value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} placeholder={t('quickLauncher.urlPlaceholder')} />
                </label>
              ) : null}
              {draft.kind === 'command' ? (
                <>
                  <QuickLauncherShellPicker value={draft.shell} onChange={(shell) => setDraft((current) => ({ ...current, shell }))} />
                  <label>
                    <span>{t('quickLauncher.command')}</span>
                    <textarea value={draft.command} onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))} placeholder={t('quickLauncher.commandPlaceholder')} />
                  </label>
                  <label>
                    <span>{t('quickLauncher.cwd')}</span>
                    <div className="quick-launcher-form__browse">
                      <input value={draft.cwd} onChange={(event) => setDraft((current) => ({ ...current, cwd: event.target.value }))} placeholder={t('quickLauncher.cwdPlaceholder')} />
                      <button type="button" className="tool-button" onClick={() => void browseForCwd()}>
                        {t('common.browse')}
                      </button>
                    </div>
                  </label>
                </>
              ) : null}
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="tool-button">
                    {t('common.cancel')}
                  </button>
                </Dialog.Close>
                <button type="submit" className="tool-button primary">
                  {t('common.save')}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(deleteTab)} onOpenChange={(open) => !open && setDeleteTabId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">{t('quickLauncher.deleteTabTitle')}</Dialog.Title>
            <Dialog.Description className="dialog-description">
              {t('quickLauncher.deleteTabDescription', {
                name: deleteTab ? `"${deleteTab.name}"` : t('quickLauncher.thisTab'),
                count: deleteTab?.itemIds.length ?? 0
              })}
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="tool-button">
                  {t('common.cancel')}
                </button>
              </Dialog.Close>
              <button type="button" className="tool-button danger" onClick={confirmDeleteTab}>
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
