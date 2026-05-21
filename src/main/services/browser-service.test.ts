import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContentsView } from 'electron'
import { BrowserService } from './browser-service'

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  ipcMain: {
    handle: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}))

function setTabs(service: BrowserService, tabs: Map<string, unknown>): void {
  ;(service as unknown as { tabs: Map<string, unknown> }).tabs = tabs
}

describe('BrowserService', () => {
  it('does not touch BrowserWindow contentView after the window is destroyed', () => {
    const removeChildView = vi.fn()
    const close = vi.fn()
    const window = {
      isDestroyed: () => true,
      contentView: {
        removeChildView
      },
      webContents: {
        isDestroyed: () => true,
        send: vi.fn()
      }
    } as unknown as BrowserWindow
    const webContents = {
      isDestroyed: () => true,
      close
    }
    const view = {
      webContents
    } as unknown as WebContentsView
    const service = new BrowserService(window)

    setTabs(
      service,
      new Map([
        [
          'tab-1',
          {
            id: 'tab-1',
            componentId: 'component-1',
            view
          }
        ]
      ])
    )

    expect(() => service.dispose()).not.toThrow()
    expect(removeChildView).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
