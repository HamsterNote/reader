import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { useState } from 'react'

import { Reader } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'

const demoDocument: IntermediateDocumentSerialized = {
  id: 'demo-document',
  title: 'Demo Document Title',
  pages: []
}

export function App() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)

  const handleFileUpload = (file: File) => {
    setUploadedFile(file)
    console.log('File uploaded:', file.name, file.size, file.type)
  }

  return (
    <main data-testid='reader-demo-root'>
      <h1>Hamster Reader Demo</h1>
      <section style={{ marginBottom: '24px' }}>
        <h2>With Document</h2>
        <Reader document={demoDocument} />
      </section>
      <section style={{ marginBottom: '24px' }}>
        <h2>Upload Zone (no document)</h2>
        <Reader
          onFileUpload={handleFileUpload}
          emptyText='No document loaded'
        />
      </section>
      {uploadedFile && (
        <section>
          <h2>Last Uploaded File</h2>
          <p>Name: {uploadedFile.name}</p>
          <p>Size: {uploadedFile.size} bytes</p>
          <p>Type: {uploadedFile.type}</p>
        </section>
      )}
    </main>
  )
}
