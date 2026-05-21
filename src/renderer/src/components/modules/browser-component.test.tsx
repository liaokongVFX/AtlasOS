import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { BrowserComponent } from './browser-component'

const browserApi = vi.hoisted(() => ({
  closeTab: vi.fn(),
  createTab: vi.fn(),
  setBounds: vi.fn(),
  onTabUpdated: vi.fn()
}))

let frameCallbacks: FrameRequestCallback[] = []

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

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    left,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ x: left, y: top, width, height })
  } as DOMRect
}

function mockRect(element: Element, nextRect: DOMRect): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: vi.fn(() => nextRect)
  })
}

function flushAnimationFrames(): void {
  const callbacks = frameCallbacks
  frameCallbacks = []
  callbacks.forEach((callback) => callback(0))
}

describe('BrowserComponent', () => {
  beforeEach(() => {
    frameCallbacks = []
    browserApi.closeTab.mockReset()
    browserApi.createTab.mockResolvedValue({ tabId: 'runtime-tab-1', partition: 'persist:test', url: 'https://example.com' })
    browserApi.setBounds.mockReset()
    browserApi.onTabUpdated.mockReturnValue(() => undefined)

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => []) })

    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        browser: browserApi
      }
    })

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('hides the native browser view when another component is visually above the browser viewport', async () => {
    const component = createBrowserComponent()
    const updateState = vi.fn()

    const { container } = render(
      <div>
        <section className="component-node" data-testid="browser-node">
          <BrowserComponent
            canvasId="canvas-1"
            component={component}
            updateConfig={vi.fn()}
            updateState={updateState}
            setTitle={vi.fn()}
          />
        </section>
        <section className="component-node" data-testid="overlay-node" />
      </div>
    )

    const browserNode = container.querySelector('[data-testid="browser-node"]')!
    const overlayNode = container.querySelector('[data-testid="overlay-node"]')!
    const viewport = container.querySelector('.browser-viewport')!

    mockRect(browserNode, rect(80, 80, 420, 320))
    mockRect(viewport, rect(100, 140, 360, 240))
    mockRect(overlayNode, rect(160, 180, 180, 120))

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn((x: number, y: number) => {
        const overlayRect = overlayNode.getBoundingClientRect()
        if (x >= overlayRect.left && x <= overlayRect.right && y >= overlayRect.top && y <= overlayRect.bottom) {
          return [overlayNode, viewport, browserNode]
        }

        return [viewport, browserNode]
      })
    })

    await act(async () => {
      await Promise.resolve()
    })
    act(() => flushAnimationFrames())

    expect(browserApi.setBounds).toHaveBeenCalledWith({
      tabId: 'runtime-tab-1',
      visible: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 }
    })
  })

  it('keeps a large browser view visible when another node only overlaps outside the window', async () => {
    const component = createBrowserComponent()

    const { container } = render(
      <div>
        <section className="component-node" data-testid="browser-node">
          <BrowserComponent
            canvasId="canvas-1"
            component={component}
            updateConfig={vi.fn()}
            updateState={vi.fn()}
            setTitle={vi.fn()}
          />
        </section>
        <section className="component-node" data-testid="offscreen-node" />
      </div>
    )

    const browserNode = container.querySelector('[data-testid="browser-node"]')!
    const offscreenNode = container.querySelector('[data-testid="offscreen-node"]')!
    const viewport = container.querySelector('.browser-viewport')!

    mockRect(browserNode, rect(40, 80, 1800, 980))
    mockRect(viewport, rect(40, 120, 1800, 940))
    mockRect(offscreenNode, rect(1200, 200, 240, 180))

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [viewport, browserNode])
    })

    await act(async () => {
      await Promise.resolve()
    })
    act(() => flushAnimationFrames())

    expect(browserApi.setBounds).toHaveBeenLastCalledWith({
      tabId: 'runtime-tab-1',
      visible: true,
      bounds: { x: 40, y: 120, width: 760, height: 480 }
    })
  })
})
