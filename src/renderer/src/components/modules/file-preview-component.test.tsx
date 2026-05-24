import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { localAssetUrl } from '@shared/local-assets'
import { FilePreviewComponent } from './file-preview-component'

function createFilePreviewComponent(patch: Partial<CanvasComponent> = {}): CanvasComponent {
  const timestamp = '2026-05-22T00:00:00.000Z'

  return {
    id: 'file-preview-1',
    type: 'file-preview',
    title: 'Preview',
    frame: { x: 0, y: 0, width: 320, height: 240 },
    zIndex: 1,
    config: {},
    state: {},
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    ...patch
  }
}

describe('FilePreviewComponent media previews', () => {
  it('renders images through the controlled local asset protocol', () => {
    const rootPath = 'C:\\Users\\xhwz2\\Downloads'
    const path = 'C:\\Users\\xhwz2\\Downloads\\mind-map.png'
    const updateState = vi.fn()

    render(
      <FilePreviewComponent
        canvasId="canvas-1"
        component={createFilePreviewComponent({
          config: { mimeType: 'image/png' },
          bindings: { rootPath, path }
        })}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
      />
    )

    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('src', localAssetUrl(rootPath, path))
    expect(image.getAttribute('src')).not.toContain('file:///')

    fireEvent.load(image)
    expect(updateState).toHaveBeenCalledWith({ status: 'live' }, false)
  })

  it('reports media load failures on the component state', () => {
    const path = 'C:\\Users\\xhwz2\\Downloads\\missing.png'
    const updateState = vi.fn()

    render(
      <FilePreviewComponent
        canvasId="canvas-1"
        component={createFilePreviewComponent({
          config: { mimeType: 'image/png' },
          bindings: { rootPath: path, path }
        })}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
      />
    )

    fireEvent.error(screen.getByRole('img'))

    expect(screen.getByText('图片预览加载失败。')).toBeInTheDocument()
    expect(updateState).toHaveBeenCalledWith({ status: 'missing' }, true)
  })

  it('stores intrinsic image dimensions and fits legacy media nodes on first load', () => {
    const path = 'C:\\Users\\xhwz2\\Downloads\\wide.png'
    const updateConfig = vi.fn()
    const updateFrame = vi.fn()

    render(
      <FilePreviewComponent
        canvasId="canvas-1"
        component={createFilePreviewComponent({
          frame: { x: 10, y: 20, width: 640, height: 420 },
          config: { mimeType: 'image/png' },
          bindings: { rootPath: path, path }
        })}
        updateConfig={updateConfig}
        updateFrame={updateFrame}
        updateState={vi.fn()}
        setTitle={vi.fn()}
      />
    )

    const image = screen.getByRole('img')
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1600 })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 900 })

    fireEvent.load(image)

    expect(updateConfig).toHaveBeenCalledWith(
      {
        mediaAspectRatio: 16 / 9,
        mediaWidth: 1600,
        mediaHeight: 900
      },
      false
    )
    expect(updateFrame).toHaveBeenCalledWith({ x: 10, y: 20, width: 640, height: 398 }, false)
  })
})
