import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import CodeMirror from '@uiw/react-codemirror'
import { Eye, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useMemo, useState } from 'react'
import { asString } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

const DEFAULT_NOTE = `# AtlasOS note

Use Markdown for durable workspace notes.
`

export function MarkdownNoteComponent({ component, updateState }: AtlasComponentRendererProps): JSX.Element {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const content = asString(component.state.content, DEFAULT_NOTE)
  const extensions = useMemo(() => [markdown()], [])

  return (
    <div className="note-module">
      <div className="note-toolbar">
        <button className={mode === 'edit' ? 'segmented segmented--active' : 'segmented'} onClick={() => setMode('edit')}>
          <Pencil size={14} />
          Edit
        </button>
        <button className={mode === 'preview' ? 'segmented segmented--active' : 'segmented'} onClick={() => setMode('preview')}>
          <Eye size={14} />
          Preview
        </button>
      </div>
      {mode === 'edit' ? (
        <CodeMirror
          value={content}
          height="100%"
          theme={oneDark}
          extensions={extensions}
          basicSetup={{ foldGutter: true, searchKeymap: true, highlightActiveLine: true }}
          onChange={(value) => updateState({ content: value }, false)}
          onBlur={() => updateState({ content }, true)}
        />
      ) : (
        <article className="markdown-preview">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {content}
          </ReactMarkdown>
        </article>
      )}
    </div>
  )
}
