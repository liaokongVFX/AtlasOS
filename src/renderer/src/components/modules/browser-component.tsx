import { nanoid } from 'nanoid'
import { ArrowLeft, ArrowRight, Bug, Camera, Plus, RefreshCw, RotateCcw, ZoomIn, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BROWSER_NATIVE_ZOOM_MAX_FACTOR,
  BROWSER_NATIVE_ZOOM_MIN_FACTOR,
  BROWSER_ZOOM_DEFAULT_FACTOR,
  BROWSER_ZOOM_MAX_FACTOR,
  BROWSER_ZOOM_MIN_FACTOR,
  BROWSER_ZOOM_STEP
} from '@shared/browser'
import { useI18n } from '../../i18n'
import { subscribeCanvasViewportSync } from '../../lib/canvas-viewport-sync'
import { asString, cn, normalizeUrl } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type BrowserTabState = {
  localId: string
  title: string
  url: string
  partition?: string
  zoomFactor?: number
}

type BrowserNativeTabCreated = {
  tabId: string
  partition: string
  url: string
}

type BrowserNativeTabState = {
  localId: string
  partition: string
  tabId: string
  url: string
}

type BrowserNativeTabUpdated = {
  tabId: string
  patch: Record<string, unknown>
}

type BrowserNativeOpenTabRequest = {
  componentId: string
  sourceTabId: string
  url: string
}

type BrowserContentInteractionRequest = {
  componentId: string
}

type BrowserNativeTabZoomRequest = {
  tabId: string
  direction: -1 | 1
}

type BrowserRectangle = {
  x: number
  y: number
  width: number
  height: number
}

type BrowserBounds = {
  bounds: BrowserRectangle
  contentBounds: BrowserRectangle
}

const DEFAULT_BROWSER_URL = 'https://example.com'
const HIDDEN_BROWSER_BOUNDS: BrowserRectangle = { x: 0, y: 0, width: 0, height: 0 }

function readTabs(state: Record<string, unknown>, defaultTitle: string): BrowserTabState[] {
  const tabs = state.tabs
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return [{ localId: nanoid(), title: defaultTitle, url: DEFAULT_BROWSER_URL }]
  }

  return tabs
    .map((tab) => tab as Partial<BrowserTabState>)
    .filter((tab): tab is BrowserTabState => Boolean(tab.localId && tab.url))
}

function createBrowserTab(title: string, url = DEFAULT_BROWSER_URL): BrowserTabState {
  return { localId: nanoid(), title, url }
}

function clampZoomFactor(value: number): number {
  return Math.min(Math.max(value, BROWSER_ZOOM_MIN_FACTOR), BROWSER_ZOOM_MAX_FACTOR)
}

function normalizeZoomFactor(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return clampZoomFactor(value)
}

function normalizeCommittedZoomFactor(value: number): number {
  return Math.round(clampZoomFactor(value) * 100) / 100
}

function normalizeNativeZoomFactor(value: number): number {
  const clamped = Math.min(Math.max(value, BROWSER_NATIVE_ZOOM_MIN_FACTOR), BROWSER_NATIVE_ZOOM_MAX_FACTOR)
  return Math.round(clamped * 1000) / 1000
}

function normalizeCanvasZoomFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return BROWSER_ZOOM_DEFAULT_FACTOR
  return value
}

function nativeZoomFactorForZoom(zoomFactor: unknown, canvasZoomFactor: number): number {
  const tabZoomFactor = normalizeZoomFactor(zoomFactor) ?? BROWSER_ZOOM_DEFAULT_FACTOR
  return normalizeNativeZoomFactor(tabZoomFactor * normalizeCanvasZoomFactor(canvasZoomFactor))
}

function formatZoomPercent(zoomFactor: number): string {
  return `${Math.round(zoomFactor * 100)}%`
}

function partitionForTab(componentId: string, tab: BrowserTabState): string {
  return tab.partition ?? `persist:atlas-browser-${componentId}-${tab.localId}`
}

function nextZoomFactor(current: number, direction: -1 | 1): number {
  return normalizeCommittedZoomFactor(current + direction * BROWSER_ZOOM_STEP)
}

function nativeZoomFactorForTab(tab: BrowserTabState, canvasZoomFactor: number): number {
  return nativeZoomFactorForZoom(tab.zoomFactor, canvasZoomFactor)
}

