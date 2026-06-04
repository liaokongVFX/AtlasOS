import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { BROWSER_ZOOM_DEFAULT_FACTOR } from '@shared/browser'
import { BrowserComponent } from './browser-component'

const browserApi = vi.hoisted(() => ({
  onWebviewOpenTabRequested: vi.fn(),
  onWebviewZoomUpdated: vi.fn()
}))

type BrowserWebviewOpenTabRequestedListener = (payload: { sourceWebContentsId: number; url: string }) => void
type BrowserWebviewZoomUpdatedListener = (payload: { sourceWebContentsId: number; zoomFactor: number }) => void

let openTabRequestedListener: BrowserWebviewOpenTabRequestedListener | null = null
let zoomUpdatedListener: BrowserWebviewZoomUpdatedListener | null = null
let webviewCapturePage: ReturnType<typeof vi.fn>
let webviewGetWebContentsId: ReturnType<typeof vi.fn>
let webviewLoadURL: ReturnType<typeof vi.fn>
let webviewReload: ReturnType<typeof vi.fn>
let webviewSetZoomFactor: ReturnType<typeof vi.fn>

function createBrowserComponent(): CanvasComponent {
  const timestamp = '2026-05-21T00:00:00.000Z'

  return {
    id: 'browser-1',
    type: 'browser',
    title: 'Browser',
    frame: { x: 0, y: 0, width: 420, height: 320 },
    zIndex: 1,
    config: {},
    state: {
      activeTabId: 'tab-1',
      tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com' }]
    },
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp
  } as CanvasComponent
}

function dispatchWebviewEvent(element: Element, type: string, payload: Record<string, unknown>): void {
  const event = new Event(type)
  for (const [key, value] of Object.entries(payload)) {
    Object.defineProperty(event, key, { value })
  }
  element.dispatchEvent(event)
}

function renderBrowserComponent(
  component: CanvasComponent,
  updateState = vi.fn(),
  options: { isCanvasInteracting?: boolean; isNodeSelected?: boolean } = {}
) {
  return render(
    <BrowserComponent
      canvasId="canvas-1"
      component={component}
      updateConfig={vi.fn()}
      updateState={updateState}
      setTitle={vi.fn()}
      isCanvasInteracting={options.isCanvasInteracting}
      isNodeSelected={options.isNodeSelected}
    />
  )
}

