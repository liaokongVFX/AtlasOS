import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_APP_SHORTCUTS } from '@shared/constants'
import { DEFAULT_PET_SETTINGS } from '@shared/pet'
import { localAssetUrl } from '@shared/local-assets'
import { ATLAS_PLUGIN_API_VERSION, type PluginInfo } from '@shared/plugins'
import { DEFAULT_UPDATE_SETTINGS } from '@shared/updates'
import { I18nContext, setCurrentLocale, translate, type Locale } from '../i18n'
import { useAppSettingsStore } from '../store/app-settings-store'
import { SettingsDialog } from './settings-dialog'

vi.mock('../plugins/plugin-runtime', () => ({
  syncRendererPlugins: () => window.atlas.plugins.list()
}))

const plugin: PluginInfo = {
  id: 'acme.timer',
  sourcePath: 'D:\\plugins\\timer',
  enabled: false,
  config: { intervalMinutes: 25 },
  installedAt: '2026-05-21T00:00:00.000Z',
  updatedAt: '2026-05-21T00:00:00.000Z',
  status: 'disabled',
  rendererEntryUrl: 'atlas-plugin://acme.timer/dist/renderer.js',
  manifest: {
    id: 'acme.timer',
    name: 'Timer',
    version: '1.0.0',
    atlasApiVersion: ATLAS_PLUGIN_API_VERSION,
    renderer: { entry: 'dist/renderer.js' },
    permissions: ['native:timer'],
    configuration: [
      {
        id: 'intervalMinutes',
        label: 'Interval minutes',
        type: 'number',
        default: 25,
        options: [],
        min: 1,
        max: 120,
        step: 1
      }
    ],
    nodes: [
      {
        id: 'focus-timer',
        title: 'Focus Timer',
        defaultFrame: { x: 120, y: 120, width: 360, height: 240 },
        permissions: [],
        creatable: true
      }
    ]
  },
  diagnostics: []
}

const pluginApi = {
  getSettings: vi.fn(),
  setRootDirectory: vi.fn(),
  scanRootDirectory: vi.fn(),
  list: vi.fn(),
  installDirectory: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  uninstall: vi.fn(),
  reload: vi.fn(),
  updateConfig: vi.fn(),
  diagnostics: vi.fn(),
  invoke: vi.fn()
}
const filesystemApi = {
  chooseDirectory: vi.fn(),
  getPathForFile: vi.fn(),
  revealInFolder: vi.fn()
}
const appSettingsApi = {
  get: vi.fn(),
  update: vi.fn()
}
const appApi = {
  onOpenSettings: vi.fn()
}
const petApi = {
  getState: vi.fn(),
  updateSettings: vi.fn(),
  installClaudeHooks: vi.fn(),
  installCodexHooks: vi.fn(),
  onStateUpdated: vi.fn()
}
const updatesApi = {
  getState: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  installAndRestart: vi.fn(),
  onStateUpdated: vi.fn()
}

