import { useEffect } from 'react'
import { CanvasBoard } from './components/canvas-board'
import { TopBar } from './components/top-bar'
import { TranslationHotkeys } from './components/translation-hotkeys'
import { syncRendererPlugins } from './plugins/plugin-runtime'
import { useI18n } from './i18n'
import { useAppSettingsStore } from './store/app-settings-store'
import { useCanvasStore } from './store/canvas-store'

export function App(): JSX.Element {
  const { setLocale } = useI18n()
  const load = useCanvasStore((state) => state.load)
  const loadAppSettings = useAppSettingsStore((state) => state.load)
  const appSettings = useAppSettingsStore((state) => state.settings)
  const appSettingsLoaded = useAppSettingsStore((state) => state.isLoaded)
  const error = useCanvasStore((state) => state.error)

  useEffect(() => {
    void syncRendererPlugins().catch((nextError) => {
      console.error('Failed to synchronize renderer plugins', nextError)
    })
    void loadAppSettings()
    void load()
  }, [load, loadAppSettings])

  useEffect(() => {
    if (!appSettingsLoaded) return
    setLocale(appSettings.locale)
  }, [appSettings.locale, appSettingsLoaded, setLocale])

  return (
    <div className="app-shell">
      <TopBar />
      <TranslationHotkeys />
      {error ? <div className="app-error">{error}</div> : null}
      <CanvasBoard />
    </div>
  )
}
