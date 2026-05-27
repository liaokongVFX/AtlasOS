import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { SystemMonitorComponent } from './system-monitor-component'

const systemMetricsApi = vi.hoisted(() => ({
  get: vi.fn()
}))

function renderSystemMonitor(): void {
  render(
    <I18nProvider locale="en-US">
      <SystemMonitorComponent />
    </I18nProvider>
  )
}

describe('SystemMonitorComponent', () => {
  beforeEach(() => {
    systemMetricsApi.get.mockReset()
    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        systemMetrics: systemMetricsApi
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders live CPU and memory usage from the system metrics API', async () => {
    systemMetricsApi.get.mockResolvedValue({
      cpuUsagePercent: 42.4,
      memoryUsagePercent: 67.8,
      memoryUsedBytes: 8 * 1024 ** 3,
      memoryTotalBytes: 16 * 1024 ** 3,
      sampledAt: '2026-05-27T12:34:56.000Z'
    })

    renderSystemMonitor()

    expect(screen.getAllByText('Collecting').length).toBeGreaterThan(0)
    expect(await screen.findByText('42%')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument()
    expect(screen.getByText('8 GB / 16 GB')).toBeInTheDocument()
    expect(systemMetricsApi.get).toHaveBeenCalledTimes(1)
  })
})
