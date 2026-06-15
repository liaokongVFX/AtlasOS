import {
  applyNodeChanges,
  Panel,
  ReactFlow,
  type OnNodeDrag,
  type OnMove,
  type OnMoveStart,
  type NodeChange,
  type OnMoveEnd,
  useReactFlow,
  useStore
} from '@xyflow/react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { Group as GroupIcon, Maximize2, Pencil, Search, Trash2, Ungroup, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import type { Measurable } from '@radix-ui/rect'
import type { CanvasComponent, CanvasDocument, CanvasGroup, ComponentType, FileEntry, Frame } from '@shared/schema'
import type { PetAlertTarget } from '@shared/pet'
import { keyboardEventMatchesShortcut } from '@shared/keyboard-shortcuts'
import { notifyCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { stackedFileComponentPosition, type CanvasFileSource } from '../lib/file-component-factory'
import { fileName, getFilePreviewKind } from '../lib/file-types'
import type { MediaDimensions } from '../lib/media-frame'
import { isTerminalComponentLocked } from '../lib/terminal-lock'
import { useAppSettingsStore } from '../store/app-settings-store'
import { useCanvasStore } from '../store/canvas-store'
import { useI18n } from '../i18n'
import { CanvasGroupNode, type CanvasGroupFlowNode } from './canvas-group-node'
import { ComponentNode, type AtlasFlowNode } from './component-node'
import {
  componentDefinitionTitle,
  createComponentInputFromFileSource,
  getComponentDefinition,
  getCreatableComponentDefinitions,
  useComponentRegistryVersion
} from './registry'

type ComponentNodeCacheEntry = {
  canvasId: string
  canvasZoom?: number
  component: CanvasComponent
  isNodeDragging: boolean
  shouldAutoEdit: boolean
  parentGroupId?: string
  parentGroupX?: number
  parentGroupY?: number
  onRequestSelect?: (componentId: string) => void
  registryVersion: number
  node: AtlasFlowNode
}

export type CanvasFlowNode = AtlasFlowNode | CanvasGroupFlowNode

const BACKGROUND_IMAGE_BLUR_BLEED_MULTIPLIER = 3

function componentCanvasZoom(component: CanvasComponent, canvasZoom: number): number | undefined {
  return getComponentDefinition(component.type).usesCanvasZoom === true ? canvasZoom : undefined
}

type ScreenPosition = {
  x: number
  y: number
}

type PaneActivation = {
  screenPosition: ScreenPosition
  timestamp: number
}

type DuplicateSelectionResult = {
  componentIds: string[]
  groupIds: string[]
}

type DragDuplicateState = {
  componentIds: string[]
  groupIds: string[]
  sourceParentPositionsByComponentId: Map<string, { x: number; y: number }>
}

const nodeTypes = {
  atlasComponent: ComponentNode,
  atlasGroup: CanvasGroupNode
}

const NODE_FOCUS_DURATION = 180
const NODE_FOCUS_ZOOM = 1.15
const OPEN_KANBAN_CARD_EVENT = 'atlas:open-kanban-card'
const CANVAS_INTERACTIVE_SHORTCUT_BLOCKLIST_SELECTORS = [
  'input',
  'textarea',
  'select',
  'button',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  '.cm-editor',
  '.xterm',
  '.dialog-content',
  '.popover-content',
  '.menu-content',
  '.top-bar'
]
const CANVAS_SHORTCUT_BLOCKLIST_SELECTOR = [...CANVAS_INTERACTIVE_SHORTCUT_BLOCKLIST_SELECTORS, '.component-node__body'].join(',')
const CANVAS_FIND_SHORTCUT_BLOCKLIST_SELECTOR = CANVAS_INTERACTIVE_SHORTCUT_BLOCKLIST_SELECTORS.join(',')
const CANVAS_DESELECT_SHORTCUT_BLOCKLIST_SELECTOR = [
  '.component-node__title-input',
  '.dialog-content',
  '.popover-content',
  '.menu-content',
  '.top-bar'
].join(',')
// Middle and right mouse buttons keep viewport panning; left drag is reserved for marquee selection.
const CANVAS_PAN_MOUSE_BUTTONS = [1, 2]
const CANVAS_CREATE_DOUBLE_CLICK_INTERVAL_MS = 500
const CANVAS_CREATE_DOUBLE_CLICK_DISTANCE_PX = 8

function componentToNode(
  canvasId: string,
  component: CanvasComponent,
  registryVersion = 0,
  onRequestSelect?: (componentId: string) => void,
  parentGroup?: CanvasGroup,
  canvasZoom = 1,
  isNodeDragging = false,
  shouldAutoEdit = false,
  onAutoEditHandled?: (componentId: string) => void
): AtlasFlowNode {
  const isLockedTerminal = isTerminalComponentLocked(component)
  const dataCanvasZoom = componentCanvasZoom(component, canvasZoom)
  const position = parentGroup
    ? {
        x: component.frame.x - parentGroup.frame.x,
        y: component.frame.y - parentGroup.frame.y
      }
    : { x: component.frame.x, y: component.frame.y }

  return {
    id: component.id,
    type: 'atlasComponent',
    parentId: parentGroup?.id,
    position,
    initialWidth: component.frame.width,
    initialHeight: component.frame.height,
    width: component.frame.width,
    height: component.frame.height,
    measured: { width: component.frame.width, height: component.frame.height },
    draggable: !isLockedTerminal,
    zIndex: component.zIndex,
    data: {
      canvasId,
      canvasZoom: dataCanvasZoom,
      component,
      autoEditComponentId: shouldAutoEdit ? component.id : null,
      isFrameLocked: isLockedTerminal,
      isNodeDragging,
      onAutoEditHandled,
      parentGroupPosition: parentGroup ? { x: parentGroup.frame.x, y: parentGroup.frame.y } : undefined,
      onRequestSelect,
      registryVersion
    },
    style: {
      width: component.frame.width,
      height: component.frame.height
    }
  }
}

function cachedComponentToNode(
  cache: Map<string, ComponentNodeCacheEntry>,
  canvasId: string,
  component: CanvasComponent,
  registryVersion: number,
  onRequestSelect?: (componentId: string) => void,
  parentGroup?: CanvasGroup,
  canvasZoom = 1,
  isNodeDragging = false,
  shouldAutoEdit = false,
  onAutoEditHandled?: (componentId: string) => void
): AtlasFlowNode {
  const cached = cache.get(component.id)
  const dataCanvasZoom = componentCanvasZoom(component, canvasZoom)
  if (
    cached?.canvasId === canvasId &&
    cached.canvasZoom === dataCanvasZoom &&
    cached.component === component &&
    cached.isNodeDragging === isNodeDragging &&
    cached.shouldAutoEdit === shouldAutoEdit &&
    cached.parentGroupId === parentGroup?.id &&
    cached.parentGroupX === parentGroup?.frame.x &&
    cached.parentGroupY === parentGroup?.frame.y &&
    cached.onRequestSelect === onRequestSelect &&
    cached.registryVersion === registryVersion
  ) {
    return cached.node
  }

  const node = componentToNode(
    canvasId,
    component,
    registryVersion,
    onRequestSelect,
    parentGroup,
    canvasZoom,
    isNodeDragging,
    shouldAutoEdit,
    onAutoEditHandled
  )
  cache.set(component.id, {
    canvasId,
    canvasZoom: dataCanvasZoom,
    component,
    isNodeDragging,
    shouldAutoEdit,
    parentGroupId: parentGroup?.id,
    parentGroupX: parentGroup?.frame.x,
    parentGroupY: parentGroup?.frame.y,
    onRequestSelect,
    registryVersion,
    node
  })
  return node
}

function groupToNode(canvasId: string, group: CanvasGroup): CanvasGroupFlowNode {
  return {
    id: group.id,
    type: 'atlasGroup',
    position: { x: group.frame.x, y: group.frame.y },
    initialWidth: group.frame.width,
    initialHeight: group.frame.height,
    width: group.frame.width,
    height: group.frame.height,
    measured: { width: group.frame.width, height: group.frame.height },
    zIndex: group.zIndex,
    data: { canvasId, group },
    style: {
      width: group.frame.width,
      height: group.frame.height
    }
  }
}

function reconcileFlowNodes(nextNodes: CanvasFlowNode[], currentNodes: CanvasFlowNode[]): CanvasFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]))

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id)
    if (!currentNode) return nextNode
    const measured =
      currentNode.measured?.width !== undefined && currentNode.measured.height !== undefined
        ? currentNode.measured
        : nextNode.measured

    if (
      currentNode.type === nextNode.type &&
      currentNode.position.x === nextNode.position.x &&
      currentNode.position.y === nextNode.position.y &&
      currentNode.initialWidth === nextNode.initialWidth &&
      currentNode.initialHeight === nextNode.initialHeight &&
      currentNode.width === nextNode.width &&
      currentNode.height === nextNode.height &&
      currentNode.zIndex === nextNode.zIndex &&
      currentNode.data === nextNode.data &&
      currentNode.style === nextNode.style &&
      currentNode.measured === measured
    ) {
      return currentNode
    }

    return {
      ...currentNode,
      ...nextNode,
      selected: currentNode.selected,
      dragging: currentNode.dragging,
      resizing: currentNode.resizing,
      measured
    }
  })
}

