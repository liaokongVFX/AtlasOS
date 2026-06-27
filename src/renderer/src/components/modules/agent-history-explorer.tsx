import { RefreshCw, RotateCcw, SearchX, TerminalSquare } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
const HISTORY_LIST_OVERSCAN = 8
const PROJECT_ROW_ESTIMATE = 58
const SESSION_ROW_ESTIMATE = 62
const TRANSCRIPT_ROW_ESTIMATE = 148

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

type VirtualHistoryListProps<T> = {
  ariaLabel?: string
  className: string
  empty?: ReactNode
  estimateSize: number
  getKey: (item: T, index: number) => string
  items: T[]
  renderItem: (item: T) => ReactNode
}

function VirtualHistoryList<T>({
  ariaLabel,
  className,
  empty,
  estimateSize,
  getKey,
  items,
  renderItem
}: VirtualHistoryListProps<T>): JSX.Element {
  const scrollElementRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getKey(items[index], index),
    getScrollElement: () => scrollElementRef.current,
    initialRect: { width: 1, height: estimateSize * 8 },
    overscan: HISTORY_LIST_OVERSCAN
  })
  const measuredVirtualItems = rowVirtualizer.getVirtualItems()
  const virtualItems =
    measuredVirtualItems.length > 0 || items.length === 0
      ? measuredVirtualItems
      : Array.from({ length: Math.min(items.length, HISTORY_LIST_OVERSCAN * 2) }, (_, index) => ({
          index,
          key: getKey(items[index], index),
          start: index * estimateSize
        }))
  const totalSize = rowVirtualizer.getTotalSize() || items.length * estimateSize

  return (
    <div ref={scrollElementRef} className={className} aria-label={ariaLabel}>
      {items.length === 0 ? empty : null}
      {items.length > 0 ? (
        <div className="claude-history-virtual-list" style={{ height: `${totalSize}px` }}>
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index]

            return (
              <div
                key={virtualItem.key}
                ref={rowVirtualizer.measureElement}
                className="claude-history-virtual-item"
                data-index={virtualItem.index}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {renderItem(item)}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function TranscriptEntry({ entry, labels }: { entry: AgentHistoryTranscriptEntry; labels: AgentHistoryLabels }): JSX.Element {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(false)
  const label = entry.role === 'assistant' ? labels.assistantName : entry.role === 'user' ? 'User' : t(labels.toolEventKey)

  return (
    <article className={`claude-history-message claude-history-message--${entry.role}`}>
      <header>
        <strong>{entry.title ?? label}</strong>
        <span>{formatTimestamp(entry.timestamp)}</span>
      </header>
      {entry.collapsed ? (
        <details onToggle={(event) => setIsExpanded(event.currentTarget.open)}>
          <summary>{entry.title ?? t(labels.toolEventKey)}</summary>
          {isExpanded ? <pre>{entry.text}</pre> : null}
        </details>
      ) : (
        <pre>{entry.text}</pre>
      )}
    </article>
  )
}

function TranscriptList({ labels, messages }: { labels: AgentHistoryLabels; messages: AgentHistoryTranscriptEntry[] }): JSX.Element {
  const renderMessage = useCallback((message: AgentHistoryTranscriptEntry) => <TranscriptEntry entry={message} labels={labels} />, [labels])

  return (
    <VirtualHistoryList
      className="claude-history-transcript"
      estimateSize={TRANSCRIPT_ROW_ESTIMATE}
      getKey={(message) => message.id}
      items={messages}
      renderItem={renderMessage}
    />
  )
}

function ChildSession({ child, labels }: { child: AgentHistoryChildSessionDetail; labels: AgentHistoryLabels }): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <details className="claude-history-child-session" onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>
        <span>{child.summary.title}</span>
        <small>{sessionDetailLine(child.summary)}</small>
      </summary>
      {isOpen ? <TranscriptList labels={labels} messages={child.messages} /> : null}
    </details>
  )
}

function AgentHistoryExplorerBase({
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
    () => history?.sessions.filter((session) => session.projectId === selectedProject?.id && !session.isSidechain) ?? [],
    [history, selectedProject?.id]
  )
  const projectListLabel = t(labels.projectListKey)
  const sessionsLabel = t(labels.sessionsKey)

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

  const renderProject = useCallback(
    (project: AgentHistoryProjectSummary) => (
      <button
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
    ),
    [selectedProject?.id]
  )

  const renderSession = useCallback(
    (session: AgentHistorySessionSummary) => (
      <button
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
    ),
    [labels.metadataOnlyKey, selectedSessionId, t]
  )

  return (
    <div className="claude-history-module">
      <aside className="claude-history-projects" aria-label={projectListLabel}>
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

        <VirtualHistoryList
          className="claude-history-project-list"
          empty={
            history && history.projects.length === 0 ? (
            <div className="claude-history-empty">
              <SearchX size={18} />
              <span>{t(labels.emptyKey)}</span>
            </div>
            ) : null
          }
          estimateSize={PROJECT_ROW_ESTIMATE}
          getKey={(project) => project.id}
          items={history?.projects ?? []}
          renderItem={renderProject}
        />
      </aside>

      <section className="claude-history-main">
        <div className="claude-history-session-list">
          <header>
            <div>
              <strong>{selectedProject?.name ?? sessionsLabel}</strong>
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

          <VirtualHistoryList
            ariaLabel={sessionsLabel}
            className="claude-history-sessions"
            empty={sessions.length === 0 && !isLoading ? <div className="claude-history-empty">{t(labels.noProjectSessionsKey)}</div> : null}
            estimateSize={SESSION_ROW_ESTIMATE}
            getKey={(session) => session.sessionId}
            items={sessions}
            renderItem={renderSession}
          />
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

function areAgentHistoryExplorerPropsEqual(previous: AgentHistoryExplorerProps, next: AgentHistoryExplorerProps): boolean {
  return (
    previous.api === next.api &&
    previous.agentSource === next.agentSource &&
    previous.canvasId === next.canvasId &&
    previous.component === next.component &&
    previous.labels === next.labels &&
    previous.resumeCommand === next.resumeCommand &&
    previous.setHeaderActions === next.setHeaderActions &&
    previous.setTitle === next.setTitle &&
    previous.terminalTitlePrefix === next.terminalTitlePrefix &&
    previous.updateConfig === next.updateConfig &&
    previous.updateFrame === next.updateFrame &&
    previous.updateState === next.updateState
  )
}

export const AgentHistoryExplorer = memo(AgentHistoryExplorerBase, areAgentHistoryExplorerPropsEqual)
