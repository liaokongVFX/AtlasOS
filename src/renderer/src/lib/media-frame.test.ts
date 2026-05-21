import { describe, expect, it } from 'vitest'
import {
  COMPONENT_NODE_HEADER_HEIGHT,
  fitMediaFrameToAspectRatio,
  mediaAspectRatioFromDimensions,
  mediaFrameHeightForWidth,
  normalizeMediaResizeFrame
} from './media-frame'

describe('media frame sizing', () => {
  it('fits the node body to the media aspect ratio while preserving the title bar', () => {
    const frame = fitMediaFrameToAspectRatio({ x: 10, y: 20, width: 560, height: 420 }, 16 / 9)

    expect(frame).toEqual({
      x: 10,
      y: 20,
      width: 560,
      height: Math.round(COMPONENT_NODE_HEADER_HEIGHT + 560 * (9 / 16))
    })
  })

  it('normalizes resized media frames from their width', () => {
    expect(normalizeMediaResizeFrame({ x: 0, y: 0, width: 640, height: 600 }, 16 / 9)).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: Math.round(mediaFrameHeightForWidth(640, 16 / 9))
    })
  })

  it('ignores invalid intrinsic dimensions', () => {
    expect(mediaAspectRatioFromDimensions({ width: 0, height: 100 })).toBeNull()
    expect(mediaAspectRatioFromDimensions({ width: 100, height: 50 })).toBe(2)
  })
})
