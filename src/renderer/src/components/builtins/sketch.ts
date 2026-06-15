import { PenLine } from 'lucide-react'
import { translateCurrent } from '../../i18n'
import { getSketchSearchTokens, normalizeSketchScene, sketchElementCount } from '../modules/sketch-model'
import { SketchComponent } from '../modules/sketch-component'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'
import { builtInNodeMeta } from './shared'

export function createSketchDefinition(): HostRendererPluginNodeDefinition {
  return {
    ...builtInNodeMeta('sketch'),
    icon: PenLine,
    Renderer: SketchComponent,
    usesCanvasZoom: true,
    create: () => ({ state: { sketchScene: normalizeSketchScene(null) } }),
    getDetail: (component) => translateCurrent('sketch.stats', { elements: sketchElementCount(normalizeSketchScene(component.state.sketchScene)) }),
    getSearchTokens: (component) => getSketchSearchTokens(normalizeSketchScene(component.state.sketchScene)),
    getResizeBehavior: () => ({
      minWidth: 520,
      minHeight: 360
    })
  }
}
