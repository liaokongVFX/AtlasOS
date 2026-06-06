import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { I18nProvider } from '../../i18n'
import { notifyCanvasViewportSync } from '../../lib/canvas-viewport-sync'
import { SketchComponent } from './sketch-component'

const excalidrawProps = vi.hoisted(() => ({
  current: null as Record<string, any> | null
}))

const excalidrawApi = vi.hoisted(() => ({
  getSceneElementsIncludingDeleted: vi.fn(() => [] as any[]),
  getFiles: vi.fn(() => ({})),
  getAppState: vi.fn(() => ({ scrollX: 0, scrollY: 0 } as Record<string, any>)),
  updateScene: vi.fn()
}))

vi.mock('@excalidraw/excalidraw', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    CaptureUpdateAction: {
      NEVER: 'NEVER'
    },
    Excalidraw: (props: Record<string, any>) => {
      excalidrawProps.current = props
      props.excalidrawAPI?.(excalidrawApi)
      return React.createElement(
        'div',
        { 'data-testid': 'excalidraw', className: 'excalidraw' },
        React.createElement('canvas', { 'data-testid': 'excalidraw-canvas', className: 'excalidraw__canvas interactive' }),
        props.children as ReactNode
      )
    },
    convertToExcalidrawElements: vi.fn((skeletons: Array<Record<string, unknown>>, options?: Record<string, unknown>) =>
      skeletons.map((skeleton, index) => ({
        ...skeleton,
        id: options?.regenerateIds ? `generated-${index}` : skeleton.id,
        width: Number(skeleton.width ?? 0),
        height: Number(skeleton.height ?? 0),
        isDeleted: false
      }))
    )
  }
})

const TIMESTAMP = '2026-06-03T00:00:00.000Z'

function createComponent(state: Record<string, unknown> = {}): CanvasComponent {
  return {
    id: 'sketch-1',
    type: 'sketch',
    title: 'Sketch',
    frame: { x: 0, y: 0, width: 900, height: 620 },
    zIndex: 1,
    config: {},
    state,
    bindings: {},
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  }
}

function createRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    right: left + width,
    bottom: top + height,
    left,
    toJSON: () => ({ left, top, width, height })
  } as DOMRect
}

function mockEditorLayout(editor: HTMLElement, layout: { clientHeight: number; clientWidth: number; height: number; left: number; top: number; width: number }) {
  Object.defineProperty(editor, 'clientWidth', { configurable: true, value: layout.clientWidth })
  Object.defineProperty(editor, 'clientHeight', { configurable: true, value: layout.clientHeight })
  vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(createRect(layout.left, layout.top, layout.width, layout.height))
}

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  })
}

function renderSketch(component = createComponent(), updateState = vi.fn(), canvasZoom = 1) {
  render(
    <I18nProvider locale="en-US">
      <SketchComponent canvasId="canvas-1" canvasZoom={canvasZoom} component={component} updateConfig={vi.fn()} updateState={updateState} setTitle={vi.fn()} />
    </I18nProvider>
  )

  return updateState
}

