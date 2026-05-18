import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { asString } from '../../lib/utils'
import type { AtlasComponentRendererProps } from '../registry'

type Disposable = {
  dispose: () => void
}

export function TerminalComponent({ component }: AtlasComponentRendererProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [status, setStatus] = useState('starting')

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
        convertEol: true,
        fontFamily: 'JetBrains Mono, Consolas, "Cascadia Mono", monospace',
        fontSize: 13,
        theme: {
          background: '#0a0f1a',
          foreground: '#d6deff',
          cursor: '#58a6ff',
          selectionBackground: '#58a6ff44'
        }
      })

      terminal = instance
      fitAddon = new FitAddon()

      instance.loadAddon(fitAddon)
      instance.loadAddon(new SearchAddon())
      instance.loadAddon(new WebLinksAddon())
      instance.open(container)
      fitAndResize(false)
      instance.focus()

      dataDisposable = instance.onData((data) => {
        if (sessionIdRef.current) void window.atlas.terminal.write(sessionIdRef.current, data)
      })

      resizeObserver = new ResizeObserver(scheduleFit)
      resizeObserver.observe(container)

      void window.atlas.terminal
        .create({
          componentId: component.id,
          cwd: asString(component.config.cwd),
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
          setStatus(`${session.shell} - ${session.cwd}`)
          instance.writeln(`AtlasOS terminal attached to ${session.cwd}`)
          disposeData = window.atlas.terminal.onData(session.sessionId, (data) => {
            if (!disposed) instance.write(data)
          })
          disposeExit = window.atlas.terminal.onExit(session.sessionId, ({ exitCode }) => {
            if (disposed) return
            instance.writeln(`\r\nProcess exited with code ${exitCode}`)
            setStatus('closed')
          })
        })
        .catch((error) => {
          if (disposed) return
          instance.writeln(`Failed to start terminal: ${error instanceof Error ? error.message : String(error)}`)
          setStatus('failed')
        })
    }

    initFrame = window.requestAnimationFrame(initializeTerminal)

    return () => {
      disposed = true
      if (initFrame !== null) window.cancelAnimationFrame(initFrame)
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      disposeData()
      disposeExit()
      dataDisposable?.dispose()
      resizeObserver?.disconnect()

      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId) void window.atlas.terminal.close(sessionId)

      const instance = terminal
      if (instance) {
        window.setTimeout(() => instance.dispose(), 0)
      }
    }
  }, [component.id, component.config.cwd, component.config.shell])

  return (
    <div className="terminal-module">
      <div ref={containerRef} className="terminal-module__screen" />
      <div className="terminal-module__status">{status}</div>
    </div>
  )
}
