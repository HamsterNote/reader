import { DocxParser } from '@hamster-note/docx-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import { PdfParser } from '@hamster-note/pdf-parser'
import type {
  BackgroundQuality,
  ReaderPageRange,
  ReaderSelectionRange,
  ReaderSelectionRef
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

  // --- Selection 库集成演示 state ---
  // ranges 列表：受控模式，Reader 内部不修改，由 onSelect 回调外部追加
  const [ranges, setRanges] = useState<ReaderSelectionRange[]>([])
  // 当前选中的 range ID（点击高亮列表项时切换）
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  // Selection 组件 ref，暴露 highlight()/clear() 方法
  const selectionRef = useRef<ReaderSelectionRef>(null)

  // onSelect 回调：highlight() 创建新 range 时触发，将 range 追加到列表
  const handleSelectionSelect = useCallback((range: ReaderSelectionRange) => {
    setRanges((prev) => [...prev, range])
  }, [])

  // onSelectionEnd 回调：用户松开鼠标完成选区时触发。
  // Selection 库的 highlight() 只能通过 ref 显式调用才会触发 onSelect，
  // 不会在选区结束时自动触发。这里在选区结束时自动调用 highlight()，
  // 实现"选中即高亮"的效果。
  const handleSelectionEnd = useCallback(() => {
    selectionRef.current?.highlight()
  }, [])

  // onSelectRange 回调：用户点击已有 range 时触发
  const handleSelectRange = useCallback((id: string | null) => {
    setSelectedRangeId(id)
  }, [])

  const handleUpdateRange = useCallback((range: ReaderSelectionRange) => {
    setRanges((prev) =>
      prev.map((current) => (current.id === range.id ? range : current))
    )
  }, [])

  // 清空所有高亮 range
  const handleClearAllRanges = useCallback(() => {
    setRanges([])
    setSelectedRangeId(null)
    selectionRef.current?.clear()
  }, [])

  // 删除单个 range
  const handleRemoveRange = useCallback(
    (id: string) => {
      setRanges((prev) => prev.filter((r) => r.id !== id))
      if (selectedRangeId === id) {
        setSelectedRangeId(null)
      }
    },
    [selectedRangeId]
  )

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
            overlayRectType='percent'
            ocr
            onTextSelectionChange={() => {}}
            onTextSelectionEnd={() => {}}
            onSelectText={() => {}}
            ranges={ranges}
            selectedRangeId={selectedRangeId}
            onSelect={handleSelectionSelect}
            onSelectRange={handleSelectRange}
            onUpdateRange={handleUpdateRange}
            onSelectionEnd={handleSelectionEnd}
            selectionRef={selectionRef}
            highlightColor='rgba(255, 193, 7, 0.35)'
            selectionColor='rgba(33, 150, 243, 0.2)'
            selectionPopover={
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  padding: '4px 8px',
                  background: '#333',
                  color: '#fff',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              >
                <span>选中文字后自动高亮</span>
              </div>
            }
          />
          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
            Rendered through the html-parser path with native browser selection
          </p>
          {/* Selection 库：已创建的高亮 range 列表与管理操作 */}
          {ranges.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}
              >
                <span style={{ fontSize: '14px', fontWeight: 600 }}>
                  已创建高亮 ({ranges.length})
                </span>
                <button
                  type='button'
                  onClick={handleClearAllRanges}
                  style={{
                    padding: '4px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    background: '#fff'
                  }}
                >
                  清空全部
                </button>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {ranges.map((range) => (
                  <li
                    key={range.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 0',
                      fontSize: '13px'
                    }}
                  >
                    <button
                      type='button'
                      onClick={() =>
                        setSelectedRangeId(
                          selectedRangeId === range.id ? null : range.id
                        )
                      }
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        border:
                          selectedRangeId === range.id
                            ? '2px solid #2196f3'
                            : '1px solid #ddd',
                        borderRadius: '4px',
                        background:
                          selectedRangeId === range.id ? '#e3f2fd' : '#fafafa',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {range.text || '(空选区)'}
                    </button>
                    <button
                      type='button'
                      onClick={() => handleRemoveRange(range.id)}
                      style={{
                        padding: '4px 8px',
                        cursor: 'pointer',
                        border: '1px solid #f44336',
                        borderRadius: '4px',
                        background: '#fff',
                        color: '#f44336',
                        fontSize: '13px'
                      }}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
