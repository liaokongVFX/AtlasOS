import type * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import type { AtlasPluginManifest, PluginConfig } from '@shared/plugins'
import type { CanvasComponent, Frame } from '@shared/schema'
import type { AtlasComponentRendererProps, ComponentCreatePatch } from '../components/registry'

export type AtlasPluginRecord = Record<string, unknown>

export type AtlasRendererPluginContext = {
  id: string
  manifest: AtlasPluginManifest
  config: PluginConfig
}

export type AtlasRendererPluginInvoke = (command: string, input?: unknown) => Promise<unknown>

export type AtlasPluginNodeProps<
  TConfig extends object = AtlasPluginRecord,
  TState extends object = AtlasPluginRecord,
  TBindings extends object = AtlasPluginRecord
> = Omit<
  AtlasComponentRendererProps,
  'autoEditComponentId' | 'component' | 'onAutoEditHandled' | 'updateConfig' | 'updateState' | 'setHeaderActions'
> & {
  component: CanvasComponent & {
    config: TConfig
    state: TState
    bindings: TBindings
  }
  updateConfig: (patch: Partial<TConfig>, immediate?: boolean) => void
  updateState: (patch: Partial<TState>, immediate?: boolean) => void
  plugin: AtlasRendererPluginContext
  invoke: AtlasRendererPluginInvoke
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
  category?: string
  icon?: LucideIcon
  Renderer: (props: AtlasPluginNodeProps<TConfig, TState, TBindings>) => React.ReactNode
  create?: () => ComponentCreatePatch
  duplicate?: (component: CanvasComponent) => ComponentCreatePatch | null
  getSearchTokens?: (component: CanvasComponent) => string[]
  getDetail?: (component: CanvasComponent) => string | null
  getSubtitle?: (component: CanvasComponent) => string | null
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
  icons: {
    Calculator: LucideIcon
    Puzzle: LucideIcon
  }
  plugin: AtlasRendererPluginContext
  invoke: AtlasRendererPluginInvoke
  sdk: AtlasPluginSdk
  registerNode: (definition: AtlasRendererPluginNodeDefinition) => void
}

export type AtlasRendererPluginRegister = (api: AtlasRendererPluginApi) => void | Promise<void>

export type AtlasRendererPluginModule = {
  default?: AtlasRendererPluginRegister | unknown
  registerPlugin?: AtlasRendererPluginRegister | unknown
}

export function definePlugin(register: AtlasRendererPluginRegister): AtlasRendererPluginRegister {
  return register
}

export function defineNode<
  TConfig extends object = AtlasPluginRecord,
  TState extends object = AtlasPluginRecord,
  TBindings extends object = AtlasPluginRecord
>(
  definition: AtlasRendererPluginNodeDefinition<TConfig, TState, TBindings>
): AtlasRendererPluginNodeDefinition<TConfig, TState, TBindings> {
  return definition
}

export function isRecord(value: unknown): value is AtlasPluginRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readConfig<TConfig extends object>(component: CanvasComponent, defaults: TConfig): TConfig {
  return { ...defaults, ...(isRecord(component.config) ? component.config : {}) } as TConfig
}

export function readState<TState extends object>(component: CanvasComponent, defaults: TState): TState {
  return { ...defaults, ...(isRecord(component.state) ? component.state : {}) } as TState
}

export function readBindings<TBindings extends object>(component: CanvasComponent, defaults: TBindings): TBindings {
  return { ...defaults, ...(isRecord(component.bindings) ? component.bindings : {}) } as TBindings
}

export const atlasPluginSdk: AtlasPluginSdk = {
  definePlugin,
  defineNode,
  isRecord,
  readBindings,
  readConfig,
  readState
}
