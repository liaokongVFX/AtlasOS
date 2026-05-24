import { nanoid } from 'nanoid'
import { ArrowLeft, ArrowRight, Bug, Camera, Plus, RefreshCw, X } from 'lucide-react'
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { asString, normalizeUrl } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type BrowserTabState = {
  localId: string
  title: string
  url: string
  partition?: string
}

type BrowserWebviewOpenTabRequest = {
  sourceWebContentsId: number
  url: string
}

type BrowserWebviewElement = Electron.WebviewTag

const DEFAULT_BROWSER_URL = 'https://example.com'
const WEBVIEW_PREFERENCES = 'contextIsolation=yes,sandbox=yes'

function readTabs(state: Record<string, unknown>): BrowserTabState[] {
  const tabs = state.tabs
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return [{ localId: nanoid(), title: 'Example', url: DEFAULT_BROWSER_URL }]
  }

  return tabs
    .map((tab) => tab as Partial<BrowserTabState>)
    .filter((tab): tab is BrowserTabState => Boolean(tab.localId && tab.url))
}

function createBrowserTab(url = DEFAULT_BROWSER_URL): BrowserTabState {
  return { localId: nanoid(), title: 'New tab', url }
}

function partitionForTab(componentId: string, tab: BrowserTabState): string {
  return tab.partition ?? `persist:atlas-browser-${componentId}-${tab.localId}`
}

type BrowserWebviewProps = {
  active: boolean
  componentId: string
  interactive: boolean
  onTitleChange: (localId: string, title: string) => void
  onUrlChange: (localId: string, url: string) => void
  registerWebview: (localId: string, webview: BrowserWebviewElement | null) => void
  tab: BrowserTabState
}

function BrowserWebview({
  active,
  componentId,
  interactive,
  onTitleChange,
  onUrlChange,
  registerWebview,
  tab
}: BrowserWebviewProps): JSX.Element {
  const webviewRef = useRef<BrowserWebviewElement | null>(null)
  const style = useMemo<CSSProperties>(
    () => ({
      display: active ? 'flex' : 'none',
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
  const webviewsRef = useRef(new Map<string, BrowserWebviewElement>())
  const [address, setAddress] = useState('')
  const [snapshot, setSnapshot] = useState<string | null>(null)

  const tabs = useMemo(() => readTabs(component.state), [component.state])
  const activeLocalId = asString(component.state.activeTabId, tabs[0]?.localId)
  const activeTab = tabs.find((tab) => tab.localId === activeLocalId) ?? tabs[0]
  const [loadedTabIds, setLoadedTabIds] = useState<Set<string>>(() => new Set(activeLocalId ? [activeLocalId] : []))

  const patchTabs = useCallback(
    (nextTabs: BrowserTabState[], nextActiveId = activeLocalId) => {
      updateState({ tabs: nextTabs, activeTabId: nextActiveId }, true)
    },
    [activeLocalId, updateState]
  )

  const getActiveWebview = useCallback((): BrowserWebviewElement | null => {
    if (!activeTab) return null
    return webviewsRef.current.get(activeTab.localId) ?? null
  }, [activeTab])

  const registerWebview = useCallback((localId: string, webview: BrowserWebviewElement | null) => {
    if (webview) {
      webviewsRef.current.set(localId, webview)
    } else {
      webviewsRef.current.delete(localId)
    }
  }, [])

  const patchTab = useCallback(
    (localId: string, patch: Partial<Pick<BrowserTabState, 'title' | 'url'>>) => {
      let didChange = false
      const nextTabs = tabs.map((tab) => {
        if (tab.localId !== localId) return tab
        const nextTab = {
          ...tab,
          title: asString(patch.title, tab.title),
          url: asString(patch.url, tab.url)
        }
        didChange = nextTab.title !== tab.title || nextTab.url !== tab.url
        return didChange ? nextTab : tab
      })

      if (didChange) updateState({ tabs: nextTabs }, false)
    },
    [tabs, updateState]
  )

  const handleTitleChange = useCallback((localId: string, title: string) => patchTab(localId, { title }), [patchTab])
  const handleUrlChange = useCallback((localId: string, url: string) => patchTab(localId, { url }), [patchTab])

  const webviewLocalIdForContents = useCallback((sourceWebContentsId: number): string | null => {
    for (const [localId, webview] of webviewsRef.current) {
      if (typeof webview.getWebContentsId !== 'function') continue

      try {
        if (webview.getWebContentsId() === sourceWebContentsId) return localId
      } catch {
        continue
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

      const next = createBrowserTab(request.url)
      patchTabs([...tabs, next], next.localId)
    })

    return dispose
  }, [patchTabs, tabs, webviewLocalIdForContents])

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
      void webview?.loadURL(url).catch(() => undefined)
      return
    }

    patchTabs(
      tabs.map((tab) => (tab.localId === activeTab.localId ? { ...tab, url } : tab)),
      activeTab.localId
    )
  }

  const addTab = () => {
    const next = createBrowserTab()
    patchTabs([...tabs, next], next.localId)
  }

  const closeTab = (localId: string) => {
    webviewsRef.current.delete(localId)
    const nextTabs = tabs.filter((tab) => tab.localId !== localId)
    const fallbackTab = createBrowserTab()
    const finalTabs = nextTabs.length ? nextTabs : [fallbackTab]
    patchTabs(finalTabs, finalTabs[0].localId)
  }

  const captureActiveTab = async () => {
    const webview = getActiveWebview()
    if (!webview) return

    const image = await webview.capturePage()
    setSnapshot(image.toDataURL())
  }

  const activeWebviewAvailable = Boolean(activeTab)

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
        <button className="icon-button" onClick={addTab} title="New browser tab">
          <Plus size={14} />
        </button>
      </div>
      <div className="browser-toolbar">
        <button className="icon-button" disabled={!activeWebviewAvailable} onClick={() => getActiveWebview()?.goBack()}>
          <ArrowLeft size={15} />
        </button>
        <button className="icon-button" disabled={!activeWebviewAvailable} onClick={() => getActiveWebview()?.goForward()}>
          <ArrowRight size={15} />
        </button>
        <button className="icon-button" disabled={!activeWebviewAvailable} onClick={() => getActiveWebview()?.reload()}>
          <RefreshCw size={15} />
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            navigate()
          }}
        >
          <input value={address} onChange={(event) => setAddress(event.target.value)} />
        </form>
        <button className="icon-button" disabled={!activeWebviewAvailable} onClick={() => getActiveWebview()?.openDevTools()}>
          <Bug size={15} />
        </button>
        <button className="icon-button" disabled={!activeWebviewAvailable} onClick={() => void captureActiveTab()}>
          <Camera size={15} />
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
          />
        ))}
        {snapshot ? <img className="browser-snapshot" src={snapshot} alt="Browser screenshot" onClick={() => setSnapshot(null)} /> : null}
      </div>
    </div>
  )
}
