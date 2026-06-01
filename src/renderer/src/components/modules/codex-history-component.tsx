import { useCallback, useMemo } from 'react'
import type { AgentHistoryListResult, AgentHistorySessionDetail, AgentHistorySessionSummary } from '@shared/agent-history'
import type { AtlasComponentRendererProps } from '../registry'
import { AgentHistoryExplorer } from './agent-history-explorer'

const labels = {
  titleKey: 'component.codexHistory',
  detailFailedKey: 'codexHistory.failedLoad',
  emptyKey: 'codexHistory.empty',
  metadataOnlyKey: 'codexHistory.metadataOnly',
  noProjectSessionsKey: 'codexHistory.noProjectSessions',
  noTranscriptKey: 'codexHistory.noTranscript',
  openProjectTerminalKey: 'codexHistory.openProjectTerminal',
  projectListKey: 'codexHistory.projectList',
  refreshKey: 'codexHistory.refresh',
  resumeKey: 'codexHistory.resume',
  sessionsKey: 'codexHistory.sessions',
  toolEventKey: 'codexHistory.toolEvent',
  childSessionsKey: 'codexHistory.childSessions',
  assistantName: 'Codex'
} as const

export function CodexHistoryComponent(props: AtlasComponentRendererProps): JSX.Element {
  const api = useMemo(
    () => ({
      list: () => window.atlas.codexHistory.list() as Promise<AgentHistoryListResult>,
      getSession: (input: { sessionId: string }) => window.atlas.codexHistory.getSession(input) as Promise<AgentHistorySessionDetail>
    }),
    []
  )
  const resumeCommand = useCallback((session: AgentHistorySessionSummary) => `codex resume ${session.sessionId}`, [])

  return <AgentHistoryExplorer {...props} api={api} labels={labels} terminalTitlePrefix="Codex" resumeCommand={resumeCommand} />
}
