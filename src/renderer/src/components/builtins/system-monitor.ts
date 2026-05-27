import { Cpu } from 'lucide-react'
import { translateCurrent } from '../../i18n'
import { SystemMonitorComponent } from '../modules/system-monitor-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta } from './shared'

export function createSystemMonitorDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('system-monitor'),
    icon: Cpu,
    Renderer: SystemMonitorComponent,
    getDetail: () => translateCurrent('systemMonitor.detail'),
    getSearchTokens: () => ['system', 'monitor', 'cpu', 'memory'],
    getResizeBehavior: () => ({
      minWidth: 420,
      minHeight: 300
    })
  }
}
