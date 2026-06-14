import { StickyNote } from 'lucide-react'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { StickyNoteComponent } from '../modules/sticky-note-component'
import {
  stickyNoteDefaults,
  stickyNoteDetail,
  stickyNoteSearchTokens,
  stickyNoteTitleFromDocument
} from '../modules/sticky-note-model'
import { builtInNodeMeta } from './shared'

export function createStickyNoteDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('sticky-note'),
    icon: StickyNote,
    Renderer: StickyNoteComponent,
    chrome: { variant: 'sticky-note' },
    create: stickyNoteDefaults,
    canDragFromSelectedBody: () => true,
    getDetail: stickyNoteDetail,
    getSearchTokens: stickyNoteSearchTokens,
    duplicate: (component) => ({
      title: stickyNoteTitleFromDocument(component.state.document)
    })
  }
}
