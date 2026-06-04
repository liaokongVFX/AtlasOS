import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContentsView } from 'electron'
import { BrowserService } from './browser-service'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  ipcOn: vi.fn(),
  ipcRemoveListener: vi.fn(),
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
    setVisible = vi.fn()
  },
  WebContentsView: class WebContentsView {
    constructor(options: unknown) {
      electronMocks.webContentsViewOptions.push(options)
    }

    setBackgroundColor = electronMocks.webContentsViewSetBackgroundColor
    setBounds = vi.fn()
    setVisible = vi.fn()
    webContents = {
      setWindowOpenHandler: vi.fn((handler) => {
        electronMocks.windowOpenHandler = handler
      }),
      setWebRTCIPHandlingPolicy: electronMocks.setWebRTCIPHandlingPolicy,
      on: vi.fn(),
      getType: vi.fn(() => 'webContentsView'),
      getZoomFactor: vi.fn(() => 1),
      loadURL: electronMocks.loadURL,
      setZoomFactor: vi.fn()
    }
  },
  ipcMain: {
    handle: electronMocks.ipcHandle,
    on: electronMocks.ipcOn,
    removeListener: electronMocks.ipcRemoveListener
  },
  shell: {
    openExternal: electronMocks.openExternal
  }
}))

function setTabs(service: BrowserService, tabs: Map<string, unknown>): void {
  ;(service as unknown as { tabs: Map<string, unknown> }).tabs = tabs
}

describe('BrowserService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.loadURL.mockResolvedValue(undefined)
    electronMocks.viewSetBackgroundColor.mockClear()
    electronMocks.webContentsViewOptions = []
    electronMocks.windowOpenHandler = null
  })

  it('returns created tabs before the page load settles so bounds can be applied immediately', async () => {
    electronMocks.loadURL.mockReset()
    electronMocks.loadURL.mockReturnValue(new Promise(() => undefined))
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
    expect(electronMocks.ipcOn).toHaveBeenCalled()
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

  it('clips a native browser tab with a container view without reattaching the web contents', () => {
    const window = {} as unknown as BrowserWindow
    const service = new BrowserService(window)
    const containerSetBounds = vi.fn()
    const containerSetVisible = vi.fn()
    const viewSetBounds = vi.fn()
    const viewSetVisible = vi.fn()
    const tab = {
      id: 'tab-1',
      componentId: 'component-1',
      container: {
        setBounds: containerSetBounds,
        setVisible: containerSetVisible
      },
      visible: false,
      view: {
        setBounds: viewSetBounds,
        setVisible: viewSetVisible
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
    expect(viewSetVisible).toHaveBeenCalledWith(true)
    expect(containerSetVisible).toHaveBeenCalledWith(true)
    expect(tab.visible).toBe(true)
  })

  it('hides native browser views explicitly so inactive tabs cannot receive input', () => {
    const window = {} as BrowserWindow
    const service = new BrowserService(window)
    const containerSetBounds = vi.fn()
    const containerSetVisible = vi.fn()
    const viewSetBounds = vi.fn()
    const viewSetVisible = vi.fn()
    const tab = {
      id: 'tab-1',
      componentId: 'component-1',
      container: {
        setBounds: containerSetBounds,
        setVisible: containerSetVisible
      },
      visible: true,
      view: {
        setBounds: viewSetBounds,
        setVisible: viewSetVisible
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
    ).setTabBounds(tab, false, { x: 20, y: 56, width: 420, height: 284 }, { x: 20, y: 40, width: 420, height: 300 })

    expect(viewSetVisible).toHaveBeenCalledWith(false)
    expect(viewSetBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    expect(containerSetVisible).toHaveBeenCalledWith(false)
    expect(containerSetBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    expect(tab.visible).toBe(false)
  })

  it('zooms DOM webview guests from Ctrl+wheel requests and reports the persisted zoom', () => {
    const send = vi.fn()
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send
      }
    } as unknown as BrowserWindow
    const service = new BrowserService(window)
    service.registerIpc()

    const zoomHandler = electronMocks.ipcOn.mock.calls.find(([channel]) => channel === 'atlas-browser:zoom-request')?.[1]
    const setZoomFactor = vi.fn()
    const sender = {
      id: 42,
      getType: () => 'webview',
      getZoomFactor: () => 1,
      setZoomFactor
    }

    zoomHandler({ sender }, { direction: 1 })

    expect(setZoomFactor).toHaveBeenCalledWith(1.1)
    expect(send).toHaveBeenCalledWith('browser:webview-zoom-updated', {
      sourceWebContentsId: 42,
      zoomFactor: 1.1
    })
  })

  it('suppresses aborted page loads from superseded browser navigations', async () => {
    electronMocks.loadURL.mockReset()
    electronMocks.loadURL.mockRejectedValue(Object.assign(new Error('ERR_ABORTED (-3) loading'), { errno: -3 }))

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
    await createTabHandler({}, { componentId: 'component-1', url: 'https://example.com' })
    await Promise.resolve()

    expect(send).not.toHaveBeenCalledWith(
      'browser:tab-updated',
      expect.objectContaining({
        patch: expect.objectContaining({ loadError: expect.any(String) })
      })
    )
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
            container: {},
            view,
            visible: false
          }
        ]
      ])
    )

    expect(() => service.dispose()).not.toThrow()
    expect(removeChildView).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
