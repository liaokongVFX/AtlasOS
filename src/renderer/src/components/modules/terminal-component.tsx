import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { asString } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type Disposable = {
  dispose: () => void
}

type XtermMouseEvent = {
  clientX: number
  clientY: number
}

type XtermMouseService = {
  getCoords: (event: XtermMouseEvent, element: HTMLElement, ...args: unknown[]) => unknown
  getMouseReportCoords?: (event: MouseEvent, element: HTMLElement) => unknown
}

type ClipboardApi = {
  readText?: () => string | Promise<string>
  writeText?: (text: string) => void | Promise<void>
}

const MIN_TRANSFORM_SCALE_DELTA = 0.001

function createUnscaledMouseEvent<T extends XtermMouseEvent>(event: T, element: HTMLElement): T {
  const rect = element.getBoundingClientRect()
  const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1
  const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1

  if (Math.abs(scaleX - 1) < MIN_TRANSFORM_SCALE_DELTA && Math.abs(scaleY - 1) < MIN_TRANSFORM_SCALE_DELTA) {
    return event
  }

  const adjustedEvent = Object.create(event) as T
  Object.defineProperties(adjustedEvent, {
    clientX: {
      value: rect.left + (event.clientX - rect.left) / (scaleX || 1)
    },
    clientY: {
      value: rect.top + (event.clientY - rect.top) / (scaleY || 1)
    }
  })

  return adjustedEvent
}

function installTransformedCanvasMouseFix(terminal: Terminal): Disposable {
  const mouseService = (terminal as unknown as { _core?: { _mouseService?: XtermMouseService } })._core?._mouseService
  if (!mouseService) return { dispose: () => undefined }

  const originalGetCoords = mouseService.getCoords
  const originalGetMouseReportCoords = mouseService.getMouseReportCoords

  mouseService.getCoords = function getCoordsWithCanvasTransformFix(event, element, ...args) {
    return originalGetCoords.call(mouseService, createUnscaledMouseEvent(event, element), element, ...args)
  }

  if (originalGetMouseReportCoords) {
    mouseService.getMouseReportCoords = function getMouseReportCoordsWithCanvasTransformFix(event, element) {
      return originalGetMouseReportCoords.call(mouseService, createUnscaledMouseEvent(event, element), element)
    }
  }

  return {
    dispose: () => {
      mouseService.getCoords = originalGetCoords
      mouseService.getMouseReportCoords = originalGetMouseReportCoords
    }
  }
}

function getClipboardApi(): ClipboardApi | undefined {
  return (window as unknown as { atlas?: { clipboard?: ClipboardApi } }).atlas?.clipboard
}

function copyTextWithTextArea(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false

  const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', 'true')
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.style.top = '0'
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textArea.remove()
    previousActiveElement?.focus({ preventScroll: true })
  }
}

function writeClipboardText(text: string): boolean {
  const writeText = getClipboardApi()?.writeText

  if (typeof writeText === 'function') {
    try {
      void Promise.resolve(writeText(text)).catch(() => undefined)
      return true
    } catch {
      return copyTextWithTextArea(text)
    }
  }

  return copyTextWithTextArea(text)
}

function readClipboardText(): Promise<string> | undefined {
  const readText = getClipboardApi()?.readText

  if (typeof readText !== 'function') return undefined

  try {
    return Promise.resolve(readText())
  } catch {
    return undefined
  }
}

function installTerminalClipboardShortcuts(terminal: Terminal): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.altKey || (!event.ctrlKey && !event.metaKey)) {
      return true
    }

    const key = event.key.toLowerCase()

    if (key === 'c' && terminal.hasSelection()) {
      event.preventDefault()
      event.stopPropagation()
      writeClipboardText(terminal.getSelection())
      return false
    }

    if (key === 'v') {
      const clipboardText = readClipboardText()
      if (!clipboardText) return true

      event.preventDefault()
      event.stopPropagation()
      void clipboardText
        .then((text) => {
          if (text) terminal.paste(text)
        })
        .catch(() => undefined)
      return false
    }

    return true
  })
}

