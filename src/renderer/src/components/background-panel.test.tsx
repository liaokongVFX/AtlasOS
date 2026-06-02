import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, DEFAULT_VIEWPORT } from '@shared/constants'
import { localAssetUrl } from '@shared/local-assets'
import type { CanvasDocument } from '@shared/schema'
import { I18nContext, translate } from '../i18n'
import { useCanvasStore } from '../store/canvas-store'
import { BackgroundPanel } from './background-panel'

const initialStore = useCanvasStore.getState()
const timestamp = '2026-05-21T00:00:00.000Z'

function createCanvas(): CanvasDocument {
  return {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    id: 'canvas-1',
    name: 'Canvas',
    viewport: { ...DEFAULT_VIEWPORT },
    background: {
      color: DEFAULT_CANVAS_BACKGROUND.color,
      image: { ...DEFAULT_CANVAS_BACKGROUND.image }
    },
    components: [],
    groups: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function renderBackgroundPanel(): ReturnType<typeof render> {
  return render(
    <I18nContext.Provider value={{ locale: 'en-US', setLocale: vi.fn(), t: (key, values) => translate('en-US', key, values) }}>
      <BackgroundPanel />
    </I18nContext.Provider>
  )
}

describe('BackgroundPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        canvas: {
          save: vi.fn(async (canvas: CanvasDocument) => canvas)
        },
        filesystem: {
          getPathForFile: vi.fn()
        }
      }
    })
    useCanvasStore.setState(
      {
        ...initialStore,
        activeCanvasId: 'canvas-1',
        appState: null,
        canvases: { 'canvas-1': createCanvas() },
        error: null,
        saveState: 'idle'
      },
      true
    )
  })

  afterEach(async () => {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    cleanup()
    vi.useRealTimers()
    useCanvasStore.setState(initialStore, true)
  })

  it('updates the canvas background fill with CSS gradients', async () => {
    const gradient = 'linear-gradient(135deg, #010102, #11141b)'
    renderBackgroundPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Color / gradient'), { target: { value: gradient } })
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].background.color).toBe(gradient)
  })

  it('keeps the background trigger icon-only', () => {
    renderBackgroundPanel()

    const trigger = screen.getByRole('button', { name: 'Background' })
    expect(trigger).toHaveClass('icon-button', 'top-bar-icon-button')
    expect(trigger).not.toHaveAttribute('title')
    expect(trigger.querySelector('svg')).not.toBeNull()
    expect(trigger.textContent).toBe('')
  })

  it('keeps the solid color picker usable when the background fill is a gradient', async () => {
    const canvas = createCanvas()
    canvas.background.color = 'linear-gradient(135deg, #010102, #11141b)'
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    renderBackgroundPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    })
    const colorPicker = screen.getByLabelText('Solid color') as HTMLInputElement
    expect(colorPicker.value).toBe(DEFAULT_CANVAS_BACKGROUND.color)

    await act(async () => {
      fireEvent.change(colorPicker, { target: { value: '#11141b' } })
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].background.color).toBe('#11141b')
  })

  it('builds a gradient from selected colors', async () => {
    renderBackgroundPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Gradient start color'), { target: { value: '#112d92' } })
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Gradient end color'), { target: { value: '#5e6ad2' } })
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].background.color).toBe('linear-gradient(135deg, #112d92, #5e6ad2)')
  })

  it('uses existing gradient colors in the gradient pickers', async () => {
    const canvas = createCanvas()
    canvas.background.color = 'linear-gradient(135deg, #112d92, #5e6ad2)'
    useCanvasStore.setState({ canvases: { 'canvas-1': canvas } })

    renderBackgroundPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    })

    expect(screen.getByLabelText('Gradient start color')).toHaveValue('#112d92')
    expect(screen.getByLabelText('Gradient end color')).toHaveValue('#5e6ad2')
  })

  it('selects a local background image file', async () => {
    const imagePath = 'C:\\Users\\xhwz2\\Pictures\\wallpaper.png'
    const file = new File(['image'], 'wallpaper.png', { type: 'image/png' })
    vi.mocked(window.atlas.filesystem.getPathForFile).mockReturnValue(imagePath)
    const { container } = renderBackgroundPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    })

    expect(screen.getByRole('button', { name: 'Image URL Browse' })).toBeInTheDocument()

    const fileInput = container.querySelector('.background-image-file-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].background.image.src).toBe(localAssetUrl(imagePath, imagePath))
  })

  it('updates background image blur from the slider', async () => {
    renderBackgroundPanel()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Image blur'), { target: { value: '12' } })
    })

    expect(useCanvasStore.getState().canvases['canvas-1'].background.image.blur).toBe(12)
  })
})
