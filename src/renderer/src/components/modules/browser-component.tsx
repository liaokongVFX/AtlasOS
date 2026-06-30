import { nanoid } from 'nanoid'
import { ArrowLeft, ArrowRight, Bug, Camera, Plus, RefreshCw, RotateCcw, ZoomIn, X } from 'lucide-react'
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  BROWSER_ZOOM_DEFAULT_FACTOR,
  BROWSER_ZOOM_MAX_FACTOR,
  BROWSER_ZOOM_MIN_FACTOR,
  BROWSER_ZOOM_STEP
} from '@shared/browser'
import { useI18n } from '../../i18n'
import { dispatchBrowserWebviewCanvasZoom, webviewCanvasZoomInputFromRequest } from '../../lib/browser-webview-canvas-zoom'
import { asString, normalizeUrl } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type BrowserTabState = {
  localId: string
  title: string
  url: string
  partition?: string
  zoomFactor?: number
}

type BrowserWebviewOpenTabRequest = {
  sourceWebContentsId: number
  url: string
}

type BrowserWebviewZoomUpdated = {
  sourceWebContentsId: number
  zoomFactor: number
}

type BrowserWebviewElement = Electron.WebviewTag

const DEFAULT_BROWSER_URL = 'https://example.com'
const BROWSER_CONTENT_BACKGROUND = '#ffffff'
const WEBVIEW_PREFERENCES = 'contextIsolation=yes,sandbox=yes'

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

function formatZoomPercent(zoomFactor: number): string {
  return `${Math.round(zoomFactor * 100)}%`
}

function partitionForTab(componentId: string, tab: BrowserTabState): string {
  return tab.partition ?? `persist:atlas-browser-${componentId}-${tab.localId}`
}

function applyWebviewZoom(webview: BrowserWebviewElement, zoomFactor: number): void {
  try {
    webview.setZoomFactor(zoomFactor)
  } catch {
    // The webview can briefly reject commands before its guest WebContents is attached.
  }
}

function readWebviewContentsId(webview: BrowserWebviewElement): number | null {
  if (typeof webview.getWebContentsId !== 'function') return null

  try {
    const contentsId = webview.getWebContentsId()
    return Number.isFinite(contentsId) && contentsId > 0 ? contentsId : null
  } catch {
    return null
  }
}

type BrowserWebviewProps = {
  active: boolean
  componentId: string
  interactive: boolean
  onTitleChange: (localId: string, title: string) => void
  onUrlChange: (localId: string, url: string) => void
  registerWebview: (localId: string, webview: BrowserWebviewElement | null) => void
  tab: BrowserTabState
  zoomFactor: number
}

function BrowserWebview({
  active,
  componentId,
  interactive,
  onTitleChange,
  onUrlChange,
  registerWebview,
  tab,
  zoomFactor
}: BrowserWebviewProps): JSX.Element {
  const webviewRef = useRef<BrowserWebviewElement | null>(null)
  const style = useMemo<CSSProperties>(
    () => ({
      display: active ? 'flex' : 'none',
      backgroundColor: BROWSER_CONTENT_BACKGROUND,
      pointerEvents: active && interactive ? 'auto' : 'none'
    }),
    [active, interactive]
  )

  const attachWebview = useCallback(
    (element: Element | null) => {
      const webview = element as BrowserWebviewElement | null
      webviewRef.current = webview
      registerWebview(tab.localId, webview)
    },
    [registerWebview, tab.localId]
  )

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return undefined

    const handleTitle = (event: Event) => {
      const title = (event as Electron.PageTitleUpdatedEvent).title
      if (title) onTitleChange(tab.localId, title)
    }
    const handleNavigate = (event: Event) => {
      const url = (event as Electron.DidNavigateEvent).url
      if (url) onUrlChange(tab.localId, url)
    }
    const handleNavigateInPage = (event: Event) => {
      const navigation = event as Electron.DidNavigateInPageEvent
      if (navigation.isMainFrame !== false && navigation.url) onUrlChange(tab.localId, navigation.url)
    }

    webview.addEventListener('page-title-updated', handleTitle)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigateInPage)

    return () => {
      webview.removeEventListener('page-title-updated', handleTitle)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigateInPage)
    }
  }, [onTitleChange, onUrlChange, tab.localId])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return undefined

    const refreshRegistration = () => registerWebview(tab.localId, webview)
    const applyCurrentZoom = () => applyWebviewZoom(webview, zoomFactor)
    applyCurrentZoom()
    webview.addEventListener('dom-ready', applyCurrentZoom)
    webview.addEventListener('dom-ready', refreshRegistration)

    return () => {
      webview.removeEventListener('dom-ready', applyCurrentZoom)
      webview.removeEventListener('dom-ready', refreshRegistration)
    }
  }, [registerWebview, tab.localId, zoomFactor])

  return createElement('webview', {
    allowpopups: '',
    className: 'browser-webview',
    partition: partitionForTab(componentId, tab),
    ref: attachWebview,
    src: tab.url,
    style,
    webpreferences: WEBVIEW_PREFERENCES
  })
}

