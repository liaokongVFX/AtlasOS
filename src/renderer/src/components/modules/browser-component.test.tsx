import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { BROWSER_ZOOM_DEFAULT_FACTOR } from '@shared/browser'
import { notifyCanvasViewportSync } from '../../lib/canvas-viewport-sync'
import { BrowserComponent } from './browser-component'

const browserApi = vi.hoisted(() => ({
  back: vi.fn(),
  capture: vi.fn(),
  closeTab: vi.fn(),
  createTab: vi.fn(),
  devtools: vi.fn(),
  forward: vi.fn(),
  navigate: vi.fn(),
  onContentInteractionRequested: vi.fn(),
  onOpenTabRequested: vi.fn(),
  onTabUpdated: vi.fn(),
  onTabZoomRequested: vi.fn(),
  reload: vi.fn(),
  setBounds: vi.fn(),
  setZoom: vi.fn()
}))

type BrowserNativeOpenTabRequestedListener = (payload: { componentId: string; sourceTabId: string; url: string }) => void
type BrowserNativeTabUpdatedListener = (payload: { tabId: string; patch: Record<string, unknown> }) => void
type BrowserNativeTabZoomRequestedListener = (payload: { tabId: string; direction: -1 | 1 }) => void
type BrowserContentInteractionRequestedListener = (payload: { componentId: string }) => void

let contentInteractionRequestedListener: BrowserContentInteractionRequestedListener | null = null
let nativeOpenTabRequestedListener: BrowserNativeOpenTabRequestedListener | null = null
let nativeTabUpdatedListener: BrowserNativeTabUpdatedListener | null = null
let nativeTabZoomRequestedListener: BrowserNativeTabZoomRequestedListener | null = null

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

function createRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height })
  } as DOMRect
}

function mockBrowserViewportGeometry(rect: DOMRect) {
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('browser-viewport')) return rect
    return createRect(0, 0, 0, 0)
  })

  return {
    mockRestore: () => {
      rectSpy.mockRestore()
    }
  }
}

function renderBrowserComponent(
  component: CanvasComponent,
  updateState = vi.fn(),
  options: {
    canvasZoom?: number
    isCanvasInteracting?: boolean
    isNodeSelected?: boolean
    isViewportInteracting?: boolean
    onRequestSelect?: (componentId: string) => void
  } = {}
) {
  return render(
    <BrowserComponent
      canvasId="canvas-1"
      canvasZoom={options.canvasZoom}
      component={component}
      updateConfig={vi.fn()}
      updateState={updateState}
      setTitle={vi.fn()}
      isCanvasInteracting={options.isCanvasInteracting}
      isNodeSelected={options.isNodeSelected}
      isViewportInteracting={options.isViewportInteracting}
      onRequestSelect={options.onRequestSelect}
    />
  )
}

