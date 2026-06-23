import { DocxParser } from '@hamster-note/docx-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import { PdfParser } from '@hamster-note/pdf-parser'
import type {
  BackgroundQuality,
  ReaderPageRange
} from '@hamster-note/reader'
import { Reader } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import { TxtParser } from '@hamster-note/txt-parser'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized
} from '@hamster-note/types'
import { useCallback, useRef, useState } from 'react'

type ReaderDocument = IntermediateDocument | IntermediateDocumentSerialized

export const SUPPORTED_FILE_TYPE_LABEL = 'PDF, TXT, DOCX, Markdown'

export const UNSUPPORTED_FILE_TYPE_MESSAGE =
  'Unsupported file type. Supported: PDF, TXT, DOCX, Markdown.'

export type SupportedParserLabel = 'PDF' | 'TXT' | 'DOCX' | 'Markdown'

export type ParseUploadedDocumentResult =
  | {
      status: 'parsed'
      label: SupportedParserLabel
      document: ReaderDocument | undefined
    }
  | { status: 'failed'; label: SupportedParserLabel; error: string }
  | { status: 'unsupported'; error: string }

export function getFileExtension(fileName: string): string | null {
  if (fileName.length === 0) return null

  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex < 0 || lastDotIndex === fileName.length - 1) return null

  return fileName.slice(lastDotIndex + 1).toLowerCase()
}

export function getParserErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function parseUploadedDocument(
  file: File,
  pages: number[] | undefined
): Promise<ParseUploadedDocumentResult> {
  switch (getFileExtension(file.name)) {
    case 'pdf':
      try {
        const document = await PdfParser.encode(
          file,
          pages ? { pages } : undefined
        )
        return { status: 'parsed', label: 'PDF', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'PDF',
          error: getParserErrorMessage(error)
        }
      }
    case 'txt':
      try {
        const document = await TxtParser.encode(file)
        return { status: 'parsed', label: 'TXT', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'TXT',
          error: getParserErrorMessage(error)
        }
      }
    case 'docx':
      try {
        const document = await DocxParser.encodeToIntermediate(file)
        return { status: 'parsed', label: 'DOCX', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'DOCX',
          error: getParserErrorMessage(error)
        }
      }
    case 'md':
    case 'markdown':
      try {
        const document = await MarkdownParser.encode(file)
        return { status: 'parsed', label: 'Markdown', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'Markdown',
          error: getParserErrorMessage(error)
        }
      }
    default:
      return { status: 'unsupported', error: UNSUPPORTED_FILE_TYPE_MESSAGE }
  }
}

// ---------------------------------------------------------------------------
// App 组件
// ---------------------------------------------------------------------------

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
  const [backgroundQuality, setBackgroundQuality] =
    useState<BackgroundQuality>('medium')
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
      const selectedPages = buildParserPages()
      const result = await parseUploadedDocument(file, selectedPages)

      if (requestId !== requestIdRef.current) {
        return
      }

      if (result.status === 'unsupported') {
        setParseError(result.error)
        setDocument(null)
        return
      }

      if (result.status === 'failed') {
        setParseError(`Failed to parse ${result.label}: ${result.error}`)
        setDocument(null)
        return
      }

      if (result.document === undefined) {
        setParseError(
          `Failed to parse ${result.label}: received undefined result`
        )
        setDocument(null)
        return
      }

      setDocument(result.document)
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return
      }

      setParseError(`Failed to parse file: ${getParserErrorMessage(error)}`)
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
            renderMode='html-parser'
            backgroundQuality={backgroundQuality}
            ocr
            onTextSelectionChange={() => {}}
            onTextSelectionEnd={() => {}}
            onSelectText={() => {}}
          />
          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
            Rendered through the html-parser path with native browser selection
          </p>
        </section>
      )}
      <section style={{ marginBottom: '24px' }}>
        <h2>Upload {SUPPORTED_FILE_TYPE_LABEL}</h2>
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
          onSelectText={() => {}}
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
