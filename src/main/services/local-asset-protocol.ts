import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import {
  LOCAL_ASSET_PROTOCOL,
  mimeTypeForLocalAsset,
  parseByteRange,
  parseLocalAssetUrl
} from '@shared/local-assets'
import { ATLAS_PLUGIN_RENDERER_PROTOCOL } from '@shared/plugins'
import { assertInsideRoot } from './path-safety'

const ALLOWED_METHODS = 'GET, HEAD'

function streamBody(path: string, range?: { start: number; end: number }): BodyInit {
  const stream = range ? createReadStream(path, { start: range.start, end: range.end }) : createReadStream(path)
  return Readable.toWeb(stream) as unknown as BodyInit
}

function textResponse(message: string, status: number, headers: HeadersInit = {}): Response {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      ...headers
    }
  })
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

export function registerLocalAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_ASSET_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    },
    {
      scheme: ATLAS_PLUGIN_RENDERER_PROTOCOL,
      privileges: {
        corsEnabled: true,
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

export function registerLocalAssetProtocol(): void {
  if (protocol.isProtocolHandled(LOCAL_ASSET_PROTOCOL)) return
  protocol.handle(LOCAL_ASSET_PROTOCOL, createLocalAssetResponse)
}

export async function createLocalAssetResponse(request: Request): Promise<Response> {
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return textResponse('Method not allowed', 405, { Allow: ALLOWED_METHODS })
  }

  let targetPath: string

  try {
    const asset = parseLocalAssetUrl(request.url)
    targetPath = assertInsideRoot(asset.rootPath, asset.targetPath)
  } catch {
    return textResponse('Forbidden local asset path', 403)
  }

  try {
    const info = await stat(targetPath)
    if (!info.isFile()) return textResponse('Local asset is not a file', 404)

    const size = info.size
    const mimeType = mimeTypeForLocalAsset(targetPath)
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': mimeType,
      'X-Content-Type-Options': 'nosniff'
    }

    const range = parseByteRange(request.headers.get('range'), size)

    if (range.kind === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes */${size}`
        }
      })
    }

    if (range.kind === 'partial') {
      const contentLength = range.end - range.start + 1
      return new Response(method === 'HEAD' ? null : streamBody(targetPath, range), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(contentLength),
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`
        }
      })
    }

    return new Response(method === 'HEAD' ? null : streamBody(targetPath), {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(size)
      }
    })
  } catch (error) {
    if (isMissingFileError(error)) return textResponse('Local asset not found', 404)
    return textResponse('Failed to read local asset', 500)
  }
}
