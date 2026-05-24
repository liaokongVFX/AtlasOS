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
import { Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type RefObject } from 'react'
import type { Measurable } from '@radix-ui/rect'
import type { CanvasComponent, ComponentType, FileEntry } from '@shared/schema'
import { keyboardEventMatchesShortcut } from '@shared/keyboard-shortcuts'
import { notifyCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { stackedFileComponentPosition, type CanvasFileSource } from '../lib/file-component-factory'
import { fileName, getFilePreviewKind } from '../lib/file-types'
import type { MediaDimensions } from '../lib/media-frame'
import { useAppSettingsStore } from '../store/app-settings-store'
import { useCanvasStore } from '../store/canvas-store'
import { useI18n } from '../i18n'
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
  component: CanvasComponent
  onRequestSelect?: (componentId: string) => void
  registryVersion: number
  node: AtlasFlowNode
}

const nodeTypes = {
  atlasComponent: ComponentNode
}

const NODE_FOCUS_DURATION = 180
const NODE_FOCUS_ZOOM = 1.15
const CANVAS_SHORTCUT_BLOCKLIST_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  '.cm-editor',
  '.xterm',
  '.component-node__body',
  '.dialog-content',
  '.popover-content',
  '.menu-content',
  '.top-bar'
].join(',')
const CANVAS_DESELECT_SHORTCUT_BLOCKLIST_SELECTOR = [
  '.component-node__title-input',
  '.dialog-content',
  '.popover-content',
  '.menu-content',
  '.top-bar'
].join(',')

function componentToNode(
  canvasId: string,
  component: CanvasComponent,
  registryVersion = 0,
  onRequestSelect?: (componentId: string) => void
): AtlasFlowNode {
  return {
    id: component.id,
    type: 'atlasComponent',
    position: { x: component.frame.x, y: component.frame.y },
    initialWidth: component.frame.width,
    initialHeight: component.frame.height,
    width: component.frame.width,
    height: component.frame.height,
    measured: { width: component.frame.width, height: component.frame.height },
    zIndex: component.zIndex,
    data: { canvasId, component, onRequestSelect, registryVersion },
    style: {
      width: component.frame.width,
      height: component.frame.height,
      zIndex: component.zIndex
    }
  }
}

function cachedComponentToNode(
  cache: Map<string, ComponentNodeCacheEntry>,
  canvasId: string,
  component: CanvasComponent,
  registryVersion: number,
  onRequestSelect?: (componentId: string) => void
): AtlasFlowNode {
  const cached = cache.get(component.id)
  if (
    cached?.canvasId === canvasId &&
    cached.component === component &&
    cached.onRequestSelect === onRequestSelect &&
    cached.registryVersion === registryVersion
  ) {
    return cached.node
  }

  const node = componentToNode(canvasId, component, registryVersion, onRequestSelect)
  cache.set(component.id, { canvasId, component, onRequestSelect, registryVersion, node })
  return node
}

function reconcileFlowNodes(nextNodes: AtlasFlowNode[], currentNodes: AtlasFlowNode[]): AtlasFlowNode[] {
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

function selectedNodeIds(nodes: AtlasFlowNode[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id)
}

function unselectNodeIds(nodes: AtlasFlowNode[], nodeIds: Set<string>): AtlasFlowNode[] {
  if (nodeIds.size === 0) return nodes

  let didChange = false
  const nextNodes = nodes.map((node) => {
    if (!node.selected || !nodeIds.has(node.id)) return node

    didChange = true
    return { ...node, selected: false }
  })

  return didChange ? nextNodes : nodes
}

function selectOnlyNode(nodes: AtlasFlowNode[], componentId: string): AtlasFlowNode[] {
  let didChange = false
  const nextNodes = nodes.map((node) => {
    const shouldSelect = node.id === componentId
    if (node.selected === shouldSelect) return node

    didChange = true
    return { ...node, selected: shouldSelect }
  })

  return didChange ? nextNodes : nodes
}

function closestFlowNodeId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null

  return target.closest<HTMLElement>('.react-flow__node[data-id]')?.dataset.id ?? null
}

function isSelectedTerminalTarget(target: EventTarget | null, selectedNodeIds: Set<string>): boolean {
  if (!(target instanceof Element) || !target.closest('.xterm')) return false

  const flowNodeId = closestFlowNodeId(target)
  return Boolean(flowNodeId && selectedNodeIds.has(flowNodeId))
}

function isSelectedNodeTarget(target: EventTarget | null, selectedNodeIds: Set<string>): boolean {
  const flowNodeId = closestFlowNodeId(target)
  return Boolean(flowNodeId && selectedNodeIds.has(flowNodeId))
}

