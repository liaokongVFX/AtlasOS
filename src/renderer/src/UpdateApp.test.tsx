import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AtlasUpdateState } from '@shared/updates'
import { I18nContext, setCurrentLocale, translate } from './i18n'
import { UpdateApp } from './UpdateApp'

const updatesApi = {
  getState: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  installAndRestart: vi.fn(),
  onStateUpdated: vi.fn()
}

const availableState: AtlasUpdateState = {
  status: 'available',
  currentVersion: '0.1.0',
  availableVersion: '0.2.0',
  releaseName: 'AtlasOS 0.2.0',
  releaseNotes: 'Better updates',
  releaseDate: '2026-06-02T00:00:00.000Z',
  lastCheckedAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z'
}

function renderUpdateApp(state: AtlasUpdateState = availableState): ReturnType<typeof render> {
  setCurrentLocale('en-US')
  updatesApi.getState.mockResolvedValue(state)

  return render(
    <I18nContext.Provider
      value={{
        locale: 'en-US',
        setLocale: vi.fn(),
        t: (key, values) => translate('en-US', key, values)
      }}
    >
      <UpdateApp />
    </I18nContext.Provider>
  )
}

describe('UpdateApp', () => {
  beforeEach(() => {
    for (const mock of Object.values(updatesApi)) mock.mockReset()
    updatesApi.onStateUpdated.mockReturnValue(() => undefined)

    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        updates: updatesApi
      }
    })
    vi.spyOn(window, 'close').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('prompts before downloading an available update', async () => {
    updatesApi.download.mockResolvedValue({
      ...availableState,
      status: 'downloading',
      progress: { bytesPerSecond: 0, percent: 0, total: 0, transferred: 0 }
    })

    renderUpdateApp()

    expect(await screen.findByRole('heading', { name: 'Update available' })).toBeInTheDocument()
    expect(screen.getByText('Better updates')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(updatesApi.download).toHaveBeenCalled())
  })

  it('shows download progress without offering install yet', async () => {
    renderUpdateApp({
      ...availableState,
      status: 'downloading',
      progress: {
        bytesPerSecond: 4096,
        percent: 50,
        total: 10 * 1024,
        transferred: 5 * 1024
      }
    })

    expect(await screen.findByRole('heading', { name: 'Downloading update' })).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('5.0 KB / 10 KB')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restart to install' })).not.toBeInTheDocument()
  })

  it('installs a downloaded update after confirmation', async () => {
    updatesApi.installAndRestart.mockResolvedValue({ ok: true })

    renderUpdateApp({
      ...availableState,
      status: 'downloaded',
      progress: {
        bytesPerSecond: 0,
        percent: 100,
        total: 10,
        transferred: 10
      }
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Restart to install' }))

    await waitFor(() => expect(updatesApi.installAndRestart).toHaveBeenCalled())
  })

  it('lets users retry after an update error', async () => {
    updatesApi.check.mockResolvedValue({ ...availableState, status: 'checking' })

    renderUpdateApp({
      status: 'error',
      currentVersion: '0.1.0',
      availableVersion: '0.2.0',
      error: 'offline',
      updatedAt: '2026-06-02T00:00:00.000Z'
    })

    expect(await screen.findByText('offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(updatesApi.check).toHaveBeenCalled())
  })
})
