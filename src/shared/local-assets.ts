export const LOCAL_ASSET_PROTOCOL = 'atlas-file'
export const LOCAL_ASSET_HOST = 'preview'

export type ByteRange =
  | { kind: 'full' }
  | {
      kind: 'partial'
      start: number
      end: number
    }
  | { kind: 'invalid' }

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska'
}

function extensionForPath(path: string): string {
  return path.toLowerCase().match(/\.[^.\\/]+$/)?.[0] ?? ''
}

export function mimeTypeForLocalAsset(path: string): string {
  return MIME_TYPES_BY_EXTENSION[extensionForPath(path)] ?? 'application/octet-stream'
}

export function localAssetUrl(rootPath: string, path: string): string {
  const params = new URLSearchParams({ rootPath, path })
  return `${LOCAL_ASSET_PROTOCOL}://${LOCAL_ASSET_HOST}?${params.toString()}`
}

export function parseLocalAssetUrl(url: string): { rootPath: string; targetPath: string } {
  const parsed = new URL(url)

  if (parsed.protocol !== `${LOCAL_ASSET_PROTOCOL}:` || parsed.hostname !== LOCAL_ASSET_HOST) {
    throw new Error('Invalid local asset URL')
  }

  const rootPath = parsed.searchParams.get('rootPath')
  const targetPath = parsed.searchParams.get('path')

  if (!rootPath || !targetPath) {
    throw new Error('Local asset URL is missing a file path')
  }

  return { rootPath, targetPath }
}

export function parseByteRange(rangeHeader: string | null | undefined, size: number): ByteRange {
  if (!rangeHeader) return { kind: 'full' }
  if (!Number.isSafeInteger(size) || size < 0) return { kind: 'invalid' }

  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return { kind: 'invalid' }

  const [, startText, endText] = match
  if (!startText && !endText) return { kind: 'invalid' }

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) return { kind: 'invalid' }

    return {
      kind: 'partial',
      start: Math.max(size - suffixLength, 0),
      end: size - 1
    }
  }

  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) return { kind: 'invalid' }
  if (size === 0 || start < 0 || start >= size || requestedEnd < start) return { kind: 'invalid' }

  return {
    kind: 'partial',
    start,
    end: Math.min(requestedEnd, size - 1)
  }
}
