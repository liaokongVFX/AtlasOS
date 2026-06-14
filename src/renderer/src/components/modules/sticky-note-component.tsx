import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import { EditorContent, type Editor, type JSONContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Type, Underline as UnderlineIcon } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
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
    bulletList: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    orderedList: false,
    strike: false
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

function renderStaticInlineNode(node: JSONContent, key: string): ReactNode {
  if (node.type === 'text') {
    let content: ReactNode = node.text ?? ''
    const marks = Array.isArray(node.marks) ? node.marks : []

    if (marks.some((mark) => mark.type === 'underline')) content = <u>{content}</u>
    if (marks.some((mark) => mark.type === 'italic')) content = <em>{content}</em>
    if (marks.some((mark) => mark.type === 'bold')) content = <strong>{content}</strong>

    return <Fragment key={key}>{content}</Fragment>
  }

  if (node.type === 'hardBreak') return <br key={key} />

  if (Array.isArray(node.content)) {
    return <Fragment key={key}>{node.content.map((child, index) => renderStaticInlineNode(child, `${key}-${index}`))}</Fragment>
  }

  return null
}

function renderStaticDocument(document: JSONContent): ReactNode {
  const blocks = Array.isArray(document.content) ? document.content : []

  return blocks.map((block, blockIndex) => {
    const inlineNodes = Array.isArray(block.content)
      ? block.content.map((child, childIndex) => renderStaticInlineNode(child, `${blockIndex}-${childIndex}`))
      : []
    const textAlign = stickyNoteTextAlign(block)

    return (
      <p key={blockIndex} style={textAlign ? { textAlign } : undefined}>
        {inlineNodes.length > 0 ? inlineNodes : <br />}
      </p>
    )
  })
}

type StickyNoteEditorProps = {
  content: JSONContent
  onDocumentCreate: (document: JSONContent, text: string) => void
  onDocumentUpdate: (document: JSONContent, text: string) => void
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
      onDocumentUpdate(editor.getJSON(), editor.getText().trim())
    },
    onCreate: ({ editor }) => {
      onDocumentCreate(editor.getJSON(), editor.getText().trim())
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

  const handleDocumentCreate = useCallback((document: JSONContent, text: string) => {
    draftDocumentRef.current = document
    setDraftPlainText(text)
  }, [])

  const handleDocumentUpdate = useCallback((document: JSONContent, text: string) => {
    draftDocumentRef.current = document
    setDraftPlainText(text)
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

  const toggleMark = useCallback((mark: 'bold' | 'italic' | 'underline') => {
    if (!editor || !isEditing) return
    if (mark === 'bold') editor.chain().focus().toggleBold().run()
    if (mark === 'italic') editor.chain().focus().toggleItalic().run()
    if (mark === 'underline') editor.chain().focus().toggleUnderline().run()
    handleDocumentUpdate(editor.getJSON(), editor.getText().trim())
  }, [editor, handleDocumentUpdate, isEditing])

  const setAlignment = useCallback((alignment: 'left' | 'center' | 'right') => {
    if (!editor || !isEditing) return
    editor.chain().focus().setTextAlign(alignment).run()
    handleDocumentUpdate(editor.getJSON(), editor.getText().trim())
  }, [editor, handleDocumentUpdate, isEditing])

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
          <div className="sticky-note-toolbar__group" role="group" aria-label={t('stickyNote.format')}>
            <button
              type="button"
              className={cn('sticky-note-tool-button', editor?.isActive('bold') && 'sticky-note-tool-button--active')}
              disabled={!editor}
              onClick={() => toggleMark('bold')}
              aria-label={t('stickyNote.bold')}
              title={t('stickyNote.bold')}
            >
              <Bold size={14} />
            </button>
            <button
              type="button"
              className={cn('sticky-note-tool-button', editor?.isActive('italic') && 'sticky-note-tool-button--active')}
              disabled={!editor}
              onClick={() => toggleMark('italic')}
              aria-label={t('stickyNote.italic')}
              title={t('stickyNote.italic')}
            >
              <Italic size={14} />
            </button>
            <button
              type="button"
              className={cn('sticky-note-tool-button', editor?.isActive('underline') && 'sticky-note-tool-button--active')}
              disabled={!editor}
              onClick={() => toggleMark('underline')}
              aria-label={t('stickyNote.underline')}
              title={t('stickyNote.underline')}
            >
              <UnderlineIcon size={14} />
            </button>
            <button
              type="button"
              className={cn('sticky-note-tool-button', editor?.isActive({ textAlign: 'left' }) && 'sticky-note-tool-button--active')}
              disabled={!editor}
              onClick={() => setAlignment('left')}
              aria-label={t('stickyNote.alignLeft')}
              title={t('stickyNote.alignLeft')}
            >
              <AlignLeft size={14} />
            </button>
            <button
              type="button"
              className={cn('sticky-note-tool-button', editor?.isActive({ textAlign: 'center' }) && 'sticky-note-tool-button--active')}
              disabled={!editor}
              onClick={() => setAlignment('center')}
              aria-label={t('stickyNote.alignCenter')}
              title={t('stickyNote.alignCenter')}
            >
              <AlignCenter size={14} />
            </button>
            <button
              type="button"
              className={cn('sticky-note-tool-button', editor?.isActive({ textAlign: 'right' }) && 'sticky-note-tool-button--active')}
              disabled={!editor}
              onClick={() => setAlignment('right')}
              aria-label={t('stickyNote.alignRight')}
              title={t('stickyNote.alignRight')}
            >
              <AlignRight size={14} />
            </button>
          </div>
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
            <div className="sticky-note-editor__content sticky-note-editor__content--static">{renderStaticDocument(content)}</div>
          </div>
        )}
        {!plainText && !isEditing ? <div className="sticky-note-placeholder">{t('stickyNote.placeholder')}</div> : null}
      </div>
    </div>
  )
}
