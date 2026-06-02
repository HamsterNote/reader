import { PdfParser } from '@hamster-note/pdf-parser'
import { Reader } from '@hamster-note/reader'
import type { BackgroundQuality, ReaderPageRange } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized
} from '@hamster-note/types'
import { useCallback, useRef, useState } from 'react'

export function App() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [document, setDocument] = useState<
    IntermediateDocument | IntermediateDocumentSerialized | null
  >(null)
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [pageRangeStart, setPageRangeStart] = useState<number>(1)
  const [pageRangeEnd, setPageRangeEnd] = useState<number>(3)
  const [usePageRange, setUsePageRange] = useState<boolean>(false)
  const [backgroundQuality, setBackgroundQuality] = useState<BackgroundQuality>('medium')
  const requestIdRef = useRef(0)

  const buildPageRange = useCallback((): ReaderPageRange | undefined => {
    if (!usePageRange) {
      return undefined
    }
    return { start: pageRangeStart, end: pageRangeEnd }
  }, [usePageRange, pageRangeStart, pageRangeEnd])

  const buildParserPages = useCallback((): number[] | undefined => {
    if (!usePageRange) {
      return undefined
    }
    const start = Math.trunc(pageRangeStart)
    const end = Math.trunc(pageRangeEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return undefined
    }
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [usePageRange, pageRangeStart, pageRangeEnd])

  const handleFileUpload = async (file: File) => {
    setUploadedFile(file)
    setParseError(null)

    const requestId = ++requestIdRef.current
    setIsParsing(true)

    try {
      const pages = buildParserPages()
      const result = await PdfParser.encode(file, pages ? { pages } : undefined)

      if (requestId !== requestIdRef.current) {
        return
      }

      if (result === undefined) {
        setParseError('Failed to parse PDF: received undefined result')
        setDocument(null)
      } else {
        console.log('Parsed Document:', result)
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
          <div style={{ marginBottom: '12px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>Background Quality:</span>
              <select
                value={backgroundQuality}
                onChange={(e) =>
                  setBackgroundQuality(e.target.value as BackgroundQuality)
                }
                style={{ padding: '4px 8px' }}
                data-testid='background-quality-select'
              >
                <option value='low'>Low</option>
                <option value='medium'>Medium</option>
                <option value='high'>High</option>
              </select>
            </label>
          </div>
          <Reader
            document={document}
            pageRange={buildPageRange()}
            backgroundQuality={backgroundQuality}
            ocr
            onTextSelectionChange={(text, detail) => {
              console.log('[Reader demo] text selection change', text, detail)
            }}
            onTextSelectionEnd={(text, detail) => {
              console.log('[Reader demo] text selection end', text, detail)
            }}
          />
          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
            Rendered via @hamster-note/html-parser
          </p>
        </section>
      )}
      <section style={{ marginBottom: '24px' }}>
        <h2>Upload PDF</h2>
        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px'
            }}
          >
            <input
              type='checkbox'
              checked={usePageRange}
              onChange={(e) => setUsePageRange(e.target.checked)}
              data-testid='page-range-toggle'
            />
            <span>Enable page range</span>
          </label>
          {usePageRange && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <span>Start:</span>
                <input
                  type='number'
                  min={1}
                  value={pageRangeStart}
                  onChange={(e) =>
                    setPageRangeStart(Math.max(1, Number(e.target.value) || 1))
                  }
                  style={{ width: '60px', padding: '4px' }}
                  data-testid='page-range-start'
                />
              </label>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <span>End:</span>
                <input
                  type='number'
                  min={1}
                  value={pageRangeEnd}
                  onChange={(e) =>
                    setPageRangeEnd(Math.max(1, Number(e.target.value) || 1))
                  }
                  style={{ width: '60px', padding: '4px' }}
                  data-testid='page-range-end'
                />
              </label>
            </div>
          )}
        </div>
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
