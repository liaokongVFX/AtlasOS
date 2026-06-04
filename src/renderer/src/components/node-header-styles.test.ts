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
})
