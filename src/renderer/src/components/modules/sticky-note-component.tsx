import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import { EditorContent, findParentNode, type ChainedCommands, type Editor, type JSONContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered, Strikethrough, Type, Underline as UnderlineIcon, type LucideIcon } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { type I18nKey, useI18n } from '../../i18n'
import { cn } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'
import {
  STICKY_NOTE_COLORS,
  STICKY_NOTE_FONT_SIZES,
  stickyNoteConfig,
  stickyNoteDocumentFromState,
  stickyNoteInkForColor,
  stickyNotePlainText,
  stickyNoteTitleFromDocument
} from './sticky-note-model'

type StickyNoteComponentProps = AtlasComponentRendererProps & {
  autoEditComponentId?: string | null
  onAutoEditHandled?: (componentId: string) => void
}

const STICKY_NOTE_EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    heading: false,
    horizontalRule: false,
    // A trailing paragraph would become an extra item when switching a selected list.
    trailingNode: false,
    underline: false
  }),
  Underline,
  TextAlign.configure({
    types: ['paragraph'],
    alignments: ['left', 'center', 'right']
  })
]

function autoFontSize(content: string, width: number, height: number): number {
  const textLength = Math.max(content.length, 1)
  const area = Math.max(width * height, 1)
  const density = textLength / area
  if (density > 0.008) return STICKY_NOTE_FONT_SIZES[0].size
  if (density > 0.005) return STICKY_NOTE_FONT_SIZES[1].size
  if (density > 0.003) return STICKY_NOTE_FONT_SIZES[2].size
  return STICKY_NOTE_FONT_SIZES[3].size
}

function stickyNoteTextAlign(node: JSONContent): CSSProperties['textAlign'] | undefined {
  const textAlign = typeof node.attrs?.textAlign === 'string' ? node.attrs.textAlign : null
  return textAlign === 'left' || textAlign === 'center' || textAlign === 'right' ? textAlign : undefined
}

function renderStaticNode(node: JSONContent, key: number): ReactNode {
  if (node.type === 'text') {
    let content: ReactNode = node.text ?? ''
    const marks = Array.isArray(node.marks) ? node.marks : []

    if (marks.some((mark) => mark.type === 'underline')) content = <u>{content}</u>
    if (marks.some((mark) => mark.type === 'strike')) content = <s>{content}</s>
    if (marks.some((mark) => mark.type === 'italic')) content = <em>{content}</em>
    if (marks.some((mark) => mark.type === 'bold')) content = <strong>{content}</strong>

    return <Fragment key={key}>{content}</Fragment>
  }

  if (node.type === 'hardBreak') return <br key={key} />

  const children = Array.isArray(node.content) ? node.content.map(renderStaticNode) : []
  switch (node.type) {
    case 'bulletList':
      return <ul key={key}>{children}</ul>
    case 'orderedList':
      return <ol key={key} start={node.attrs?.start} type={node.attrs?.type}>{children}</ol>
    case 'listItem':
      return <li key={key}>{children}</li>
    case 'paragraph':
      return <p key={key} style={{ textAlign: stickyNoteTextAlign(node) }}>{children.length ? children : <br />}</p>
    default:
      return <Fragment key={key}>{children}</Fragment>
  }
}

const FORMAT_TOOLS: {
  label: I18nKey
  icon: LucideIcon
  active: string | { textAlign: string }
  apply: (chain: ChainedCommands) => ChainedCommands
}[] = [
  { label: 'stickyNote.bold', icon: Bold, active: 'bold', apply: (chain) => chain.toggleBold() },
  { label: 'stickyNote.italic', icon: Italic, active: 'italic', apply: (chain) => chain.toggleItalic() },
  { label: 'stickyNote.underline', icon: UnderlineIcon, active: 'underline', apply: (chain) => chain.toggleUnderline() },
  { label: 'stickyNote.strike', icon: Strikethrough, active: 'strike', apply: (chain) => chain.toggleStrike() },
  { label: 'stickyNote.bulletList', icon: List, active: 'bulletList', apply: (chain) => chain.toggleBulletList() },
  { label: 'stickyNote.orderedList', icon: ListOrdered, active: 'orderedList', apply: (chain) => chain.toggleOrderedList() },
  { label: 'stickyNote.alignLeft', icon: AlignLeft, active: { textAlign: 'left' }, apply: (chain) => chain.setTextAlign('left') },
  { label: 'stickyNote.alignCenter', icon: AlignCenter, active: { textAlign: 'center' }, apply: (chain) => chain.setTextAlign('center') },
  { label: 'stickyNote.alignRight', icon: AlignRight, active: { textAlign: 'right' }, apply: (chain) => chain.setTextAlign('right') }
]

