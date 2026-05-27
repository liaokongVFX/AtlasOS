import { cpus, freemem, totalmem } from 'node:os'
import { systemMetricsGetInputSchema } from '@shared/ipc'
import type { SystemMetricsSnapshot } from '@shared/system-metrics'
import { handleValidated } from './ipc-helpers'

type CpuInfoLike = {
  times: {
    user: number
    nice: number
    sys: number
    idle: number
    irq: number
  }
}

export type CpuTimeSample = {
  idle: number
  total: number
}

type MemorySample = {
  freeBytes: number
  totalBytes: number
}

export type SystemMetricsSampler = {
  readCpuTimes: () => CpuTimeSample
  readMemory: () => MemorySample
  now: () => Date
  sleep: (ms: number) => Promise<void>
}

const INITIAL_CPU_SAMPLE_DELAY_MS = 120

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function roundPercent(value: number): number {
  return Math.round(clampPercent(value) * 10) / 10
}

export function aggregateCpuTimes(cpuInfos: CpuInfoLike[]): CpuTimeSample {
  return cpuInfos.reduce<CpuTimeSample>(
    (sample, cpuInfo) => {
      const total = Object.values(cpuInfo.times).reduce((sum, time) => sum + time, 0)

      sample.idle += cpuInfo.times.idle
      sample.total += total
      return sample
    },
    { idle: 0, total: 0 }
  )
}

export function calculateCpuUsagePercent(previous: CpuTimeSample, current: CpuTimeSample): number {
  const idleDelta = Math.max(0, current.idle - previous.idle)
  const totalDelta = Math.max(0, current.total - previous.total)
  if (totalDelta <= 0) return 0

  return roundPercent(((totalDelta - idleDelta) / totalDelta) * 100)
}

function calculateMemoryUsagePercent(usedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0
  return roundPercent((usedBytes / totalBytes) * 100)
}

function createDefaultSampler(): SystemMetricsSampler {
  return {
    readCpuTimes: () => aggregateCpuTimes(cpus()),
    readMemory: () => ({
      freeBytes: freemem(),
      totalBytes: totalmem()
    }),
    now: () => new Date(),
    sleep
  }
}

export class SystemMetricsService {
  private previousCpuTimes: CpuTimeSample | null = null

  constructor(
    private readonly sampler = createDefaultSampler(),
    private readonly initialCpuSampleDelayMs = INITIAL_CPU_SAMPLE_DELAY_MS
  ) {}

  registerIpc(): void {
    handleValidated('system-metrics:get', systemMetricsGetInputSchema, () => this.getSnapshot())
  }

  async getSnapshot(): Promise<SystemMetricsSnapshot> {
    const cpuUsagePercent = await this.readCpuUsagePercent()
    const memory = this.sampler.readMemory()
    const memoryTotalBytes = Math.max(0, memory.totalBytes)
    const memoryUsedBytes = Math.min(memoryTotalBytes, Math.max(0, memoryTotalBytes - memory.freeBytes))

    return {
      cpuUsagePercent,
      memoryUsagePercent: calculateMemoryUsagePercent(memoryUsedBytes, memoryTotalBytes),
      memoryUsedBytes,
      memoryTotalBytes,
      sampledAt: this.sampler.now().toISOString()
    }
  }

  private async readCpuUsagePercent(): Promise<number> {
    let current = this.sampler.readCpuTimes()
    let previous = this.previousCpuTimes

    if (!previous) {
      previous = current
      await this.sampler.sleep(this.initialCpuSampleDelayMs)
      current = this.sampler.readCpuTimes()
    }

    this.previousCpuTimes = current
    return calculateCpuUsagePercent(previous, current)
  }
}
