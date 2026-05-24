import { Calculator, Puzzle } from 'lucide-react'
import * as React from 'react'
import {
  pluginComponentType,
  pluginNodeIdSchema,
  type AtlasPluginManifest,
  type PluginInfo
} from '@shared/plugins'
import {
  registerComponentDefinition,
  unregisterComponentDefinitionsByPlugin,
  type AtlasComponentRendererProps
} from '../components/registry'
import {
  atlasPluginSdk,
  type AtlasRendererPluginApi,
  type AtlasRendererPluginContext,
  type AtlasRendererPluginInvoke,
  type AtlasRendererPluginModule
} from './sdk'

const loadedRendererPluginRevisions = new Map<string, string>()

function rendererRevision(plugin: PluginInfo): string {
  return `${plugin.enabled}:${plugin.updatedAt}:${plugin.rendererEntryUrl ?? ''}`
}

function revisionedModuleUrl(url: string, revision: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('atlasPluginRevision', revision)
  return parsed.toString()
}

function uniquePermissions(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))]
}

function createRendererPluginApi(plugin: PluginInfo & { manifest: AtlasPluginManifest; rendererEntryUrl: string }): AtlasRendererPluginApi {
  const pluginContext: AtlasRendererPluginContext = {
    id: plugin.id,
    manifest: plugin.manifest,
    config: plugin.config
  }
  const invoke: AtlasRendererPluginInvoke = (command, input) => window.atlas.plugins.invoke(plugin.id, command, input)
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

      const Renderer = (props: AtlasComponentRendererProps): JSX.Element =>
        React.createElement(definition.Renderer, {
          ...props,
          plugin: pluginContext,
          invoke
        })

      registeredNodeIds.add(nodeId)
      registerComponentDefinition({
        type: pluginComponentType(plugin.id, nodeId),
        title: definition.title ?? manifestNode.title,
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
      })
    }
  }
}

function isRenderablePlugin(plugin: PluginInfo): plugin is PluginInfo & { manifest: AtlasPluginManifest; rendererEntryUrl: string } {
  return Boolean(plugin.enabled && plugin.manifest?.renderer && plugin.rendererEntryUrl)
}

export async function syncRendererPlugins(options: { force?: boolean } = {}): Promise<PluginInfo[]> {
  const plugins = await window.atlas.plugins.list()
  const renderablePlugins = plugins.filter(isRenderablePlugin)
  const activePluginIds = new Set(renderablePlugins.map((plugin) => plugin.id))

  for (const pluginId of [...loadedRendererPluginRevisions.keys()]) {
    if (activePluginIds.has(pluginId)) continue

    unregisterComponentDefinitionsByPlugin(pluginId)
    loadedRendererPluginRevisions.delete(pluginId)
  }

  for (const plugin of renderablePlugins) {
    const revision = rendererRevision(plugin)
    if (!options.force && loadedRendererPluginRevisions.get(plugin.id) === revision) continue

    unregisterComponentDefinitionsByPlugin(plugin.id)
    loadedRendererPluginRevisions.delete(plugin.id)

    try {
      const module = (await import(/* @vite-ignore */ revisionedModuleUrl(plugin.rendererEntryUrl, revision))) as AtlasRendererPluginModule
      const register = typeof module.registerPlugin === 'function' ? module.registerPlugin : module.default

      if (typeof register !== 'function') {
        throw new Error(`Plugin renderer does not export registerPlugin(api): ${plugin.id}`)
      }

      await register(createRendererPluginApi(plugin))
      loadedRendererPluginRevisions.set(plugin.id, revision)
    } catch (error) {
      console.error('Failed to load AtlasOS renderer plugin', plugin.id, error)
    }
  }

  return plugins
}
