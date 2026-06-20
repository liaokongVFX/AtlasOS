import { CalendarDays } from 'lucide-react'
import { translateCurrent } from '../../i18n'
import { AgentUsageCalendarComponent } from '../modules/agent-usage-calendar-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta } from './shared'

export function createAgentUsageCalendarDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('agent-usage-calendar'),
    icon: CalendarDays,
    Renderer: AgentUsageCalendarComponent,
    getDetail: () => translateCurrent('agentUsage.detail'),
    getSearchTokens: () => ['agent', 'usage', 'calendar', 'token', 'claude', 'codex', 'summary', 'daily'],
    getResizeBehavior: () => ({
      minWidth: 820,
      minHeight: 540
    })
  }
}
