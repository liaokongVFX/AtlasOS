import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileSystemService } from './ipc-filesystem'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn()
}))

const fsWatchMocks = vi.hoisted(() => {
  let listener: ((eventName: string, fileName: string | Buffer | null) => void) | null = null
  const watcher = {
    close: vi.fn()
  }

  return {
    emit: (eventName: string, fileName: string | Buffer | null) => listener?.(eventName, fileName),
    reset: () => {
      listener = null
    },
    watch: vi.fn((_path: string, _options: unknown, callback: (eventName: string, fileName: string | Buffer | null) => void) => {
      listener = callback
      return watcher
    }),
    watcher
  }
})

vi.mock('node:fs', () => ({
  default: {
    watch: fsWatchMocks.watch
  },
  watch: fsWatchMocks.watch
}))

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

const testRoot = join(process.cwd(), '.atlasos-dev', 'ipc-filesystem-test')

describe('FileSystemService', () => {
  beforeEach(async () => {
    electronMocks.ipcHandle.mockClear()
    fsWatchMocks.reset()
    fsWatchMocks.watch.mockClear()
    fsWatchMocks.watcher.close.mockClear()
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

  it('watches the requested directory without crawling the root tree', async () => {
    const targetPath = join(testRoot, 'src')
    await mkdir(targetPath)

    const service = new FileSystemService()
    service.registerIpc()

    const watchHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'filesystem:watch')?.[1]
    const webContents = {
      id: 7,
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn()
    }
    const result = await watchHandler({ sender: webContents }, { rootPath: testRoot, targetPath })

    expect(result).toEqual({ watchId: expect.any(String) })
    expect(fsWatchMocks.watch).toHaveBeenCalledWith(targetPath, { persistent: true }, expect.any(Function))

    fsWatchMocks.emit('rename', 'new-file.txt')
    expect(webContents.send).toHaveBeenCalledWith('filesystem:watch-event', {
      watchId: result.watchId,
      eventName: 'rename',
      path: join(targetPath, 'new-file.txt')
    })

    fsWatchMocks.emit('change', null)
    expect(webContents.send).toHaveBeenCalledWith('filesystem:watch-event', {
      watchId: result.watchId,
      eventName: 'change',
      path: targetPath
    })
  })

  it('uses one owner destroyed listener for multiple filesystem watches in the same WebContents', async () => {
    const targetPath = join(testRoot, 'src')
    await mkdir(targetPath)

    const service = new FileSystemService()
    service.registerIpc()

    const watchHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'filesystem:watch')?.[1]
    const unwatchHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'filesystem:unwatch')?.[1]
    const webContents = {
      id: 7,
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn()
    }
    const watchIds: string[] = []

    for (let index = 0; index < 11; index += 1) {
      const result = await watchHandler({ sender: webContents }, { rootPath: testRoot, targetPath })
      watchIds.push(result.watchId)
    }

    expect(webContents.once).toHaveBeenCalledTimes(1)

    const destroyedListener = webContents.once.mock.calls[0][1]
    for (const watchId of watchIds) {
      await unwatchHandler({}, { watchId })
    }

    expect(webContents.removeListener).toHaveBeenCalledWith('destroyed', destroyedListener)
  })
})
