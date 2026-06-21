import { Server } from 'lucide-react'
import { RemoteServerComponent } from '../modules/remote-server-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta, optionalString } from './shared'

export function createRemoteServerDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('remote-server'),
    icon: Server,
    Renderer: RemoteServerComponent,
    dispose: (component) => {
      void window.atlas.remoteServers.closeComponent(component.id)
    },
    getDetail: (component) => optionalString(component.state.activeProfileId) ?? null
  }
}
