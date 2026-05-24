import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { updateAppSettingsInputSchema } from '@shared/ipc'
import { appSettingsSchema, type AppSettings } from '@shared/schema'
import { handleValidated } from './ipc-helpers'

const APP_SETTINGS_DIR = 'app-settings'
const APP_SETTINGS_FILE = 'settings.json'

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmpPath, filePath)
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
    await mkdir(this.stateDir, { recursive: true })
    await writeJsonAtomic(this.settingsPath, appSettingsSchema.parse(settings))
  }
}
