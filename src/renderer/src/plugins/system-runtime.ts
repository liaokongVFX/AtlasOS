import type { AtlasPluginManifest, PluginConfig } from '@shared/plugins'
import type { AtlasRendererPluginApi, AtlasRendererPluginInvoke } from './sdk'
import { createRendererPluginApi, type HostRendererPluginNodeDefinition } from './registration'

export type AtlasSystemRendererPluginApi = Omit<AtlasRendererPluginApi, 'registerNode'> & {
  registerNode: (definition: HostRendererPluginNodeDefinition) => void
}

export type AtlasSystemRendererPlugin = {
  manifest: AtlasPluginManifest
  config?: PluginConfig
  componentTypeForNode?: (nodeId: string) => string
  register: (api: AtlasSystemRendererPluginApi) => void
}

const systemPluginInvoke: AtlasRendererPluginInvoke = async (command) => {
  throw new Error(`System plugin native invoke is not available: ${command}`)
}

export function registerSystemRendererPlugin(plugin: AtlasSystemRendererPlugin): void {
  const api = createRendererPluginApi(
    {
      id: plugin.manifest.id,
      manifest: plugin.manifest,
      config: plugin.config ?? {}
    },
    {
      componentTypeForNode: plugin.componentTypeForNode,
      includeHostHooks: true,
      invoke: systemPluginInvoke
    }
  ) as AtlasSystemRendererPluginApi

  plugin.register(api)
}
