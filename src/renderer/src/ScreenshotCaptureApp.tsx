import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, FileText, Image as ImageIcon, Languages, Loader2, X } from 'lucide-react'
import { MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS, type AiScreenshotCaptureDisplay, type AiScreenshotCaptureSession } from '@shared/ai'
import { useI18n } from './i18n'
import { writeClipboardText } from './lib/clipboard'

type Point = {
  x: number
  y: number
}

type CaptureRect = {
  x: number
  y: number
  width: number
  height: number
}

type TextActionState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  text: string
  error: string | null
}

const MIN_SELECTION_SIZE = 4
const MAX_CROPPED_IMAGE_EDGE = 1800
const MIN_CROPPED_IMAGE_SCALE = 0.08
const CROPPED_IMAGE_SCALE_STEP = 0.75
const CROPPED_IMAGE_JPEG_QUALITIES = [0.92, 0.82, 0.72, 0.62]
const TOOLBAR_WIDTH = 252
const PANEL_WIDTH = 360
const PANEL_HEIGHT = 220
const FLOATING_MARGIN = 12

function normalizeRect(start: Point, end: Point): CaptureRect {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)

  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

function hasUsableSelection(selection: CaptureRect | null): selection is CaptureRect {
  return Boolean(selection && selection.width >= MIN_SELECTION_SIZE && selection.height >= MIN_SELECTION_SIZE)
}

function displayLocalBounds(session: AiScreenshotCaptureSession, display: AiScreenshotCaptureDisplay): CaptureRect {
  return {
    x: display.bounds.x - session.virtualBounds.x,
    y: display.bounds.y - session.virtualBounds.y,
    width: display.bounds.width,
    height: display.bounds.height
  }
}

function intersectRect(a: CaptureRect, b: CaptureRect): CaptureRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null

  return { x, y, width: right - x, height: bottom - y }
}

function clampFloatingPosition(selection: CaptureRect, width: number, height: number, gap = 8): React.CSSProperties {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const maxLeft = Math.max(FLOATING_MARGIN, viewportWidth - width - FLOATING_MARGIN)
  const left = Math.min(Math.max(FLOATING_MARGIN, selection.x), maxLeft)
  const preferredTop = selection.y + selection.height + gap
  const top =
    preferredTop + height <= viewportHeight - FLOATING_MARGIN
      ? preferredTop
      : Math.max(FLOATING_MARGIN, selection.y - height - gap)

  return { left, top }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load screenshot image'))
    image.src = src
  })
}

async function renderSelectionToCanvas(session: AiScreenshotCaptureSession, selection: CaptureRect, outputScale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(selection.width * outputScale))
  canvas.height = Math.max(1, Math.round(selection.height * outputScale))

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to prepare screenshot crop')

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  for (const display of session.displays) {
    const displayBounds = displayLocalBounds(session, display)
    const overlap = intersectRect(selection, displayBounds)
    if (!overlap) continue

    const image = await loadImage(display.imageDataUrl)
    const naturalWidth = image.naturalWidth || image.width || display.imageSize.width
    const naturalHeight = image.naturalHeight || image.height || display.imageSize.height
    const sourceScaleX = naturalWidth / displayBounds.width
    const sourceScaleY = naturalHeight / displayBounds.height

    context.drawImage(
      image,
      (overlap.x - displayBounds.x) * sourceScaleX,
      (overlap.y - displayBounds.y) * sourceScaleY,
      overlap.width * sourceScaleX,
      overlap.height * sourceScaleY,
      (overlap.x - selection.x) * outputScale,
      (overlap.y - selection.y) * outputScale,
      overlap.width * outputScale,
      overlap.height * outputScale
    )
  }

  return canvas
}

function boundedCanvasDataUrl(canvas: HTMLCanvasElement): string | null {
  const png = canvas.toDataURL('image/png')
  if (png.length <= MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS) return png

  for (const quality of CROPPED_IMAGE_JPEG_QUALITIES) {
    const jpeg = canvas.toDataURL('image/jpeg', quality)
    if (jpeg.length <= MAX_AI_SCREENSHOT_IMAGE_DATA_URL_CHARS) return jpeg
  }

  return null
}

