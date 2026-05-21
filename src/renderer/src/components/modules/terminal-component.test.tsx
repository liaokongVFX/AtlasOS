import { render, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasComponent } from '@shared/schema'
import { TerminalComponent } from './terminal-component'

type MockTerminal = {
  cols: number
  rows: number
  _core: {
    _mouseService: {
      getCoords: ReturnType<typeof vi.fn>
      getMouseReportCoords: ReturnType<typeof vi.fn>
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
  paste: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  writeln: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const terminalInstances = vi.hoisted(() => [] as MockTerminal[])
const terminalOptions = vi.hoisted(() => [] as any[])

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

    const instance: MockTerminal = {
      cols: 100,
      rows: 30,
      _core: {
        _mouseService: {
          getCoords: vi.fn((event: MouseEvent) => [event.clientX, event.clientY]),
          getMouseReportCoords: vi.fn((event: MouseEvent) => ({ x: event.clientX, y: event.clientY }))
        }
      },
      parser: {
        registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() }))
      },
      focus: vi.fn(),
      loadAddon: vi.fn(),
      open: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      attachCustomWheelEventHandler: vi.fn(),
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ''),
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
    onData: vi.fn(() => () => undefined),
    onCwd: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined)
  }

  ;(window as any).atlas = {
    terminal: terminalApi,
    clipboard: {
      readText: vi.fn(() => 'pasted text'),
      writeText: vi.fn()
    }
  }

  ;(window as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }
  ;(window as any).cancelAnimationFrame = vi.fn()
}

describe('TerminalComponent', () => {
  beforeEach(() => {
    terminalInstances.splice(0, terminalInstances.length)
    terminalOptions.splice(0, terminalOptions.length)
    installAtlasMocks()
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

  it('copies the terminal selection with Ctrl+C without interrupting the process', async () => {
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

    expect(keyHandler(event)).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(window.atlas.clipboard.writeText).toHaveBeenCalledWith('selected text')
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

  it('pastes clipboard text with Ctrl+V', async () => {
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
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as KeyboardEvent

    expect(keyHandler(event)).toBe(false)

    await act(async () => {
      await Promise.resolve()
    })

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(window.atlas.clipboard.readText).toHaveBeenCalled()
    expect(terminalInstances[0].paste).toHaveBeenCalledWith('pasted text')
  })

  it('lets Ctrl+V use the native paste path when the preload clipboard API is unavailable', async () => {
    const updateState = vi.fn()
    const updateConfig = vi.fn()
    const setTitle = vi.fn()
    const component = createTerminalComponent()
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const navigatorReadText = vi.fn().mockRejectedValue(new Error('denied'))
    const previousClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

    ;(window.atlas as any).clipboard = undefined
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: navigatorReadText }
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

      const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0][0]
      const event = {
        type: 'keydown',
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      } as unknown as KeyboardEvent

      expect(keyHandler(event)).toBe(true)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(event.stopPropagation).not.toHaveBeenCalled()
      expect(navigatorReadText).not.toHaveBeenCalled()
      expect(terminalInstances[0].paste).not.toHaveBeenCalled()
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
