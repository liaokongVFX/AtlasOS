import { FileCode, FolderTree, Globe2, Kanban, Puzzle, StickyNote, TerminalSquare, type LucideIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type { CanvasComponent, ComponentType, Frame } from '@shared/schema'
import {
  componentTypeForFileSource,
  createFileComponentPatch,
  type CanvasFileSource,
  type FileComponentPatch
} from '../lib/file-component-factory'
import { getFilePreviewKind } from '../lib/file-types'
import { translateCurrent, useI18n, type TFunction } from '../i18n'
import {
  fitMediaFrameToAspectRatio,
  mediaAspectRatioFromConfig,
  mediaAspectRatioFromFrame,
  MEDIA_NODE_MIN_WIDTH,
  normalizeMediaResizeFrame
} from '../lib/media-frame'
import { COMPONENT_DEFINITIONS, type ComponentDefinitionMeta } from './component-definitions'
import { BrowserComponent } from './modules/browser-component'
import { FilePreviewComponent } from './modules/file-preview-component'
import { FileTreeComponent } from './modules/file-tree-component'
import { KanbanComponent } from './modules/kanban-component'
import { getKanbanSearchTokens, getKanbanStats, normalizeKanbanState } from './modules/kanban-model'
import { MarkdownNoteComponent } from './modules/markdown-note-component'
import { TerminalComponent } from './modules/terminal-component'

export type AtlasComponentRendererProps = {
  canvasId: string
  component: CanvasComponent
  updateConfig: (patch: Record<string, unknown>, immediate?: boolean) => void
  updateState: (patch: Record<string, unknown>, immediate?: boolean) => void
  updateFrame?: (patch: Partial<Frame>, immediate?: boolean) => void
  setTitle: (title: string) => void
  isCanvasInteracting?: boolean
  isNodeSelected?: boolean
}

export type ComponentCreatePatch = Omit<Partial<CanvasComponent>, 'frame'> & {
  frame?: Partial<Frame>
}

export type ComponentCreateInput = {
  type: ComponentType
  position?: { x: number; y: number }
  patch?: ComponentCreatePatch
}

export type NodeResizeParams = {
  x: number
  y: number
  width: number
  height: number
  direction?: readonly number[]
}

export type NodeResizeBehavior = {
  minWidth?: number
  minHeight?: number
  keepAspectRatio?: boolean
  normalizeFrame?: (params: NodeResizeParams, context: { component: CanvasComponent; direction: readonly number[] | null }) => Frame
}

export type AtlasComponentDefinition = ComponentDefinitionMeta & {
  icon: LucideIcon
  Renderer: (props: AtlasComponentRendererProps) => JSX.Element
  pluginId?: string
  chrome?: {
    variant?: 'terminal'
    titleInputSize?: (title: string) => number
  }
  create?: () => ComponentCreatePatch
  duplicate?: (component: CanvasComponent) => ComponentCreatePatch | null
  dispose?: (component: CanvasComponent) => void | Promise<void>
  getSearchTokens?: (component: CanvasComponent) => string[]
  getDetail?: (component: CanvasComponent) => string | null
  getSubtitle?: (component: CanvasComponent) => string | null
  getResizeBehavior?: (component: CanvasComponent) => NodeResizeBehavior | null
  acceptsFile?: (file: CanvasFileSource) => boolean
  createFromFile?: (file: CanvasFileSource) => Promise<FileComponentPatch>
}

const NODE_FINDER_DEFAULT_BROWSER_URL = 'https://example.com'
const DEFAULT_MISSING_COMPONENT_FRAME: Frame = { x: 120, y: 120, width: 420, height: 260 }

export const componentRegistry: Record<string, AtlasComponentDefinition> = {}

const missingComponentDefinitions = new Map<string, AtlasComponentDefinition>()
const componentRegistryListeners = new Set<() => void>()
let componentRegistryVersion = 0

function notifyComponentRegistryChanged(): void {
  componentRegistryVersion += 1
  for (const listener of componentRegistryListeners) listener()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function browserFinderTabs(component: CanvasComponent): Array<{ localId: string; url: string }> {
  const tabs = component.state.tabs
  if (!Array.isArray(tabs)) return []

  return tabs
    .filter(isRecord)
    .map((tab) => ({
      localId: optionalString(tab.localId) ?? '',
      url: optionalString(tab.url) ?? ''
    }))
    .filter((tab) => tab.localId && tab.url)
}

function browserFinderUrl(component: CanvasComponent): string {
  const tabs = browserFinderTabs(component)
  if (tabs.length === 0) return NODE_FINDER_DEFAULT_BROWSER_URL

  const activeTabId = optionalString(component.state.activeTabId)
  return tabs.find((tab) => tab.localId === activeTabId)?.url ?? tabs[0].url
}

function fileSourceMatches(type: ComponentType): (file: CanvasFileSource) => boolean {
  return (file) => componentTypeForFileSource(file) === type
}

function createMissingComponentDefinition(type: string): AtlasComponentDefinition {
  return {
    type,
    title: 'Missing plugin',
    titleKey: 'component.missingPlugin',
    defaultFrame: DEFAULT_MISSING_COMPONENT_FRAME,
    permissions: [],
    icon: Puzzle,
    Renderer: MissingComponentRenderer,
    getDetail: () => type,
    getSearchTokens: () => [type]
  }
}

function MissingComponentRenderer({ component }: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="missing-component-module">
      <strong>{t('component.pluginUnavailable')}</strong>
      <span>{component.type}</span>
    </div>
  )
}

export function componentDefinitionTitle(definition: Pick<AtlasComponentDefinition, 'title' | 'titleKey'>, t: TFunction = translateCurrent): string {
  return definition.titleKey ? t(definition.titleKey) : definition.title
}

export function registerComponentDefinition(definition: AtlasComponentDefinition): void {
  componentRegistry[definition.type] = definition
  notifyComponentRegistryChanged()
}

export function unregisterComponentDefinitionsByPlugin(pluginId: string): void {
  let didChange = false

  for (const [type, definition] of Object.entries(componentRegistry)) {
    if (definition.pluginId !== pluginId) continue

    delete componentRegistry[type]
    didChange = true
  }

  if (didChange) notifyComponentRegistryChanged()
}

export function subscribeComponentRegistry(listener: () => void): () => void {
  componentRegistryListeners.add(listener)
  return () => componentRegistryListeners.delete(listener)
}

export function getComponentRegistryVersion(): number {
  return componentRegistryVersion
}

export function useComponentRegistryVersion(): number {
  return useSyncExternalStore(subscribeComponentRegistry, getComponentRegistryVersion, getComponentRegistryVersion)
}

export function getComponentDefinition(type: ComponentType): AtlasComponentDefinition {
  const definition = componentRegistry[type]
  if (definition) return definition

  const cached = missingComponentDefinitions.get(type)
  if (cached) return cached

  const missingDefinition = createMissingComponentDefinition(type)
  missingComponentDefinitions.set(type, missingDefinition)
  return missingDefinition
}

export function getComponentDefinitions(): AtlasComponentDefinition[] {
  return Object.values(componentRegistry)
}

export function getCreatableComponentDefinitions(): AtlasComponentDefinition[] {
  return getComponentDefinitions().filter((definition) => definition.creatable !== false)
}

export async function createComponentInputFromFileSource(file: CanvasFileSource): Promise<Omit<ComponentCreateInput, 'position'> | null> {
  const definition = getComponentDefinitions().find((candidate) => candidate.acceptsFile?.(file) && candidate.createFromFile)
  if (!definition?.createFromFile) return null

  return {
    type: definition.type,
    patch: await definition.createFromFile(file)
  }
}

function filePreviewResizeBehavior(component: CanvasComponent): NodeResizeBehavior | null {
  const previewKind = getFilePreviewKind(optionalString(component.bindings.path) ?? '', optionalString(component.config.mimeType))
  const isMediaPreview = previewKind === 'image' || previewKind === 'video'
  if (!isMediaPreview) return null

  const mediaAspectRatio = mediaAspectRatioFromConfig(component.config) ?? mediaAspectRatioFromFrame(component.frame)
  if (!mediaAspectRatio) return { keepAspectRatio: true, minWidth: MEDIA_NODE_MIN_WIDTH }

  return {
    keepAspectRatio: true,
    minWidth: MEDIA_NODE_MIN_WIDTH,
    minHeight: fitMediaFrameToAspectRatio(component.frame, mediaAspectRatio, MEDIA_NODE_MIN_WIDTH).height,
    normalizeFrame: (params, context) => normalizeMediaResizeFrame(params, mediaAspectRatio, context.direction)
  }
}

registerComponentDefinition({
  ...COMPONENT_DEFINITIONS.terminal,
  icon: TerminalSquare,
  Renderer: TerminalComponent,
  chrome: {
    variant: 'terminal',
    titleInputSize: (title) => Math.max(8, title.length)
  },
  dispose: (component) => {
    void window.atlas.terminal.closeComponent(component.id)
  },
  getDetail: (component) => optionalString(component.state.cwd) ?? optionalString(component.config.cwd) ?? null,
  getSubtitle: (component) => optionalString(component.state.cwd) ?? optionalString(component.config.cwd) ?? null
})

registerComponentDefinition({
  ...COMPONENT_DEFINITIONS['file-tree'],
  icon: FolderTree,
  Renderer: FileTreeComponent,
  acceptsFile: fileSourceMatches('file-tree'),
  createFromFile: (file) => createFileComponentPatch(file, 'file-tree'),
  getDetail: (component) => optionalString(component.config.rootPath) ?? optionalString(component.bindings.rootPath) ?? null
})

registerComponentDefinition({
  ...COMPONENT_DEFINITIONS.browser,
  icon: Globe2,
  Renderer: BrowserComponent,
  duplicate: () => ({ state: {} }),
  getDetail: browserFinderUrl
})

registerComponentDefinition({
  ...COMPONENT_DEFINITIONS['markdown-note'],
  icon: StickyNote,
  Renderer: MarkdownNoteComponent,
  acceptsFile: fileSourceMatches('markdown-note'),
  createFromFile: (file) => createFileComponentPatch(file, 'markdown-note'),
  getDetail: (component) => optionalString(component.bindings.path) ?? optionalString(component.bindings.rootPath) ?? null
})

registerComponentDefinition({
  ...COMPONENT_DEFINITIONS['file-preview'],
  icon: FileCode,
  Renderer: FilePreviewComponent,
  creatable: false,
  acceptsFile: fileSourceMatches('file-preview'),
  createFromFile: (file) => createFileComponentPatch(file, 'file-preview'),
  getDetail: (component) => optionalString(component.bindings.path) ?? optionalString(component.bindings.rootPath) ?? null,
  getResizeBehavior: filePreviewResizeBehavior
})

registerComponentDefinition({
  ...COMPONENT_DEFINITIONS.kanban,
  icon: Kanban,
  Renderer: KanbanComponent,
  getDetail: (component) => {
    const stats = getKanbanStats(normalizeKanbanState(component.state.kanban))
    return translateCurrent('kanban.stats', { columns: stats.columnCount, cards: stats.cardCount })
  },
  getSearchTokens: (component) => getKanbanSearchTokens(normalizeKanbanState(component.state.kanban))
})