export function BrowserComponent({
  component,
  updateState,
  isCanvasInteracting = false,
  isNodeSelected = false
}: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const webviewsRef = useRef(new Map<string, BrowserWebviewElement>())
  const webviewContentsIdsRef = useRef(new Map<number, string>())
  const [address, setAddress] = useState('')
  const [snapshot, setSnapshot] = useState<string | null>(null)

  const tabs = useMemo(() => readTabs(component.state, t('browser.defaultTabTitle')), [component.state, t])
  const activeLocalId = asString(component.state.activeTabId, tabs[0]?.localId)
  const activeTab = tabs.find((tab) => tab.localId === activeLocalId) ?? tabs[0]
  const [loadedTabIds, setLoadedTabIds] = useState<Set<string>>(() => new Set(activeLocalId ? [activeLocalId] : []))

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

  const getActiveWebview = useCallback((): BrowserWebviewElement | null => {
    if (!activeTab) return null
    return webviewsRef.current.get(activeTab.localId) ?? null
  }, [activeTab])

  const registerWebview = useCallback((localId: string, webview: BrowserWebviewElement | null) => {
    for (const [contentsId, mappedLocalId] of webviewContentsIdsRef.current) {
      if (mappedLocalId === localId) webviewContentsIdsRef.current.delete(contentsId)
    }

    if (webview) {
      webviewsRef.current.set(localId, webview)
      const contentsId = readWebviewContentsId(webview)
      if (contentsId !== null) webviewContentsIdsRef.current.set(contentsId, localId)
    } else {
      webviewsRef.current.delete(localId)
    }
  }, [])

  const handleTitleChange = useCallback((localId: string, title: string) => patchTab(localId, { title }), [patchTab])
  const handleUrlChange = useCallback((localId: string, url: string) => patchTab(localId, { url }), [patchTab])

  const webviewLocalIdForContents = useCallback((sourceWebContentsId: number): string | null => {
    const mappedLocalId = webviewContentsIdsRef.current.get(sourceWebContentsId)
    if (mappedLocalId && webviewsRef.current.has(mappedLocalId)) return mappedLocalId

    for (const [localId, webview] of webviewsRef.current) {
      const contentsId = readWebviewContentsId(webview)
      if (contentsId !== null) {
        webviewContentsIdsRef.current.set(contentsId, localId)
        if (contentsId === sourceWebContentsId) return localId
      }
    }

    return null
  }, [])

  useEffect(() => {
    if (!component.state.tabs) {
      updateState({ tabs, activeTabId: activeLocalId }, true)
    }
  }, [activeLocalId, component.state.tabs, tabs, updateState])

  useEffect(() => {
    setLoadedTabIds((currentIds) => {
      const liveTabIds = new Set(tabs.map((tab) => tab.localId))
      const nextIds = new Set([...currentIds].filter((localId) => liveTabIds.has(localId)))
      if (activeLocalId) nextIds.add(activeLocalId)

      if (nextIds.size === currentIds.size && [...nextIds].every((localId) => currentIds.has(localId))) {
        return currentIds
      }

      return nextIds
    })
  }, [activeLocalId, tabs])

  useEffect(() => {
    const dispose = window.atlas.browser.onWebviewOpenTabRequested((request: BrowserWebviewOpenTabRequest) => {
      if (!webviewLocalIdForContents(request.sourceWebContentsId)) return

      const next = createBrowserTab(t('browser.newTab'), request.url)
      patchTabs([...tabs, next], next.localId)
    })

    return dispose
  }, [patchTabs, tabs, t, webviewLocalIdForContents])

  useEffect(() => {
    const dispose = window.atlas.browser.onWebviewZoomUpdated((update: BrowserWebviewZoomUpdated) => {
      const localId = webviewLocalIdForContents(update.sourceWebContentsId)
      const zoomFactor = normalizeZoomFactor(update.zoomFactor)
      if (!localId || zoomFactor === undefined) return

      patchTab(localId, { zoomFactor })
    })

    return dispose
  }, [patchTab, webviewLocalIdForContents])

  useEffect(() => {
    const subscribe = window.atlas.browser?.onWebviewCanvasZoomRequested
    if (typeof subscribe !== 'function') return undefined

    return subscribe((request) => {
      const localId = webviewLocalIdForContents(request.sourceWebContentsId)
      const webview = localId ? webviewsRef.current.get(localId) ?? null : null
      if (!webview) return

      const input = webviewCanvasZoomInputFromRequest(webview, request)
      if (!input) return

      dispatchBrowserWebviewCanvasZoom(input)
    })
  }, [webviewLocalIdForContents])

  useEffect(() => {
    setAddress(activeTab?.url ?? '')
  }, [activeTab?.url])

  useEffect(() => {
    if (isNodeSelected) setSnapshot(null)
  }, [isNodeSelected])

  const navigate = () => {
    if (!activeTab) return

    const url = normalizeUrl(address)
    const webview = getActiveWebview()
    if (activeTab.url === url) {
      try {
        webview?.reload()
      } catch {
        // Navigation commands can fail while the guest view is attaching; the state remains unchanged.
      }
      return
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
    webviewsRef.current.delete(localId)
    const nextTabs = tabs.filter((tab) => tab.localId !== localId)
    const fallbackTab = createBrowserTab(t('browser.newTab'))
    const finalTabs = nextTabs.length ? nextTabs : [fallbackTab]
    patchTabs(finalTabs, finalTabs[0].localId)
  }

  const captureActiveTab = async () => {
    const webview = getActiveWebview()
    if (!webview) return

    const image = await webview.capturePage()
    setSnapshot(image.toDataURL())
  }

  const commitZoomFactor = useCallback(
    (localId: string, value: number) => {
      if (!Number.isFinite(value)) return

      const zoomFactor = normalizeCommittedZoomFactor(value)
      const webview = webviewsRef.current.get(localId)
      if (webview) applyWebviewZoom(webview, zoomFactor)

      patchTab(localId, { zoomFactor })
    },
    [patchTab]
  )

  const activeBrowserAvailable = Boolean(activeTab)
  const activeZoomFactor = normalizeZoomFactor(activeTab?.zoomFactor) ?? BROWSER_ZOOM_DEFAULT_FACTOR
  const activeZoomPercent = formatZoomPercent(activeZoomFactor)
  const canResetZoom = Boolean(activeTab) && activeZoomFactor !== BROWSER_ZOOM_DEFAULT_FACTOR

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
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.back')} aria-label={t('browser.back')} onClick={() => getActiveWebview()?.goBack()}>
          <ArrowLeft size={15} />
        </button>
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.forward')} aria-label={t('browser.forward')} onClick={() => getActiveWebview()?.goForward()}>
          <ArrowRight size={15} />
        </button>
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.reload')} aria-label={t('browser.reload')} onClick={() => getActiveWebview()?.reload()}>
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
        <button className="icon-button" disabled={!activeBrowserAvailable} title={t('browser.devtools')} aria-label={t('browser.devtools')} onClick={() => getActiveWebview()?.openDevTools()}>
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
      <div className="browser-viewport">
        {tabs.filter((tab) => loadedTabIds.has(tab.localId)).map((tab) => (
          <BrowserWebview
            key={tab.localId}
            active={tab.localId === activeLocalId}
            componentId={component.id}
            interactive={isNodeSelected && !isCanvasInteracting}
            onTitleChange={handleTitleChange}
            onUrlChange={handleUrlChange}
            registerWebview={registerWebview}
            tab={tab}
            zoomFactor={normalizeZoomFactor(tab.zoomFactor) ?? BROWSER_ZOOM_DEFAULT_FACTOR}
          />
        ))}
        {snapshot ? <img className="browser-snapshot" src={snapshot} alt={t('browser.screenshotAlt')} onClick={() => setSnapshot(null)} /> : null}
      </div>
    </div>
  )
}
