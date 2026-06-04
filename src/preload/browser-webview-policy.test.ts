import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL } from '@shared/browser'

const electronMocks = vi.hoisted(() => ({
  executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  ipcRenderer: {
    on: electronMocks.on,
    send: electronMocks.send
  },
  webFrame: {
    executeJavaScriptInIsolatedWorld: electronMocks.executeJavaScriptInIsolatedWorld
  }
}))

function createWheelEvent(input: { ctrlKey?: boolean; deltaX?: number; deltaY?: number }): WheelEvent {
  const event = new Event('wheel', { bubbles: true, cancelable: true }) as WheelEvent
  Object.defineProperties(event, {
    ctrlKey: { value: input.ctrlKey ?? false },
    deltaX: { value: input.deltaX ?? 0 },
    deltaY: { value: input.deltaY ?? 0 }
  })
  return event
}

describe('browser webview policy preload', () => {
  beforeAll(async () => {
    electronMocks.on.mockImplementation((channel, listener) => {
      document.addEventListener(`ipc:${channel}`, ((event: Event) => {
        listener({}, (event as CustomEvent).detail)
      }) as EventListener)
    })

    await import('./browser-webview-policy')
  })

  beforeEach(() => {
    electronMocks.send.mockClear()
  })

  it('requests host page zoom for Ctrl+wheel inside the guest page', () => {
    const event = createWheelEvent({ ctrlKey: true, deltaY: -100 })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation')

    document.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(stopImmediatePropagation).toHaveBeenCalled()
    expect(electronMocks.send).toHaveBeenCalledWith(BROWSER_WEBVIEW_ZOOM_REQUEST_CHANNEL, { direction: 1 })
  })

  it('leaves ordinary wheel scrolling inside the guest page alone', () => {
    const event = createWheelEvent({ deltaY: 100 })

    document.dispatchEvent(event)

    expect(electronMocks.send).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not mutate guest document CSS zoom for ordinary wheel scrolling', () => {
    const event = createWheelEvent({ deltaX: 24 })

    document.dispatchEvent(event)

    expect(document.documentElement.style.getPropertyValue('zoom')).toBe('')
  })
})
