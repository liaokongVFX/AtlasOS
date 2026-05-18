import { FileCode, FolderTree, Globe2, StickyNote, TerminalSquare } from 'lucide-react'
import type { ComponentType, CanvasComponent } from '@shared/schema'
import { BrowserComponent } from './modules/browser-component'
import { FilePreviewComponent } from './modules/file-preview-component'
import { FileTreeComponent } from './modules/file-tree-component'
import { MarkdownNoteComponent } from './modules/markdown-note-component'
import { TerminalComponent } from './modules/terminal-component'
import { COMPONENT_DEFINITIONS, type ComponentDefinitionMeta } from './component-definitions'

export type AtlasComponentRendererProps = {
  canvasId: string
  component: CanvasComponent
  updateConfig: (patch: Record<string, unknown>, immediate?: boolean) => void
  updateState: (patch: Record<string, unknown>, immediate?: boolean) => void
  setTitle: (title: string) => void
}

export type AtlasComponentDefinition = ComponentDefinitionMeta & {
  icon: typeof TerminalSquare
  Renderer: (props: AtlasComponentRendererProps) => JSX.Element
}

export const componentRegistry: Record<ComponentType, AtlasComponentDefinition> = {
  terminal: {
    ...COMPONENT_DEFINITIONS.terminal,
    icon: TerminalSquare,
    Renderer: TerminalComponent
  },
  'file-tree': {
    ...COMPONENT_DEFINITIONS['file-tree'],
    icon: FolderTree,
    Renderer: FileTreeComponent
  },
  browser: {
    ...COMPONENT_DEFINITIONS.browser,
    icon: Globe2,
    Renderer: BrowserComponent
  },
  'markdown-note': {
    ...COMPONENT_DEFINITIONS['markdown-note'],
    icon: StickyNote,
    Renderer: MarkdownNoteComponent
  },
  'file-preview': {
    ...COMPONENT_DEFINITIONS['file-preview'],
    icon: FileCode,
    Renderer: FilePreviewComponent
  }
}
