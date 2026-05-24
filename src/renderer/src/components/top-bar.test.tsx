import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import type { AtlasAppState, CanvasDocument } from '@shared/schema'
import { useCanvasStore } from '../store/canvas-store'
import { TopBar } from './top-bar'

const initialStore = useCanvasStore.getState()
const timestamp = '2026-05-21T00:00:00.000Z'

function createCanvas(id: string, name: string): CanvasDocument {
  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    id,
    name,
    viewport: { ...DEFAULT_VIEWPORT },
    background: {
      color: DEFAULT_CANVAS_BACKGROUND.color,
      image: { ...DEFAULT_CANVAS_BACKGROUND.image }
    },
    components: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function createAppState(): AtlasAppState {
  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    activeCanvasId: 'canvas-1',
    canvasOrder: ['canvas-1', 'canvas-2'],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()

  return {
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn((type?: string) => {
      if (type) values.delete(type)
      else values.clear()
    }),
    getData: vi.fn((type: string) => values.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value)
    }),
    setDragImage: vi.fn()
  }
}

describe('TopBar workspace tabs', () => {
  const setActiveCanvas = vi.fn(() => Promise.resolve())
  const reorderCanvases = vi.fn(() => Promise.resolve())
  const renameCanvas = vi.fn()
  const deleteCanvas = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    setActiveCanvas.mockClear()
    reorderCanvases.mockClear()
    renameCanvas.mockClear()
    deleteCanvas.mockClear()

    useCanvasStore.setState(
      {
        ...initialStore,
        activeCanvasId: 'canvas-1',
        appState: createAppState(),
        canvases: {
          'canvas-1': createCanvas('canvas-1', 'Canvas One'),
          'canvas-2': createCanvas('canvas-2', 'Canvas Two')
        },
        error: null,
        saveState: 'idle',
        setActiveCanvas,
        reorderCanvases,
        renameCanvas,
        deleteCanvas
      },
      true
    )
  })

  afterEach(() => {
    cleanup()
    useCanvasStore.setState(initialStore, true)
  })

  it('renames a workspace tab from a double-click edit', () => {
    render(<TopBar />)

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Canvas One' }))
    const input = screen.getByLabelText('Rename Canvas One')
    fireEvent.change(input, { target: { value: 'Roadmap' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(renameCanvas).toHaveBeenCalledWith('canvas-1', 'Roadmap')
  })

  it('does not show component creation buttons in the top bar', () => {
    render(<TopBar />)

    expect(screen.queryByRole('button', { name: 'Add Terminal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Files' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Browser' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Note' })).not.toBeInTheDocument()
  })

  it('reorders workspace tabs by dragging after another tab', () => {
    render(<TopBar />)

    const source = screen.getByRole('button', { name: 'Canvas One' }).closest('.workspace-tab')
    const target = screen.getByRole('button', { name: 'Canvas Two' }).closest('.workspace-tab')
    const dataTransfer = createDataTransfer()

    expect(source).not.toBeNull()
    expect(target).not.toBeNull()

    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({
        bottom: 34,
        height: 34,
        left: -100,
        right: 0,
        top: 0,
        width: 100,
        x: -100,
        y: 0,
        toJSON: () => ({})
      })
    })

    const dragOverEvent = createEvent.dragOver(target as Element, { dataTransfer })
    const dropEvent = createEvent.drop(target as Element, { dataTransfer })
    Object.defineProperty(dragOverEvent, 'clientX', { value: 75 })
    Object.defineProperty(dropEvent, 'clientX', { value: 75 })

    fireEvent.dragStart(source as Element, { dataTransfer })
    fireEvent(target as Element, dragOverEvent)
    fireEvent(target as Element, dropEvent)

    expect(reorderCanvases).toHaveBeenCalledWith(['canvas-2', 'canvas-1'])
  })

  it('asks before deleting the selected workspace tab', () => {
    render(<TopBar />)

    fireEvent.click(screen.getByLabelText('Delete Canvas One'))

    expect(screen.getByText('Delete "Canvas One"?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteCanvas).toHaveBeenCalledWith('canvas-1')
  })
})
