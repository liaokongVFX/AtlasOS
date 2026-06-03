import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { I18nProvider } from '../../i18n'
import { SystemMonitorComponent } from './system-monitor-component'

const systemMetricsApi = vi.hoisted(() => ({
  get: vi.fn()
}))

const TIMESTAMP = '2026-05-27T00:00:00.000Z'

function createComponent(state: Record<string, unknown> = {}): CanvasComponent {
  return {
    id: 'system-monitor-1',
    type: 'system-monitor',
    title: 'System Monitor',
    frame: { x: 0, y: 0, width: 520, height: 360 },
    zIndex: 1,
    config: {},
    state,
    bindings: {},
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  }
}

function renderSystemMonitor(component = createComponent(), updateState = vi.fn()) {
  render(
    <I18nProvider locale="en-US">
      <SystemMonitorComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={vi.fn()}
        updateState={updateState}
        setTitle={vi.fn()}
      />
    </I18nProvider>
  )

  return updateState
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
    expect(screen.getByRole('button', { name: 'Show wave chart' })).toHaveAttribute('aria-pressed', 'false')
    expect(systemMetricsApi.get).toHaveBeenCalledTimes(1)
  })

  it('persists the wave view selection', async () => {
    systemMetricsApi.get.mockResolvedValue({
      cpuUsagePercent: 42.4,
      memoryUsagePercent: 67.8,
      memoryUsedBytes: 8 * 1024 ** 3,
      memoryTotalBytes: 16 * 1024 ** 3,
      sampledAt: '2026-05-27T12:34:56.000Z'
    })
    const updateState = renderSystemMonitor()

    await screen.findByText('42%')
    fireEvent.click(screen.getByRole('button', { name: 'Show wave chart' }))

    expect(updateState).toHaveBeenCalledWith({ viewMode: 'wave' }, true)
  })

  it('renders persisted wave charts for CPU and memory usage', async () => {
    systemMetricsApi.get.mockResolvedValue({
      cpuUsagePercent: 42.4,
      memoryUsagePercent: 67.8,
      memoryUsedBytes: 8 * 1024 ** 3,
      memoryTotalBytes: 16 * 1024 ** 3,
      sampledAt: '2026-05-27T12:34:56.000Z'
    })
    const updateState = renderSystemMonitor(createComponent({ viewMode: 'wave' }))

    expect(await screen.findByLabelText('CPU wave chart')).toBeInTheDocument()
    expect(screen.getByLabelText('Memory wave chart')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument()
    expect(screen.getByTitle('8 GB / 16 GB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show gauge view' }))
    expect(updateState).toHaveBeenCalledWith({ viewMode: 'gauge' }, true)
  })
})
