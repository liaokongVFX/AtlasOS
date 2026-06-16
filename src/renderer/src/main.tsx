import '@xyflow/react/dist/style.css'
import '@excalidraw/excalidraw/index.css'
import '@xterm/xterm/css/xterm.css'
import 'katex/dist/katex.min.css'
import 'react-diff-view/style/index.css'
import './styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { PetApp } from './PetApp'
import { TranslationPanelApp } from './TranslationPanelApp'
import { UpdateApp } from './UpdateApp'
import { I18nProvider } from './i18n'
import { registerBuiltInComponentDefinitions } from './components/register-builtins'

const queryClient = new QueryClient()
const rendererView = new URLSearchParams(window.location.search).get('view')
const isPetView = rendererView === 'pet'
const isTranslationView = rendererView === 'translation'
const isUpdateView = rendererView === 'update'
document.documentElement.dataset.atlasView = isPetView ? 'pet' : isTranslationView ? 'translation' : isUpdateView ? 'update' : 'app'

registerBuiltInComponentDefinitions()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPetView ? (
      <PetApp />
    ) : isTranslationView ? (
      <I18nProvider>
        <TranslationPanelApp />
      </I18nProvider>
    ) : isUpdateView ? (
      <I18nProvider>
        <UpdateApp />
      </I18nProvider>
    ) : (
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <ReactFlowProvider>
            <App />
          </ReactFlowProvider>
        </QueryClientProvider>
      </I18nProvider>
    )}
  </React.StrictMode>
)
