import { PdfParser } from '@hamster-note/pdf-parser'
import { Reader } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized
} from '@hamster-note/types'
import { useRef, useState } from 'react'

export function App() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [document, setDocument] = useState<
    IntermediateDocument | IntermediateDocumentSerialized | null
  >(null)
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const handleFileUpload = async (file: File) => {
    setUploadedFile(file)
    setParseError(null)

    const requestId = ++requestIdRef.current
    setIsParsing(true)

    try {
      const result = await PdfParser.encode(file)

      if (requestId !== requestIdRef.current) {
        return
      }

      if (result === undefined) {
        setParseError('Failed to parse PDF: received undefined result')
        setDocument(null)
      } else {
        setDocument(result)
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return
      }

      const message = err instanceof Error ? err.message : String(err)
      setParseError(`Failed to parse PDF: ${message}`)
      setDocument(null)
    } finally {
      if (requestId === requestIdRef.current) {
        setIsParsing(false)
      }
    }
  }

  return (
    <main data-testid='reader-demo-root'>
      <h1>Hamster Reader Demo</h1>
      {isParsing && (
        <section style={{ marginBottom: '24px' }}>
          <h2>Parsing...</h2>
          <p>Loading PDF content...</p>
        </section>
      )}
      {parseError && (
        <section style={{ marginBottom: '24px', color: 'red' }}>
          <h2>Parse Error</h2>
          <p>{parseError}</p>
        </section>
      )}
      {document && (
        <section style={{ marginBottom: '24px' }}>
          <h2>Parsed Document</h2>
          <Reader
            document={document}
            ocr
            onTextSelectionChange={(text, detail) => {
              console.log('[Reader demo] text selection change', text, detail)
            }}
            onTextSelectionEnd={(text, detail) => {
              console.log('[Reader demo] text selection end', text, detail)
            }}
          />
        </section>
      )}
      <section style={{ marginBottom: '24px' }}>
        <h2>Upload PDF</h2>
        <Reader
          onFileUpload={handleFileUpload}
          emptyText='No document loaded'
        />
      </section>
      {uploadedFile && !isParsing && (
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
