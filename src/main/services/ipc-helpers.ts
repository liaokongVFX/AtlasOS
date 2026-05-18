import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'

export function handleValidated<TSchema extends z.ZodTypeAny, TResult>(
  channel: string,
  schema: TSchema,
  handler: (event: IpcMainInvokeEvent, input: z.infer<TSchema>) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (event, payload) => {
    const input = schema.parse(payload)
    return handler(event, input)
  })
}
