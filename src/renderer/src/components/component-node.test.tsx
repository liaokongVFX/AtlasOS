import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { useCanvasStore } from '../store/canvas-store'
import { ComponentNode } from './component-node'

const nodeResizerProps = vi.hoisted(() => ({
  current: null as Record<string, any> | null
}))

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')

  return {
    ...actual,
    NodeResizer: (props: Record<string, any>) => {
      nodeResizerProps.current = props
      return null
    }
  }
})

vi.mock('./registry', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Icon = () => React.createElement('svg', { 'aria-hidden': true })
  const Renderer = () => React.createElement('div', null, 'Renderer')
  const definition = {
    title: 'Markdown Note',
    defaultFrame: { x: 0, y: 0, width: 320, height: 240 },
    permissions: [],
    icon: Icon,
    Renderer
  }

  return {
    componentRegistry: {
      terminal: { ...definition, type: 'terminal', title: 'Terminal' },
      'file-tree': { ...definition, type: 'file-tree', title: 'Files' },
      browser: { ...definition, type: 'browser', title: 'Browser' },
      'markdown-note': { ...definition, type: 'markdown-note' },
      'file-preview': { ...definition, type: 'file-preview', title: 'File Preview' }
    }
  }
})

type CanvasStoreState = ReturnType<typeof useCanvasStore.getState>

const initialStore = useCanvasStore.getState()

function createComponent(patch: Partial<CanvasComponent> = {}): CanvasComponent {
  const timestamp = '2026-05-21T00:00:00.000Z'

  return {
    id: 'component-1',
    type: 'markdown-note',
    title: 'Note',
    frame: { x: 100, y: 120, width: 420, height: 300 },
    zIndex: 1,
    config: {},
    state: {},
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    ...patch
  }
}

function renderNode(component = createComponent(), selected = true): void {
  render(
    <ComponentNode
      {...({
        data: { canvasId: 'canvas-1', component },
        selected,
        dragging: false,
        width: component.frame.width,
        height: component.frame.height
      } as Parameters<typeof ComponentNode>[0])}
    />
  )
}

describe('ComponentNode', () => {
  afterEach(() => {
    nodeResizerProps.current = null
    cleanup()
    useCanvasStore.setState(initialStore, true)
  })

  it('keeps the title read-only until it is double-clicked', () => {
    const updateComponent = vi.fn()
    useCanvasStore.setState({ updateComponent } as Partial<CanvasStoreState>)

    renderNode()

    expect(screen.queryByRole('textbox', { name: 'Component title' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Note'))

    expect(updateComponent).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Component title' })).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('Note'))

    expect(screen.getByRole('textbox', { name: 'Component title' })).toHaveValue('Note')
  })

  it('commits a title edit with Enter', () => {
    const component = createComponent()
    let savedTitle = component.title
    const updateComponent = vi.fn((_canvasId: string, _componentId: string, updater: (component: CanvasComponent) => void) => {
      const draft = structuredClone(component)
      updater(draft)
      savedTitle = draft.title
    })
    useCanvasStore.setState({ updateComponent } as Partial<CanvasStoreState>)

    renderNode(component)

    fireEvent.doubleClick(screen.getByText('Note'))
    const input = screen.getByRole('textbox', { name: 'Component title' })
    fireEvent.change(input, { target: { value: 'Roadmap' } })

    expect(updateComponent).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateComponent).toHaveBeenCalledWith('canvas-1', 'component-1', expect.any(Function))
    expect(savedTitle).toBe('Roadmap')
  })

  it('cancels a title edit with Escape', () => {
    const updateComponent = vi.fn()
    useCanvasStore.setState({ updateComponent } as Partial<CanvasStoreState>)

    renderNode()

    fireEvent.doubleClick(screen.getByText('Note'))
    const input = screen.getByRole('textbox', { name: 'Component title' })
    fireEvent.change(input, { target: { value: 'Discard me' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(updateComponent).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Component title' })).not.toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('keeps media preview resize results proportional to the media body', () => {
    const component = createComponent({
      type: 'file-preview',
      title: 'photo.png',
      frame: { x: 0, y: 0, width: 560, height: 353 },
      config: { mimeType: 'image/png', mediaAspectRatio: 16 / 9 },
      bindings: { path: 'D:\\media\\photo.png' }
    })
    let savedFrame = component.frame
    const updateComponent = vi.fn((_canvasId: string, _componentId: string, updater: (component: CanvasComponent) => void) => {
      const draft = structuredClone(component)
      updater(draft)
      savedFrame = draft.frame
    })
    useCanvasStore.setState({ updateComponent } as Partial<CanvasStoreState>)

    renderNode(component)

    expect(nodeResizerProps.current?.keepAspectRatio).toBe(true)

    act(() => {
      nodeResizerProps.current?.onResize?.({} as never, {
        x: 0,
        y: 0,
        width: 640,
        height: 600,
        direction: [1, 1]
      })
      nodeResizerProps.current?.onResizeEnd?.({} as never, {
        x: 0,
        y: 0,
        width: 640,
        height: 600
      })
    })

    expect(savedFrame).toEqual({ x: 0, y: 0, width: 640, height: 398 })
  })
})
