import { RefreshCw, RotateCcw, SearchX, TerminalSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentHistoryChildSessionDetail,
  AgentHistoryListResult,
  AgentHistoryProjectSummary,
  AgentHistorySessionDetail,
  AgentHistorySessionSummary,
  AgentHistoryTranscriptEntry
} from '@shared/agent-history'
import { createTerminalAgentRestore, type TerminalAgentSource } from '@shared/terminal-agent'
import { useI18n, type I18nKey } from '../../i18n'
import { useCanvasStore } from '../../store/canvas-store'
import type { AtlasComponentRendererProps } from '../registry'

type AgentHistoryApi = {
  list: () => Promise<AgentHistoryListResult>
  getSession: (input: { sessionId: string }) => Promise<AgentHistorySessionDetail>
}

type AgentHistoryLabels = {
  titleKey: I18nKey
  detailFailedKey: I18nKey
  emptyKey: I18nKey
  metadataOnlyKey: I18nKey
  noProjectSessionsKey: I18nKey
  noTranscriptKey: I18nKey
  openProjectTerminalKey: I18nKey
  projectListKey: I18nKey
  refreshKey: I18nKey
  resumeKey: I18nKey
  sessionsKey: I18nKey
  toolEventKey: I18nKey
  childSessionsKey: I18nKey
  assistantName: string
}

type AgentHistoryExplorerProps = AtlasComponentRendererProps & {
  api: AgentHistoryApi
  agentSource: TerminalAgentSource
  labels: AgentHistoryLabels
  terminalTitlePrefix: string
  resumeCommand: (session: AgentHistorySessionSummary) => string
}

const TERMINAL_OFFSET = 24

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return '--'

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function sessionDetailLine(session: AgentHistorySessionSummary): string {
  return [formatTimestamp(session.updatedAt), session.cwd ?? session.projectPath].filter(Boolean).join(' - ')
}

function terminalPlacement(component: AtlasComponentRendererProps['component']): { x: number; y: number } {
  return {
    x: component.frame.x + component.frame.width + TERMINAL_OFFSET,
    y: component.frame.y
  }
}

function TranscriptEntry({ entry, labels }: { entry: AgentHistoryTranscriptEntry; labels: AgentHistoryLabels }): JSX.Element {
  const { t } = useI18n()
  const label = entry.role === 'assistant' ? labels.assistantName : entry.role === 'user' ? 'User' : t(labels.toolEventKey)

  return (
    <article className={`claude-history-message claude-history-message--${entry.role}`}>
      <header>
        <strong>{entry.title ?? label}</strong>
        <span>{formatTimestamp(entry.timestamp)}</span>
      </header>
      {entry.collapsed ? (
        <details>
          <summary>{entry.title ?? t(labels.toolEventKey)}</summary>
          <pre>{entry.text}</pre>
        </details>
      ) : (
        <pre>{entry.text}</pre>
      )}
    </article>
  )
}

function TranscriptList({ labels, messages }: { labels: AgentHistoryLabels; messages: AgentHistoryTranscriptEntry[] }): JSX.Element {
  return (
    <div className="claude-history-transcript">
      {messages.map((message) => (
        <TranscriptEntry key={message.id} entry={message} labels={labels} />
      ))}
    </div>
  )
}

function ChildSession({ child, labels }: { child: AgentHistoryChildSessionDetail; labels: AgentHistoryLabels }): JSX.Element {
  return (
    <details className="claude-history-child-session">
      <summary>
        <span>{child.summary.title}</span>
        <small>{sessionDetailLine(child.summary)}</small>
      </summary>
      <TranscriptList labels={labels} messages={child.messages} />
    </details>
  )
}

