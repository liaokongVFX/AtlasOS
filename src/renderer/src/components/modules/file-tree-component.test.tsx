import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
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
      id: 'D:\\repo\\src\\components',
      name: 'components',
      path: 'D:\\repo\\src\\components',
      kind: 'directory',
      childrenLoaded: false
    },
    {
      id: 'D:\\repo\\src\\index.ts',
      name: 'index.ts',
      path: 'D:\\repo\\src\\index.ts',
      kind: 'file'
    }
  ]
}

const componentsTree: FileEntry = {
  id: 'D:\\repo\\src\\components',
  name: 'components',
  path: 'D:\\repo\\src\\components',
  kind: 'directory',
  childrenLoaded: true,
  children: [
    {
      id: 'D:\\repo\\src\\components\\Button.tsx',
      name: 'Button.tsx',
      path: 'D:\\repo\\src\\components\\Button.tsx',
      kind: 'file'
    }
  ]
}

function parentDirectoryPath(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, '')
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

function renderFileTree(
  component = createComponent(),
  overrides: {
    updateConfig?: (patch: Record<string, unknown>, immediate?: boolean) => void
    updateState?: (patch: Record<string, unknown>, immediate?: boolean) => void
    setTitle?: (title: string) => void
  } = {}
) {
  const props = {
    updateConfig: overrides.updateConfig ?? vi.fn(),
    updateState: overrides.updateState ?? vi.fn(),
    setTitle: overrides.setTitle ?? vi.fn()
  }

  function FileTreeTestHost(): JSX.Element {
    const [headerActions, setHeaderActions] = useState<ReactNode | null>(null)

    return (
      <>
        <div data-testid="file-tree-header-actions">{headerActions}</div>
        <FileTreeComponent
          canvasId="canvas-1"
          component={component}
          updateConfig={props.updateConfig}
          updateState={props.updateState}
          setTitle={props.setTitle}
          setHeaderActions={setHeaderActions}
        />
      </>
    )
  }

  render(<FileTreeTestHost />)

  return props
}

function mockResizeObserverSize(width: number, height: number): () => void {
  const originalResizeObserver = globalThis.ResizeObserver

  class SizedResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element): void {
      this.callback([{ target, contentRect: { width, height } as DOMRectReadOnly } as ResizeObserverEntry], this)
    }

    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = SizedResizeObserver

  return () => {
    globalThis.ResizeObserver = originalResizeObserver
  }
}

