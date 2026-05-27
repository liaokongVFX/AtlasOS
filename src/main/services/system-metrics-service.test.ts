import { describe, expect, it, vi } from 'vitest'
import {
  aggregateCpuTimes,
  calculateCpuUsagePercent,
  SystemMetricsService,
  type CpuTimeSample,
  type SystemMetricsSampler
} from './system-metrics-service'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.ipcHandle
  }
}))

describe('SystemMetricsService', () => {
  it('aggregates per-core CPU time samples', () => {
    const sample = aggregateCpuTimes([
      { times: { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 } },
      { times: { user: 20, nice: 1, sys: 9, idle: 70, irq: 0 } }
    ])

    expect(sample).toEqual({
      idle: 155,
      total: 200
    })
  })

  it('calculates CPU usage from cumulative time deltas', () => {
    const previous: CpuTimeSample = { idle: 100, total: 200 }
    const current: CpuTimeSample = { idle: 125, total: 300 }

    expect(calculateCpuUsagePercent(previous, current)).toBe(75)
  })

  it('returns a bounded snapshot with primed CPU usage and memory usage', async () => {
    const cpuSamples: CpuTimeSample[] = [
      { idle: 100, total: 200 },
      { idle: 130, total: 300 },
      { idle: 145, total: 400 }
    ]
    const sampler: SystemMetricsSampler = {
      readCpuTimes: vi.fn(() => {
        const sample = cpuSamples.shift()
        if (!sample) throw new Error('Unexpected CPU sample read')
        return sample
      }),
      readMemory: vi.fn(() => ({
        freeBytes: 4,
        totalBytes: 16
      })),
      now: () => new Date('2026-05-27T00:00:00.000Z'),
      sleep: vi.fn(() => Promise.resolve())
    }
    const service = new SystemMetricsService(sampler, 50)

    await expect(service.getSnapshot()).resolves.toEqual({
      cpuUsagePercent: 70,
      memoryUsagePercent: 75,
      memoryUsedBytes: 12,
      memoryTotalBytes: 16,
      sampledAt: '2026-05-27T00:00:00.000Z'
    })
    await expect(service.getSnapshot()).resolves.toMatchObject({
      cpuUsagePercent: 85,
      memoryUsagePercent: 75
    })
    expect(sampler.sleep).toHaveBeenCalledTimes(1)
    expect(sampler.sleep).toHaveBeenCalledWith(50)
  })

  it('registers the system metrics IPC channel', () => {
    electronMocks.ipcHandle.mockClear()

    new SystemMetricsService().registerIpc()

    expect(electronMocks.ipcHandle).toHaveBeenCalledWith('system-metrics:get', expect.any(Function))
  })
})