describe('BrowserComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openTabRequestedListener = null
    zoomUpdatedListener = null
    webviewCapturePage = vi.fn().mockResolvedValue({ toDataURL: () => 'data:image/png;base64,abc' })
    webviewGetWebContentsId = vi.fn(() => 42)
    webviewLoadURL = vi.fn()
    webviewReload = vi.fn()
    webviewSetZoomFactor = vi.fn()

    Object.defineProperties(HTMLElement.prototype, {
      capturePage: { configurable: true, value: webviewCapturePage },
      getWebContentsId: { configurable: true, value: webviewGetWebContentsId },
      goBack: { configurable: true, value: vi.fn() },
      goForward: { configurable: true, value: vi.fn() },
      loadURL: { configurable: true, value: webviewLoadURL },
      openDevTools: { configurable: true, value: vi.fn() },
      reload: { configurable: true, value: webviewReload },
      setZoomFactor: { configurable: true, value: webviewSetZoomFactor }
    })

    browserApi.onWebviewOpenTabRequested.mockImplementation((listener: BrowserWebviewOpenTabRequestedListener) => {
      openTabRequestedListener = listener
      return () => undefined
    })
    browserApi.onWebviewZoomUpdated.mockImplementation((listener: BrowserWebviewZoomUpdatedListener) => {
      zoomUpdatedListener = listener
      return () => undefined
    })

    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        browser: browserApi
      }
    })
  })

  afterEach(() => {
    cleanup()
    for (const property of ['capturePage', 'getWebContentsId', 'goBack', 'goForward', 'loadURL', 'openDevTools', 'reload', 'setZoomFactor']) {
      Reflect.deleteProperty(HTMLElement.prototype, property)
    }
    vi.restoreAllMocks()
  })

  it('keeps the active browser webview visible but non-interactive while the node is not selected', () => {
    const component = createBrowserComponent()
    const { container } = renderBrowserComponent(component)
    const webview = container.querySelector('webview')

    expect(webview).toBeInTheDocument()
    expect(webview).toHaveAttribute('src', 'https://example.com')
    expect(webview).toHaveStyle({ display: 'flex', backgroundColor: '#ffffff', pointerEvents: 'none' })
  })

  it('makes the active browser webview interactive when the node is selected', () => {
    const component = createBrowserComponent()
    const { container } = renderBrowserComponent(component, vi.fn(), { isNodeSelected: true })
    const webview = container.querySelector('webview')

    expect(webview).toHaveStyle({ display: 'flex', pointerEvents: 'auto' })
  })

  it('keeps the active browser webview non-interactive during canvas interactions', () => {
    const component = createBrowserComponent()
    const { container } = renderBrowserComponent(component, vi.fn(), { isCanvasInteracting: true, isNodeSelected: true })
    const webview = container.querySelector('webview')

    expect(webview).toHaveStyle({ display: 'flex', pointerEvents: 'none' })
  })

  it('defers saved inactive tabs until they are selected', async () => {
    const component = createBrowserComponent()
    component.state = {
      activeTabId: 'tab-1',
      tabs: [
        { localId: 'tab-1', title: 'Example', url: 'https://example.com' },
        { localId: 'tab-2', title: 'Later', url: 'https://example.com/later' }
      ]
    }
    const updateState = vi.fn()
    const { container, rerender } = renderBrowserComponent(component, updateState)

    expect(container.querySelectorAll('webview')).toHaveLength(1)
    expect(container.querySelector('webview')).toHaveAttribute('src', 'https://example.com')

    rerender(
      <BrowserComponent
        canvasId="canvas-1"
        component={{
          ...component,
          state: { ...component.state, activeTabId: 'tab-2' }
        }}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const webviews = Array.from(container.querySelectorAll('webview'))
    expect(webviews).toHaveLength(2)
    expect(webviews.map((webview) => webview.getAttribute('src'))).toEqual(['https://example.com', 'https://example.com/later'])
  })

  it('updates tab metadata from webview navigation events', () => {
    const component = createBrowserComponent()
    const updateState = vi.fn()
    const { container } = renderBrowserComponent(component, updateState, { isNodeSelected: true })
    const webview = container.querySelector('webview')!

    act(() => {
      dispatchWebviewEvent(webview, 'page-title-updated', { title: 'Example Domain' })
    })
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example Domain', url: 'https://example.com' }]
      },
      false
    )

    act(() => {
      dispatchWebviewEvent(webview, 'did-navigate', { url: 'https://example.com/docs' })
    })
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com/docs' }]
      },
      false
    )
  })

  it('adds an active browser tab for matching webview new-window requests', () => {
    const component = createBrowserComponent()
    const updateState = vi.fn()
    renderBrowserComponent(component, updateState, { isNodeSelected: true })

    act(() => {
      openTabRequestedListener?.({
        sourceWebContentsId: 42,
        url: 'https://example.com/new-window'
      })
    })

    const tabPatch = updateState.mock.calls.find(([, immediate]) => immediate === true)?.[0] as {
      activeTabId: string
      tabs: Array<{ localId: string; title: string; url: string }>
    }
    const requestedTab = tabPatch.tabs.find((tab) => tab.url === 'https://example.com/new-window')

    expect(requestedTab).toEqual(expect.objectContaining({ title: '新标签页', url: 'https://example.com/new-window' }))
    expect(tabPatch.activeTabId).toBe(requestedTab?.localId)
  })

  it('navigates by updating webview src state instead of calling loadURL from the renderer', () => {
    const component = createBrowserComponent()
    const updateState = vi.fn()
    const { container } = renderBrowserComponent(component, updateState, { isNodeSelected: true })

    fireEvent.change(container.querySelector<HTMLInputElement>('input[aria-label="地址"]')!, { target: { value: 'baidu.com' } })
    fireEvent.submit(container.querySelector('form')!)

    expect(webviewLoadURL).not.toHaveBeenCalled()
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://baidu.com' }],
        activeTabId: 'tab-1'
      },
      true
    )
  })

  it('reloads the webview for same-url submissions instead of calling loadURL', () => {
    const component = createBrowserComponent()
    const { container } = renderBrowserComponent(component, vi.fn(), { isNodeSelected: true })

    fireEvent.submit(container.querySelector('form')!)

    expect(webviewReload).toHaveBeenCalled()
    expect(webviewLoadURL).not.toHaveBeenCalled()
  })

  it('zooms browser content from the toolbar slider and persists the tab zoom factor', () => {
    const component = createBrowserComponent()
    const updateState = vi.fn()
    const { container } = renderBrowserComponent(component, updateState, { isNodeSelected: true })

    fireEvent.change(container.querySelector<HTMLInputElement>('.browser-zoom-slider')!, { target: { value: '1.4' } })

    expect(webviewSetZoomFactor).toHaveBeenLastCalledWith(1.4)
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com', zoomFactor: 1.4 }]
      },
      false
    )
  })

  it('persists Ctrl+wheel zoom updates reported by the webview preload', () => {
    const component = createBrowserComponent()
    const updateState = vi.fn()
    renderBrowserComponent(component, updateState, { isNodeSelected: true })

    act(() => {
      zoomUpdatedListener?.({
        sourceWebContentsId: 42,
        zoomFactor: 1.2
      })
    })

    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com', zoomFactor: 1.2 }]
      },
      false
    )
  })

  it('resets browser zoom to 100% from the toolbar button', () => {
    const component = createBrowserComponent()
    component.state = {
      activeTabId: 'tab-1',
      tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com', zoomFactor: 1.4 }]
    }
    const updateState = vi.fn()
    const { container } = renderBrowserComponent(component, updateState, { isNodeSelected: true })

    fireEvent.click(container.querySelector<HTMLButtonElement>('.browser-zoom-reset')!)

    expect(webviewSetZoomFactor).toHaveBeenLastCalledWith(BROWSER_ZOOM_DEFAULT_FACTOR)
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com', zoomFactor: BROWSER_ZOOM_DEFAULT_FACTOR }]
      },
      false
    )
  })
})
