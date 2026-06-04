import { render, act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { TerminalComponent } from './terminal-component'

type MockTerminal = {
  cols: number
  rows: number
  textarea?: HTMLTextAreaElement
  _core: {
    _mouseService: {
      getCoords: ReturnType<typeof vi.fn>
      getMouseReportCoords: ReturnType<typeof vi.fn>
    }
    _selectionService: {
      _screenElement?: HTMLElement
      _getMouseEventScrollAmount: ReturnType<typeof vi.fn>
    }
  }
  parser: {
    registerCsiHandler: ReturnType<typeof vi.fn>
  }
  focus: ReturnType<typeof vi.fn>
  loadAddon: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  attachCustomKeyEventHandler: ReturnType<typeof vi.fn>
  attachCustomWheelEventHandler: ReturnType<typeof vi.fn>
  hasSelection: ReturnType<typeof vi.fn>
  getSelection: ReturnType<typeof vi.fn>
  clearSelection: ReturnType<typeof vi.fn>
  paste: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  writeln: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const terminalInstances = vi.hoisted(() => [] as MockTerminal[])
const terminalOptions = vi.hoisted(() => [] as any[])
let consoleInfo: ReturnType<typeof vi.spyOn>

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {}
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {}
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation((options) => {
    terminalOptions.push(options)

    const selectionService: MockTerminal['_core']['_selectionService'] = {
      _getMouseEventScrollAmount: vi.fn(function (this: MockTerminal['_core']['_selectionService'], event: MouseEvent) {
        const screenElement = this._screenElement
        if (!screenElement) return 0

        const rect = screenElement.getBoundingClientRect()
        const topPadding = parseInt(window.getComputedStyle(screenElement).getPropertyValue('padding-top'))
        const terminalHeight = 100
        const offset = event.clientY - rect.top - topPadding

        if (offset >= 0 && offset <= terminalHeight) return 0
        return offset > terminalHeight ? 1 : -1
      })
    }

    const instance: MockTerminal = {
      cols: 100,
      rows: 30,
      _core: {
        _mouseService: {
          getCoords: vi.fn((event: MouseEvent) => [event.clientX, event.clientY]),
          getMouseReportCoords: vi.fn((event: MouseEvent) => ({ x: event.clientX, y: event.clientY }))
        },
        _selectionService: selectionService
      },
      parser: {
        registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() }))
      },
      focus: vi.fn(),
      loadAddon: vi.fn(),
      open: vi.fn((element: HTMLElement) => {
        const screen = document.createElement('div')
        screen.className = 'xterm-screen'
        const textarea = document.createElement('textarea')
        textarea.className = 'xterm-helper-textarea'
        screen.appendChild(textarea)
        element.appendChild(screen)
        selectionService._screenElement = screen
        instance.textarea = textarea
      }),
      attachCustomKeyEventHandler: vi.fn(),
      attachCustomWheelEventHandler: vi.fn(),
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ''),
      clearSelection: vi.fn(),
      paste: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      writeln: vi.fn(),
      dispose: vi.fn()
    }

    terminalInstances.push(instance)
    return instance
  })
}))

function createTerminalComponent(): CanvasComponent {
  const timestamp = '2026-05-20T00:00:00.000Z'

  return {
    id: 'terminal-1',
    type: 'terminal',
    title: 'Terminal',
    frame: { x: 0, y: 0, width: 320, height: 240 },
    zIndex: 1,
    config: { cwd: 'C:\\Users\\xhwz2', shell: 'powershell.exe' },
    state: { cwd: 'C:\\Users\\xhwz2' },
    bindings: {},
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function installAtlasMocks(): void {
  const terminalApi: any = {
    create: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      cwd: 'C:\\Users\\xhwz2',
      shell: 'powershell.exe'
    }),
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    closeComponent: vi.fn(),
    savePastedAsset: vi.fn().mockResolvedValue({ path: 'C:\\Temp\\atlas-terminal-clipboard.png' }),
    saveClipboardImage: vi.fn().mockResolvedValue({
      saved: false,
      reason: 'empty',
      formats: []
    }),
    readClipboardFiles: vi.fn().mockResolvedValue({
      paths: [],
      formats: []
    }),
    onData: vi.fn(() => () => undefined),
    onCwd: vi.fn(() => () => undefined),
    onAgentCommand: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined)
  }

  ;(window as any).atlas = {
    terminal: terminalApi,
    filesystem: {
      getPathForFile: vi.fn(() => '')
    },
    clipboard: {
      readText: vi.fn(() => ''),
      writeText: vi.fn()
    }
  }

  ;(window as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }
  ;(window as any).cancelAnimationFrame = vi.fn()
}

