import * as Tooltip from '@radix-ui/react-tooltip'
import { FolderTree, Globe2, Plus, Save, StickyNote, TerminalSquare } from 'lucide-react'
import type { ComponentType } from '@shared/schema'
import { useCanvasStore } from '../store/canvas-store'
import { BackgroundPanel } from './background-panel'

const ADD_BUTTONS: Array<{ type: ComponentType; label: string; icon: typeof TerminalSquare }> = [
  { type: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { type: 'file-tree', label: 'Files', icon: FolderTree },
  { type: 'browser', label: 'Browser', icon: Globe2 },
  { type: 'markdown-note', label: 'Note', icon: StickyNote }
]

export function TopBar(): JSX.Element {
  const appState = useCanvasStore((state) => state.appState)
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId)
  const canvases = useCanvasStore((state) => state.canvases)
  const saveState = useCanvasStore((state) => state.saveState)
  const createCanvas = useCanvasStore((state) => state.createCanvas)
  const setActiveCanvas = useCanvasStore((state) => state.setActiveCanvas)
  const addComponent = useCanvasStore((state) => state.addComponent)
  const saveCanvasNow = useCanvasStore((state) => state.saveCanvasNow)

  return (
    <Tooltip.Provider delayDuration={250}>
      <header className="top-bar">
        <div className="workspace-tabs">
          {appState?.canvasOrder.map((canvasId) => {
            const canvas = canvases[canvasId]
            if (!canvas) return null
            return (
              <button
                key={canvas.id}
                className={canvas.id === activeCanvasId ? 'workspace-tab workspace-tab--active' : 'workspace-tab'}
                onClick={() => void setActiveCanvas(canvas.id)}
              >
                {canvas.name}
              </button>
            )
          })}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className="icon-button" onClick={() => void createCanvas()} aria-label="New canvas">
                <Plus size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="tooltip-content">New canvas</Tooltip.Content>
          </Tooltip.Root>
        </div>

        <div className="top-bar__tools">
          {ADD_BUTTONS.map((item) => {
            const Icon = item.icon
            return (
              <Tooltip.Root key={item.type}>
                <Tooltip.Trigger asChild>
                  <button className="tool-button" onClick={() => addComponent(item.type)} aria-label={`Add ${item.label}`}>
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content className="tooltip-content">Add {item.label}</Tooltip.Content>
              </Tooltip.Root>
            )
          })}
          <BackgroundPanel />
          <button className="tool-button" disabled={!activeCanvasId} onClick={() => activeCanvasId && void saveCanvasNow(activeCanvasId)}>
            <Save size={16} />
            <span>{saveState}</span>
          </button>
        </div>
      </header>
    </Tooltip.Provider>
  )
}
