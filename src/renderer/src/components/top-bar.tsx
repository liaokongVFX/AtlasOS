import { useState, type DragEvent, type KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Plus, Save, Trash2, X } from 'lucide-react'
import type { CanvasDocument } from '@shared/schema'
import { useI18n } from '../i18n'
import { useCanvasStore } from '../store/canvas-store'
import { BackgroundPanel } from './background-panel'
import { SettingsDialog } from './settings-dialog'
import { TopBarIconTooltip } from './top-bar-icon-tooltip'

type DropPlacement = 'before' | 'after'

function moveCanvasNearTarget(canvasOrder: string[], sourceId: string, targetId: string, placement: DropPlacement): string[] {
  if (sourceId === targetId) return canvasOrder

  const nextOrder = canvasOrder.filter((canvasId) => canvasId !== sourceId)
  const targetIndex = nextOrder.indexOf(targetId)
  if (targetIndex === -1) return canvasOrder

  nextOrder.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, sourceId)
  return nextOrder
}

function getDropPlacement(event: DragEvent<HTMLDivElement>): DropPlacement {
  const bounds = event.currentTarget.getBoundingClientRect()
  if (bounds.width === 0) return 'before'
  return event.clientX > bounds.left + bounds.width / 2 ? 'after' : 'before'
}

