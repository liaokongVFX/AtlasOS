import { fileURLToPath } from 'node:url'

type ClipboardBufferReader = (format: string) => Buffer
type ClipboardTextReader = (format: string) => string

const WINDOWS_HDROP_FORMATS = new Set(['cf_hdrop'])
const WINDOWS_UTF16_FILENAME_FORMATS = new Set(['filenamew'])
const WINDOWS_TEXT_FILENAME_FORMATS = new Set(['filename'])
const URI_LIST_FORMATS = new Set(['text/uri-list'])

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const path of paths) {
    const normalized = normalizeClipboardPath(path)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

function normalizeClipboardPath(path: string): string {
  const trimmed = path.trim().replace(/\0+$/g, '')
  if (!trimmed) return ''

  if (/^file:\/\//i.test(trimmed)) {
    try {
      return fileURLToPath(trimmed)
    } catch {
      return ''
    }
  }

  return trimmed
}

function isLikelyAbsoluteFilePath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value) || /^\//.test(value)
}

function decodeUtf16Be(buffer: Buffer): string {
  const swapped = Buffer.allocUnsafe(buffer.length)

  for (let index = 0; index < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1] ?? 0
    swapped[index + 1] = buffer[index]
  }

  return swapped.toString('utf16le')
}

function looksLikeUtf16Le(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 512)
  if (sampleLength < 4) return false

  let oddNulls = 0
  let evenNulls = 0

  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) continue
    if (index % 2 === 0) {
      evenNulls += 1
    } else {
      oddNulls += 1
    }
  }

  return oddNulls >= 2 && oddNulls > evenNulls * 2
}

function decodeClipboardText(buffer: Buffer): string {
  if (buffer.length === 0) return ''

  if (buffer.length >= 2) {
    const first = buffer[0]
    const second = buffer[1]

    if (first === 0xff && second === 0xfe) {
      return buffer.subarray(2).toString('utf16le')
    }

    if (first === 0xfe && second === 0xff) {
      return decodeUtf16Be(buffer.subarray(2))
    }
  }

  if (looksLikeUtf16Le(buffer)) {
    return buffer.toString('utf16le')
  }

  return buffer.toString('utf8')
}

export function parseNullSeparatedUtf16Paths(buffer: Buffer): string[] {
  const paths: string[] = []
  let start = 0

  for (let index = 0; index + 1 < buffer.length; index += 2) {
    if (buffer.readUInt16LE(index) !== 0) continue

    if (index === start) break

    paths.push(buffer.subarray(start, index).toString('utf16le'))
    start = index + 2
  }

  if (start < buffer.length - 1) {
    const remainder = buffer.subarray(start).toString('utf16le').replace(/\0+$/g, '')
    if (remainder) paths.push(remainder)
  }

  return uniquePaths(paths)
}

export function parseNullSeparatedTextPaths(buffer: Buffer): string[] {
  return uniquePaths(buffer.toString('utf8').replace(/\0+$/g, '').split('\0'))
}

export function parseWindowsHdropPaths(buffer: Buffer): string[] {
  if (buffer.length < 20) return []

  const fileListOffset = buffer.readUInt32LE(0)
  if (fileListOffset <= 0 || fileListOffset >= buffer.length) return []

  const isWide = buffer.readUInt32LE(16) !== 0
  const fileList = buffer.subarray(fileListOffset)
  return isWide ? parseNullSeparatedUtf16Paths(fileList) : parseNullSeparatedTextPaths(fileList)
}

export function parseFileUriListPaths(input: Buffer | string): string[] {
  const value = typeof input === 'string' ? input : decodeClipboardText(input)

  return uniquePaths(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => (/^file:\/\//i.test(line) || isLikelyAbsoluteFilePath(line) ? line : ''))
  )
}

function readClipboardBuffer(format: string, readBuffer: ClipboardBufferReader): Buffer {
  try {
    return readBuffer(format)
  } catch {
    return Buffer.alloc(0)
  }
}

function readClipboardText(format: string, readText?: ClipboardTextReader): string {
  if (!readText) return ''

  try {
    return readText(format)
  } catch {
    return ''
  }
}

export function readClipboardFilePathsFromNativeFormats(
  formats: string[],
  readBuffer: ClipboardBufferReader,
  readText?: ClipboardTextReader
): string[] {
  const paths: string[] = []

  for (const format of formats) {
    const normalizedFormat = format.toLowerCase()
    const buffer = readClipboardBuffer(format, readBuffer)

    if (!buffer || buffer.length === 0) {
      if (URI_LIST_FORMATS.has(normalizedFormat)) {
        const text = readClipboardText(format, readText)
        if (text) paths.push(...parseFileUriListPaths(text))
      }
      continue
    }

    if (WINDOWS_HDROP_FORMATS.has(normalizedFormat)) {
      paths.push(...parseWindowsHdropPaths(buffer))
    } else if (WINDOWS_UTF16_FILENAME_FORMATS.has(normalizedFormat)) {
      paths.push(...parseNullSeparatedUtf16Paths(buffer))
    } else if (WINDOWS_TEXT_FILENAME_FORMATS.has(normalizedFormat)) {
      paths.push(...parseNullSeparatedTextPaths(buffer))
    } else if (URI_LIST_FORMATS.has(normalizedFormat)) {
      const uriListPaths = [
        ...parseFileUriListPaths(readClipboardText(format, readText)),
        ...parseFileUriListPaths(buffer)
      ]
      paths.push(...(uriListPaths.length > 0 ? uriListPaths : parseWindowsHdropPaths(buffer)))
    }
  }

  return uniquePaths(paths)
}