export function AgentHistoryExplorer({
  api,
  agentSource,
  component,
  labels,
  resumeCommand,
  terminalTitlePrefix
}: AgentHistoryExplorerProps): JSX.Element {
  const { t } = useI18n()
  const addComponent = useCanvasStore((state) => state.addComponent)
  const [history, setHistory] = useState<AgentHistoryListResult | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentHistorySessionDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setIsLoading(true)
    try {
      const nextHistory = await api.list()
      setHistory(nextHistory)
      setError(null)
      setSelectedProjectId((current) => (current && nextHistory.projects.some((project) => project.id === current) ? current : nextHistory.projects[0]?.id ?? null))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [api])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const selectedProject = useMemo(
    () => history?.projects.find((project) => project.id === selectedProjectId) ?? history?.projects[0] ?? null,
    [history, selectedProjectId]
  )
  const sessions = useMemo(
    () => history?.sessions.filter((session) => session.projectId === selectedProject?.id) ?? [],
    [history, selectedProject?.id]
  )

  useEffect(() => {
    setSelectedSessionId((current) => (current && sessions.some((session) => session.sessionId === current) ? current : sessions[0]?.sessionId ?? null))
  }, [sessions])

  useEffect(() => {
    if (!selectedSessionId) {
      setDetail(null)
      return undefined
    }

    let disposed = false
    setIsDetailLoading(true)
    void api
      .getSession({ sessionId: selectedSessionId })
      .then((nextDetail) => {
        if (disposed) return
        setDetail(nextDetail)
        setError(null)
      })
      .catch((detailError) => {
        if (disposed) return
        setDetail(null)
        setError(detailError instanceof Error ? detailError.message : String(detailError))
      })
      .finally(() => {
        if (!disposed) setIsDetailLoading(false)
      })

    return () => {
      disposed = true
    }
  }, [api, selectedSessionId])

  const openProjectTerminal = useCallback(
    (project: AgentHistoryProjectSummary) => {
      addComponent('terminal', terminalPlacement(component), {
        title: project.name,
        config: { cwd: project.path },
        state: { cwd: project.path }
      })
    },
    [addComponent, component]
  )

  const resumeSession = useCallback(
    (session: AgentHistorySessionSummary) => {
      const cwd = session.cwd ?? session.projectPath
      const command = resumeCommand(session)
      addComponent('terminal', terminalPlacement(component), {
        title: `${terminalTitlePrefix}: ${session.title}`,
        config: {
          cwd,
          initialCommand: command
        },
        state: {
          cwd,
          agentRestore: createTerminalAgentRestore(command, cwd) ?? {
            source: agentSource,
            sessionId: session.sessionId,
            command,
            cwd
          }
        }
      })
    },
    [addComponent, agentSource, component, resumeCommand, terminalTitlePrefix]
  )

  return (
    <div className="claude-history-module">
      <aside className="claude-history-projects" aria-label={t(labels.projectListKey)}>
        <header>
          <div>
            <strong>{t(labels.titleKey)}</strong>
            <span>{isLoading ? t('systemMonitor.loading') : `${history?.projects.length ?? 0}`}</span>
          </div>
          <button type="button" className="icon-button" onClick={() => void loadHistory()} title={t(labels.refreshKey)} aria-label={t(labels.refreshKey)}>
            <RefreshCw size={15} />
          </button>
        </header>

        {error ? <div className="module-error">{t(labels.detailFailedKey, { message: error })}</div> : null}

        <div className="claude-history-project-list">
          {history && history.projects.length === 0 ? (
            <div className="claude-history-empty">
              <SearchX size={18} />
              <span>{t(labels.emptyKey)}</span>
            </div>
          ) : null}
          {history?.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={project.id === selectedProject?.id ? 'claude-history-project claude-history-project--active' : 'claude-history-project'}
              onClick={() => setSelectedProjectId(project.id)}
            >
              <span>
                <strong>{project.name}</strong>
                <small>{project.path}</small>
              </span>
              <span className="claude-history-project__meta">{project.sessionCount}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="claude-history-main">
        <div className="claude-history-session-list" aria-label={t(labels.sessionsKey)}>
          <header>
            <div>
              <strong>{selectedProject?.name ?? t(labels.sessionsKey)}</strong>
              <span>{selectedProject?.path}</span>
            </div>
            {selectedProject ? (
              <button
                type="button"
                className="icon-button"
                onClick={() => openProjectTerminal(selectedProject)}
                title={t(labels.openProjectTerminalKey)}
                aria-label={t(labels.openProjectTerminalKey)}
              >
                <TerminalSquare size={15} />
              </button>
            ) : null}
          </header>

          <div className="claude-history-sessions">
            {sessions.length === 0 && !isLoading ? <div className="claude-history-empty">{t(labels.noProjectSessionsKey)}</div> : null}
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                type="button"
                className={session.sessionId === selectedSessionId ? 'claude-history-session claude-history-session--active' : 'claude-history-session'}
                onClick={() => setSelectedSessionId(session.sessionId)}
              >
                <span>
                  <strong>{session.title}</strong>
                  <small>{sessionDetailLine(session)}</small>
                </span>
                <span className="claude-history-session__badges">
                  {session.metadataOnly ? <em>{t(labels.metadataOnlyKey)}</em> : null}
                  {session.childCount > 0 ? <em>{session.childCount}</em> : null}
                </span>
              </button>
            ))}
          </div>
        </div>

        <article className="claude-history-detail">
          {isDetailLoading ? <div className="claude-history-empty">{t('systemMonitor.loading')}</div> : null}
          {!isDetailLoading && detail ? (
            <>
              <header className="claude-history-detail__header">
                <div>
                  <strong>{detail.summary.title}</strong>
                  <span>{sessionDetailLine(detail.summary)}</span>
                </div>
                <button type="button" className="tool-button" onClick={() => resumeSession(detail.summary)}>
                  <RotateCcw size={14} />
                  <span>{t(labels.resumeKey)}</span>
                </button>
              </header>

              {detail.summary.metadataOnly ? (
                <div className="claude-history-metadata-only">
                  <strong>{t(labels.metadataOnlyKey)}</strong>
                  <span>{t(labels.noTranscriptKey)}</span>
                  {detail.summary.summary ? <p>{detail.summary.summary}</p> : null}
                  {detail.summary.firstPrompt ? <p>{detail.summary.firstPrompt}</p> : null}
                </div>
              ) : (
                <TranscriptList labels={labels} messages={detail.messages} />
              )}

              {detail.childSessions.length > 0 ? (
                <section className="claude-history-children">
                  <h3>{t(labels.childSessionsKey)}</h3>
                  {detail.childSessions.map((child) => (
                    <ChildSession key={child.summary.id} child={child} labels={labels} />
                  ))}
                </section>
              ) : null}
            </>
          ) : null}
        </article>
      </section>
    </div>
  )
}