function isListType(type: unknown): boolean {
  return type === 'bulletList' || type === 'orderedList'
}

const findParentList = findParentNode((node) => isListType(node.type.name))

function StickyNoteFormatTools({ editor }: { editor: Editor | null }): JSX.Element {
  const { t } = useI18n()
  const pressed = useEditorState({
    editor,
    selector: () => {
      if (!editor) return []
      const { selection } = editor.state
      const list = findParentList(selection)
      return FORMAT_TOOLS.map(({ active }) => {
        if (list && isListType(active) && selection.to <= list.start + list.node.content.size) {
          return list.node.type.name === active
        }
        return editor.isActive(active)
      })
    }
  })

  return (
    <div className="sticky-note-toolbar__group" role="group" aria-label={t('stickyNote.format')}>
      {FORMAT_TOOLS.map(({ label, icon: Icon, apply }, index) => (
        <button
          key={label}
          type="button"
          className={cn('sticky-note-tool-button', pressed?.[index] && 'sticky-note-tool-button--active')}
          disabled={!editor}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor && apply(editor.chain().focus()).run()}
          aria-pressed={pressed?.[index] ?? false}
          aria-label={t(label)}
          title={t(label)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}

type StickyNoteEditorProps = {
  content: JSONContent
  onDocumentCreate: (document: JSONContent) => void
  onDocumentUpdate: (document: JSONContent) => void
  onEditorChange: (editor: Editor | null) => void
}

function StickyNoteEditor({ content, onDocumentCreate, onDocumentUpdate, onEditorChange }: StickyNoteEditorProps): JSX.Element {
  const { t } = useI18n()
  const shouldFocusEditorRef = useRef(true)

  const editor = useEditor({
    extensions: STICKY_NOTE_EXTENSIONS,
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': t('stickyNote.editorLabel'),
        class: 'sticky-note-editor__content'
      }
    },
    editable: true,
    onUpdate: ({ editor }) => {
      onDocumentUpdate(editor.getJSON())
    },
    onCreate: ({ editor }) => {
      onDocumentCreate(editor.getJSON())
    }
  }, [t])

  useEffect(() => {
    onEditorChange(editor)
    return () => onEditorChange(null)
  }, [editor, onEditorChange])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(true)
  }, [editor])

  useEffect(() => {
    if (!editor || !shouldFocusEditorRef.current) return

    shouldFocusEditorRef.current = false
    window.requestAnimationFrame(() => {
      editor.commands.focus('end')
    })
  }, [editor])

  return <EditorContent editor={editor} className="sticky-note-editor nodrag nowheel" />
}

