import { useCallback, useMemo } from 'react'
import type { AgentHistoryListResult, AgentHistorySessionDetail, AgentHistorySessionSummary } from '@shared/agent-history'
import type { AtlasComponentRendererProps } from '../registry'
import { AgentHistoryExplorer } from './agent-history-explorer'

const labels = {
  titleKey: 'component.claudeHistory',
  detailFailedKey: 'claudeHistory.failedLoad',
  emptyKey: 'claudeHistory.empty',
  metadataOnlyKey: 'claudeHistory.metadataOnly',
  noProjectSessionsKey: 'claudeHistory.noProjectSessions',
  noTranscriptKey: 'claudeHistory.noTranscript',
  openProjectTerminalKey: 'claudeHistory.openProjectTerminal',
  projectListKey: 'claudeHistory.projectList',
  refreshKey: 'claudeHistory.refresh',
  resumeKey: 'claudeHistory.resume',
  sessionsKey: 'claudeHistory.sessions',
  toolEventKey: 'claudeHistory.toolEvent',
  childSessionsKey: 'claudeHistory.childSessions',
  assistantName: 'Claude'
} as const

export function ClaudeHistoryComponent(props: AtlasComponentRendererProps): JSX.Element {
  const api = useMemo(
    () => ({
      list: () => window.atlas.claudeHistory.list() as Promise<AgentHistoryListResult>,
      getSession: (input: { sessionId: string }) => window.atlas.claudeHistory.getSession(input) as Promise<AgentHistorySessionDetail>
    }),
    []
  )
  const resumeCommand = useCallback((session: AgentHistorySessionSummary) => `claude --resume ${session.sessionId}`, [])

  return (
    <AgentHistoryExplorer
      {...props}
      api={api}
      agentSource="claude"
      labels={labels}
      terminalTitlePrefix="Claude"
      resumeCommand={resumeCommand}
    />
  )
}
