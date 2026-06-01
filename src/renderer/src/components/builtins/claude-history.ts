import { MessageSquareText } from 'lucide-react'
import { translateCurrent } from '../../i18n'
import { ClaudeHistoryComponent } from '../modules/claude-history-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta } from './shared'

export function createClaudeHistoryDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('claude-history'),
    icon: MessageSquareText,
    Renderer: ClaudeHistoryComponent,
    getDetail: () => translateCurrent('claudeHistory.detail'),
    getSearchTokens: () => ['claude', 'history', 'resume', 'session', 'transcript'],
    getResizeBehavior: () => ({
      minWidth: 760,
      minHeight: 480
    })
  }
}
