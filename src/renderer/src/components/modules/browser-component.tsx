import { nanoid } from 'nanoid'
import { ArrowLeft, ArrowRight, Bug, Camera, Plus, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { asString, normalizeUrl } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type BrowserTabState = {
  localId: string
  title: string
  url: string
  partition?: string
}

function readTabs(state: Record<string, unknown>): BrowserTabState[] {
  const tabs = state.tabs
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return [{ localId: nanoid(), title: 'Example', url: 'https://example.com' }]
  }

  return tabs
    .map((tab) => tab as Partial<BrowserTabState>)
    .filter((tab): tab is BrowserTabState => Boolean(tab.localId && tab.url))
}

export function BrowserComponent({ component, updateState }: AtlasComponentRendererProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const runtimeTabsRef = useRef(new Map<string, string>())
  const [address, setAddress] = useState('')
  const [snapshot, setSnapshot] = useState<string | null>(null)

  const tabs = useMemo(() => readTabs(component.state), [component.state])
  const activeLocalId = asString(component.state.activeTabId, tabs[0]?.localId)
  const activeTab = tabs.find((tab) => tab.localId === activeLocalId) ?? tabs[0]

  const patchTabs = useCallback(
    (nextTabs: BrowserTabState[], nextActiveId = activeLocalId) => {
      updateState({ tabs: nextTabs, activeTabId: nextActiveId }, true)
    },
    [activeLocalId, updateState]
  )

  useEffect(() => {
    if (!component.state.tabs) {
      updateState({ tabs, activeTabId: activeLocalId }, true)
    }
  }, [activeLocalId, component.state.tabs, tabs, updateState])

  useEffect(() => {
    let cancelled = false

    async function ensureTabs() {
      for (const tab of tabs) {
        if (runtimeTabsRef.current.has(tab.localId)) continue
        const runtime = (await window.atlas.browser.createTab({
          componentId: component.id,
          url: tab.url,
          partition: tab.partition
        })) as { tabId: string; partition: string; url: string }
        if (cancelled) {
          await window.atlas.browser.closeTab(runtime.tabId)
          return
        }
        runtimeTabsRef.current.set(tab.localId, runtime.tabId)
      }
    }

    void ensureTabs()

    return () => {
      cancelled = true
    }
  }, [component.id, tabs])

  useEffect(() => {
    const dispose = window.atlas.browser.onTabUpdated(({ tabId, patch }) => {
      const localId = [...runtimeTabsRef.current.entries()].find(([, runtimeId]) => runtimeId === tabId)?.[0]
      if (!localId) return

      const nextTabs = tabs.map((tab) =>
        tab.localId === localId
          ? {
              ...tab,
              title: asString(patch.title, tab.title),
              url: asString(patch.url, tab.url)
            }
          : tab
      )
      updateState({ tabs: nextTabs }, false)
    })

    return dispose
  }, [tabs, updateState])

  useEffect(() => {
    setAddress(activeTab?.url ?? '')
  }, [activeTab?.url])

  useEffect(() => {
    const syncBounds = () => {
      for (const runtimeId of runtimeTabsRef.current.values()) {
        void window.atlas.browser.setBounds({
          tabId: runtimeId,
          visible: false,
          bounds: { x: 0, y: 0, width: 0, height: 0 }
        })
      }

      const runtimeId = activeTab ? runtimeTabsRef.current.get(activeTab.localId) : null
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!runtimeId || !rect) return

      void window.atlas.browser.setBounds({
        tabId: runtimeId,
        visible: rect.width > 20 && rect.height > 20,
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      })
    }

    syncBounds()
    const observer = new ResizeObserver(syncBounds)
    if (viewportRef.current) observer.observe(viewportRef.current)
    window.addEventListener('resize', syncBounds)
    window.addEventListener('scroll', syncBounds, true)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
      window.removeEventListener('scroll', syncBounds, true)
    }
  }, [activeTab, component.frame.height, component.frame.width, component.frame.x, component.frame.y])

  useEffect(() => {
    return () => {
      for (const runtimeId of runtimeTabsRef.current.values()) {
        void window.atlas.browser.closeTab(runtimeId)
      }
      runtimeTabsRef.current.clear()
    }
  }, [])

  const navigate = async () => {
    if (!activeTab) return
    const url = normalizeUrl(address)
    const runtimeId = runtimeTabsRef.current.get(activeTab.localId)
    if (runtimeId) await window.atlas.browser.navigate(runtimeId, url)
    patchTabs(
      tabs.map((tab) => (tab.localId === activeTab.localId ? { ...tab, url } : tab)),
      activeTab.localId
    )
  }

  const addTab = () => {
    const next = { localId: nanoid(), title: 'New tab', url: 'https://example.com' }
    patchTabs([...tabs, next], next.localId)
  }

  const closeTab = async (localId: string) => {
    const runtimeId = runtimeTabsRef.current.get(localId)
    if (runtimeId) await window.atlas.browser.closeTab(runtimeId)
    runtimeTabsRef.current.delete(localId)
    const nextTabs = tabs.filter((tab) => tab.localId !== localId)
    const fallbackTab = { localId: nanoid(), title: 'Example', url: 'https://example.com' }
    const finalTabs = nextTabs.length ? nextTabs : [fallbackTab]
    patchTabs(finalTabs, finalTabs[0].localId)
  }

  const activeRuntimeId = activeTab ? runtimeTabsRef.current.get(activeTab.localId) : null

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
                void closeTab(tab.localId)
              }}
            />
          </button>
        ))}
        <button className="icon-button" onClick={addTab} title="New browser tab">
          <Plus size={14} />
        </button>
      </div>
      <div className="browser-toolbar">
        <button className="icon-button" disabled={!activeRuntimeId} onClick={() => activeRuntimeId && window.atlas.browser.back(activeRuntimeId)}>
          <ArrowLeft size={15} />
        </button>
        <button className="icon-button" disabled={!activeRuntimeId} onClick={() => activeRuntimeId && window.atlas.browser.forward(activeRuntimeId)}>
          <ArrowRight size={15} />
        </button>
        <button className="icon-button" disabled={!activeRuntimeId} onClick={() => activeRuntimeId && window.atlas.browser.reload(activeRuntimeId)}>
          <RefreshCw size={15} />
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void navigate()
          }}
        >
          <input value={address} onChange={(event) => setAddress(event.target.value)} />
        </form>
        <button className="icon-button" disabled={!activeRuntimeId} onClick={() => activeRuntimeId && window.atlas.browser.devtools(activeRuntimeId)}>
          <Bug size={15} />
        </button>
        <button
          className="icon-button"
          disabled={!activeRuntimeId}
          onClick={async () => activeRuntimeId && setSnapshot(await window.atlas.browser.capture(activeRuntimeId))}
        >
          <Camera size={15} />
        </button>
      </div>
      <div ref={viewportRef} className="browser-viewport">
        {snapshot ? <img className="browser-snapshot" src={snapshot} alt="Browser screenshot" onClick={() => setSnapshot(null)} /> : null}
      </div>
    </div>
  )
}
