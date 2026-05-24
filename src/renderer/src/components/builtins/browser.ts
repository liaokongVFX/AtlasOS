import { Globe2 } from 'lucide-react'
import type { CanvasComponent } from '@shared/schema'
import { BrowserComponent } from '../modules/browser-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta, optionalString } from './shared'

const NODE_FINDER_DEFAULT_BROWSER_URL = 'https://example.com'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function browserFinderTabs(component: CanvasComponent): Array<{ localId: string; url: string }> {
  const tabs = component.state.tabs
  if (!Array.isArray(tabs)) return []

  return tabs
    .filter(isRecord)
    .map((tab) => ({
      localId: optionalString(tab.localId) ?? '',
      url: optionalString(tab.url) ?? ''
    }))
    .filter((tab) => tab.localId && tab.url)
}

function browserFinderUrl(component: CanvasComponent): string {
  const tabs = browserFinderTabs(component)
  if (tabs.length === 0) return NODE_FINDER_DEFAULT_BROWSER_URL

  const activeTabId = optionalString(component.state.activeTabId)
  return tabs.find((tab) => tab.localId === activeTabId)?.url ?? tabs[0].url
}

export function createBrowserDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('browser'),
    icon: Globe2,
    Renderer: BrowserComponent,
    duplicate: () => ({ state: {} }),
    getDetail: browserFinderUrl
  }
}
