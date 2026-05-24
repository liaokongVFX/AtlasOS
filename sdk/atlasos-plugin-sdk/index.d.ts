import type * as React from 'react'

export type AtlasPluginRecord = Record<string, unknown>
export type AtlasPluginConfigValue = string | number | boolean
export type AtlasPluginConfig = Record<string, AtlasPluginConfigValue>

export type Frame = {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasComponent<
  TConfig extends object = AtlasPluginRecord,
  TState extends object = AtlasPluginRecord,
  TBindings extends object = AtlasPluginRecord
> = {
  id: string
  type: string
  title: string
  frame: Frame
  zIndex: number
  config: TConfig
  state: TState
  bindings: TBindings
  createdAt: string
  updatedAt: string
}

export type AtlasPluginManifest = {
  id: string
  name: string
  version: string
  atlasApiVersion: 1
  description?: string
  renderer?: { entry: string }
  native?: { entry: string }
  permissions: string[]
  configuration: Array<{
    id: string
    label: string
    description?: string
    type: 'string' | 'number' | 'boolean' | 'select'
    default?: AtlasPluginConfigValue
    options: Array<{ label: string; value: string }>
    placeholder?: string
    min?: number
    max?: number
    step?: number
  }>
  nodes: Array<{
    id: string
    title: string
    defaultFrame: Frame
    permissions: string[]
    creatable: boolean
  }>
}

export type AtlasRendererPluginContext = {
  id: string
  manifest: AtlasPluginManifest
  config: AtlasPluginConfig
}

export type AtlasRendererPluginInvoke = (command: string, input?: unknown) => Promise<unknown>

export type AtlasPluginIcon = (props: { size?: number | string; className?: string; 'aria-hidden'?: boolean }) => React.ReactNode

export type AtlasPluginIconSet = {
  Calculator: AtlasPluginIcon
  Puzzle: AtlasPluginIcon
}

export type AtlasPluginNodeProps<
  TConfig extends object = AtlasPluginRecord,
  TState extends object = AtlasPluginRecord,
  TBindings extends object = AtlasPluginRecord
> = {
  canvasId: string
  component: CanvasComponent<TConfig, TState, TBindings>
  updateConfig: (patch: Partial<TConfig>, immediate?: boolean) => void
  updateState: (patch: Partial<TState>, immediate?: boolean) => void
  updateFrame?: (patch: Partial<Frame>, immediate?: boolean) => void
  setTitle: (title: string) => void
  isCanvasInteracting?: boolean
  isNodeSelected?: boolean
  plugin: AtlasRendererPluginContext
  invoke: AtlasRendererPluginInvoke
}

export type ComponentCreatePatch<
  TConfig extends object = AtlasPluginRecord,
  TState extends object = AtlasPluginRecord,
  TBindings extends object = AtlasPluginRecord
> = Partial<Omit<CanvasComponent<TConfig, TState, TBindings>, 'frame'>> & {
  frame?: Partial<Frame>
}

export type AtlasRendererPluginNodeDefinition<
  TConfig extends object = AtlasPluginRecord,
  TState extends object = AtlasPluginRecord,
  TBindings extends object = AtlasPluginRecord
> = {
  id: string
  title?: string
  defaultFrame?: Frame
  permissions?: string[]
  creatable?: boolean
  icon?: AtlasPluginIcon
  Renderer: (props: AtlasPluginNodeProps<TConfig, TState, TBindings>) => React.ReactNode
  create?: () => ComponentCreatePatch<TConfig, TState, TBindings>
  duplicate?: (component: CanvasComponent<TConfig, TState, TBindings>) => ComponentCreatePatch<TConfig, TState, TBindings> | null
  getSearchTokens?: (component: CanvasComponent<TConfig, TState, TBindings>) => string[]
  getDetail?: (component: CanvasComponent<TConfig, TState, TBindings>) => string | null
  getSubtitle?: (component: CanvasComponent<TConfig, TState, TBindings>) => string | null
}

export type AtlasPluginSdk = {
  definePlugin: typeof definePlugin
  defineNode: typeof defineNode
  isRecord: typeof isRecord
  readBindings: typeof readBindings
  readConfig: typeof readConfig
  readState: typeof readState
}

export type AtlasRendererPluginApi = {
  React: typeof React
  icons: AtlasPluginIconSet
  plugin: AtlasRendererPluginContext
  invoke: AtlasRendererPluginInvoke
  sdk: AtlasPluginSdk
  registerNode: (definition: AtlasRendererPluginNodeDefinition) => void
}

export type AtlasRendererPluginRegister = (api: AtlasRendererPluginApi) => void | Promise<void>

export function definePlugin(register: AtlasRendererPluginRegister): AtlasRendererPluginRegister

export function defineNode<
  TConfig extends object = AtlasPluginRecord,
  TState extends object = AtlasPluginRecord,
  TBindings extends object = AtlasPluginRecord
>(
  definition: AtlasRendererPluginNodeDefinition<TConfig, TState, TBindings>
): AtlasRendererPluginNodeDefinition<TConfig, TState, TBindings>

export function isRecord(value: unknown): value is AtlasPluginRecord

export function readConfig<TConfig extends object>(component: CanvasComponent, defaults: TConfig): TConfig

export function readState<TState extends object>(component: CanvasComponent, defaults: TState): TState

export function readBindings<TBindings extends object>(component: CanvasComponent, defaults: TBindings): TBindings