function selectedNodeIds(nodes: CanvasFlowNode[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id)
}

function unselectNodeIds(nodes: CanvasFlowNode[], nodeIds: Set<string>): CanvasFlowNode[] {
  if (nodeIds.size === 0) return nodes

  let didChange = false
  const nextNodes = nodes.map((node) => {
    if (!node.selected || !nodeIds.has(node.id)) return node

    didChange = true
    return { ...node, selected: false }
  })

  return didChange ? nextNodes : nodes
}

function selectOnlyNode(nodes: CanvasFlowNode[], nodeId: string): CanvasFlowNode[] {
  return selectOnlyNodeIds(nodes, new Set([nodeId]))
}

function selectOnlyNodeIds(nodes: CanvasFlowNode[], nodeIds: Set<string>): CanvasFlowNode[] {
  let didChange = false
  const nextNodes = nodes.map((node) => {
    const shouldSelect = nodeIds.has(node.id)
    const isSelected = node.selected === true
    if (isSelected === shouldSelect) return node

    didChange = true
    return { ...node, selected: shouldSelect }
  })

  return didChange ? nextNodes : nodes
}

function nodeZIndex(node: CanvasFlowNode): number {
  return typeof node.zIndex === 'number' ? node.zIndex : 0
}

function elevateNodeIds(nodes: CanvasFlowNode[], nodeIds: Set<string>): CanvasFlowNode[] {
  if (nodeIds.size === 0) return nodes

  const elevatedNodes = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => nodeIds.has(node.id))
    .sort((first, second) => nodeZIndex(first.node) - nodeZIndex(second.node) || first.index - second.index)

  if (elevatedNodes.length === 0) return nodes

  const nextZIndexes = new Map<string, number>()
  let nextZIndex = nodes.reduce((max, node) => Math.max(max, nodeZIndex(node)), 0) + 1

  for (const { node } of elevatedNodes) {
    nextZIndexes.set(node.id, nextZIndex)
    nextZIndex += 1
  }

  return nodes.map((node) => {
    const zIndex = nextZIndexes.get(node.id)
    return zIndex === undefined ? node : { ...node, zIndex }
  })
}

function splitNodeIds(nodeIds: string[], groups: CanvasGroup[]): { componentIds: string[]; groupIds: string[] } {
  const groupIds = new Set(groups.map((group) => group.id))
  return {
    componentIds: nodeIds.filter((nodeId) => !groupIds.has(nodeId)),
    groupIds: nodeIds.filter((nodeId) => groupIds.has(nodeId))
  }
}

function lockedTerminalComponentIds(components: CanvasComponent[]): Set<string> {
  return new Set(components.filter(isTerminalComponentLocked).map((component) => component.id))
}

function unlockedComponentIds(componentIds: string[], components: CanvasComponent[]): string[] {
  const lockedIds = lockedTerminalComponentIds(components)
  return componentIds.filter((componentId) => !lockedIds.has(componentId))
}

function duplicatedNodeIdMap(
  canvas: CanvasDocument,
  componentIds: string[],
  groupIds: string[],
  duplicated: DuplicateSelectionResult
): Map<string, string> {
  const result = new Map<string, string>()
  const requestedGroupIds = new Set(groupIds)
  const requestedComponentIds = new Set(componentIds)
  const componentIdsInCanvas = new Set(canvas.components.map((component) => component.id))
  const groupsToDuplicate = canvas.groups.filter((group) => requestedGroupIds.has(group.id))
  const groupedMemberIds = new Set(groupsToDuplicate.flatMap((group) => group.memberIds))
  let duplicatedComponentIndex = 0

  groupsToDuplicate.forEach((group, index) => {
    const duplicatedGroupId = duplicated.groupIds[index]
    if (duplicatedGroupId) result.set(group.id, duplicatedGroupId)

    for (const memberId of group.memberIds) {
      if (!componentIdsInCanvas.has(memberId)) continue

      const duplicatedComponentId = duplicated.componentIds[duplicatedComponentIndex]
      duplicatedComponentIndex += 1
      if (duplicatedComponentId) result.set(memberId, duplicatedComponentId)
    }
  })

  for (const component of canvas.components) {
    if (!requestedComponentIds.has(component.id) || groupedMemberIds.has(component.id)) continue

    const duplicatedComponentId = duplicated.componentIds[duplicatedComponentIndex]
    duplicatedComponentIndex += 1
    if (duplicatedComponentId) result.set(component.id, duplicatedComponentId)
  }

  return result
}

function groupById(groups: CanvasGroup[]): Map<string, CanvasGroup> {
  return new Map(groups.map((group) => [group.id, group]))
}

function groupByMemberId(groups: CanvasGroup[]): Map<string, CanvasGroup> {
  const sortedGroups = groups
    .map((group, index) => ({ group, index }))
    .sort((first, second) => first.group.zIndex - second.group.zIndex || first.index - second.index)
  const groupsByMember = new Map<string, CanvasGroup>()

  for (const { group } of sortedGroups) {
    for (const memberId of group.memberIds) {
      groupsByMember.set(memberId, group)
    }
  }

  return groupsByMember
}

function movingComponentIdsForNodes(nodeIds: string[], groups: CanvasGroup[]): Set<string> {
  const { componentIds, groupIds } = splitNodeIds(nodeIds, groups)
  const groupsById = groupById(groups)
  const result = new Set(componentIds)

  for (const groupId of groupIds) {
    const group = groupsById.get(groupId)
    if (!group) continue

    for (const memberId of group.memberIds) {
      result.add(memberId)
    }
  }

  return result
}

function absoluteNodePosition(node: CanvasFlowNode, parentPosition: { x: number; y: number } | undefined): { x: number; y: number } {
  if (!parentPosition) {
    return {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y)
    }
  }

  return {
    x: Math.round(parentPosition.x + node.position.x),
    y: Math.round(parentPosition.y + node.position.y)
  }
}

function frameCenter(frame: Frame): { x: number; y: number } {
  return {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2
  }
}

function closestFlowNodeId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null

  return target.closest<HTMLElement>('.react-flow__node[data-id]')?.dataset.id ?? null
}

function isSelectedNodeTarget(target: EventTarget | null, selectedNodeIds: Set<string>): boolean {
  const flowNodeId = closestFlowNodeId(target)
  return Boolean(flowNodeId && selectedNodeIds.has(flowNodeId))
}

function isCanvasShortcutBlocked(
  target: EventTarget | null,
  selectedNodeIds: Set<string>,
  shortcut: 'create' | 'delete' | 'deselect' | 'duplicate' | 'find'
): boolean {
  if (shortcut === 'find') {
    return target instanceof Element && Boolean(target.closest(CANVAS_FIND_SHORTCUT_BLOCKLIST_SELECTOR))
  }
  if (shortcut === 'deselect' && isSelectedNodeTarget(target, selectedNodeIds)) {
    return target instanceof Element && Boolean(target.closest(CANVAS_DESELECT_SHORTCUT_BLOCKLIST_SELECTOR))
  }

  return target instanceof Element && Boolean(target.closest(CANVAS_SHORTCUT_BLOCKLIST_SELECTOR))
}

function focusFlowNodeElement(componentId: string): void {
  const nodeElement = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')).find(
    (element) => element.dataset.id === componentId
  )

  nodeElement?.focus({ preventScroll: true })
}

function dispatchOpenKanbanCard(target: PetAlertTarget): void {
  if (!target.componentId || !target.cardId) return

  window.requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent(OPEN_KANBAN_CARD_EVENT, { detail: target }))
  })
}

type DroppedCanvasFile = CanvasFileSource

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

async function measureImageFileDimensions(file: File): Promise<MediaDimensions | null> {
  if (typeof createImageBitmap !== 'function') return null

  try {
    const bitmap = await createImageBitmap(file)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return dimensions
  } catch {
    return null
  }
}

async function measureExternalMediaDimensions(file: File, droppedFile: DroppedCanvasFile): Promise<MediaDimensions | null> {
  const previewKind = getFilePreviewKind(droppedFile.name || droppedFile.path, droppedFile.mimeType)
  if (previewKind === 'image') return measureImageFileDimensions(file)
  return null
}

