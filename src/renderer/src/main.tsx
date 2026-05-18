import '@xyflow/react/dist/style.css'
import '@xterm/xterm/css/xterm.css'
import 'katex/dist/katex.min.css'
import './styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
