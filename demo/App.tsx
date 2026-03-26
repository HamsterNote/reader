import type { IntermediateDocumentSerialized } from '@hamster-note/types'

import { Reader } from '@hamster-note/reader'

const demoDocument: IntermediateDocumentSerialized = {
  id: 'demo-document',
  title: 'Demo Document Title',
  pages: []
}

export function App() {
  return (
    <main data-testid='reader-demo-root'>
      <h1>Hamster Reader Demo</h1>
      <Reader document={demoDocument} />
    </main>
  )
}
