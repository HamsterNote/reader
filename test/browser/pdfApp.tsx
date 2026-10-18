import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Reader, type PdfSource, type ReaderSourceLoadState } from '../../src'
import '../../src/styles/index.scss'

declare global {
  interface Window {
    pdfEvidence: {
      mutations: number
      states: ReaderSourceLoadState[]
      hostUrl: string | null
    }
  }
}
window.pdfEvidence = { mutations: 0, states: [], hostUrl: null }

function PdfApp() {
  const [source, setSource] = useState<PdfSource>()
  const [state, setState] = useState('idle')
  return (
    <main
      style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          minHeight: 44,
          display: 'flex',
          gap: 12,
          alignItems: 'center'
        }}
      >
        <input
          aria-label='Open document'
          type='file'
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const uri = URL.createObjectURL(file)
            window.pdfEvidence.hostUrl = uri
            setSource({ kind: 'uri', uri, name: file.name })
            event.target.value = ''
          }}
        />
        <button type='button' onClick={() => setSource(undefined)}>
          Close
        </button>
        <output data-testid='source-state'>{state}</output>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Reader
          source={source}
          onStateChange={(value) => {
            window.pdfEvidence.states.push(value)
            setState(value.status)
          }}
          onDataChange={() => {
            window.pdfEvidence.mutations += 1
          }}
        />
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<PdfApp />)