export function TopBar(): JSX.Element {
  const { t } = useI18n()
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [draggingCanvasId, setDraggingCanvasId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ canvasId: string; placement: DropPlacement } | null>(null)
  const [closeCanvasId, setCloseCanvasId] = useState<string | null>(null)
  const appState = useCanvasStore((state) => state.appState)
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvases = useCanvasStore((state) => state.canvases)
  const saveState = useCanvasStore((state) => state.saveState)
  const createCanvas = useCanvasStore((state) => state.createCanvas)
  const setActiveCanvas = useCanvasStore((state) => state.setActiveCanvas)
  const reorderCanvases = useCanvasStore((state) => state.reorderCanvases)
  const renameCanvas = useCanvasStore((state) => state.renameCanvas)
  const deleteCanvas = useCanvasStore((state) => state.deleteCanvas)
  const saveCanvasNow = useCanvasStore((state) => state.saveCanvasNow)
  const closeCanvas = closeCanvasId ? canvases[closeCanvasId] : null
  const saveStateLabel = t(`saveState.${saveState}`)

  const beginEditing = (canvas: CanvasDocument) => {
    setEditingCanvasId(canvas.id)
    setEditingName(canvas.name)
  }

  const commitEditing = () => {
    if (!editingCanvasId) return
    renameCanvas(editingCanvasId, editingName)
    setEditingCanvasId(null)
    setEditingName('')
  }

  const cancelEditing = () => {
    setEditingCanvasId(null)
    setEditingName('')
  }

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEditing()
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
    }
  }

  const handleDragStart = (event: DragEvent<HTMLDivElement>, canvasId: string) => {
    if (editingCanvasId) {
      event.preventDefault()
      return
    }

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', canvasId)
    setDraggingCanvasId(canvasId)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>, canvasId: string) => {
    if (!draggingCanvasId || draggingCanvasId === canvasId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropIndicator({ canvasId, placement: getDropPlacement(event) })
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetCanvasId: string) => {
    event.preventDefault()

    const sourceCanvasId = draggingCanvasId ?? event.dataTransfer.getData('text/plain')
    setDraggingCanvasId(null)
    setDropIndicator(null)

    if (!appState || !sourceCanvasId || sourceCanvasId === targetCanvasId) return

    const nextOrder = moveCanvasNearTarget(appState.canvasOrder, sourceCanvasId, targetCanvasId, getDropPlacement(event))
    if (nextOrder !== appState.canvasOrder) {
      void reorderCanvases(nextOrder)
    }
  }

  const handleDragEnd = () => {
    setDraggingCanvasId(null)
    setDropIndicator(null)
  }

  const confirmCloseCanvas = async () => {
    if (!closeCanvasId) return
    const canvasId = closeCanvasId
    setCloseCanvasId(null)
    await deleteCanvas(canvasId)
  }

  return (
    <Tooltip.Provider delayDuration={250}>
      <header className="top-bar">
        <div className="workspace-tabs">
          {appState?.canvasOrder.map((canvasId) => {
            const canvas = canvases[canvasId]
            if (!canvas) return null
            const isActive = canvas.id === activeCanvasId
            const isEditing = canvas.id === editingCanvasId
            return (
              <div
                key={canvas.id}
                className={[
                  'workspace-tab',
                  isActive ? 'workspace-tab--active' : '',
                  draggingCanvasId === canvas.id ? 'workspace-tab--dragging' : '',
                  dropIndicator?.canvasId === canvas.id ? 'workspace-tab--drop-target' : '',
                  dropIndicator?.canvasId === canvas.id ? `workspace-tab--drop-${dropIndicator.placement}` : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable={!isEditing}
                onDragStart={(event) => handleDragStart(event, canvas.id)}
                onDragOver={(event) => handleDragOver(event, canvas.id)}
                onDrop={(event) => handleDrop(event, canvas.id)}
                onDragEnd={handleDragEnd}
              >
                {isEditing ? (
                  <input
                    className="workspace-tab__input"
                    aria-label={t('canvas.renameCanvasAria', { name: canvas.name })}
                    value={editingName}
                    autoFocus
                    draggable={false}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={commitEditing}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={handleEditKeyDown}
                  />
                ) : (
                  <button
                    type="button"
                    className="workspace-tab__label"
                    title={canvas.name}
                    aria-current={isActive ? 'page' : undefined}
                    draggable={false}
                    onClick={() => void setActiveCanvas(canvas.id)}
                    onDoubleClick={() => beginEditing(canvas)}
                  >
                    <span>{canvas.name}</span>
                  </button>
                )}
                {isActive ? (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        type="button"
                        className="workspace-tab__close"
                        aria-label={t('canvas.deleteCanvasAria', { name: canvas.name })}
                        draggable={false}
                        onClick={(event) => {
                          event.stopPropagation()
                          setCloseCanvasId(canvas.id)
                        }}
                      >
                        <X size={14} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content className="tooltip-content">{t('canvas.deleteCanvas')}</Tooltip.Content>
                  </Tooltip.Root>
                ) : null}
              </div>
            )
          })}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className="icon-button" onClick={() => void createCanvas()} aria-label={t('canvas.newCanvas')}>
                <Plus size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="tooltip-content">{t('canvas.newCanvas')}</Tooltip.Content>
          </Tooltip.Root>
        </div>

        <div className="top-bar__tools">
          <SettingsDialog showTrigger={false} />
          <BackgroundPanel />
          <TopBarIconTooltip label={saveStateLabel}>
            <button
              type="button"
              className={`icon-button top-bar-icon-button top-bar-save-button top-bar-save-button--${saveState}`}
              disabled={!activeCanvasId}
              aria-label={saveStateLabel}
              onClick={() => activeCanvasId && void saveCanvasNow(activeCanvasId)}
            >
              <Save size={16} aria-hidden="true" />
            </button>
          </TopBarIconTooltip>
        </div>
      </header>
      <Dialog.Root open={Boolean(closeCanvas)} onOpenChange={(open) => !open && setCloseCanvasId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">{t('canvas.deleteCanvasTitle')}</Dialog.Title>
            <Dialog.Description className="dialog-description">
              {t('canvas.deleteCanvasDescription', { name: closeCanvas ? `"${closeCanvas.name}"` : t('canvas.thisCanvas') })}
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="tool-button">
                  {t('common.cancel')}
                </button>
              </Dialog.Close>
              <button type="button" className="tool-button danger" onClick={() => void confirmCloseCanvas()}>
                <Trash2 size={16} />
                <span>{t('common.delete')}</span>
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Tooltip.Provider>
  )
}
