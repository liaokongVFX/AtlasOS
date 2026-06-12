import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_APP_SHORTCUTS, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import { DEFAULT_PET_SETTINGS } from '@shared/pet'
import type { CanvasComponent, CanvasDocument, CanvasGroup } from '@shared/schema'
import { DEFAULT_UPDATE_SETTINGS } from '@shared/updates'
import { I18nContext, setCurrentLocale, translate } from '../i18n'
import { subscribeCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { useAppSettingsStore } from '../store/app-settings-store'
import { useCanvasStore } from '../store/canvas-store'
import { CanvasBoard, type CanvasFlowNode } from './canvas-board'
import type { AtlasFlowNode } from './component-node'
import { registerBuiltInComponentDefinitions } from './register-builtins'

registerBuiltInComponentDefinitions()

type CapturedReactFlowProps = {
  deleteKeyCode?: string | string[] | null
  nodes?: CanvasFlowNode[]
  onNodesChange?: (changes: Array<Record<string, unknown>>) => void
  onDragLeave?: (event: ReactDragEvent) => void
  onDragOver?: (event: ReactDragEvent) => void
  onDrop?: (event: ReactDragEvent) => void | Promise<void>
  onMove?: (event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => void
  onMoveEnd?: (event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => void
  onMoveStart?: (event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => void
  onNodeDragStart?: (event: ReactMouseEvent, node: CanvasFlowNode, nodes: CanvasFlowNode[]) => void
  onNodeDragStop?: (event: ReactMouseEvent, node: CanvasFlowNode, nodes: CanvasFlowNode[]) => void
  onPaneClick?: (event: ReactMouseEvent) => void
  panOnDrag?: boolean | number[]
  selectionOnDrag?: boolean
  selectNodesOnDrag?: boolean
  snapGrid?: [number, number]
  snapToGrid?: boolean
  zoomOnDoubleClick?: boolean
}

const reactFlowProps = vi.hoisted(() => ({
  current: null as CapturedReactFlowProps | null
}))

const reactFlowMock = vi.hoisted(() => ({
  fitView: vi.fn(() => Promise.resolve(true)),
  getZoom: vi.fn(() => 1),
  getNodes: vi.fn(() => reactFlowProps.current?.nodes ?? []),
  screenToFlowPosition: vi.fn((position: { x: number; y: number }) => position),
  setCenter: vi.fn(() => Promise.resolve(true)),
  zoomIn: vi.fn(() => Promise.resolve(true)),
  zoomOut: vi.fn(() => Promise.resolve(true))
}))

const reactFlowStoreState = vi.hoisted(() => ({
  current: {
    transform: [0, 0, 1] as [number, number, number]
  }
}))

vi.mock('@xyflow/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    applyNodeChanges: vi.fn((changes: Array<Record<string, unknown>>, nodes: Array<Record<string, unknown>>) => {
      let nextNodes = [...nodes]

      for (const change of changes) {
        if (change.type === 'remove') {
          nextNodes = nextNodes.filter((node) => node.id !== change.id)
        }

        if (change.type === 'select') {
          nextNodes = nextNodes.map((node) => (node.id === change.id ? { ...node, selected: change.selected } : node))
        }

        if (change.type === 'position' && change.position) {
          nextNodes = nextNodes.map((node) => (node.id === change.id ? { ...node, position: change.position } : node))
        }
      }

      return nextNodes
    }),
    NodeResizer: () => null,
    Panel: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    ReactFlow: (props: CapturedReactFlowProps & { children?: React.ReactNode }) => {
      reactFlowProps.current = props
      return React.createElement(
        'div',
        {
          'data-testid': 'canvas-flow',
          onDragLeave: (event: ReactDragEvent) => props.onDragLeave?.(event),
          onDragOver: (event: ReactDragEvent) => props.onDragOver?.(event),
          onDrop: (event: ReactDragEvent) => {
            void props.onDrop?.(event)
          }
        },
        props.children
      )
    },
    useReactFlow: () => reactFlowMock,
    useStore: (selector: (state: typeof reactFlowStoreState.current) => unknown) => selector(reactFlowStoreState.current)
  }
})

function createComponent(id: string, patch: Partial<CanvasComponent> = {}): CanvasComponent {
  const timestamp = '2026-05-21T00:00:00.000Z'

  return {
    id,
    type: 'markdown-note',
    title: 'Note',
    frame: { x: 100, y: 120, width: 420, height: 300 },
    zIndex: 1,
    config: {},
    state: { content: 'hello' },
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    ...patch
  }
}

function createGroup(id: string, patch: Partial<CanvasGroup> = {}): CanvasGroup {
  return {
    id,
    title: 'Group',
    notes: '',
    frame: { x: 80, y: 80, width: 500, height: 380 },
    zIndex: 1,
    memberIds: [],
    ...patch
  }
}

