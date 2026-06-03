import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { I18nProvider } from '../../i18n'
import { SketchComponent } from './sketch-component'

const excalidrawProps = vi.hoisted(() => ({
  current: null as Record<string, any> | null
}))

const excalidrawApi = vi.hoisted(() => ({
  getSceneElementsIncludingDeleted: vi.fn(() => [] as any[]),
  getFiles: vi.fn(() => ({})),
  getAppState: vi.fn(() => ({ scrollX: 0, scrollY: 0 })),
  updateScene: vi.fn()
}))

vi.mock('@excalidraw/excalidraw', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    Excalidraw: (props: Record<string, any>) => {
      excalidrawProps.current = props
      props.excalidrawAPI?.(excalidrawApi)
      return React.createElement('div', { 'data-testid': 'excalidraw' }, props.children as ReactNode)
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

function renderSketch(component = createComponent(), updateState = vi.fn()) {
  render(
    <I18nProvider locale="en-US">
      <SketchComponent canvasId="canvas-1" component={component} updateConfig={vi.fn()} updateState={updateState} setTitle={vi.fn()} />
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

  it('renders Excalidraw with dark local keyboard settings', () => {
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
      theme: 'dark',
      name: 'Sketch',
      handleKeyboardGlobally: false,
      autoFocus: false,
      detectScroll: false
    })
    expect(excalidrawProps.current?.initialData.appState).toMatchObject({
      theme: 'dark',
      viewBackgroundColor: '#010102',
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
            theme: 'dark',
            viewBackgroundColor: '#010102'
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

  it('appends a mind-map template without replacing existing elements', () => {
    const updateState = renderSketch()
    const existingElement = { id: 'existing-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 60, isDeleted: false }
    excalidrawApi.getSceneElementsIncludingDeleted.mockReturnValue([existingElement])

    fireEvent.click(screen.getByRole('button', { name: 'Insert mind map' }))

    expect(excalidrawApi.updateScene).toHaveBeenCalledWith({
      elements: expect.arrayContaining([existingElement, expect.objectContaining({ id: 'generated-0' })]),
      appState: expect.objectContaining({
        theme: 'dark',
        viewBackgroundColor: '#010102'
      })
    })
    const nextScene = updateState.mock.calls.at(-1)?.[0].sketchScene
    expect(nextScene.elements[0]).toMatchObject(existingElement)
    expect(nextScene.elements.length).toBeGreaterThan(1)
    expect(updateState.mock.calls.at(-1)?.[1]).toBe(true)
  })
})
