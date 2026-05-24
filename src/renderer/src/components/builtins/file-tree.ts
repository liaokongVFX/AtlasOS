import { FolderTree } from 'lucide-react'
import { FileTreeComponent } from '../modules/file-tree-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta, createFileComponentFromSource, fileSourceMatches, optionalString } from './shared'

export function createFileTreeDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('file-tree'),
    icon: FolderTree,
    Renderer: FileTreeComponent,
    acceptsFile: fileSourceMatches('file-tree'),
    createFromFile: createFileComponentFromSource('file-tree'),
    getDetail: (component) => optionalString(component.config.rootPath) ?? optionalString(component.bindings.rootPath) ?? null
  }
}