function renderSettingsDialog(showTrigger = true, locale: Locale = 'en-US'): ReturnType<typeof render> {
  setCurrentLocale(locale)

  return render(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: vi.fn(),
        t: (key, values) => translate(locale, key, values)
      }}
    >
      <SettingsDialog showTrigger={showTrigger} />
    </I18nContext.Provider>
  )
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    for (const mock of Object.values(pluginApi)) mock.mockReset()
    for (const mock of Object.values(filesystemApi)) mock.mockReset()
    for (const mock of Object.values(appSettingsApi)) mock.mockReset()
    for (const mock of Object.values(appApi)) mock.mockReset()
    for (const mock of Object.values(petApi)) mock.mockReset()
    for (const mock of Object.values(updatesApi)) mock.mockReset()

    useAppSettingsStore.setState({
      error: null,
      isLoaded: true,
      settings: {
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: { ...DEFAULT_APP_SHORTCUTS },
        pet: { ...DEFAULT_PET_SETTINGS },
        updates: { ...DEFAULT_UPDATE_SETTINGS }
      }
    })
    pluginApi.getSettings.mockResolvedValue({ rootPath: 'D:\\AtlasOS\\plugins' })
    appSettingsApi.get.mockResolvedValue({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      locale: 'en-US',
      shortcuts: { ...DEFAULT_APP_SHORTCUTS },
      pet: { ...DEFAULT_PET_SETTINGS },
      updates: { ...DEFAULT_UPDATE_SETTINGS }
    })
    appSettingsApi.update.mockImplementation(async (settings) => settings)
    petApi.getState.mockResolvedValue({
      settings: { ...DEFAULT_PET_SETTINGS },
      alerts: [],
      agentSessions: [],
      bridge: {
        enabled: true,
        port: 14201,
        token: 'test-token',
        claudeHook: {
          installed: false,
          settingsPath: 'C:\\Users\\xhwz2\\.claude\\settings.json',
          command: 'node',
          args: ['D:\\AtlasOS\\agent-hook-forwarder.cjs', 'claude'],
          displayCommand: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" "claude"',
          events: ['SessionStart'],
          installedEvents: []
        },
        codexHook: {
          installed: false,
          settingsPath: 'C:\\Users\\xhwz2\\.codex\\hooks.json',
          command: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" codex',
          args: [],
          displayCommand: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" codex',
          events: ['SessionStart'],
          installedEvents: []
        }
      }
    })
    petApi.updateSettings.mockImplementation(async (settings) => settings)
    petApi.installClaudeHooks.mockResolvedValue({
      installed: true,
      settingsPath: 'C:\\Users\\xhwz2\\.claude\\settings.json',
      command: 'node',
      args: ['D:\\AtlasOS\\agent-hook-forwarder.cjs', 'claude'],
      displayCommand: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" "claude"',
      events: ['SessionStart'],
      installedEvents: ['SessionStart']
    })
    petApi.installCodexHooks.mockResolvedValue({
      installed: true,
      settingsPath: 'C:\\Users\\xhwz2\\.codex\\hooks.json',
      command: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" codex',
      args: [],
      displayCommand: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" codex',
      events: ['SessionStart'],
      installedEvents: ['SessionStart']
    })
    petApi.onStateUpdated.mockReturnValue(() => undefined)
    updatesApi.getState.mockResolvedValue({
      status: 'idle',
      currentVersion: '0.1.0',
      updatedAt: '2026-06-02T00:00:00.000Z'
    })
    updatesApi.check.mockResolvedValue({
      status: 'not-available',
      currentVersion: '0.1.0',
      availableVersion: '0.1.0',
      updatedAt: '2026-06-02T00:01:00.000Z',
      lastCheckedAt: '2026-06-02T00:01:00.000Z'
    })
    updatesApi.download.mockResolvedValue({
      status: 'downloading',
      currentVersion: '0.1.0',
      updatedAt: '2026-06-02T00:02:00.000Z'
    })
    updatesApi.installAndRestart.mockResolvedValue({ ok: true })
    updatesApi.onStateUpdated.mockReturnValue(() => undefined)

    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        app: appApi,
        appSettings: appSettingsApi,
        filesystem: filesystemApi,
        pet: petApi,
        updates: updatesApi,
        plugins: pluginApi
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('opens as a settings shell with general shortcut settings', async () => {
    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'AI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeInTheDocument()
    expect(screen.getByLabelText('Deselect nodes')).toHaveValue('Ctrl+Q')
    expect(screen.getByLabelText('Find nodes')).toHaveValue('Ctrl+F')
    expect(screen.getByLabelText('Open create menu')).toHaveValue('Tab')
    expect(screen.getByLabelText('Group selected nodes')).toHaveValue('Ctrl+G')
    expect(screen.getByLabelText('Ungroup selected groups')).toHaveValue('Ctrl+Shift+G')
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
    expect(pluginApi.list).not.toHaveBeenCalled()
  })

  it('keeps the settings dialog open when the overlay is clicked', () => {
    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const overlay = document.querySelector('.dialog-overlay')
    expect(overlay).toBeInTheDocument()

    fireEvent.pointerDown(overlay!)
    fireEvent.click(overlay!)

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('saves custom general shortcut settings', async () => {
    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    fireEvent.change(screen.getByLabelText('Deselect nodes'), { target: { value: 'Ctrl+Shift+X' } })
    fireEvent.change(screen.getByLabelText('Find nodes'), { target: { value: 'Alt+F' } })
    fireEvent.change(screen.getByLabelText('Open create menu'), { target: { value: 'Ctrl+Alt+Space' } })
    fireEvent.change(screen.getByLabelText('Group selected nodes'), { target: { value: 'Ctrl+G' } })
    fireEvent.change(screen.getByLabelText('Ungroup selected groups'), { target: { value: 'Ctrl+Shift+G' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(appSettingsApi.update).toHaveBeenCalledWith({
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: {
          canvasDeselect: 'Ctrl+Shift+X',
          canvasFind: 'Alt+F',
          canvasCreateComponent: 'Ctrl+Alt+Space',
          canvasGroupSelection: 'Ctrl+G',
          canvasUngroupSelection: 'Ctrl+Shift+G'
        },
        pet: { ...DEFAULT_PET_SETTINGS },
        updates: { ...DEFAULT_UPDATE_SETTINGS }
      })
    )
  })

  it('saves update auto-check settings and can manually check for updates', async () => {
    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByText('0.1.0')

    const autoCheck = screen.getByRole('checkbox', { name: /Check for updates on startup/i })
    fireEvent.click(autoCheck)

    await waitFor(() =>
      expect(appSettingsApi.update).toHaveBeenCalledWith({
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: { ...DEFAULT_APP_SHORTCUTS },
        pet: { ...DEFAULT_PET_SETTINGS },
        updates: { autoCheck: false }
      })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))

    await waitFor(() => expect(updatesApi.check).toHaveBeenCalled())
    expect(await screen.findByText('You are up to date')).toBeInTheDocument()
  })

  it('captures bare Tab and validates duplicate general shortcuts before saving', async () => {
    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    fireEvent.change(screen.getByLabelText('Open create menu'), { target: { value: 'Alt+M' } })
    fireEvent.keyDown(screen.getByLabelText('Open create menu'), { key: 'Tab' })
    expect(screen.getByLabelText('Open create menu')).toHaveValue('Tab')

    fireEvent.change(screen.getByLabelText('Find nodes'), { target: { value: 'Ctrl+Q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Shortcut already used')).toBeInTheDocument()
    expect(appSettingsApi.update).not.toHaveBeenCalled()
  })

  it('loads and displays installed plugins when the plugin section is opened', async () => {
    pluginApi.list.mockResolvedValue([plugin])

    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }))

    expect(screen.getByRole('button', { name: 'Plugins' })).toHaveAttribute('aria-current', 'page')
    expect((await screen.findAllByText('Timer')).length).toBeGreaterThan(0)
    expect(screen.getByText('Focus Timer')).toBeInTheDocument()
    expect(screen.getByText('native:timer')).toBeInTheDocument()
    expect(screen.getByLabelText('Plugin root directory')).toHaveValue('D:\\AtlasOS\\plugins')
    expect(screen.getByText('Interval minutes')).toBeInTheDocument()
  })

  it('renders localized pet settings', async () => {
    const locale: Locale = 'zh-CN'

    renderSettingsDialog(true, locale)
    fireEvent.click(screen.getByRole('button', { name: translate(locale, 'settings.open') }))
    fireEvent.click(screen.getByRole('button', { name: translate(locale, 'settings.pet') }))

    expect(await screen.findByText(translate(locale, 'settings.petDescription'))).toBeInTheDocument()
    expect(screen.getByText(translate(locale, 'settings.petEnableWindow'))).toBeInTheDocument()
    expect(screen.getByText(translate(locale, 'settings.petReminderSound'))).toBeInTheDocument()
    expect(screen.getByText(translate(locale, 'settings.petHookBridge'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: translate(locale, 'settings.petClaudeHookInstall') }))
    await waitFor(() => expect(petApi.installClaudeHooks).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: translate(locale, 'settings.petClaudeHookRepair') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: translate(locale, 'settings.petCodexHookInstall') }))
    await waitFor(() => expect(petApi.installCodexHooks).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: translate(locale, 'settings.petCodexHookRepair') })).toBeInTheDocument()
    expect(screen.queryByText(/Raw provider hook endpoint/i)).not.toBeInTheDocument()
    expect(screen.getByText(translate(locale, 'settings.petAssetPack'))).toBeInTheDocument()
    expect(screen.getByText(translate(locale, 'settings.petActionMapping'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${translate(locale, 'settings.petIdleAsset')} ${translate(locale, 'common.browse')}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${translate(locale, 'settings.petRunningAsset')} ${translate(locale, 'common.browse')}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${translate(locale, 'settings.petRunningAsset')} ${translate(locale, 'settings.petClearAsset')}` })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: translate(locale, 'settings.petAttentionMotion') }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitemradio', { name: translate(locale, 'settings.petActionPulse') })).toBeInTheDocument()
  })

  it('imports a pet sprite sheet with default playback settings', async () => {
    const spritePath = 'D:\\AtlasOS\\assets\\atlas-idle-sprite.png'
    filesystemApi.getPathForFile.mockReturnValue(spritePath)

    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pet' }))

    await screen.findByText('Asset pack')
    const spriteInputs = document.querySelectorAll<HTMLInputElement>('input[accept="image/png,image/webp,.png,.webp"]')
    fireEvent.change(spriteInputs[0], {
      target: {
        files: [new File(['sprite'], 'atlas-idle-sprite.png', { type: 'image/png' })]
      }
    })

    await waitFor(() =>
      expect(petApi.updateSettings).toHaveBeenCalledWith({
        ...DEFAULT_PET_SETTINGS,
        assetPack: {
          ...DEFAULT_PET_SETTINGS.assetPack,
          id: 'custom-local',
          name: 'atlas-idle-sprite.png',
          idleSrc: localAssetUrl(spritePath, spritePath),
          idleKind: 'sprite',
          idleSprite: { frameCount: 8, fps: 8 }
        }
      })
    )
  })

  it('imports a running pet sprite sheet with default playback settings', async () => {
    const spritePath = 'D:\\AtlasOS\\assets\\atlas-running-sprite.png'
    filesystemApi.getPathForFile.mockReturnValue(spritePath)

    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pet' }))

    await screen.findByText('Asset pack')
    const spriteInputs = document.querySelectorAll<HTMLInputElement>('input[accept="image/png,image/webp,.png,.webp"]')
    fireEvent.change(spriteInputs[1], {
      target: {
        files: [new File(['sprite'], 'atlas-running-sprite.png', { type: 'image/png' })]
      }
    })

    await waitFor(() =>
      expect(petApi.updateSettings).toHaveBeenCalledWith({
        ...DEFAULT_PET_SETTINGS,
        assetPack: {
          ...DEFAULT_PET_SETTINGS.assetPack,
          id: 'custom-local',
          name: 'atlas-running-sprite.png',
          runningSrc: localAssetUrl(spritePath, spritePath),
          runningKind: 'sprite',
          runningSprite: { frameCount: 8, fps: 8 }
        }
      })
    )
  })

  it('imports a custom pet reminder sound', async () => {
    const askingPath = 'D:\\AtlasOS\\assets\\asking.mp3'
    const completionPath = 'D:\\AtlasOS\\assets\\done.mp3'
    filesystemApi.getPathForFile.mockReturnValue(askingPath)

    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pet' }))

    await screen.findByText('Reminder sound')
    const soundInputs = document.querySelectorAll<HTMLInputElement>(
      'input[accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/flac,audio/ogg,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga"]'
    )
    expect(soundInputs).toHaveLength(2)

    fireEvent.change(soundInputs[0], {
      target: {
        files: [new File(['audio'], 'asking.mp3', { type: 'audio/mpeg' })]
      }
    })

    await waitFor(() =>
      expect(petApi.updateSettings).toHaveBeenCalledWith({
        ...DEFAULT_PET_SETTINGS,
        alertSound: {
          enabled: true,
          askingSrc: localAssetUrl(askingPath, askingPath),
          askingName: 'asking.mp3',
          completionSrc: '',
          completionName: '',
          src: localAssetUrl(askingPath, askingPath),
          name: 'asking.mp3'
        }
      })
    )

    filesystemApi.getPathForFile.mockReturnValue(completionPath)
    fireEvent.change(soundInputs[1], {
      target: {
        files: [new File(['audio'], 'done.mp3', { type: 'audio/mpeg' })]
      }
    })

    await waitFor(() =>
      expect(petApi.updateSettings).toHaveBeenLastCalledWith({
        ...DEFAULT_PET_SETTINGS,
        alertSound: {
          enabled: true,
          askingSrc: localAssetUrl(askingPath, askingPath),
          askingName: 'asking.mp3',
          completionSrc: localAssetUrl(completionPath, completionPath),
          completionName: 'done.mp3',
          src: localAssetUrl(completionPath, completionPath),
          name: 'done.mp3'
        }
      })
    )
  })

  it('normalizes legacy pet reminder sound responses after importing audio', async () => {
    const askingPath = 'D:\\AtlasOS\\assets\\asking.mp3'
    filesystemApi.getPathForFile.mockReturnValue(askingPath)
    petApi.updateSettings.mockImplementation(async (settings) => ({
      ...settings,
      alertSound: {
        enabled: true,
        src: (settings.alertSound as typeof settings.alertSound & { src?: string }).src ?? '',
        name: (settings.alertSound as typeof settings.alertSound & { name?: string }).name ?? ''
      }
    }))

    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pet' }))

    await screen.findByText('Reminder sound')
    const soundInputs = document.querySelectorAll<HTMLInputElement>(
      'input[accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/flac,audio/ogg,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga"]'
    )
    fireEvent.change(soundInputs[0], {
      target: {
        files: [new File(['audio'], 'asking.mp3', { type: 'audio/mpeg' })]
      }
    })

    await waitFor(() => expect(petApi.updateSettings).toHaveBeenCalled())
    expect(await screen.findAllByText('asking.mp3')).toHaveLength(2)
  })

  it('keeps legacy pet reminder sound fields when toggling playback', async () => {
    const askingPath = 'D:\\AtlasOS\\assets\\asking.mp3'
    const askingSrc = localAssetUrl(askingPath, askingPath)
    filesystemApi.getPathForFile.mockReturnValue(askingPath)

    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pet' }))

    await screen.findByText('Reminder sound')
    const soundInputs = document.querySelectorAll<HTMLInputElement>(
      'input[accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/flac,audio/ogg,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga"]'
    )
    fireEvent.change(soundInputs[0], {
      target: {
        files: [new File(['audio'], 'asking.mp3', { type: 'audio/mpeg' })]
      }
    })

    await waitFor(() => expect(petApi.updateSettings).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('checkbox', { name: /Play reminder sound/i }))

    await waitFor(() =>
      expect(petApi.updateSettings).toHaveBeenLastCalledWith({
        ...DEFAULT_PET_SETTINGS,
        alertSound: {
          enabled: false,
          askingSrc,
          askingName: 'asking.mp3',
          completionSrc: '',
          completionName: '',
          src: askingSrc,
          name: 'asking.mp3'
        }
      })
    )
  })

  it('clears a pet asset slot without changing the other slots', async () => {
    petApi.getState.mockResolvedValue({
      settings: {
        ...DEFAULT_PET_SETTINGS,
        assetPack: {
          ...DEFAULT_PET_SETTINGS.assetPack,
          idleSrc: 'atlas-file://preview?path=idle.png',
          idleKind: 'sprite',
          idleSprite: { frameCount: 6, fps: 12 },
          runningSrc: 'atlas-file://preview?path=running.png',
          runningKind: 'sprite',
          runningSprite: { frameCount: 10, fps: 10 },
          attentionSrc: 'atlas-file://preview?path=attention.png',
          attentionKind: 'sprite',
          attentionSprite: { frameCount: 12, fps: 8 }
        }
      },
      alerts: [],
      agentSessions: [],
      bridge: {
        enabled: true,
        port: 14201,
        token: 'test-token',
        claudeHook: {
          installed: false,
          settingsPath: 'C:\\Users\\xhwz2\\.claude\\settings.json',
          command: 'node',
          args: ['D:\\AtlasOS\\agent-hook-forwarder.cjs', 'claude'],
          displayCommand: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" "claude"',
          events: ['SessionStart'],
          installedEvents: []
        },
        codexHook: {
          installed: false,
          settingsPath: 'C:\\Users\\xhwz2\\.codex\\hooks.json',
          command: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" codex',
          args: [],
          displayCommand: 'node "D:\\AtlasOS\\agent-hook-forwarder.cjs" codex',
          events: ['SessionStart'],
          installedEvents: []
        }
      }
    })

    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pet' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Running asset Clear' }))

    await waitFor(() =>
      expect(petApi.updateSettings).toHaveBeenCalledWith({
        ...DEFAULT_PET_SETTINGS,
        assetPack: {
          ...DEFAULT_PET_SETTINGS.assetPack,
          idleSrc: 'atlas-file://preview?path=idle.png',
          idleKind: 'sprite',
          idleSprite: { frameCount: 6, fps: 12 },
          runningSrc: '',
          runningKind: 'image',
          runningSprite: { frameCount: 8, fps: 8 },
          attentionSrc: 'atlas-file://preview?path=attention.png',
          attentionKind: 'sprite',
          attentionSprite: { frameCount: 12, fps: 8 }
        }
      })
    )
  })

  it('enables a disabled plugin and refreshes the renderer registry view', async () => {
    const enabledPlugin = { ...plugin, enabled: true, status: 'enabled' as const }
    pluginApi.list.mockResolvedValueOnce([plugin]).mockResolvedValueOnce([enabledPlugin])
    pluginApi.enable.mockResolvedValue(enabledPlugin)

    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }))

    await waitFor(() => expect(pluginApi.enable).toHaveBeenCalledWith('acme.timer'))
    await waitFor(() => expect(pluginApi.list).toHaveBeenCalledTimes(2))
  })

  it('opens from the tray settings event and saves plugin configuration', async () => {
    const openSettingsCallbacks: Array<(request?: { sectionId?: string }) => void> = []
    appApi.onOpenSettings.mockImplementation((listener: (request?: { sectionId?: string }) => void) => {
      openSettingsCallbacks.push(listener)
      return () => undefined
    })
    pluginApi.list.mockResolvedValueOnce([plugin]).mockResolvedValueOnce([{ ...plugin, config: { intervalMinutes: 45 } }])
    pluginApi.updateConfig.mockResolvedValue({ ...plugin, config: { intervalMinutes: 45 } })

    renderSettingsDialog(false)
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()

    act(() => {
      openSettingsCallbacks[0]?.({ sectionId: 'plugins' })
    })

    const input = await screen.findByLabelText('Interval minutes')
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(pluginApi.updateConfig).toHaveBeenCalledWith('acme.timer', { intervalMinutes: 45 }))
  })
})