function parseAtlasDroppedFile(raw: string): DroppedCanvasFile | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value)) return null

    const path = optionalString(value.path)
    const name = optionalString(value.name)
    const kind = value.kind === 'directory' ? 'directory' : value.kind === 'file' ? 'file' : null

    if (!path || !name || !kind) return null

    return {
      path,
      name,
      kind,
      rootPath: optionalString(value.rootPath),
      mimeType: optionalString(value.mimeType)
    }
  } catch {
    return null
  }
}

function isSupportedDrop(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types)
  return types.includes('application/atlas-file') || types.includes('Files')
}

async function describeExternalFile(file: File): Promise<DroppedCanvasFile | null> {
  const path = window.atlas.filesystem.getPathForFile(file).trim()
  if (!path) return null

  try {
    const entry = (await window.atlas.filesystem.listTree(path, path, 0)) as FileEntry
    const droppedFile: DroppedCanvasFile = {
      path: entry.path,
      name: file.name || fileName(entry.path) || entry.name,
      kind: entry.kind,
      rootPath: entry.path,
      mimeType: optionalString(file.type)
    }
    return {
      ...droppedFile,
      mediaDimensions: entry.kind === 'file' ? (await measureExternalMediaDimensions(file, droppedFile)) ?? undefined : undefined
    }
  } catch {
    const droppedFile: DroppedCanvasFile = {
      path,
      name: file.name || fileName(path),
      kind: 'file',
      rootPath: path,
      mimeType: optionalString(file.type)
    }
    return {
      ...droppedFile,
      mediaDimensions: (await measureExternalMediaDimensions(file, droppedFile)) ?? undefined
    }
  }
}

async function droppedFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<DroppedCanvasFile[]> {
  const atlasFile = parseAtlasDroppedFile(dataTransfer.getData('application/atlas-file'))
  if (atlasFile) return [atlasFile]

  const files = await Promise.all(Array.from(dataTransfer.files).map((file) => describeExternalFile(file)))
  return files.filter((file): file is DroppedCanvasFile => Boolean(file))
}

type CanvasCreateMenuState = {
  flowPosition: { x: number; y: number }
}

type PendingGroupDeleteRequest = {
  componentIds: string[]
  groupIds: string[]
}

function createPointRect(x: number, y: number): DOMRect {
  return {
    x,
    y,
    width: 0,
    height: 0,
    top: y,
    right: x,
    bottom: y,
    left: x,
    toJSON: () => ({ x, y, width: 0, height: 0, top: y, right: x, bottom: y, left: x })
  } as DOMRect
}

function createPointAnchor(x: number, y: number): Measurable {
  return {
    getBoundingClientRect: () => createPointRect(x, y)
  }
}

function isDoubleClickPaneActivation(previous: PaneActivation | null, current: PaneActivation): boolean {
  if (!previous) return false

  const elapsedMs = current.timestamp - previous.timestamp
  if (elapsedMs < 0 || elapsedMs > CANVAS_CREATE_DOUBLE_CLICK_INTERVAL_MS) return false

  const distancePx = Math.hypot(
    current.screenPosition.x - previous.screenPosition.x,
    current.screenPosition.y - previous.screenPosition.y
  )

  return distancePx <= CANVAS_CREATE_DOUBLE_CLICK_DISTANCE_PX
}

