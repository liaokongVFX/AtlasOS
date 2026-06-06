import { ChartSpline, Cpu, Gauge, MemoryStick, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import type { SystemMetricsSnapshot } from '@shared/system-metrics'
import { useI18n } from '../../i18n'
import { asString, cn } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type MetricPanelProps = {
  detail: string
  icon: LucideIcon
  label: string
  value?: number
}

type MetricHistoryPoint = Pick<SystemMetricsSnapshot, 'cpuUsagePercent' | 'memoryUsagePercent' | 'memoryUsedBytes' | 'memoryTotalBytes' | 'sampledAt'>

type MetricWavePanelProps = Omit<MetricPanelProps, 'icon'> & {
  axisLabels: readonly [string, string, string]
  chartLabel: string
  samples: MetricHistoryPoint[]
  valueForSample: (sample: MetricHistoryPoint) => number
  variant: 'cpu' | 'memory'
}

type GaugeStyle = CSSProperties & {
  '--metric-angle': string
  '--metric-value': string
}

const POLL_INTERVAL_MS = 1000
const HISTORY_SAMPLE_LIMIT = 90
const WAVE_CHART_WIDTH = 320
const WAVE_CHART_HEIGHT = 112
const WAVE_CHART_PADDING_X = 4
const WAVE_CHART_PADDING_Y = 8
const PERCENT_AXIS_LABELS = ['100', '50', '0'] as const

type SystemMonitorViewMode = 'gauge' | 'wave'

type ChartPoint = {
  x: number
  y: number
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) return '--'
  const rounded = Math.round(clampPercent(value))
  return `${rounded}%`
}

function formatBytes(bytes: number): string {
  const gibibytes = bytes / 1024 ** 3
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: gibibytes >= 10 ? 1 : 2
  })

  return `${formatter.format(gibibytes)} GB`
}

