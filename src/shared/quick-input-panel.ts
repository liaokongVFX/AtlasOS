import type { QuickInputSnippet } from './schema'

export type QuickInputPanelState = {
  requestId: number
  snippets: QuickInputSnippet[]
  selectedId: string | null
  failure: 'unavailable' | 'unknown' | null
}
