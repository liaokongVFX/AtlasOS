import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent, FileEntry } from '@shared/schema'
import { useCanvasStore } from '../../store/canvas-store'
import { FileTreeComponent } from './file-tree-component'

type CanvasStoreState = ReturnType<typeof useCanvasStore.getState>

const initialStore = useCanvasStore.getState()

const tree: FileEntry = {
  id: 'D:\\repo',
  name: 'repo',
  path: 'D:\\repo',
  kind: 'directory',
  children: [
    {
      id: 'D:\\repo\\src',
      name: 'src',
      path: 'D:\\repo\\src',
      kind: 'directory',
      children: [
        {
          id: 'D:\\repo\\src\\index.ts',
          name: 'index.ts',
          path: 'D:\\repo\\src\\index.ts',
          kind: 'file'
        }
      ]
    }
  ]
}

function createComponent(): CanvasComponent {
  const timestamp = '2026-05-21T00:00:00.000Z'

  return {
    id: 'file-tree-1',
    type: 'file-tree',
    title: 'Files',
    frame: { x: 120, y: 80, width: 360, height: 420 },
    zIndex: 1,
    config: { rootPath: 'D:\\repo' },
    state: {},
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function renderFileTree(component = createComponent()): void {
  render(
    <FileTreeComponent
      canvasId="canvas-1"
      component={component}
      updateConfig={vi.fn()}
      updateState={vi.fn()}
      setTitle={vi.fn()}
    />
  )
}

describe('FileTreeComponent', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        filesystem: {
          chooseDirectory: vi.fn(),
          listTree: vi.fn(async () => tree),
          onWatchEvent: vi.fn(() => vi.fn()),
          revealInFolder: vi.fn(),
          unwatch: vi.fn(),
          watch: vi.fn(async () => ({ watchId: 'watch-1' }))
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    useCanvasStore.setState(initialStore, true)
  })

  it('opens the context menu and selects the file on right-click', async () => {
    renderFileTree()

    const fileName = await screen.findByText('index.ts')
    await act(async () => {
      fireEvent.contextMenu(fileName, { button: 2, clientX: 64, clientY: 96 })
    })

    expect(await screen.findByRole('menuitem', { name: '复制文件路径' })).toBeVisible()
    expect(fileName.closest('.file-tree-row')).toHaveClass('file-tree-row--selected')
  })

  it('creates a terminal next to the file tree with the selected file directory as cwd', async () => {
    const addComponent = vi.fn()
    useCanvasStore.setState({ addComponent } as Partial<CanvasStoreState>)
    renderFileTree()

    const fileName = await screen.findByText('index.ts')
    await act(async () => {
      fireEvent.contextMenu(fileName, { button: 2, clientX: 64, clientY: 96 })
    })
    const openCommandLineItem = await screen.findByRole('menuitem', { name: '打开命令行' })

    await act(async () => {
      fireEvent.click(openCommandLineItem)
    })

    expect(addComponent).toHaveBeenCalledWith(
      'terminal',
      { x: 504, y: 80 },
      {
        config: { cwd: 'D:\\repo\\src' },
        state: { cwd: 'D:\\repo\\src' }
      }
    )
  })
})
