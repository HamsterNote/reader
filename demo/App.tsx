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
// Helpers
// ---------------------------------------------------------------------------

function parseHighlightsJson(jsonStr: string | null): ReaderSelectionRange[] {
  if (!jsonStr) return []
  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return []
    // Strict validation: check all required fields of ReaderSelectionRange
    const isValidRange = (item: unknown): item is ReaderSelectionRange => {
      if (!item || typeof item !== 'object') return false
      const record = item as Record<string, unknown>
      return (
        typeof record.id === 'string' &&
        typeof record.text === 'string' &&
        typeof record.start === 'number' &&
        typeof record.end === 'number' &&
        typeof record.createdAt === 'number'
      )
    }

    // Check if ALL items in the array are valid. If not, consider the whole storage corrupted and return [].
    // Returning [] on partial corruption avoids weird crashes or half-working states.
    if (!parsed.every(isValidRange)) {
      return []
    }
    return parsed
  } catch {
    return []
  }
}

function persistHighlights(
  fileName: string | undefined,
  ranges: ReaderSelectionRange[]
) {
  if (!fileName) return
  localStorage.setItem(
    `hamster-reader-demo:highlights:${fileName}`,
    JSON.stringify(ranges)
  )
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
  const [autoHighlight, setAutoHighlight] = useState(false)
  const [highlightColor, setHighlightColor] = useState(
    'rgba(255, 193, 7, 0.35)'
  )
  const requestIdRef = useRef(0)

  // --- Selection 库集成演示 state ---
  // ranges 列表：受控模式，Reader 内部不修改，由 onSelect 回调外部追加
  const [ranges, setRanges] = useState<ReaderSelectionRange[]>([])
  // 当前选中的 range ID（点击高亮列表项时切换）
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  // Selection 组件 ref，暴露 highlight()/clear() 方法
  const selectionRef = useRef<ReaderSelectionRef>(null)

  // onSelect 回调：highlight() 创建新 range 时触发，将 range 追加到列表
  const handleSelectionSelect = useCallback(() => {}, [])

  const handleHighlight = useCallback(
    (range: ReaderSelectionRange) => {
      setRanges((prev) => {
        const newRanges = [...prev, range]
        persistHighlights(uploadedFile?.name, newRanges)
        return newRanges
      })
    },
    [uploadedFile?.name]
  )

  const handleSelectionEnd = useCallback(() => {}, [])

  // onSelectRange 回调：用户点击已有 range 时触发
  const handleSelectRange = useCallback((id: string | null) => {
    setSelectedRangeId(id)
  }, [])

  const handleUpdateRange = useCallback(
    (range: ReaderSelectionRange) => {
      setRanges((prev) => {
        const newRanges = prev.map((current) =>
          current.id === range.id ? range : current
        )
        persistHighlights(uploadedFile?.name, newRanges)
        return newRanges
      })
    },
    [uploadedFile?.name]
  )

  // 清空所有高亮 range
  const handleClearAllRanges = useCallback(() => {
    setRanges([])
    setSelectedRangeId(null)
    selectionRef.current?.clear()
    persistHighlights(uploadedFile?.name, [])
  }, [uploadedFile?.name])

  // 删除单个 range
  const handleRemoveRange = useCallback(
    (id: string) => {
      setRanges((prev) => {
        const newRanges = prev.filter((r) => r.id !== id)
        persistHighlights(uploadedFile?.name, newRanges)
        return newRanges
      })
      if (selectedRangeId === id) {
        setSelectedRangeId(null)
      }
    },
    [selectedRangeId, uploadedFile?.name]
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

      const storedHighlights = localStorage.getItem(
        `hamster-reader-demo:highlights:${file.name}`
      )
      setRanges(parseHighlightsJson(storedHighlights))
      setSelectedRangeId(null)
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
    <main data-testid='reader-demo-root' className='hamster-demo-shell'>
      <div className='hamster-demo-sidebar'>
        <div data-testid='demo-sidebar-settings'>
          <h1>Hamster Reader Demo</h1>
          {isParsing && (
            <section style={{ marginBottom: '24px' }}>
              <h2>Parsing...</h2>
              <p>Loading PDF content...</p>
            </section>
          )}
          {parseError && (
            <section
              data-testid='demo-error-state'
              style={{ marginBottom: '24px', color: 'red' }}
            >
              <h2>Parse Error</h2>
              <p>{parseError}</p>
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
                <div
                  style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>Start:</span>
                    <input
                      type='number'
                      min={1}
                      value={pageRangeStart}
                      onChange={(e) =>
                        setPageRangeStart(
                          Math.max(1, Number(e.target.value) || 1)
                        )
                      }
                      style={{ width: '60px', padding: '4px' }}
                      data-testid='page-range-start'
                    />
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>End:</span>
                    <input
                      type='number'
                      min={1}
                      value={pageRangeEnd}
                      onChange={(e) =>
                        setPageRangeEnd(
                          Math.max(1, Number(e.target.value) || 1)
                        )
                      }
                      style={{ width: '60px', padding: '4px' }}
                      data-testid='page-range-end'
                    />
                  </label>
                </div>
              )}
            </div>
            {/* The single Reader handles both upload and document rendering on the right panel */}
          </section>

          {uploadedFile && !isParsing && (
            <section style={{ marginBottom: '24px' }}>
              <h2>Last Uploaded File</h2>
              <p>Name: {uploadedFile.name}</p>
              <p>Size: {uploadedFile.size} bytes</p>
              <p>Type: {uploadedFile.type}</p>
            </section>
          )}

          {document && (
            <section style={{ marginBottom: '24px' }}>
              <h2>Reader Settings</h2>
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
              <div style={{ marginBottom: '12px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <input
                    type='checkbox'
                    checked={autoHighlight}
                    onChange={(e) => setAutoHighlight(e.target.checked)}
                    data-testid='auto-highlight-toggle'
                  />
                  <span>选中文字后自动高亮</span>
                </label>
              </div>
              <div style={{ marginBottom: '12px' }}>
                {/* Highlight & Background Color Controls */}
                <div data-testid='background-color-select' />
                <div data-testid='highlight-color-select' />
              </div>
              <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                Rendered through the html-parser path with native browser
                selection
              </p>
            </section>
          )}
        </div>

        {/* Selection 库：已创建的高亮 range 列表与管理操作 */}
        {ranges.length > 0 && (
          <div
            data-testid='demo-sidebar-highlights'
            style={{ marginTop: '12px' }}
          >
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
                  className='hamster-demo-action-group'
                >
                  <button
                    type='button'
                    aria-label='Select highlight'
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
                    aria-label='Remove highlight'
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
      </div>

      <div
        className='hamster-demo-main'
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          minWidth: 0
        }}
      >
        {!document && !parseError && !isParsing && (
          <div data-testid='demo-empty-state' style={{ display: 'none' }} />
        )}
        <Reader
          document={document || undefined}
          onFileUpload={handleFileUpload}
          emptyText='No document loaded'
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
          onHighlight={handleHighlight}
          onSelectionEnd={handleSelectionEnd}
          selectionRef={selectionRef}
          highlightColor={highlightColor}
          selectionColor='rgba(33, 150, 243, 0.2)'
          autoHighlight={autoHighlight}
          selectionPopover={
            <div
              className='hamster-demo-action-group'
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
              <button
                type='button'
                onClick={() => selectionRef.current?.highlight()}
                style={{
                  cursor: 'pointer',
                  background: 'transparent',
                  color: '#fff',
                  border: 'none'
                }}
              >
                高亮
              </button>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer'
                }}
              >
                <span>背景颜色设置</span>
                <input
                  type='color'
                  value={
                    highlightColor.startsWith('#') ? highlightColor : '#ffc107'
                  }
                  onChange={(e) => setHighlightColor(e.target.value)}
                  style={{
                    width: '20px',
                    height: '20px',
                    padding: 0,
                    border: 'none'
                  }}
                />
              </label>
            </div>
          }
          highlightPopover={
            <div
              className='hamster-demo-action-group'
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
              <button
                type='button'
                onClick={() => {
                  if (selectedRangeId) {
                    handleRemoveRange(selectedRangeId)
                  }
                }}
                style={{
                  cursor: 'pointer',
                  background: 'transparent',
                  color: '#fff',
                  border: 'none'
                }}
              >
                删除
              </button>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer'
                }}
              >
                <span>背景颜色设置</span>
                <input
                  type='color'
                  value={
                    highlightColor.startsWith('#') ? highlightColor : '#ffc107'
                  }
                  onChange={(e) => setHighlightColor(e.target.value)}
                  style={{
                    width: '20px',
                    height: '20px',
                    padding: 0,
                    border: 'none'
                  }}
                />
              </label>
            </div>
          }
        />
      </div>
    </main>
  )
}
