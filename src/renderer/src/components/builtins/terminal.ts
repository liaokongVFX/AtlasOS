import { TerminalSquare } from 'lucide-react'
import { TerminalComponent } from '../modules/terminal-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta, optionalString } from './shared'

export function createTerminalDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('terminal'),
    icon: TerminalSquare,
    Renderer: TerminalComponent,
    chrome: {
      variant: 'terminal',
      titleInputSize: (title) => Math.max(8, title.length)
    },
    dispose: (component) => {
      void window.atlas.terminal.closeComponent(component.id)
    },
    getDetail: (component) => optionalString(component.state.cwd) ?? optionalString(component.config.cwd) ?? null,
    getSubtitle: (component) => optionalString(component.state.cwd) ?? optionalString(component.config.cwd) ?? null
  }
}