function CanvasCreateMenu({
  anchorRef,
  open,
  onClose,
  onCreate
}: {
  anchorRef: RefObject<Measurable>
  open: boolean
  onClose: () => void
  onCreate: (type: ComponentType) => void
}): JSX.Element {
  const { t } = useI18n()
  const creatableDefinitions = getCreatableComponentDefinitions()
  const [activeType, setActiveType] = useState<ComponentType>(creatableDefinitions[0]?.type ?? '')

  useEffect(() => {
    if (open) setActiveType(getCreatableComponentDefinitions()[0]?.type ?? '')
  }, [open])

  return (
    <Popover.Root open={open} modal={false} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Popover.Anchor virtualRef={anchorRef} />
      <Popover.Portal>
        <Popover.Content
          className="menu-content canvas-create-menu"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          role="menu"
          aria-label={t('canvas.createComponent')}
        >
          {creatableDefinitions.map((definition) => {
            const type = definition.type
            const Icon = definition.icon
            const title = componentDefinitionTitle(definition, t)

            return (
              <button
                key={type}
                type="button"
                className={[
                  'menu-item',
                  'canvas-create-menu__item',
                  activeType === type ? 'menu-item--active canvas-create-menu__item--active' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                role="menuitem"
                onFocus={() => setActiveType(type)}
                onMouseEnter={() => setActiveType(type)}
                onClick={() => onCreate(type)}
              >
                <Icon size={14} />
                <span>{title}</span>
              </button>
            )
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function CanvasZoomControls({ hasNodes }: { hasNodes: boolean }): JSX.Element {
  const { t } = useI18n()
  const reactFlow = useReactFlow<CanvasFlowNode>()
  const zoom = useStore((state) => state.transform[2])
  const zoomPercent = Math.round(zoom * 100)

  const notifyAfterViewportAction = useCallback((action: Promise<boolean>) => {
    void action
      .then(() => notifyCanvasViewportSync(typeof reactFlow.getViewport === 'function' ? reactFlow.getViewport() : undefined))
      .catch(() => undefined)
  }, [reactFlow])

  const zoomOut = useCallback(() => {
    notifyAfterViewportAction(reactFlow.zoomOut({ duration: 140, interpolate: 'linear' }))
  }, [notifyAfterViewportAction, reactFlow])

  const zoomIn = useCallback(() => {
    notifyAfterViewportAction(reactFlow.zoomIn({ duration: 140, interpolate: 'linear' }))
  }, [notifyAfterViewportAction, reactFlow])

  const fitView = useCallback(() => {
    if (!hasNodes) return
    notifyAfterViewportAction(reactFlow.fitView({ duration: 160, padding: 0.12 }))
  }, [hasNodes, notifyAfterViewportAction, reactFlow])

  return (
    <Panel position="bottom-right" className="canvas-zoom-controls" style={{ right: 15, bottom: 15, margin: 0 }}>
      <button type="button" className="canvas-panel-button" onClick={zoomOut} aria-label={t('canvas.zoomOut')} title={t('canvas.zoomOut')}>
        <ZoomOut size={16} />
      </button>
      <div className="canvas-zoom-level" aria-live="polite">
        {zoomPercent}%
      </div>
      <button
        type="button"
        className="canvas-panel-button"
        onClick={fitView}
        disabled={!hasNodes}
        aria-label={t('canvas.fitView')}
        title={t('canvas.fitView')}
      >
        <Maximize2 size={16} />
      </button>
      <button type="button" className="canvas-panel-button" onClick={zoomIn} aria-label={t('canvas.zoomIn')} title={t('canvas.zoomIn')}>
        <ZoomIn size={16} />
      </button>
    </Panel>
  )
}

function nodeFinderKeywords(component: CanvasComponent, localizedDefinitionTitle: string): string[] {
  const definition = getComponentDefinition(component.type)
  const detail = nodeFinderDetail(component)
  const pluginTokens = definition.getSearchTokens?.(component) ?? []

  return [
    component.title,
    localizedDefinitionTitle,
    definition.title,
    component.type,
    detail,
    optionalString(component.bindings.path),
    optionalString(component.bindings.rootPath),
    optionalString(component.config.rootPath),
    optionalString(component.config.cwd),
    optionalString(component.state.cwd),
    ...pluginTokens
  ].filter((value): value is string => Boolean(value))
}

function nodeFinderDetail(component: CanvasComponent): string | null {
  return getComponentDefinition(component.type).getDetail?.(component) ?? null
}

function groupFinderKeywords(group: CanvasGroup, groupLabel: string): string[] {
  return [group.title, group.notes, groupLabel, 'group'].filter((value): value is string => Boolean(value))
}

function CanvasNodeFinder({
  open,
  components,
  groups,
  onOpenChange,
  onSelect
}: {
  open: boolean
  components: CanvasComponent[]
  groups: CanvasGroup[]
  onOpenChange: (open: boolean) => void
  onSelect: (result: { type: 'component' | 'group'; id: string }) => void
}): JSX.Element {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const scrollResetFrameRef = useRef<number | null>(null)
  const hasItems = components.length > 0 || groups.length > 0

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

  useLayoutEffect(() => {
    if (!open) return undefined

    const resetScroll = (): void => {
      if (listRef.current) listRef.current.scrollTop = 0
    }

    resetScroll()
    scrollResetFrameRef.current = window.requestAnimationFrame(() => {
      scrollResetFrameRef.current = null
      resetScroll()
    })

    return () => {
      if (scrollResetFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollResetFrameRef.current)
        scrollResetFrameRef.current = null
      }
    }
  }, [open, search])

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t('canvas.findCanvasNode')}
      loop
      overlayClassName="dialog-overlay node-finder-overlay"
      contentClassName="dialog-content node-finder"
    >
      <Dialog.Title className="sr-only">{t('canvas.findCanvasNode')}</Dialog.Title>
      <Dialog.Description className="sr-only">{t('canvas.findCanvasNodeDescription')}</Dialog.Description>
      <div className="node-finder__search">
        <Search size={16} aria-hidden="true" />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder={t('canvas.findNodes')}
          aria-label={t('canvas.findNodes')}
        />
      </div>
      <Command.List ref={listRef} className="node-finder__list" label={t('canvas.nodeListLabel')}>
        <Command.Empty className="node-finder__empty">
          {!hasItems ? t('canvas.noNodes') : t('canvas.noMatchingNodes')}
        </Command.Empty>
        {groups.length > 0 ? (
          <Command.Group heading={t('canvas.groups')}>
            {groups.map((group) => {
              const detail = group.notes.split(/\r?\n/).find((line) => line.trim())?.trim() ?? null

              return (
                <Command.Item
                  key={group.id}
                  className="node-finder__item"
                  value={`group:${group.id}`}
                  keywords={groupFinderKeywords(group, t('canvas.groups'))}
                  onSelect={() => onSelect({ type: 'group', id: group.id })}
                >
                  <span className="node-finder__item-icon" aria-hidden="true">
                    <GroupIcon size={16} />
                  </span>
                  <span className="node-finder__item-main">
                    <span className="node-finder__item-title">{group.title}</span>
                    <span className="node-finder__item-type">{t('canvas.group')}</span>
                    {detail ? <span className="node-finder__item-detail">{detail}</span> : null}
                  </span>
                </Command.Item>
              )
            })}
          </Command.Group>
        ) : null}
        <Command.Group heading={t('canvas.nodes')}>
          {components.map((component) => {
            const definition = getComponentDefinition(component.type)
            const Icon = definition.icon
            const detail = nodeFinderDetail(component)
            const definitionTitle = componentDefinitionTitle(definition, t)

            return (
              <Command.Item
                key={component.id}
                className="node-finder__item"
                value={`component:${component.id}`}
                keywords={nodeFinderKeywords(component, definitionTitle)}
                onSelect={() => onSelect({ type: 'component', id: component.id })}
              >
                <span className="node-finder__item-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="node-finder__item-main">
                  <span className="node-finder__item-title">{component.title}</span>
                  <span className="node-finder__item-type">{definitionTitle}</span>
                  {detail ? <span className="node-finder__item-detail">{detail}</span> : null}
                </span>
              </Command.Item>
            )
          })}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}

function CanvasSelectionToolbar({
  selectedComponentCount,
  selectedGroupCount,
  onCreateGroup,
  onEditGroup,
  onUngroup,
  onDeleteGroups
}: {
  selectedComponentCount: number
  selectedGroupCount: number
  onCreateGroup: () => void
  onEditGroup: () => void
  onUngroup: () => void
  onDeleteGroups: () => void
}): JSX.Element | null {
  const { t } = useI18n()
  const canCreateGroup = selectedComponentCount >= 2
  const hasGroupActions = selectedGroupCount > 0
  if (!canCreateGroup && !hasGroupActions) return null

  return (
    <Panel position="top-center" className="canvas-selection-toolbar" style={{ top: 14, margin: 0 }}>
      <button
        type="button"
        className="canvas-panel-button"
        disabled={!canCreateGroup}
        onClick={onCreateGroup}
        aria-label={t('canvas.groupSelection')}
        title={t('canvas.groupSelection')}
      >
        <GroupIcon size={15} />
      </button>
      <button
        type="button"
        className="canvas-panel-button"
        disabled={selectedGroupCount !== 1}
        onClick={onEditGroup}
        aria-label={t('canvas.editGroup')}
        title={t('canvas.editGroup')}
      >
        <Pencil size={15} />
      </button>
      <button
        type="button"
        className="canvas-panel-button"
        disabled={selectedGroupCount === 0}
        onClick={onUngroup}
        aria-label={t('canvas.ungroupSelection')}
        title={t('canvas.ungroupSelection')}
      >
        <Ungroup size={15} />
      </button>
      <button
        type="button"
        className="canvas-panel-button canvas-panel-button--danger"
        disabled={selectedGroupCount === 0}
        onClick={onDeleteGroups}
        aria-label={t('canvas.deleteGroup')}
        title={t('canvas.deleteGroup')}
      >
        <Trash2 size={15} />
      </button>
    </Panel>
  )
}

function CanvasGroupEditDialog({
  group,
  onClose,
  onSave
}: {
  group: CanvasGroup | null
  onClose: () => void
  onSave: (groupId: string, patch: { title: string; notes: string }) => void
}): JSX.Element {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    setTitle(group?.title ?? '')
    setNotes(group?.notes ?? '')
  }, [group])

  const save = useCallback(() => {
    if (!group) return
    onSave(group.id, { title, notes })
  }, [group, notes, onSave, title])

  return (
    <Dialog.Root open={Boolean(group)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content canvas-group-dialog">
          <Dialog.Title className="dialog-title">{t('canvas.editGroup')}</Dialog.Title>
          <Dialog.Description className="dialog-description">{t('canvas.editGroupDescription')}</Dialog.Description>
          <label className="canvas-group-dialog__field">
            <span>{t('canvas.groupTitle')}</span>
            <input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
          </label>
          <label className="canvas-group-dialog__field">
            <span>{t('canvas.groupNotes')}</span>
            <textarea value={notes} rows={6} onChange={(event) => setNotes(event.currentTarget.value)} />
          </label>
          <div className="dialog-actions">
            <button type="button" className="tool-button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="primary-button" onClick={save}>
              {t('common.save')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CanvasGroupDeleteDialog({
  count,
  open,
  onCancel,
  onDeleteMembers,
  onRemoveOnly
}: {
  count: number
  open: boolean
  onCancel: () => void
  onDeleteMembers: () => void
  onRemoveOnly: () => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title className="dialog-title">{t('canvas.deleteGroupTitle')}</Dialog.Title>
          <Dialog.Description className="dialog-description">{t('canvas.deleteGroupDescription', { count })}</Dialog.Description>
          <div className="dialog-actions canvas-group-delete-actions">
            <button type="button" className="tool-button" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button type="button" className="tool-button" onClick={onRemoveOnly}>
              {t('canvas.removeGroupOnly')}
            </button>
            <button type="button" className="tool-button danger" onClick={onDeleteMembers}>
              {t('canvas.deleteGroupAndMembers')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function CanvasBoard(): JSX.Element {
  const reactFlow = useReactFlow<CanvasFlowNode>()
  const componentRegistryVersion = useComponentRegistryVersion()
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvases = useCanvasStore((state) => state.canvases)
  const canvas = useCanvasStore((state) => (state.activeCanvasId ? state.canvases[state.activeCanvasId] : null))
  const setActiveCanvas = useCanvasStore((state) => state.setActiveCanvas)
  const updateCanvas = useCanvasStore((state) => state.updateCanvas)
  const updateComponentFrames = useCanvasStore((state) => state.updateComponentFrames)
  const addComponent = useCanvasStore((state) => state.addComponent)
  const addComponents = useCanvasStore((state) => state.addComponents)
  const duplicateSelection = useCanvasStore((state) => state.duplicateSelection)
  const removeComponents = useCanvasStore((state) => state.removeComponents)
  const bringToFront = useCanvasStore((state) => state.bringToFront)
  const bringNodesToFront = useCanvasStore((state) => state.bringNodesToFront)
  const createGroup = useCanvasStore((state) => state.createGroup)
  const updateGroup = useCanvasStore((state) => state.updateGroup)
  const moveGroup = useCanvasStore((state) => state.moveGroup)
  const ungroupGroups = useCanvasStore((state) => state.ungroupGroups)
  const removeGroups = useCanvasStore((state) => state.removeGroups)
  const deleteGroupsWithMembers = useCanvasStore((state) => state.deleteGroupsWithMembers)
  const bringGroupToFront = useCanvasStore((state) => state.bringGroupToFront)
  const beginCanvasInteraction = useCanvasStore((state) => state.beginCanvasInteraction)
  const endCanvasInteraction = useCanvasStore((state) => state.endCanvasInteraction)
  const shortcuts = useAppSettingsStore((state) => state.settings.shortcuts)
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(() =>
    canvas
      ? [
          ...(canvas.groups ?? []).map((group) => groupToNode(canvas.id, group)),
          ...canvas.components.map((component) => componentToNode(canvas.id, component, componentRegistryVersion, undefined, undefined, canvas.viewport.zoom))
        ]
      : []
  )
  const [createMenu, setCreateMenu] = useState<CanvasCreateMenuState | null>(null)
  const [isNodeFinderOpen, setIsNodeFinderOpen] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [pendingGroupDelete, setPendingGroupDelete] = useState<PendingGroupDeleteRequest | null>(null)
  const [isFileDragActive, setIsFileDragActive] = useState(false)
  const [isViewportInteracting, setIsViewportInteracting] = useState(false)
  const [autoEditComponentId, setAutoEditComponentId] = useState<string | null>(null)
  const [draggingNodeIds, setDraggingNodeIds] = useState<Set<string>>(() => new Set())
  const createMenuAnchorRef = useRef<Measurable>(createPointAnchor(0, 0))
  const canvasBoardRef = useRef<HTMLElement | null>(null)
  const lastPointerScreenPositionRef = useRef<ScreenPosition | null>(null)
  const lastPaneActivationRef = useRef<PaneActivation | null>(null)
  const pendingSelectedNodeIdsRef = useRef<Set<string> | null>(null)
  const pendingPetTargetRef = useRef<PetAlertTarget | null>(null)
  const componentNodeCacheRef = useRef(new Map<string, ComponentNodeCacheEntry>())
  const focusNodeFrameRef = useRef<number | null>(null)
  const dragDuplicateStateRef = useRef<DragDuplicateState | null>(null)
  const nodeDragInteractionActiveRef = useRef(false)
  const viewportInteractionActiveRef = useRef(false)

  useEffect(() => {
    return () => {
      dragDuplicateStateRef.current = null
      if (focusNodeFrameRef.current !== null) {
        window.cancelAnimationFrame(focusNodeFrameRef.current)
      }
      if (nodeDragInteractionActiveRef.current) {
        nodeDragInteractionActiveRef.current = false
        endCanvasInteraction()
      }
      if (viewportInteractionActiveRef.current) {
        viewportInteractionActiveRef.current = false
        endCanvasInteraction()
      }
    }
  }, [endCanvasInteraction])

  const finishNodeDragInteraction = useCallback(() => {
    setDraggingNodeIds((currentIds) => (currentIds.size === 0 ? currentIds : new Set()))
    if (!nodeDragInteractionActiveRef.current) return

    nodeDragInteractionActiveRef.current = false
    endCanvasInteraction()
  }, [endCanvasInteraction])

  const finishViewportInteraction = useCallback(() => {
    if (!viewportInteractionActiveRef.current) return

    viewportInteractionActiveRef.current = false
    setIsViewportInteracting(false)
    endCanvasInteraction()
  }, [endCanvasInteraction])

  const selectComponentForContextMenu = useCallback(
    (componentId: string) => {
      if (!activeCanvasId) return

      setNodes((currentNodes) => selectOnlyNode(currentNodes, componentId))
      bringToFront(activeCanvasId, componentId)
      notifyCanvasViewportSync()
    },
    [activeCanvasId, bringToFront]
  )

  const clearAutoEditComponentId = useCallback((componentId: string) => {
    setAutoEditComponentId((currentId) => (currentId === componentId ? null : currentId))
  }, [])

  const persistedNodes = useMemo(() => {
    const cache = componentNodeCacheRef.current
    if (!canvas) {
      cache.clear()
      return []
    }

    const liveComponentIds = new Set<string>()
    const groups = canvas.groups ?? []
    const memberGroups = groupByMemberId(groups)
    const draggingComponentIds = movingComponentIdsForNodes([...draggingNodeIds], groups)
    for (const componentId of lockedTerminalComponentIds(canvas.components)) {
      draggingComponentIds.delete(componentId)
    }
    const nextComponentNodes = canvas.components.map((component) => {
      liveComponentIds.add(component.id)
      return cachedComponentToNode(
        cache,
        canvas.id,
        component,
        componentRegistryVersion,
        selectComponentForContextMenu,
        memberGroups.get(component.id),
        canvas.viewport.zoom,
        draggingComponentIds.has(component.id),
        autoEditComponentId === component.id,
        clearAutoEditComponentId
      )
    })

    for (const [componentId, cached] of cache) {
      if (cached.canvasId !== canvas.id || !liveComponentIds.has(componentId)) {
        cache.delete(componentId)
      }
    }

    const nextNodes = [
      ...groups.map((group) => groupToNode(canvas.id, group)),
      ...nextComponentNodes
    ]

    return draggingNodeIds.size > 0 ? elevateNodeIds(nextNodes, draggingNodeIds) : nextNodes
  }, [autoEditComponentId, canvas, clearAutoEditComponentId, componentRegistryVersion, draggingNodeIds, selectComponentForContextMenu])

  useLayoutEffect(() => {
    setNodes((currentNodes) => {
      const reconciledNodes = reconcileFlowNodes(persistedNodes, currentNodes)
      const pendingSelectedNodeIds = pendingSelectedNodeIdsRef.current

      if (!pendingSelectedNodeIds) return reconciledNodes

      pendingSelectedNodeIdsRef.current = null
      return selectOnlyNodeIds(reconciledNodes, pendingSelectedNodeIds)
    })
  }, [persistedNodes])

  useEffect(() => {
    if (!autoEditComponentId || canvas?.components.some((component) => component.id === autoEditComponentId)) return
    setAutoEditComponentId(null)
  }, [autoEditComponentId, canvas?.components])

  const closeCreateMenu = useCallback(() => {
    setCreateMenu((currentMenu) => (currentMenu ? null : currentMenu))
  }, [])

  const trackPointerPosition = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType && event.pointerType !== 'mouse') return
    lastPointerScreenPositionRef.current = { x: event.clientX, y: event.clientY }
  }, [])

  const clearTrackedPointerPosition = useCallback(() => {
    lastPointerScreenPositionRef.current = null
  }, [])

  const openCreateMenuAtScreenPosition = useCallback(
    (screenPosition: ScreenPosition) => {
      const flowPosition = reactFlow.screenToFlowPosition(screenPosition)
      createMenuAnchorRef.current = createPointAnchor(screenPosition.x, screenPosition.y)
      setCreateMenu({
        flowPosition: { x: Math.round(flowPosition.x), y: Math.round(flowPosition.y) }
      })
    },
    [reactFlow]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const lockedIds = lockedTerminalComponentIds(canvas?.components ?? [])
      const allowedChanges = changes.filter((change) => {
        if (change.type !== 'position' && change.type !== 'remove') return true
        return !lockedIds.has(change.id)
      })

      setNodes((currentNodes) => applyNodeChanges(allowedChanges, currentNodes))
      if (!activeCanvasId) return

      const removedNodeIds = allowedChanges.filter((change) => change.type === 'remove').map((change) => change.id)
      if (removedNodeIds.length > 0) {
        const removed = splitNodeIds(removedNodeIds, canvas?.groups ?? [])
        removeComponents(activeCanvasId, removed.componentIds)
        removeGroups(activeCanvasId, removed.groupIds)
        notifyCanvasViewportSync()
      }
    },
    [activeCanvasId, canvas?.groups, removeComponents, removeGroups]
  )

  const onNodeDragStart: OnNodeDrag<CanvasFlowNode> = useCallback(
    (event, node, draggedNodes) => {
      closeCreateMenu()
      const movingNodes = draggedNodes.length > 0 ? draggedNodes : [node]
      const lockedIds = lockedTerminalComponentIds(canvas?.components ?? [])
      const movingNodeIds = movingNodes.map((draggedNode) => draggedNode.id).filter((nodeId) => !lockedIds.has(nodeId))
      dragDuplicateStateRef.current = null
      if (movingNodeIds.length === 0) return
      setDraggingNodeIds(new Set(movingNodeIds))
      if (event.altKey && activeCanvasId && canvas) {
        const dragDuplicateState = splitNodeIds(movingNodeIds, canvas.groups ?? [])
        const memberGroups = groupByMemberId(canvas.groups ?? [])
        const sourceParentPositionsByComponentId = new Map<string, { x: number; y: number }>()

        for (const componentId of dragDuplicateState.componentIds) {
          const parentGroup = memberGroups.get(componentId)
          if (parentGroup) {
            sourceParentPositionsByComponentId.set(componentId, { x: parentGroup.frame.x, y: parentGroup.frame.y })
          }
        }

        dragDuplicateStateRef.current = {
          ...dragDuplicateState,
          sourceParentPositionsByComponentId
        }
      }
      setNodes((currentNodes) => elevateNodeIds(currentNodes, new Set(movingNodes.map((draggedNode) => draggedNode.id))))

      if (nodeDragInteractionActiveRef.current) return

      nodeDragInteractionActiveRef.current = true
      beginCanvasInteraction()
    },
    [activeCanvasId, beginCanvasInteraction, canvas, closeCreateMenu]
  )

  const onNodeDragStop: OnNodeDrag<CanvasFlowNode> = useCallback(
    (_, node, draggedNodes) => {
      const dragDuplicateState = dragDuplicateStateRef.current
      dragDuplicateStateRef.current = null

      try {
        const stoppedNodes = draggedNodes.length > 0 ? draggedNodes : [node]
        const stoppedNodeIds = new Set(stoppedNodes.map((draggedNode) => draggedNode.id))
        const shouldKeepDraggedSelection = stoppedNodeIds.size > 1 && !dragDuplicateState
        setNodes((currentNodes) => {
          return shouldKeepDraggedSelection ? currentNodes : unselectNodeIds(currentNodes, stoppedNodeIds)
        })

        if (!activeCanvasId || !canvas) return

        const lockedIds = lockedTerminalComponentIds(canvas.components)
        const movableStoppedNodes = stoppedNodes.filter((draggedNode) => !lockedIds.has(draggedNode.id))
        let canvasForPersistence = canvas
        let nodesForPersistence = movableStoppedNodes
        const sourceParentPositionsByDuplicateId = new Map<string, { x: number; y: number }>()
        let didDuplicateOnDrag = false

        if (dragDuplicateState && (dragDuplicateState.componentIds.length > 0 || dragDuplicateState.groupIds.length > 0)) {
          const duplicated = duplicateSelection(activeCanvasId, dragDuplicateState.componentIds, dragDuplicateState.groupIds)
          const sourceToDuplicateIds = duplicatedNodeIdMap(canvas, dragDuplicateState.componentIds, dragDuplicateState.groupIds, duplicated)
          for (const [sourceComponentId, sourceParentPosition] of dragDuplicateState.sourceParentPositionsByComponentId) {
            const duplicatedComponentId = sourceToDuplicateIds.get(sourceComponentId)
            if (duplicatedComponentId) sourceParentPositionsByDuplicateId.set(duplicatedComponentId, sourceParentPosition)
          }
          const duplicatedStoppedNodes = stoppedNodes
            .map((draggedNode) => {
              const duplicatedId = sourceToDuplicateIds.get(draggedNode.id)
              return duplicatedId ? { ...draggedNode, id: duplicatedId } : null
            })
            .filter((draggedNode): draggedNode is CanvasFlowNode => Boolean(draggedNode))

          if (duplicatedStoppedNodes.length === 0) return

          pendingSelectedNodeIdsRef.current = new Set(duplicatedStoppedNodes.map((draggedNode) => draggedNode.id))
          canvasForPersistence = useCanvasStore.getState().canvases[activeCanvasId] ?? canvas
          nodesForPersistence = duplicatedStoppedNodes
          didDuplicateOnDrag = true
        }

        const groups = canvasForPersistence.groups ?? []
        const groupsById = groupById(groups)
        const memberGroups = groupByMemberId(groups)
        const stoppedGroupIds = new Set(nodesForPersistence.filter((draggedNode) => groupsById.has(draggedNode.id)).map((draggedNode) => draggedNode.id))
        const movedGroupMemberIds = new Set(groups.filter((group) => stoppedGroupIds.has(group.id)).flatMap((group) => group.memberIds))
        const componentById = new Map(canvasForPersistence.components.map((component) => [component.id, component]))
        const updatesById = new Map<string, { componentId: string; frame: { x: number; y: number }; reconcileGroup?: boolean }>()
        let didMoveGroup = false
        const frontNodeIds: string[] = []

        for (const draggedNode of nodesForPersistence) {
          const group = groupsById.get(draggedNode.id)
          if (group) {
            frontNodeIds.push(draggedNode.id)
            const position = {
              x: Math.round(draggedNode.position.x),
              y: Math.round(draggedNode.position.y)
            }
            if (group.frame.x !== position.x || group.frame.y !== position.y) {
              moveGroup(activeCanvasId, group.id, position)
              didMoveGroup = true
            }
            continue
          }

          if (movedGroupMemberIds.has(draggedNode.id)) continue

          const component = componentById.get(draggedNode.id)
          if (!component) continue

          frontNodeIds.push(draggedNode.id)
          const parentPosition = sourceParentPositionsByDuplicateId.get(component.id) ?? memberGroups.get(component.id)?.frame
          const position = absoluteNodePosition(draggedNode, parentPosition)
          const x = position.x
          const y = position.y
          if (component.frame.x === x && component.frame.y === y) continue

          updatesById.set(draggedNode.id, {
            componentId: draggedNode.id,
            frame: { x, y },
            reconcileGroup: true
          })
        }

        if (frontNodeIds.length > 0) {
          bringNodesToFront(activeCanvasId, frontNodeIds)
        }

        const updates = [...updatesById.values()]
        if (updates.length === 0) {
          if (frontNodeIds.length > 0 || didMoveGroup || didDuplicateOnDrag) notifyCanvasViewportSync()
          return
        }

        updateComponentFrames(activeCanvasId, updates)
        notifyCanvasViewportSync()
      } finally {
        finishNodeDragInteraction()
      }
    },
    [activeCanvasId, bringNodesToFront, canvas, duplicateSelection, finishNodeDragInteraction, moveGroup, updateComponentFrames]
  )

  const openNodeFinder = useCallback(() => {
    closeCreateMenu()
    setIsNodeFinderOpen(true)
  }, [closeCreateMenu])

  useEffect(() => {
    setIsNodeFinderOpen(false)
    setIsViewportInteracting(false)
    setDraggingNodeIds((currentIds) => (currentIds.size === 0 ? currentIds : new Set()))
    lastPaneActivationRef.current = null
    dragDuplicateStateRef.current = null
    finishNodeDragInteraction()
    finishViewportInteraction()
  }, [activeCanvasId, finishNodeDragInteraction, finishViewportInteraction])

  const focusComponentNode = useCallback(
    (componentId: string) => {
      if (!activeCanvasId || !canvas) return

      const component = canvas.components.find((item) => item.id === componentId)
      if (!component) return

      closeCreateMenu()
      setIsNodeFinderOpen(false)
      setNodes((currentNodes) => selectOnlyNode(currentNodes, componentId))
      bringToFront(activeCanvasId, componentId)
      notifyCanvasViewportSync()

      const centerX = component.frame.x + component.frame.width / 2
      const centerY = component.frame.y + component.frame.height / 2
      const targetZoom = Math.max(reactFlow.getZoom(), NODE_FOCUS_ZOOM)

      void reactFlow
        .setCenter(centerX, centerY, { duration: NODE_FOCUS_DURATION, zoom: targetZoom })
        .then(() => notifyCanvasViewportSync(typeof reactFlow.getViewport === 'function' ? reactFlow.getViewport() : undefined))
        .catch(() => notifyCanvasViewportSync(typeof reactFlow.getViewport === 'function' ? reactFlow.getViewport() : undefined))

      if (focusNodeFrameRef.current !== null) {
        window.cancelAnimationFrame(focusNodeFrameRef.current)
      }

      focusNodeFrameRef.current = window.requestAnimationFrame(() => {
        focusNodeFrameRef.current = null
        focusFlowNodeElement(componentId)
      })
    },
    [activeCanvasId, bringToFront, canvas, closeCreateMenu, reactFlow]
  )

  const focusGroupNode = useCallback(
    (groupId: string) => {
      if (!activeCanvasId || !canvas) return

      const group = (canvas.groups ?? []).find((item) => item.id === groupId)
      if (!group) return

      closeCreateMenu()
      setIsNodeFinderOpen(false)
      setNodes((currentNodes) => selectOnlyNode(currentNodes, groupId))
      bringGroupToFront(activeCanvasId, groupId)
      notifyCanvasViewportSync()

      const center = frameCenter(group.frame)
      const targetZoom = Math.max(reactFlow.getZoom(), NODE_FOCUS_ZOOM)

      void reactFlow
        .setCenter(center.x, center.y, { duration: NODE_FOCUS_DURATION, zoom: targetZoom })
        .then(() => notifyCanvasViewportSync(typeof reactFlow.getViewport === 'function' ? reactFlow.getViewport() : undefined))
        .catch(() => notifyCanvasViewportSync(typeof reactFlow.getViewport === 'function' ? reactFlow.getViewport() : undefined))

      if (focusNodeFrameRef.current !== null) {
        window.cancelAnimationFrame(focusNodeFrameRef.current)
      }

      focusNodeFrameRef.current = window.requestAnimationFrame(() => {
        focusNodeFrameRef.current = null
        focusFlowNodeElement(groupId)
      })
    },
    [activeCanvasId, bringGroupToFront, canvas, closeCreateMenu, reactFlow]
  )

  const focusPetTarget = useCallback(
    (target: PetAlertTarget) => {
      pendingPetTargetRef.current = target

      if (target.canvasId && !canvases[target.canvasId]) {
        pendingPetTargetRef.current = null
        return
      }

      if (target.canvasId && target.canvasId !== activeCanvasId) {
        void setActiveCanvas(target.canvasId)
        return
      }

      if (target.componentId) {
        focusComponentNode(target.componentId)
      }
      dispatchOpenKanbanCard(target)
      pendingPetTargetRef.current = null
    },
    [activeCanvasId, canvases, focusComponentNode, setActiveCanvas]
  )

  useEffect(() => window.atlas.app?.onOpenTarget?.(focusPetTarget) ?? (() => undefined), [focusPetTarget])

  useEffect(() => {
    const target = pendingPetTargetRef.current
    if (!target || (target.canvasId && target.canvasId !== activeCanvasId)) return
    focusPetTarget(target)
  }, [activeCanvasId, canvas, focusPetTarget])

  const deleteSelectedComponents = useCallback(
    (componentIds: string[]) => {
      const removableComponentIds = unlockedComponentIds(componentIds, canvas?.components ?? [])
      if (!activeCanvasId || removableComponentIds.length === 0) return

      closeCreateMenu()
      removeComponents(activeCanvasId, removableComponentIds)
      const removedIds = new Set(removableComponentIds)
      setNodes((currentNodes) => currentNodes.filter((node) => !removedIds.has(node.id)))
      notifyCanvasViewportSync()
    },
    [activeCanvasId, canvas?.components, closeCreateMenu, removeComponents]
  )

  const requestDeleteGroups = useCallback(
    ({ componentIds, groupIds }: PendingGroupDeleteRequest) => {
      if (groupIds.length === 0) return
      closeCreateMenu()
      setPendingGroupDelete({ componentIds, groupIds })
    },
    [closeCreateMenu]
  )

  const clearSelectedNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) return

      closeCreateMenu()
      setNodes((currentNodes) => unselectNodeIds(currentNodes, new Set(nodeIds)))
      notifyCanvasViewportSync()
    },
    [closeCreateMenu]
  )

  const getSelectedNodeIds = useCallback(() => {
    const flowNodes = reactFlow.getNodes()
    return flowNodes.length > 0 ? selectedNodeIds(flowNodes) : selectedNodeIds(nodes)
  }, [nodes, reactFlow])

  const getSelectedCanvasIds = useCallback(() => splitNodeIds(getSelectedNodeIds(), canvas?.groups ?? []), [canvas?.groups, getSelectedNodeIds])

  const createGroupFromSelection = useCallback(() => {
    if (!activeCanvasId) return

    const { componentIds } = getSelectedCanvasIds()
    if (componentIds.length < 2) return

    const groupId = createGroup(activeCanvasId, componentIds)
    if (!groupId) return

    closeCreateMenu()
    pendingSelectedNodeIdsRef.current = new Set([groupId])
    setNodes((currentNodes) => currentNodes.map((node) => (node.selected ? { ...node, selected: false } : node)))
    notifyCanvasViewportSync()
  }, [activeCanvasId, closeCreateMenu, createGroup, getSelectedCanvasIds])

  const ungroupSelectedGroups = useCallback(() => {
    if (!activeCanvasId) return

    const { groupIds } = getSelectedCanvasIds()
    if (groupIds.length === 0) return

    const memberIds = ungroupGroups(activeCanvasId, groupIds)
    closeCreateMenu()
    pendingSelectedNodeIdsRef.current = new Set(memberIds)
    setNodes((currentNodes) => currentNodes.filter((node) => !groupIds.includes(node.id)).map((node) => ({ ...node, selected: false })))
    notifyCanvasViewportSync()
  }, [activeCanvasId, closeCreateMenu, getSelectedCanvasIds, ungroupGroups])

  const handleCanvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || !activeCanvasId) return

      if (keyboardEventMatchesShortcut(event, shortcuts.canvasCreateComponent)) {
        if (isCanvasShortcutBlocked(event.target, new Set(), 'create')) return

        const screenPosition = lastPointerScreenPositionRef.current
        if (!screenPosition) return

        event.preventDefault()
        event.stopPropagation()
        openCreateMenuAtScreenPosition(screenPosition)
        return
      }

      if (keyboardEventMatchesShortcut(event, shortcuts.canvasFind)) {
        if (isCanvasShortcutBlocked(event.target, new Set(), 'find')) return

        event.preventDefault()
        event.stopPropagation()
        openNodeFinder()
        return
      }

      const selectedIds = getSelectedNodeIds()
      const { componentIds, groupIds } = splitNodeIds(selectedIds, canvas?.groups ?? [])
      if (selectedIds.length === 0) return

      const selectedNodeIdSet = new Set(selectedIds)
      if (keyboardEventMatchesShortcut(event, shortcuts.canvasDeselect)) {
        if (isCanvasShortcutBlocked(event.target, selectedNodeIdSet, 'deselect')) return

        event.preventDefault()
        event.stopPropagation()
        const shouldRestoreCanvasFocus = isSelectedNodeTarget(event.target, selectedNodeIdSet)
        clearSelectedNodes(selectedIds)
        if (shouldRestoreCanvasFocus) {
          canvasBoardRef.current?.focus({ preventScroll: true })
        }
        return
      }

      if (keyboardEventMatchesShortcut(event, shortcuts.canvasGroupSelection)) {
        if (isCanvasShortcutBlocked(event.target, selectedNodeIdSet, 'duplicate')) return

        event.preventDefault()
        event.stopPropagation()
        createGroupFromSelection()
        return
      }

      if (keyboardEventMatchesShortcut(event, shortcuts.canvasUngroupSelection)) {
        if (isCanvasShortcutBlocked(event.target, selectedNodeIdSet, 'delete')) return

        event.preventDefault()
        event.stopPropagation()
        ungroupSelectedGroups()
        return
      }

      if (event.key === 'Delete' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (isCanvasShortcutBlocked(event.target, selectedNodeIdSet, 'delete')) return

        event.preventDefault()
        event.stopPropagation()
        if (groupIds.length > 0) {
          requestDeleteGroups({ componentIds, groupIds })
        } else {
          deleteSelectedComponents(componentIds)
        }
        return
      }

    },
    [
      activeCanvasId,
      canvas?.groups,
      clearSelectedNodes,
      createGroupFromSelection,
      deleteSelectedComponents,
      getSelectedNodeIds,
      openNodeFinder,
      openCreateMenuAtScreenPosition,
      requestDeleteGroups,
      shortcuts.canvasCreateComponent,
      shortcuts.canvasDeselect,
      shortcuts.canvasFind,
      shortcuts.canvasGroupSelection,
      shortcuts.canvasUngroupSelection,
      ungroupSelectedGroups
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleCanvasKeyDown, true)
    return () => window.removeEventListener('keydown', handleCanvasKeyDown, true)
  }, [handleCanvasKeyDown])

  const onMoveStart: OnMoveStart = useCallback((_, viewport) => {
    closeCreateMenu()
    if (!viewportInteractionActiveRef.current) {
      viewportInteractionActiveRef.current = true
      setIsViewportInteracting(true)
      beginCanvasInteraction()
    }
    notifyCanvasViewportSync({ ...viewport, phase: 'start' })
  }, [beginCanvasInteraction, closeCreateMenu])

  const onMove: OnMove = useCallback((_, viewport) => {
    notifyCanvasViewportSync({ ...viewport, phase: 'move' })
  }, [])

  const onMoveEnd: OnMoveEnd = useCallback(
    (_, viewport) => {
      if (!activeCanvasId) {
        notifyCanvasViewportSync({ ...viewport, phase: 'end' })
        finishViewportInteraction()
        return
      }

      if (
        !canvas ||
        canvas.viewport.x !== viewport.x ||
        canvas.viewport.y !== viewport.y ||
        canvas.viewport.zoom !== viewport.zoom
      ) {
        updateCanvas(activeCanvasId, (draft) => {
          draft.viewport = viewport
        })
      }

      notifyCanvasViewportSync({ ...viewport, phase: 'end' })
      finishViewportInteraction()
    },
    [activeCanvasId, canvas, finishViewportInteraction, updateCanvas]
  )

  const openCreateMenuAtPointer = useCallback((event: MouseEvent) => {
    const screenPosition = { x: event.clientX, y: event.clientY }
    const currentActivation = {
      screenPosition,
      timestamp: typeof event.timeStamp === 'number' ? event.timeStamp : Date.now()
    }
    const isDoubleClick = event.detail === 2 || isDoubleClickPaneActivation(lastPaneActivationRef.current, currentActivation)

    lastPaneActivationRef.current = isDoubleClick ? null : currentActivation
    if (!isDoubleClick) return

    event.preventDefault()

    openCreateMenuAtScreenPosition(screenPosition)
  }, [openCreateMenuAtScreenPosition])

  const createComponentFromMenu = useCallback(
    (type: ComponentType) => {
      if (!createMenu) return
      const componentId = addComponent(type, createMenu.flowPosition)
      if (componentId) {
        pendingSelectedNodeIdsRef.current = new Set([componentId])
        if (type === 'sticky-note') setAutoEditComponentId(componentId)
      }
      closeCreateMenu()
      notifyCanvasViewportSync()
    },
    [addComponent, closeCreateMenu, createMenu]
  )

  const handleNodeClick = useCallback(
    (_: MouseEvent, node: CanvasFlowNode) => {
      if (!activeCanvasId) return
      if ((canvas?.groups ?? []).some((group) => group.id === node.id)) {
        bringGroupToFront(activeCanvasId, node.id)
      } else {
        bringToFront(activeCanvasId, node.id)
      }
      notifyCanvasViewportSync()
    },
    [activeCanvasId, bringGroupToFront, bringToFront, canvas?.groups]
  )

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!isSupportedDrop(event.dataTransfer)) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsFileDragActive(true)
  }, [])

  const clearFileDragActive = useCallback(() => {
    setIsFileDragActive(false)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      clearFileDragActive()
    }
  }, [clearFileDragActive])

  const dropFile = useCallback(
    async (event: DragEvent) => {
      event.preventDefault()
      clearFileDragActive()
      closeCreateMenu()

      const droppedFiles = await droppedFilesFromDataTransfer(event.dataTransfer)
      if (droppedFiles.length === 0) return

      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const plannedComponents = (
        await Promise.all(
          droppedFiles.map(async (droppedFile, index) => {
            const componentInput = await createComponentInputFromFileSource(droppedFile)
            if (!componentInput) return null

            return {
              ...componentInput,
              position: stackedFileComponentPosition(position, index)
            }
          })
        )
      ).filter((component): component is NonNullable<typeof component> => Boolean(component))

      addComponents(plannedComponents)
      notifyCanvasViewportSync()
    },
    [addComponents, clearFileDragActive, closeCreateMenu, reactFlow]
  )

  const groups = canvas?.groups ?? []
  const selectedCanvasIds = useMemo(() => splitNodeIds(selectedNodeIds(nodes), groups), [groups, nodes])
  const editingGroup = editingGroupId ? groups.find((group) => group.id === editingGroupId) ?? null : null

  const editSelectedGroup = useCallback(() => {
    const { groupIds } = getSelectedCanvasIds()
    if (groupIds.length !== 1) return
    setEditingGroupId(groupIds[0])
  }, [getSelectedCanvasIds])

  const saveGroupEdit = useCallback(
    (groupId: string, patch: { title: string; notes: string }) => {
      if (!activeCanvasId) return
      updateGroup(activeCanvasId, groupId, patch, true)
      setEditingGroupId(null)
      notifyCanvasViewportSync()
    },
    [activeCanvasId, updateGroup]
  )

  const deletePendingGroupsOnly = useCallback(() => {
    if (!activeCanvasId || !pendingGroupDelete) return

    const removableComponentIds = unlockedComponentIds(pendingGroupDelete.componentIds, canvas?.components ?? [])
    if (removableComponentIds.length > 0) removeComponents(activeCanvasId, removableComponentIds)
    const removedIds = new Set([...pendingGroupDelete.groupIds, ...removableComponentIds])
    removeGroups(activeCanvasId, pendingGroupDelete.groupIds)
    setPendingGroupDelete(null)
    setNodes((currentNodes) => currentNodes.filter((node) => !removedIds.has(node.id)))
    notifyCanvasViewportSync()
  }, [activeCanvasId, canvas?.components, pendingGroupDelete, removeComponents, removeGroups])

  const deletePendingGroupsWithMembers = useCallback(() => {
    if (!activeCanvasId || !pendingGroupDelete) return

    const removableComponentIds = unlockedComponentIds(pendingGroupDelete.componentIds, canvas?.components ?? [])
    if (removableComponentIds.length > 0) removeComponents(activeCanvasId, removableComponentIds)
    const memberIds = deleteGroupsWithMembers(activeCanvasId, pendingGroupDelete.groupIds)
    const removedIds = new Set([...pendingGroupDelete.groupIds, ...removableComponentIds, ...memberIds])
    setPendingGroupDelete(null)
    setNodes((currentNodes) => currentNodes.filter((node) => !removedIds.has(node.id)))
    notifyCanvasViewportSync()
  }, [activeCanvasId, canvas?.components, deleteGroupsWithMembers, pendingGroupDelete, removeComponents])

  const requestSelectedGroupDelete = useCallback(() => {
    requestDeleteGroups(getSelectedCanvasIds())
  }, [getSelectedCanvasIds, requestDeleteGroups])

  if (!canvas) {
    return <main className="canvas-empty" />
  }

  const hasBackgroundImageBlur = canvas.background.image.blur > 0
  const backgroundImageBlurBleed = Math.ceil(canvas.background.image.blur * BACKGROUND_IMAGE_BLUR_BLEED_MULTIPLIER)
  const backgroundImageBleedOffset = backgroundImageBlurBleed > 0 ? `-${backgroundImageBlurBleed}px` : '0px'
  const backgroundImageAttachment = hasBackgroundImageBlur ? 'scroll' : canvas.background.image.fixed ? 'fixed' : 'local'
  const backgroundImageFit = hasBackgroundImageBlur ? 'cover' : canvas.background.image.fit
  const backgroundImageStyle = canvas.background.image.src
    ? {
        backgroundImage: `url(${canvas.background.image.src})`,
        filter: `blur(${canvas.background.image.blur}px)`,
        top: backgroundImageBleedOffset,
        right: backgroundImageBleedOffset,
        bottom: backgroundImageBleedOffset,
        left: backgroundImageBleedOffset,
        backgroundSize: backgroundImageFit,
        backgroundRepeat: backgroundImageFit === 'repeat' ? 'repeat' : 'no-repeat',
        backgroundAttachment: backgroundImageAttachment
      }
    : undefined

  return (
    <main
      ref={canvasBoardRef}
      className={[
        'canvas-board',
        isFileDragActive ? 'canvas-board--file-drag-active' : '',
        isViewportInteracting ? 'canvas-board--viewport-interacting' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ background: canvas.background.color }}
      onPointerEnter={trackPointerPosition}
      onPointerMove={trackPointerPosition}
      onPointerLeave={clearTrackedPointerPosition}
      onDropCapture={clearFileDragActive}
      tabIndex={-1}
    >
      {backgroundImageStyle ? <div className="canvas-background-image" style={backgroundImageStyle} /> : null}
      <ReactFlow
        className="canvas-flow"
        key={canvas.id}
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={openCreateMenuAtPointer}
        onMoveStart={onMoveStart}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={dropFile}
        defaultViewport={canvas.viewport}
        minZoom={0.15}
        maxZoom={2.4}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        panOnDrag={CANVAS_PAN_MOUSE_BUTTONS}
        selectionOnDrag
        selectNodesOnDrag={false}
        fitView={canvas.components.length === 0 && groups.length === 0}
        style={{ backgroundColor: 'transparent' }}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasZoomControls hasNodes={canvas.components.length > 0 || groups.length > 0} />
        <CanvasSelectionToolbar
          selectedComponentCount={selectedCanvasIds.componentIds.length}
          selectedGroupCount={selectedCanvasIds.groupIds.length}
          onCreateGroup={createGroupFromSelection}
          onEditGroup={editSelectedGroup}
          onUngroup={ungroupSelectedGroups}
          onDeleteGroups={requestSelectedGroupDelete}
        />
        <CanvasCreateMenu
          anchorRef={createMenuAnchorRef}
          open={Boolean(createMenu)}
          onClose={closeCreateMenu}
          onCreate={createComponentFromMenu}
        />
        <CanvasNodeFinder
          open={isNodeFinderOpen}
          components={canvas.components}
          groups={groups}
          onOpenChange={setIsNodeFinderOpen}
          onSelect={(result) => (result.type === 'group' ? focusGroupNode(result.id) : focusComponentNode(result.id))}
        />
      </ReactFlow>
      <CanvasGroupEditDialog group={editingGroup} onClose={() => setEditingGroupId(null)} onSave={saveGroupEdit} />
      <CanvasGroupDeleteDialog
        count={pendingGroupDelete?.groupIds.length ?? 0}
        open={Boolean(pendingGroupDelete)}
        onCancel={() => setPendingGroupDelete(null)}
        onRemoveOnly={deletePendingGroupsOnly}
        onDeleteMembers={deletePendingGroupsWithMembers}
      />
    </main>
  )
}
