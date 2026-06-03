import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { Eye, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight, { type Options as RehypeHighlightOptions } from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { asString } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

const MARKDOWN_EDITOR_THEME = EditorView.theme(
  {
    '&': {
      backgroundColor: '#010102',
      color: '#d3cec4'
    },
    '.cm-content': {
      caretColor: '#d8b56d'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#d8b56d'
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgb(177 142 78 / 32%)'
    },
    '.cm-panels': {
      backgroundColor: '#0b0d12',
      color: '#d3cec4'
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgb(230 197 117 / 22%)',
      outline: '1px solid rgb(230 197 117 / 35%)'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgb(164 199 143 / 22%)'
    },
    '.cm-activeLine': {
      backgroundColor: 'rgb(214 184 126 / 7%)'
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgb(164 199 143 / 12%)'
    },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'rgb(216 181 109 / 16%)',
      outline: '1px solid rgb(216 181 109 / 24%)'
    },
    '.cm-gutters': {
      borderRight: '1px solid #242424',
      backgroundColor: '#0b0d12',
      color: '#6f6a62'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgb(214 184 126 / 10%)',
      color: '#b7ab9a'
    },
    '.cm-foldPlaceholder': {
      border: '1px solid #242424',
      backgroundColor: '#090a0d',
      color: '#aaa296'
    },
    '.cm-tooltip': {
      border: '1px solid #242424',
      backgroundColor: '#171a22',
      color: '#d3cec4'
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgb(216 181 109 / 14%)',
      color: '#ebe8df'
    }
  },
  { dark: true }
)

const MARKDOWN_EDITOR_HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: '#e6c575' },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: '#d8d2c6' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#dfb36a' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#d7a06a' },
  { tag: [tags.definition(tags.name), tags.separator], color: '#ebe8df' },
  {
    tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace],
    color: '#d9a66f'
  },
  {
    tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)],
    color: '#c6bfb4'
  },
  { tag: [tags.meta, tags.comment], color: '#817a70' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#c6a879', textDecoration: 'underline' },
  { tag: tags.heading, color: '#f08a84', fontWeight: '600' },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: '#d7a06a' },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: '#a4c78f' },
  { tag: tags.invalid, color: '#f08a84' }
])

const MARKDOWN_EDITOR_SYNTAX = syntaxHighlighting(MARKDOWN_EDITOR_HIGHLIGHT)

const HIGHLIGHT_OPTIONS = {
  detect: true,
  plainText: ['text', 'txt', 'plain'],
  subset: [
    'bash',
    'c',
    'cpp',
    'csharp',
    'css',
    'diff',
    'go',
    'html',
    'ini',
    'java',
    'javascript',
    'json',
    'markdown',
    'php',
    'python',
    'ruby',
    'rust',
    'shell',
    'sql',
    'toml',
    'tsx',
    'typescript',
    'xml',
    'yaml'
  ]
} satisfies RehypeHighlightOptions

export function MarkdownNoteComponent({ component, updateState }: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const content = asString(component.state.content)
  const extensions = useMemo(() => [markdown(), EditorView.lineWrapping, MARKDOWN_EDITOR_SYNTAX], [])

  return (
    <div className="note-module">
      <div className="note-toolbar">
        <button className={mode === 'edit' ? 'segmented segmented--active' : 'segmented'} onClick={() => setMode('edit')}>
          <Pencil size={14} />
          {t('markdown.edit')}
        </button>
        <button className={mode === 'preview' ? 'segmented segmented--active' : 'segmented'} onClick={() => setMode('preview')}>
          <Eye size={14} />
          {t('markdown.preview')}
        </button>
      </div>
      {mode === 'edit' ? (
        <CodeMirror
          className="markdown-editor"
          value={content}
          height="100%"
          theme={MARKDOWN_EDITOR_THEME}
          extensions={extensions}
          basicSetup={{ foldGutter: true, searchKeymap: true, highlightActiveLine: true, syntaxHighlighting: false }}
          onChange={(value) => updateState({ content: value }, false)}
          onBlur={() => updateState({ content }, true)}
        />
      ) : (
        <article className="markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex, [rehypeHighlight, HIGHLIGHT_OPTIONS]]}
          >
            {content}
          </ReactMarkdown>
        </article>
      )}
    </div>
  )
}
