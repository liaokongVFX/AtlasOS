import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { patchAppSettingsInputSchema, updateAppSettingsInputSchema } from '@shared/ipc'
import { appSettingsPatchSchema, appSettingsSchema, type AppSettings, type AppSettingsPatch } from '@shared/schema'
import { handleValidated } from './ipc-helpers'

const APP_SETTINGS_DIR = 'app-settings'
const APP_SETTINGS_FILE = 'settings.json'
const JSON_WRITE_RETRY_DELAYS_MS = [10, 25, 50]

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

function settingsNeedMigration(rawValue: unknown, settings: AppSettings): boolean {
  return JSON.stringify(rawValue) !== JSON.stringify(settings)
}

function compactSettingsPatch(patch: AppSettingsPatch): AppSettingsPatch {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as AppSettingsPatch
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmpPath, filePath)
      return
    } catch (error) {
      const code = errorCode(error)
      if (code !== 'EEXIST' && code !== 'EPERM') throw error

      await rm(filePath, { force: true })
      try {
        await rename(tmpPath, filePath)
        return
      } catch (renameError) {
        const renameCode = errorCode(renameError)
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
    handleValidated('app-settings:patch', patchAppSettingsInputSchema, async (_, input) => {
      const settings = await this.patchSettings(input.patch)
      onSettingsUpdated?.(settings)
      return settings
    })
  }

  async getSettings(): Promise<AppSettings> {
    await mkdir(this.stateDir, { recursive: true })

    const saved = await this.readSettings()
    if (saved) {
      if (saved.needsMigration) await this.writeSettings(saved.settings)
      return saved.settings
    }

    const settings = appSettingsSchema.parse({})
    await this.writeSettings(settings)
    return settings
  }

  async updateSettings(settings: AppSettings): Promise<AppSettings> {
    const parsed = appSettingsSchema.parse(settings)
    await this.writeSettings(parsed)
    return parsed
  }

  async patchSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    const parsedPatch = compactSettingsPatch(appSettingsPatchSchema.parse(patch))
    return this.updateSettingsWith((settings) => ({
      ...settings,
      ...parsedPatch
    }))
  }

  async updateSettingsWith(update: (settings: AppSettings) => AppSettings | Promise<AppSettings>): Promise<AppSettings> {
    let savedSettings: AppSettings | null = null

    await writeJsonQueued(this.settingsPath, async () => {
      await mkdir(this.stateDir, { recursive: true })
      const saved = await this.readSettings()
      const currentSettings = saved?.settings ?? appSettingsSchema.parse({})
      savedSettings = appSettingsSchema.parse(await update(currentSettings))
      await this.writeSettingsFile(savedSettings)
    })

    return savedSettings ?? appSettingsSchema.parse({})
  }

  private async writeSettings(settings: AppSettings): Promise<void> {
    const parsed = appSettingsSchema.parse(settings)
    await writeJsonQueued(this.settingsPath, async () => {
      await mkdir(this.stateDir, { recursive: true })
      await this.writeSettingsFile(parsed)
    })
  }

  private async readSettings(): Promise<{ settings: AppSettings; needsMigration: boolean } | null> {
    let raw = ''

    try {
      raw = await readFile(this.settingsPath, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }

    try {
      const rawValue = JSON.parse(raw)
      const settings = appSettingsSchema.parse(rawValue)
      return { settings, needsMigration: settingsNeedMigration(rawValue, settings) }
    } catch (error) {
      const backupPath = `${this.settingsPath}.invalid-${Date.now()}.json`
      await rename(this.settingsPath, backupPath)
      console.warn(`Backed up invalid app settings to ${backupPath}`, error)
      return null
    }
  }

  private async writeSettingsFile(settings: AppSettings): Promise<void> {
    await writeJsonAtomic(this.settingsPath, appSettingsSchema.parse(settings))
  }
}