function clippedBrowserBounds(element: HTMLElement): BrowserBounds | null {
  const rect = element.getBoundingClientRect()
  const contentLeft = Math.round(rect.left)
  const contentTop = Math.round(rect.top)
  const contentRight = Math.round(rect.right)
  const contentBottom = Math.round(rect.bottom)
  const contentBounds = {
    x: contentLeft,
    y: contentTop,
    width: Math.max(0, contentRight - contentLeft),
    height: Math.max(0, contentBottom - contentTop)
  }

  if (contentBounds.width === 0 || contentBounds.height === 0) return null

  const clippedLeft = Math.max(0, contentLeft)
  const clippedTop = Math.max(0, contentTop)
  const clippedRight = Math.min(window.innerWidth, contentRight)
  const clippedBottom = Math.min(window.innerHeight, contentBottom)
  const bounds = {
    x: clippedLeft,
    y: clippedTop,
    width: Math.max(0, clippedRight - clippedLeft),
    height: Math.max(0, clippedBottom - clippedTop)
  }

  if (bounds.width === 0 || bounds.height === 0) return null

  return { bounds, contentBounds }
}

export function BrowserComponent({
  canvasZoom = BROWSER_ZOOM_DEFAULT_FACTOR,
  component,
  updateState,
  isCanvasInteracting = false,
  isNodeSelected = false,
  isViewportInteracting = false,
  onRequestSelect
}: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const canvasZoomFactorRef = useRef(normalizeCanvasZoomFactor(canvasZoom))
  const nativeTabsRef = useRef(new Map<string, BrowserNativeTabState>())
  const nativeZoomFactorsRef = useRef(new Map<string, number>())
  const pendingNativeTabsRef = useRef(new Map<string, Promise<BrowserNativeTabState | null>>())
  const browserViewportRef = useRef<HTMLDivElement | null>(null)
  const boundsSyncFrameRef = useRef<number | null>(null)
  const syncNativeBrowserBoundsRef = useRef<(() => void) | null>(null)
  const disposedRef = useRef(false)
  const [address, setAddress] = useState('')
  const [nativeActiveLocalId, setNativeActiveLocalId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)

  const tabs = useMemo(() => readTabs(component.state, t('browser.defaultTabTitle')), [component.state, t])
  const activeLocalId = asString(component.state.activeTabId, tabs[0]?.localId)
  const activeTab = tabs.find((tab) => tab.localId === activeLocalId) ?? tabs[0]
  const isNodeTransforming = isCanvasInteracting && !isViewportInteracting

  const patchTabs = useCallback(
    (nextTabs: BrowserTabState[], nextActiveId = activeLocalId) => {
      updateState({ tabs: nextTabs, activeTabId: nextActiveId }, true)
    },
    [activeLocalId, updateState]
  )

  const patchTab = useCallback(
    (localId: string, patch: Partial<Pick<BrowserTabState, 'title' | 'url' | 'zoomFactor'>>) => {
      let didChange = false
      const nextTabs = tabs.map((tab) => {
        if (tab.localId !== localId) return tab

        const nextZoomFactor = normalizeZoomFactor(patch.zoomFactor)
        const nextTab = {
          ...tab,
          title: asString(patch.title, tab.title),
          url: asString(patch.url, tab.url),
          zoomFactor: nextZoomFactor ?? tab.zoomFactor
        }
        didChange =
          nextTab.title !== tab.title ||
          nextTab.url !== tab.url ||
          normalizeZoomFactor(nextTab.zoomFactor) !== normalizeZoomFactor(tab.zoomFactor)

        return didChange ? nextTab : tab
      })

      if (didChange) updateState({ tabs: nextTabs }, false)
    },
    [tabs, updateState]
  )

  const nativeLocalIdForTabId = useCallback((tabId: string): string | null => {
    for (const [localId, nativeTab] of nativeTabsRef.current) {
      if (nativeTab.tabId === tabId) return localId
    }

    return null
  }, [])

  const hideNativeTab = useCallback((nativeTab: BrowserNativeTabState) => {
    void window.atlas.browser.setBounds({
      tabId: nativeTab.tabId,
      visible: false,
      bounds: HIDDEN_BROWSER_BOUNDS
    }).catch(() => undefined)
  }, [])

  const hideNativeTabsExcept = useCallback(
    (visibleLocalId: string | null) => {
      for (const [localId, nativeTab] of nativeTabsRef.current) {
        if (localId !== visibleLocalId) hideNativeTab(nativeTab)
      }
    },
    [hideNativeTab]
  )

  const closeNativeTab = useCallback((localId: string) => {
    const nativeTab = nativeTabsRef.current.get(localId)
    if (!nativeTab) return

    nativeTabsRef.current.delete(localId)
    nativeZoomFactorsRef.current.delete(nativeTab.tabId)
    void window.atlas.browser.closeTab(nativeTab.tabId).catch(() => undefined)
    setNativeActiveLocalId((currentLocalId) => (currentLocalId === localId ? null : currentLocalId))
  }, [])

  const getActiveNativeTab = useCallback((): BrowserNativeTabState | null => {
    if (!activeTab) return null
    return nativeTabsRef.current.get(activeTab.localId) ?? null
  }, [activeTab])

  const setNativeTabZoom = useCallback((tabId: string, zoomFactor: number) => {
    const nextZoomFactor = normalizeNativeZoomFactor(zoomFactor)
    if (nativeZoomFactorsRef.current.get(tabId) === nextZoomFactor) return

    nativeZoomFactorsRef.current.set(tabId, nextZoomFactor)
    void window.atlas.browser.setZoom(tabId, nextZoomFactor, { emitUpdate: false }).catch(() => {
      nativeZoomFactorsRef.current.delete(tabId)
    })
  }, [])

  const syncNativeBrowserBounds = useCallback(() => {
    const nativeTab = getActiveNativeTab()
    const viewport = browserViewportRef.current

    if (!activeTab || !nativeTab || isNodeTransforming) {
      hideNativeTabsExcept(null)
      setNativeActiveLocalId(null)
      return
    }

    const nextBounds = viewport ? clippedBrowserBounds(viewport) : null
    if (!nextBounds) {
      hideNativeTabsExcept(null)
      setNativeActiveLocalId(null)
      return
    }

    hideNativeTabsExcept(activeTab.localId)
    setNativeTabZoom(nativeTab.tabId, nativeZoomFactorForTab(activeTab, canvasZoomFactorRef.current))
    void window.atlas.browser.setBounds({
      tabId: nativeTab.tabId,
      visible: true,
      interactive: isNodeSelected,
      bounds: nextBounds.bounds,
      contentBounds: nextBounds.contentBounds
    }).catch(() => {
      if (nativeTabsRef.current.get(activeTab.localId)?.tabId === nativeTab.tabId) {
        nativeTabsRef.current.delete(activeTab.localId)
        setNativeActiveLocalId(null)
      }
    })
    setNativeActiveLocalId(activeTab.localId)
  }, [activeTab, getActiveNativeTab, hideNativeTabsExcept, isNodeSelected, isNodeTransforming, setNativeTabZoom])

  useEffect(() => {
    syncNativeBrowserBoundsRef.current = syncNativeBrowserBounds
  }, [syncNativeBrowserBounds])

  const scheduleNativeBrowserBoundsSync = useCallback((viewport?: { zoom: number }) => {
    if (viewport) canvasZoomFactorRef.current = normalizeCanvasZoomFactor(viewport.zoom)
    if (boundsSyncFrameRef.current !== null) return

    boundsSyncFrameRef.current = window.requestAnimationFrame(() => {
      boundsSyncFrameRef.current = null
      syncNativeBrowserBoundsRef.current?.()
    })
  }, [])

  useEffect(() => {
    return () => {
      if (boundsSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(boundsSyncFrameRef.current)
        boundsSyncFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const nextCanvasZoomFactor = normalizeCanvasZoomFactor(canvasZoom)
    if (canvasZoomFactorRef.current === nextCanvasZoomFactor) return

    canvasZoomFactorRef.current = nextCanvasZoomFactor
    syncNativeBrowserBounds()
  }, [canvasZoom, syncNativeBrowserBounds])

  const createNativeTab = useCallback(
    (tab: BrowserTabState): Promise<BrowserNativeTabState | null> => {
      const existing = nativeTabsRef.current.get(tab.localId)
      if (existing) return Promise.resolve(existing)

      const pending = pendingNativeTabsRef.current.get(tab.localId)
      if (pending) return pending

      const partition = partitionForTab(component.id, tab)
      const creation = (window.atlas.browser.createTab({
        componentId: component.id,
        partition,
        url: tab.url
      }) as Promise<BrowserNativeTabCreated>)
        .then((createdTab) => {
          const nativeTab = {
            localId: tab.localId,
            partition: createdTab.partition,
            tabId: createdTab.tabId,
            url: createdTab.url
          }

          if (disposedRef.current) {
            void window.atlas.browser.closeTab(nativeTab.tabId).catch(() => undefined)
            return null
          }

          nativeTabsRef.current.set(tab.localId, nativeTab)

          setNativeTabZoom(nativeTab.tabId, nativeZoomFactorForTab(tab, canvasZoomFactorRef.current))

          return nativeTab
        })
        .catch(() => null)
        .finally(() => {
          pendingNativeTabsRef.current.delete(tab.localId)
        })

      pendingNativeTabsRef.current.set(tab.localId, creation)
      return creation
    },
    [component.id, setNativeTabZoom]
  )

  useEffect(() => {
    if (!component.state.tabs) {
      updateState({ tabs, activeTabId: activeLocalId }, true)
    }
  }, [activeLocalId, component.state.tabs, tabs, updateState])

  useEffect(() => {
    disposedRef.current = false

    return () => {
      disposedRef.current = true

      for (const nativeTab of nativeTabsRef.current.values()) {
        void window.atlas.browser.closeTab(nativeTab.tabId).catch(() => undefined)
      }
      nativeTabsRef.current.clear()
      nativeZoomFactorsRef.current.clear()

      for (const pendingTab of pendingNativeTabsRef.current.values()) {
        void pendingTab.then((nativeTab) => {
          if (nativeTab) void window.atlas.browser.closeTab(nativeTab.tabId).catch(() => undefined)
        })
      }
      pendingNativeTabsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const liveTabIds = new Set(tabs.map((tab) => tab.localId))
    for (const localId of [...nativeTabsRef.current.keys()]) {
      if (!liveTabIds.has(localId)) closeNativeTab(localId)
    }
  }, [closeNativeTab, tabs])

  useEffect(() => {
    const dispose = window.atlas.browser.onTabUpdated((update: BrowserNativeTabUpdated) => {
      const localId = nativeLocalIdForTabId(update.tabId)
      if (!localId) return

      const nativeTab = nativeTabsRef.current.get(localId)
      const nextPatch: Partial<Pick<BrowserTabState, 'title' | 'url' | 'zoomFactor'>> = {}
      const title = update.patch.title
      const url = update.patch.url
      const nativeZoomFactor = typeof update.patch.zoomFactor === 'number' ? update.patch.zoomFactor : undefined
      const zoomFactor = nativeZoomFactor !== undefined ? normalizeZoomFactor(nativeZoomFactor) : undefined

      if (typeof title === 'string' && title) nextPatch.title = title
      if (typeof url === 'string' && url) {
        nextPatch.url = url
        if (nativeTab) nativeTab.url = url
      }
      if (zoomFactor !== undefined) {
        nextPatch.zoomFactor = zoomFactor
        nativeZoomFactorsRef.current.set(update.tabId, normalizeNativeZoomFactor(zoomFactor))
      }

      if (Object.keys(nextPatch).length > 0) patchTab(localId, nextPatch)
    })

    return dispose
  }, [nativeLocalIdForTabId, patchTab])

  useEffect(() => {
    const dispose = window.atlas.browser.onOpenTabRequested((request: BrowserNativeOpenTabRequest) => {
      if (request.componentId !== component.id || !nativeLocalIdForTabId(request.sourceTabId)) return

      const next = createBrowserTab(t('browser.newTab'), request.url)
      patchTabs([...tabs, next], next.localId)
    })

    return dispose
  }, [component.id, nativeLocalIdForTabId, patchTabs, tabs, t])

  useEffect(() => {
    const dispose = window.atlas.browser.onContentInteractionRequested((request: BrowserContentInteractionRequest) => {
      if (request.componentId !== component.id) return
      onRequestSelect?.(component.id)
    })

    return dispose
  }, [component.id, onRequestSelect])

  useEffect(() => {
    if (!activeTab) {
      syncNativeBrowserBounds()
      return undefined
    }

    let disposed = false
    void createNativeTab(activeTab).then((nativeTab) => {
      if (disposed || !nativeTab) return

      if (nativeTab.url !== activeTab.url) {
        nativeTab.url = activeTab.url
        void window.atlas.browser.navigate(nativeTab.tabId, activeTab.url).catch(() => undefined)
      }

      syncNativeBrowserBounds()
    })

    return () => {
      disposed = true
    }
  }, [activeTab, createNativeTab, syncNativeBrowserBounds])

  useEffect(() => {
    const nativeTab = getActiveNativeTab()
    if (!activeTab || !nativeTab || nativeTab.url === activeTab.url) return

    nativeTab.url = activeTab.url
    void window.atlas.browser.navigate(nativeTab.tabId, activeTab.url).catch(() => undefined)
  }, [activeTab, getActiveNativeTab])

  useEffect(() => {
    const syncFromWindowEvent = () => scheduleNativeBrowserBoundsSync()
    const unsubscribe = subscribeCanvasViewportSync(scheduleNativeBrowserBoundsSync)

    window.addEventListener('resize', syncFromWindowEvent)
    window.addEventListener('scroll', syncFromWindowEvent, true)

    return () => {
      unsubscribe()
      window.removeEventListener('resize', syncFromWindowEvent)
      window.removeEventListener('scroll', syncFromWindowEvent, true)
    }
  }, [scheduleNativeBrowserBoundsSync])

  useEffect(() => {
    const viewport = browserViewportRef.current
    if (!viewport || typeof ResizeObserver !== 'function') return undefined

    const observer = new ResizeObserver(() => scheduleNativeBrowserBoundsSync())
    observer.observe(viewport)

    return () => {
      observer.disconnect()
    }
  }, [scheduleNativeBrowserBoundsSync])

  useEffect(() => {
    syncNativeBrowserBounds()
  }, [syncNativeBrowserBounds])

  useEffect(() => {
    setAddress(activeTab?.url ?? '')
  }, [activeTab?.url])

  useEffect(() => {
    if (isNodeSelected) setSnapshot(null)
  }, [isNodeSelected])

  const navigate = () => {
    if (!activeTab) return

    const url = normalizeUrl(address)
    const nativeTab = getActiveNativeTab()
    if (activeTab.url === url) {
      if (nativeTab) {
        void window.atlas.browser.reload(nativeTab.tabId).catch(() => undefined)
      }
      return
    }

    if (nativeTab) {
      nativeTab.url = url
      void window.atlas.browser.navigate(nativeTab.tabId, url).catch(() => undefined)
    }

    patchTabs(
      tabs.map((tab) => (tab.localId === activeTab.localId ? { ...tab, url } : tab)),
      activeTab.localId
    )
  }

  const addTab = () => {
    const next = createBrowserTab(t('browser.newTab'))
    patchTabs([...tabs, next], next.localId)
  }

  const closeTab = (localId: string) => {
    closeNativeTab(localId)
    const nextTabs = tabs.filter((tab) => tab.localId !== localId)
    const fallbackTab = createBrowserTab(t('browser.newTab'))
    const finalTabs = nextTabs.length ? nextTabs : [fallbackTab]
    patchTabs(finalTabs, finalTabs[0].localId)
  }

  const captureActiveTab = async () => {
    if (!activeTab) return

    const nativeTab = await createNativeTab(activeTab)
    if (!nativeTab) return

    setSnapshot(await window.atlas.browser.capture(nativeTab.tabId))
  }

  const commitZoomFactor = useCallback(
    (localId: string, value: number) => {
      if (!Number.isFinite(value)) return

      const zoomFactor = normalizeCommittedZoomFactor(value)
      const nativeTab = nativeTabsRef.current.get(localId)
      if (nativeTab) {
        setNativeTabZoom(nativeTab.tabId, nativeZoomFactorForZoom(zoomFactor, canvasZoomFactorRef.current))
      }

      patchTab(localId, { zoomFactor })
    },
    [patchTab, setNativeTabZoom]
  )

  useEffect(() => {
    const dispose = window.atlas.browser.onTabZoomRequested((request: BrowserNativeTabZoomRequest) => {
      const localId = nativeLocalIdForTabId(request.tabId)
      if (!localId) return

      const tab = tabs.find((item) => item.localId === localId)
      const zoomFactor = normalizeZoomFactor(tab?.zoomFactor) ?? BROWSER_ZOOM_DEFAULT_FACTOR
      commitZoomFactor(localId, nextZoomFactor(zoomFactor, request.direction))
    })

    return dispose
  }, [commitZoomFactor, nativeLocalIdForTabId, tabs])

  const goBack = () => {
    const nativeTab = getActiveNativeTab()
    if (nativeTab) {
      void window.atlas.browser.back(nativeTab.tabId).catch(() => undefined)
    }
  }

  const goForward = () => {
    const nativeTab = getActiveNativeTab()
    if (nativeTab) {
      void window.atlas.browser.forward(nativeTab.tabId).catch(() => undefined)
    }
  }

  const reload = () => {
    const nativeTab = getActiveNativeTab()
    if (nativeTab) {
      void window.atlas.browser.reload(nativeTab.tabId).catch(() => undefined)
    }
  }

  const openDevTools = () => {
    const nativeTab = getActiveNativeTab()
    if (nativeTab) {
      void window.atlas.browser.devtools(nativeTab.tabId).catch(() => undefined)
    }
  }

  const activeBrowserAvailable = Boolean(activeTab)
  const activeZoomFactor = normalizeZoomFactor(activeTab?.zoomFactor) ?? BROWSER_ZOOM_DEFAULT_FACTOR
  const activeZoomPercent = formatZoomPercent(activeZoomFactor)
  const canResetZoom = Boolean(activeTab) && activeZoomFactor !== BROWSER_ZOOM_DEFAULT_FACTOR
  const nativeContentActive = nativeActiveLocalId === activeLocalId && !isNodeTransforming

  return (
    <div className="browser-module">
      <div className="browser-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.localId}
            className={tab.localId === activeLocalId ? 'browser-tab browser-tab--active' : 'browser-tab'}
            onClick={() => patchTabs(tabs, tab.localId)}
          >
            <span>{tab.title || tab.url}</span>
            <X
              size={12}
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.localId)
              }}
            />
          </button>
        ))}
        <button className="icon-button" onClick={addTab} title={t('browser.newTab')} aria-label={t('browser.newTab')}>
          <Plus size={14} />
        </button>
      </div>
      <div className="browser-toolbar">
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.back')} aria-label={t('browser.back')} onClick={goBack}>
          <ArrowLeft size={15} />
        </button>
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.forward')} aria-label={t('browser.forward')} onClick={goForward}>
          <ArrowRight size={15} />
        </button>
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.reload')} aria-label={t('browser.reload')} onClick={reload}>
          <RefreshCw size={15} />
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            navigate()
          }}
        >
          <input value={address} aria-label={t('browser.address')} onChange={(event) => setAddress(event.target.value)} />
        </form>
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.devtools')} aria-label={t('browser.devtools')} onClick={openDevTools}>
          <Bug size={15} />
        </button>
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.capture')} aria-label={t('browser.capture')} onClick={() => void captureActiveTab()}>
          <Camera size={15} />
        </button>
      </div>
      <div className="browser-zoom-bar">
        <label className="browser-zoom-control" title={t('browser.zoom')}>
          <ZoomIn size={14} aria-hidden="true" />
          <input
            className="browser-zoom-slider"
            type="range"
            min={BROWSER_ZOOM_MIN_FACTOR}
            max={BROWSER_ZOOM_MAX_FACTOR}
            step={BROWSER_ZOOM_STEP}
            value={activeZoomFactor}
            disabled={!activeTab}
            aria-label={t('browser.zoom')}
            aria-valuetext={activeZoomPercent}
            onChange={(event) => {
              if (!activeTab) return
              commitZoomFactor(activeTab.localId, Number.parseFloat(event.currentTarget.value))
            }}
          />
          <span className="browser-zoom-value">{activeZoomPercent}</span>
        </label>
        <button
          type="button"
          className="icon-button browser-zoom-reset"
          disabled={!canResetZoom}
          title={t('browser.resetZoom')}
          aria-label={t('browser.resetZoom')}
          onClick={() => {
            if (!activeTab) return
            commitZoomFactor(activeTab.localId, BROWSER_ZOOM_DEFAULT_FACTOR)
          }}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <div ref={browserViewportRef} className={cn('browser-viewport', nativeContentActive && 'browser-viewport--native-active')}>
        {snapshot ? <img className="browser-snapshot" src={snapshot} alt={t('browser.screenshotAlt')} onClick={() => setSnapshot(null)} /> : null}
      </div>
    </div>
  )
}
