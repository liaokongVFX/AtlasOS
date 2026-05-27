import { z } from 'zod'

export const systemMetricsSnapshotSchema = z.object({
  cpuUsagePercent: z.number().min(0).max(100),
  memoryUsagePercent: z.number().min(0).max(100),
  memoryUsedBytes: z.number().nonnegative(),
  memoryTotalBytes: z.number().nonnegative(),
  sampledAt: z.string()
})

export type SystemMetricsSnapshot = z.infer<typeof systemMetricsSnapshotSchema>
