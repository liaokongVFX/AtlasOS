import '@xyflow/react/dist/style.css'
import '@xterm/xterm/css/xterm.css'
import 'katex/dist/katex.min.css'
import './styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { PetApp } from './PetApp'
import { I18nProvider } from './i18n'
import { registerBuiltInComponentDefinitions } from './components/register-builtins'

const queryClient = new QueryClient()
const isPetView = new URLSearchParams(window.location.search).get('view') === 'pet'
document.documentElement.dataset.atlasView = isPetView ? 'pet' : 'app'

registerBuiltInComponentDefinitions()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPetView ? (
      <PetApp />
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
