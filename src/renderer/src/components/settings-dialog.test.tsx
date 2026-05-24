import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION, DEFAULT_APP_SHORTCUTS } from '@shared/constants'
import { DEFAULT_PET_SETTINGS } from '@shared/pet'
import { ATLAS_PLUGIN_API_VERSION, type PluginInfo } from '@shared/plugins'
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

    useAppSettingsStore.setState({
      error: null,
      isLoaded: true,
      settings: {
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: { ...DEFAULT_APP_SHORTCUTS },
        pet: { ...DEFAULT_PET_SETTINGS }
      }
    })
    pluginApi.getSettings.mockResolvedValue({ rootPath: 'D:\\AtlasOS\\plugins' })
    appSettingsApi.get.mockResolvedValue({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      locale: 'en-US',
      shortcuts: { ...DEFAULT_APP_SHORTCUTS },
      pet: { ...DEFAULT_PET_SETTINGS }
    })
    appSettingsApi.update.mockImplementation(async (settings) => settings)
    petApi.getState.mockResolvedValue({
      settings: { ...DEFAULT_PET_SETTINGS },
      alerts: [],
      agentSessions: [],
      bridge: { enabled: true, port: 14201, token: 'test-token' }
    })
    petApi.updateSettings.mockImplementation(async (settings) => settings)
    petApi.onStateUpdated.mockReturnValue(() => undefined)

    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        app: appApi,
        appSettings: appSettingsApi,
        filesystem: filesystemApi,
        pet: petApi,
        plugins: pluginApi
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('opens as a settings shell with general shortcut settings', () => {
    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'AI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeInTheDocument()
    expect(screen.getByLabelText('Deselect nodes')).toHaveValue('Ctrl+Q')
    expect(screen.getByLabelText('Find nodes')).toHaveValue('Ctrl+F')
    expect(screen.getByLabelText('Open create menu')).toHaveValue('Tab')
    expect(pluginApi.list).not.toHaveBeenCalled()
  })

  it('saves custom general shortcut settings', async () => {
    renderSettingsDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    fireEvent.change(screen.getByLabelText('Deselect nodes'), { target: { value: 'Ctrl+Shift+X' } })
    fireEvent.change(screen.getByLabelText('Find nodes'), { target: { value: 'Alt+F' } })
    fireEvent.change(screen.getByLabelText('Open create menu'), { target: { value: 'Ctrl+Alt+Space' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(appSettingsApi.update).toHaveBeenCalledWith({
        schemaVersion: ATLAS_SCHEMA_VERSION,
        locale: 'en-US',
        shortcuts: {
          canvasDeselect: 'Ctrl+Shift+X',
          canvasFind: 'Alt+F',
          canvasCreateComponent: 'Ctrl+Alt+Space'
        },
        pet: { ...DEFAULT_PET_SETTINGS }
      })
    )
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
    expect(screen.getByText(translate(locale, 'settings.petHookBridge'))).toBeInTheDocument()
    expect(screen.getByText(translate(locale, 'settings.petAssetPack'))).toBeInTheDocument()
    expect(screen.getByText(translate(locale, 'settings.petActionMapping'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${translate(locale, 'settings.petIdleAsset')} ${translate(locale, 'common.browse')}` })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: translate(locale, 'settings.petAttentionMotion') }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitemradio', { name: translate(locale, 'settings.petActionPulse') })).toBeInTheDocument()
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