function createCanvas(): CanvasDocument {
  const timestamp = '2026-05-21T00:00:00.000Z'

  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    id: 'canvas-1',
    name: 'Canvas',
    viewport: { ...DEFAULT_VIEWPORT },
    background: {
      color: DEFAULT_CANVAS_BACKGROUND.color,
      image: { ...DEFAULT_CANVAS_BACKGROUND.image }
    },
    components: [],
    groups: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function createFileList(files: File[]): FileList {
  return files as unknown as FileList
}

function createFileDropDataTransfer(files: File[]): DataTransfer {
  return {
    dropEffect: 'none',
    files: createFileList(files),
    getData: vi.fn(() => ''),
    types: ['Files']
  } as unknown as DataTransfer
}

function createAtlasFileDropDataTransfer(payload: Record<string, unknown>): DataTransfer {
  return {
    dropEffect: 'none',
    files: createFileList([]),
    getData: vi.fn((type: string) => (type === 'application/atlas-file' ? JSON.stringify(payload) : '')),
    types: ['application/atlas-file']
  } as unknown as DataTransfer
}

function renderCanvasBoard(): ReturnType<typeof render> {
  setCurrentLocale('en-US')

  return render(
    <I18nContext.Provider
      value={{
        locale: 'en-US',
        setLocale: vi.fn(),
        t: (key, values) => translate('en-US', key, values)
      }}
    >
      <CanvasBoard />
    </I18nContext.Provider>
  )
}

function createDropEvent(dataTransfer: DataTransfer, clientX = 320, clientY = 240): ReactDragEvent {
  return {
    clientX,
    clientY,
    dataTransfer,
    preventDefault: vi.fn()
  } as unknown as ReactDragEvent
}

function createXtermKeyboardTarget(componentId: string): HTMLTextAreaElement {
  const nodeElement = document.createElement('div')
  nodeElement.className = 'react-flow__node'
  nodeElement.dataset.id = componentId

  const body = document.createElement('div')
  body.className = 'component-node__body'

  const xterm = document.createElement('div')
  xterm.className = 'xterm'

  const textarea = document.createElement('textarea')

  xterm.appendChild(textarea)
  body.appendChild(xterm)
  nodeElement.appendChild(body)
  document.body.appendChild(nodeElement)

  return textarea
}

function createComponentBodyKeyboardTarget(componentId: string): HTMLDivElement {
  const nodeElement = document.createElement('div')
  nodeElement.className = 'react-flow__node'
  nodeElement.dataset.id = componentId

  const body = document.createElement('div')
  body.className = 'component-node__body'

  const target = document.createElement('div')
  target.tabIndex = 0

  body.appendChild(target)
  nodeElement.appendChild(body)
  document.body.appendChild(nodeElement)

  return target
}

describe('CanvasBoard', () => {
  beforeEach(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn()
    }
    reactFlowProps.current = null
    reactFlowMock.fitView.mockClear()
    reactFlowMock.getZoom.mockClear()
    reactFlowMock.getNodes.mockReset()
    reactFlowMock.getNodes.mockImplementation(() => reactFlowProps.current?.nodes ?? [])
    reactFlowMock.screenToFlowPosition.mockReset()
    reactFlowMock.screenToFlowPosition.mockImplementation((position: { x: number; y: number }) => position)
    reactFlowMock.setCenter.mockClear()
    reactFlowMock.zoomIn.mockClear()
    reactFlowMock.zoomOut.mockClear()
    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        canvas: {
          save: vi.fn(async (canvas: CanvasDocument) => canvas)
        },
        filesystem: {
          getPathForFile: vi.fn(),
          listTree: vi.fn(),
          readFile: vi.fn()
        },
        terminal: {
          closeComponent: vi.fn()
        }
      }
    })
    useAppSettingsStore.setState({
      error: null,
      isLoaded: true,
      settings: {
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: { ...DEFAULT_APP_SHORTCUTS },
        pet: { ...DEFAULT_PET_SETTINGS },
        updates: { ...DEFAULT_UPDATE_SETTINGS }
      }
    })
    useCanvasStore.setState({
      activeCanvasId: 'canvas-1',
      appState: null,
      canvases: { 'canvas-1': createCanvas() },
      error: null,
      saveState: 'idle'
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('notifies native browser overlays during viewport moves', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)

    renderCanvasBoard()

    expect(reactFlowProps.current?.onMove).toBeTypeOf('function')

    act(() => {
      reactFlowProps.current?.onMove?.(null, { x: 120, y: 80, zoom: 1 })
      reactFlowProps.current?.onMove?.(null, { x: 160, y: 95, zoom: 1 })
    })

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenNthCalledWith(1, { x: 120, y: 80, zoom: 1, phase: 'move' })
    expect(listener).toHaveBeenNthCalledWith(2, { x: 160, y: 95, zoom: 1, phase: 'move' })
    unsubscribe()
  })

  it('leaves canvas component positions unconstrained by grid snapping', () => {
    renderCanvasBoard()

    expect(reactFlowProps.current?.snapToGrid).toBeUndefined()
    expect(reactFlowProps.current?.snapGrid).toBeUndefined()
  })

  it('uses left-button pane drags for marquee selection', () => {
    renderCanvasBoard()

    expect(reactFlowProps.current?.selectionOnDrag).toBe(true)
    expect(reactFlowProps.current?.panOnDrag).toEqual([1, 2])
    expect(reactFlowProps.current?.selectNodesOnDrag).toBe(false)
  })

  it('renders CSS gradients as the canvas background fill', () => {
    const canvas = createCanvas()
    canvas.background.color = 'linear-gradient(135deg, #010102, #11141b)'
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    const { container } = renderCanvasBoard()

    expect(container.querySelector('.canvas-board')?.getAttribute('style')).toContain('background: linear-gradient(135deg, #010102, #11141b)')
  })

  it('renders background image blur with extra bleed to avoid edge halos', () => {
    const canvas = createCanvas()
    canvas.background.image.src = 'atlas-file://preview?rootPath=C%3A%5Cimage.png&path=C%3A%5Cimage.png'
    canvas.background.image.blur = 12
    canvas.background.image.fit = 'contain'
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    const { container } = renderCanvasBoard()
    const backgroundImage = container.querySelector('.canvas-background-image')

    expect(backgroundImage?.getAttribute('style')).toContain('filter: blur(12px)')
    expect(backgroundImage?.getAttribute('style')).toContain('top: -36px')
    expect(backgroundImage?.getAttribute('style')).toContain('right: -36px')
    expect(backgroundImage?.getAttribute('style')).toContain('bottom: -36px')
    expect(backgroundImage?.getAttribute('style')).toContain('left: -36px')
    expect(backgroundImage?.getAttribute('style')).toContain('background-size: cover')
    expect(backgroundImage?.getAttribute('style')).toContain('background-repeat: no-repeat')
    expect(backgroundImage?.getAttribute('style')).toContain('background-attachment: scroll')
  })

  it('keeps fixed background attachment when the background image is not blurred', () => {
    const canvas = createCanvas()
    canvas.background.image.src = 'atlas-file://preview?rootPath=C%3A%5Cimage.png&path=C%3A%5Cimage.png'
    canvas.background.image.blur = 0
    canvas.background.image.fixed = true
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    const { container } = renderCanvasBoard()
    const backgroundImage = container.querySelector('.canvas-background-image')

    expect(backgroundImage?.getAttribute('style')).toContain('background-attachment: fixed')
  })

  it('keeps viewport drags out of component node data while disabling embedded browser input', () => {
    const canvas = createCanvas()
    canvas.components = [
      createComponent('browser-1', {
        type: 'browser',
        state: {
          activeTabId: 'tab-1',
          tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com' }]
        }
      })
    ]
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)

    const { container } = renderCanvasBoard()
    const board = container.querySelector('.canvas-board')
    expect(board).not.toHaveClass('canvas-board--viewport-interacting')

    const nodesBeforeMove = reactFlowProps.current?.nodes
    const browserDataBeforeMove = (nodesBeforeMove?.find((node) => node.id === 'browser-1') as AtlasFlowNode).data

    act(() => {
      reactFlowProps.current?.onMoveStart?.(null, { x: 120, y: 80, zoom: 1 })
    })

    expect(listener).toHaveBeenCalledWith({ x: 120, y: 80, zoom: 1, phase: 'start' })
    expect(board).toHaveClass('canvas-board--viewport-interacting')
    expect(reactFlowProps.current?.nodes).toBe(nodesBeforeMove)
    expect((reactFlowProps.current?.nodes?.find((node) => node.id === 'browser-1') as AtlasFlowNode).data).toBe(browserDataBeforeMove)

    act(() => {
      reactFlowProps.current?.onMoveEnd?.(null, DEFAULT_VIEWPORT)
    })

    expect(listener).toHaveBeenLastCalledWith({ ...DEFAULT_VIEWPORT, phase: 'end' })
    expect(board).not.toHaveClass('canvas-board--viewport-interacting')
    expect(reactFlowProps.current?.nodes).toBe(nodesBeforeMove)
    expect((reactFlowProps.current?.nodes?.find((node) => node.id === 'browser-1') as AtlasFlowNode).data).toBe(browserDataBeforeMove)
    unsubscribe()
  })

  it('defers pending autosaves while the viewport is being dragged', async () => {
    vi.useFakeTimers()
    const saveCanvas = vi.mocked(window.atlas.canvas.save)

    renderCanvasBoard()

    act(() => {
      useCanvasStore.getState().updateCanvas('canvas-1', (draft) => {
        draft.name = 'Changed'
      })
    })

    act(() => {
      reactFlowProps.current?.onMoveStart?.(null, { x: 120, y: 80, zoom: 1 })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(saveCanvas).not.toHaveBeenCalled()

    act(() => {
      reactFlowProps.current?.onMoveEnd?.(null, { x: 160, y: 95, zoom: 1 })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499)
    })
    expect(saveCanvas).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(saveCanvas.mock.calls[0][0].viewport).toEqual({ x: 160, y: 95, zoom: 1 })
  })

  it('does not persist or notify native browser overlays during node position changes', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)

    renderCanvasBoard()

    expect(reactFlowProps.current?.onNodesChange).toBeTypeOf('function')
    expect(reactFlowProps.current?.selectNodesOnDrag).toBe(false)
    expect(reactFlowProps.current?.selectionOnDrag).toBe(true)

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ type: 'position', id: 'component-1', position: { x: 80, y: 120 } }])
    })

    const component = useCanvasStore.getState().canvases['canvas-1'].components[0]
    expect(component.frame).toMatchObject({ x: 100, y: 120 })
    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')?.selected).not.toBe(true)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('keeps locked terminals fixed through React Flow move and remove changes', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('terminal-1', {
              type: 'terminal',
              title: 'Terminal',
              state: { locked: true }
            })
          ]
        }
      }
    }))
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)

    renderCanvasBoard()

    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'terminal-1')).toMatchObject({
      draggable: false,
      position: { x: 100, y: 120 }
    })
    expect((reactFlowProps.current?.nodes?.find((node) => node.id === 'terminal-1') as AtlasFlowNode).data.isFrameLocked).toBe(true)

    act(() => {
      reactFlowProps.current?.onNodesChange?.([
        { type: 'position', id: 'terminal-1', position: { x: 20, y: 40 } },
        { type: 'remove', id: 'terminal-1' }
      ])
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].components).toHaveLength(1)
    expect(useCanvasStore.getState().canvases['canvas-1'].components[0].frame).toMatchObject({ x: 100, y: 120 })
    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'terminal-1')).toMatchObject({
      position: { x: 100, y: 120 }
    })

    act(() => {
      const draggedNode = { ...reactFlowProps.current!.nodes!.find((node) => node.id === 'terminal-1')!, position: { x: 260, y: 280 } }
      reactFlowProps.current?.onNodeDragStart?.({} as ReactMouseEvent, draggedNode, [draggedNode])
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, draggedNode, [draggedNode])
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].components[0].frame).toMatchObject({ x: 100, y: 120 })
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('persists final node position, clears selection, and notifies native browser overlays when node dragging stops', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)

    renderCanvasBoard()

    const node = reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')
    expect(node).toBeDefined()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })
    expect(reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')?.selected).toBe(true)

    act(() => {
      const draggedNode = { ...node!, position: { x: 80.4, y: 121.6 } }
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, draggedNode, [draggedNode])
    })

    const component = useCanvasStore.getState().canvases['canvas-1'].components[0]
    expect(component.frame).toMatchObject({ x: 80, y: 122 })
    expect(reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')?.selected).not.toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('temporarily renders dragged nodes above higher z-index nodes without persisting the layer change', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1', { zIndex: 1 }),
            createComponent('component-2', { zIndex: 8, frame: { x: 560, y: 120, width: 420, height: 300 } })
          ]
        }
      }
    }))

    renderCanvasBoard()

    const draggedNode = reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')
    expect(draggedNode).toBeDefined()
    expect(draggedNode?.style).not.toHaveProperty('zIndex')

    act(() => {
      reactFlowProps.current?.onNodeDragStart?.({} as ReactMouseEvent, draggedNode!, [draggedNode!])
    })

    const raisedDraggedNode = reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')
    const stationaryNode = reactFlowProps.current?.nodes?.find((item) => item.id === 'component-2')
    expect(raisedDraggedNode?.zIndex).toBeGreaterThan(stationaryNode?.zIndex ?? 0)
    expect(useCanvasStore.getState().canvases['canvas-1'].components.find((component) => component.id === 'component-1')?.zIndex).toBe(1)

    act(() => {
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, { ...draggedNode!, position: { x: 100, y: 120 } }, [
        { ...draggedNode!, position: { x: 100, y: 120 } }
      ])
    })

    expect(reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')?.zIndex).toBe(1)
  })

  it('marks every moving component as node-dragging during multi-node drags', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1'),
            createComponent('browser-1', {
              type: 'browser',
              frame: { x: 560, y: 120, width: 420, height: 300 },
              state: {
                activeTabId: 'tab-1',
                tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com' }]
              }
            })
          ]
        }
      }
    }))

    renderCanvasBoard()

    const firstNode = reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')
    const browserNode = reactFlowProps.current?.nodes?.find((item) => item.id === 'browser-1')
    expect(firstNode).toBeDefined()
    expect(browserNode).toBeDefined()

    act(() => {
      reactFlowProps.current?.onNodeDragStart?.({} as ReactMouseEvent, firstNode!, [firstNode!, browserNode!])
    })

    await waitFor(() => {
      expect((reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1') as AtlasFlowNode).data.isNodeDragging).toBe(true)
      expect((reactFlowProps.current?.nodes?.find((item) => item.id === 'browser-1') as AtlasFlowNode).data.isNodeDragging).toBe(true)
    })

    act(() => {
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, firstNode!, [firstNode!, browserNode!])
    })

    await waitFor(() => {
      expect((reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1') as AtlasFlowNode).data.isNodeDragging).not.toBe(true)
      expect((reactFlowProps.current?.nodes?.find((item) => item.id === 'browser-1') as AtlasFlowNode).data.isNodeDragging).not.toBe(true)
    })
  })

  it('keeps selected nodes moving together across repeated group drags', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1'),
            createComponent('component-2', { frame: { x: 560, y: 120, width: 420, height: 300 } })
          ]
        }
      }
    }))
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)

    renderCanvasBoard()

    const firstNode = reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')
    const secondNode = reactFlowProps.current?.nodes?.find((item) => item.id === 'component-2')
    expect(firstNode).toBeDefined()
    expect(secondNode).toBeDefined()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([
        { id: 'component-1', type: 'select', selected: true },
        { id: 'component-2', type: 'select', selected: true }
      ])
    })
    expect(reactFlowProps.current?.nodes?.filter((item) => item.selected).map((item) => item.id)).toEqual(['component-1', 'component-2'])

    act(() => {
      const draggedNodes = [
        { ...firstNode!, position: { x: 140, y: 180 } },
        { ...secondNode!, position: { x: 600, y: 200 } }
      ]
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, draggedNodes[0], draggedNodes)
    })

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components[0].frame).toMatchObject({ x: 140, y: 180 })
    expect(components[1].frame).toMatchObject({ x: 600, y: 200 })
    expect(reactFlowProps.current?.nodes?.filter((item) => item.selected).map((item) => item.id)).toEqual(['component-1', 'component-2'])
    expect(listener).toHaveBeenCalledTimes(1)

    act(() => {
      const draggedNodes = [
        { ...reactFlowProps.current!.nodes!.find((item) => item.id === 'component-1')!, position: { x: 170, y: 210 } },
        { ...reactFlowProps.current!.nodes!.find((item) => item.id === 'component-2')!, position: { x: 630, y: 230 } }
      ]
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, draggedNodes[0], draggedNodes)
    })

    const movedAgainComponents = useCanvasStore.getState().canvases['canvas-1'].components
    expect(movedAgainComponents[0].frame).toMatchObject({ x: 170, y: 210 })
    expect(movedAgainComponents[1].frame).toMatchObject({ x: 630, y: 230 })
    expect(reactFlowProps.current?.nodes?.filter((item) => item.selected).map((item) => item.id)).toEqual(['component-1', 'component-2'])
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('creates a selected component from the selection-mode double-click menu at the pointer position', async () => {
    renderCanvasBoard()

    expect(reactFlowProps.current?.onPaneClick).toBeTypeOf('function')
    expect(reactFlowProps.current?.zoomOnDoubleClick).toBe(false)
    expect(reactFlowProps.current?.deleteKeyCode).toBeNull()

    act(() => {
      reactFlowProps.current?.onPaneClick?.({
        detail: 0,
        clientX: 320,
        clientY: 240,
        timeStamp: 100,
        preventDefault: vi.fn()
      } as unknown as ReactMouseEvent)
    })

    expect(screen.queryByRole('menu', { name: 'Create component' })).not.toBeInTheDocument()

    const preventDefault = vi.fn()
    act(() => {
      reactFlowProps.current?.onPaneClick?.({
        detail: 0,
        clientX: 322,
        clientY: 243,
        timeStamp: 320,
        preventDefault
      } as unknown as ReactMouseEvent)
    })

    expect(preventDefault).toHaveBeenCalled()

    const terminalItem = await screen.findByRole('menuitem', { name: 'Terminal' })
    const browserItem = await screen.findByRole('menuitem', { name: 'Browser' })
    const kanbanItem = await screen.findByRole('menuitem', { name: 'Kanban' })

    expect(terminalItem).toHaveClass('menu-item--active')
    fireEvent.mouseEnter(browserItem)
    expect(browserItem).toHaveClass('menu-item--active')
    expect(terminalItem).not.toHaveClass('menu-item--active')

    fireEvent.click(kanbanItem)

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(1)
    expect(components[0]).toMatchObject({
      type: 'kanban',
      frame: {
        x: 322,
        y: 243
      }
    })
  })

  it('still accepts a native click-detail double-click for the create menu', async () => {
    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onPaneClick?.({
        detail: 2,
        clientX: 320,
        clientY: 240,
        preventDefault: vi.fn()
      } as unknown as ReactMouseEvent)
    })

    const terminalItem = await screen.findByRole('menuitem', { name: 'Terminal' })
    const browserItem = await screen.findByRole('menuitem', { name: 'Browser' })
    const kanbanItem = await screen.findByRole('menuitem', { name: 'Kanban' })

    expect(terminalItem).toHaveClass('menu-item--active')
    fireEvent.mouseEnter(browserItem)
    expect(browserItem).toHaveClass('menu-item--active')
    expect(terminalItem).not.toHaveClass('menu-item--active')

    fireEvent.click(kanbanItem)

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(1)
    expect(components[0]).toMatchObject({
      type: 'kanban',
      frame: {
        x: 320,
        y: 240
      }
    })
  })

  it('opens the component creation menu with Tab at the mouse position', async () => {
    renderCanvasBoard()

    fireEvent.pointerMove(screen.getByTestId('canvas-flow'), { clientX: 480, clientY: 360, pointerType: 'mouse' })

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    const browserItem = await screen.findByRole('menuitem', { name: 'Browser' })

    fireEvent.click(browserItem)

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(reactFlowMock.screenToFlowPosition).toHaveBeenCalledWith({ x: 480, y: 360 })
    expect(components).toHaveLength(1)
    expect(components[0]).toMatchObject({
      type: 'browser',
      frame: {
        x: 480,
        y: 360
      }
    })
  })

  it('uses the configured shortcut to open the component creation menu', async () => {
    useAppSettingsStore.setState({
      settings: {
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: {
          ...DEFAULT_APP_SHORTCUTS,
          canvasDeselect: 'Ctrl+Q',
          canvasFind: 'Ctrl+F',
          canvasCreateComponent: 'Ctrl+Alt+K'
        },
        pet: { ...DEFAULT_PET_SETTINGS },
        updates: { ...DEFAULT_UPDATE_SETTINGS }
      }
    })

    renderCanvasBoard()

    fireEvent.pointerMove(screen.getByTestId('canvas-flow'), { clientX: 520, clientY: 390, pointerType: 'mouse' })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    })
    expect(screen.queryByRole('menu', { name: 'Create component' })).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }))
    })

    expect(await screen.findByRole('menuitem', { name: 'Terminal' })).toBeInTheDocument()
  })

  it('deletes the selected component with Delete', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].components).toHaveLength(0)
  })

  it('deletes from React Flow live selection when controlled nodes have not caught up yet', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    renderCanvasBoard()

    const visualSelectedNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')
    expect(visualSelectedNode?.selected).not.toBe(true)

    reactFlowMock.getNodes.mockReturnValue(visualSelectedNode ? [{ ...visualSelectedNode, selected: true }] : [])

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].components).toHaveLength(0)
  })

  it('deletes a selected terminal when Delete starts inside xterm focus', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1', {
              type: 'terminal',
              title: 'Terminal',
              config: {},
              state: {}
            })
          ]
        }
      }
    }))

    renderCanvasBoard()

    const selectedTerminalNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')
    reactFlowMock.getNodes.mockReturnValue(selectedTerminalNode ? [{ ...selectedTerminalNode, selected: true }] : [])

    const textarea = createXtermKeyboardTarget('component-1')

    try {
      fireEvent.keyDown(textarea, { key: 'Delete' })
    } finally {
      textarea.closest('.react-flow__node')?.remove()
    }

    expect(useCanvasStore.getState().canvases['canvas-1'].components).toHaveLength(0)
  })

  it('does not delete a locked terminal when Delete starts inside xterm focus', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1', {
              type: 'terminal',
              title: 'Terminal',
              config: {},
              state: { locked: true }
            })
          ]
        }
      }
    }))

    renderCanvasBoard()

    const selectedTerminalNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')
    reactFlowMock.getNodes.mockReturnValue(selectedTerminalNode ? [{ ...selectedTerminalNode, selected: true }] : [])

    const textarea = createXtermKeyboardTarget('component-1')

    try {
      fireEvent.keyDown(textarea, { key: 'Delete' })
    } finally {
      textarea.closest('.react-flow__node')?.remove()
    }

    expect(useCanvasStore.getState().canvases['canvas-1'].components).toHaveLength(1)
  })

  it('duplicates a dragged component with Alt+drag without moving the source', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    renderCanvasBoard()

    const node = reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')
    expect(node).toBeDefined()

    act(() => {
      reactFlowProps.current?.onNodeDragStart?.({ altKey: true } as ReactMouseEvent, node!, [node!])
    })

    act(() => {
      const draggedNode = { ...node!, position: { x: 220, y: 240 } }
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, draggedNode, [draggedNode])
    })

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(2)
    expect(components.find((component) => component.id === 'component-1')).toMatchObject({
      frame: { x: 100, y: 120, width: 420, height: 300 }
    })
    const duplicatedComponent = components.find((component) => component.id !== 'component-1')
    expect(duplicatedComponent).toMatchObject({
      type: 'markdown-note',
      title: 'Note',
      frame: { x: 220, y: 240, width: 420, height: 300 },
      zIndex: 2,
      state: { content: 'hello' }
    })
    expect(duplicatedComponent?.id).toBeDefined()
    await waitFor(() => expect(reactFlowProps.current?.nodes?.find((item) => item.id === duplicatedComponent?.id)?.selected).toBe(true))
    expect(reactFlowProps.current?.nodes?.find((item) => item.id === 'component-1')?.selected).not.toBe(true)
  })

  it('duplicates a grouped component with Alt+drag using the source group coordinates', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')],
          groups: [createGroup('group-1', { memberIds: ['component-1'] })]
        }
      }
    }))

    renderCanvasBoard()

    const componentNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')
    expect(componentNode).toMatchObject({
      parentId: 'group-1',
      position: { x: 20, y: 40 }
    })

    act(() => {
      reactFlowProps.current?.onNodeDragStart?.({ altKey: true } as ReactMouseEvent, componentNode!, [componentNode!])
    })

    act(() => {
      const draggedNode = { ...componentNode!, position: { x: 60, y: 80 } }
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, draggedNode, [draggedNode])
    })

    const canvas = useCanvasStore.getState().canvases['canvas-1']
    const duplicatedComponent = canvas.components.find((component) => component.id !== 'component-1')

    expect(canvas.components).toHaveLength(2)
    expect(canvas.components.find((component) => component.id === 'component-1')?.frame).toMatchObject({ x: 100, y: 120 })
    expect(duplicatedComponent?.frame).toMatchObject({ x: 140, y: 160 })
    expect(canvas.groups.find((group) => group.id === 'group-1')?.memberIds).toEqual(['component-1', duplicatedComponent?.id])
    await waitFor(() => expect(reactFlowProps.current?.nodes?.find((item) => item.id === duplicatedComponent?.id)?.selected).toBe(true))
  })

  it('duplicates a dragged group and its members with Alt+drag without moving the source group', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')],
          groups: [createGroup('group-1', { memberIds: ['component-1'] })]
        }
      }
    }))

    renderCanvasBoard()

    const groupNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'group-1')
    expect(groupNode).toBeDefined()

    act(() => {
      reactFlowProps.current?.onNodeDragStart?.({ altKey: true } as ReactMouseEvent, groupNode!, [groupNode!])
    })

    act(() => {
      const draggedGroupNode = { ...groupNode!, position: { x: 120, y: 100 } }
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, draggedGroupNode, [draggedGroupNode])
    })

    const canvas = useCanvasStore.getState().canvases['canvas-1']
    const originalGroup = canvas.groups.find((group) => group.id === 'group-1')
    const duplicatedGroup = canvas.groups.find((group) => group.id !== 'group-1')
    const duplicatedComponent = canvas.components.find((component) => duplicatedGroup?.memberIds.includes(component.id))

    expect(canvas.groups).toHaveLength(2)
    expect(canvas.components).toHaveLength(2)
    expect(originalGroup?.frame).toMatchObject({ x: 80, y: 80 })
    expect(canvas.components.find((component) => component.id === 'component-1')?.frame).toMatchObject({ x: 100, y: 120 })
    expect(duplicatedGroup?.frame).toMatchObject({ x: 120, y: 100 })
    expect(duplicatedGroup?.memberIds).toEqual(duplicatedComponent ? [duplicatedComponent.id] : [])
    expect(duplicatedComponent?.frame).toMatchObject({ x: 140, y: 140 })
    await waitFor(() => expect(reactFlowProps.current?.nodes?.find((item) => item.id === duplicatedGroup?.id)?.selected).toBe(true))
    expect(reactFlowProps.current?.nodes?.find((item) => item.id === 'group-1')?.selected).not.toBe(true)
  })

  it('hides group selection actions and ignores Ctrl+G for one selected component', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })

    expect(screen.queryByRole('button', { name: 'Group selection' })).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].groups).toHaveLength(0)
  })

  it('shows group selection actions for two selected components and groups from the toolbar', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1'),
            createComponent('component-2', { frame: { x: 560, y: 160, width: 200, height: 160 } })
          ]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([
        { id: 'component-1', type: 'select', selected: true },
        { id: 'component-2', type: 'select', selected: true }
      ])
    })

    const groupButton = screen.getByRole('button', { name: 'Group selection' })
    expect(groupButton).toBeEnabled()

    fireEvent.click(groupButton)

    await waitFor(() => expect(useCanvasStore.getState().canvases['canvas-1'].groups).toHaveLength(1))
    expect(useCanvasStore.getState().canvases['canvas-1'].groups[0].memberIds).toEqual(['component-1', 'component-2'])
  })

  it('keeps selected group actions available from the selection toolbar', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          groups: [createGroup('group-1')]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'group-1', type: 'select', selected: true }])
    })

    expect(screen.getByRole('button', { name: 'Group selection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit group' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ungroup selection' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete group' })).toBeEnabled()
  })

  it('groups selected components with Ctrl+G and selects the new group', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1'),
            createComponent('component-2', { frame: { x: 560, y: 160, width: 200, height: 160 } })
          ]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([
        { id: 'component-1', type: 'select', selected: true },
        { id: 'component-2', type: 'select', selected: true }
      ])
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    const groups = useCanvasStore.getState().canvases['canvas-1'].groups
    expect(groups).toHaveLength(1)
    expect(groups[0].memberIds).toEqual(['component-1', 'component-2'])
    await waitFor(() => expect(reactFlowProps.current?.nodes?.find((node) => node.id === groups[0].id)?.selected).toBe(true))
  })

  it('persists group dragging by moving the frame and member components together', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')],
          groups: [createGroup('group-1', { memberIds: ['component-1'] })]
        }
      }
    }))

    renderCanvasBoard()

    const groupNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'group-1')
    expect(groupNode).toBeDefined()

    act(() => {
      reactFlowProps.current?.onNodeDragStop?.({} as ReactMouseEvent, { ...groupNode!, position: { x: 120, y: 100 } }, [
        { ...groupNode!, position: { x: 120, y: 100 } }
      ])
    })

    const canvas = useCanvasStore.getState().canvases['canvas-1']
    expect(canvas.groups[0].frame).toMatchObject({ x: 120, y: 100 })
    expect(canvas.components[0].frame).toMatchObject({ x: 140, y: 140 })
  })

  it('passes parent group position to grouped component nodes', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')],
          groups: [createGroup('group-1', { memberIds: ['component-1'] })]
        }
      }
    }))

    renderCanvasBoard()

    const componentNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')
    expect(componentNode).toMatchObject({
      parentId: 'group-1',
      position: { x: 20, y: 40 },
      data: {
        parentGroupPosition: { x: 80, y: 80 }
      }
    })
  })

  it('opens group-aware delete confirmation and can remove only the group frame', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')],
          groups: [createGroup('group-1', { memberIds: ['component-1'] })]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'group-1', type: 'select', selected: true }])
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    })

    expect(await screen.findByRole('dialog', { name: 'Delete group?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove group only' }))

    const canvas = useCanvasStore.getState().canvases['canvas-1']
    expect(canvas.groups).toHaveLength(0)
    expect(canvas.components).toHaveLength(1)
  })

  it('finds groups by notes and focuses the selected group result', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          groups: [createGroup('group-1', { title: 'Research', notes: 'Launch checklist', frame: { x: 40, y: 60, width: 300, height: 180 } })]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    const input = await screen.findByPlaceholderText('Find nodes')
    fireEvent.change(input, { target: { value: 'checklist' } })
    fireEvent.click(await screen.findByText('Research'))

    expect(reactFlowMock.setCenter).toHaveBeenCalledWith(190, 150, expect.objectContaining({ zoom: 1.15 }))
    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'group-1')?.selected).toBe(true)
  })

  it('clears selected components with Ctrl+Q', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1'),
            createComponent('component-2', { frame: { x: 560, y: 120, width: 420, height: 300 } })
          ]
        }
      }
    }))
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)

    try {
      renderCanvasBoard()

      act(() => {
        reactFlowProps.current?.onNodesChange?.([
          { id: 'component-1', type: 'select', selected: true },
          { id: 'component-2', type: 'select', selected: true }
        ])
      })
      expect(reactFlowProps.current?.nodes?.filter((item) => item.selected).map((item) => item.id)).toEqual(['component-1', 'component-2'])

      const event = new KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, cancelable: true })
      act(() => {
        window.dispatchEvent(event)
      })

      expect(event.defaultPrevented).toBe(true)
      expect(reactFlowProps.current?.nodes?.some((item) => item.selected)).toBe(false)
      expect(useCanvasStore.getState().canvases['canvas-1'].components).toHaveLength(2)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it('uses the configured shortcut to clear selected components', () => {
    useAppSettingsStore.setState({
      settings: {
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: {
          ...DEFAULT_APP_SHORTCUTS,
          canvasDeselect: 'Ctrl+Shift+X',
          canvasFind: 'Ctrl+F',
          canvasCreateComponent: 'Tab'
        },
        pet: { ...DEFAULT_PET_SETTINGS },
        updates: { ...DEFAULT_UPDATE_SETTINGS }
      }
    })
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')?.selected).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')?.selected).toBe(false)
  })

  it('clears a selected terminal and restores canvas shortcuts with Ctrl+Q from inside xterm focus', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1', {
              type: 'terminal',
              title: 'Terminal',
              config: {},
              state: {}
            })
          ]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })
    const textarea = createXtermKeyboardTarget('component-1')

    try {
      textarea.focus()
      expect(document.activeElement).toBe(textarea)
      fireEvent.keyDown(textarea, { key: 'q', ctrlKey: true })

      expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')?.selected).toBe(false)
      expect(document.activeElement).not.toBe(textarea)

      const keyboardTarget = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
      fireEvent.keyDown(keyboardTarget, { key: 'f', ctrlKey: true })
      expect(await screen.findByRole('dialog', { name: 'Find canvas node' })).toBeInTheDocument()
    } finally {
      textarea.closest('.react-flow__node')?.remove()
    }
  })

  it('opens the node finder with Ctrl+F and focuses the clicked node', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1', { title: 'First note' }),
            createComponent('component-2', {
              title: 'Second note',
              zIndex: 2,
              frame: { x: 560, y: 120, width: 420, height: 300 }
            })
          ]
        }
      }
    }))

    const nodeElement = document.createElement('div')
    nodeElement.className = 'react-flow__node'
    nodeElement.dataset.id = 'component-2'
    nodeElement.tabIndex = 0
    document.body.appendChild(nodeElement)

    try {
      renderCanvasBoard()

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
      })

      const secondOption = await screen.findByRole('option', { name: /Second note/ })
      expect(screen.getByRole('option', { name: /First note/ })).toBeInTheDocument()

      fireEvent.click(secondOption)

      await waitFor(() => {
        expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')?.selected).toBe(false)
        expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-2')?.selected).toBe(true)
      })

      expect(reactFlowMock.setCenter).toHaveBeenCalledWith(770, 270, { duration: 180, zoom: 1.15 })
      expect(useCanvasStore.getState().canvases['canvas-1'].components.find((component) => component.id === 'component-2')?.zIndex).toBeGreaterThan(2)
      await waitFor(() => expect(document.activeElement).toBe(nodeElement))
    } finally {
      nodeElement.remove()
    }
  })

  it('opens the node finder from a selected node body with Ctrl+F', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1', { title: 'First note' })]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })

    const target = createComponentBodyKeyboardTarget('component-1')

    try {
      fireEvent.keyDown(target, { key: 'f', ctrlKey: true })
      expect(await screen.findByRole('dialog', { name: 'Find canvas node' })).toBeInTheDocument()
      expect(await screen.findByRole('option', { name: /First note/ })).toBeInTheDocument()
    } finally {
      target.closest('.react-flow__node')?.remove()
    }
  })

  it('uses the configured shortcut to open the node finder', async () => {
    useAppSettingsStore.setState({
      settings: {
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: {
          ...DEFAULT_APP_SHORTCUTS,
          canvasDeselect: 'Ctrl+Q',
          canvasFind: 'Alt+K',
          canvasCreateComponent: 'Tab'
        },
        pet: { ...DEFAULT_PET_SETTINGS },
        updates: { ...DEFAULT_UPDATE_SETTINGS }
      }
    })
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1', { title: 'First note' })]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(screen.queryByRole('dialog', { name: 'Find canvas node' })).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', altKey: true, bubbles: true, cancelable: true }))
    })

    expect(await screen.findByRole('option', { name: /First note/ })).toBeInTheDocument()
  })

  it('supports arrow-key selection and Enter in the node finder', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1', { title: 'Alpha note' }),
            createComponent('component-2', {
              title: 'Beta note',
              frame: { x: 640, y: 260, width: 420, height: 300 }
            })
          ]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    const input = await screen.findByRole('combobox', { name: 'Find canvas node' })
    const betaOption = await screen.findByRole('option', { name: /Beta note/ })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(betaOption).toHaveAttribute('aria-selected', 'true'))

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-2')?.selected).toBe(true)
    })
    expect(reactFlowMock.setCenter).toHaveBeenCalledWith(850, 410, { duration: 180, zoom: 1.15 })
  })

  it('scrolls the node finder list back to the top when search changes', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1', { title: 'Alpha note' }),
            createComponent('component-2', { title: 'Beta note' }),
            createComponent('component-3', { title: 'Gamma note' }),
            createComponent('component-4', { title: 'Delta note' })
          ]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    const input = await screen.findByRole('combobox', { name: 'Find canvas node' })
    const list = await screen.findByRole('listbox', { name: 'Canvas nodes' })
    list.scrollTop = 360

    fireEvent.change(input, { target: { value: 'Gamma' } })

    await waitFor(() => expect(list.scrollTop).toBe(0))
  })

  it('shows type-specific paths and URLs in the node finder', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('terminal-1', {
              type: 'terminal',
              title: 'Shell',
              config: { cwd: 'D:\\fallback' },
              state: { cwd: 'D:\\repo' }
            }),
            createComponent('browser-1', {
              type: 'browser',
              title: 'Docs',
              state: {
                activeTabId: 'tab-2',
                tabs: [
                  { localId: 'tab-1', title: 'Home', url: 'https://example.com' },
                  { localId: 'tab-2', title: 'Docs', url: 'https://atlas.local/docs' }
                ]
              }
            }),
            createComponent('file-tree-1', {
              type: 'file-tree',
              title: 'Files',
              config: { rootPath: 'D:\\workspace' }
            }),
            createComponent('file-preview-1', {
              type: 'file-preview',
              title: 'app.ts',
              bindings: { rootPath: 'D:\\workspace', path: 'D:\\workspace\\src\\app.ts' }
            }),
            createComponent('markdown-1', {
              title: 'Readme',
              bindings: { rootPath: 'D:\\workspace', path: 'D:\\workspace\\README.md' }
            }),
            createComponent('kanban-1', {
              type: 'kanban',
              title: 'Roadmap',
              state: {
                kanban: {
                  schemaVersion: 1,
                  columns: [
                    {
                      id: 'backlog',
                      title: 'Backlog',
                      cardIds: ['card-1'],
                      wipLimit: null,
                      createdAt: '2026-05-21T00:00:00.000Z',
                      updatedAt: '2026-05-21T00:00:00.000Z'
                    },
                    {
                      id: 'done',
                      title: 'Done',
                      cardIds: [],
                      wipLimit: null,
                      createdAt: '2026-05-21T00:00:00.000Z',
                      updatedAt: '2026-05-21T00:00:00.000Z'
                    }
                  ],
                  cards: {
                    'card-1': {
                      id: 'card-1',
                      title: 'Ship kanban',
                      description: '',
                      labels: ['planning'],
                      priority: 'high',
                      assignee: 'Ada',
                      dueDate: '',
                      createdAt: '2026-05-21T00:00:00.000Z',
                      updatedAt: '2026-05-21T00:00:00.000Z'
                    }
                  },
                  view: { search: '', labels: [], assignees: [], priorities: [] }
                }
              }
            })
          ]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    expect(await screen.findByText('D:\\repo')).toBeInTheDocument()
    expect(screen.getByText('https://atlas.local/docs')).toBeInTheDocument()
    expect(screen.getByText('D:\\workspace')).toBeInTheDocument()
    expect(screen.getByText('D:\\workspace\\src\\app.ts')).toBeInTheDocument()
    expect(screen.getByText('D:\\workspace\\README.md')).toBeInTheDocument()
    expect(screen.getByText('2 columns · 1 cards')).toBeInTheDocument()
  })

  it('searches kanban card metadata in the node finder', async () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('kanban-1', {
              type: 'kanban',
              title: 'Roadmap',
              state: {
                kanban: {
                  schemaVersion: 1,
                  columns: [
                    {
                      id: 'backlog',
                      title: 'Backlog',
                      cardIds: ['card-1'],
                      wipLimit: null,
                      createdAt: '2026-05-21T00:00:00.000Z',
                      updatedAt: '2026-05-21T00:00:00.000Z'
                    }
                  ],
                  cards: {
                    'card-1': {
                      id: 'card-1',
                      title: 'Hidden launch token',
                      description: '',
                      labels: ['launch-plan'],
                      priority: 'medium',
                      assignee: 'Ada',
                      dueDate: '',
                      createdAt: '2026-05-21T00:00:00.000Z',
                      updatedAt: '2026-05-21T00:00:00.000Z'
                    }
                  },
                  view: { search: '', labels: [], assignees: [], priorities: [] }
                }
              }
            })
          ]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    const input = await screen.findByRole('combobox', { name: 'Find canvas node' })
    fireEvent.change(input, { target: { value: 'launch-plan' } })

    await waitFor(() => expect(screen.getByRole('option', { name: /Roadmap/ })).toBeInTheDocument())
  })

  it('selects and raises a component when it requests context-menu selection', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [
            createComponent('component-1', { zIndex: 1 }),
            createComponent('component-2', { zIndex: 2, frame: { x: 560, y: 120, width: 420, height: 300 } })
          ]
        }
      }
    }))

    renderCanvasBoard()

    const componentNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'component-2') as AtlasFlowNode | undefined
    const requestSelect = componentNode?.data.onRequestSelect
    expect(requestSelect).toBeTypeOf('function')

    act(() => {
      requestSelect?.('component-2')
    })

    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')?.selected).toBe(false)
    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-2')?.selected).toBe(true)

    const raisedComponent = useCanvasStore.getState().canvases['canvas-1'].components.find((component) => component.id === 'component-2')
    expect(raisedComponent?.zIndex).toBeGreaterThan(2)
  })

  it('creates media previews for externally dropped image and video files', async () => {
    const imageFile = new File(['image'], 'photo.png', { type: 'image/png' })
    const videoFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const imagePath = 'D:\\media\\photo.png'
    const videoPath = 'D:\\media\\clip.mp4'
    const filesystem = window.atlas.filesystem

    vi.mocked(filesystem.getPathForFile).mockImplementation((file) => (file.name === 'photo.png' ? imagePath : videoPath))
    vi.mocked(filesystem.listTree).mockImplementation(async (rootPath: string) => ({
      id: rootPath,
      name: rootPath.endsWith('photo.png') ? 'photo.png' : 'clip.mp4',
      path: rootPath,
      kind: 'file'
    }))

    renderCanvasBoard()

    await act(async () => {
      await reactFlowProps.current?.onDrop?.(createDropEvent(createFileDropDataTransfer([imageFile, videoFile])))
    })

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(2)
    expect(components[0]).toMatchObject({
      type: 'file-preview',
      title: 'photo.png',
      frame: { x: 320, y: 240 },
      config: { mimeType: 'image/png' },
      bindings: { rootPath: imagePath, path: imagePath }
    })
    expect(components[1]).toMatchObject({
      type: 'file-preview',
      title: 'clip.mp4',
      frame: { x: 352, y: 240 },
      config: { mimeType: 'video/mp4' },
      bindings: { rootPath: videoPath, path: videoPath }
    })
  })

  it('sizes externally dropped image previews from intrinsic image dimensions', async () => {
    const createImageBitmapMock = vi.fn(async () => ({
      width: 1600,
      height: 900,
      close: vi.fn()
    }))
    const previousCreateImageBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
    const imageFile = new File(['image'], 'wide.png', { type: 'image/png' })
    const imagePath = 'D:\\media\\wide.png'
    const filesystem = window.atlas.filesystem

    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: createImageBitmapMock
    })

    try {
      vi.mocked(filesystem.getPathForFile).mockReturnValue(imagePath)
      vi.mocked(filesystem.listTree).mockResolvedValue({
        id: imagePath,
        name: 'wide.png',
        path: imagePath,
        kind: 'file'
      })

      renderCanvasBoard()

      await act(async () => {
        await reactFlowProps.current?.onDrop?.(createDropEvent(createFileDropDataTransfer([imageFile])))
      })

      const component = useCanvasStore.getState().canvases['canvas-1'].components[0]
      expect(component.frame).toMatchObject({ x: 320, y: 240, width: 560, height: 353 })
      expect(component.config.mediaAspectRatio).toBeCloseTo(16 / 9)
      expect(component.config.mediaWidth).toBe(1600)
      expect(component.config.mediaHeight).toBe(900)
    } finally {
      if (previousCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', previousCreateImageBitmap)
      } else {
        delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap
      }
    }
  })

  it('seeds a markdown note from a dropped markdown file', async () => {
    const markdownFile = new File(['# Hello'], 'readme.md', { type: 'text/markdown' })
    const markdownPath = 'D:\\docs\\readme.md'
    const filesystem = window.atlas.filesystem

    vi.mocked(filesystem.getPathForFile).mockReturnValue(markdownPath)
    vi.mocked(filesystem.listTree).mockResolvedValue({
      id: markdownPath,
      name: 'readme.md',
      path: markdownPath,
      kind: 'file'
    })
    vi.mocked(filesystem.readFile).mockResolvedValue('# Hello')

    renderCanvasBoard()

    await act(async () => {
      await reactFlowProps.current?.onDrop?.(createDropEvent(createFileDropDataTransfer([markdownFile])))
    })

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(1)
    expect(components[0]).toMatchObject({
      type: 'markdown-note',
      title: 'readme.md',
      state: { content: '# Hello', status: 'live' },
      bindings: { rootPath: markdownPath, path: markdownPath }
    })
  })

  it('creates a text preview from an internally dropped code file', async () => {
    renderCanvasBoard()

    await act(async () => {
      await reactFlowProps.current?.onDrop?.(
        createDropEvent(
          createAtlasFileDropDataTransfer({
            path: 'D:\\repo\\src\\app.ts',
            name: 'app.ts',
            kind: 'file',
            rootPath: 'D:\\repo'
          }),
          480,
          360
        )
      )
    })

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(1)
    expect(components[0]).toMatchObject({
      type: 'file-preview',
      title: 'app.ts',
      frame: { x: 480, y: 360 },
      bindings: { rootPath: 'D:\\repo', path: 'D:\\repo\\src\\app.ts' }
    })
  })

  it('clears the canvas file drag indicator when a child drop target consumes the file drop', () => {
    const imageFile = new File(['image'], 'photo.png', { type: 'image/png' })
    const { container } = renderCanvasBoard()
    const board = container.querySelector('.canvas-board') as HTMLElement
    const flow = screen.getByTestId('canvas-flow')
    const childDropTarget = document.createElement('div')

    childDropTarget.addEventListener('drop', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    flow.appendChild(childDropTarget)

    fireEvent.dragOver(flow, { dataTransfer: createFileDropDataTransfer([imageFile]) })
    expect(board).toHaveClass('canvas-board--file-drag-active')

    fireEvent.drop(childDropTarget, { dataTransfer: createFileDropDataTransfer([imageFile]) })
    expect(board).not.toHaveClass('canvas-board--file-drag-active')
  })

  it('does not delete selected components while an editable target has focus', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })

    const input = document.createElement('input')
    document.body.appendChild(input)

    try {
      fireEvent.keyDown(input, { key: 'Delete' })
      expect(useCanvasStore.getState().canvases['canvas-1'].components).toHaveLength(1)
    } finally {
      input.remove()
    }
  })

  it('does not open the node finder while an editable target has focus', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    renderCanvasBoard()

    const input = document.createElement('input')
    document.body.appendChild(input)

    try {
      fireEvent.keyDown(input, { key: 'f', ctrlKey: true })
      expect(screen.queryByRole('dialog', { name: 'Find canvas node' })).not.toBeInTheDocument()
    } finally {
      input.remove()
    }
  })

  it('does not clear selected components while an unrelated editable target has focus', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    renderCanvasBoard()

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })

    const input = document.createElement('input')
    document.body.appendChild(input)

    try {
      fireEvent.keyDown(input, { key: 'q', ctrlKey: true })
      expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')?.selected).toBe(true)
    } finally {
      input.remove()
    }
  })
})