function formatSampleTime(sampledAt: string): string {
  const date = new Date(sampledAt)
  if (Number.isNaN(date.getTime())) return '--'

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function readViewMode(value: unknown): SystemMonitorViewMode {
  return asString(value, 'gauge') === 'wave' ? 'wave' : 'gauge'
}

function snapshotToHistoryPoint(snapshot: SystemMetricsSnapshot): MetricHistoryPoint {
  return {
    cpuUsagePercent: snapshot.cpuUsagePercent,
    memoryUsagePercent: snapshot.memoryUsagePercent,
    memoryUsedBytes: snapshot.memoryUsedBytes,
    memoryTotalBytes: snapshot.memoryTotalBytes,
    sampledAt: snapshot.sampledAt
  }
}

function appendHistorySample(history: MetricHistoryPoint[], snapshot: SystemMetricsSnapshot): MetricHistoryPoint[] {
  const nextSample = snapshotToHistoryPoint(snapshot)
  const previousSample = history.at(-1)
  const nextHistory = previousSample?.sampledAt === nextSample.sampledAt ? [...history.slice(0, -1), nextSample] : [...history, nextSample]

  return nextHistory.length > HISTORY_SAMPLE_LIMIT ? nextHistory.slice(nextHistory.length - HISTORY_SAMPLE_LIMIT) : nextHistory
}

function chartY(value: number): number {
  const plotHeight = WAVE_CHART_HEIGHT - WAVE_CHART_PADDING_Y * 2
  return WAVE_CHART_PADDING_Y + (1 - clampPercent(value) / 100) * plotHeight
}

function chartPoints(samples: MetricHistoryPoint[], valueForSample: (sample: MetricHistoryPoint) => number): ChartPoint[] {
  const plotWidth = WAVE_CHART_WIDTH - WAVE_CHART_PADDING_X * 2

  if (samples.length === 1) {
    const y = chartY(valueForSample(samples[0]))
    return [
      { x: WAVE_CHART_PADDING_X, y },
      { x: WAVE_CHART_WIDTH - WAVE_CHART_PADDING_X, y }
    ]
  }

  return samples.map((sample, index) => ({
    x: WAVE_CHART_PADDING_X + (plotWidth * index) / Math.max(1, samples.length - 1),
    y: chartY(valueForSample(sample))
  }))
}

function linePath(points: ChartPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

function areaPath(points: ChartPoint[]): string {
  if (!points.length) return ''

  const baseline = WAVE_CHART_HEIGHT - WAVE_CHART_PADDING_Y
  return `${linePath(points)} L ${points.at(-1)?.x.toFixed(2) ?? WAVE_CHART_PADDING_X} ${baseline} L ${points[0].x.toFixed(2)} ${baseline} Z`
}

function timeTicks(samples: MetricHistoryPoint[]): string[] {
  if (!samples.length) return ['--', '--', '--']

  const middleIndex = Math.floor((samples.length - 1) / 2)
  return [samples[0], samples[middleIndex], samples.at(-1) ?? samples[middleIndex]].map((sample) => formatSampleTime(sample.sampledAt))
}

function MetricPanel({ detail, icon: Icon, label, value }: MetricPanelProps): JSX.Element {
  const percent = value === undefined ? 0 : clampPercent(value)
  const formattedValue = formatPercent(value)
  const meterValueProps =
    value === undefined
      ? { 'aria-valuetext': formattedValue }
      : { 'aria-valuenow': Math.round(percent), 'aria-valuetext': formattedValue }
  const gaugeStyle: GaugeStyle = {
    '--metric-angle': `${percent * 3.6}deg`,
    '--metric-value': `${percent}%`
  }

  return (
    <section className="system-monitor-metric" aria-label={`${label} ${formattedValue}`}>
      <div className="system-monitor-metric__topline">
        <span>{label}</span>
      </div>
      <div className="system-monitor-metric__body">
        <span className="system-monitor-gauge" style={gaugeStyle} aria-hidden="true">
          <span className="system-monitor-gauge__inner">
            <Icon size={22} />
          </span>
        </span>
        <strong>{formattedValue}</strong>
      </div>
      <div className="system-monitor-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...meterValueProps}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="system-monitor-metric__detail">{detail}</span>
    </section>
  )
}

function MetricWavePanel({ axisLabels, chartLabel, detail, label, samples, value, valueForSample, variant }: MetricWavePanelProps): JSX.Element {
  const gradientId = useId().replace(/:/g, '')
  const points = chartPoints(samples, valueForSample)
  const line = linePath(points)
  const area = areaPath(points)
  const ticks = timeTicks(samples)
  const formattedValue = formatPercent(value)

  return (
    <section className={cn('system-monitor-wave-panel', `system-monitor-wave-panel--${variant}`)} aria-label={`${label} ${formattedValue}. ${detail}`} title={detail}>
      <div className="system-monitor-wave-panel__topline">
        <span>{label}</span>
        <strong>{formattedValue}</strong>
      </div>
      <div className="system-monitor-wave-chart">
        <div className="system-monitor-wave-chart__axis" aria-hidden="true">
          {axisLabels.map((axisLabel) => (
            <span key={axisLabel}>{axisLabel}</span>
          ))}
        </div>
        <div className="system-monitor-wave-chart__plot">
          <svg viewBox={`0 0 ${WAVE_CHART_WIDTH} ${WAVE_CHART_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={chartLabel}>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--wave-color)" stopOpacity="0.58" />
                <stop offset="100%" stopColor="var(--wave-color)" stopOpacity="0.06" />
              </linearGradient>
            </defs>
            <path className="system-monitor-wave-chart__grid" d="M 0 8 H 320 M 0 56 H 320 M 0 104 H 320 M 64 0 V 112 M 160 0 V 112 M 256 0 V 112" />
            {area ? <path className="system-monitor-wave-chart__area" d={area} fill={`url(#${gradientId})`} /> : null}
            {line ? <path className="system-monitor-wave-chart__line" d={line} /> : null}
          </svg>
          <div className="system-monitor-wave-chart__ticks" aria-hidden="true">
            {ticks.map((tick, index) => (
              <span key={`${tick}-${index}`}>{tick}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export function SystemMonitorComponent({ component, updateState, setHeaderActions }: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<SystemMetricsSnapshot | null>(null)
  const [history, setHistory] = useState<MetricHistoryPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const viewMode = readViewMode(component.state.viewMode)

  useEffect(() => {
    let disposed = false
    let pollTimer: number | null = null

    const poll = async (): Promise<void> => {
      try {
        const nextSnapshot = await window.atlas.systemMetrics.get()
        if (disposed) return

        setSnapshot(nextSnapshot)
        setHistory((currentHistory) => appendHistorySample(currentHistory, nextSnapshot))
        setError(null)
      } catch (nextError) {
        if (disposed) return

        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        if (!disposed) {
          pollTimer = window.setTimeout(() => {
            pollTimer = null
            void poll()
          }, POLL_INTERVAL_MS)
        }
      }
    }

    void poll()

    return () => {
      disposed = true
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }, [])

  const switchViewMode = useCallback((nextViewMode: SystemMonitorViewMode): void => {
    if (nextViewMode !== viewMode) updateState({ viewMode: nextViewMode }, true)
  }, [updateState, viewMode])
  const headerActions = useMemo(
    () => (
      <div className="system-monitor-view-toggle" role="group" aria-label={t('systemMonitor.viewToggle')}>
        <button
          type="button"
          className={cn('system-monitor-view-toggle__button', viewMode === 'gauge' && 'system-monitor-view-toggle__button--active')}
          onClick={() => switchViewMode('gauge')}
          title={t('systemMonitor.showGaugeView')}
          aria-label={t('systemMonitor.showGaugeView')}
          aria-pressed={viewMode === 'gauge'}
        >
          <Gauge size={14} />
        </button>
        <button
          type="button"
          className={cn('system-monitor-view-toggle__button', viewMode === 'wave' && 'system-monitor-view-toggle__button--active')}
          onClick={() => switchViewMode('wave')}
          title={t('systemMonitor.showWaveView')}
          aria-label={t('systemMonitor.showWaveView')}
          aria-pressed={viewMode === 'wave'}
        >
          <ChartSpline size={14} />
        </button>
      </div>
    ),
    [switchViewMode, t, viewMode]
  )

  useEffect(() => {
    if (!setHeaderActions) return undefined

    setHeaderActions(headerActions)
    return () => setHeaderActions(null)
  }, [headerActions, setHeaderActions])

  const memoryDetail = snapshot
    ? t('systemMonitor.memoryUsed', {
        used: formatBytes(snapshot.memoryUsedBytes),
        total: formatBytes(snapshot.memoryTotalBytes)
      })
    : t('systemMonitor.loading')
  const memoryAxisLabels = snapshot
    ? ([formatBytes(snapshot.memoryTotalBytes), formatBytes(snapshot.memoryTotalBytes / 2), formatBytes(0)] as const)
    : PERCENT_AXIS_LABELS

  return (
    <div className={cn('system-monitor-module', viewMode === 'wave' && 'system-monitor-module--wave')}>
      {error ? <div className="module-error">{t('systemMonitor.failedLoad', { message: error })}</div> : null}

      {viewMode === 'wave' ? (
        <div className="system-monitor-wave-grid">
          <MetricWavePanel
            axisLabels={PERCENT_AXIS_LABELS}
            chartLabel={t('systemMonitor.waveChartLabel', { label: t('systemMonitor.cpu') })}
            detail={t('systemMonitor.cpuDetail')}
            label={t('systemMonitor.cpu')}
            samples={history}
            value={snapshot?.cpuUsagePercent}
            valueForSample={(sample) => sample.cpuUsagePercent}
            variant="cpu"
          />
          <MetricWavePanel
            axisLabels={memoryAxisLabels}
            chartLabel={t('systemMonitor.waveChartLabel', { label: t('systemMonitor.memory') })}
            detail={memoryDetail}
            label={t('systemMonitor.memory')}
            samples={history}
            value={snapshot?.memoryUsagePercent}
            valueForSample={(sample) => sample.memoryUsagePercent}
            variant="memory"
          />
        </div>
      ) : (
        <div className="system-monitor-grid">
          <MetricPanel icon={Cpu} label={t('systemMonitor.cpu')} value={snapshot?.cpuUsagePercent} detail={t('systemMonitor.cpuDetail')} />
          <MetricPanel icon={MemoryStick} label={t('systemMonitor.memory')} value={snapshot?.memoryUsagePercent} detail={memoryDetail} />
        </div>
      )}
    </div>
  )
}
