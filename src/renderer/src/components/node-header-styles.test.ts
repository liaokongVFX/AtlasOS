import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function styleRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('node header styles', () => {
  it('keeps canvas node headers as drag surfaces while title editing uses the text cursor', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styleRule(css, '.component-node__header')).toContain('cursor: grab;')
    expect(styleRule(css, '.component-node__header:active')).toContain('cursor: grabbing;')
    expect(styleRule(css, '.component-node__title input')).toContain('cursor: text;')
    expect(styleRule(css, '.component-node__title-display')).toContain('cursor: inherit;')

    expect(styleRule(css, '.canvas-group-node__header')).toContain('cursor: grab;')
    expect(styleRule(css, '.canvas-group-node__header:active')).toContain('cursor: grabbing;')
    expect(styleRule(css, '.canvas-group-node__header span')).toContain('cursor: inherit;')
  })

  it('uses the default cursor for selected document and file tree bodies', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styleRule(css, '.component-node--selected .note-module')).toContain('cursor: default;')
    expect(styleRule(css, '.component-node--selected .file-tree-module')).toContain('cursor: default;')
    expect(styleRule(css, '.component-node--selected .markdown-editor .cm-scroller')).toContain('cursor: default;')
    expect(styleRule(css, '.component-node--selected .markdown-editor .cm-content')).toContain('cursor: default;')
    expect(styleRule(css, '.component-node--selected .file-preview-code .cm-scroller')).toContain('cursor: default;')
    expect(styleRule(css, '.component-node--selected .file-preview-code .cm-content')).toContain('cursor: default;')
  })

  it('keeps the terminal right resize hit area off the xterm scrollbar', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(
      styleRule(css, '.canvas-board .component-node--terminal .react-flow__resize-control.component-node__resize-line.right')
    ).toContain('transform: translate(0, 0);')
    expect(
      styleRule(css, '.canvas-board .component-node--terminal .react-flow__resize-control.component-node__resize-line.right::after')
    ).toContain('left: 0;')
    expect(
      styleRule(css, '.canvas-board .component-node--terminal .react-flow__resize-control.component-node__resize-line.right::after')
    ).toContain('transform: none;')
  })
})
