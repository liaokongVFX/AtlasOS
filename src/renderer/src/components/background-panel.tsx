import * as Popover from '@radix-ui/react-popover'
import { Image, Palette } from 'lucide-react'
import { useI18n } from '../i18n'
import { asNumber, asString } from '../lib/utils'
import { useCanvasStore } from '../store/canvas-store'

export function BackgroundPanel(): JSX.Element {
  const { t } = useI18n()
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvas = useCanvasStore((state) => (state.activeCanvasId ? state.canvases[state.activeCanvasId] : null))
  const updateCanvas = useCanvasStore((state) => state.updateCanvas)

  if (!activeCanvasId || !canvas) {
    return (
      <button className="tool-button" disabled>
        <Palette size={16} />
        <span>{t('background.background')}</span>
      </button>
    )
  }

  const background = canvas.background
  const updateBackground = (patch: Parameters<typeof updateCanvas>[1]) => updateCanvas(activeCanvasId, patch)

  return (
    <Popover.Root>
      <Popover.Trigger className="tool-button">
        <Palette size={16} />
        <span>{t('background.background')}</span>
      </Popover.Trigger>
      <Popover.Content className="popover-content" sideOffset={8} align="end">
        <div className="field-row">
          <label>{t('background.color')}</label>
          <input
            type="color"
            value={background.color}
            onChange={(event) =>
              updateBackground((draft) => {
                draft.background.color = event.target.value
              })
            }
          />
        </div>
        <div className="field-row">
          <label>
            <Image size={14} /> {t('background.imageUrl')}
          </label>
          <input
            value={asString(background.image.src)}
            onChange={(event) =>
              updateBackground((draft) => {
                draft.background.image.src = event.target.value
              })
            }
            placeholder="file:/// or https://"
          />
        </div>
        <div className="field-row">
          <label>{t('background.imageOpacity')}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={asNumber(background.image.opacity, 0.35)}
            onChange={(event) =>
              updateBackground((draft) => {
                draft.background.image.opacity = Number(event.target.value)
              })
            }
          />
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}
