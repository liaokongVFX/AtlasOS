import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { updateAppSettingsInputSchema } from '@shared/ipc'
import { appSettingsSchema, type AppSettings } from '@shared/schema'
import { handleValidated } from './ipc-helpers'

const APP_SETTINGS_DIR = 'app-settings'
const APP_SETTINGS_FILE = 'settings.json'
const JSON_WRITE_RETRY_DELAYS_MS = [10, 25, 50]

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmpPath, filePath)
      return
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code !== 'EEXIST' && code !== 'EPERM') throw error

      await rm(filePath, { force: true })
      try {
        await rename(tmpPath, filePath)
        return
      } catch (renameError) {
        const renameCode = typeof renameError === 'object' && renameError !== null && 'code' in renameError ? renameError.code : undefined
        const delay = JSON_WRITE_RETRY_DELAYS_MS[attempt]
        if (delay === undefined || (renameCode !== 'EPERM' && renameCode !== 'ENOENT')) throw renameError
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
}

const pendingJsonWrites = new Map<string, Promise<void>>()

async function writeJsonQueued(filePath: string, write: () => Promise<void>): Promise<void> {
  const previous = pendingJsonWrites.get(filePath) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(write)
  pendingJsonWrites.set(filePath, next)
  try {
    await next
  } finally {
    if (pendingJsonWrites.get(filePath) === next) pendingJsonWrites.delete(filePath)
  }
}

export class AppSettingsService {
  private readonly stateDir = join(app.getPath('userData'), APP_SETTINGS_DIR)
  private readonly settingsPath = join(this.stateDir, APP_SETTINGS_FILE)

  registerIpc(onSettingsUpdated?: (settings: AppSettings) => void): void {
    handleValidated('app-settings:get', z.object({}), () => this.getSettings())
    handleValidated('app-settings:update', updateAppSettingsInputSchema, async (_, input) => {
      const settings = await this.updateSettings(input.settings)
      onSettingsUpdated?.(settings)
      return settings
    })
  }

  async getSettings(): Promise<AppSettings> {
    await mkdir(this.stateDir, { recursive: true })

    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      return appSettingsSchema.parse(JSON.parse(raw))
    } catch {
      const settings = appSettingsSchema.parse({})
      await this.writeSettings(settings)
      return settings
    }
  }

  async updateSettings(settings: AppSettings): Promise<AppSettings> {
    const parsed = appSettingsSchema.parse(settings)
    await this.writeSettings(parsed)
    return parsed
  }

  private async writeSettings(settings: AppSettings): Promise<void> {
    const parsed = appSettingsSchema.parse(settings)
    await writeJsonQueued(this.settingsPath, async () => {
      await mkdir(this.stateDir, { recursive: true })
      await writeJsonAtomic(this.settingsPath, parsed)
    })
  }
}
