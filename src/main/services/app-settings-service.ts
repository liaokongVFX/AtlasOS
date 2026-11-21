import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { patchAppSettingsInputSchema, updateAppSettingsInputSchema } from '@shared/ipc'
import { appSettingsPatchSchema, appSettingsSchema, type AppSettings, type AppSettingsPatch } from '@shared/schema'
import { handleValidated } from './ipc-helpers'
import type { QuickInputHotkeys } from './quick-input-hotkeys'
import { shortcutBindings, shortcutProblem } from '@shared/quick-input-shortcuts'

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
  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(tmpPath, filePath)
        return
      } catch (error) {
        const code = errorCode(error)
        const delay = JSON_WRITE_RETRY_DELAYS_MS[attempt]
        if (delay === undefined || (code !== 'EEXIST' && code !== 'EPERM')) throw error
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  } catch (error) {
    await rm(tmpPath, { force: true })
    throw error
  }
}

const pendingJsonWrites = new Map<string, Promise<unknown>>()

async function writeJsonQueued<T>(filePath: string, write: () => Promise<T>): Promise<T> {
  const previous = pendingJsonWrites.get(filePath) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(write)
  pendingJsonWrites.set(filePath, next)
  try {
    return await next
  } finally {
    if (pendingJsonWrites.get(filePath) === next) pendingJsonWrites.delete(filePath)
  }
}

export class AppSettingsService {
  private readonly stateDir = join(app.getPath('userData'), APP_SETTINGS_DIR)
  private readonly settingsPath = join(this.stateDir, APP_SETTINGS_FILE)

  constructor(private readonly hotkeys?: QuickInputHotkeys) {}

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
    return writeJsonQueued(this.settingsPath, async () => {
      await mkdir(this.stateDir, { recursive: true })
      const saved = await this.readSettings()
      const settings = saved?.settings ?? appSettingsSchema.parse({})
      if (!saved || saved.needsMigration) await this.writeSettingsFile(settings)
      return settings
    })
  }

  async updateSettings(settings: AppSettings): Promise<AppSettings> {
    return this.updateSettingsWith(() => settings)
  }

  async patchSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    const parsedPatch = compactSettingsPatch(appSettingsPatchSchema.parse(patch))
    return this.updateSettingsWith((settings) => ({
      ...settings,
      ...parsedPatch,
      quickInput: { ...settings.quickInput, ...parsedPatch.quickInput }
    }))
  }

  async updateSettingsWith(update: (settings: AppSettings) => AppSettings | Promise<AppSettings>): Promise<AppSettings> {
    return writeJsonQueued(this.settingsPath, async () => {
      await mkdir(this.stateDir, { recursive: true })
      const saved = await this.readSettings()
      const currentSettings = saved?.settings ?? appSettingsSchema.parse({})
      const savedSettings = appSettingsSchema.parse(await update(currentSettings))
      const previous = new Map(shortcutBindings(currentSettings).map(binding => [binding.owner, binding.key]))
      for (const binding of shortcutBindings(savedSettings)) {
        if (!binding.key || previous.get(binding.owner) === binding.key) continue
        const error = shortcutProblem(savedSettings, binding.owner, binding.key)
        if (error) throw new Error(error)
      }
      const registration = this.hotkeys?.prepare(savedSettings)
      try {
        await this.writeSettingsFile(savedSettings)
      } catch (error) {
        registration?.rollback()
        throw error
      }
      registration?.commit()
      return savedSettings
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