describe('SketchComponent', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    excalidrawProps.current = null
    excalidrawApi.getSceneElementsIncludingDeleted.mockReset()
    excalidrawApi.getSceneElementsIncludingDeleted.mockReturnValue([])
    excalidrawApi.getFiles.mockReset()
    excalidrawApi.getFiles.mockReturnValue({})
    excalidrawApi.getAppState.mockReset()
    excalidrawApi.getAppState.mockReturnValue({ scrollX: 0, scrollY: 0 })
    excalidrawApi.updateScene.mockClear()
  })

  it('renders Excalidraw with local keyboard settings and literal drawing colors', () => {
    renderSketch(
      createComponent({
        sketchScene: {
          schemaVersion: 1,
          elements: [{ id: 'text-1', type: 'text', text: 'Saved note', x: 0, y: 0, width: 120, height: 40 }],
          appState: { scrollX: 10 },
          files: {}
        }
      })
    )

    expect(screen.getByTestId('excalidraw')).toBeInTheDocument()
    expect(excalidrawProps.current).toMatchObject({
      theme: 'light',
      name: 'Sketch',
      handleKeyboardGlobally: false,
      autoFocus: false,
      detectScroll: false
    })
    expect(excalidrawProps.current?.initialData.appState).toMatchObject({
      theme: 'light',
      viewBackgroundColor: '#f8f9fa',
      currentItemStrokeColor: '#1e1e1e',
      scrollX: 10
    })
  })

  it('throttles Excalidraw scene changes into component state', () => {
    vi.useFakeTimers()
    const updateState = renderSketch()

    act(() => {
      excalidrawProps.current?.onChange(
        [{ id: 'rect-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 80 }],
        { theme: 'light', selectedElementIds: { 'rect-1': true } },
        {}
      )
    })
    expect(updateState).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(450)
    })

    expect(updateState).toHaveBeenCalledWith(
      {
        sketchScene: expect.objectContaining({
          schemaVersion: 1,
          elements: [expect.objectContaining({ id: 'rect-1', type: 'rectangle' })],
          appState: expect.objectContaining({
            theme: 'light',
            viewBackgroundColor: '#f8f9fa',
            currentItemStrokeColor: '#1e1e1e'
          })
        })
      },
      false
    )
    expect(updateState.mock.calls[0][0].sketchScene.appState).not.toHaveProperty('selectedElementIds')
  })

  it('flushes pending scene changes when focus leaves the sketch module', () => {
    vi.useFakeTimers()
    const updateState = renderSketch()
    const module = document.querySelector('.sketch-module')
    if (!module) throw new Error('Expected sketch module')

    act(() => {
      excalidrawProps.current?.onChange([{ id: 'text-1', type: 'text', text: 'Draft', x: 0, y: 0, width: 80, height: 32 }], {}, {})
    })
    fireEvent.blur(module)

    expect(updateState).toHaveBeenCalledWith(
      {
        sketchScene: expect.objectContaining({
          elements: [expect.objectContaining({ id: 'text-1' })]
        })
      },
      true
    )
  })

  it('syncs Excalidraw runtime viewport dimensions without persisting canvas zoom scale', async () => {
    const updateState = renderSketch(createComponent(), vi.fn(), 0.5)
    const editor = document.querySelector<HTMLElement>('.sketch-editor')
    if (!editor) throw new Error('Expected sketch editor')

    mockEditorLayout(editor, {
      left: 100,
      top: 50,
      width: 450,
      height: 290,
      clientWidth: 900,
      clientHeight: 580
    })
    excalidrawApi.getAppState.mockReturnValue({ width: 450, height: 290, offsetLeft: 100, offsetTop: 50, scrollX: 0, scrollY: 0 })

    act(() => {
      notifyCanvasViewportSync({ x: 0, y: 0, zoom: 0.5, phase: 'move' })
    })
    await flushAnimationFrame()

    expect(excalidrawApi.updateScene).toHaveBeenCalledWith({
      appState: {
        width: 900,
        height: 580,
        offsetLeft: 100,
        offsetTop: 50
      },
      captureUpdate: 'NEVER'
    })
    expect(editor.style.getPropertyValue('--sketch-excalidraw-svg-offset-x')).toBe('-100px')
    expect(editor.style.getPropertyValue('--sketch-excalidraw-svg-offset-y')).toBe('-50px')
    expect(updateState).not.toHaveBeenCalled()
  })

  it('normalizes Excalidraw canvas mouse coordinates when the canvas is zoomed', () => {
    renderSketch(createComponent(), vi.fn(), 0.5)
    const editor = document.querySelector<HTMLElement>('.sketch-editor')
    const canvas = screen.getByTestId('excalidraw-canvas')
    if (!editor) throw new Error('Expected sketch editor')

    mockEditorLayout(editor, {
      left: 100,
      top: 50,
      width: 450,
      height: 290,
      clientWidth: 900,
      clientHeight: 580
    })

    let pointer: { clientX: number; clientY: number } | null = null
    canvas.addEventListener('mousedown', (event) => {
      pointer = { clientX: event.clientX, clientY: event.clientY }
    })

    fireEvent.mouseDown(canvas, { clientX: 300, clientY: 150 })

    expect(pointer).toEqual({
      clientX: 500,
      clientY: 250
    })
  })

  it('keeps Excalidraw canvas coordinate normalization idempotent for repeated event handling', () => {
    renderSketch(createComponent(), vi.fn(), 0.5)
    const editor = document.querySelector<HTMLElement>('.sketch-editor')
    const canvas = screen.getByTestId('excalidraw-canvas')
    if (!editor) throw new Error('Expected sketch editor')

    mockEditorLayout(editor, {
      left: 100,
      top: 50,
      width: 450,
      height: 290,
      clientWidth: 900,
      clientHeight: 580
    })

    const pointers: Array<{ clientX: number; clientY: number }> = []
    canvas.addEventListener('mousedown', (event) => {
      pointers.push({ clientX: event.clientX, clientY: event.clientY })
    })

    const event = new MouseEvent('mousedown', { bubbles: true, clientX: 300, clientY: 150 })
    canvas.dispatchEvent(event)
    canvas.dispatchEvent(event)

    expect(pointers).toEqual([
      { clientX: 500, clientY: 250 },
      { clientX: 500, clientY: 250 }
    ])
  })

  it('normalizes global pointer moves for an active Excalidraw eraser gesture', () => {
    renderSketch(createComponent(), vi.fn(), 0.5)
    const editor = document.querySelector<HTMLElement>('.sketch-editor')
    const canvas = screen.getByTestId('excalidraw-canvas')
    if (!editor) throw new Error('Expected sketch editor')

    mockEditorLayout(editor, {
      left: 100,
      top: 50,
      width: 450,
      height: 290,
      clientWidth: 900,
      clientHeight: 580
    })

    let pointer: { clientX: number; clientY: number } | null = null
    const recordPointerMove = (event: PointerEvent) => {
      pointer = { clientX: event.clientX, clientY: event.clientY }
    }
    window.addEventListener('pointermove', recordPointerMove)

    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 150 })
    Object.defineProperty(pointerDown, 'pointerId', { value: 17 })
    canvas.dispatchEvent(pointerDown)

    const pointerMove = new MouseEvent('pointermove', { bubbles: true, clientX: 320, clientY: 180 })
    Object.defineProperty(pointerMove, 'pointerId', { value: 17 })
    window.dispatchEvent(pointerMove)
    window.removeEventListener('pointermove', recordPointerMove)

    expect(pointer).toEqual({
      clientX: 540,
      clientY: 310
    })
  })

  it('appends a mind-map template without replacing existing elements', () => {
    const updateState = renderSketch()
    const existingElement = { id: 'existing-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60, isDeleted: false }
    excalidrawApi.getSceneElementsIncludingDeleted.mockReturnValue([existingElement])

    fireEvent.click(screen.getByRole('button', { name: 'Insert mind map' }))

    expect(excalidrawApi.updateScene).toHaveBeenCalledWith({
      elements: expect.arrayContaining([existingElement, expect.objectContaining({ id: 'generated-0' })]),
      appState: expect.objectContaining({
        theme: 'light',
        viewBackgroundColor: '#f8f9fa'
      })
    })
    const nextScene = updateState.mock.calls.at(-1)?.[0].sketchScene
    expect(nextScene.elements[0]).toMatchObject(existingElement)
    expect(nextScene.elements.length).toBeGreaterThan(1)
    expect(updateState.mock.calls.at(-1)?.[1]).toBe(true)
  })
})
