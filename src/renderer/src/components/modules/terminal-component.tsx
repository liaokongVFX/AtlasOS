import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import * as Dialog from '@radix-ui/react-dialog'
import { Lock, PanelBottomClose, PanelBottomOpen, Settings2, Unlock, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createTerminalAgentRestore, terminalAgentRestoreSchema, type TerminalAgentRestore, type TerminalAgentSessionEndedEvent } from '@shared/terminal-agent'
import {
  mergeTerminalEnvironments,
  normalizeTerminalEnvironment,
  normalizeTerminalEnvironmentNames,
  omitTerminalEnvironment,
  pickTerminalEnvironment,
  type TerminalEnvironment
} from '@shared/terminal-environment'
import { fileExtension, fileName } from '../../lib/file-types'
import { useI18n, type TFunction } from '../../i18n'
import { writeClipboardText } from '../../lib/clipboard'
import { TERMINAL_LOCKED_STATE_KEY, isTerminalComponentLocked } from '../../lib/terminal-lock'
import { registerTranslationSelectionProvider } from '../../lib/translation-selection'
import { asBoolean, asString, cn } from '../../lib/utils'
import { useAppSettingsStore } from '../../store/app-settings-store'
import { TerminalCommandLibraryManager } from '../terminal-command-library-manager'
import { TerminalEnvironmentEditor } from '../terminal-environment-editor'
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

type XtermSelectionService = {
  _screenElement?: HTMLElement
  _getMouseEventScrollAmount?: (event: MouseEvent) => number
  shouldForceSelection?: (event: MouseEvent) => boolean
}

type XtermCore = {
  _mouseService?: XtermMouseService
  _selectionService?: XtermSelectionService
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
  getSelectionText: () => string
  isCopyShortcutActive: () => boolean
  getContainer: () => HTMLElement | null
  onClearSelection: () => void
  onCopySelection: (text: string) => void
}

type TerminalSelectionSnapshot = {
  text: string
}

type CommandPanelResizeSession = {
  maxHeight: number
  minHeight: number
  pointerId: number
  scaleY: number
  startHeight: number
  startY: number
}

const MIN_TRANSFORM_SCALE_DELTA = 0.001
const PASTE_FEEDBACK_DURATION_MS = 3200
const PASTE_SHORTCUT_FALLBACK_DELAY_MS = 80
const TERMINAL_MIN_COLS = 10
const TERMINAL_MIN_ROWS = 4
const COMMAND_PANEL_DEFAULT_HEIGHT = 96
const COMMAND_PANEL_MIN_HEIGHT = 72
const COMMAND_PANEL_MAX_HEIGHT = 320
const COMMAND_PANEL_MIN_SCREEN_HEIGHT = 96
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

function readTerminalAgentRestore(value: unknown): TerminalAgentRestore | null {
  const result = terminalAgentRestoreSchema.safeParse(value)
  return result.success ? result.data : null
}

function agentRestoreMatchesSessionEnd(restore: TerminalAgentRestore, event: TerminalAgentSessionEndedEvent): boolean {
  return restore.source === event.source && (!event.providerSessionId || restore.sessionId === event.providerSessionId)
}

function commandPanelResizeBounds(moduleHeight: number | null | undefined): { minHeight: number; maxHeight: number } {
  const availableMaxHeight =
    typeof moduleHeight === 'number' && Number.isFinite(moduleHeight) && moduleHeight > 0
      ? Math.max(COMMAND_PANEL_MIN_HEIGHT, moduleHeight - COMMAND_PANEL_MIN_SCREEN_HEIGHT)
      : COMMAND_PANEL_MAX_HEIGHT

  return {
    minHeight: COMMAND_PANEL_MIN_HEIGHT,
    maxHeight: Math.min(COMMAND_PANEL_MAX_HEIGHT, availableMaxHeight)
  }
}

function clampCommandPanelHeight(height: number, moduleHeight?: number | null): number {
  const { minHeight, maxHeight } = commandPanelResizeBounds(moduleHeight)
  return Math.round(Math.min(Math.max(height, minHeight), maxHeight))
}

function readCommandPanelHeight(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? clampCommandPanelHeight(value) : null
}

function safeScale(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}

function elementScaleY(element: HTMLElement, fallbackScale = 1): number {
  const height = element.offsetHeight
  const rectHeight = element.getBoundingClientRect().height
  return height > 0 && rectHeight > 0 ? safeScale(rectHeight / height) : safeScale(fallbackScale)
}

function elementLayoutHeight(element: HTMLElement | null, fallbackScale = 1): number {
  if (!element) return 0
  if (element.offsetHeight > 0) return element.offsetHeight

  const rectHeight = element.getBoundingClientRect().height
  return rectHeight > 0 ? rectHeight / safeScale(fallbackScale) : 0
}

function resizeSessionPanelHeight(session: CommandPanelResizeSession, clientY: number): number {
  const deltaY = (session.startY - clientY) / safeScale(session.scaleY)
  return Math.round(Math.min(Math.max(session.startHeight + deltaY, session.minHeight), session.maxHeight))
}

function validTerminalSize(terminal: Terminal): boolean {
  return terminal.cols >= TERMINAL_MIN_COLS && terminal.rows >= TERMINAL_MIN_ROWS
}

