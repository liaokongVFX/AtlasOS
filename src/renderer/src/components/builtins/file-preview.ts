import { FileCode } from 'lucide-react'
import type { CanvasComponent } from '@shared/schema'
import {
  fitMediaFrameToAspectRatio,
  mediaAspectRatioFromConfig,
  mediaAspectRatioFromFrame,
  MEDIA_NODE_MIN_WIDTH,
  normalizeMediaResizeFrame
} from '../../lib/media-frame'
import { getFilePreviewKind } from '../../lib/file-types'
import { FilePreviewComponent } from '../modules/file-preview-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import type { NodeResizeBehavior } from '../registry'
import { builtInNodeMeta, createFileComponentFromSource, fileSourceMatches, optionalString } from './shared'

function filePreviewResizeBehavior(component: CanvasComponent): NodeResizeBehavior | null {
  const previewKind = getFilePreviewKind(optionalString(component.bindings.path) ?? '', optionalString(component.config.mimeType))
  const isMediaPreview = previewKind === 'image' || previewKind === 'video'
  if (!isMediaPreview) return null

  const mediaAspectRatio = mediaAspectRatioFromConfig(component.config) ?? mediaAspectRatioFromFrame(component.frame)
  if (!mediaAspectRatio) return { keepAspectRatio: true, minWidth: MEDIA_NODE_MIN_WIDTH }

  return {
    keepAspectRatio: true,
    minWidth: MEDIA_NODE_MIN_WIDTH,
    minHeight: fitMediaFrameToAspectRatio(component.frame, mediaAspectRatio, MEDIA_NODE_MIN_WIDTH).height,
    normalizeFrame: (params, context) => normalizeMediaResizeFrame(params, mediaAspectRatio, context.direction)
  }
}

function canDragFromSelectedFilePreviewBody(component: CanvasComponent): boolean {
  return getFilePreviewKind(optionalString(component.bindings.path) ?? '', optionalString(component.config.mimeType)) === 'image'
}

export function createFilePreviewDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('file-preview'),
    icon: FileCode,
    Renderer: FilePreviewComponent,
    creatable: false,
    acceptsFile: fileSourceMatches('file-preview'),
    createFromFile: createFileComponentFromSource('file-preview'),
    getDetail: (component) => optionalString(component.bindings.path) ?? optionalString(component.bindings.rootPath) ?? null,
    getResizeBehavior: filePreviewResizeBehavior,
    canDragFromSelectedBody: canDragFromSelectedFilePreviewBody
  }
}
