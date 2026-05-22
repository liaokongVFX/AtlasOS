import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent, FileEntry } from '@shared/schema'
import { useCanvasStore } from '../../store/canvas-store'
import { FileTreeComponent } from './file-tree-component'

type CanvasStoreState = ReturnType<typeof useCanvasStore.getState>

const initialStore = useCanvasStore.getState()

const rootTree: FileEntry = {
  id: 'D:\\repo',
  name: 'repo',
  path: 'D:\\repo',
  kind: 'directory',
  childrenLoaded: true,
  children: [
    {
      id: 'D:\\repo\\src',
      name: 'src',
      path: 'D:\\repo\\src',
      kind: 'directory',
      childrenLoaded: false
    },
    {
      id: 'D:\\repo\\README.md',
      name: 'README.md',
      path: 'D:\\repo\\README.md',
      kind: 'file'
    }
  ]
}

const srcTree: FileEntry = {
  id: 'D:\\repo\\src',
  name: 'src',
  path: 'D:\\repo\\src',
  kind: 'directory',
  childrenLoaded: true,
  children: [
    {
      id: 'D:\\repo\\src\\index.ts',
      name: 'index.ts',
      path: 'D:\\repo\\src\\index.ts',
      kind: 'file'
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

async function expandSrcDirectory(): Promise<void> {
  const folderName = await screen.findByText('src')
  const folderRow = folderName.closest('.file-tree-row')
  if (!folderRow) throw new Error('Expected src row to be rendered')

  await act(async () => {
    fireEvent.click(within(folderRow as HTMLElement).getByRole('button', { name: 'Expand folder' }))
  })
  await screen.findByText('index.ts')
}

describe('FileTreeComponent', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        filesystem: {
          chooseDirectory: vi.fn(),
          createFile: vi.fn(async () => undefined),
          createFolder: vi.fn(async () => undefined),
          listTree: vi.fn(async (_rootPath: string, targetPathOrMaxDepth?: string | number) => {
            const targetPath = typeof targetPathOrMaxDepth === 'string' ? targetPathOrMaxDepth : rootTree.path
            return targetPath === srcTree.path ? srcTree : rootTree
          }),
          onWatchEvent: vi.fn(() => vi.fn()),
          revealInFolder: vi.fn(),
          trash: vi.fn(async () => undefined),
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
    await expandSrcDirectory()

    const fileName = await screen.findByText('index.ts')
    await act(async () => {
      fireEvent.contextMenu(fileName, { button: 2, clientX: 64, clientY: 96 })
    })

    expect(await screen.findByRole('menuitem', { name: '新建文件' })).toBeVisible()
    expect(await screen.findByRole('menuitem', { name: '新建文件夹' })).toBeVisible()
    expect(await screen.findByRole('menuitem', { name: '删除文件' })).toBeVisible()
    expect(await screen.findByRole('menuitem', { name: '复制文件路径' })).toBeVisible()
    expect(fileName.closest('.file-tree-row')).toHaveClass('file-tree-row--selected')
  })

  it('keeps file creation controls out of the file tree toolbar', async () => {
    renderFileTree()

    expect(await screen.findByTitle('Choose folder')).toBeVisible()
    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo', 1)
    expect(screen.getByTitle('Refresh')).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('new file or folder')).not.toBeInTheDocument()
    expect(screen.queryByTitle('New file')).not.toBeInTheDocument()
    expect(screen.queryByTitle('New folder')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Trash selected')).not.toBeInTheDocument()
  })

  it('loads a directory only after it is expanded', async () => {
    renderFileTree()

    expect(await screen.findByText('src')).toBeVisible()
    expect(screen.getByText('README.md')).toBeVisible()
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument()

    await expandSrcDirectory()

    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src', 1)
    expect(await screen.findByText('index.ts')).toBeVisible()
  })

  it('creates a terminal next to the file tree with the selected file directory as cwd', async () => {
    const addComponent = vi.fn()
    useCanvasStore.setState({ addComponent } as Partial<CanvasStoreState>)
    renderFileTree()
    await expandSrcDirectory()

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

  it('creates a file in the selected file parent directory from the context menu', async () => {
    renderFileTree()
    await expandSrcDirectory()

    const fileName = await screen.findByText('index.ts')
    await act(async () => {
      fireEvent.contextMenu(fileName, { button: 2, clientX: 64, clientY: 96 })
    })
    const createFileItem = await screen.findByRole('menuitem', { name: '新建文件' })

    await act(async () => {
      fireEvent.click(createFileItem)
    })

    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: 'new.ts' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '创建' }))
    })

    await waitFor(() => {
      expect(window.atlas.filesystem.createFile).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src', 'new.ts')
    })
  })

  it('creates a folder inside the selected directory from the context menu', async () => {
    renderFileTree()

    const folderName = await screen.findByText('src')
    await act(async () => {
      fireEvent.contextMenu(folderName, { button: 2, clientX: 64, clientY: 96 })
    })
    const createFolderItem = await screen.findByRole('menuitem', { name: '新建文件夹' })

    await act(async () => {
      fireEvent.click(createFolderItem)
    })

    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: 'components' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '创建' }))
    })

    await waitFor(() => {
      expect(window.atlas.filesystem.createFolder).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src', 'components')
    })
  })

  it('moves the selected file to the recycle bin from the context menu after confirmation', async () => {
    renderFileTree()
    await expandSrcDirectory()

    const fileName = await screen.findByText('index.ts')
    await act(async () => {
      fireEvent.contextMenu(fileName, { button: 2, clientX: 64, clientY: 96 })
    })
    const deleteFileItem = await screen.findByRole('menuitem', { name: '删除文件' })

    await act(async () => {
      fireEvent.click(deleteFileItem)
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    })

    await waitFor(() => {
      expect(window.atlas.filesystem.trash).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src\\index.ts')
    })
  })
})
