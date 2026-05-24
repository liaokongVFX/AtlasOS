import { describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { defineNode, definePlugin, readBindings, readConfig, readState } from './sdk'

const component = {
  id: 'component-1',
  type: 'plugin:acme.counter/counter',
  title: 'Counter',
  frame: { x: 0, y: 0, width: 320, height: 240 },
  zIndex: 1,
  config: { step: 2 },
  state: { count: 4 },
  bindings: { path: 'D:\\workspace' },
  createdAt: '2026-05-21T00:00:00.000Z',
  updatedAt: '2026-05-21T00:00:00.000Z'
} satisfies CanvasComponent

describe('plugin SDK helpers', () => {
  it('preserves plugin register and node definitions for typed authoring', () => {
    const register = vi.fn()
    const Renderer = () => null
    const node = defineNode({ id: 'counter', Renderer })

    expect(definePlugin(register)).toBe(register)
    expect(node).toEqual({ id: 'counter', Renderer })
  })

  it('reads config, state, and bindings with defaults for old documents', () => {
    expect(readConfig(component, { step: 1, compact: false })).toEqual({ step: 2, compact: false })
    expect(readState(component, { count: 0, label: 'Draft' })).toEqual({ count: 4, label: 'Draft' })
    expect(readBindings(component, { path: '', rootPath: '' })).toEqual({ path: 'D:\\workspace', rootPath: '' })
  })
})
