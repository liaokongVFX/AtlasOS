import type { Frame } from '@shared/schema'

export type MediaDimensions = {
  width: number
  height: number
}

export const COMPONENT_NODE_HEADER_HEIGHT = 38
export const MEDIA_NODE_MIN_WIDTH = 220
export const MEDIA_NODE_MIN_HEIGHT = 120
export const MEDIA_PREVIEW_MAX_WIDTH = 720
export const MEDIA_PREVIEW_MAX_HEIGHT = 560

const MEDIA_ASPECT_RATIO_EPSILON = 0.001

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function mediaAspectRatioFromDimensions(dimensions: MediaDimensions | null | undefined): number | null {
  if (!dimensions || !isPositiveFiniteNumber(dimensions.width) || !isPositiveFiniteNumber(dimensions.height)) return null
  return dimensions.width / dimensions.height
}

export function mediaAspectRatioFromConfig(config: Record<string, unknown>): number | null {
  const aspectRatio = config.mediaAspectRatio
  return isPositiveFiniteNumber(aspectRatio) ? aspectRatio : null
}

export function mediaAspectRatioFromFrame(frame: Frame): number {
  return frame.width / Math.max(frame.height - COMPONENT_NODE_HEADER_HEIGHT, 1)
}

export function mediaAspectRatiosEqual(left: number | null | undefined, right: number | null | undefined): boolean {
  return isPositiveFiniteNumber(left) && isPositiveFiniteNumber(right) && Math.abs(left - right) <= MEDIA_ASPECT_RATIO_EPSILON
}

export function mediaFrameHeightForWidth(width: number, aspectRatio: number): number {
  return COMPONENT_NODE_HEADER_HEIGHT + width / aspectRatio
}

export function fitMediaFrameToAspectRatio(frame: Frame, aspectRatio: number, preferredWidth = frame.width): Frame {
  let width = clamp(preferredWidth, MEDIA_NODE_MIN_WIDTH, MEDIA_PREVIEW_MAX_WIDTH)
  let height = mediaFrameHeightForWidth(width, aspectRatio)

  if (height > MEDIA_PREVIEW_MAX_HEIGHT) {
    height = MEDIA_PREVIEW_MAX_HEIGHT
    width = Math.max(MEDIA_NODE_MIN_WIDTH, (height - COMPONENT_NODE_HEADER_HEIGHT) * aspectRatio)
  }

  if (height < MEDIA_NODE_MIN_HEIGHT) {
    height = MEDIA_NODE_MIN_HEIGHT
    width = Math.max(MEDIA_NODE_MIN_WIDTH, (height - COMPONENT_NODE_HEADER_HEIGHT) * aspectRatio)
  }

  return {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

export function normalizeMediaResizeFrame(frame: Frame, aspectRatio: number, direction?: readonly number[] | null): Frame {
  const width = Math.max(MEDIA_NODE_MIN_WIDTH, frame.width)
  const height = Math.max(MEDIA_NODE_MIN_HEIGHT, mediaFrameHeightForWidth(width, aspectRatio))
  const resizedFromTop = direction?.[1] !== undefined && direction[1] < 0

  return {
    x: Math.round(frame.x),
    y: Math.round(resizedFromTop ? frame.y + frame.height - height : frame.y),
    width: Math.round(width),
    height: Math.round(height)
  }
}
