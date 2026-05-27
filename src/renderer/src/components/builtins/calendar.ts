import { CalendarDays } from 'lucide-react'
import { translateCurrent } from '../../i18n'
import { asBoolean } from '../../lib/utils'
import { CalendarComponent } from '../modules/calendar-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta } from './shared'

export function createCalendarDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('calendar'),
    icon: CalendarDays,
    Renderer: CalendarComponent,
    getDetail: () => translateCurrent('calendar.detail'),
    getSearchTokens: () => ['calendar', 'date', 'time', 'clock', 'today'],
    getResizeBehavior: (component) =>
      asBoolean(component.state.compact)
        ? {
            minWidth: 220,
            minHeight: 120
          }
        : {
            minWidth: 380,
            minHeight: 340
          }
  }
}
