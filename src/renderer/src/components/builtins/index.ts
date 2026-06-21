import type { AtlasSystemRendererPlugin } from '../../plugins/system-runtime'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { BUILT_IN_SYSTEM_PLUGIN_MANIFEST } from './manifest'
import { createCalendarDefinition } from './calendar'
import { createBrowserDefinition } from './browser'
import { createFilePreviewDefinition } from './file-preview'
import { createFileTreeDefinition } from './file-tree'
import { createKanbanDefinition } from './kanban'
import { createMarkdownNoteDefinition } from './markdown-note'
import { createStickyNoteDefinition } from './sticky-note'
import { createSketchDefinition } from './sketch'
import { createQuickLauncherDefinition } from './quick-launcher'
import { createSystemMonitorDefinition } from './system-monitor'
import { createTerminalDefinition } from './terminal'
import { createGitManagerDefinition } from './git-manager'
import { createClaudeHistoryDefinition } from './claude-history'
import { createCodexHistoryDefinition } from './codex-history'
import { createAgentUsageCalendarDefinition } from './agent-usage-calendar'
import { createRemoteServerDefinition } from './remote-server'

export function createBuiltInComponentDefinitions(): HostRendererPluginNodeDefinition[] {
  return [
    createTerminalDefinition(),
    createFileTreeDefinition(),
    createBrowserDefinition(),
    createMarkdownNoteDefinition(),
    createStickyNoteDefinition(),
    createSketchDefinition(),
    createFilePreviewDefinition(),
    createKanbanDefinition(),
    createQuickLauncherDefinition(),
    createSystemMonitorDefinition(),
    createCalendarDefinition(),
    createGitManagerDefinition(),
    createClaudeHistoryDefinition(),
    createCodexHistoryDefinition(),
    createAgentUsageCalendarDefinition(),
    createRemoteServerDefinition()
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