function createTerminalSize(terminal: Terminal): { cols: number; rows: number } {
  return {
    cols: Math.max(TERMINAL_MIN_COLS, terminal.cols),
    rows: Math.max(TERMINAL_MIN_ROWS, terminal.rows)
  }
}

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
  const core = (terminal as unknown as { _core?: XtermCore })._core
  const mouseService = core?._mouseService
  const selectionService = core?._selectionService
  if (!mouseService && !selectionService) return { dispose: () => undefined }

  const originalGetCoords = mouseService?.getCoords
  const originalGetMouseReportCoords = mouseService?.getMouseReportCoords
  const originalGetMouseEventScrollAmount = selectionService?._getMouseEventScrollAmount
  const originalShouldForceSelection = selectionService?.shouldForceSelection

  if (mouseService && originalGetCoords) {
    mouseService.getCoords = function getCoordsWithCanvasTransformFix(event, element, ...args) {
      return originalGetCoords.call(mouseService, createUnscaledMouseEvent(event, element), element, ...args)
    }

    if (originalGetMouseReportCoords) {
      mouseService.getMouseReportCoords = function getMouseReportCoordsWithCanvasTransformFix(event, element) {
        return originalGetMouseReportCoords.call(mouseService, createUnscaledMouseEvent(event, element), element)
      }
    }
  }

  if (selectionService && originalGetMouseEventScrollAmount) {
    selectionService._getMouseEventScrollAmount = function getMouseEventScrollAmountWithCanvasTransformFix(event) {
      const screenElement = selectionService._screenElement
      return originalGetMouseEventScrollAmount.call(
        selectionService,
        screenElement ? createUnscaledMouseEvent(event, screenElement) : event
      )
    }
  }

  /**
   * Claude Code / Codex enable DEC mouse tracking, which makes xterm disable
   * normal drag selection and only allow Shift/Option forced selection.
   * In this canvas-embedded terminal, copy/select is the primary interaction,
   * so always force selection. Hold Alt to fall back to the original policy
   * when a TUI truly needs raw mouse events.
   */
  if (selectionService && originalShouldForceSelection) {
    selectionService.shouldForceSelection = function shouldForceSelectionForEmbeddedTerminal(event) {
      if (event.altKey) {
        return originalShouldForceSelection.call(selectionService, event)
      }
      return true
    }
  }

  return {
    dispose: () => {
      if (mouseService && originalGetCoords) {
        mouseService.getCoords = originalGetCoords
        mouseService.getMouseReportCoords = originalGetMouseReportCoords
      }
      if (selectionService && originalGetMouseEventScrollAmount) {
        selectionService._getMouseEventScrollAmount = originalGetMouseEventScrollAmount
      }
      if (selectionService && originalShouldForceSelection) {
        selectionService.shouldForceSelection = originalShouldForceSelection
      }
    }
  }
}

function isNativeCopyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    // xterm's helper textarea is not a real text field for OS copy; we own that path.
    if (target.classList.contains('xterm-helper-textarea')) return false
    return true
  }

  return target.isContentEditable
}

function isTerminalCopyShortcut(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown' || event.altKey || event.defaultPrevented) return false
  if (!(event.ctrlKey || event.metaKey)) return false
  return event.key.toLowerCase() === 'c'
}

/**
 * 开启 DECSET 1000/1002/1003（以及 1006 SGR）后，xterm 会通过 onData 发出完整鼠标上报。
 * 在画布内嵌终端里，节点仍选中但 xterm textarea 并未真正持有键盘焦点时也会触发这些序列；
 * Codex 会把它们当成普通输入，退格也很难干净清掉。
 *
 * 这里只匹配“整段都是鼠标上报”的 payload，普通按键和 DEC 焦点上报（CSI I / CSI O）继续放行。
 */
