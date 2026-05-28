import { GitBranch } from 'lucide-react'
import { GitManagerComponent } from '../modules/git-manager-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta, optionalString } from './shared'

export function createGitManagerDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('git-manager'),
    icon: GitBranch,
    Renderer: GitManagerComponent,
    getDetail: (component) => optionalString(component.config.repoPath) ?? null
  }
}
