import type { ClientRect } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'
import { previewTerminalCommandOrder, terminalCommandDragRenderEntries } from './terminal-command-library-manager'

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width
  }
}

describe('previewTerminalCommandOrder', () => {
  it('opens a middle placeholder before the hovered chip when dragging over its left half', () => {
    const commandIds = ['dev', 'test', 'ship']

    expect(previewTerminalCommandOrder(commandIds, 'ship', 'test', rect(126, 100, 80, 30), rect(180, 100, 80, 30))).toEqual([
      'dev',
      'ship',
      'test'
    ])
  })

  it('keeps the dragged command after the hovered chip when dragging over its right half', () => {
    const commandIds = ['dev', 'test', 'ship']

    expect(previewTerminalCommandOrder(commandIds, 'ship', 'test', rect(206, 100, 80, 30), rect(180, 100, 80, 30))).toEqual([
      'dev',
      'test',
      'ship'
    ])
  })

  it('uses vertical position for wrapped rows that do not overlap', () => {
    const commandIds = ['dev', 'test', 'ship']

    expect(previewTerminalCommandOrder(commandIds, 'ship', 'dev', rect(12, 140, 80, 30), rect(12, 100, 80, 30))).toEqual([
      'dev',
      'ship',
      'test'
    ])
  })

  it('keeps the current order when the active rect is unavailable', () => {
    const commandIds = ['dev', 'test', 'ship']

    expect(previewTerminalCommandOrder(commandIds, 'ship', 'test', null, rect(180, 100, 80, 30))).toBe(commandIds)
  })
})

describe('terminalCommandDragRenderEntries', () => {
  it('keeps the dragged command mounted and inserts a placeholder at the target index', () => {
    expect(terminalCommandDragRenderEntries(['dev', 'test', 'ship'], 'ship', 1)).toEqual([
      { type: 'command', commandId: 'dev' },
      { type: 'placeholder' },
      { type: 'command', commandId: 'test' },
      { type: 'command', commandId: 'ship' }
    ])
  })

  it('places the placeholder after the last remaining command when targeting the end', () => {
    expect(terminalCommandDragRenderEntries(['dev', 'test', 'ship'], 'dev', 2)).toEqual([
      { type: 'command', commandId: 'dev' },
      { type: 'command', commandId: 'test' },
      { type: 'command', commandId: 'ship' },
      { type: 'placeholder' }
    ])
  })

  it('renders plain command entries when no compact drag placeholder is active', () => {
    expect(terminalCommandDragRenderEntries(['dev', 'test'], null, null)).toEqual([
      { type: 'command', commandId: 'dev' },
      { type: 'command', commandId: 'test' }
    ])
  })
})
