import type { JSONContent } from '@tiptap/react'
import type { CanvasComponent } from '@shared/schema'
import { asString } from '../../lib/utils'

export const STICKY_NOTE_DEFAULT_COLOR = '#ffd966'
export const STICKY_NOTE_DEFAULT_FONT_SIZE = 'medium'
export const STICKY_NOTE_FALLBACK_TITLE = 'Sticky Note'

export const STICKY_NOTE_COLORS = [
  { id: 'yellow', value: '#ffd966', ink: '#20180a' },
  { id: 'pink', value: '#ffb3c7', ink: '#2a0d17' },
  { id: 'blue', value: '#9fd8ff', ink: '#081d2b' },
  { id: 'green', value: '#b9f6c2', ink: '#0b2510' },
  { id: 'orange', value: '#ffbf80', ink: '#2a1400' },
  { id: 'purple', value: '#d7b7ff', ink: '#1b0c2f' },
  { id: 'white', value: '#fff2cc', ink: '#211b0a' }
] as const

export const STICKY_NOTE_FONT_SIZES = [
  { id: 'small', label: 'S', size: 18 },
  { id: 'medium', label: 'M', size: 22 },
  { id: 'large', label: 'L', size: 28 },
  { id: 'x-large', label: 'XL', size: 34 }
] as const

export type StickyNoteColor = (typeof STICKY_NOTE_COLORS)[number]['value']
export type StickyNoteFontSize = (typeof STICKY_NOTE_FONT_SIZES)[number]['id']

export type StickyNoteConfig = {
  backgroundColor: StickyNoteColor
  fontSizePreset: StickyNoteFontSize
  autoFontSize: boolean
}

export const EMPTY_STICKY_NOTE_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph'
    }
  ]
}

export function createStickyNoteDocument(text = ''): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : undefined
      }
    ]
  }
}

export function stickyNoteDefaults(): { config: StickyNoteConfig; state: { document: JSONContent } } {
  return {
    config: {
      backgroundColor: STICKY_NOTE_DEFAULT_COLOR,
      fontSizePreset: STICKY_NOTE_DEFAULT_FONT_SIZE,
      autoFontSize: false
    },
    state: {
      document: createStickyNoteDocument()
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonContent(value: unknown): value is JSONContent {
  return isRecord(value) && typeof value.type === 'string'
}

function nodeText(value: unknown): string {
  if (!isRecord(value)) return ''
  if (typeof value.text === 'string') return value.text

  if (!Array.isArray(value.content)) return ''

  return value.content.map(nodeText).join('')
}

export function stickyNoteDocumentFromState(value: unknown): JSONContent {
  return isJsonContent(value) ? value : EMPTY_STICKY_NOTE_DOCUMENT
}

export function stickyNotePlainText(value: unknown): string {
  const document = stickyNoteDocumentFromState(value)
  const blocks = Array.isArray(document.content) ? document.content.map(nodeText) : []
  return blocks.join('\n').trim()
}

export function stickyNoteTitleFromDocument(value: unknown): string {
  return stickyNotePlainText(value).split(/\r?\n/).find((line) => line.trim())?.trim() || STICKY_NOTE_FALLBACK_TITLE
}

export function stickyNoteSearchTokens(component: CanvasComponent): string[] {
  const text = stickyNotePlainText(component.state.document)
  return [component.title, text, 'sticky note', 'note'].filter((value): value is string => Boolean(value))
}

export function stickyNoteDetail(component: CanvasComponent): string | null {
  const text = stickyNotePlainText(component.state.document)
  return text ? text.slice(0, 120) : null
}

export function stickyNoteConfig(component: CanvasComponent): StickyNoteConfig {
  const color = asString(component.config.backgroundColor)
  const fontSize = asString(component.config.fontSizePreset)

  return {
    backgroundColor: STICKY_NOTE_COLORS.some((item) => item.value === color) ? (color as StickyNoteColor) : STICKY_NOTE_DEFAULT_COLOR,
    fontSizePreset: STICKY_NOTE_FONT_SIZES.some((item) => item.id === fontSize) ? (fontSize as StickyNoteFontSize) : STICKY_NOTE_DEFAULT_FONT_SIZE,
    autoFontSize: component.config.autoFontSize === true
  }
}

export function stickyNoteInkForColor(color: string): string {
  return STICKY_NOTE_COLORS.find((item) => item.value === color)?.ink ?? STICKY_NOTE_COLORS[0].ink
}
