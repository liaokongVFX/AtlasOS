import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileSystemService } from './ipc-filesystem'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn()
}))

const chokidarMocks = vi.hoisted(() => {
  const watcher = {
    close: vi.fn(async () => undefined),
    on: vi.fn()
  }

  return {
    watch: vi.fn(() => watcher),
    watcher
  }
})

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn()
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  },
  shell: {
    showItemInFolder: vi.fn(),
    trashItem: vi.fn()
  }
}))

vi.mock('chokidar', () => ({
  default: {
    watch: chokidarMocks.watch
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'ipc-filesystem-test')

describe('FileSystemService', () => {
  beforeEach(async () => {
    electronMocks.ipcHandle.mockClear()
    chokidarMocks.watch.mockClear()
    chokidarMocks.watcher.close.mockClear()
    chokidarMocks.watcher.on.mockClear()
    await rm(testRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('lists dependency and build folders instead of filtering them from the file tree', async () => {
    for (const directory of ['.git', 'node_modules', 'out', 'dist', 'release', '.vite']) {
      await mkdir(join(testRoot, directory))
    }

    const service = new FileSystemService()
    service.registerIpc()

    const listTreeHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'filesystem:list-tree')?.[1]
    const tree = await listTreeHandler({}, { rootPath: testRoot, targetPath: testRoot, maxDepth: 1 })

    expect(tree.children.map((entry: { name: string }) => entry.name)).toEqual(
      expect.arrayContaining(['.git', 'node_modules', 'out', 'dist', 'release', '.vite'])
    )
  })

  it('watches the requested directory shallowly instead of crawling the root tree', async () => {
    const targetPath = join(testRoot, 'src')
    await mkdir(targetPath)

    const service = new FileSystemService()
    service.registerIpc()

    const watchHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'filesystem:watch')?.[1]
    const webContents = {
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      send: vi.fn()
    }
    const result = await watchHandler({ sender: webContents }, { rootPath: testRoot, targetPath })

    expect(result).toEqual({ watchId: expect.any(String) })
    expect(chokidarMocks.watch).toHaveBeenCalledWith(targetPath, {
      ignoreInitial: true,
      depth: 0
    })
  })
})
