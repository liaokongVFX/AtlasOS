export type QuickInputPanelSnippet = {
  id: string
  name: string
  text: string
  shortcut: string | null
}

export type QuickInputPanelState = {
  requestId: number
  snippets: QuickInputPanelSnippet[]
  selectedId: string | null
  failure: 'unavailable' | 'unknown' | null
}
