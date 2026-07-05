import { desktopCapturer as electronDesktopCapturer, type DesktopCapturerSource } from 'electron'
import type { AiScreenshotCaptureBounds, AiScreenshotCaptureDisplay } from '@shared/ai'

type DesktopSource = Pick<DesktopCapturerSource, 'display_id' | 'thumbnail'>

type DesktopCapturerLike = {
  getSources: (options: {
    types: ['screen']
    thumbnailSize: Electron.Size
    fetchWindowIcons: false
  }) => Promise<DesktopSource[]>
}

type NativeImage = {
  width: number
  height: number
  toPng: (copyOutputData?: boolean | undefined | null) => Promise<Buffer>
}

type NativeMonitor = {
  captureImage: () => Promise<NativeImage>
}

type NativeScreenshotsModule = {
  Monitor: {
    fromPoint: (x: number, y: number) => NativeMonitor | null
  }
}

type ScreenshotCaptureEngineOptions = {
  desktopCapturer?: DesktopCapturerLike
  loadNativeScreenshots?: () => Promise<NativeScreenshotsModule>
}

function captureBoundsFromRectangle(rectangle: Electron.Rectangle): AiScreenshotCaptureBounds {
  return {
    x: Math.round(rectangle.x),
    y: Math.round(rectangle.y),
    width: Math.round(rectangle.width),
    height: Math.round(rectangle.height)
  }
}

function thumbnailSizeForDisplays(displays: Electron.Display[]): Electron.Size {
  return {
    width: Math.max(1, ...displays.map((display) => Math.round(display.bounds.width * display.scaleFactor))),
    height: Math.max(1, ...displays.map((display) => Math.round(display.bounds.height * display.scaleFactor)))
  }
}

async function loadNativeScreenshots(): Promise<NativeScreenshotsModule> {
  return await import('node-screenshots') as unknown as NativeScreenshotsModule
}

async function captureDisplaysWithNative(
  displays: Electron.Display[],
  nativeScreenshots: NativeScreenshotsModule
): Promise<AiScreenshotCaptureDisplay[]> {
  return Promise.all(
    displays.map(async (display) => {
      const centerX = display.bounds.x + display.bounds.width / 2
      const centerY = display.bounds.y + display.bounds.height / 2
      const monitor = nativeScreenshots.Monitor.fromPoint(centerX, centerY)
      if (!monitor) throw new Error(`Unable to resolve native monitor for display ${display.id}`)

      const image = await monitor.captureImage()
      if (image.width <= 0 || image.height <= 0) throw new Error(`Native capture for display ${display.id} is empty`)

      const buffer = await image.toPng(true)
      if (buffer.length === 0) throw new Error(`Native capture for display ${display.id} produced no image data`)

      return {
        id: String(display.id),
        bounds: captureBoundsFromRectangle(display.bounds),
        scaleFactor: display.scaleFactor,
        imageDataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        imageSize: {
          width: image.width,
          height: image.height
        }
      }
    })
  )
}

async function captureDisplaysWithElectron(
  displays: Electron.Display[],
  desktopCapturer: DesktopCapturerLike
): Promise<AiScreenshotCaptureDisplay[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: thumbnailSizeForDisplays(displays),
    fetchWindowIcons: false
  })

  return displays.map((display, index) => {
    const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[index] ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error(`Unable to capture display ${display.id}`)

    const imageSize = source.thumbnail.getSize()
    return {
      id: String(display.id),
      bounds: captureBoundsFromRectangle(display.bounds),
      scaleFactor: display.scaleFactor,
      imageDataUrl: source.thumbnail.toDataURL(),
      imageSize: {
        width: imageSize.width,
        height: imageSize.height
      }
    }
  })
}

export async function captureScreenshotDisplays(
  displays: Electron.Display[],
  {
    desktopCapturer = electronDesktopCapturer,
    loadNativeScreenshots: loadNativeScreenshotsInput = loadNativeScreenshots
  }: ScreenshotCaptureEngineOptions = {}
): Promise<AiScreenshotCaptureDisplay[]> {
  try {
    const nativeScreenshots = await loadNativeScreenshotsInput()
    return await captureDisplaysWithNative(displays, nativeScreenshots)
  } catch {
    return captureDisplaysWithElectron(displays, desktopCapturer)
  }
}
