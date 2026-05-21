import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localAssetUrl } from '@shared/local-assets'
import { createLocalAssetResponse } from './local-asset-protocol'

vi.mock('electron', () => ({
  protocol: {
    handle: vi.fn(),
    isProtocolHandled: vi.fn(() => false),
    registerSchemesAsPrivileged: vi.fn()
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'local-asset-protocol-test')

describe('createLocalAssetResponse', () => {
  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('streams an authorized image file through the local asset protocol', async () => {
    const targetPath = join(testRoot, 'photo.png')
    await writeFile(targetPath, Buffer.from([1, 2, 3]))

    const response = await createLocalAssetResponse(new Request(localAssetUrl(testRoot, targetPath)))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe('3')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('honors byte range requests for video previews', async () => {
    const targetPath = join(testRoot, 'clip.mp4')
    await writeFile(targetPath, 'abcdef')

    const response = await createLocalAssetResponse(
      new Request(localAssetUrl(testRoot, targetPath), {
        headers: { Range: 'bytes=2-4' }
      })
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-4/6')
    expect(response.headers.get('content-length')).toBe('3')
    expect(await response.text()).toBe('cde')
  })

  it('rejects paths outside the declared root', async () => {
    const outsidePath = join(process.cwd(), 'package.json')
    const response = await createLocalAssetResponse(new Request(localAssetUrl(testRoot, outsidePath)))

    expect(response.status).toBe(403)
  })
})
