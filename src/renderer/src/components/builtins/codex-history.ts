import { BotMessageSquare } from 'lucide-react'
import { translateCurrent } from '../../i18n'
import { CodexHistoryComponent } from '../modules/codex-history-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta } from './shared'

export function createCodexHistoryDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('codex-history'),
    icon: BotMessageSquare,
    Renderer: CodexHistoryComponent,
    getDetail: () => translateCurrent('codexHistory.detail'),
    getSearchTokens: () => ['codex', 'history', 'resume', 'session', 'transcript'],
    getResizeBehavior: () => ({
      minWidth: 760,
      minHeight: 480
    })
  }
}
