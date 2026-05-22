import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileSystemService } from './ipc-filesystem'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn()
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
})
