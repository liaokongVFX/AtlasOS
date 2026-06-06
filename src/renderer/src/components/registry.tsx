import { Puzzle, type LucideIcon } from 'lucide-react'
import { useSyncExternalStore, type ReactNode } from 'react'
import type { CanvasComponent, ComponentType, Frame } from '@shared/schema'
import type { CanvasFileSource, FileComponentPatch } from '../lib/file-component-factory'
import { translateCurrent, useI18n, type TFunction } from '../i18n'
import type { ComponentDefinitionMeta } from './component-definitions'

export type AtlasComponentRendererProps = {
  canvasId: string
  canvasZoom?: number
  component: CanvasComponent
  updateConfig: (patch: Record<string, unknown>, immediate?: boolean) => void
  updateState: (patch: Record<string, unknown>, immediate?: boolean) => void
  updateFrame?: (patch: Partial<Frame>, immediate?: boolean) => void
  setTitle: (title: string) => void
  setHeaderActions?: (actions: ReactNode | null) => void
  isCanvasInteracting?: boolean
  isNodeSelected?: boolean
  isViewportInteracting?: boolean
  onRequestSelect?: (componentId: string) => void
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

const DEFAULT_MISSING_COMPONENT_FRAME: Frame = { x: 120, y: 120, width: 420, height: 260 }

export const componentRegistry: Record<string, AtlasComponentDefinition> = {}

const missingComponentDefinitions = new Map<string, AtlasComponentDefinition>()
const componentRegistryListeners = new Set<() => void>()
let componentRegistryVersion = 0

function notifyComponentRegistryChanged(): void {
  componentRegistryVersion += 1
  for (const listener of componentRegistryListeners) listener()
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
