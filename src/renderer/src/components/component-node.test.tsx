import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { subscribeCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { useCanvasStore } from '../store/canvas-store'
import { ComponentNode } from './component-node'

const nodeResizerProps = vi.hoisted(() => ({
  current: null as Record<string, any> | null
}))

const rendererContextMenu = vi.hoisted(() => ({
  current: vi.fn()
}))

const rendererProps = vi.hoisted(() => ({
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
  const mediaFrame = await vi.importActual<typeof import('../lib/media-frame')>('../lib/media-frame')
  const Icon = () => React.createElement('svg', { 'aria-hidden': true })
  const Renderer = (props: { component: CanvasComponent; setHeaderActions?: (actions: any) => void }) => {
    const { component, setHeaderActions } = props
    rendererProps.current = props
    React.useEffect(() => {
      if (component.type !== 'file-tree') return undefined

      setHeaderActions?.(React.createElement('button', { type: 'button' }, 'Header action'))
      return () => setHeaderActions?.(null)
    }, [component.type, setHeaderActions])

    return React.createElement(
      'div',
      { 'data-component-context-menu-trigger': '', 'data-testid': 'renderer-target', onContextMenu: rendererContextMenu.current },
      'Renderer'
    )
  }
  const definition = {
    title: 'Markdown Note',
    defaultFrame: { x: 0, y: 0, width: 320, height: 240 },
    permissions: [],
    icon: Icon,
    Renderer
  }

  const componentRegistry = {
      terminal: { ...definition, type: 'terminal', title: 'Terminal' },
      'file-tree': { ...definition, type: 'file-tree', title: 'Files' },
      browser: { ...definition, type: 'browser', title: 'Browser' },
      'markdown-note': { ...definition, type: 'markdown-note' },
      'file-preview': {
        ...definition,
        type: 'file-preview',
        title: 'File Preview',
        canDragFromSelectedBody: (component: CanvasComponent) =>
          String(component.config.mimeType ?? '').startsWith('image/') || String(component.bindings.path ?? '').toLowerCase().endsWith('.png'),
        getResizeBehavior: (component: CanvasComponent) => {
          const mediaAspectRatio = Number(component.config.mediaAspectRatio)
          return {
            keepAspectRatio: true,
            minWidth: mediaFrame.MEDIA_NODE_MIN_WIDTH,
            minHeight: mediaFrame.fitMediaFrameToAspectRatio(component.frame, mediaAspectRatio, mediaFrame.MEDIA_NODE_MIN_WIDTH).height,
            normalizeFrame: (params: any, context: { direction: readonly number[] | null }) =>
              mediaFrame.normalizeMediaResizeFrame(params, mediaAspectRatio, context.direction)
          }
        }
      },
      kanban: { ...definition, type: 'kanban', title: 'Kanban' }
    }

  return {
    componentRegistry,
    componentDefinitionTitle: (definition: { title: string }) => definition.title,
    getComponentDefinition: (type: string) =>
      componentRegistry[type as keyof typeof componentRegistry] ?? {
        ...definition,
        type,
        title: 'Missing plugin',
        Renderer: ({ component }: { component: CanvasComponent }) => React.createElement('div', null, `Plugin unavailable: ${component.type}`)
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

function renderNode(component = createComponent(), selected = true, parentGroupPosition?: { x: number; y: number }, isFrameLocked = false): void {
  render(
    <ComponentNode
      {...({
        data: { canvasId: 'canvas-1', component, isFrameLocked, parentGroupPosition },
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
    rendererContextMenu.current.mockClear()
    rendererProps.current = null
    cleanup()
    useCanvasStore.setState(initialStore, true)
  })

  it('keeps the title read-only until it is double-clicked', () => {
    const updateComponent = vi.fn()
    useCanvasStore.setState({ updateComponent } as Partial<CanvasStoreState>)

    renderNode()

    expect(screen.queryByRole('textbox', { name: '组件标题' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Note'))

    expect(updateComponent).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '组件标题' })).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('Note'))

    expect(screen.getByRole('textbox', { name: '组件标题' })).toHaveValue('Note')
  })

  it('uses the full node as a drag surface before selection', () => {
    renderNode(createComponent(), false)

    const body = document.querySelector('.component-node__body')
    const shield = document.querySelector('.component-node__interaction-shield')

    expect(body).not.toHaveClass('nodrag')
    expect(body).not.toHaveClass('nowheel')
    expect(shield).toBeInTheDocument()
    expect(shield).not.toHaveClass('nodrag')
  })

  it('enables module interaction only after selection', () => {
    renderNode(createComponent(), true)

    const body = document.querySelector('.component-node__body')

    expect(body).toHaveClass('nodrag')
    expect(body).toHaveClass('nowheel')
    expect(document.querySelector('.component-node__interaction-shield')).not.toBeInTheDocument()
  })

  it('keeps selected image preview bodies available for node dragging', () => {
    renderNode(
      createComponent({
        type: 'file-preview',
        title: 'photo.png',
        config: { mimeType: 'image/png' },
        bindings: { path: 'D:\\media\\photo.png' }
      }),
      true
    )

    const body = document.querySelector('.component-node__body')

    expect(body).not.toHaveClass('nodrag')
    expect(body).not.toHaveClass('nowheel')
    expect(body).toHaveClass('component-node__body--drag-surface')
  })

  it('keeps selected video preview bodies interactive for media controls', () => {
    renderNode(
      createComponent({
        type: 'file-preview',
        title: 'clip.mp4',
        config: { mimeType: 'video/mp4' },
        bindings: { path: 'D:\\media\\clip.mp4' }
      }),
      true
    )

    const body = document.querySelector('.component-node__body')

    expect(body).toHaveClass('nodrag')
    expect(body).toHaveClass('nowheel')
    expect(body).not.toHaveClass('component-node__body--drag-surface')
  })

  it('treats a selected node moved by a multi-node drag as canvas-interacting', () => {
    const component = createComponent({ type: 'browser' })

    render(
      <ComponentNode
        {...({
          data: { canvasId: 'canvas-1', component, isNodeDragging: true },
          selected: true,
          dragging: false,
          width: component.frame.width,
          height: component.frame.height
        } as unknown as Parameters<typeof ComponentNode>[0])}
      />
    )

    expect(rendererProps.current?.isCanvasInteracting).toBe(true)
    expect(rendererProps.current?.isViewportInteracting).not.toBe(true)
  })

  it('renders renderer-provided actions in the node header', async () => {
    renderNode(
      createComponent({
        type: 'file-tree',
        title: 'Files',
        config: { rootPath: 'D:\\repo' }
      })
    )

    const action = await screen.findByRole('button', { name: 'Header action' })

    expect(action.closest('.component-node__header-actions')).toBeInTheDocument()
    expect(action.closest('.component-node__header-actions')).toHaveClass('nodrag')
  })

  it('keeps resize affordance styling in CSS-controlled hit targets', () => {
    renderNode(createComponent(), true)

    expect(nodeResizerProps.current).toMatchObject({
      handleClassName: 'component-node__resize-handle',
      isVisible: true,
      lineClassName: 'component-node__resize-line'
    })
    expect(nodeResizerProps.current?.color).toBeUndefined()
  })

  it('hides resize affordances and ignores resize commits for frame-locked nodes', () => {
    const component = createComponent({
      type: 'terminal',
      title: 'Terminal',
      state: { locked: true }
    })
    const updateComponent = vi.fn()
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)
    useCanvasStore.setState({ updateComponent } as Partial<CanvasStoreState>)

    try {
      renderNode(component, true, undefined, true)

      expect(nodeResizerProps.current?.isVisible).toBe(false)

      act(() => {
        nodeResizerProps.current?.onResizeEnd?.({} as never, {
          x: 20,
          y: 40,
          width: 460,
          height: 320
        })
      })

      expect(updateComponent).not.toHaveBeenCalled()
      expect(listener).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  it('renders a missing plugin placeholder for unknown component types', () => {
    renderNode(createComponent({ type: 'acme.tools/timer' }))

    expect(screen.getByText('Plugin unavailable: acme.tools/timer')).toBeInTheDocument()
  })

  it('also shields unselected file tree nodes from direct editing', () => {
    renderNode(
      createComponent({
        type: 'file-tree',
        title: 'Files',
        config: { rootPath: 'D:\\repo' }
      }),
      false
    )

    const shield = document.querySelector('.component-node__interaction-shield')

    expect(shield).toBeInTheDocument()
    expect(shield).not.toHaveClass('nodrag')
  })

  it('forwards right-clicks through the unselected interaction shield', () => {
    const onRequestSelect = vi.fn()
    const component = createComponent({
      type: 'file-tree',
      title: 'Files',
      config: { rootPath: 'D:\\repo' }
    })

    render(
      <ComponentNode
        {...({
          data: { canvasId: 'canvas-1', component, onRequestSelect },
          selected: false,
          dragging: false,
          width: component.frame.width,
          height: component.frame.height
        } as unknown as Parameters<typeof ComponentNode>[0])}
      />
    )

    const shield = document.querySelector<HTMLElement>('.component-node__interaction-shield')
    const target = screen.getByTestId('renderer-target')
    if (!shield) throw new Error('Expected unselected node to render an interaction shield')

    const originalElementsFromPoint = document.elementsFromPoint
    document.elementsFromPoint = vi.fn(() => [shield, target])

    try {
      fireEvent.contextMenu(shield, { button: 2, clientX: 64, clientY: 96 })
    } finally {
      document.elementsFromPoint = originalElementsFromPoint
    }

    expect(onRequestSelect).toHaveBeenCalledWith('component-1')
    expect(rendererContextMenu.current).toHaveBeenCalledTimes(1)
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
    const input = screen.getByRole('textbox', { name: '组件标题' })
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
    const input = screen.getByRole('textbox', { name: '组件标题' })
    fireEvent.change(input, { target: { value: 'Discard me' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(updateComponent).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '组件标题' })).not.toBeInTheDocument()
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

  it('persists grouped resize positions in canvas coordinates', () => {
    const component = createComponent({
      frame: { x: 140, y: 132, width: 420, height: 300 }
    })
    let savedFrame = component.frame
    const updateComponent = vi.fn((_canvasId: string, _componentId: string, updater: (component: CanvasComponent) => void) => {
      const draft = structuredClone(component)
      updater(draft)
      savedFrame = draft.frame
    })
    useCanvasStore.setState({ updateComponent } as Partial<CanvasStoreState>)

    renderNode(component, true, { x: 80, y: 62 })

    act(() => {
      nodeResizerProps.current?.onResizeEnd?.({} as never, {
        x: 60,
        y: 70,
        width: 460,
        height: 320
      })
    })

    expect(savedFrame).toEqual({ x: 140, y: 132, width: 460, height: 320 })
  })

  it('notifies native browser overlays when resize ends', () => {
    const component = createComponent()
    const updateComponent = vi.fn((_canvasId: string, _componentId: string, updater: (component: CanvasComponent) => void) => {
      const draft = structuredClone(component)
      updater(draft)
    })
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)
    useCanvasStore.setState({ updateComponent } as Partial<CanvasStoreState>)

    try {
      renderNode(component)

      act(() => {
        nodeResizerProps.current?.onResizeEnd?.({} as never, {
          x: 100,
          y: 120,
          width: 460,
          height: 320
        })
      })

      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })
})
