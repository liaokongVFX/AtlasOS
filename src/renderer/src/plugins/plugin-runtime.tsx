import {
  type AtlasPluginManifest,
  type PluginInfo
} from '@shared/plugins'
import { unregisterComponentDefinitionsByPlugin } from '../components/registry'
import {
  type AtlasRendererPluginModule
} from './sdk'
import { createRendererPluginApi } from './registration'

const loadedRendererPluginRevisions = new Map<string, string>()

function rendererRevision(plugin: PluginInfo): string {
  return `${plugin.enabled}:${plugin.updatedAt}:${plugin.rendererEntryUrl ?? ''}`
}

function revisionedModuleUrl(url: string, revision: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('atlasPluginRevision', revision)
  return parsed.toString()
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