async function expandSrcDirectory(): Promise<void> {
  const folderName = await screen.findByText('src')
  const folderRow = folderName.closest('.file-tree-row')
  if (!folderRow) throw new Error('Expected src row to be rendered')

  await act(async () => {
    fireEvent.click(within(folderRow as HTMLElement).getByRole('button', { name: '展开文件夹' }))
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
            if (targetPath === componentsTree.path) return componentsTree
            return targetPath === srcTree.path ? srcTree : rootTree
          }),
          onWatchEvent: vi.fn(() => vi.fn()),
          readFile: vi.fn(async () => '# Project'),
          revealInFolder: vi.fn(),
          rename: vi.fn(async (_rootPath: string, targetPath: string, name: string) => ({
            id: `${parentDirectoryPath(targetPath)}\\${name}`,
            name,
            path: `${parentDirectoryPath(targetPath)}\\${name}`,
            kind: targetPath.endsWith('\\src') ? 'directory' : 'file'
          })),
          trash: vi.fn(async () => undefined),
          unwatch: vi.fn(),
          watch: vi.fn(async (rootPath: string, targetPath = rootPath) => ({ watchId: `watch:${targetPath}` }))
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
    expect(await screen.findByRole('menuitem', { name: '重命名' })).toBeVisible()
    expect(await screen.findByRole('menuitem', { name: '删除文件' })).toBeVisible()
    expect(await screen.findByRole('menuitem', { name: '打开到桌面' })).toBeVisible()
    expect(await screen.findByRole('menuitem', { name: '复制文件路径' })).toBeVisible()
    expect(fileName.closest('.file-tree-row')).toHaveClass('file-tree-row--selected')
  })

  it('renders root actions in the node header slot without file creation controls', async () => {
    renderFileTree()

    const headerActions = screen.getByTestId('file-tree-header-actions')

    expect(await within(headerActions).findByTitle('选择文件夹')).toBeVisible()
    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo', 1)
    expect(within(headerActions).getByTitle('重新加载')).toBeVisible()
    expect(document.querySelector('.file-tree-toolbar')).not.toBeInTheDocument()
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

  it('persists directory open paths when a folder is expanded', async () => {
    const updateState = vi.fn()
    renderFileTree(createComponent(), { updateState })

    await expandSrcDirectory()

    expect(updateState).toHaveBeenCalledWith({ openPaths: ['D:\\repo', 'D:\\repo\\src'] }, true)
  })

  it('watches only the open directories in the lazy file tree', async () => {
    const component = createComponent()
    component.state = { openPaths: ['D:\\repo', 'D:\\repo\\src'] }

    renderFileTree(component)

    expect(await screen.findByText('index.ts')).toBeVisible()
    await waitFor(() => {
      expect(window.atlas.filesystem.watch).toHaveBeenCalledWith('D:\\repo', 'D:\\repo')
      expect(window.atlas.filesystem.watch).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src')
    })
  })

  it('sizes the virtual tree from the available viewport', async () => {
    const restoreResizeObserver = mockResizeObserverSize(196, 128)

    try {
      renderFileTree()

      expect(await screen.findByText('src')).toBeVisible()
      const viewport = document.querySelector('.file-tree-viewport')
      expect(viewport?.firstElementChild).toHaveStyle({ width: '196px', height: '128px' })
    } finally {
      restoreResizeObserver()
    }
  })

  it('restores persisted open paths and lazy-loads those directories on mount', async () => {
    const component = createComponent()
    component.state = { openPaths: ['D:\\repo', 'D:\\repo\\src'] }

    renderFileTree(component)

    expect(await screen.findByText('index.ts')).toBeVisible()
    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo', 1)
    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src', 1)

    const folderName = await screen.findByText('src')
    const folderRow = folderName.closest('.file-tree-row')
    if (!folderRow) throw new Error('Expected src row to be rendered')
    expect(within(folderRow as HTMLElement).getByRole('button', { name: '收起文件夹' })).toBeVisible()
  })

  it('restores nested open paths without loading unrelated closed branches', async () => {
    const component = createComponent()
    component.state = { openPaths: ['D:\\repo\\src\\components', 'D:\\repo', 'D:\\repo\\src'] }

    renderFileTree(component)

    expect(await screen.findByText('Button.tsx')).toBeVisible()

    expect(vi.mocked(window.atlas.filesystem.listTree).mock.calls).toEqual([
      ['D:\\repo', 'D:\\repo', 1],
      ['D:\\repo', 'D:\\repo\\src', 1],
      ['D:\\repo', 'D:\\repo\\src\\components', 1]
    ])
  })

  it('keeps loaded descendant directories visible after a parent refresh', async () => {
    const component = createComponent()
    component.state = { openPaths: ['D:\\repo', 'D:\\repo\\src', 'D:\\repo\\src\\components'] }

    renderFileTree(component)
    expect(await screen.findByText('Button.tsx')).toBeVisible()

    const srcName = await screen.findByText('src')
    await act(async () => {
      fireEvent.contextMenu(srcName, { button: 2, clientX: 64, clientY: 96 })
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: '新建文件夹' }))
    })
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: 'new-folder' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '创建' }))
    })

    expect(await screen.findByText('Button.tsx')).toBeVisible()
    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src\\components', 1)
  })

  it('keeps loaded descendant directories visible after a watched parent changes', async () => {
    const component = createComponent()
    component.state = { openPaths: ['D:\\repo', 'D:\\repo\\src', 'D:\\repo\\src\\components'] }
    let watchListener: ((event: { watchId: string; eventName: string; path: string }) => void) | null = null
    vi.mocked(window.atlas.filesystem.onWatchEvent).mockImplementation((listener) => {
      watchListener = listener
      return vi.fn()
    })

    renderFileTree(component)
    expect(await screen.findByText('Button.tsx')).toBeVisible()

    await waitFor(() => {
      expect(window.atlas.filesystem.watch).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src')
    })
    act(() => {
      watchListener?.({ watchId: 'watch:D:\\repo\\src', eventName: 'add', path: 'D:\\repo\\src\\new-folder' })
    })

    expect(await screen.findByText('Button.tsx')).toBeVisible()
    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src\\components', 1)
  })

  it('restores missing ancestor directories from persisted descendant paths', async () => {
    const component = createComponent()
    component.state = { openPaths: ['D:\\repo', 'D:\\repo\\src\\components'] }

    renderFileTree(component)

    expect(await screen.findByText('Button.tsx')).toBeVisible()

    const folderName = await screen.findByText('src')
    const folderRow = folderName.closest('.file-tree-row')
    if (!folderRow) throw new Error('Expected src row to be rendered')
    expect(within(folderRow as HTMLElement).getByRole('button', { name: '收起文件夹' })).toBeVisible()
    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src', 1)
    expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src\\components', 1)
  })

  it('persists a collapsed restored directory', async () => {
    const updateState = vi.fn()
    const component = createComponent()
    component.state = { openPaths: ['D:\\repo', 'D:\\repo\\src', 'D:\\repo\\src\\components'] }
    renderFileTree(component, { updateState })

    const folderName = await screen.findByText('src')
    const folderRow = folderName.closest('.file-tree-row')
    if (!folderRow) throw new Error('Expected src row to be rendered')

    await act(async () => {
      fireEvent.click(within(folderRow as HTMLElement).getByRole('button', { name: '收起文件夹' }))
    })

    expect(updateState).toHaveBeenCalledWith({ openPaths: ['D:\\repo'] }, true)
    expect(screen.queryByText('Button.tsx')).not.toBeInTheDocument()
  })

  it('resets persisted open paths when binding a new root folder', async () => {
    const updateConfig = vi.fn()
    const updateState = vi.fn()
    vi.mocked(window.atlas.filesystem.chooseDirectory).mockResolvedValue('D:\\workspace')
    renderFileTree(createComponent(), { updateConfig, updateState })
    await screen.findByText('src')

    await act(async () => {
      fireEvent.click(await screen.findByTitle('选择文件夹'))
    })

    expect(updateConfig).toHaveBeenCalledWith({ rootPath: 'D:\\workspace' }, true)
    expect(updateState).toHaveBeenCalledWith({ openPaths: ['D:\\workspace'] }, true)
  })

  it('opens a markdown file as a desktop node when double-clicked', async () => {
    const addComponent = vi.fn()
    useCanvasStore.setState({ addComponent } as Partial<CanvasStoreState>)
    renderFileTree()

    const fileName = await screen.findByText('README.md')
    await act(async () => {
      fireEvent.doubleClick(fileName)
    })

    await waitFor(() => {
      expect(window.atlas.filesystem.readFile).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\README.md')
      expect(addComponent).toHaveBeenCalledWith(
        'markdown-note',
        { x: 504, y: 80 },
        expect.objectContaining({
          title: 'README.md',
          bindings: { rootPath: 'D:\\repo', path: 'D:\\repo\\README.md' },
          state: { content: '# Project', status: 'live' }
        })
      )
    })
  })

  it('opens a file preview desktop node from the context menu', async () => {
    const addComponent = vi.fn()
    useCanvasStore.setState({ addComponent } as Partial<CanvasStoreState>)
    renderFileTree()
    await expandSrcDirectory()

    const fileName = await screen.findByText('index.ts')
    await act(async () => {
      fireEvent.contextMenu(fileName, { button: 2, clientX: 64, clientY: 96 })
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: '打开到桌面' }))
    })

    await waitFor(() => {
      expect(addComponent).toHaveBeenCalledWith(
        'file-preview',
        { x: 504, y: 80 },
        expect.objectContaining({
          title: 'index.ts',
          bindings: { rootPath: 'D:\\repo', path: 'D:\\repo\\src\\index.ts' }
        })
      )
    })
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

  it('renames a file from the context menu and 重新加载es its parent directory', async () => {
    renderFileTree()
    await expandSrcDirectory()

    const fileName = await screen.findByText('index.ts')
    await act(async () => {
      fireEvent.contextMenu(fileName, { button: 2, clientX: 64, clientY: 96 })
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }))
    })

    const nameInput = await screen.findByLabelText('名称')
    expect(nameInput).toHaveValue('index.ts')

    fireEvent.change(nameInput, { target: { value: 'main.ts' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    })

    await waitFor(() => {
      expect(window.atlas.filesystem.rename).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src\\index.ts', 'main.ts')
      expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src', 1)
    })
  })

  it('rebases persisted open paths when renaming an expanded directory', async () => {
    const updateState = vi.fn()
    const component = createComponent()
    component.state = { openPaths: ['D:\\repo', 'D:\\repo\\src', 'D:\\repo\\src\\components'] }
    renderFileTree(component, { updateState })

    const folderName = await screen.findByText('src')
    await act(async () => {
      fireEvent.contextMenu(folderName, { button: 2, clientX: 64, clientY: 96 })
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }))
    })

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: 'app' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    })

    await waitFor(() => {
      expect(window.atlas.filesystem.rename).toHaveBeenCalledWith('D:\\repo', 'D:\\repo\\src', 'app')
      expect(updateState).toHaveBeenCalledWith(
        { openPaths: ['D:\\repo', 'D:\\repo\\app', 'D:\\repo\\app\\components'] },
        true
      )
      expect(window.atlas.filesystem.listTree).toHaveBeenCalledWith('D:\\repo', 'D:\\repo', 1)
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
