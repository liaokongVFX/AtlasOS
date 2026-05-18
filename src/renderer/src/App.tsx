import { useEffect } from 'react'
import { CanvasBoard } from './components/canvas-board'
import { TopBar } from './components/top-bar'
import { useCanvasStore } from './store/canvas-store'

export function App(): JSX.Element {
  const load = useCanvasStore((state) => state.load)
  const error = useCanvasStore((state) => state.error)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="app-shell">
      <TopBar />
      {error ? <div className="app-error">{error}</div> : null}
      <CanvasBoard />
    </div>
  )
}
