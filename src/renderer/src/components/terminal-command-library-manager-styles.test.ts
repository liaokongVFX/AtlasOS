import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function styleRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('terminal command library drag styles', () => {
  it('keeps the compact empty command shelf text-only and non-scrollable', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const commandList = styleRule(css, '.terminal-command-list')
    const compactEmptyList = styleRule(css, '.terminal-module__commands .terminal-command-list--empty')
    const compactEmptyState = styleRule(css, '.terminal-module__commands .terminal-command-empty')

    expect(commandList).toContain('overflow: hidden auto;')
    expect(compactEmptyList).toContain('height: 100%;')
    expect(compactEmptyList).toContain('align-content: center;')
    expect(compactEmptyList).toContain('overflow: hidden;')
    expect(compactEmptyState).toContain('min-height: 0;')
    expect(compactEmptyState).toContain('border: 0;')
  })

  it('collapses dragged category tabs and compact command rows', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const categoryDragging = styleRule(css, '.terminal-command-category-tab--dragging')
    const categoryDraggingChildren = styleRule(css, '.terminal-command-category-tab--dragging > *')
    const compactCommandDragging = styleRule(css, '.terminal-command-row--compact.terminal-command-row--dragging')
    const compactCommandDraggingChildren = styleRule(css, '.terminal-command-row--compact.terminal-command-row--dragging > *')

    expect(categoryDragging).toContain('flex: 0 0 0;')
    expect(categoryDragging).toContain('width: 0;')
    expect(categoryDragging).toContain('opacity: 0;')
    expect(categoryDraggingChildren).toContain('visibility: hidden;')

    expect(compactCommandDragging).toContain('position: absolute;')
    expect(compactCommandDragging).toContain('flex: 0 0 0;')
    expect(compactCommandDragging).toContain('width: 0;')
    expect(compactCommandDragging).toContain('height: 0;')
    expect(compactCommandDragging).toContain('opacity: 0;')
    expect(compactCommandDraggingChildren).toContain('visibility: hidden;')
  })

  it('uses a separate compact placeholder and keeps compact command hover cursor neutral', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const compactCommandPlaceholder = styleRule(css, '.terminal-command-row--compact.terminal-command-row--placeholder')
    const compactCommandMain = styleRule(css, '.terminal-command-row--compact .terminal-command-row__main')
    const compactCommandMainActive = styleRule(css, '.terminal-command-row--compact .terminal-command-row__main:active')

    expect(compactCommandPlaceholder).toContain('flex: 0 0 auto;')
    expect(compactCommandPlaceholder).toContain('opacity: 0;')
    expect(compactCommandPlaceholder).toContain('pointer-events: none;')

    expect(compactCommandMain).toContain('cursor: default;')
    expect(compactCommandMainActive).toContain('cursor: default;')
  })
})
