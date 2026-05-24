import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { QuickLauncherComponent } from './quick-launcher-component'
import {
  createDefaultQuickLauncherState,
  createQuickLauncherItem,
  createQuickLauncherTab,
  type QuickLauncherState
} from './quick-launcher-model'

const TIMESTAMP = '2026-05-24T00:00:00.000Z'
const launcherApi = vi.hoisted(() => ({
  chooseFile: vi.fn(),
  open: vi.fn()
}))
const filesystemApi = vi.hoisted(() => ({
  chooseDirectory: vi.fn()
}))

function createComponent(state: Record<string, unknown> = {}): CanvasComponent {
  return {
    id: 'launcher-1',
    type: 'quick-launcher',
    title: 'Quick Launcher',
    frame: { x: 0, y: 0, width: 680, height: 520 },
    zIndex: 1,
    config: {},
    state,
    bindings: {},
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  }
}

function renderLauncher(component = createComponent(), updateState = vi.fn()) {
  render(
    <QuickLauncherComponent
      canvasId="canvas-1"
      component={component}
      updateConfig={vi.fn()}
      updateState={updateState}
      setTitle={vi.fn()}
    />
  )

  return updateState
}

function lastLauncherState(updateState: ReturnType<typeof vi.fn>): QuickLauncherState {
  const call = updateState.mock.calls.at(-1)
  expect(call).toBeDefined()
  return call?.[0] as QuickLauncherState
}

describe('QuickLauncherComponent', () => {
  beforeEach(() => {
    launcherApi.chooseFile.mockReset()
    launcherApi.open.mockReset()
    launcherApi.open.mockResolvedValue({ ok: true })
    filesystemApi.chooseDirectory.mockReset()

    Object.defineProperty(window, 'atlas', {
      configurable: true,
      value: {
        launcher: launcherApi,
        filesystem: filesystemApi
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('hydrates an empty node with a default tab', async () => {
    const updateState = renderLauncher()

    expect(screen.getByText('当前分页没有快捷项')).toBeInTheDocument()
    await waitFor(() => expect(updateState).toHaveBeenCalledWith(expect.objectContaining({ activeTabId: 'default' }), true))
  })

  it('adds a URL shortcut from the item dialog', async () => {
    const updateState = renderLauncher(createComponent(createDefaultQuickLauncherState(TIMESTAMP)))

    fireEvent.click(screen.getByRole('button', { name: '新增快捷项' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: /类型/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '网址' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Docs' } })
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), { target: { value: 'https://example.com/docs' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const state = lastLauncherState(updateState)
    const item = Object.values(state.items)[0]
    expect(item).toMatchObject({
      kind: 'url',
      name: 'Docs',
      url: 'https://example.com/docs'
    })
    expect(state.tabs[0].itemIds).toEqual([item.id])
  })

  it('searches across tabs and launches a matching shortcut', async () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherTab(state, 'docs', 'Docs', TIMESTAMP)
    state = createQuickLauncherItem(state, 'docs', 'docs-url', { kind: 'url', name: 'API Docs', url: 'example.com/docs' }, TIMESTAMP)
    renderLauncher(createComponent(state))

    fireEvent.change(screen.getByLabelText('搜索快捷项'), { target: { value: 'api' } })
    fireEvent.click(screen.getByRole('button', { name: '启动 API Docs' }))

    await waitFor(() =>
      expect(launcherApi.open).toHaveBeenCalledWith({
        kind: 'url',
        url: 'https://example.com/docs'
      })
    )
  })

  it('shows launch errors without deleting the shortcut', async () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherItem(state, 'default', 'missing-file', { kind: 'file', name: 'Missing file', targetPath: 'D:\\missing.txt' }, TIMESTAMP)
    launcherApi.open.mockRejectedValueOnce(new Error('Target does not exist'))
    renderLauncher(createComponent(state))

    fireEvent.click(screen.getByRole('button', { name: '启动 Missing file' }))

    expect(await screen.findByText(/Target does not exist/)).toBeInTheDocument()
    expect(screen.getByText('Missing file')).toBeInTheDocument()
  })

  it('confirms deleting a tab that contains shortcuts', () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherTab(state, 'work', 'Work', TIMESTAMP)
    state = createQuickLauncherItem(state, 'work', 'cmd', { kind: 'command', name: 'Dev', shell: 'powershell', command: 'npm run dev' }, TIMESTAMP)
    const updateState = renderLauncher(createComponent(state))

    fireEvent.click(screen.getByLabelText('删除 Work'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('删除分页？')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    const nextState = lastLauncherState(updateState)
    expect(nextState.tabs.map((tab) => tab.id)).toEqual(['default'])
    expect(nextState.items.cmd).toBeUndefined()
  })
})
