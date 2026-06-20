import { CalendarDays, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { AgentUsageDayBucket, AgentUsageDayDetail, AgentUsageSessionDetail, AgentUsageYearResult } from '@shared/agent-usage'
import { useI18n, type Locale } from '../../i18n'
import { cn } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type HeatmapCell = {
  day: string
  date: Date
  bucket: AgentUsageDayBucket | null
  outsideYear: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const EMPTY_TOTALS = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  messageCount: 0,
  toolCallCount: 0,
  sessionCount: 0,
  claudeSessionCount: 0,
  codexSessionCount: 0
}

function formatLocalDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function todayDay(): string {
  return formatLocalDay(new Date())
}

function dayToDate(day: string): Date {
  const [year, month, date] = day.split('-').map((part) => Number.parseInt(part, 10))
  return new Date(year, month - 1, date)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(date.getDate() + days)
  return next
}

function heatmapCells(year: number, buckets: AgentUsageDayBucket[]): HeatmapCell[] {
  const byDay = new Map(buckets.map((bucket) => [bucket.day, bucket]))
  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year, 11, 31)
  const gridStart = addDays(yearStart, -yearStart.getDay())
  const gridEnd = addDays(yearEnd, 6 - yearEnd.getDay())
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / DAY_MS) + 1

  return Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(gridStart, index)
    const day = formatLocalDay(date)
    return {
      day,
      date,
      bucket: byDay.get(day) ?? null,
      outsideYear: date.getFullYear() !== year
    }
  })
}

function tokenFormat(locale: Locale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
}

function integerFormat(locale: Locale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
}

function formatDate(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(dayToDate(day))
}

