import * as Popover from '@radix-ui/react-popover'
import { FolderOpen, Image, Palette } from 'lucide-react'
import { useRef } from 'react'
import { DEFAULT_CANVAS_BACKGROUND } from '@shared/constants'
import { localAssetUrl } from '@shared/local-assets'
import { useI18n } from '../i18n'
import { asNumber, asString } from '../lib/utils'
import { useCanvasStore } from '../store/canvas-store'
import { TopBarIconTooltip } from './top-bar-icon-tooltip'

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const HEX_COLOR_VALUE_PATTERN = /#[0-9a-f]{6}\b/gi
const DEFAULT_GRADIENT_END_COLOR = '#11141b'
const BACKGROUND_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,image/avif,image/x-icon,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.avif,.ico'

function gradientFill(startColor: string, endColor: string): string {
  return `linear-gradient(135deg, ${startColor}, ${endColor})`
}

function gradientColorValues(fill: string): [string, string] {
  const colors = fill.match(HEX_COLOR_VALUE_PATTERN) ?? []
  const startColor = colors[0] ?? (HEX_COLOR_PATTERN.test(fill) ? fill : DEFAULT_CANVAS_BACKGROUND.color)
  const endColor = colors[1] ?? DEFAULT_GRADIENT_END_COLOR

  return [startColor.toLowerCase(), endColor.toLowerCase()]
}

export function BackgroundPanel(): JSX.Element {
  const { t } = useI18n()
  const imageFileInputRef = useRef<HTMLInputElement>(null)
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvas = useCanvasStore((state) => (state.activeCanvasId ? state.canvases[state.activeCanvasId] : null))
  const updateCanvas = useCanvasStore((state) => state.updateCanvas)

  if (!activeCanvasId || !canvas) {
    return (
      <TopBarIconTooltip label={t('background.background')}>
        <button type="button" className="icon-button top-bar-icon-button" disabled aria-label={t('background.background')}>
          <Palette size={16} aria-hidden="true" />
        </button>
      </TopBarIconTooltip>
    )
  }

  const background = canvas.background
  const updateBackground = (patch: Parameters<typeof updateCanvas>[1]) => updateCanvas(activeCanvasId, patch)
  const colorPickerValue = HEX_COLOR_PATTERN.test(background.color) ? background.color : DEFAULT_CANVAS_BACKGROUND.color
  const [gradientStartColor, gradientEndColor] = gradientColorValues(background.color)
  const selectBackgroundImage = (files: FileList | null): void => {
    const file = files?.[0]
    if (!file) return

    const path = window.atlas.filesystem.getPathForFile(file).trim()
    if (!path) return

    updateBackground((draft) => {
      draft.background.image.src = localAssetUrl(path, path)
    })
  }

  return (
    <Popover.Root>
      <TopBarIconTooltip label={t('background.background')}>
        <Popover.Trigger asChild>
          <button type="button" className="icon-button top-bar-icon-button" aria-label={t('background.background')}>
            <Palette size={16} aria-hidden="true" />
          </button>
        </Popover.Trigger>
      </TopBarIconTooltip>
      <Popover.Content className="popover-content" sideOffset={8} align="end">
        <div className="field-row">
          <label>{t('background.fill')}</label>
          <input
            type="text"
            aria-label={t('background.fill')}
            value={background.color}
            onChange={(event) =>
              updateBackground((draft) => {
                draft.background.color = event.target.value
              })
            }
            placeholder="linear-gradient(135deg, #010102, #11141b)"
          />
        </div>
        <div className="field-row">
          <label>{t('background.solidColor')}</label>
          <input
            type="color"
            aria-label={t('background.solidColor')}
            value={colorPickerValue}
            onChange={(event) =>
              updateBackground((draft) => {
                draft.background.color = event.target.value
              })
            }
          />
        </div>
        <div className="field-row">
          <label>{t('background.gradient')}</label>
          <div className="background-gradient-controls">
            <input
              type="color"
              aria-label={t('background.gradientStart')}
              value={gradientStartColor}
              onChange={(event) =>
                updateBackground((draft) => {
                  draft.background.color = gradientFill(event.target.value, gradientEndColor)
                })
              }
            />
            <span className="background-gradient-preview" style={{ background: gradientFill(gradientStartColor, gradientEndColor) }} aria-hidden="true" />
            <input
              type="color"
              aria-label={t('background.gradientEnd')}
              value={gradientEndColor}
              onChange={(event) =>
                updateBackground((draft) => {
                  draft.background.color = gradientFill(gradientStartColor, event.target.value)
                })
              }
            />
          </div>
        </div>
        <div className="field-row">
          <label>
            <Image size={14} /> {t('background.imageUrl')}
          </label>
          <div className="background-image-source">
            <input
              value={asString(background.image.src)}
              onChange={(event) =>
                updateBackground((draft) => {
                  draft.background.image.src = event.target.value
                })
              }
              placeholder="file:/// or https://"
            />
            <input
              ref={imageFileInputRef}
              className="background-image-file-input"
              type="file"
              accept={BACKGROUND_IMAGE_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                selectBackgroundImage(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
            <button
              type="button"
              className="background-image-picker-button"
              aria-label={`${t('background.imageUrl')} ${t('common.browse')}`}
              onClick={() => imageFileInputRef.current?.click()}
            >
              <FolderOpen size={14} aria-hidden="true" />
              <span>{t('common.browse')}</span>
            </button>
          </div>
        </div>
        <div className="field-row">
          <label>{t('background.imageBlur')}</label>
          <input
            type="range"
            aria-label={t('background.imageBlur')}
            min="0"
            max="24"
            step="1"
            value={asNumber(background.image.blur, 0)}
            onChange={(event) =>
              updateBackground((draft) => {
                draft.background.image.blur = Number(event.target.value)
              })
            }
          />
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}
