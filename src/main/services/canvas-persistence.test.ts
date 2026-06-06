import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasPersistence } from './canvas-persistence'

const electronMocks = vi.hoisted(() => ({
  userDataPath: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMocks.userDataPath)
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'canvas-persistence-test')
const userDataPath = join(testRoot, 'user-data')

describe('CanvasPersistence', () => {
  beforeEach(async () => {
    electronMocks.userDataPath = userDataPath

    await rm(testRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
  })

  it('serializes concurrent canvas writes without leaving temporary files', async () => {
    const persistence = new CanvasPersistence()
    await persistence.initialize()
    const [canvas] = await persistence.listCanvases()

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        persistence.saveCanvas({
          ...canvas,
          name: `Canvas ${index}`
        })
      )
    )

    const savedCanvas = await persistence.readCanvas(canvas.id)
    const files = await readdir(join(userDataPath, 'workspace-documents', 'canvases'))

    expect(savedCanvas.name).toBe('Canvas 19')
    expect(files.filter((file) => file.endsWith('.tmp'))).toEqual([])
  })
})
