import type { CanvasComponent, ComponentType, Frame } from '@shared/schema'
import { COMPONENT_DEFINITIONS } from '../components/component-definitions'
import { getFilePreviewKind, isMarkdownFile } from './file-types'
import {
  fitMediaFrameToAspectRatio,
  mediaAspectRatioFromDimensions,
  type MediaDimensions
} from './media-frame'

const FILE_COMPONENT_STACK_OFFSET = 32

export type FileComponentPatch = Omit<Partial<CanvasComponent>, 'frame'> & {
  frame?: Partial<Frame>
}

export type CanvasFileSource = {
  path: string
  name: string
  kind: 'file' | 'directory'
  rootPath?: string
  mimeType?: string
  mediaDimensions?: MediaDimensions
}

export function componentTypeForFileSource(file: CanvasFileSource): ComponentType {
  if (file.kind === 'directory') return 'file-tree'
  if (isMarkdownFile(file.name, file.mimeType)) return 'markdown-note'
  return 'file-preview'
}

function rootPathForFileSource(file: CanvasFileSource): string {
  return file.rootPath ?? file.path
}

export async function createFileComponentPatch(
  file: CanvasFileSource,
  type = componentTypeForFileSource(file)
): Promise<FileComponentPatch> {
  const rootPath = rootPathForFileSource(file)
  const config: Record<string, unknown> = file.mimeType ? { mimeType: file.mimeType } : {}
  const bindings = { rootPath, path: file.path }
  const mediaAspectRatio = type === 'file-preview' ? mediaAspectRatioFromDimensions(file.mediaDimensions) : null

  if (file.mediaDimensions && mediaAspectRatio) {
    config.mediaAspectRatio = mediaAspectRatio
    config.mediaWidth = Math.round(file.mediaDimensions.width)
    config.mediaHeight = Math.round(file.mediaDimensions.height)
  }

  if (type === 'file-tree') {
    return {
      title: file.name,
      config: { rootPath: file.path },
      bindings
    }
  }

  if (type === 'markdown-note') {
    let content = ''
    let status = 'live'

    try {
      content = (await window.atlas.filesystem.readFile(rootPath, file.path)) as string
    } catch {
      status = 'missing'
    }

    return {
      title: file.name,
      config,
      bindings,
      state: { content, status }
    }
  }

  const mediaFrame = mediaAspectRatio ? fitMediaFrameToAspectRatio(COMPONENT_DEFINITIONS['file-preview'].defaultFrame, mediaAspectRatio) : null

  return {
    title: file.name,
    config,
    bindings,
    frame: mediaFrame ? { width: mediaFrame.width, height: mediaFrame.height } : undefined
  }
}

export function stackedFileComponentPosition(position: { x: number; y: number }, index: number): { x: number; y: number } {
  const column = index % 4
  const row = Math.floor(index / 4)

  return {
    x: Math.round(position.x + column * FILE_COMPONENT_STACK_OFFSET),
    y: Math.round(position.y + row * FILE_COMPONENT_STACK_OFFSET)
  }
}
