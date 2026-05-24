import { Kanban } from 'lucide-react'
import { translateCurrent } from '../../i18n'
import { KanbanComponent } from '../modules/kanban-component'
import { getKanbanSearchTokens, getKanbanStats, normalizeKanbanState } from '../modules/kanban-model'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta } from './shared'

export function createKanbanDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('kanban'),
    icon: Kanban,
    Renderer: KanbanComponent,
    getDetail: (component) => {
      const stats = getKanbanStats(normalizeKanbanState(component.state.kanban))
      return translateCurrent('kanban.stats', { columns: stats.columnCount, cards: stats.cardCount })
    },
    getSearchTokens: (component) => getKanbanSearchTokens(normalizeKanbanState(component.state.kanban))
  }
}
