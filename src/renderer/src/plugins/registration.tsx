import { Calculator, Puzzle } from 'lucide-react'
import * as React from 'react'
import {
  pluginComponentType,
  pluginNodeIdSchema,
  type AtlasPluginManifest,
  type PluginConfig
} from '@shared/plugins'
import {
  registerComponentDefinition,
  type AtlasComponentDefinition,
  type AtlasComponentRendererProps
} from '../components/registry'
import {
  atlasPluginSdk,
  type AtlasRendererPluginApi,
  type AtlasRendererPluginContext,
  type AtlasRendererPluginInvoke,
  type AtlasRendererPluginNodeDefinition
} from './sdk'

export type RendererPluginRegistrationTarget = {
  id: string
  manifest: AtlasPluginManifest
  config: PluginConfig
}

export type HostRendererPluginNodeDefinition = AtlasRendererPluginNodeDefinition &
  Partial<
    Pick<
      AtlasComponentDefinition,
      'acceptsFile' | 'canDragFromSelectedBody' | 'chrome' | 'createFromFile' | 'dispose' | 'getResizeBehavior' | 'titleKey'
    >
  >

type RendererPluginRegistrationOptions = {
  componentTypeForNode?: (nodeId: string) => string
  includeHostHooks?: boolean
  invoke?: AtlasRendererPluginInvoke
}

function uniquePermissions(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))]
}

function defaultInvoke(pluginId: string): AtlasRendererPluginInvoke {
  return (command, input) => window.atlas.plugins.invoke(pluginId, command, input)
}

export function createRendererPluginApi(
  plugin: RendererPluginRegistrationTarget,
  options: RendererPluginRegistrationOptions = {}
): AtlasRendererPluginApi {
  const pluginContext: AtlasRendererPluginContext = {
    id: plugin.id,
    manifest: plugin.manifest,
    config: plugin.config
  }
  const invoke = options.invoke ?? defaultInvoke(plugin.id)
  const registeredNodeIds = new Set<string>()

  return {
    React,
    icons: {
      Calculator,
      Puzzle
    },
    plugin: pluginContext,
    invoke,
    sdk: atlasPluginSdk,
    registerNode: (definition) => {
      const nodeId = pluginNodeIdSchema.parse(definition.id)
      if (registeredNodeIds.has(nodeId)) throw new Error(`Plugin node is already registered: ${nodeId}`)

      const manifestNode = plugin.manifest.nodes.find((node) => node.id === nodeId)
      if (!manifestNode) throw new Error(`Plugin node is not declared in manifest: ${nodeId}`)
      if (typeof definition.Renderer !== 'function') throw new Error(`Plugin node renderer is missing: ${nodeId}`)

      const Renderer = ({ setHeaderActions, ...props }: AtlasComponentRendererProps): JSX.Element =>
        React.createElement(definition.Renderer, {
          ...props,
          ...(options.includeHostHooks ? { setHeaderActions } : {}),
          plugin: pluginContext,
          invoke
        })

      const hostDefinition = definition as HostRendererPluginNodeDefinition
      const componentDefinition: AtlasComponentDefinition = {
        type: options.componentTypeForNode?.(nodeId) ?? pluginComponentType(plugin.id, nodeId),
        title: definition.title ?? manifestNode.title,
        titleKey: options.includeHostHooks ? hostDefinition.titleKey : undefined,
        defaultFrame: definition.defaultFrame ?? manifestNode.defaultFrame,
        permissions: uniquePermissions(plugin.manifest.permissions, manifestNode.permissions, definition.permissions),
        creatable: definition.creatable ?? manifestNode.creatable,
        icon: definition.icon ?? Puzzle,
        Renderer,
        pluginId: plugin.id,
        create: definition.create,
        duplicate: definition.duplicate,
        getSearchTokens: definition.getSearchTokens,
        getDetail: definition.getDetail,
        getSubtitle: definition.getSubtitle
      }

      if (options.includeHostHooks) {
        componentDefinition.acceptsFile = hostDefinition.acceptsFile
        componentDefinition.chrome = hostDefinition.chrome
        componentDefinition.canDragFromSelectedBody = hostDefinition.canDragFromSelectedBody
        componentDefinition.createFromFile = hostDefinition.createFromFile
        componentDefinition.dispose = hostDefinition.dispose
        componentDefinition.getResizeBehavior = hostDefinition.getResizeBehavior
      }

      registeredNodeIds.add(nodeId)
      registerComponentDefinition(componentDefinition)
    }
  }
}
