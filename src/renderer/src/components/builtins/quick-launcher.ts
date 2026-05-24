import { Rocket } from 'lucide-react'
import { QuickLauncherComponent } from '../modules/quick-launcher-component'
import {
  getQuickLauncherSearchTokens,
  getQuickLauncherStats,
  normalizeQuickLauncherState
} from '../modules/quick-launcher-model'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta } from './shared'

export function createQuickLauncherDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('quick-launcher'),
    icon: Rocket,
    Renderer: QuickLauncherComponent,
    getDetail: (component) => {
      const stats = getQuickLauncherStats(normalizeQuickLauncherState(component.state))
      return `${stats.itemCount} shortcuts`
    },
    getSearchTokens: (component) => getQuickLauncherSearchTokens(normalizeQuickLauncherState(component.state)),
    getResizeBehavior: () => ({
      minWidth: 460,
      minHeight: 360
    })
  }
}
