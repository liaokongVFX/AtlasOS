import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContentsView } from 'electron'
import { BrowserService } from './browser-service'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  loadURL: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(),
  setWebRTCIPHandlingPolicy: vi.fn(),
  viewSetBackgroundColor: vi.fn(),
  webContentsViewOptions: [] as unknown[],
  webContentsViewSetBackgroundColor: vi.fn(),
  windowOpenHandler: null as ((details: { url: string }) => { action: 'deny' }) | null
}))

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  View: class View {
    addChildView = vi.fn()
    removeChildView = vi.fn()
    setBackgroundColor = electronMocks.viewSetBackgroundColor
    setBounds = vi.fn()
  },
  WebContentsView: class WebContentsView {
    constructor(options: unknown) {
      electronMocks.webContentsViewOptions.push(options)
    }

    setBackgroundColor = electronMocks.webContentsViewSetBackgroundColor
    setBounds = vi.fn()
    webContents = {
      setWindowOpenHandler: vi.fn((handler) => {
        electronMocks.windowOpenHandler = handler
      }),
      setWebRTCIPHandlingPolicy: electronMocks.setWebRTCIPHandlingPolicy,
      on: vi.fn(),
      loadURL: electronMocks.loadURL
    }
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  },
  shell: {
    openExternal: electronMocks.openExternal
  }
}))

function setTabs(service: BrowserService, tabs: Map<string, unknown>): void {
  ;(service as unknown as { tabs: Map<string, unknown> }).tabs = tabs
}

describe('BrowserService', () => {
  it('returns created tabs before the page load settles so bounds can be applied immediately', async () => {
    electronMocks.ipcHandle.mockClear()
    electronMocks.loadURL.mockReset()
    electronMocks.loadURL.mockReturnValue(new Promise(() => undefined))
    electronMocks.setWebRTCIPHandlingPolicy.mockClear()
    electronMocks.viewSetBackgroundColor.mockClear()
    electronMocks.webContentsViewOptions = []
    electronMocks.webContentsViewSetBackgroundColor.mockClear()

    const window = {
      isDestroyed: () => false,
      contentView: {
        addChildView: vi.fn()
      },
      webContents: {
        isDestroyed: () => false,
        send: vi.fn()
      }
    } as unknown as BrowserWindow
    const service = new BrowserService(window)
    service.registerIpc()

    const createTabHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'browser:create-tab')?.[1]
    const createdTabPromise = createTabHandler({}, { componentId: 'component-1', url: 'https://slow.example.com' }) as Promise<{ tabId: string }>
    const didResolve = await Promise.race([createdTabPromise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0))])

    expect(didResolve).toBe(true)
    await expect(createdTabPromise).resolves.toEqual({
      tabId: expect.any(String),
      partition: expect.any(String),
      url: 'https://slow.example.com'
    })
    expect(electronMocks.loadURL).toHaveBeenCalledWith('https://slow.example.com')
    expect(electronMocks.viewSetBackgroundColor).toHaveBeenCalledWith('#ffffff')
    expect(electronMocks.webContentsViewSetBackgroundColor).toHaveBeenCalledWith('#ffffff')
    expect(electronMocks.webContentsViewOptions[0]).toMatchObject({
      webPreferences: {
        preload: expect.stringMatching(/[\\/]preload[\\/]browser-webview-policy\.js$/)
      }
    })
    expect(electronMocks.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp')
  })

  it('routes embedded new-window requests into Atlas browser tabs instead of the system browser', async () => {
    electronMocks.ipcHandle.mockClear()
    electronMocks.loadURL.mockReset()
    electronMocks.loadURL.mockResolvedValue(undefined)
    electronMocks.openExternal.mockClear()
    electronMocks.windowOpenHandler = null

    const send = vi.fn()
    const window = {
      isDestroyed: () => false,
      contentView: {
        addChildView: vi.fn()
      },
      webContents: {
        isDestroyed: () => false,
        send
      }
    } as unknown as BrowserWindow
    const service = new BrowserService(window)
    service.registerIpc()

    const createTabHandler = electronMocks.ipcHandle.mock.calls.find(([channel]) => channel === 'browser:create-tab')?.[1]
    const createdTab = (await createTabHandler({}, { componentId: 'component-1', url: 'https://example.com' })) as { tabId: string }

    const openInNewTab = electronMocks.windowOpenHandler as unknown as (details: { url: string }) => { action: 'deny' }

    expect(openInNewTab({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('browser:open-tab-requested', {
      componentId: 'component-1',
      sourceTabId: createdTab.tabId,
      url: 'https://example.com/docs'
    })
  })

  it('clips a browser tab with a native container and offsets the web contents', () => {
    const window = {} as BrowserWindow
    const service = new BrowserService(window)
    const containerSetBounds = vi.fn()
    const viewSetBounds = vi.fn()
    const tab = {
      id: 'tab-1',
      componentId: 'component-1',
      container: {
        setBounds: containerSetBounds
      },
      view: {
        setBounds: viewSetBounds
      }
    }

    ;(
      service as unknown as {
        setTabBounds: (
          tab: unknown,
          visible: boolean,
          containerBounds: { x: number; y: number; width: number; height: number },
          contentBounds: { x: number; y: number; width: number; height: number }
        ) => void
      }
    ).setTabBounds(tab, true, { x: 20, y: 56, width: 420, height: 284 }, { x: 20, y: 40, width: 420, height: 300 })

    expect(containerSetBounds).toHaveBeenCalledWith({ x: 20, y: 56, width: 420, height: 284 })
    expect(viewSetBounds).toHaveBeenCalledWith({ x: 0, y: -16, width: 420, height: 300 })
  })

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