export function TerminalComponent({ component, updateState, isNodeSelected = false }: AtlasComponentRendererProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const cwdRef = useRef(asString(component.state.cwd, asString(component.config.cwd)))
  const pendingFocusRef = useRef(false)
  const focusFrameRef = useRef<number | null>(null)
  const isNodeSelectedRef = useRef(isNodeSelected)

  isNodeSelectedRef.current = isNodeSelected
  cwdRef.current = asString(component.state.cwd, asString(component.config.cwd))

  const clearScheduledFocus = useCallback(() => {
    pendingFocusRef.current = false
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = null
    }
  }, [])

  const requestFocus = useCallback(() => {
    if (!isNodeSelectedRef.current) {
      clearScheduledFocus()
      return
    }

    pendingFocusRef.current = true
    const instance = terminalRef.current
    const container = containerRef.current
    if (!instance || !container?.isConnected) return

    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
    }

    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (!pendingFocusRef.current || !isNodeSelectedRef.current) return

      const currentInstance = terminalRef.current
      if (!currentInstance || !containerRef.current?.isConnected) return

      currentInstance.focus()
      pendingFocusRef.current = false
    })
  }, [clearScheduledFocus])

  useLayoutEffect(() => {
    if (isNodeSelected) {
      requestFocus()
      return
    }

    clearScheduledFocus()
  }, [clearScheduledFocus, isNodeSelected, requestFocus])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let initFrame: number | null = null
    let resizeFrame: number | null = null
    let terminal: Terminal | null = null
    let fitAddon: FitAddon | null = null
    let resizeObserver: ResizeObserver | null = null
    let dataDisposable: Disposable | null = null
    let transformedCanvasMouseFix: Disposable | null = null
    let disposeData: () => void = () => undefined
    let disposeExit: () => void = () => undefined

    const fitAndResize = (sendResize: boolean): void => {
      if (disposed || !terminal || !fitAddon || !container.isConnected) return

      const rect = container.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return

      try {
        fitAddon.fit()
        if (sendResize && sessionIdRef.current) {
          void window.atlas.terminal.resize(sessionIdRef.current, terminal.cols, terminal.rows)
        }
      } catch (error) {
        console.warn('Failed to fit AtlasOS terminal', error)
      }
    }

    const scheduleFit = (): void => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame)
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        fitAndResize(true)
      })
    }

    const initializeTerminal = (): void => {
      if (disposed) return

      const instance = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 1,
        cursorInactiveStyle: 'bar',
        convertEol: true,
        fontFamily: 'JetBrains Mono, Consolas, "Cascadia Mono", monospace',
        fontSize: 13,
        theme: {
          background: '#0a0f1a',
          foreground: '#e6edf3',
          cursor: '#58a6ff',
          selectionBackground: '#58a6ff44'
        }
      })

      terminal = instance
      terminalRef.current = instance
      fitAddon = new FitAddon()

      instance.loadAddon(fitAddon)
      instance.loadAddon(new SearchAddon())
      instance.loadAddon(new WebLinksAddon())
      instance.open(container)
      transformedCanvasMouseFix = installTransformedCanvasMouseFix(instance)
      installTerminalClipboardShortcuts(instance)
      instance.attachCustomWheelEventHandler((event) => {
        if (!isNodeSelectedRef.current) return false

        event.stopPropagation()
        if (event.cancelable) event.preventDefault()
        return true
      })
      fitAndResize(false)
      if (isNodeSelectedRef.current) {
        requestFocus()
      }

      dataDisposable = instance.onData((data) => {
        if (sessionIdRef.current) void window.atlas.terminal.write(sessionIdRef.current, data)
      })

      resizeObserver = new ResizeObserver(scheduleFit)
      resizeObserver.observe(container)

      void window.atlas.terminal
        .create({
          componentId: component.id,
          cwd: cwdRef.current,
          shell: asString(component.config.shell),
          cols: instance.cols,
          rows: instance.rows
        })
        .then((session) => {
          if (disposed) {
            void window.atlas.terminal.close(session.sessionId)
            return
          }

          sessionIdRef.current = session.sessionId
          if (session.cwd !== cwdRef.current) {
            cwdRef.current = session.cwd
            updateState({ cwd: session.cwd }, false)
          }
          if (isNodeSelectedRef.current) {
            requestFocus()
          }
          disposeData = window.atlas.terminal.onData(session.sessionId, (data) => {
            if (!disposed) instance.write(data)
          })
          const disposeCwd = window.atlas.terminal.onCwd(session.sessionId, (cwd) => {
            if (disposed || cwd === cwdRef.current) return
            cwdRef.current = cwd
            updateState({ cwd }, false)
          })
          disposeExit = window.atlas.terminal.onExit(session.sessionId, ({ exitCode }) => {
            if (disposed) return
            instance.writeln(`\r\nProcess exited with code ${exitCode}`)
          })
          const previousDisposeExit = disposeExit
          disposeExit = () => {
            previousDisposeExit()
            disposeCwd()
          }
        })
        .catch((error) => {
          if (disposed) return
          instance.writeln(`Failed to start terminal: ${error instanceof Error ? error.message : String(error)}`)
        })
    }

    initFrame = window.requestAnimationFrame(initializeTerminal)

    return () => {
      disposed = true
      if (initFrame !== null) window.cancelAnimationFrame(initFrame)
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      clearScheduledFocus()
      disposeData()
      disposeExit()
      dataDisposable?.dispose()
      transformedCanvasMouseFix?.dispose()
      resizeObserver?.disconnect()
      sessionIdRef.current = null
      terminalRef.current = null

      const instance = terminal
      if (instance) {
        window.setTimeout(() => instance.dispose(), 0)
      }
    }
  }, [clearScheduledFocus, component.id, component.config.cwd, component.config.shell, requestFocus, updateState])

  return (
    <div className="terminal-module">
      <div ref={containerRef} className="terminal-module__screen" />
    </div>
  )
}
