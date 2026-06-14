import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { MarkdownNoteComponent } from './markdown-note-component'

vi.mock('@uiw/react-codemirror', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    default: ({ value }: { value: string }) =>
      React.createElement('textarea', { 'aria-label': 'Markdown editor', readOnly: true, value }),
    EditorView: { lineWrapping: [], theme: () => [] }
  }
})

function createMarkdownComponent(content?: string, state: Record<string, unknown> = {}): CanvasComponent {
  const timestamp = '2026-05-22T00:00:00.000Z'

  return {
    id: 'markdown-note-1',
    type: 'markdown-note',
    title: 'Note',
    frame: { x: 0, y: 0, width: 420, height: 320 },
    zIndex: 1,
    config: {},
    state: content === undefined ? state : { ...state, content },
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function renderMarkdownPreview(content: string): HTMLElement {
  const { container } = render(
    <MarkdownNoteComponent
      canvasId="canvas-1"
      component={createMarkdownComponent(content, { viewMode: 'preview' })}
      updateConfig={vi.fn()}
      updateState={vi.fn()}
      setTitle={vi.fn()}
    />
  )

  return container
}

describe('MarkdownNoteComponent', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders missing note content as empty text', () => {
    render(
      <MarkdownNoteComponent
        canvasId="canvas-1"
        component={createMarkdownComponent()}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox', { name: 'Markdown editor' })).toHaveValue('')
  })

  it('restores the saved preview mode', () => {
    render(
      <MarkdownNoteComponent
        canvasId="canvas-1"
        component={createMarkdownComponent('# Saved preview', { viewMode: 'preview' })}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
      />
    )

    expect(screen.queryByRole('textbox', { name: 'Markdown editor' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Saved preview' })).toBeInTheDocument()
  })

  it('persists switching to preview mode immediately', () => {
    const updateState = vi.fn()

    render(
      <MarkdownNoteComponent
        canvasId="canvas-1"
        component={createMarkdownComponent('# Note')}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByRole('button')[1])

    expect(updateState).toHaveBeenCalledWith({ viewMode: 'preview' }, true)
  })

  it('persists returning to edit mode immediately', () => {
    const updateState = vi.fn()

    render(
      <MarkdownNoteComponent
        canvasId="canvas-1"
        component={createMarkdownComponent('# Note', { viewMode: 'preview' })}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByRole('button')[0])

    expect(updateState).toHaveBeenCalledWith({ viewMode: 'edit' }, true)
  })

  it('renders fenced code blocks with syntax highlighting', () => {
    const container = renderMarkdownPreview('```python\nimport os\nprint(os.path.join("1211"))\n```')
    const code = container.querySelector('pre code')

    expect(code).toHaveClass('hljs')
    expect(code).toHaveClass('language-python')
    expect(code?.querySelector('.hljs-keyword')).toHaveTextContent('import')
  })

  it('detects a language for unlabeled fenced code blocks', () => {
    const container = renderMarkdownPreview('```\nimport os\nprint(os.path.join("1211"))\n```')
    const code = container.querySelector('pre code')

    expect(code).toHaveClass('hljs')
    expect(code?.querySelector('[class^="hljs-"], [class*=" hljs-"]')).toBeInTheDocument()
  })
})
