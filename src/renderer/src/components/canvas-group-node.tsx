import { memo, useCallback } from 'react'
import { Group as GroupIcon } from 'lucide-react'
import { NodeResizer, type Node, type NodeProps, type OnResizeEnd } from '@xyflow/react'
import type { CanvasGroup } from '@shared/schema'
import { notifyCanvasViewportSync } from '../lib/canvas-viewport-sync'
import { cn } from '../lib/utils'
import {
  CANVAS_GROUP_MIN_HEIGHT,
  CANVAS_GROUP_MIN_WIDTH,
  useCanvasStore
} from '../store/canvas-store'

type CanvasGroupNodeData = Record<string, unknown> & {
  canvasId: string
  group: CanvasGroup
}

export type CanvasGroupFlowNode = Node<CanvasGroupNodeData, 'atlasGroup'>

function CanvasGroupNodeBase({ data, selected }: NodeProps<CanvasGroupFlowNode>): JSX.Element {
  const { canvasId, group } = data
  const updateGroupFrame = useCanvasStore((state) => state.updateGroupFrame)
  const notesPreview = group.notes.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''

  const persistResize = useCallback<OnResizeEnd>((_, params) => {
    updateGroupFrame(
      canvasId,
      group.id,
      {
        x: Math.round(params.x),
        y: Math.round(params.y),
        width: Math.round(params.width),
        height: Math.round(params.height)
      }
    )
    notifyCanvasViewportSync()
  }, [canvasId, group.id, updateGroupFrame])

  return (
    <section className={cn('canvas-group-node', selected && 'canvas-group-node--selected')} style={{ zIndex: group.zIndex }}>
      <NodeResizer
        handleClassName="canvas-group-node__resize-handle"
        isVisible={selected}
        lineClassName="canvas-group-node__resize-line"
        minWidth={CANVAS_GROUP_MIN_WIDTH}
        minHeight={CANVAS_GROUP_MIN_HEIGHT}
        onResizeEnd={persistResize}
      />
      <header className="canvas-group-node__header">
        <GroupIcon size={15} aria-hidden="true" />
        <span title={group.title}>{group.title}</span>
      </header>
      {notesPreview ? <p className="canvas-group-node__notes">{notesPreview}</p> : null}
    </section>
  )
}

export const CanvasGroupNode = memo(CanvasGroupNodeBase)
