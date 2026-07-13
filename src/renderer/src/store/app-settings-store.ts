import { create } from 'zustand'
import { ATLAS_SCHEMA_VERSION, DEFAULT_APP_SHORTCUTS, DEFAULT_LOCALE } from '@shared/constants'
import { DEFAULT_AI_SETTINGS } from '@shared/ai'
import { DEFAULT_PET_SETTINGS } from '@shared/pet'
import { DEFAULT_REMOTE_SERVER_SETTINGS } from '@shared/remote-servers'
import { createDefaultTerminalCommandLibrary } from '@shared/terminal-commands'
import { DEFAULT_TERMINAL_ENVIRONMENT } from '@shared/terminal-environment'
import { DEFAULT_UPDATE_SETTINGS } from '@shared/updates'
import type { AppSettings, AppSettingsPatch } from '@shared/schema'

const DEFAULT_APP_SETTINGS: AppSettings = {
  schemaVersion: ATLAS_SCHEMA_VERSION,
  locale: DEFAULT_LOCALE,
  shortcuts: { ...DEFAULT_APP_SHORTCUTS },
  terminalCommands: createDefaultTerminalCommandLibrary(),
  terminalEnvironment: { ...DEFAULT_TERMINAL_ENVIRONMENT },
  terminalEnvironmentDisabledNames: [],
  pet: { ...DEFAULT_PET_SETTINGS },
  updates: { ...DEFAULT_UPDATE_SETTINGS },
  ai: DEFAULT_AI_SETTINGS,
  remoteServers: DEFAULT_REMOTE_SERVER_SETTINGS
}

type AppSettingsStore = {
  error: string | null
  isLoaded: boolean
  settings: AppSettings
  load: () => Promise<void>
  update: (settings: AppSettings) => Promise<AppSettings>
  patch: (patch: AppSettingsPatch) => Promise<AppSettings>
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
  },

  patch: async (patch) => {
    const saved = await window.atlas.appSettings.patch(patch)
    set({ error: null, isLoaded: true, settings: saved })
    return saved
  }
}))