async function cropSelectionToDataUrl(session: AiScreenshotCaptureSession, selection: CaptureRect): Promise<string> {
  const edgeScale = MAX_CROPPED_IMAGE_EDGE / Math.max(selection.width, selection.height)
  let outputScale = Math.max(0.2, Math.min(window.devicePixelRatio || 1, 2, edgeScale))

  while (outputScale >= MIN_CROPPED_IMAGE_SCALE) {
    const canvas = await renderSelectionToCanvas(session, selection, outputScale)
    const dataUrl = boundedCanvasDataUrl(canvas)
    if (dataUrl) return dataUrl
    outputScale *= CROPPED_IMAGE_SCALE_STEP
  }

  throw new Error('Screenshot image is too large to process')
}

function emptyTextActionState(): TextActionState {
  return {
    status: 'idle',
    text: '',
    error: null
  }
}

export function ScreenshotCaptureApp(): JSX.Element {
  const { t } = useI18n()
  const [session, setSession] = useState<AiScreenshotCaptureSession | null>(null)
  const [selection, setSelection] = useState<CaptureRect | null>(null)
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [ocr, setOcr] = useState<TextActionState>(() => emptyTextActionState())
  const [translation, setTranslation] = useState<TextActionState>(() => emptyTextActionState())
  const [error, setError] = useState<string | null>(null)

  const usableSelection = hasUsableSelection(selection)
  const toolbarStyle = useMemo(() => (usableSelection ? clampFloatingPosition(selection, TOOLBAR_WIDTH, 40) : undefined), [selection, usableSelection])
  const panelStyle = useMemo(() => (usableSelection ? clampFloatingPosition(selection, PANEL_WIDTH, PANEL_HEIGHT, 56) : undefined), [selection, usableSelection])

  const resetResults = useCallback(() => {
    setOcr(emptyTextActionState())
    setTranslation(emptyTextActionState())
    setError(null)
  }, [])

  const applySession = useCallback((nextSession: AiScreenshotCaptureSession | null) => {
    setSession(nextSession)
    setSelection(null)
    setDragStart(null)
    resetResults()
    if (!nextSession) setError(t('screenshot.noSession'))
  }, [resetResults, t])

  const closeCapture = useCallback(async () => {
    applySession(null)
    await window.atlas.ai.closeScreenshotCapture()
  }, [applySession])

  useEffect(() => {
    const dispose = window.atlas.ai.onScreenshotCaptureSession(applySession)

    void window.atlas.ai.getActiveScreenshotCapture().then(applySession).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    })

    return dispose
  }, [applySession])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCapture()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeCapture])

  const pointerPoint = (event: React.PointerEvent<HTMLElement>): Point => ({
    x: event.clientX,
    y: event.clientY
  })

  const startSelection = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const point = pointerPoint(event)
    setDragStart(point)
    setSelection({ ...point, width: 0, height: 0 })
    resetResults()
  }

  const updateSelection = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragStart) return
    setSelection(normalizeRect(dragStart, pointerPoint(event)))
  }

  const endSelection = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragStart) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const nextSelection = normalizeRect(dragStart, pointerPoint(event))
    setDragStart(null)
    setSelection(hasUsableSelection(nextSelection) ? nextSelection : null)
  }

  const croppedImageDataUrl = async (): Promise<string> => {
    if (!session || !usableSelection) throw new Error(t('screenshot.noSelection'))
    return cropSelectionToDataUrl(session, selection)
  }

  const runOcr = async () => {
    if (!session || !usableSelection) return

    setOcr({ status: 'loading', text: '', error: null })
    setError(null)
    try {
      const imageDataUrl = await croppedImageDataUrl()
      const result = await window.atlas.ai.ocrScreenshot({ sessionId: session.id, imageDataUrl })
      setOcr({ status: 'ready', text: result.text, error: null })
    } catch (nextError) {
      setOcr({ status: 'error', text: '', error: nextError instanceof Error ? nextError.message : String(nextError) })
    }
  }

  const runTranslation = async () => {
    if (!session || !usableSelection) return

    setTranslation({ status: 'loading', text: '', error: null })
    setError(null)
    try {
      const imageDataUrl = await croppedImageDataUrl()
      const result = await window.atlas.ai.translateScreenshot({ sessionId: session.id, imageDataUrl })
      setTranslation({ status: 'ready', text: result.text, error: null })
    } catch (nextError) {
      setTranslation({ status: 'error', text: '', error: nextError instanceof Error ? nextError.message : String(nextError) })
    }
  }

  const copyImage = async () => {
    if (!session || !usableSelection) return

    try {
      const imageDataUrl = await croppedImageDataUrl()
      await window.atlas.ai.copyScreenshotImage({ sessionId: session.id, imageDataUrl })
      await closeCapture()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }

  const copyText = async (text: string) => {
    if (!text) return
    const copied = await writeClipboardText(text)
    if (!copied) return

    try {
      await closeCapture()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }

  return (
    <main
      className="screenshot-capture"
      onPointerDown={startSelection}
      onPointerMove={updateSelection}
      onPointerUp={endSelection}
      aria-label={t('screenshot.capture')}
    >
      {session ? (
        <div className="screenshot-capture__screens" aria-hidden="true">
          {session.displays.map((display) => {
            const bounds = displayLocalBounds(session, display)
            return (
              <img
                key={display.id}
                className="screenshot-capture__screen"
                src={display.imageDataUrl}
                alt=""
                style={{
                  left: bounds.x,
                  top: bounds.y,
                  width: bounds.width,
                  height: bounds.height
                }}
              />
            )
          })}
        </div>
      ) : null}

      {usableSelection ? (
        <>
          <div
            className="screenshot-capture__selection"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height
            }}
            aria-hidden="true"
          />
          <div className="screenshot-capture__toolbar" style={toolbarStyle} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="icon-button" title={t('screenshot.ocr')} aria-label={t('screenshot.ocr')} onClick={() => void runOcr()} disabled={ocr.status === 'loading'}>
              {ocr.status === 'loading' ? <Loader2 size={15} className="screenshot-capture__spinner" /> : <FileText size={15} />}
            </button>
            <button
              type="button"
              className="icon-button"
              title={t('screenshot.translate')}
              aria-label={t('screenshot.translate')}
              onClick={() => void runTranslation()}
              disabled={translation.status === 'loading'}
            >
              {translation.status === 'loading' ? <Loader2 size={15} className="screenshot-capture__spinner" /> : <Languages size={15} />}
            </button>
            <button type="button" className="icon-button" title={t('screenshot.copyImage')} aria-label={t('screenshot.copyImage')} onClick={() => void copyImage()}>
              <ImageIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={t('screenshot.copyOcr')}
              aria-label={t('screenshot.copyOcr')}
              onClick={() => void copyText(ocr.text)}
              disabled={!ocr.text}
            >
              <Copy size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={t('screenshot.copyTranslation')}
              aria-label={t('screenshot.copyTranslation')}
              onClick={() => void copyText(translation.text)}
              disabled={!translation.text}
            >
              <Copy size={15} />
            </button>
            <button type="button" className="icon-button" title={t('common.cancel')} aria-label={t('common.cancel')} onClick={() => void closeCapture()}>
              <X size={15} />
            </button>
          </div>

          {(ocr.status !== 'idle' || translation.status !== 'idle' || error) ? (
            <section className="screenshot-capture__panel" style={panelStyle} onPointerDown={(event) => event.stopPropagation()}>
              {error ? <div className="screenshot-capture__error">{error}</div> : null}
              {ocr.status !== 'idle' ? (
                <article className="screenshot-capture__result">
                  <h2>{t('screenshot.ocrResult')}</h2>
                  {ocr.status === 'loading' ? (
                    <div className="screenshot-capture__state"><Loader2 size={14} className="screenshot-capture__spinner" />{t('screenshot.ocrLoading')}</div>
                  ) : ocr.status === 'error' ? (
                    <div className="screenshot-capture__error">{ocr.error ?? t('screenshot.failed')}</div>
                  ) : (
                    <pre>{ocr.text || t('screenshot.emptyResult')}</pre>
                  )}
                </article>
              ) : null}
              {translation.status !== 'idle' ? (
                <article className="screenshot-capture__result">
                  <h2>{t('screenshot.translationResult')}</h2>
                  {translation.status === 'loading' ? (
                    <div className="screenshot-capture__state"><Loader2 size={14} className="screenshot-capture__spinner" />{t('screenshot.translating')}</div>
                  ) : translation.status === 'error' ? (
                    <div className="screenshot-capture__error">{translation.error ?? t('screenshot.failed')}</div>
                  ) : (
                    <pre>{translation.text || t('screenshot.emptyResult')}</pre>
                  )}
                </article>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {!session ? (
        <div className="screenshot-capture__center-message" onPointerDown={(event) => event.stopPropagation()}>
          {error ?? t('screenshot.noSession')}
          <button type="button" className="icon-button" title={t('common.close')} aria-label={t('common.close')} onClick={closeCapture}>
            <X size={15} />
          </button>
        </div>
      ) : null}
    </main>
  )
}
