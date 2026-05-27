import { Activity, Cpu, MemoryStick, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { SystemMetricsSnapshot } from '@shared/system-metrics'
import { useI18n } from '../../i18n'

type MetricPanelProps = {
  detail: string
  icon: LucideIcon
  label: string
  value?: number
}

type GaugeStyle = CSSProperties & {
  '--metric-angle': string
  '--metric-value': string
}

const POLL_INTERVAL_MS = 1000

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
        <span className="system-monitor-metric__icon" aria-hidden="true">
          <Icon size={16} />
        </span>
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

export function SystemMonitorComponent(): JSX.Element {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<SystemMetricsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let pollTimer: number | null = null

    const poll = async (): Promise<void> => {
      try {
        const nextSnapshot = await window.atlas.systemMetrics.get()
        if (disposed) return

        setSnapshot(nextSnapshot)
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

  const sampledAt = useMemo(() => (snapshot ? formatSampleTime(snapshot.sampledAt) : null), [snapshot])
  const memoryDetail = snapshot
    ? t('systemMonitor.memoryUsed', {
        used: formatBytes(snapshot.memoryUsedBytes),
        total: formatBytes(snapshot.memoryTotalBytes)
      })
    : t('systemMonitor.loading')

  return (
    <div className="system-monitor-module">
      <header className="system-monitor-header">
        <span className="system-monitor-header__icon" aria-hidden="true">
          <Activity size={17} />
        </span>
        <div>
          <strong>{t('component.systemMonitor')}</strong>
          <span>{sampledAt ? t('systemMonitor.updatedAt', { time: sampledAt }) : t('systemMonitor.loading')}</span>
        </div>
        <span className="system-monitor-live">{t('systemMonitor.live')}</span>
      </header>

      {error ? <div className="module-error">{t('systemMonitor.failedLoad', { message: error })}</div> : null}

      <div className="system-monitor-grid">
        <MetricPanel icon={Cpu} label={t('systemMonitor.cpu')} value={snapshot?.cpuUsagePercent} detail={t('systemMonitor.cpuDetail')} />
        <MetricPanel icon={MemoryStick} label={t('systemMonitor.memory')} value={snapshot?.memoryUsagePercent} detail={memoryDetail} />
      </div>
    </div>
  )
}
