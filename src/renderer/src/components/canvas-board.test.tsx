import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import type { CanvasComponent, CanvasDocument } from '@shared/schema'
import { subscribeCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { useCanvasStore } from '../store/canvas-store'
import { CanvasBoard } from './canvas-board'
import type { AtlasFlowNode } from './component-node'

type CapturedReactFlowProps = {
  deleteKeyCode?: string | string[] | null
  nodes?: AtlasFlowNode[]
  onNodesChange?: (changes: Array<Record<string, unknown>>) => void
  onDragOver?: (event: ReactDragEvent) => void
  onDrop?: (event: ReactDragEvent) => void | Promise<void>
  onMove?: (event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => void
  onNodeDragStop?: (event: ReactMouseEvent, node: AtlasFlowNode, nodes: AtlasFlowNode[]) => void
  onPaneClick?: (event: ReactMouseEvent) => void
  selectNodesOnDrag?: boolean
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
    Background: () => null,
    BackgroundVariant: {
      Cross: 'cross',
      Dots: 'dots',
      Lines: 'lines'
    },
    MiniMap: () => null,
    NodeResizer: () => null,
    Panel: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    ReactFlow: (props: CapturedReactFlowProps & { children?: React.ReactNode }) => {
      reactFlowProps.current = props
      return React.createElement('div', { 'data-testid': 'canvas-flow' }, props.children)
    },
    useReactFlow: () => reactFlowMock,
    useViewport: () => ({ zoom: 1 })
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

function createCanvas(): CanvasDocument {
  const timestamp = '2026-05-21T00:00:00.000Z'

  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    id: 'canvas-1',
    name: 'Canvas',
    viewport: { ...DEFAULT_VIEWPORT },
    background: {
      color: DEFAULT_CANVAS_BACKGROUND.color,
      grid: { ...DEFAULT_CANVAS_BACKGROUND.grid },
      image: { ...DEFAULT_CANVAS_BACKGROUND.image }
    },
    components: [],
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
  })

  it('notifies native browser overlays during viewport moves', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCanvasViewportSync(listener)

    render(<CanvasBoard />)

    expect(reactFlowProps.current?.onMove).toBeTypeOf('function')

    act(() => {
      reactFlowProps.current?.onMove?.(null, { x: 120, y: 80, zoom: 1 })
      reactFlowProps.current?.onMove?.(null, { x: 160, y: 95, zoom: 1 })
    })

    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
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

    render(<CanvasBoard />)

    expect(reactFlowProps.current?.onNodesChange).toBeTypeOf('function')
    expect(reactFlowProps.current?.selectNodesOnDrag).toBe(false)

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ type: 'position', id: 'component-1', position: { x: 80, y: 120 } }])
    })

    const component = useCanvasStore.getState().canvases['canvas-1'].components[0]
    expect(component.frame).toMatchObject({ x: 100, y: 120 })
    expect(reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')?.selected).not.toBe(true)
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

    render(<CanvasBoard />)

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

  it('persists all selected node positions together when group dragging stops', () => {
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

    render(<CanvasBoard />)

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
    expect(reactFlowProps.current?.nodes?.some((item) => item.selected)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('creates a selected component from the double-click menu at the pointer position', async () => {
    render(<CanvasBoard />)

    expect(reactFlowProps.current?.onPaneClick).toBeTypeOf('function')
    expect(reactFlowProps.current?.zoomOnDoubleClick).toBe(false)
    expect(reactFlowProps.current?.deleteKeyCode).toBeNull()

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

    expect(terminalItem).toHaveClass('menu-item--active')
    fireEvent.mouseEnter(browserItem)
    expect(browserItem).toHaveClass('menu-item--active')
    expect(terminalItem).not.toHaveClass('menu-item--active')

    fireEvent.click(browserItem)

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(1)
    expect(components[0]).toMatchObject({
      type: 'browser',
      frame: {
        x: 320,
        y: 240
      }
    })
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

    render(<CanvasBoard />)

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

    render(<CanvasBoard />)

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

    render(<CanvasBoard />)

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

  it('duplicates the selected component with Ctrl+D', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    render(<CanvasBoard />)

    act(() => {
      reactFlowProps.current?.onNodesChange?.([{ id: 'component-1', type: 'select', selected: true }])
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(2)
    expect(components[1]).toMatchObject({
      type: 'markdown-note',
      title: 'Note',
      frame: { x: 132, y: 152, width: 420, height: 300 },
      zIndex: 2,
      state: { content: 'hello' }
    })
    expect(components[1].id).not.toBe('component-1')
  })

  it('duplicates from React Flow live selection when controlled nodes have not caught up yet', () => {
    useCanvasStore.setState((state) => ({
      canvases: {
        ...state.canvases,
        'canvas-1': {
          ...state.canvases['canvas-1'],
          components: [createComponent('component-1')]
        }
      }
    }))

    render(<CanvasBoard />)

    const visualSelectedNode = reactFlowProps.current?.nodes?.find((node) => node.id === 'component-1')
    expect(visualSelectedNode?.selected).not.toBe(true)

    reactFlowMock.getNodes.mockReturnValue(visualSelectedNode ? [{ ...visualSelectedNode, selected: true }] : [])

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    const components = useCanvasStore.getState().canvases['canvas-1'].components
    expect(components).toHaveLength(2)
    expect(components[1].id).not.toBe('component-1')
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
      render(<CanvasBoard />)

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

    render(<CanvasBoard />)

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
            })
          ]
        }
      }
    }))

    render(<CanvasBoard />)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    expect(await screen.findByText('D:\\repo')).toBeInTheDocument()
    expect(screen.getByText('https://atlas.local/docs')).toBeInTheDocument()
    expect(screen.getByText('D:\\workspace')).toBeInTheDocument()
    expect(screen.getByText('D:\\workspace\\src\\app.ts')).toBeInTheDocument()
    expect(screen.getByText('D:\\workspace\\README.md')).toBeInTheDocument()
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

    render(<CanvasBoard />)

    const requestSelect = reactFlowProps.current?.nodes?.find((node) => node.id === 'component-2')?.data.onRequestSelect
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

    render(<CanvasBoard />)

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

      render(<CanvasBoard />)

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

    render(<CanvasBoard />)

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
    render(<CanvasBoard />)

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

    render(<CanvasBoard />)

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

    render(<CanvasBoard />)

    const input = document.createElement('input')
    document.body.appendChild(input)

    try {
      fireEvent.keyDown(input, { key: 'f', ctrlKey: true })
      expect(screen.queryByRole('dialog', { name: 'Find canvas node' })).not.toBeInTheDocument()
    } finally {
      input.remove()
    }
  })
})