describe('BrowserComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contentInteractionRequestedListener = null
    nativeOpenTabRequestedListener = null
    nativeTabUpdatedListener = null
    nativeTabZoomRequestedListener = null

    browserApi.back.mockResolvedValue({ ok: true })
    browserApi.capture.mockResolvedValue('data:image/png;base64,native')
    browserApi.closeTab.mockResolvedValue({ ok: true })
    browserApi.createTab.mockImplementation(async (input: { partition: string; url: string }) => ({
      tabId: `native-tab-${browserApi.createTab.mock.calls.length}`,
      partition: input.partition,
      url: input.url
    }))
    browserApi.devtools.mockResolvedValue({ ok: true })
    browserApi.forward.mockResolvedValue({ ok: true })
    browserApi.navigate.mockResolvedValue({ ok: true })
    browserApi.reload.mockResolvedValue({ ok: true })
    browserApi.setBounds.mockResolvedValue({ ok: true })
    browserApi.setZoom.mockResolvedValue({ ok: true })

    browserApi.onTabUpdated.mockImplementation((listener: BrowserNativeTabUpdatedListener) => {
      nativeTabUpdatedListener = listener
      return () => undefined
    })
    browserApi.onOpenTabRequested.mockImplementation((listener: BrowserNativeOpenTabRequestedListener) => {
      nativeOpenTabRequestedListener = listener
      return () => undefined
    })
    browserApi.onContentInteractionRequested.mockImplementation((listener: BrowserContentInteractionRequestedListener) => {
      contentInteractionRequestedListener = listener
      return () => undefined
    })
    browserApi.onTabZoomRequested.mockImplementation((listener: BrowserNativeTabZoomRequestedListener) => {
      nativeTabZoomRequestedListener = listener
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
    vi.restoreAllMocks()
  })

  it('shows native browser content non-interactively while the node is not selected', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 315, 195))
    const component = createBrowserComponent()
    const { container } = renderBrowserComponent(component)

    await waitFor(() => {
      expect(browserApi.createTab).toHaveBeenCalledWith({
        componentId: 'browser-1',
        partition: 'persist:atlas-browser-browser-1-tab-1',
        url: 'https://example.com'
      })
    })
    await waitFor(() => {
      expect(browserApi.setBounds).toHaveBeenCalledWith({
        tabId: 'native-tab-1',
        visible: true,
        interactive: false,
        bounds: { x: 20, y: 48, width: 315, height: 195 },
        contentBounds: { x: 20, y: 48, width: 315, height: 195 }
      })
    })
    expect(container.querySelector('webview')).not.toBeInTheDocument()
    expect(container.querySelector('.browser-preview')).not.toBeInTheDocument()
    expect(browserApi.capture).not.toHaveBeenCalled()
    expect(browserApi.setZoom).toHaveBeenCalledWith('native-tab-1', 1, { emitUpdate: false })

    rectSpy.mockRestore()
  })

  it('shows selected browser content through a native view using clipped screen bounds', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(-20, 48, 420, 260))
    const component = createBrowserComponent()
    const { container } = renderBrowserComponent(component, vi.fn(), { isNodeSelected: true })

    await waitFor(() => {
      expect(browserApi.createTab).toHaveBeenCalledWith({
        componentId: 'browser-1',
        partition: 'persist:atlas-browser-browser-1-tab-1',
        url: 'https://example.com'
      })
    })
    await waitFor(() => {
      expect(browserApi.setZoom).toHaveBeenCalledWith('native-tab-1', 1, { emitUpdate: false })
    })
    await waitFor(() => {
      expect(browserApi.setBounds).toHaveBeenCalledWith({
        tabId: 'native-tab-1',
        visible: true,
        interactive: true,
        bounds: { x: 0, y: 48, width: 400, height: 260 },
        contentBounds: { x: -20, y: 48, width: 420, height: 260 }
      })
    })
    await waitFor(() => expect(container.querySelector('.browser-viewport')).toHaveClass('browser-viewport--native-active'))
    expect(browserApi.capture).not.toHaveBeenCalled()

    rectSpy.mockRestore()
  })

  it('applies the saved canvas zoom when the native browser view first appears', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 210, 130))
    const component = createBrowserComponent()
    renderBrowserComponent(component, vi.fn(), { canvasZoom: 0.5, isNodeSelected: true })

    await waitFor(() => {
      expect(browserApi.setZoom).toHaveBeenCalledWith('native-tab-1', 0.5, { emitUpdate: false })
    })
    await waitFor(() => {
      expect(browserApi.setBounds).toHaveBeenCalledWith({
        tabId: 'native-tab-1',
        visible: true,
        interactive: true,
        bounds: { x: 20, y: 48, width: 210, height: 130 },
        contentBounds: { x: 20, y: 48, width: 210, height: 130 }
      })
    })

    rectSpy.mockRestore()
  })

  it('keeps the native browser view visible when the selected browser node becomes inactive', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const updateState = vi.fn()
    const rendered = renderBrowserComponent(component, updateState, { isNodeSelected: true })

    await waitFor(() => expect(browserApi.setBounds).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'native-tab-1', visible: true })))
    browserApi.capture.mockClear()

    rendered.rerender(
      <BrowserComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
        isNodeSelected={false}
      />
    )

    await waitFor(() => {
      expect(browserApi.setBounds).toHaveBeenCalledWith({
        tabId: 'native-tab-1',
        visible: true,
        interactive: false,
        bounds: { x: 20, y: 48, width: 420, height: 260 },
        contentBounds: { x: 20, y: 48, width: 420, height: 260 }
      })
    })
    expect(browserApi.capture).not.toHaveBeenCalled()
    expect(rendered.container.querySelector('.browser-preview')).not.toBeInTheDocument()
    expect(rendered.container.querySelector('.browser-viewport')).toHaveClass('browser-viewport--native-active')

    rectSpy.mockRestore()
  })

  it('keeps the native browser view visible during viewport zoom and composes native content zoom', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const { rerender } = renderBrowserComponent(component, vi.fn(), { isNodeSelected: true })

    await waitFor(() => expect(browserApi.setBounds).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'native-tab-1', visible: true })))
    browserApi.setZoom.mockClear()
    browserApi.setBounds.mockClear()

    rerender(
      <BrowserComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
        isCanvasInteracting
        isNodeSelected
        isViewportInteracting
      />
    )

    act(() => {
      notifyCanvasViewportSync({ x: 120, y: 80, zoom: 0.5 })
    })

    await waitFor(() =>
      expect(browserApi.setZoom).toHaveBeenCalledWith('native-tab-1', 0.5, { emitUpdate: false })
    )
    await waitFor(() =>
      expect(browserApi.setBounds).toHaveBeenCalledWith({
        tabId: 'native-tab-1',
        visible: true,
        interactive: true,
        bounds: { x: 20, y: 48, width: 420, height: 260 },
        contentBounds: { x: 20, y: 48, width: 420, height: 260 }
      })
    )

    rectSpy.mockRestore()
  })

  it('coalesces viewport sync notifications into one native bounds update per animation frame', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const frameCallbacks: FrameRequestCallback[] = []
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const component = createBrowserComponent()
    renderBrowserComponent(component, vi.fn(), { isNodeSelected: true })

    await waitFor(() => expect(browserApi.setBounds).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'native-tab-1', visible: true })))
    browserApi.setBounds.mockClear()
    browserApi.setZoom.mockClear()
    requestFrame.mockClear()
    frameCallbacks.length = 0

    act(() => {
      notifyCanvasViewportSync({ x: 120, y: 80, zoom: 0.5 })
      notifyCanvasViewportSync({ x: 140, y: 95, zoom: 0.75 })
    })

    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(browserApi.setBounds).not.toHaveBeenCalled()

    act(() => {
      frameCallbacks.shift()?.(16)
    })

    await waitFor(() => {
      expect(browserApi.setZoom).toHaveBeenCalledWith('native-tab-1', 0.75, { emitUpdate: false })
    })
    await waitFor(() => {
      expect(browserApi.setBounds).toHaveBeenCalledTimes(1)
    })

    cancelFrame.mockRestore()
    requestFrame.mockRestore()
    rectSpy.mockRestore()
  })

  it('hides the native browser view while the node itself is moving', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const { rerender } = renderBrowserComponent(component, vi.fn(), { isNodeSelected: true })

    await waitFor(() => expect(browserApi.setBounds).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'native-tab-1', visible: true })))
    browserApi.setBounds.mockClear()

    rerender(
      <BrowserComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
        isCanvasInteracting
        isNodeSelected
      />
    )

    await waitFor(() => {
      expect(browserApi.setBounds).toHaveBeenCalledWith({
        tabId: 'native-tab-1',
        visible: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 }
      })
    })

    rectSpy.mockRestore()
  })

  it('defers saved inactive tabs until they are selected', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    component.state = {
      activeTabId: 'tab-1',
      tabs: [
        { localId: 'tab-1', title: 'Example', url: 'https://example.com' },
        { localId: 'tab-2', title: 'Later', url: 'https://example.com/later' }
      ]
    }
    const updateState = vi.fn()
    const { rerender } = renderBrowserComponent(component, updateState)

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalledTimes(1))

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

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalledTimes(2))
    expect(browserApi.createTab).toHaveBeenLastCalledWith({
      componentId: 'browser-1',
      partition: 'persist:atlas-browser-browser-1-tab-2',
      url: 'https://example.com/later'
    })

    rectSpy.mockRestore()
  })

  it('updates tab metadata from native browser view events', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const updateState = vi.fn()
    renderBrowserComponent(component, updateState, { isNodeSelected: true })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())

    act(() => {
      nativeTabUpdatedListener?.({
        tabId: 'native-tab-1',
        patch: {
          title: 'Native title',
          url: 'https://example.com/native',
          zoomFactor: 0.9
        }
      })
    })

    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Native title', url: 'https://example.com/native', zoomFactor: 0.9 }]
      },
      false
    )

    rectSpy.mockRestore()
  })

  it('adds an active browser tab for matching native browser new-window requests', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const updateState = vi.fn()
    renderBrowserComponent(component, updateState, { isNodeSelected: true })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())

    act(() => {
      nativeOpenTabRequestedListener?.({
        componentId: 'browser-1',
        sourceTabId: 'native-tab-1',
        url: 'https://example.com/native-new-window'
      })
    })

    const tabPatch = updateState.mock.calls.find(([, immediate]) => immediate === true)?.[0] as {
      activeTabId: string
      tabs: Array<{ localId: string; title: string; url: string }>
    }
    const requestedTab = tabPatch.tabs.find((tab) => tab.url === 'https://example.com/native-new-window')

    expect(requestedTab).toEqual(expect.objectContaining({ url: 'https://example.com/native-new-window' }))
    expect(tabPatch.activeTabId).toBe(requestedTab?.localId)

    rectSpy.mockRestore()
  })

  it('selects the browser node when non-interactive native content is clicked', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const onRequestSelect = vi.fn()
    renderBrowserComponent(component, vi.fn(), { onRequestSelect })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())

    act(() => {
      contentInteractionRequestedListener?.({ componentId: 'other-browser' })
      contentInteractionRequestedListener?.({ componentId: 'browser-1' })
    })

    expect(onRequestSelect).toHaveBeenCalledTimes(1)
    expect(onRequestSelect).toHaveBeenCalledWith('browser-1')

    rectSpy.mockRestore()
  })

  it('navigates by committing the normalized URL to browser tab state and native contents', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const updateState = vi.fn()
    const { container } = renderBrowserComponent(component, updateState, { isNodeSelected: true })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())

    fireEvent.change(container.querySelector<HTMLInputElement>('input[aria-label="地址"]')!, { target: { value: 'baidu.com' } })
    fireEvent.submit(container.querySelector('form')!)

    expect(browserApi.navigate).toHaveBeenCalledWith('native-tab-1', 'https://baidu.com')
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://baidu.com' }],
        activeTabId: 'tab-1'
      },
      true
    )

    rectSpy.mockRestore()
  })

  it('reloads the native browser view for same-url submissions', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const { container } = renderBrowserComponent(component, vi.fn(), { isNodeSelected: true })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())

    fireEvent.submit(container.querySelector('form')!)

    expect(browserApi.reload).toHaveBeenCalledWith('native-tab-1')

    rectSpy.mockRestore()
  })

  it('closes the native browser tab when its Atlas tab closes', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const { container } = renderBrowserComponent(component, vi.fn(), { isNodeSelected: true })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())

    fireEvent.click(container.querySelector('.browser-tab svg')!)

    expect(browserApi.closeTab).toHaveBeenCalledWith('native-tab-1')

    rectSpy.mockRestore()
  })

  it('zooms browser content from the toolbar slider and persists the tab zoom factor', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const updateState = vi.fn()
    const { container } = renderBrowserComponent(component, updateState, { isNodeSelected: true })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())
    browserApi.setZoom.mockClear()

    fireEvent.change(container.querySelector<HTMLInputElement>('.browser-zoom-slider')!, { target: { value: '1.4' } })

    expect(browserApi.setZoom).toHaveBeenCalledWith('native-tab-1', 1.4, { emitUpdate: false })
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com', zoomFactor: 1.4 }]
      },
      false
    )

    rectSpy.mockRestore()
  })

  it('applies Ctrl+wheel zoom requests from native content without persisting canvas zoom', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    const updateState = vi.fn()
    renderBrowserComponent(component, updateState, { canvasZoom: 0.5, isNodeSelected: true })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())
    browserApi.setZoom.mockClear()

    act(() => {
      nativeTabZoomRequestedListener?.({
        tabId: 'native-tab-1',
        direction: 1
      })
    })

    expect(browserApi.setZoom).toHaveBeenCalledWith('native-tab-1', 0.55, { emitUpdate: false })
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com', zoomFactor: 1.1 }]
      },
      false
    )

    rectSpy.mockRestore()
  })

  it('resets browser zoom to 100% from the toolbar button', async () => {
    const rectSpy = mockBrowserViewportGeometry(createRect(20, 48, 420, 260))
    const component = createBrowserComponent()
    component.state = {
      activeTabId: 'tab-1',
      tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com', zoomFactor: 1.4 }]
    }
    const updateState = vi.fn()
    const { container } = renderBrowserComponent(component, updateState, { isNodeSelected: true })

    await waitFor(() => expect(browserApi.createTab).toHaveBeenCalled())
    browserApi.setZoom.mockClear()

    fireEvent.click(container.querySelector<HTMLButtonElement>('.browser-zoom-reset')!)

    expect(browserApi.setZoom).toHaveBeenCalledWith('native-tab-1', BROWSER_ZOOM_DEFAULT_FACTOR, { emitUpdate: false })
    expect(updateState).toHaveBeenLastCalledWith(
      {
        tabs: [{ localId: 'tab-1', title: 'Example', url: 'https://example.com', zoomFactor: BROWSER_ZOOM_DEFAULT_FACTOR }]
      },
      false
    )

    rectSpy.mockRestore()
  })
})
