import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function clickAddItem(): void {
  const addItemButton = document.querySelector<HTMLButtonElement>('.quick-launcher-add-item')
  expect(addItemButton).toBeTruthy()
  fireEvent.click(addItemButton as HTMLButtonElement)
}

function clickTileLaunch(): void {
  const launchButton = document.querySelector<HTMLButtonElement>('.quick-launcher-tile__launch')
  expect(launchButton).toBeTruthy()
  fireEvent.click(launchButton as HTMLButtonElement)
}

function clickDialogSubmit(): void {
  const dialog = screen.getByRole('dialog')
  const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
  const submitButton = buttons.at(-1)
  expect(submitButton).toBeTruthy()
  fireEvent.click(submitButton as HTMLButtonElement)
}

function setElementSize(element: HTMLElement, key: 'clientWidth' | 'scrollWidth', value: number): void {
  Object.defineProperty(element, key, {
    configurable: true,
    value
  })
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
    vi.useRealTimers()
  })

  it('hydrates an empty node with a default tab', async () => {
    const updateState = renderLauncher()

    expect(document.querySelector('.quick-launcher-empty')).toBeTruthy()
    expect(document.querySelector('.quick-launcher-grid')).toHaveClass('quick-launcher-grid--empty')
    await waitFor(() => expect(updateState).toHaveBeenCalledWith(expect.objectContaining({ activeTabId: 'default' }), true))
  })

  it('renders the add shortcut control as an icon-only button', () => {
    renderLauncher(createComponent(createDefaultQuickLauncherState(TIMESTAMP)))

    const addTabButton = document.querySelector<HTMLButtonElement>('.quick-launcher-add-tab')
    const addItemButton = document.querySelector<HTMLButtonElement>('.quick-launcher-add-item')
    const addTabIcon = addTabButton?.querySelector('svg')
    const addItemIcon = addItemButton?.querySelector('svg')
    expect(addTabButton).toBeTruthy()
    expect(addItemButton).toBeTruthy()
    expect(addItemButton).toHaveClass('icon-button')
    expect(addItemButton).toHaveAttribute('aria-label', '新增快捷项')
    expect(addItemButton?.querySelector('span')).toBeNull()
    expect(addTabIcon).toBeTruthy()
    expect(addItemIcon).toBeTruthy()
    expect(addTabIcon?.innerHTML).not.toBe(addItemIcon?.innerHTML)
    expect(document.querySelector('.quick-launcher-toolbar input')).toBeNull()
    expect(document.querySelector('.quick-launcher-content__meta')).toBeNull()
  })

  it('sizes the tab rename input to the tab label', () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherTab(state, 'common-811', 'Common 811', TIMESTAMP)
    renderLauncher(createComponent(state))

    const activeTab = document.querySelector<HTMLElement>('.quick-launcher-tab--active')
    expect(activeTab).toBeTruthy()
    expect(activeTab).toHaveClass('quick-launcher-tab--with-delete')
    fireEvent.doubleClick(activeTab as HTMLElement)

    const editingTab = document.querySelector<HTMLElement>('.quick-launcher-tab--editing')
    const input = editingTab?.querySelector<HTMLInputElement>('.quick-launcher-tab__input')
    expect(editingTab).toBeTruthy()
    expect(editingTab).toHaveClass('quick-launcher-tab--active')
    expect(input).toBeTruthy()
    expect(input).toHaveAttribute('size', String('Common 811'.length))
  })

  it('adds a URL shortcut from the item dialog', async () => {
    const updateState = renderLauncher(createComponent(createDefaultQuickLauncherState(TIMESTAMP)))

    clickAddItem()
    fireEvent.pointerDown(document.querySelector<HTMLButtonElement>('.quick-launcher-kind-trigger') as HTMLButtonElement)
    const kindOptions = await screen.findAllByRole('menuitem')
    fireEvent.click(kindOptions[3])

    const dialog = screen.getByRole('dialog')
    const inputs = dialog.querySelectorAll<HTMLInputElement>('input')
    fireEvent.change(inputs[0], { target: { value: 'Docs' } })
    fireEvent.change(inputs[1], { target: { value: 'https://example.com/docs' } })
    clickDialogSubmit()

    const state = lastLauncherState(updateState)
    const item = Object.values(state.items)[0]
    expect(item).toMatchObject({
      kind: 'url',
      name: 'Docs',
      url: 'https://example.com/docs'
    })
    expect(state.tabs[0].itemIds).toEqual([item.id])
  })

  it('adds a command shortcut with the styled shell menu', async () => {
    const updateState = renderLauncher(createComponent(createDefaultQuickLauncherState(TIMESTAMP)))

    clickAddItem()
    fireEvent.pointerDown(document.querySelector<HTMLButtonElement>('.quick-launcher-kind-trigger') as HTMLButtonElement)
    const kindOptions = await screen.findAllByRole('menuitem')
    fireEvent.click(kindOptions[4])

    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('select')).toBeNull()
    const shellTrigger = dialog.querySelector<HTMLButtonElement>('.quick-launcher-shell-trigger')
    expect(shellTrigger).toBeTruthy()
    expect(shellTrigger).toHaveTextContent('PowerShell')

    fireEvent.pointerDown(shellTrigger as HTMLButtonElement)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'cmd' }))

    const inputs = dialog.querySelectorAll<HTMLInputElement>('input')
    const commandInput = dialog.querySelector<HTMLTextAreaElement>('textarea')
    expect(commandInput).toBeTruthy()
    fireEvent.change(inputs[0], { target: { value: 'Dev' } })
    fireEvent.change(commandInput as HTMLTextAreaElement, { target: { value: 'npm run dev' } })
    fireEvent.change(inputs[1], { target: { value: 'D:\\repo' } })
    clickDialogSubmit()

    const state = lastLauncherState(updateState)
    const item = Object.values(state.items)[0]
    expect(item).toMatchObject({
      kind: 'command',
      name: 'Dev',
      shell: 'cmd',
      command: 'npm run dev',
      cwd: 'D:\\repo'
    })
  })

  it('renders shortcut tiles with only icons and names', async () => {
    const iconDataUrl = 'data:image/png;base64,aWNvbg=='
    launcherApi.chooseFile.mockResolvedValueOnce({
      path: 'C:\\Tools\\Docker Desktop.lnk',
      iconDataUrl
    })
    const updateState = renderLauncher(createComponent(createDefaultQuickLauncherState(TIMESTAMP)))

    clickAddItem()
    const dialog = screen.getByRole('dialog')
    const browseButton = dialog.querySelector<HTMLButtonElement>('.quick-launcher-form__browse button')
    expect(browseButton).toBeTruthy()
    fireEvent.click(browseButton as HTMLButtonElement)
    await waitFor(() => expect(launcherApi.chooseFile).toHaveBeenCalledWith({ kind: 'app' }))
    clickDialogSubmit()

    const state = lastLauncherState(updateState)
    const item = Object.values(state.items)[0]
    expect(item).toMatchObject({
      kind: 'app',
      targetPath: 'C:\\Tools\\Docker Desktop.lnk',
      iconDataUrl
    })

    cleanup()
    renderLauncher(createComponent(state))

    expect(screen.getByText('Docker Desktop.lnk')).toBeInTheDocument()
    expect(screen.queryByText('C:\\Tools\\Docker Desktop.lnk')).not.toBeInTheDocument()
    expect(document.querySelector('.quick-launcher-tile__icon img')).toHaveAttribute('src', iconDataUrl)

    cleanup()
    let visualState = createDefaultQuickLauncherState(TIMESTAMP)
    visualState = createQuickLauncherItem(visualState, 'default', 'youtube', { kind: 'url', name: 'YouTube', url: 'https://www.youtube.com/watch?v=abc' }, TIMESTAMP)
    visualState = createQuickLauncherItem(visualState, 'default', 'dev', { kind: 'command', name: 'Dev', shell: 'powershell', command: 'npm run dev' }, TIMESTAMP)
    renderLauncher(createComponent(visualState))

    expect(screen.getByText('YouTube')).toBeInTheDocument()
    expect(screen.getByText('Dev')).toBeInTheDocument()
    expect(screen.queryByText('https://www.youtube.com/watch?v=abc')).not.toBeInTheDocument()
    expect(screen.queryByText(/powershell/)).not.toBeInTheDocument()
    expect(screen.queryByText(/npm run dev/)).not.toBeInTheDocument()
    expect(document.querySelector('.quick-launcher-tile__summary')).toBeNull()
  })

  it('renders shortcut drag previews outside the clipped module body', async () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherItem(state, 'default', 'docker', { kind: 'app', name: 'Docker Desktop', targetPath: 'C:\\Tools\\Docker Desktop.lnk' }, TIMESTAMP)
    renderLauncher(createComponent(state))

    const module = document.body.querySelector('.quick-launcher-module')
    const dragTarget = document.body.querySelector<HTMLElement>('.quick-launcher-tile__launch')
    expect(module).toBeInTheDocument()
    expect(dragTarget).toBeInTheDocument()

    await act(async () => {
      fireEvent.mouseDown(dragTarget!, { clientX: 120, clientY: 120, button: 0 })
      fireEvent.mouseMove(document, { clientX: 150, clientY: 152, buttons: 1 })
    })

    await waitFor(() => {
      const overlay = document.body.querySelector('.quick-launcher-drag-overlay')
      const sourceTile = document.body.querySelector<HTMLElement>('.quick-launcher-tile--dragging')
      expect(overlay).toBeInTheDocument()
      expect(overlay?.querySelector('.quick-launcher-tile--overlay')).toHaveTextContent('Docker Desktop')
      expect(module?.contains(overlay)).toBe(false)
      expect(sourceTile?.style.visibility).toBe('hidden')
    })

    await act(async () => {
      fireEvent.mouseUp(document)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
  })

  it('renders tab drag previews outside the scrollable tab strip', async () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherTab(state, 'work', '常用 3', TIMESTAMP)
    renderLauncher(createComponent(state))

    const tabStrip = document.body.querySelector('.quick-launcher-tabs')
    const tabs = document.body.querySelectorAll<HTMLElement>('.quick-launcher-tab')
    expect(tabStrip).toBeInTheDocument()
    expect(tabs[1]).toBeInTheDocument()
    expect(document.querySelector('.quick-launcher-tab__drag')).toBeNull()

    await act(async () => {
      fireEvent.mouseDown(tabs[1], { clientX: 120, clientY: 24, button: 0 })
      fireEvent.mouseMove(document, { clientX: 80, clientY: 24, buttons: 1 })
    })

    await waitFor(() => {
      const overlay = document.body.querySelector('.quick-launcher-drag-overlay')
      const sourceTab = document.body.querySelector<HTMLElement>('.quick-launcher-tab--dragging')
      expect(overlay).toBeInTheDocument()
      expect(overlay).toHaveStyle({ width: 'max-content', height: 'auto' })
      expect(overlay?.querySelector('.quick-launcher-tab--overlay')).toHaveTextContent('常用 3')
      expect(tabStrip?.contains(overlay)).toBe(false)
      expect(sourceTab).toHaveClass('quick-launcher-tab--dragging')
      expect(sourceTab?.style.visibility).toBe('')
    })

    await act(async () => {
      fireEvent.mouseUp(document)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
  })

  it('scrolls overflowing tabs horizontally with the mouse wheel', () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    for (let index = 1; index <= 8; index += 1) {
      state = createQuickLauncherTab(state, `tab-${index}`, `常用 ${index}`, TIMESTAMP)
    }
    renderLauncher(createComponent(state))

    const tabStrip = document.body.querySelector<HTMLElement>('.quick-launcher-tabs')
    expect(tabStrip).toBeInTheDocument()
    setElementSize(tabStrip!, 'clientWidth', 200)
    setElementSize(tabStrip!, 'scrollWidth', 600)

    fireEvent.wheel(tabStrip!, { deltaY: 48 })
    expect(tabStrip?.scrollLeft).toBe(48)

    fireEvent.wheel(tabStrip!, { deltaY: -16 })
    expect(tabStrip?.scrollLeft).toBe(32)

    const ctrlWheelEvent = createEvent.wheel(tabStrip!, { deltaY: 48 })
    Object.defineProperty(ctrlWheelEvent, 'ctrlKey', { value: true })
    fireEvent(tabStrip!, ctrlWheelEvent)
    expect(tabStrip?.scrollLeft).toBe(32)
  })

  it('shows launch errors without deleting the shortcut', async () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherItem(state, 'default', 'missing-file', { kind: 'file', name: 'Missing file', targetPath: 'D:\\missing.txt' }, TIMESTAMP)
    launcherApi.open.mockRejectedValueOnce(new Error('Target does not exist'))
    renderLauncher(createComponent(state))

    clickTileLaunch()

    expect(await screen.findByText(/Target does not exist/)).toBeInTheDocument()
    expect(screen.getByText('Missing file')).toBeInTheDocument()
  })

  it('prevents duplicate launches while the same shortcut is opening', async () => {
    vi.useFakeTimers()
    let resolveOpen!: () => void
    launcherApi.open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOpen = () => resolve({ ok: true })
        })
    )
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherItem(state, 'default', 'notes', { kind: 'file', name: 'Notes', targetPath: 'D:\\notes.txt' }, TIMESTAMP)
    renderLauncher(createComponent(state))

    const launchButton = document.querySelector<HTMLButtonElement>('.quick-launcher-tile__launch')
    expect(launchButton).toBeTruthy()
    await act(async () => {
      fireEvent.click(launchButton as HTMLButtonElement)
    })
    expect(launchButton).toBeDisabled()

    fireEvent.click(launchButton as HTMLButtonElement)
    expect(launcherApi.open).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveOpen()
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(850)
      await Promise.resolve()
    })
    expect(launchButton).not.toBeDisabled()
  })

  it('opens command shortcuts through the native launcher', async () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherItem(state, 'default', 'dev', { kind: 'command', name: 'Dev', shell: 'cmd', command: 'npm run dev', cwd: 'D:\\repo' }, TIMESTAMP)
    renderLauncher(createComponent(state))

    clickTileLaunch()

    await waitFor(() =>
      expect(launcherApi.open).toHaveBeenCalledWith({
        kind: 'command',
        shell: 'cmd',
        command: 'npm run dev',
        cwd: 'D:\\repo'
      })
    )
  })

  it('debounces command shortcut launches after the native launcher resolves', async () => {
    vi.useFakeTimers()
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherItem(state, 'default', 'dev', { kind: 'command', name: 'Dev', shell: 'cmd', command: 'npm run dev' }, TIMESTAMP)
    renderLauncher(createComponent(state))

    const launchButton = document.querySelector<HTMLButtonElement>('.quick-launcher-tile__launch')
    expect(launchButton).toBeTruthy()

    await act(async () => {
      fireEvent.click(launchButton as HTMLButtonElement)
      await Promise.resolve()
    })
    expect(launcherApi.open).toHaveBeenCalledTimes(1)
    expect(launchButton).toBeDisabled()

    fireEvent.click(launchButton as HTMLButtonElement)
    expect(launcherApi.open).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(850)
      await Promise.resolve()
    })
    expect(launchButton).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(launchButton as HTMLButtonElement)
      await Promise.resolve()
    })
    expect(launcherApi.open).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(850)
      await Promise.resolve()
    })
  })

  it('confirms deleting a tab that contains shortcuts', () => {
    let state = createDefaultQuickLauncherState(TIMESTAMP)
    state = createQuickLauncherTab(state, 'work', 'Work', TIMESTAMP)
    state = createQuickLauncherItem(state, 'work', 'cmd', { kind: 'command', name: 'Dev', shell: 'powershell', command: 'npm run dev' }, TIMESTAMP)
    const updateState = renderLauncher(createComponent(state))

    const deleteButtons = document.querySelectorAll<HTMLButtonElement>('.quick-launcher-tab__delete')
    expect(deleteButtons).toHaveLength(1)
    expect(deleteButtons[0]).toHaveAttribute('aria-label', '删除 Work')
    expect(screen.queryByLabelText('删除 Favorites')).not.toBeInTheDocument()
    fireEvent.click(deleteButtons[0])
    const confirmButton = screen.getByRole('dialog').querySelector<HTMLButtonElement>('.tool-button.danger')
    expect(confirmButton).toBeTruthy()
    fireEvent.click(confirmButton as HTMLButtonElement)

    const nextState = lastLauncherState(updateState)
    expect(nextState.tabs.map((tab) => tab.id)).toEqual(['default'])
    expect(nextState.items.cmd).toBeUndefined()
  })
})