function terminalTextarea(): HTMLTextAreaElement {
  const element = document.querySelector('.xterm-helper-textarea')
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error('Terminal textarea element not found')
  }

  return element
}

function dispatchPasteEvent(
  target: HTMLElement,
  clipboardData: {
    files?: File[]
    items?: Array<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>
    getData?: (type: string) => string
  }
): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      files: (clipboardData.files ?? []) as unknown as FileList,
      items: clipboardData.items ?? [],
      getData: clipboardData.getData ?? (() => ''),
      types:
        (clipboardData.files && clipboardData.files.length > 0) || (clipboardData.items && clipboardData.items.length > 0)
          ? ['Files']
          : ['text/plain']
    }
  })

  fireEvent(target, event)
  return event
}

async function advanceShortcutPasteFallback(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(100)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('TerminalComponent', () => {
  beforeEach(() => {
    terminalInstances.splice(0, terminalInstances.length)
    terminalOptions.splice(0, terminalOptions.length)
    consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    installAtlasMocks()
  })

  afterEach(() => {
    consoleInfo.mockRestore()
    vi.useRealTimers()
  })

  it('uses a thin terminal cursor', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(terminalOptions[0]).toMatchObject({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      cursorInactiveStyle: 'bar'
    })
  })

  it('passes an undispatched initial command and marks it dispatched', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()
    component.config.initialCommand = 'claude --resume alpha-session'
    vi.mocked(window.atlas.terminal.create).mockResolvedValue({
      sessionId: 'session-1',
      cwd: 'C:\\Users\\xhwz2',
      shell: 'powershell.exe',
      didRunInitialCommand: true
    })

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.atlas.terminal.create).toHaveBeenCalledWith(expect.objectContaining({
      initialCommand: 'claude --resume alpha-session',
      autoConfirmWorkspaceTrust: true
    }))
    expect(updateState).toHaveBeenCalledWith(
      {
        initialCommandDispatched: true,
        agentRestore: expect.objectContaining({
          source: 'claude',
          sessionId: 'alpha-session',
          command: 'claude --resume alpha-session',
          cwd: 'C:\\Users\\xhwz2'
        })
      },
      true
    )
  })

  it('passes a saved agent resume command after the one-shot dispatch', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()
    component.config.initialCommand = 'claude --resume alpha-session'
    component.state.initialCommandDispatched = true

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(window.atlas.terminal.create).toHaveBeenCalledWith(expect.objectContaining({
      initialCommand: 'claude --resume alpha-session',
      autoConfirmWorkspaceTrust: true
    }))
    expect(updateState).not.toHaveBeenCalledWith({ initialCommandDispatched: true }, true)
  })

  it('does not pass a non-agent initial command after it has been dispatched', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()
    component.config.initialCommand = 'npm test'
    component.state.initialCommandDispatched = true

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(window.atlas.terminal.create).toHaveBeenCalledWith(expect.objectContaining({
      initialCommand: undefined,
      autoConfirmWorkspaceTrust: false
    }))
  })

  it('persists manually entered agent resume commands for future restores', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()
    let agentCommandListener: ((event: any) => void) | null = null
    vi.mocked(window.atlas.terminal.onAgentCommand).mockImplementation((_sessionId, listener) => {
      agentCommandListener = listener
      return () => undefined
    })

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(agentCommandListener).toBeTypeOf('function')
    act(() => {
      agentCommandListener?.({
        sessionId: 'session-1',
        componentId: 'terminal-1',
        source: 'codex',
        cwd: 'D:\\projects\\AtlasOS',
        command: 'codex resume codex-session'
      })
    })

    expect(updateState).toHaveBeenCalledWith(
      {
        agentRestore: expect.objectContaining({
          source: 'codex',
          sessionId: 'codex-session',
          command: 'codex resume codex-session',
          cwd: 'D:\\projects\\AtlasOS'
        })
      },
      true
    )
  })

  it('normalizes xterm mouse coordinates when the canvas is zoomed', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const screenElement = document.createElement('div')
    Object.defineProperties(screenElement, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 }
    })
    screenElement.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 10,
          top: 20,
          width: 200,
          height: 200,
          right: 210,
          bottom: 220,
          x: 10,
          y: 20,
          toJSON: () => ({})
        }) as DOMRect
    )

    const mouseService = terminalInstances[0]._core._mouseService

    expect(mouseService.getCoords({ clientX: 110, clientY: 120 } as MouseEvent, screenElement)).toEqual([60, 70])
    expect(mouseService.getMouseReportCoords({ clientX: 110, clientY: 120 } as MouseEvent, screenElement)).toEqual({
      x: 60,
      y: 70
    })
  })

  it('normalizes xterm selection drag scroll checks when the canvas is zoomed', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const selectionService = terminalInstances[0]._core._selectionService
    const screenElement = selectionService._screenElement
    if (!screenElement) throw new Error('Terminal screen element not found')

    screenElement.style.paddingTop = '0px'
    Object.defineProperties(screenElement, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 }
    })
    screenElement.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 10,
          top: 20,
          width: 200,
          height: 200,
          right: 210,
          bottom: 220,
          x: 10,
          y: 20,
          toJSON: () => ({})
        }) as DOMRect
    )

    const mouseMoveInsideZoomedTerminal = { clientX: 110, clientY: 170 } as MouseEvent

    expect(selectionService._getMouseEventScrollAmount(mouseMoveInsideZoomedTerminal)).toBe(0)
  })

  it('copies the terminal selection with Ctrl+C and clears it so the next Ctrl+C can interrupt', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    terminalInstances[0].hasSelection.mockReturnValueOnce(true).mockReturnValue(false)
    terminalInstances[0].getSelection.mockReturnValue('selected text')

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0][0]
    const event = {
      type: 'keydown',
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    expect(keyHandler(event)).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(window.atlas.clipboard.writeText).toHaveBeenCalledWith('selected text')
    expect(terminalInstances[0].clearSelection).toHaveBeenCalledTimes(1)

    const nextEvent = {
      type: 'keydown',
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    expect(keyHandler(nextEvent)).toBe(true)
    expect(nextEvent.preventDefault).not.toHaveBeenCalled()
    expect(nextEvent.stopPropagation).not.toHaveBeenCalled()
  })

  it('does not crash when Ctrl+C copies before the preload clipboard API is available', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const navigatorWriteText = vi.fn().mockRejectedValue(new Error('denied'))
    const previousClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

    ;(window.atlas as any).clipboard = undefined
    ;(document as any).execCommand = vi.fn(() => true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: navigatorWriteText }
    })

    try {
      render(
        <TerminalComponent
          canvasId="canvas-1"
          component={component}
          updateConfig={updateConfig}
          updateState={updateState}
          setTitle={setTitle}
          isNodeSelected={false}
        />
      )

      await act(async () => {
        await Promise.resolve()
      })

      terminalInstances[0].hasSelection.mockReturnValue(true)
      terminalInstances[0].getSelection.mockReturnValue('selected text')

      const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0][0]
      const event = {
        type: 'keydown',
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as KeyboardEvent

      expect(() => keyHandler(event)).not.toThrow()
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
      expect(document.execCommand).toHaveBeenCalledWith('copy')
      expect(terminalInstances[0].clearSelection).toHaveBeenCalledTimes(1)
      expect(navigatorWriteText).not.toHaveBeenCalled()
      expect(consoleWarn).not.toHaveBeenCalled()
    } finally {
      if (previousClipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', previousClipboardDescriptor)
      } else {
        delete (navigator as any).clipboard
      }
      consoleWarn.mockRestore()
    }
  })

  it('keeps Ctrl+C as interrupt when there is no terminal selection', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0][0]
    const event = {
      type: 'keydown',
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    expect(keyHandler(event)).toBe(true)
    expect(window.atlas.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('blocks xterm from sending Ctrl+V as terminal input while preserving browser paste', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0][0]
    const event = {
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    expect(keyHandler(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it('pastes clipboard text from the native paste event', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      dispatchPasteEvent(terminalTextarea(), {
        getData: (type) => (type === 'text/plain' ? 'pasted text' : '')
      })
      await Promise.resolve()
    })

    expect(terminalInstances[0].paste).toHaveBeenCalledWith('pasted text')
  })

  it('prefers native paste text over native clipboard file and image probes', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    vi.mocked(window.atlas.terminal.readClipboardFiles).mockResolvedValue({
      paths: ['C:\\Users\\xhwz2\\Desktop\\image.png'],
      formats: ['CF_HDROP']
    })
    vi.mocked(window.atlas.terminal.saveClipboardImage).mockResolvedValue({
      saved: true,
      path: 'C:\\Temp\\atlas-terminal-native.png',
      width: 800,
      height: 600,
      byteLength: 4567,
      formats: ['CF_DIB']
    })

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      dispatchPasteEvent(terminalTextarea(), {
        getData: (type) => (type === 'text/plain' ? 'agent prompt text' : '')
      })
      await Promise.resolve()
    })

    expect(terminalInstances[0].paste).toHaveBeenCalledWith('agent prompt text')
    expect(window.atlas.terminal.readClipboardFiles).not.toHaveBeenCalled()
    expect(window.atlas.terminal.saveClipboardImage).not.toHaveBeenCalled()
  })

  it('lets the native paste event win after Ctrl+V and cancels the delayed fallback', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    vi.mocked(window.atlas.clipboard.readText).mockReturnValue('fallback text')

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    vi.useFakeTimers()

    await act(async () => {
      fireEvent.keyDown(terminalTextarea(), {
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
      dispatchPasteEvent(terminalTextarea(), {
        getData: (type) => (type === 'text/plain' ? 'event text' : '')
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    await advanceShortcutPasteFallback()

    expect(terminalInstances[0].paste).toHaveBeenCalledTimes(1)
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('event text')
    expect(window.atlas.clipboard.readText).not.toHaveBeenCalled()
  })

  it('does not cancel Ctrl+V before the browser can emit the native paste event', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    vi.useFakeTimers()

    const event = new KeyboardEvent('keydown', {
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      bubbles: true,
      cancelable: true
    })

    expect(terminalTextarea().dispatchEvent(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(window.atlas.clipboard.readText).not.toHaveBeenCalled()
  })

  it('pastes copied file paths from the terminal textarea paste event', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const imageFile = new File(['image-bytes'], 'photo.png', { type: 'image/png' })
    vi.mocked(window.atlas.filesystem.getPathForFile).mockReturnValue('C:\\Users\\xhwz2\\Pictures\\My Shot.png')

    await act(async () => {
      dispatchPasteEvent(terminalTextarea(), { files: [imageFile] })
      await Promise.resolve()
    })

    expect(window.atlas.terminal.savePastedAsset).not.toHaveBeenCalled()
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('"C:\\Users\\xhwz2\\Pictures\\My Shot.png" ')
  })

  it('reads screenshot images from clipboard items and inserts their temp path', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const screenshotFile = new File(['screenshot-bytes'], 'clipboard.png', { type: 'image/png' })

    await act(async () => {
      dispatchPasteEvent(terminalTextarea(), {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => screenshotFile
          }
        ]
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.atlas.terminal.savePastedAsset).toHaveBeenCalledTimes(1)
    expect(window.atlas.terminal.savePastedAsset).toHaveBeenCalledWith({
      dataBase64: expect.any(String),
      mimeType: 'image/png',
      sourceName: 'clipboard.png'
    })
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('C:\\Temp\\atlas-terminal-clipboard.png ')
  })

  it('infers an image MIME type from pasted clipboard file names', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const screenshotFile = new File(['jpeg-bytes'], 'clipboard.jpeg')

    await act(async () => {
      dispatchPasteEvent(terminalTextarea(), {
        items: [
          {
            kind: 'file',
            type: '',
            getAsFile: () => screenshotFile
          }
        ]
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.atlas.terminal.savePastedAsset).toHaveBeenCalledWith({
      dataBase64: expect.any(String),
      mimeType: 'image/jpeg',
      sourceName: 'clipboard.jpeg'
    })
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('C:\\Temp\\atlas-terminal-clipboard.png ')
  })

  it('saves generated clipboard image files when Electron cannot resolve a file path', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    vi.mocked(window.atlas.filesystem.getPathForFile).mockImplementation(() => {
      throw new Error('No backing file path')
    })

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const screenshotFile = new File(['wechat-screenshot'], 'wechat.png', { type: 'image/png' })

    await act(async () => {
      dispatchPasteEvent(terminalTextarea(), {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => screenshotFile
          }
        ]
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.atlas.terminal.savePastedAsset).toHaveBeenCalledWith({
      dataBase64: expect.any(String),
      mimeType: 'image/png',
      sourceName: 'wechat.png'
    })
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('C:\\Temp\\atlas-terminal-clipboard.png ')
  })

  it('does not persist pathless non-image clipboard files', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    const documentFile = new File(['not-an-image'], 'report.pdf', { type: 'application/pdf' })

    await act(async () => {
      dispatchPasteEvent(terminalTextarea(), {
        items: [
          {
            kind: 'file',
            type: 'application/pdf',
            getAsFile: () => documentFile
          }
        ]
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.atlas.terminal.savePastedAsset).not.toHaveBeenCalled()
    expect(terminalInstances[0].paste).not.toHaveBeenCalled()
    expect(document.querySelector('.terminal-module__paste-feedback--error')).not.toBeNull()
  })

  it('falls back to text before probing native clipboard images', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    vi.mocked(window.atlas.clipboard.readText).mockReturnValue('plain text')
    vi.mocked(window.atlas.terminal.saveClipboardImage).mockResolvedValue({
      saved: false,
      reason: 'empty',
      formats: ['CF_UNICODETEXT']
    })

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    vi.useFakeTimers()

    await act(async () => {
      fireEvent.keyDown(terminalTextarea(), {
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    })

    await advanceShortcutPasteFallback()

    expect(window.atlas.terminal.saveClipboardImage).not.toHaveBeenCalled()
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('plain text')
  })

  it('pastes native clipboard file paths from Ctrl+V when no paste event exposes files', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    vi.mocked(window.atlas.terminal.readClipboardFiles).mockResolvedValue({
      paths: ['C:\\Users\\xhwz2\\Desktop\\My File.txt', 'D:\\Projects\\AtlasOS\\README.md'],
      formats: ['CF_HDROP']
    })
    vi.mocked(window.atlas.terminal.saveClipboardImage).mockResolvedValue({
      saved: true,
      path: 'C:\\Temp\\atlas-terminal-native.png',
      width: 800,
      height: 600,
      byteLength: 4567,
      formats: ['CF_DIB']
    })

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    vi.useFakeTimers()

    await act(async () => {
      fireEvent.keyDown(terminalTextarea(), {
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    })

    await advanceShortcutPasteFallback()

    expect(window.atlas.terminal.readClipboardFiles).toHaveBeenCalled()
    expect(window.atlas.terminal.saveClipboardImage).not.toHaveBeenCalled()
    expect(terminalInstances[0].paste).toHaveBeenCalledWith(
      '"C:\\Users\\xhwz2\\Desktop\\My File.txt" D:\\Projects\\AtlasOS\\README.md '
    )
  })

  it('prefers the native paste image payload over the Ctrl+V fallback', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    vi.useFakeTimers()

    const screenshotFile = new File(['event-screenshot'], 'screenshot.png', { type: 'image/png' })

    await act(async () => {
      fireEvent.keyDown(terminalTextarea(), {
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
      dispatchPasteEvent(terminalTextarea(), {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => screenshotFile
          }
        ]
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    await advanceShortcutPasteFallback()

    expect(window.atlas.terminal.saveClipboardImage).not.toHaveBeenCalled()
    expect(window.atlas.terminal.savePastedAsset).toHaveBeenCalledTimes(1)
    expect(window.atlas.terminal.savePastedAsset).toHaveBeenCalledWith({
      dataBase64: expect.any(String),
      mimeType: 'image/png',
      sourceName: 'screenshot.png'
    })
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('C:\\Temp\\atlas-terminal-clipboard.png ')
  })

  it('falls back to the native clipboard image when the paste event has no exposed files', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    vi.mocked(window.atlas.terminal.saveClipboardImage).mockResolvedValue({
      saved: true,
      path: 'C:\\Temp\\atlas-terminal-wechat.png',
      width: 1280,
      height: 720,
      byteLength: 12345,
      formats: ['CF_DIB', 'PNG']
    })

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      dispatchPasteEvent(terminalTextarea(), {
        getData: () => ''
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.atlas.terminal.saveClipboardImage).toHaveBeenCalled()
    expect(window.atlas.terminal.savePastedAsset).not.toHaveBeenCalled()
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('C:\\Temp\\atlas-terminal-wechat.png ')
  })

  it('reads screenshot images from the standard Clipboard API on Ctrl+V', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()
    const previousClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const getType = vi.fn().mockResolvedValue(new Blob(['browser-image'], { type: 'image/png' }))
    const read = vi.fn().mockResolvedValue([{ types: ['image/png'], getType }])

    vi.mocked(window.atlas.clipboard.readText).mockReturnValue('')
    vi.mocked(window.atlas.terminal.saveClipboardImage).mockResolvedValue({
      saved: true,
      path: 'C:\\Temp\\atlas-terminal-native.png',
      width: 800,
      height: 600,
      byteLength: 4567,
      formats: ['CF_DIB']
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read }
    })

    try {
      render(
        <TerminalComponent
          canvasId="canvas-1"
          component={component}
          updateConfig={updateConfig}
          updateState={updateState}
          setTitle={setTitle}
          isNodeSelected={false}
        />
      )

      await act(async () => {
        await Promise.resolve()
      })

      vi.useFakeTimers()

      await act(async () => {
        fireEvent.keyDown(terminalTextarea(), {
          key: 'v',
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false
        })
      })

      await advanceShortcutPasteFallback()

      expect(read).toHaveBeenCalled()
      expect(getType).toHaveBeenCalledWith('image/png')
      expect(window.atlas.terminal.saveClipboardImage).not.toHaveBeenCalled()
      expect(window.atlas.terminal.savePastedAsset).toHaveBeenCalledWith({
        dataBase64: 'YnJvd3Nlci1pbWFnZQ==',
        mimeType: 'image/png',
        sourceName: 'clipboard-image'
      })
      expect(terminalInstances[0].paste).toHaveBeenCalledWith('C:\\Temp\\atlas-terminal-clipboard.png ')
    } finally {
      if (previousClipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', previousClipboardDescriptor)
      } else {
        delete (navigator as any).clipboard
      }
    }
  })

  it('pastes screenshot images from Ctrl+V even when the browser paste event exposes no file payload', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    vi.mocked(window.atlas.clipboard.readText).mockReturnValue('')
    vi.mocked(window.atlas.terminal.saveClipboardImage).mockResolvedValue({
      saved: true,
      path: 'C:\\Temp\\atlas-terminal-wechat.png',
      width: 1280,
      height: 720,
      byteLength: 12345,
      formats: ['CF_DIB', 'PNG']
    })

    render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    vi.useFakeTimers()

    await act(async () => {
      fireEvent.keyDown(terminalTextarea(), {
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    })

    await advanceShortcutPasteFallback()

    expect(window.atlas.terminal.saveClipboardImage).toHaveBeenCalled()
    expect(window.atlas.terminal.savePastedAsset).not.toHaveBeenCalled()
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('C:\\Temp\\atlas-terminal-wechat.png ')
  })

  it('focuses the terminal when the node becomes selected', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()

    const { rerender } = render(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected={false}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(terminalInstances).toHaveLength(1)
    expect(terminalInstances[0].focus).not.toHaveBeenCalled()

    rerender(
      <TerminalComponent
        canvasId="canvas-1"
        component={component}
        updateConfig={updateConfig}
        updateState={updateState}
        setTitle={setTitle}
        isNodeSelected
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(terminalInstances[0].focus).toHaveBeenCalledTimes(1)
  })
})
