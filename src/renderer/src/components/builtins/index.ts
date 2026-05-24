import type { AtlasSystemRendererPlugin } from '../../plugins/system-runtime'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { BUILT_IN_SYSTEM_PLUGIN_MANIFEST } from './manifest'
import { createBrowserDefinition } from './browser'
import { createFilePreviewDefinition } from './file-preview'
import { createFileTreeDefinition } from './file-tree'
import { createKanbanDefinition } from './kanban'
import { createMarkdownNoteDefinition } from './markdown-note'
import { createQuickLauncherDefinition } from './quick-launcher'
import { createTerminalDefinition } from './terminal'

export function createBuiltInComponentDefinitions(): HostRendererPluginNodeDefinition[] {
  return [
    createTerminalDefinition(),
    createFileTreeDefinition(),
    createBrowserDefinition(),
    createMarkdownNoteDefinition(),
    createFilePreviewDefinition(),
    createKanbanDefinition(),
    createQuickLauncherDefinition()
  ]
}

export function createBuiltInSystemPlugin(): AtlasSystemRendererPlugin {
  return {
    manifest: BUILT_IN_SYSTEM_PLUGIN_MANIFEST,
    componentTypeForNode: (nodeId) => nodeId,
    register: (api) => {
      for (const definition of createBuiltInComponentDefinitions()) {
        api.registerNode(definition)
      }
    }
  }
}