function formatDateTime(iso: string | null, locale: Locale): string {
  if (!iso) return '--'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function monthLabels(year: number, cells: HeatmapCell[], locale: Locale): Array<{ label: string; column: number }> {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short' })
  const labels: Array<{ label: string; column: number }> = []
  let previousMonth = -1

  cells.forEach((cell, index) => {
    if (cell.outsideYear) return
    const month = cell.date.getMonth()
    if (month === previousMonth) return
    previousMonth = month
    labels.push({
      label: formatter.format(new Date(year, month, 1)),
      column: Math.floor(index / 7) + 1
    })
  })

  return labels
}

function intensity(bucket: AgentUsageDayBucket | null, maxTokens: number): number {
  if (!bucket || bucket.totalTokens <= 0 || maxTokens <= 0) return 0
  const ratio = bucket.totalTokens / maxTokens
  if (ratio >= 0.72) return 4
  if (ratio >= 0.36) return 3
  if (ratio >= 0.14) return 2
  return 1
}

function providerLabel(provider: AgentUsageSessionDetail['provider']): string {
  return provider === 'claude' ? 'Claude' : 'Codex'
}

export function AgentUsageCalendarComponent({ setHeaderActions }: AtlasComponentRendererProps): JSX.Element {
  const { locale, t } = useI18n()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [selectedDay, setSelectedDay] = useState(() => todayDay())
  const [yearResult, setYearResult] = useState<AgentUsageYearResult | null>(null)
  const [dayDetail, setDayDetail] = useState<AgentUsageDayDetail | null>(null)
  const [loadingYear, setLoadingYear] = useState(true)
  const [loadingDay, setLoadingDay] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [generatingDay, setGeneratingDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const yearRef = useRef(year)
  const selectedDayRef = useRef(selectedDay)
  const compactTokens = useMemo(() => tokenFormat(locale), [locale])
  const integers = useMemo(() => integerFormat(locale), [locale])

  useEffect(() => {
    yearRef.current = year
  }, [year])

  useEffect(() => {
    selectedDayRef.current = selectedDay
  }, [selectedDay])

  const loadYear = useCallback(async (targetYear: number): Promise<AgentUsageYearResult> => {
    const result = await window.atlas.agentUsage.getYear(targetYear)
    if (yearRef.current === targetYear) setYearResult(result)
    return result
  }, [])

  const loadDay = useCallback(async (day: string): Promise<AgentUsageDayDetail> => {
    const result = await window.atlas.agentUsage.getDay(day)
    if (selectedDayRef.current === result.day) setDayDetail(result)
    return result
  }, [])

  useEffect(() => {
    let disposed = false
    setLoadingYear(true)
    setLoadingDay(true)
    setError(null)

    Promise.all([loadYear(year), loadDay(selectedDay)])
      .catch((nextError) => {
        if (!disposed) setError(nextError instanceof Error ? nextError.message : String(nextError))
      })
      .finally(() => {
        if (!disposed) {
          setLoadingYear(false)
          setLoadingDay(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [loadDay, loadYear, selectedDay, year])

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    setError(null)
    try {
      await window.atlas.agentUsage.refresh()
      await Promise.all([loadYear(year), loadDay(selectedDay)])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setRefreshing(false)
    }
  }, [loadDay, loadYear, selectedDay, year])

  const jumpToday = useCallback((): void => {
    const day = todayDay()
    setSelectedDay(day)
    setYear(dayToDate(day).getFullYear())
  }, [])

  const generateSummary = useCallback(async (regenerate: boolean): Promise<void> => {
    const targetDay = selectedDay
    const targetYear = dayToDate(targetDay).getFullYear()
    setGeneratingDay(targetDay)
    setError(null)
    try {
      const result = await window.atlas.agentUsage.generateSummary({ day: targetDay, locale, regenerate })
      if (selectedDayRef.current === result.day) setDayDetail(result)
      await loadYear(targetYear)
    } catch (nextError) {
      if (selectedDayRef.current === targetDay) setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setGeneratingDay((current) => (current === targetDay ? null : current))
    }
  }, [loadYear, locale, selectedDay])

  const headerActions = useMemo(
    () => (
      <div className="agent-usage-header-actions">
        <button
          type="button"
          className="icon-button component-node__header-action-button"
          onClick={jumpToday}
          title={t('agentUsage.today')}
          aria-label={t('agentUsage.today')}
        >
          <CalendarDays size={14} />
        </button>
        <button
          type="button"
          className="icon-button component-node__header-action-button"
          onClick={() => void refresh()}
          disabled={refreshing}
          title={t('agentUsage.refresh')}
          aria-label={t('agentUsage.refresh')}
        >
          {refreshing ? <Loader2 size={14} className="agent-usage-spinner" /> : <RefreshCw size={14} />}
        </button>
      </div>
    ),
    [jumpToday, refresh, refreshing, t]
  )

  useEffect(() => {
    if (!setHeaderActions) return undefined

    setHeaderActions(headerActions)
    return () => setHeaderActions(null)
  }, [headerActions, setHeaderActions])

  const cells = useMemo(() => heatmapCells(year, yearResult?.days ?? []), [year, yearResult?.days])
  const weekCount = Math.max(1, Math.ceil(cells.length / 7))
  const maxTokens = useMemo(() => Math.max(0, ...(yearResult?.days ?? []).map((day) => day.totalTokens)), [yearResult?.days])
  const labels = useMemo(() => monthLabels(year, cells, locale), [cells, locale, year])
  const heatmapGridStyle = useMemo(
    () => ({ '--agent-usage-week-count': weekCount }) as CSSProperties,
    [weekCount]
  )
  const totals = dayDetail?.totals ?? EMPTY_TOTALS
  const selectedBucket = yearResult?.days.find((bucket) => bucket.day === selectedDay) ?? null
  const status = dayDetail?.status ?? yearResult?.status ?? null
  const hasNoIndex = status && !status.indexedAt && status.sourceFileCount === 0 && status.usageEventCount === 0
  const isSelectedDayGenerating = generatingDay === selectedDay

  return (
    <div className="agent-usage-module">
      <section className="agent-usage-overview-panel">
        <div className="agent-usage-panel-header">
          <div>
            <strong>{t('agentUsage.heatmap')}</strong>
            <span>{status?.indexedAt ? t('agentUsage.indexedAt', { time: formatDateTime(status.indexedAt, locale) }) : t('agentUsage.notIndexed')}</span>
          </div>
          <div className="agent-usage-year-switcher">
            <button type="button" onClick={() => setYear((current) => current - 1)} aria-label={t('agentUsage.previousYear')}>
              {year - 1}
            </button>
            <strong>{year}</strong>
            <button type="button" onClick={() => setYear((current) => current + 1)} aria-label={t('agentUsage.nextYear')}>
              {year + 1}
            </button>
          </div>
        </div>

        {error ? <div className="module-error">{t('agentUsage.failedLoad', { message: error })}</div> : null}

        <div className="agent-usage-heatmap-wrap">
          <div className="agent-usage-heatmap-grid" style={heatmapGridStyle}>
            <div className="agent-usage-months">
              {labels.map((label) => (
                <span key={`${label.label}-${label.column}`} style={{ gridColumnStart: label.column }}>
                  {label.label}
                </span>
              ))}
            </div>
            <div className="agent-usage-heatmap" aria-label={t('agentUsage.heatmap')}>
              {cells.map((cell) => {
                const level = intensity(cell.bucket, maxTokens)
                const isSelected = cell.day === selectedDay
                const title = `${formatDate(cell.day, locale)}: ${compactTokens.format(cell.bucket?.totalTokens ?? 0)} ${t('agentUsage.tokens')}`

                return (
                  <button
                    key={cell.day}
                    type="button"
                    className={cn(
                      'agent-usage-day-cell',
                      `agent-usage-day-cell--${level}`,
                      cell.outsideYear && 'agent-usage-day-cell--outside',
                      isSelected && 'agent-usage-day-cell--selected'
                    )}
                    onClick={() => {
                      setSelectedDay(cell.day)
                      if (cell.date.getFullYear() !== year) setYear(cell.date.getFullYear())
                    }}
                    title={title}
                    aria-label={title}
                    aria-pressed={isSelected}
                  />
                )
              })}
            </div>
          </div>
          <div className="agent-usage-legend" aria-hidden="true">
            <span>{t('agentUsage.less')}</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <i key={level} className={`agent-usage-day-cell agent-usage-day-cell--${level}`} />
            ))}
            <span>{t('agentUsage.more')}</span>
          </div>
        </div>

        {loadingYear ? <div className="agent-usage-loading">{t('systemMonitor.loading')}</div> : null}
        {hasNoIndex ? (
          <div className="agent-usage-empty">
            <strong>{t('agentUsage.notIndexed')}</strong>
            <span>{t('agentUsage.refreshHint')}</span>
            <button type="button" className="tool-button primary" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? <Loader2 size={15} className="agent-usage-spinner" /> : <RefreshCw size={15} />}
              <span>{t('agentUsage.refresh')}</span>
            </button>
          </div>
        ) : null}

        <section className="agent-usage-summary">
          <div className="agent-usage-section-title">
            <strong>{t('agentUsage.dailySummary')}</strong>
            {dayDetail?.dailySummary ? <span>{formatDateTime(dayDetail.dailySummary.generatedAt, locale)}</span> : null}
          </div>
          <div className="agent-usage-summary__body">
            {loadingDay ? (
              <span>{t('systemMonitor.loading')}</span>
            ) : dayDetail?.dailySummary ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{dayDetail.dailySummary.summary}</ReactMarkdown>
            ) : (
              <span>{t('agentUsage.noSummary')}</span>
            )}
          </div>
          <div className="agent-usage-summary__actions">
            <button type="button" className="tool-button primary" onClick={() => void generateSummary(Boolean(dayDetail?.dailySummary))} disabled={Boolean(generatingDay)}>
              {isSelectedDayGenerating ? <Loader2 size={15} className="agent-usage-spinner" /> : <Sparkles size={15} />}
              <span>{dayDetail?.dailySummary ? t('agentUsage.regenerateSummary') : t('agentUsage.generateSummary')}</span>
            </button>
          </div>
        </section>
      </section>

      <section className="agent-usage-detail-panel">
        <div className="agent-usage-panel-header">
          <div>
            <strong>{formatDate(selectedDay, locale)}</strong>
            <span>
              {compactTokens.format(selectedBucket?.totalTokens ?? totals.totalTokens)} {t('agentUsage.tokens')}
            </span>
          </div>
        </div>

        {loadingDay ? <div className="agent-usage-loading">{t('systemMonitor.loading')}</div> : null}

        <div className="agent-usage-metrics">
          <Metric label={t('agentUsage.totalTokens')} value={compactTokens.format(totals.totalTokens)} />
          <Metric label={t('agentUsage.inputTokens')} value={compactTokens.format(totals.inputTokens)} />
          <Metric label={t('agentUsage.cachedInputTokens')} value={compactTokens.format(totals.cachedInputTokens + totals.cacheCreationInputTokens)} />
          <Metric label={t('agentUsage.outputTokens')} value={compactTokens.format(totals.outputTokens)} />
          <Metric label={t('agentUsage.reasoningTokens')} value={compactTokens.format(totals.reasoningOutputTokens)} />
          <Metric label={t('agentUsage.sessions')} value={integers.format(totals.sessionCount)} detail={`Claude ${totals.claudeSessionCount} / Codex ${totals.codexSessionCount}`} />
          <Metric label={t('agentUsage.messages')} value={integers.format(totals.messageCount)} />
          <Metric label={t('agentUsage.toolCalls')} value={integers.format(totals.toolCallCount)} />
        </div>

        <div className="agent-usage-distributions">
          <Distribution title={t('agentUsage.models')} entries={dayDetail?.modelDistribution ?? []} formatter={compactTokens} />
          <Distribution title={t('agentUsage.projects')} entries={dayDetail?.projectDistribution ?? []} formatter={compactTokens} />
        </div>

        <section className="agent-usage-sessions">
          <div className="agent-usage-section-title">
            <strong>{t('agentUsage.sessionList')}</strong>
            <span>{integers.format(dayDetail?.sessions.length ?? 0)}</span>
          </div>
          <div className="agent-usage-session-list">
            {(dayDetail?.sessions ?? []).map((session) => (
              <article key={session.sessionKey} className="agent-usage-session">
                <header>
                  <span className={`agent-usage-provider agent-usage-provider--${session.provider}`}>{providerLabel(session.provider)}</span>
                  {session.isSidechain ? <span className="agent-usage-child">{t('agentUsage.childSession')}</span> : null}
                  <strong>{session.title}</strong>
                </header>
                <p>{session.projectPath ?? session.cwd ?? t('agentUsage.unknownProject')}</p>
                <footer>
                  <span>{session.model ?? t('agentUsage.unknownModel')}</span>
                  <span>{compactTokens.format(session.totalTokens)} {t('agentUsage.tokens')}</span>
                  <span>{formatDateTime(session.updatedAt, locale)}</span>
                </footer>
              </article>
            ))}
            {dayDetail && dayDetail.sessions.length === 0 ? <div className="agent-usage-empty">{t('agentUsage.emptyDay')}</div> : null}
          </div>
        </section>
      </section>
    </div>
  )
}

function Metric({ detail, label, value }: { detail?: string; label: string; value: string }): JSX.Element {
  return (
    <div className="agent-usage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

function Distribution({
  entries,
  formatter,
  title
}: {
  entries: Array<{ name: string; count: number; totalTokens: number }>
  formatter: Intl.NumberFormat
  title: string
}): JSX.Element {
  return (
    <section className="agent-usage-distribution">
      <strong>{title}</strong>
      <div>
        {entries.slice(0, 6).map((entry) => (
          <span key={entry.name}>
            <em>{entry.name}</em>
            <small>{formatter.format(entry.totalTokens)}</small>
          </span>
        ))}
        {entries.length === 0 ? <span className="agent-usage-distribution__empty">--</span> : null}
      </div>
    </section>
  )
}
