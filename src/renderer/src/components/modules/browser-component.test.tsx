import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { BrowserComponent } from './browser-component'

const browserApi = vi.hoisted(() => ({
  onWebviewOpenTabRequested: vi.fn()
}))

let openTabRequestedListener: ((payload: { sourceWebContentsId: number; url: string }) => void) | null = null

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

describe('BrowserComponent', () => {
  beforeEach(() => {
    openTabRequestedListener = null
    browserApi.onWebviewOpenTabRequested.mockImplementation((listener) => {
      openTabRequestedListener = listener
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

  it('keeps the active browser webview visible but non-interactive while the node is not selected', () => {
    const component = createBrowserComponent()

    const { container } = render(
      <BrowserComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
      />
    )

    const webview = container.querySelector('webview')

    expect(webview).toBeInTheDocument()
    expect(webview).toHaveAttribute('src', 'https://example.com')
    expect(webview).toHaveStyle({ display: 'flex', backgroundColor: '#ffffff', pointerEvents: 'none' })
  })

  it('makes the active browser webview interactive when the node is selected', () => {
    const component = createBrowserComponent()

    const { container } = render(
      <BrowserComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
        isNodeSelected
      />
    )

    const webview = container.querySelector('webview')

    expect(webview).toHaveStyle({ display: 'flex', pointerEvents: 'auto' })
  })

  it('keeps the active browser webview non-interactive during canvas interactions', () => {
    const component = createBrowserComponent()

    const { container } = render(
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

    const webview = container.querySelector('webview')

    expect(webview).toHaveStyle({ display: 'flex', pointerEvents: 'none' })
  })

  it('does not hide browser content when a selected browser node becomes unselected', () => {
    const component = createBrowserComponent()
    const renderBrowser = (isNodeSelected: boolean) => (
      <BrowserComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={vi.fn()}
        setTitle={vi.fn()}
        isNodeSelected={isNodeSelected}
      />
    )

    const { container, rerender } = render(renderBrowser(true))
    const webview = container.querySelector('webview')

    expect(webview).toHaveStyle({ display: 'flex', pointerEvents: 'auto' })

    rerender(renderBrowser(false))

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
    const renderBrowser = (nextComponent: CanvasComponent) => (
      <BrowserComponent
        canvasId="canvas-1"
        component={nextComponent}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
      />
    )

    const { container, rerender } = render(renderBrowser(component))

    expect(container.querySelectorAll('webview')).toHaveLength(1)
    expect(container.querySelector('webview')).toHaveAttribute('src', 'https://example.com')

    rerender(
      renderBrowser({
        ...component,
        state: { ...component.state, activeTabId: 'tab-2' }
      })
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

    const { container } = render(
      <BrowserComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
        isNodeSelected
      />
    )

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

  it('adds an active browser tab for matching webview new-window requests', async () => {
    const component = createBrowserComponent()
    const updateState = vi.fn()

    const { container } = render(
      <BrowserComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
        isNodeSelected
      />
    )

    const webview = container.querySelector('webview') as Electron.WebviewTag
    Object.defineProperty(webview, 'getWebContentsId', { value: () => 42 })

    await act(async () => {
      await Promise.resolve()
    })

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
})