export function StickyNoteComponent({
  component,
  updateConfig,
  updateState,
  setTitle,
  isNodeSelected,
  autoEditComponentId,
  onAutoEditHandled
}: StickyNoteComponentProps): JSX.Element {
  const { t } = useI18n()
  const config = stickyNoteConfig(component)
  const [isEditing, setIsEditing] = useState(false)
  const [draftPlainText, setDraftPlainText] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const draftDocumentRef = useRef<JSONContent>(stickyNoteDocumentFromState(component.state.document))

  const content = useMemo(() => stickyNoteDocumentFromState(component.state.document), [component.state.document])
  const persistedPlainText = useMemo(() => stickyNotePlainText(content), [content])
  const plainText = isEditing ? draftPlainText : persistedPlainText
  const blocks = Array.isArray(content.content) ? content.content : []
  const showPlaceholder = !isEditing && !plainText && !blocks.some((block) => isListType(block.type))
  const selectedFontSize = STICKY_NOTE_FONT_SIZES.find((item) => item.id === config.fontSizePreset) ?? STICKY_NOTE_FONT_SIZES[1]
  const fontSize = config.autoFontSize
    ? autoFontSize(plainText, component.frame.width, component.frame.height)
    : selectedFontSize.size
  const ink = stickyNoteInkForColor(config.backgroundColor)

  const commitDocument = useCallback((document: JSONContent, immediate = false) => {
    draftDocumentRef.current = document
    updateState({ document }, immediate)

    const title = stickyNoteTitleFromDocument(document)
    if (title !== component.title) {
      setTitle(title)
    }
  }, [component.title, setTitle, updateState])

  const handleDocumentCreate = useCallback((document: JSONContent) => {
    draftDocumentRef.current = document
    setDraftPlainText(stickyNotePlainText(document))
  }, [])

  const handleDocumentUpdate = useCallback((document: JSONContent) => {
    setDraftPlainText(stickyNotePlainText(document))
    commitDocument(document, false)
  }, [commitDocument])

  const handleEditorChange = useCallback((nextEditor: Editor | null) => {
    setEditor((currentEditor) => (currentEditor === nextEditor ? currentEditor : nextEditor))
  }, [])

  const beginEditing = useCallback(() => {
    if (isEditing) return
    draftDocumentRef.current = content
    setDraftPlainText(persistedPlainText)
    setIsEditing(true)
  }, [content, isEditing, persistedPlainText])

  const stopEditing = useCallback(() => {
    commitDocument(draftDocumentRef.current, true)
    setIsEditing(false)
    setEditor(null)
  }, [commitDocument])

  useEffect(() => {
    if (isEditing) return
    draftDocumentRef.current = content
    setDraftPlainText(persistedPlainText)
  }, [content, isEditing, persistedPlainText])

  useEffect(() => {
    if (autoEditComponentId !== component.id) return
    beginEditing()
    onAutoEditHandled?.(component.id)
  }, [autoEditComponentId, beginEditing, component.id, onAutoEditHandled])

  useEffect(() => {
    if (!isNodeSelected && isEditing) stopEditing()
  }, [isEditing, isNodeSelected, stopEditing])

  const setBackgroundColor = useCallback((backgroundColor: string) => {
    updateConfig({ backgroundColor }, true)
  }, [updateConfig])

  const setFontSizePreset = useCallback((fontSizePreset: string) => {
    updateConfig({ fontSizePreset, autoFontSize: false }, true)
  }, [updateConfig])

  const setAutoFontSize = useCallback(() => {
    updateConfig({ autoFontSize: true }, true)
  }, [updateConfig])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !isEditing) {
      event.preventDefault()
      beginEditing()
      return
    }

    if (event.key === 'Escape' && isEditing) {
      event.preventDefault()
      stopEditing()
    }
  }, [beginEditing, isEditing, stopEditing])

  return (
    <div
      className={cn('sticky-note-module', isEditing && 'sticky-note-module--editing')}
      style={{
        '--sticky-note-bg': config.backgroundColor,
        '--sticky-note-ink': ink,
        '--sticky-note-font-size': `${fontSize}px`
      } as CSSProperties}
      onDoubleClick={beginEditing}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {isNodeSelected ? (
        <div className="sticky-note-toolbar nodrag nowheel" aria-label={t('stickyNote.toolbarLabel')}>
          <div className="sticky-note-toolbar__group" role="group" aria-label={t('stickyNote.color')}>
            {STICKY_NOTE_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={cn('sticky-note-swatch', color.value === config.backgroundColor && 'sticky-note-swatch--active')}
                style={{ '--sticky-note-swatch': color.value } as CSSProperties}
                onClick={() => setBackgroundColor(color.value)}
                aria-label={t('stickyNote.colorOption', { color: color.id })}
                title={t('stickyNote.colorOption', { color: color.id })}
              />
            ))}
          </div>
          <div className="sticky-note-toolbar__group" role="group" aria-label={t('stickyNote.fontSize')}>
            <button
              type="button"
              className={cn('sticky-note-tool-button', config.autoFontSize && 'sticky-note-tool-button--active')}
              onClick={setAutoFontSize}
              aria-label={t('stickyNote.autoFontSize')}
              title={t('stickyNote.autoFontSize')}
            >
              <Type size={14} />
            </button>
            {STICKY_NOTE_FONT_SIZES.map((size) => (
              <button
                key={size.id}
                type="button"
                className={cn('sticky-note-tool-button', !config.autoFontSize && size.id === config.fontSizePreset && 'sticky-note-tool-button--active')}
                onClick={() => setFontSizePreset(size.id)}
                aria-label={t('stickyNote.fontSizeOption', { size: size.label })}
                title={t('stickyNote.fontSizeOption', { size: size.label })}
              >
                {size.label}
              </button>
            ))}
          </div>
          <StickyNoteFormatTools editor={editor} />
        </div>
      ) : null}
      <div className="sticky-note-paper">
        {isEditing ? (
          <StickyNoteEditor
            content={draftDocumentRef.current}
            onDocumentCreate={handleDocumentCreate}
            onDocumentUpdate={handleDocumentUpdate}
            onEditorChange={handleEditorChange}
          />
        ) : (
          <div className="sticky-note-editor sticky-note-editor--static">
            <div className="sticky-note-editor__content sticky-note-editor__content--static">{blocks.map(renderStaticNode)}</div>
          </div>
        )}
        {showPlaceholder ? <div className="sticky-note-placeholder">{t('stickyNote.placeholder')}</div> : null}
      </div>
    </div>
  )
}
