import { create } from 'zustand'
import { ATLAS_SCHEMA_VERSION, DEFAULT_APP_SHORTCUTS, DEFAULT_LOCALE } from '@shared/constants'
import { DEFAULT_PET_SETTINGS } from '@shared/pet'
import { createDefaultTerminalCommandLibrary } from '@shared/terminal-commands'
import { DEFAULT_UPDATE_SETTINGS } from '@shared/updates'
import type { AppSettings } from '@shared/schema'

const DEFAULT_APP_SETTINGS: AppSettings = {
  schemaVersion: ATLAS_SCHEMA_VERSION,
  locale: DEFAULT_LOCALE,
  shortcuts: { ...DEFAULT_APP_SHORTCUTS },
  terminalCommands: createDefaultTerminalCommandLibrary(),
  pet: { ...DEFAULT_PET_SETTINGS },
  updates: { ...DEFAULT_UPDATE_SETTINGS }
}

type AppSettingsStore = {
  error: string | null
  isLoaded: boolean
  settings: AppSettings
  load: () => Promise<void>
  update: (settings: AppSettings) => Promise<AppSettings>
}

export const useAppSettingsStore = create<AppSettingsStore>((set) => ({
  error: null,
  isLoaded: false,
  settings: DEFAULT_APP_SETTINGS,

  load: async () => {
    try {
      const settings = await window.atlas.appSettings.get()
      set({ error: null, isLoaded: true, settings })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), isLoaded: true })
    }
  },

  update: async (settings) => {
    const saved = await window.atlas.appSettings.update(settings)
    set({ error: null, isLoaded: true, settings: saved })
    return saved
  }
}))