function isTerminalMouseReportData(data: string): boolean {
  if (!data.startsWith('\x1b[')) return false
  return /^(?:\x1b\[<\d+(?:;\d+){0,2}[Mm]|\x1b\[M[\s\S]{3})+$/.test(data)
}

function isTerminalTextareaFocused(container: HTMLElement | null | undefined): boolean {
  if (!container || typeof document === 'undefined') return false
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false

  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return false
  return container.contains(activeElement)
}

function shouldWriteTerminalUserInput(data: string, container: HTMLElement | null | undefined): boolean {
  if (!isTerminalMouseReportData(data)) return true
  return isTerminalTextareaFocused(container)
}

function isWindowsHost(): boolean {
  if (typeof navigator === 'undefined') return false

  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (typeof platform === 'string' && platform.trim()) {
    return platform.toLowerCase() === 'windows'
  }

  return /windows/i.test(navigator.userAgent)
}

function createWindowsPtyOption(): { backend: 'conpty' } | undefined {
  return isWindowsHost() ? { backend: 'conpty' } : undefined
}

/**
 * Terminal nodes sit under React Flow's CSS transform tree. Chromium can keep a
 * composited snapshot of the xterm surface after the row DOM is already correct,
 * which shows up as a 1-cell-wide left column of stale glyphs after scrollback
 * scrolls or full-screen redraws (Claude Code /clear is a common trigger).
 *
 * xterm.refresh() only rebuilds DOM and does not invalidate that GPU layer, so
 * we force a tiny transform change on the screen surface after:
 * - viewport scroll (scrollback browsing)
 * - full-viewport renders (clear / resize / full refresh)
 */
function installTerminalCompositorPaintFix(terminal: Terminal, container: HTMLElement): Disposable {
  const surface =
    container.querySelector<HTMLElement>('.xterm-screen') ??
    container.querySelector<HTMLElement>('.xterm') ??
    container
  const viewport = container.querySelector<HTMLElement>('.xterm-viewport')

  let repaintPending = false
  let frame: number | null = null
  let paintToken = 0
  let wasAtBottom = terminal.buffer.active.viewportY === terminal.buffer.active.baseY

  const flushCompositorRepaint = (): void => {
    frame = null
    if (!repaintPending || !surface.isConnected) return
    repaintPending = false

    paintToken = paintToken === 0 ? 1 : 0
    // Alternating sub-pixel Z keeps the layer promoted while forcing Chromium to
    // discard the previous composited bitmap under parent canvas transforms.
    surface.style.transform = paintToken === 0 ? 'translate3d(0, 0, 0)' : 'translate3d(0, 0, 0.01px)'
  }

  const scheduleCompositorRepaint = (): void => {
    repaintPending = true
    if (frame !== null) return
    frame = window.requestAnimationFrame(flushCompositorRepaint)
  }

  const handleViewportScroll = (): void => {
    const activeBuffer = terminal.buffer.active
    const isAtBottom = activeBuffer.viewportY === activeBuffer.baseY

    if (!isAtBottom || !wasAtBottom) scheduleCompositorRepaint()
    wasAtBottom = isAtBottom
  }

  viewport?.addEventListener('scroll', handleViewportScroll, { passive: true })

  const renderDisposable = terminal.onRender((event) => {
    // Full-viewport redraws cover clear/resize/scroll refreshes. Partial row
    // updates during streaming are left alone to avoid per-frame layer thrash.
    if (event.start <= 0 && event.end >= Math.max(0, terminal.rows - 1)) {
      scheduleCompositorRepaint()
    }
  })

  return {
    dispose: () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
      viewport?.removeEventListener('scroll', handleViewportScroll)
      renderDisposable.dispose()
      surface.style.removeProperty('transform')
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

function installTerminalClipboardShortcuts(terminal: Terminal, handlers: TerminalClipboardShortcutHandlers): Disposable {
  const copySelectionFromEvent = (
    event: KeyboardEvent,
    options?: { onlyWhenTextareaBlurred?: boolean; requireActiveNode?: boolean }
  ): boolean => {
    if (!isTerminalCopyShortcut(event)) return false
    if (options?.requireActiveNode && !handlers.isCopyShortcutActive()) return false
    if (options?.onlyWhenTextareaBlurred && isTerminalTextareaFocused(handlers.getContainer())) return false
    if (isNativeCopyTarget(event.target)) return false

    const selectedText = handlers.getSelectionText()
    if (!selectedText) return false

    event.preventDefault()
    event.stopPropagation()
    handlers.onCopySelection(selectedText)
    terminal.clearSelection()
    handlers.onClearSelection()
    return true
  }

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.altKey) {
      return true
    }

    if (isTerminalPasteShortcut(event)) {
      return false
    }

    // Focused xterm textarea path: copy selection, otherwise let Ctrl+C interrupt.
    if (copySelectionFromEvent(event)) {
      return false
    }

    return true
  })

  // Blurred textarea path: selection highlight can remain after focus leaves the
  // helper textarea (common after Claude Code / Codex interaction). Keep Ctrl+C
  // as copy while the terminal node is still the active canvas selection.
  const handleWindowKeyDown = (event: KeyboardEvent): void => {
    copySelectionFromEvent(event, {
      onlyWhenTextareaBlurred: true,
      requireActiveNode: true
    })
  }

  window.addEventListener('keydown', handleWindowKeyDown, true)

  return {
    dispose: () => {
      window.removeEventListener('keydown', handleWindowKeyDown, true)
    }
  }
}

function terminalSelectionText(terminal: Terminal): string {
  if (!terminal.hasSelection()) return ''

  return terminal.getSelection()
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
  } catch {
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

async function resolveTerminalAsset(file: File, t: TFunction): Promise<ResolvedTerminalAsset> {
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
    throw new Error(t('terminal.onlyImagesTempPath'))
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
  } catch {
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

function openTerminalWebLink(event: MouseEvent, uri: string, terminal?: Terminal): void {
  // Prevent default navigation only. Do not stopPropagation: xterm SelectionService
  // registers document-level mouseup during mousedown; blocking bubble leaves the
  // terminal stuck in drag-selection mode after the link opens in an external browser.
  event.preventDefault()
  terminal?.clearSelection()
  void window.atlas.launcher.open({ kind: 'url', url: uri }).catch((error) => {
    console.warn('Failed to open terminal link', error)
  })
}

export function TerminalComponent({
  canvasId,
  canvasZoom,
  component,
  updateConfig,
  updateState,
  setHeaderActions,
  isNodeSelected = false
}: AtlasComponentRendererProps): JSX.Element {
  const { t } = useI18n()
  const moduleRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const commandPanelRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const cwdRef = useRef(asString(component.state.cwd, asString(component.config.cwd)))
  const initialCommand = asString(component.config.initialCommand)
  const initialCommandDispatched = asBoolean(component.state.initialCommandDispatched)
  const storedAgentRestore = asBoolean(component.state.agentRestoreActive) ? readTerminalAgentRestore(component.state.agentRestore) : null
  const startupCommand = initialCommand && !initialCommandDispatched ? initialCommand : storedAgentRestore?.command
  const startupAgentRestore = startupCommand ? createTerminalAgentRestore(startupCommand, cwdRef.current) : null
  const autoConfirmWorkspaceTrust = startupAgentRestore?.source === 'claude'
  const activeAgentRestoreRef = useRef<TerminalAgentRestore | null>(storedAgentRestore ?? startupAgentRestore)
  const pendingFocusRef = useRef(false)
  const focusFrameRef = useRef<number | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const isNodeSelectedRef = useRef(isNodeSelected)
  const selectionSnapshotRef = useRef<TerminalSelectionSnapshot | null>(null)
  const suppressedExitSessionIdsRef = useRef(new Set<string>())
  const tRef = useRef(t)
  const isLocked = isTerminalComponentLocked(component)
  const commandPanelExpanded = asBoolean(component.state.commandPanelExpanded)
  const persistedCommandPanelHeight = readCommandPanelHeight(component.state.commandPanelHeight)
  const commandPanelResizeSessionRef = useRef<CommandPanelResizeSession | null>(null)
  const [commandPanelHeight, setCommandPanelHeight] = useState<number | null>(persistedCommandPanelHeight)
  const [isDropActive, setIsDropActive] = useState(false)
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false)
  const [pasteFeedback, setPasteFeedback] = useState<TerminalPasteFeedback | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const appSettingsLoaded = useAppSettingsStore((state) => state.isLoaded)
  const globalEnvironment = useAppSettingsStore((state) => state.settings.terminalEnvironment)
  const globalDisabledEnvironmentNamesRaw = useAppSettingsStore((state) => state.settings.terminalEnvironmentDisabledNames)
  const globalDisabledEnvironmentNames = useMemo(
    () => normalizeTerminalEnvironmentNames(globalDisabledEnvironmentNamesRaw),
    [globalDisabledEnvironmentNamesRaw]
  )
  const nodeEnvironment = useMemo(() => normalizeTerminalEnvironment(component.config.environment), [component.config.environment])
  const nodeDisabledEnvironmentNames = useMemo(
    () => normalizeTerminalEnvironmentNames(component.config.environmentDisabledNames),
    [component.config.environmentDisabledNames]
  )
  const selectedGlobalEnvironmentNames = useMemo(
    () => normalizeTerminalEnvironmentNames(component.config.environmentGlobalNames),
    [component.config.environmentGlobalNames]
  )
  const selectedGlobalEnvironment = useMemo(
    () =>
      pickTerminalEnvironment(
        omitTerminalEnvironment(globalEnvironment, globalDisabledEnvironmentNames),
        selectedGlobalEnvironmentNames
      ),
    [globalEnvironment, globalDisabledEnvironmentNames, selectedGlobalEnvironmentNames]
  )
  const sessionEnvironment = useMemo<TerminalEnvironment>(
    () =>
      omitTerminalEnvironment(
        mergeTerminalEnvironments(
          selectedGlobalEnvironment,
          omitTerminalEnvironment(nodeEnvironment, nodeDisabledEnvironmentNames)
        ),
        globalDisabledEnvironmentNames
      ),
    [selectedGlobalEnvironment, nodeEnvironment, nodeDisabledEnvironmentNames, globalDisabledEnvironmentNames]
  )
  const canvasScale = safeScale(canvasZoom)

  isNodeSelectedRef.current = isNodeSelected
  cwdRef.current = asString(component.state.cwd, asString(component.config.cwd))
  activeAgentRestoreRef.current = storedAgentRestore ?? startupAgentRestore

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    setCommandPanelHeight(persistedCommandPanelHeight)
  }, [persistedCommandPanelHeight])

  const persistActiveAgentRestore = useCallback(
    (agentRestore: TerminalAgentRestore) => {
      activeAgentRestoreRef.current = agentRestore
      updateState({ agentRestore, agentRestoreActive: true }, true)
    },
    [updateState]
  )

  const clearActiveAgentRestore = useCallback(
    (event: TerminalAgentSessionEndedEvent) => {
      const agentRestore = activeAgentRestoreRef.current
      if (!agentRestore || !agentRestoreMatchesSessionEnd(agentRestore, event)) return

      activeAgentRestoreRef.current = null
      updateState({ agentRestoreActive: false }, true)
    },
    [updateState]
  )

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

  const selectedTerminalText = useCallback(() => {
    const instance = terminalRef.current
    if (!instance) return ''

    const text = terminalSelectionText(instance)
    if (text) {
      selectionSnapshotRef.current = { text }
      return text
    }

    return selectionSnapshotRef.current?.text ?? ''
  }, [])

  const refreshTerminalSelectionSnapshot = useCallback(() => {
    const instance = terminalRef.current
    if (!instance) {
      selectionSnapshotRef.current = null
      return
    }

    const text = terminalSelectionText(instance)
    selectionSnapshotRef.current = text ? { text } : null
  }, [])

  const clearTerminalSelectionSnapshot = useCallback(() => {
    selectionSnapshotRef.current = null
  }, [])

  const toggleLocked = useCallback(() => {
    updateState({ [TERMINAL_LOCKED_STATE_KEY]: !isLocked }, true)
  }, [isLocked, updateState])

  const toggleCommandPanel = useCallback(() => {
    updateState({ commandPanelExpanded: !commandPanelExpanded }, true)
  }, [commandPanelExpanded, updateState])

  const saveNodeEnvironment = useCallback(
    async ({
      environment,
      disabledNames,
      selectedGlobalNames
    }: {
      environment: TerminalEnvironment
      disabledNames: string[]
      selectedGlobalNames?: string[]
    }) => {
      const sessionId = sessionIdRef.current
      if (sessionId) {
        sessionIdRef.current = null
        suppressedExitSessionIdsRef.current.add(sessionId)
        setSessionReady(false)
        await window.atlas.terminal.close(sessionId)
      }
      updateConfig(
        {
          environment,
          environmentDisabledNames: disabledNames,
          environmentGlobalNames: selectedGlobalNames ?? []
        },
        true
      )
      setEnvironmentDialogOpen(false)
    },
    [updateConfig]
  )

  const panelModuleHeight = useCallback((): number | null => {
    const height = elementLayoutHeight(moduleRef.current, canvasScale)
    return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : null
  }, [canvasScale])

  const commandPanelScaleY = useCallback((): number => {
    const module = moduleRef.current
    return module ? elementScaleY(module, canvasScale) : canvasScale
  }, [canvasScale])

  const currentCommandPanelHeight = useCallback((): number => {
    const measuredHeight = elementLayoutHeight(commandPanelRef.current, commandPanelScaleY())
    return clampCommandPanelHeight(
      measuredHeight > 0 ? measuredHeight : commandPanelHeight ?? persistedCommandPanelHeight ?? COMMAND_PANEL_DEFAULT_HEIGHT,
      panelModuleHeight()
    )
  }, [commandPanelHeight, commandPanelScaleY, panelModuleHeight, persistedCommandPanelHeight])

  const setResizedCommandPanelHeight = useCallback(
    (height: number, immediate: boolean): number => {
      const nextHeight = clampCommandPanelHeight(height, panelModuleHeight())
      setCommandPanelHeight(nextHeight)
      updateState({ commandPanelHeight: nextHeight }, immediate)
      return nextHeight
    },
    [panelModuleHeight, updateState]
  )

  useLayoutEffect(() => {
    if (!commandPanelExpanded || commandPanelHeight === null) return

    const clampedHeight = clampCommandPanelHeight(commandPanelHeight, panelModuleHeight())
    if (clampedHeight !== commandPanelHeight) {
      setCommandPanelHeight(clampedHeight)
    }
  }, [commandPanelExpanded, commandPanelHeight, panelModuleHeight])

  const beginCommandPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return

      event.preventDefault()
      event.stopPropagation()

      const { minHeight, maxHeight } = commandPanelResizeBounds(panelModuleHeight())
      commandPanelResizeSessionRef.current = {
        maxHeight,
        minHeight,
        pointerId: event.pointerId,
        scaleY: commandPanelScaleY(),
        startHeight: currentCommandPanelHeight(),
        startY: event.clientY
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is not implemented in every test DOM.
      }
    },
    [commandPanelScaleY, currentCommandPanelHeight, panelModuleHeight]
  )

  const moveCommandPanelResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = commandPanelResizeSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()

    setCommandPanelHeight(resizeSessionPanelHeight(session, event.clientY))
  }, [])

  const endCommandPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = commandPanelResizeSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return

      event.preventDefault()
      event.stopPropagation()

      const nextHeight = resizeSessionPanelHeight(session, event.clientY)
      commandPanelResizeSessionRef.current = null
      setCommandPanelHeight(nextHeight)
      updateState({ commandPanelHeight: nextHeight }, true)

      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture is not implemented in every test DOM.
      }
    },
    [updateState]
  )

  const nudgeCommandPanelResize = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (!['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key)) return

      event.preventDefault()
      event.stopPropagation()

      const { maxHeight, minHeight } = commandPanelResizeBounds(panelModuleHeight())
      const step = event.shiftKey ? 40 : 16
      let nextHeight = currentCommandPanelHeight()

      if (event.key === 'Home') {
        nextHeight = minHeight
      } else if (event.key === 'End') {
        nextHeight = maxHeight
      } else {
        nextHeight += event.key === 'ArrowUp' ? step : -step
      }

      setResizedCommandPanelHeight(nextHeight, false)
    },
    [currentCommandPanelHeight, panelModuleHeight, setResizedCommandPanelHeight]
  )

  const headerActions = useMemo(
    () => (
      <>
        <button
          type="button"
          className={cn('icon-button component-node__header-action-button', commandPanelExpanded && 'component-node__header-action-button--active')}
          onClick={toggleCommandPanel}
          title={commandPanelExpanded ? t('terminal.hideCommandPanel') : t('terminal.showCommandPanel')}
          aria-label={commandPanelExpanded ? t('terminal.hideCommandPanel') : t('terminal.showCommandPanel')}
          aria-pressed={commandPanelExpanded ? 'true' : 'false'}
        >
          {commandPanelExpanded ? <PanelBottomClose size={14} /> : <PanelBottomOpen size={14} />}
        </button>
        <button
          type="button"
          className="icon-button component-node__header-action-button"
          onClick={() => setEnvironmentDialogOpen(true)}
          title={t('terminal.configureEnvironment')}
          aria-label={t('terminal.configureEnvironment')}
        >
          <Settings2 size={14} />
        </button>
        <button
          type="button"
          className={cn('icon-button component-node__header-action-button', isLocked && 'component-node__header-action-button--active')}
          onClick={toggleLocked}
          title={isLocked ? t('terminal.unlockNode') : t('terminal.lockNode')}
          aria-label={isLocked ? t('terminal.unlockNode') : t('terminal.lockNode')}
          aria-pressed={isLocked ? 'true' : 'false'}
        >
          {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
      </>
    ),
    [commandPanelExpanded, isLocked, t, toggleCommandPanel, toggleLocked]
  )

  useEffect(() => {
    if (!setHeaderActions) return undefined

    setHeaderActions(headerActions)
    return () => setHeaderActions(null)
  }, [headerActions, setHeaderActions])

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
      const currentContainer = containerRef.current
      if (!currentInstance || !currentContainer?.isConnected) return

      // textarea 已持有焦点时不要再次 focus()，否则会重复触发 DEC 焦点上报（CSI I），
      // 在 Codex 一类应用里表现为 [I 被当输入写进去。
      if (isTerminalTextareaFocused(currentContainer)) {
        pendingFocusRef.current = false
        return
      }

      currentInstance.focus()
      pendingFocusRef.current = false
    })
  }, [clearScheduledFocus])

  const writeTerminalCommand = useCallback(
    (command: string, execute: boolean) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return

      void window.atlas.terminal.write(sessionId, execute ? `${command}\r` : command)
      requestFocus()
    },
    [requestFocus]
  )

  const insertTerminalCommand = useCallback(
    (command: string) => {
      writeTerminalCommand(command, false)
    },
    [writeTerminalCommand]
  )

  const executeTerminalCommand = useCallback(
    (command: string) => {
      writeTerminalCommand(command, true)
    },
    [writeTerminalCommand]
  )

  const pasteFilesIntoTerminal = useCallback(
    async (files: File[]) => {
      const instance = terminalRef.current
      if (!instance || files.length === 0) return

      try {
        const resolvedAssets = await Promise.all(files.map((file) => resolveTerminalAsset(file, tRef.current)))
        if (terminalRef.current !== instance) return
        if (resolvedAssets.length === 0) return

        instance.paste(formatTerminalPaths(resolvedAssets.map((asset) => asset.path)))

        const createdCount = resolvedAssets.filter((asset) => asset.createdFromClipboard).length
        const message =
          createdCount === 1 && resolvedAssets.length === 1
            ? tRef.current('terminal.savedScreenshotInserted')
            : resolvedAssets.length === 1
              ? tRef.current('terminal.insertedAttachmentPath')
              : tRef.current('terminal.insertedAttachmentPaths', { count: resolvedAssets.length })

        const detail = resolvedAssets.length === 1 ? resolvedAssets[0].name : resolvedAssets.map((asset) => asset.name).join(', ')
        showPasteFeedback({ tone: 'info', message, detail })
      } catch (error) {
        showPasteFeedback({
          tone: 'error',
          message: tRef.current('terminal.unableInsertPastedAttachment'),
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
          return false
        }

        if (terminalRef.current !== instance) return true

        instance.paste(formatTerminalPaths([saved.path]))
        showPasteFeedback({
          tone: 'info',
          message: tRef.current('terminal.savedScreenshotInserted'),
          detail: fileName(saved.path)
        })
        return true
      } catch (error) {
        showPasteFeedback({
          tone: 'error',
          message: tRef.current('terminal.unableInsertPastedScreenshot'),
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
          return false
        }

        if (terminalRef.current !== instance) return true

        instance.paste(formatTerminalPaths(result.paths))
        showPasteFeedback({
          tone: 'info',
          message:
            result.paths.length === 1
              ? tRef.current('terminal.insertedCopiedFilePath')
              : tRef.current('terminal.insertedCopiedFilePaths', { count: result.paths.length }),
          detail: result.paths.length === 1 ? fileName(result.paths[0]) : result.paths.map(fileName).join(', ')
        })
        return true
      } catch {
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
          message:
            images.length === 1
              ? tRef.current('terminal.savedScreenshotInserted')
              : tRef.current('terminal.savedScreenshotsInserted', { count: images.length }),
          detail: savedImages.length === 1 ? fileName(savedImages[0]) : savedImages.map(fileName).join(', ')
        })
        return true
      } catch (error) {
        showPasteFeedback({
          tone: 'error',
          message: tRef.current('terminal.unableInsertPastedScreenshot'),
          detail: error instanceof Error ? error.message : String(error)
        })
        return false
      }
    },
    [showPasteFeedback]
  )

  const pasteClipboardIntoTerminal = useCallback(
    async (instance: Terminal, event?: ClipboardEvent) => {
      const files = dataTransferFiles(event?.clipboardData)
      if (files.length > 0) {
        await pasteFilesIntoTerminal(files)
        return true
      }

      const text = event?.clipboardData?.getData('text/plain') || ''
      if (text) {
        instance.paste(text)
        return true
      }

      if (await pasteNativeClipboardFilesIntoTerminal()) {
        return true
      }

      const nativeText = readNativeClipboardText()
      if (nativeText) {
        instance.paste(nativeText)
        return true
      }

      const browserImages = await readBrowserClipboardImages()
      if (browserImages.length > 0) {
        return pasteBrowserClipboardImagesIntoTerminal(browserImages)
      }

      if (await pasteNativeClipboardImageIntoTerminal()) {
        return true
      }

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
    if (!appSettingsLoaded) return undefined

    const container = containerRef.current
    if (!container) return

    let disposed = false
    let initFrame: number | null = null
    let resizeFrame: number | null = null
    let terminal: Terminal | null = null
    let fitAddon: FitAddon | null = null
    let resizeObserver: ResizeObserver | null = null
    let dataDisposable: Disposable | null = null
    let selectionDisposable: Disposable | null = null
    let transformedCanvasMouseFix: Disposable | null = null
    let compositorPaintFix: Disposable | null = null
    let clipboardShortcuts: Disposable | null = null
    let disposeData: () => void = () => undefined
    let disposeExit: () => void = () => undefined
    let unregisterTranslationSelectionProvider: () => void = () => undefined
    let removeDomListeners: () => void = () => undefined
    let shortcutPasteFallbackTimer: number | null = null

    const fitAndResize = (sendResize: boolean): void => {
      if (disposed || !terminal || !fitAddon || !container.isConnected) return

      const rect = container.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return

      try {
        fitAddon.fit()
        if (sendResize && sessionIdRef.current && validTerminalSize(terminal)) {
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

      const windowsPty = createWindowsPtyOption()
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
        },
        ...(windowsPty ? { windowsPty } : {})
      })

      terminal = instance
      terminalRef.current = instance
      fitAddon = new FitAddon()

      instance.loadAddon(fitAddon)
      instance.loadAddon(new SearchAddon())
      instance.loadAddon(new WebLinksAddon((event, uri) => openTerminalWebLink(event, uri, instance)))
      instance.open(container)
      transformedCanvasMouseFix = installTransformedCanvasMouseFix(instance)
      compositorPaintFix = installTerminalCompositorPaintFix(instance, container)
      selectionDisposable = instance.onSelectionChange(refreshTerminalSelectionSnapshot)
      unregisterTranslationSelectionProvider = registerTranslationSelectionProvider(() => {
        if (!container.isConnected || terminalRef.current !== instance || !isNodeSelectedRef.current) return ''
        return selectedTerminalText()
      })
      clipboardShortcuts = installTerminalClipboardShortcuts(instance, {
        getSelectionText: selectedTerminalText,
        isCopyShortcutActive: () => isNodeSelectedRef.current,
        getContainer: () => containerRef.current,
        onClearSelection: clearTerminalSelectionSnapshot,
        onCopySelection: (text) => {
          void writeClipboardText(text).catch(() => undefined)
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

        // Let Chromium emit the native paste event for text; this fallback only runs if no paste event arrives.
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
        const sessionId = sessionIdRef.current
        if (!sessionId) return
        // 仅在 xterm textarea 真正聚焦时转发鼠标上报；焦点上报（CSI I/O）仍放行，
        // 因为 blur 后本来就不聚焦，仍需要发出 [O。
        if (!shouldWriteTerminalUserInput(data, container)) return
        void window.atlas.terminal.write(sessionId, data)
      })

      resizeObserver = new ResizeObserver(scheduleFit)
      resizeObserver.observe(container)

      const initialSize = createTerminalSize(instance)
      void window.atlas.terminal
        .create({
          componentId: component.id,
          canvasId,
          title: component.title,
          cwd: cwdRef.current,
          shell: asString(component.config.shell),
          initialCommand: startupCommand,
          environment: sessionEnvironment,
          autoConfirmWorkspaceTrust,
          cols: initialSize.cols,
          rows: initialSize.rows
        })
        .then((session) => {
          if (disposed) {
            // The PTY is owned by componentId and may already be reused by a newer view.
            return
          }

          sessionIdRef.current = session.sessionId
          setSessionReady(true)
          const startupStatePatch: Record<string, unknown> = {}
          if (session.cwd !== cwdRef.current) {
            cwdRef.current = session.cwd
            startupStatePatch.cwd = session.cwd
          }
          if (session.didRunInitialCommand) {
            startupStatePatch.initialCommandDispatched = true
            const agentRestore = startupCommand ? createTerminalAgentRestore(startupCommand, session.cwd) : null
            if (agentRestore) {
              activeAgentRestoreRef.current = agentRestore
              startupStatePatch.agentRestore = agentRestore
              startupStatePatch.agentRestoreActive = true
            }
          }
          if (Object.keys(startupStatePatch).length > 0) {
            updateState(startupStatePatch, true)
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
            updateState({ cwd }, true)
          })
          const disposeAgentCommand = window.atlas.terminal.onAgentCommand(session.sessionId, (event) => {
            if (disposed) return
            const agentRestore = createTerminalAgentRestore(event.command, event.cwd || cwdRef.current)
            if (agentRestore) persistActiveAgentRestore(agentRestore)
          })
          const disposeAgentSessionEnded = window.atlas.terminal.onAgentSessionEnded(session.sessionId, (event) => {
            if (disposed) return
            clearActiveAgentRestore(event)
          })
          disposeExit = window.atlas.terminal.onExit(session.sessionId, ({ exitCode }) => {
            if (disposed) return
            sessionIdRef.current = null
            setSessionReady(false)
            if (suppressedExitSessionIdsRef.current.delete(session.sessionId)) return
            instance.writeln(`\r\n${tRef.current('terminal.processExited', { code: exitCode })}`)
          })
          const previousDisposeExit = disposeExit
          disposeExit = () => {
            previousDisposeExit()
            disposeCwd()
            disposeAgentCommand()
            disposeAgentSessionEnded()
          }
        })
        .catch((error) => {
          if (disposed) return
          setSessionReady(false)
          instance.writeln(tRef.current('terminal.startFailed', { message: error instanceof Error ? error.message : String(error) }))
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
      unregisterTranslationSelectionProvider()
      disposeData()
      disposeExit()
      dataDisposable?.dispose()
      selectionDisposable?.dispose()
      transformedCanvasMouseFix?.dispose()
      compositorPaintFix?.dispose()
      clipboardShortcuts?.dispose()
      resizeObserver?.disconnect()
      sessionIdRef.current = null
      terminalRef.current = null
      clearTerminalSelectionSnapshot()
      setSessionReady(false)

      const instance = terminal
      if (instance) {
        window.setTimeout(() => instance.dispose(), 0)
      }
    }
  }, [
    appSettingsLoaded,
    clearActiveAgentRestore,
    clearScheduledFocus,
    clearTerminalSelectionSnapshot,
    canvasId,
    component.id,
    component.title,
    component.config.cwd,
    component.config.environment,
    component.config.environmentDisabledNames,
    component.config.environmentGlobalNames,
    component.config.initialCommand,
    component.config.shell,
    pasteClipboardIntoTerminal,
    pasteFilesIntoTerminal,
    pasteNativeClipboardFilesIntoTerminal,
    pasteNativeClipboardImageIntoTerminal,
    persistActiveAgentRestore,
    requestFocus,
    refreshTerminalSelectionSnapshot,
    selectedTerminalText,
    updateState
  ])

  const commandPanelStyle = commandPanelHeight === null
    ? undefined
    : ({
        '--terminal-command-panel-height': `${commandPanelHeight}px`
      } as CSSProperties)
  const { minHeight: commandPanelAriaMinHeight, maxHeight: commandPanelAriaMaxHeight } = commandPanelResizeBounds(component.frame.height)
  const commandPanelAriaHeight = commandPanelHeight ?? persistedCommandPanelHeight ?? COMMAND_PANEL_DEFAULT_HEIGHT

  return (
    <div ref={moduleRef} className={cn('terminal-module', commandPanelExpanded && 'terminal-module--commands-open')} style={commandPanelStyle}>
      <Dialog.Root open={environmentDialogOpen} onOpenChange={setEnvironmentDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content terminal-environment-dialog">
            <div className="terminal-environment-dialog__header">
              <div>
                <Dialog.Title className="dialog-title">{t('terminal.configureEnvironment')}</Dialog.Title>
                <Dialog.Description className="dialog-description">{t('terminalEnvironment.nodeDescription')}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="icon-button" aria-label={t('common.close')}>
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>
            <TerminalEnvironmentEditor
              globalEnvironment={globalEnvironment}
              globalDisabledNames={globalDisabledEnvironmentNames}
              initialEnvironment={nodeEnvironment}
              initialDisabledNames={nodeDisabledEnvironmentNames}
              initialSelectedGlobalNames={selectedGlobalEnvironmentNames}
              description={t('terminalEnvironment.nodeRestartDescription')}
              onSave={saveNodeEnvironment}
              saveLabel={t('terminalEnvironment.saveAndRestart')}
              showGlobalSelection
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div ref={containerRef} className="terminal-module__screen" />
      {commandPanelExpanded ? (
        <div ref={commandPanelRef} className="terminal-module__commands">
          <button
            type="button"
            className="terminal-module__command-resizer"
            role="separator"
            aria-label={t('terminal.resizeCommandPanel')}
            aria-orientation="horizontal"
            aria-valuemin={commandPanelAriaMinHeight}
            aria-valuemax={commandPanelAriaMaxHeight}
            aria-valuenow={Math.round(commandPanelAriaHeight)}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onPointerDown={beginCommandPanelResize}
            onPointerMove={moveCommandPanelResize}
            onPointerUp={endCommandPanelResize}
            onPointerCancel={endCommandPanelResize}
            onKeyDown={nudgeCommandPanelResize}
          />
          <TerminalCommandLibraryManager
            compactCommands
            commandActionsDisabled={!sessionReady}
            onInsertCommand={insertTerminalCommand}
            onExecuteCommand={executeTerminalCommand}
          />
        </div>
      ) : null}
      {isDropActive ? (
        <div className="terminal-module__drop-overlay" aria-hidden="true">
          {t('terminal.dropFiles')}
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