function isCanvasShortcutBlocked(
  target: EventTarget | null,
  selectedNodeIds: Set<string>,
  shortcut: 'delete' | 'deselect' | 'duplicate' | 'find'
): boolean {
  if (shortcut === 'delete' && isSelectedTerminalTarget(target, selectedNodeIds)) return false
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
  const reactFlow = useReactFlow<AtlasFlowNode>()
  const zoom = useStore((state) => state.transform[2])
  const zoomPercent = Math.round(zoom * 100)

  const notifyAfterViewportAction = useCallback((action: Promise<boolean>) => {
    void action.then(() => notifyCanvasViewportSync()).catch(() => undefined)
  }, [])

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

function CanvasNodeFinder({
  open,
  components,
  onOpenChange,
  onSelect
}: {
  open: boolean
  components: CanvasComponent[]
  onOpenChange: (open: boolean) => void
  onSelect: (componentId: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const scrollResetFrameRef = useRef<number | null>(null)

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
          {components.length === 0 ? t('canvas.noNodes') : t('canvas.noMatchingNodes')}
        </Command.Empty>
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
                value={component.id}
                keywords={nodeFinderKeywords(component, definitionTitle)}
                onSelect={() => onSelect(component.id)}
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

export function CanvasBoard(): JSX.Element {
  const reactFlow = useReactFlow<AtlasFlowNode>()
  const componentRegistryVersion = useComponentRegistryVersion()
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvas = useCanvasStore((state) => (state.activeCanvasId ? state.canvases[state.activeCanvasId] : null))
  const updateCanvas = useCanvasStore((state) => state.updateCanvas)
  const updateComponentFrames = useCanvasStore((state) => state.updateComponentFrames)
  const addComponent = useCanvasStore((state) => state.addComponent)
  const addComponents = useCanvasStore((state) => state.addComponents)
  const duplicateComponents = useCanvasStore((state) => state.duplicateComponents)
  const removeComponents = useCanvasStore((state) => state.removeComponents)
  const bringToFront = useCanvasStore((state) => state.bringToFront)
  const shortcuts = useAppSettingsStore((state) => state.settings.shortcuts)
  const [nodes, setNodes] = useState<AtlasFlowNode[]>(() =>
    canvas ? canvas.components.map((component) => componentToNode(canvas.id, component, componentRegistryVersion)) : []
  )
  const [createMenu, setCreateMenu] = useState<CanvasCreateMenuState | null>(null)
  const [isNodeFinderOpen, setIsNodeFinderOpen] = useState(false)
  const [isFileDragActive, setIsFileDragActive] = useState(false)
  const [isViewportInteracting, setIsViewportInteracting] = useState(false)
  const createMenuAnchorRef = useRef<Measurable>(createPointAnchor(0, 0))
  const pendingSelectedNodeIdsRef = useRef<Set<string> | null>(null)
  const componentNodeCacheRef = useRef(new Map<string, ComponentNodeCacheEntry>())
  const focusNodeFrameRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (focusNodeFrameRef.current !== null) {
        window.cancelAnimationFrame(focusNodeFrameRef.current)
      }
    }
  }, [])

  const selectComponentForContextMenu = useCallback(
    (componentId: string) => {
      if (!activeCanvasId) return

      setNodes((currentNodes) => selectOnlyNode(currentNodes, componentId))
      bringToFront(activeCanvasId, componentId)
      notifyCanvasViewportSync()
    },
    [activeCanvasId, bringToFront]
  )

  const persistedNodes = useMemo(() => {
    const cache = componentNodeCacheRef.current
    if (!canvas) {
      cache.clear()
      return []
    }

    const liveComponentIds = new Set<string>()
    const nextNodes = canvas.components.map((component) => {
      liveComponentIds.add(component.id)
      return cachedComponentToNode(cache, canvas.id, component, componentRegistryVersion, selectComponentForContextMenu)
    })

    for (const [componentId, cached] of cache) {
      if (cached.canvasId !== canvas.id || !liveComponentIds.has(componentId)) {
        cache.delete(componentId)
      }
    }

    return nextNodes
  }, [canvas, componentRegistryVersion, selectComponentForContextMenu])

  useLayoutEffect(() => {
    setNodes((currentNodes) => {
      const reconciledNodes = reconcileFlowNodes(persistedNodes, currentNodes)
      const pendingSelectedNodeIds = pendingSelectedNodeIdsRef.current

      if (!pendingSelectedNodeIds) return reconciledNodes

      pendingSelectedNodeIdsRef.current = null
      return reconciledNodes.map((node) => ({
        ...node,
        selected: pendingSelectedNodeIds.has(node.id)
      }))
    })
  }, [persistedNodes])

  const onNodesChange = useCallback(
    (changes: NodeChange<AtlasFlowNode>[]) => {
      setNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
      if (!activeCanvasId) return

      const removedNodeIds = changes.filter((change) => change.type === 'remove').map((change) => change.id)
      if (removedNodeIds.length > 0) {
        removeComponents(activeCanvasId, removedNodeIds)
        notifyCanvasViewportSync()
      }
    },
    [activeCanvasId, removeComponents]
  )

  const onNodeDragStop: OnNodeDrag<AtlasFlowNode> = useCallback(
    (_, node, draggedNodes) => {
      const stoppedNodes = draggedNodes.length > 0 ? draggedNodes : [node]
      const stoppedNodeIds = new Set(stoppedNodes.map((draggedNode) => draggedNode.id))
      setNodes((currentNodes) => unselectNodeIds(currentNodes, stoppedNodeIds))

      if (!activeCanvasId || !canvas) return

      const componentById = new Map(canvas.components.map((component) => [component.id, component]))
      const updatesById = new Map<string, { componentId: string; frame: { x: number; y: number } }>()

      for (const draggedNode of stoppedNodes) {
        const component = componentById.get(draggedNode.id)
        if (!component) continue

        const x = Math.round(draggedNode.position.x)
        const y = Math.round(draggedNode.position.y)
        if (component.frame.x === x && component.frame.y === y) continue

        updatesById.set(draggedNode.id, {
          componentId: draggedNode.id,
          frame: { x, y }
        })
      }

      const updates = [...updatesById.values()]
      if (updates.length === 0) return

      updateComponentFrames(activeCanvasId, updates)
      notifyCanvasViewportSync()
    },
    [activeCanvasId, canvas, updateComponentFrames]
  )

  const closeCreateMenu = useCallback(() => {
    setCreateMenu((currentMenu) => (currentMenu ? null : currentMenu))
  }, [])

  const openNodeFinder = useCallback(() => {
    closeCreateMenu()
    setIsNodeFinderOpen(true)
  }, [closeCreateMenu])

  useEffect(() => {
    setIsNodeFinderOpen(false)
    setIsViewportInteracting(false)
  }, [activeCanvasId])

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
        .then(() => notifyCanvasViewportSync())
        .catch(() => notifyCanvasViewportSync())

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

  const deleteSelectedNodes = useCallback(
    (componentIds: string[]) => {
      if (!activeCanvasId || componentIds.length === 0) return

      closeCreateMenu()
      removeComponents(activeCanvasId, componentIds)
      const removedIds = new Set(componentIds)
      setNodes((currentNodes) => currentNodes.filter((node) => !removedIds.has(node.id)))
      notifyCanvasViewportSync()
    },
    [activeCanvasId, closeCreateMenu, removeComponents]
  )

  const duplicateSelectedNodes = useCallback(
    (componentIds: string[]) => {
      if (!activeCanvasId || componentIds.length === 0) return

      const duplicatedNodeIds = duplicateComponents(activeCanvasId, componentIds)
      if (duplicatedNodeIds.length === 0) return

      closeCreateMenu()
      pendingSelectedNodeIdsRef.current = new Set(duplicatedNodeIds)
      setNodes((currentNodes) => currentNodes.map((node) => (node.selected ? { ...node, selected: false } : node)))
      notifyCanvasViewportSync()
    },
    [activeCanvasId, closeCreateMenu, duplicateComponents]
  )

  const clearSelectedNodes = useCallback(
    (componentIds: string[]) => {
      if (componentIds.length === 0) return

      closeCreateMenu()
      setNodes((currentNodes) => unselectNodeIds(currentNodes, new Set(componentIds)))
      notifyCanvasViewportSync()
    },
    [closeCreateMenu]
  )

  const getSelectedComponentIds = useCallback(() => {
    const flowNodes = reactFlow.getNodes()
    return flowNodes.length > 0 ? selectedNodeIds(flowNodes) : selectedNodeIds(nodes)
  }, [nodes, reactFlow])

  const handleCanvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || !activeCanvasId) return

      if (keyboardEventMatchesShortcut(event, shortcuts.canvasFind)) {
        if (isCanvasShortcutBlocked(event.target, new Set(), 'find')) return

        event.preventDefault()
        event.stopPropagation()
        openNodeFinder()
        return
      }

      const componentIds = getSelectedComponentIds()
      if (componentIds.length === 0) return

      const selectedComponentIds = new Set(componentIds)
      if (keyboardEventMatchesShortcut(event, shortcuts.canvasDeselect)) {
        if (isCanvasShortcutBlocked(event.target, selectedComponentIds, 'deselect')) return

        event.preventDefault()
        event.stopPropagation()
        clearSelectedNodes(componentIds)
        return
      }

      if (event.key === 'Delete' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (isCanvasShortcutBlocked(event.target, selectedComponentIds, 'delete')) return

        event.preventDefault()
        event.stopPropagation()
        deleteSelectedNodes(componentIds)
        return
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'd') {
        if (isCanvasShortcutBlocked(event.target, selectedComponentIds, 'duplicate')) return

        event.preventDefault()
        event.stopPropagation()
        duplicateSelectedNodes(componentIds)
      }
    },
    [
      activeCanvasId,
      clearSelectedNodes,
      deleteSelectedNodes,
      duplicateSelectedNodes,
      getSelectedComponentIds,
      openNodeFinder,
      shortcuts.canvasDeselect,
      shortcuts.canvasFind
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleCanvasKeyDown, true)
    return () => window.removeEventListener('keydown', handleCanvasKeyDown, true)
  }, [handleCanvasKeyDown])

  const onMoveStart: OnMoveStart = useCallback(() => {
    closeCreateMenu()
    setIsViewportInteracting((current) => (current ? current : true))
    notifyCanvasViewportSync()
  }, [closeCreateMenu])

  const onMove: OnMove = useCallback(() => {
    notifyCanvasViewportSync()
  }, [])

  const onMoveEnd: OnMoveEnd = useCallback(
    (_, viewport) => {
      setIsViewportInteracting((current) => (current ? false : current))

      if (!activeCanvasId) {
        notifyCanvasViewportSync()
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

      notifyCanvasViewportSync()
    },
    [activeCanvasId, canvas, updateCanvas]
  )

  const openCreateMenuAtPointer = useCallback((event: MouseEvent) => {
    if (event.detail !== 2) return
    event.preventDefault()

    const screenPosition = { x: event.clientX, y: event.clientY }
    const flowPosition = reactFlow.screenToFlowPosition(screenPosition)
    createMenuAnchorRef.current = createPointAnchor(screenPosition.x, screenPosition.y)
    setCreateMenu({
      flowPosition: { x: Math.round(flowPosition.x), y: Math.round(flowPosition.y) }
    })
  }, [reactFlow])

  const createComponentFromMenu = useCallback(
    (type: ComponentType) => {
      if (!createMenu) return
      addComponent(type, createMenu.flowPosition)
      closeCreateMenu()
      notifyCanvasViewportSync()
    },
    [addComponent, closeCreateMenu, createMenu]
  )

  const handleNodeClick = useCallback(
    (_: MouseEvent, node: AtlasFlowNode) => {
      if (!activeCanvasId) return
      bringToFront(activeCanvasId, node.id)
      notifyCanvasViewportSync()
    },
    [activeCanvasId, bringToFront]
  )

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!isSupportedDrop(event.dataTransfer)) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsFileDragActive(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsFileDragActive(false)
    }
  }, [])

  const dropFile = useCallback(
    async (event: DragEvent) => {
      event.preventDefault()
      setIsFileDragActive(false)
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
    [addComponents, closeCreateMenu, reactFlow]
  )

  if (!canvas) {
    return <main className="canvas-empty" />
  }

  const backgroundImageStyle = canvas.background.image.src
    ? {
        backgroundImage: `url(${canvas.background.image.src})`,
        opacity: canvas.background.image.opacity,
        backgroundSize: canvas.background.image.fit,
        backgroundRepeat: canvas.background.image.fit === 'repeat' ? 'repeat' : 'no-repeat',
        backgroundAttachment: canvas.background.image.fixed ? 'fixed' : 'local'
      }
    : undefined

  return (
    <main
      className={[
        'canvas-board',
        isFileDragActive ? 'canvas-board--file-drag-active' : '',
        isViewportInteracting ? 'canvas-board--viewport-interacting' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ backgroundColor: canvas.background.color }}
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
        selectNodesOnDrag={false}
        fitView={canvas.components.length === 0}
        style={{ backgroundColor: 'transparent' }}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasZoomControls hasNodes={canvas.components.length > 0} />
        <CanvasCreateMenu
          anchorRef={createMenuAnchorRef}
          open={Boolean(createMenu)}
          onClose={closeCreateMenu}
          onCreate={createComponentFromMenu}
        />
        <CanvasNodeFinder
          open={isNodeFinderOpen}
          components={canvas.components}
          onOpenChange={setIsNodeFinderOpen}
          onSelect={focusComponentNode}
        />
      </ReactFlow>
    </main>
  )
}
