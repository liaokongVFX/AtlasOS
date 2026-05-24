import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fileExtension, fileName } from '../../lib/file-types'
import { writeClipboardText } from '../../lib/clipboard'
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

type TerminalPasteFeedback = {
  tone: 'info' | 'error'
  message: string
  detail?: string
}

type ResolvedTerminalAsset = {
  createdFromClipboard: boolean
  name: string
  path: string
}

type BrowserClipboardImage = {
  blob: Blob
  mimeType: string
}

type NativeClipboardImageSaveResult = Awaited<ReturnType<(typeof window)['atlas']['terminal']['saveClipboardImage']>>
type NativeClipboardFilesResult = Awaited<ReturnType<(typeof window)['atlas']['terminal']['readClipboardFiles']>>

type TerminalClipboardShortcutHandlers = {
  onCopySelection: () => void
}

const MIN_TRANSFORM_SCALE_DELTA = 0.001
const PASTE_FEEDBACK_DURATION_MS = 3200
const PASTE_SHORTCUT_FALLBACK_DELAY_MS = 80
const TERMINAL_PASTE_LOG_PREFIX = '[AtlasOS terminal paste]'
const TERMINAL_PATH_QUOTE_PATTERN = /[\s"'`$&|<>()[\]{};]/
const PASTED_IMAGE_MIME_TYPES_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon']
])

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

function readNativeClipboardText(): string {
  const readText = window.atlas?.clipboard?.readText
  if (typeof readText !== 'function') return ''

  try {
    const text = readText()
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

function installTerminalClipboardShortcuts(terminal: Terminal, handlers: TerminalClipboardShortcutHandlers): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.altKey) {
      return true
    }

    const key = event.key.toLowerCase()
    const hasPrimaryModifier = event.ctrlKey || event.metaKey

    if (hasPrimaryModifier && key === 'c' && terminal.hasSelection()) {
      event.preventDefault()
      event.stopPropagation()
      handlers.onCopySelection()
      return false
    }

    return true
  })
}

function logTerminalPaste(stage: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(TERMINAL_PASTE_LOG_PREFIX, stage, details)
    return
  }

  console.info(TERMINAL_PASTE_LOG_PREFIX, stage)
}

function describeClipboardData(dataTransfer: DataTransfer | null | undefined): Record<string, unknown> {
  if (!dataTransfer) return { hasClipboardData: false }

  return {
    hasClipboardData: true,
    types: Array.from(dataTransfer.types),
    fileCount: dataTransfer.files.length,
    itemCount: dataTransfer.items?.length ?? 0,
    items: Array.from(dataTransfer.items ?? []).map((item) => ({
      kind: item.kind,
      type: item.type || '(empty)'
    }))
  }
}

function dataTransferFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) return []

  const files = Array.from(dataTransfer.files)
  if (files.length > 0) return files

  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

function hasTransferFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false
  if (dataTransfer.files.length > 0) return true
  if (Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file')) return true
  return Array.from(dataTransfer.types).includes('Files')
}

function readExistingFilePath(file: File): string {
  try {
    return window.atlas.filesystem.getPathForFile(file).trim()
  } catch (error) {
    logTerminalPaste('clipboard-file-path-unavailable', {
      name: file.name || '(unnamed)',
      type: file.type || '(empty)',
      error: error instanceof Error ? error.message : String(error)
    })
    return ''
  }
}

