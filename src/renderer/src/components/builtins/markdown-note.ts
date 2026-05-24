import { StickyNote } from 'lucide-react'
import { MarkdownNoteComponent } from '../modules/markdown-note-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta, createFileComponentFromSource, fileSourceMatches, optionalString } from './shared'

export function createMarkdownNoteDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('markdown-note'),
    icon: StickyNote,
    Renderer: MarkdownNoteComponent,
    acceptsFile: fileSourceMatches('markdown-note'),
    createFromFile: createFileComponentFromSource('markdown-note'),
    getDetail: (component) => optionalString(component.bindings.path) ?? optionalString(component.bindings.rootPath) ?? null
  }
}
