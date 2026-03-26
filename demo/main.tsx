import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@hamster-note/reader/style.css'

import { App } from './App'

const container = document.getElementById('root')

if (container === null) {
  throw new Error('Missing #root container for demo')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
