import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function styleRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('sketch styles', () => {
  it('keeps Excalidraw light theme controls readable', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    const rule = styleRule(css, '.sketch-editor .excalidraw')

    expect(rule).toContain('color-scheme: light;')
    expect(rule).not.toContain('--island-bg-color')
    expect(rule).not.toContain('--popup-bg-color')
    expect(rule).not.toContain('--button-gray-')
    expect(rule).not.toContain('color-scheme: dark;')
  })

  it('hides the embedded Excalidraw main menu trigger', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styleRule(css, '.sketch-editor .excalidraw .main-menu-trigger')).toContain('display: none;')
  })

  it('anchors the Excalidraw SVG trail layer to the sketch viewport', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styleRule(css, '.sketch-editor .excalidraw .SVGLayer')).toContain('position: absolute;')
    expect(styleRule(css, '.sketch-editor .excalidraw .SVGLayer')).toContain('inset: 0;')
    expect(styleRule(css, '.sketch-editor .excalidraw .SVGLayer svg')).toContain(
      'transform: translate(var(--sketch-excalidraw-svg-offset-x, 0), var(--sketch-excalidraw-svg-offset-y, 0));'
    )
  })

  it('prevents Atlas global scrollbars from drawing a dark edge on the properties menu', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styleRule(css, '.sketch-editor .excalidraw .App-menu__left')).toContain('scrollbar-color: var(--scrollbar-thumb) transparent;')
    expect(styleRule(css, '.sketch-editor .excalidraw .App-menu__left::-webkit-scrollbar-track')).toContain('background: transparent;')
    expect(styleRule(css, '.sketch-editor .excalidraw .App-menu__left::-webkit-scrollbar-thumb')).toContain('border: 0;')
  })
})