function quoteTerminalPath(path: string): string {
  const escaped = path.replace(/"/g, '\\"')
  return TERMINAL_PATH_QUOTE_PATTERN.test(path) ? `"${escaped}"` : path
}

function formatTerminalPaths(paths: string[]): string {
  return `${paths.map((path) => quoteTerminalPath(path)).join(' ')} `
}

function normalizedImageMimeType(mimeType?: string): string | null {
  const normalized = mimeType?.trim().toLowerCase()
  return normalized?.startsWith('image/') ? normalized : null
}

function mimeTypeForPastedImage(name: string | undefined, mimeType: string | undefined): string | null {
  return normalizedImageMimeType(mimeType) ?? PASTED_IMAGE_MIME_TYPES_BY_EXTENSION.get(fileExtension(name ?? '')) ?? null
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return btoa(binary)
}

async function resolveTerminalAsset(file: File): Promise<ResolvedTerminalAsset> {
  const existingPath = readExistingFilePath(file)

  if (existingPath) {
    return {
      createdFromClipboard: false,
      name: file.name || fileName(existingPath),
      path: existingPath
    }
  }

  const imageMimeType = mimeTypeForPastedImage(file.name || undefined, file.type || undefined)
  if (!imageMimeType) {
    throw new Error('Only pasted images can be saved to a temporary terminal path')
  }

  const dataBase64 = await blobToBase64(file)
  const saved = await window.atlas.terminal.savePastedAsset({
    dataBase64,
    mimeType: imageMimeType,
    sourceName: file.name || undefined
  })

  return {
    createdFromClipboard: true,
    name: file.name || fileName(saved.path),
    path: saved.path
  }
}

async function readBrowserClipboardImages(): Promise<BrowserClipboardImage[]> {
  const read = navigator.clipboard?.read
  if (typeof read !== 'function') {
    logTerminalPaste('browser-clipboard-read-unavailable')
    return []
  }

  try {
    const clipboardItems = await read.call(navigator.clipboard)
    const images: BrowserClipboardImage[] = []

    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith('image/'))
      if (!imageType) continue

      const image = await item.getType(imageType)
      images.push({ blob: image, mimeType: normalizedImageMimeType(imageType) ?? 'image/png' })
    }

    return images
  } catch (error) {
    logTerminalPaste('browser-clipboard-read-failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

function stopTerminalPasteEvent(event: ClipboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
}

function isTerminalPasteShortcut(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown' || event.altKey) return false

  const key = event.key.toLowerCase()
  const hasPrimaryModifier = event.ctrlKey || event.metaKey
  return (hasPrimaryModifier && key === 'v') || (event.shiftKey && key === 'insert')
}

function stopTerminalKeyEvent(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
}

export function TerminalComponent({ component, updateState, isNodeSelected = false }: AtlasComponentRendererProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const cwdRef = useRef(asString(component.state.cwd, asString(component.config.cwd)))
  const pendingFocusRef = useRef(false)
  const focusFrameRef = useRef<number | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const isNodeSelectedRef = useRef(isNodeSelected)
  const [isDropActive, setIsDropActive] = useState(false)
  const [pasteFeedback, setPasteFeedback] = useState<TerminalPasteFeedback | null>(null)

  isNodeSelectedRef.current = isNodeSelected
  cwdRef.current = asString(component.state.cwd, asString(component.config.cwd))

  const clearScheduledFocus = useCallback(() => {
    pendingFocusRef.current = false
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = null
    }
  }, [])

  const clearPasteFeedback = useCallback(() => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = null
    }

    setPasteFeedback(null)
  }, [])

  const showPasteFeedback = useCallback(
    (feedback: TerminalPasteFeedback) => {
      clearPasteFeedback()
      setPasteFeedback(feedback)
      feedbackTimerRef.current = window.setTimeout(() => {
        feedbackTimerRef.current = null
        setPasteFeedback(null)
      }, PASTE_FEEDBACK_DURATION_MS)
    },
    [clearPasteFeedback]
  )

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

  const pasteFilesIntoTerminal = useCallback(
    async (files: File[]) => {
      const instance = terminalRef.current
      if (!instance || files.length === 0) return

      try {
        const resolvedAssets = await Promise.all(files.map((file) => resolveTerminalAsset(file)))
        if (terminalRef.current !== instance) return
        if (resolvedAssets.length === 0) return

        instance.paste(formatTerminalPaths(resolvedAssets.map((asset) => asset.path)))

        const createdCount = resolvedAssets.filter((asset) => asset.createdFromClipboard).length
        const message =
          createdCount === 1 && resolvedAssets.length === 1
            ? 'Saved screenshot and inserted its path'
            : resolvedAssets.length === 1
              ? 'Inserted attachment path'
              : `Inserted ${resolvedAssets.length} attachment paths`

        const detail = resolvedAssets.length === 1 ? resolvedAssets[0].name : resolvedAssets.map((asset) => asset.name).join(', ')
        showPasteFeedback({ tone: 'info', message, detail })
      } catch (error) {
        showPasteFeedback({
          tone: 'error',
          message: 'Unable to insert the pasted attachment',
          detail: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [showPasteFeedback]
  )

  const pasteNativeClipboardImageIntoTerminal = useCallback(
    async () => {
      const instance = terminalRef.current
      if (!instance) return false

      try {
        const saved: NativeClipboardImageSaveResult = await window.atlas.terminal.saveClipboardImage()
        if (!saved.saved) {
          logTerminalPaste('native-clipboard-image-empty', { formats: saved.formats })
          return false
        }

        if (terminalRef.current !== instance) return true

        instance.paste(formatTerminalPaths([saved.path]))
        logTerminalPaste('native-clipboard-image-inserted', {
          path: saved.path,
          width: saved.width,
          height: saved.height,
          byteLength: saved.byteLength,
          formats: saved.formats
        })
        showPasteFeedback({
          tone: 'info',
          message: 'Saved screenshot and inserted its path',
          detail: fileName(saved.path)
        })
        return true
      } catch (error) {
        logTerminalPaste('native-clipboard-image-failed', {
          error: error instanceof Error ? error.message : String(error)
        })
        showPasteFeedback({
          tone: 'error',
          message: 'Unable to insert the pasted screenshot',
          detail: error instanceof Error ? error.message : String(error)
        })
        return true
      }
    },
    [showPasteFeedback]
  )

  const pasteNativeClipboardFilesIntoTerminal = useCallback(
    async () => {
      const instance = terminalRef.current
      if (!instance) return false

      try {
        const result: NativeClipboardFilesResult = await window.atlas.terminal.readClipboardFiles()
        if (result.paths.length === 0) {
          logTerminalPaste('native-clipboard-files-empty', { formats: result.formats })
          return false
        }

        if (terminalRef.current !== instance) return true

        instance.paste(formatTerminalPaths(result.paths))
        logTerminalPaste('native-clipboard-files-inserted', {
          count: result.paths.length,
          formats: result.formats
        })
        showPasteFeedback({
          tone: 'info',
          message: result.paths.length === 1 ? 'Inserted copied file path' : `Inserted ${result.paths.length} copied file paths`,
          detail: result.paths.length === 1 ? fileName(result.paths[0]) : result.paths.map(fileName).join(', ')
        })
        return true
      } catch (error) {
        logTerminalPaste('native-clipboard-files-failed', {
          error: error instanceof Error ? error.message : String(error)
        })
        return false
      }
    },
    [showPasteFeedback]
  )

  const pasteBrowserClipboardImagesIntoTerminal = useCallback(
    async (images: BrowserClipboardImage[]) => {
      const instance = terminalRef.current
      if (!instance || images.length === 0) return false

      try {
        const savedImages = await Promise.all(
          images.map(async ({ blob, mimeType }, index) => {
            const dataBase64 = await blobToBase64(blob)
            const saved = await window.atlas.terminal.savePastedAsset({
              dataBase64,
              mimeType,
              sourceName: images.length === 1 ? 'clipboard-image' : `clipboard-image-${index + 1}`
            })

            return saved.path
          })
        )

        if (terminalRef.current !== instance) return false

        instance.paste(formatTerminalPaths(savedImages))
        showPasteFeedback({
          tone: 'info',
          message: images.length === 1 ? 'Saved screenshot and inserted its path' : `Saved ${images.length} screenshots and inserted their paths`,
          detail: savedImages.length === 1 ? fileName(savedImages[0]) : savedImages.map(fileName).join(', ')
        })
        return true
      } catch (error) {
        showPasteFeedback({
          tone: 'error',
          message: 'Unable to insert the pasted screenshot',
          detail: error instanceof Error ? error.message : String(error)
        })
        return false
      }
    },
    [showPasteFeedback]
  )

  const pasteClipboardIntoTerminal = useCallback(
    async (instance: Terminal, event?: ClipboardEvent) => {
      logTerminalPaste('paste-start', {
        source: event ? 'paste-event' : 'shortcut-fallback',
        ...describeClipboardData(event?.clipboardData)
      })

      const files = dataTransferFiles(event?.clipboardData)
      if (files.length > 0) {
        logTerminalPaste('paste-files-detected', {
          count: files.length,
          files: files.map((file) => ({
            name: file.name || '(unnamed)',
            type: file.type || '(empty)',
            size: file.size
          }))
        })
        await pasteFilesIntoTerminal(files)
        return true
      }

      if (await pasteNativeClipboardFilesIntoTerminal()) {
        return true
      }

      const browserImages = await readBrowserClipboardImages()
      if (browserImages.length > 0) {
        logTerminalPaste('browser-clipboard-images-detected', {
          count: browserImages.length,
          images: browserImages.map(({ blob, mimeType }) => ({
            mimeType,
            size: blob.size
          }))
        })
        return pasteBrowserClipboardImagesIntoTerminal(browserImages)
      }

      if (await pasteNativeClipboardImageIntoTerminal()) {
        return true
      }

      const text = event?.clipboardData?.getData('text/plain') || readNativeClipboardText()
      if (text) {
        logTerminalPaste('clipboard-text-inserted', { length: text.length })
        instance.paste(text)
        return true
      }

      logTerminalPaste('paste-empty')
      return false
    },
    [
      pasteBrowserClipboardImagesIntoTerminal,
      pasteFilesIntoTerminal,
      pasteNativeClipboardFilesIntoTerminal,
      pasteNativeClipboardImageIntoTerminal
    ]
  )

  useLayoutEffect(() => {
    if (isNodeSelected) {
      requestFocus()
      return
    }

    clearScheduledFocus()
  }, [clearScheduledFocus, isNodeSelected, requestFocus])

  useEffect(() => {
    return () => {
      clearPasteFeedback()
    }
  }, [clearPasteFeedback])

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
    let removeDomListeners: () => void = () => undefined
    let shortcutPasteFallbackTimer: number | null = null

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

    const clearPendingShortcutPasteFallback = (): void => {
      if (shortcutPasteFallbackTimer !== null) {
        window.clearTimeout(shortcutPasteFallbackTimer)
        shortcutPasteFallbackTimer = null
      }
    }

    const scheduleShortcutPasteFallback = (instance: Terminal): void => {
      clearPendingShortcutPasteFallback()
      shortcutPasteFallbackTimer = window.setTimeout(() => {
        shortcutPasteFallbackTimer = null
        void pasteClipboardIntoTerminal(instance)
      }, PASTE_SHORTCUT_FALLBACK_DELAY_MS)
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
          background: '#010102',
          foreground: '#f7f8f8',
          cursor: '#828fff',
          selectionBackground: '#5e6ad24d'
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
      installTerminalClipboardShortcuts(instance, {
        onCopySelection: () => {
          void writeClipboardText(instance.getSelection()).catch(() => undefined)
        }
      })
      instance.attachCustomWheelEventHandler((event) => {
        if (!isNodeSelectedRef.current) return false

        event.stopPropagation()
        if (event.cancelable) event.preventDefault()
        return true
      })

      const handlePasteShortcutKeyDown = (event: KeyboardEvent): void => {
        if (event.defaultPrevented || !isTerminalPasteShortcut(event)) return

        stopTerminalKeyEvent(event)
        scheduleShortcutPasteFallback(instance)
      }

      const handlePaste = (event: ClipboardEvent): void => {
        stopTerminalPasteEvent(event)

        clearPendingShortcutPasteFallback()
        void pasteClipboardIntoTerminal(instance, event)
      }

      const handleDragOver = (event: DragEvent): void => {
        if (!hasTransferFiles(event.dataTransfer)) return

        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        setIsDropActive(true)
      }

      const handleDragLeave = (event: DragEvent): void => {
        if (!container.contains(event.relatedTarget as Node | null)) {
          setIsDropActive(false)
        }
      }

      const handleDrop = (event: DragEvent): void => {
        const files = dataTransferFiles(event.dataTransfer)
        if (files.length === 0) return

        event.preventDefault()
        event.stopPropagation()
        setIsDropActive(false)
        void pasteFilesIntoTerminal(files)
      }

      container.addEventListener('keydown', handlePasteShortcutKeyDown, true)
      container.addEventListener('paste', handlePaste, true)
      container.addEventListener('dragover', handleDragOver)
      container.addEventListener('dragleave', handleDragLeave)
      container.addEventListener('drop', handleDrop)
      removeDomListeners = () => {
        container.removeEventListener('keydown', handlePasteShortcutKeyDown, true)
        container.removeEventListener('paste', handlePaste, true)
        container.removeEventListener('dragover', handleDragOver)
        container.removeEventListener('dragleave', handleDragLeave)
        container.removeEventListener('drop', handleDrop)
        clearPendingShortcutPasteFallback()
      }

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
      clearPendingShortcutPasteFallback()
      removeDomListeners()
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
  }, [
    clearScheduledFocus,
    component.id,
    component.config.cwd,
    component.config.shell,
    pasteClipboardIntoTerminal,
    pasteFilesIntoTerminal,
    pasteNativeClipboardFilesIntoTerminal,
    pasteNativeClipboardImageIntoTerminal,
    requestFocus,
    updateState
  ])

  return (
    <div className="terminal-module">
      <div ref={containerRef} className="terminal-module__screen" />
      {isDropActive ? (
        <div className="terminal-module__drop-overlay" aria-hidden="true">
          Drop files here to paste their paths into the terminal
        </div>
      ) : null}
      {pasteFeedback ? (
        <div
          className={[
            'terminal-module__paste-feedback',
            pasteFeedback.tone === 'error' ? 'terminal-module__paste-feedback--error' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          aria-live="polite"
        >
          <strong>{pasteFeedback.message}</strong>
          {pasteFeedback.detail ? <span>{pasteFeedback.detail}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
