import { DocxParser } from '@hamster-note/docx-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import type { DrawingValue } from '@hamster-note/painting'
import { PdfParser } from '@hamster-note/pdf-parser'
import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue,
  ReaderPageRange,
  ReaderPageTool,
  ReaderRenderMode,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderTouchPanMode
} from '@hamster-note/reader'
import { DefaultSelectionPopover, Reader } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import { TxtParser } from '@hamster-note/txt-parser'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized
} from '@hamster-note/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseHighlights, serializeHighlights } from './highlightStorage'

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

function persistHighlights(
  fileName: string | undefined,
  ranges: ReaderSelectionRange[],
  rects: ReaderSelectionRectangle[]
) {
  if (!fileName) return
  const persisted = parseHighlights(serializeHighlights(ranges, rects))
  localStorage.setItem(
    `hamster-reader-demo:highlights:${fileName}`,
    serializeHighlights(
      Array.from(persisted.ranges),
      Array.from(persisted.rects)
    )
  )
}

function toColorInputValue(
  color: React.CSSProperties['backgroundColor'] | undefined,
  fallback: string
): string {
  const value = color ?? fallback
  const hexMatch = /^#([\da-f]{3}|[\da-f]{6})(?:[\da-f]{2})?$/i.exec(value)
  if (hexMatch?.[1]) {
    const hex = hexMatch[1]
    return hex.length === 3
      ? `#${Array.from(hex, (digit) => digit.repeat(2)).join('')}`
      : `#${hex}`
  }

  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(
    value
  )
  if (rgbMatch?.[1] && rgbMatch[2] && rgbMatch[3]) {
    return `#${[rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      .map((channel) =>
        Math.min(255, Number(channel)).toString(16).padStart(2, '0')
      )
      .join('')}`
  }

  return '#ffc107'
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
  const [renderMode, setRenderMode] = useState<ReaderRenderMode>('layout')
  const [touchPanMode, setTouchPanMode] =
    useState<ReaderTouchPanMode>('single-finger')
  const [autoHighlight, setAutoHighlight] = useState(false)
  const [showPageBrowser, setShowPageBrowser] = useState(false)
  const [highlightColor, setHighlightColor] = useState(
    'rgba(255, 193, 7, 0.35)'
  )
  const [containMarginX, setContainMarginX] = useState<number>(0)
  const [containMarginTop, setContainMarginTop] = useState<number>(0)
  const [containMarginBottom, setContainMarginBottom] = useState<number>(0)
  const [scrollX, setScrollX] = useState<number>(0)
  const [scrollY, setScrollY] = useState<number>(0)
  const requestIdRef = useRef(0)

  // --- Selection 库集成演示 state ---
  // ranges 列表：受控模式，Reader 内部不修改，由 onSelect 回调外部追加
  const [ranges, setRanges] = useState<ReaderSelectionRange[]>([])
  // 当前选中的 range ID（点击高亮列表项时切换）
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  const [selectedTool, setSelectedTool] =
    useState<ReaderPageTool>('text-selection')
  const [pagePaintings, setPagePaintings] = useState<
    Record<string, DrawingValue>
  >({})
  const [rects, setRects] = useState<ReaderSelectionRectangle[]>([])
  const [selectedRectId, setSelectedRectId] = useState<string | null>(null)
  const [commentingHighlight, setCommentingHighlight] =
    useState<ReaderSelectionRange | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const commentResolverRef = useRef<
    ((highlight: ReaderSelectionRange) => void) | null
  >(null)
  const selectionRef = useRef<ReaderSelectionRef>(null)

  // --- Annotation history (undo/redo) state ---
  // 从 onAnnotationHistoryChange 的 detail.status 中获取响应式状态，
  // 用于驱动 Undo/Redo 按钮的 disabled 状态。不能仅靠 selectionRef.current?.canUndo()
  // 因为 ref 查询不会触发 React 重渲染。
  const [historyStatus, setHistoryStatus] =
    useState<ReaderAnnotationHistoryStatus>({
      enabled: false,
      canUndo: false,
      canRedo: false,
      pastCount: 0,
      futureCount: 0
    })

  // onAnnotationHistoryChange 是 undo/redo 以及所有 history-managed 变更的
  // 唯一正规状态更新路径。从此快照中更新 ranges/rects/selectedRangeId/selectedRectId，
  // 并通过 localStorage v3 helpers 持久化。
  // reset 源（文件切换）不持久化，因为文件上传处理器会从 localStorage 加载数据。
  const handleAnnotationHistoryChange = useCallback(
    (
      next: ReaderAnnotationHistoryValue,
      detail: ReaderAnnotationHistoryChangeDetail
    ) => {
      setRanges(next.ranges as ReaderSelectionRange[])
      setRects(next.rects as ReaderSelectionRectangle[])
      setSelectedRangeId(next.selectedRangeId)
      setSelectedRectId(next.selectedRectId)
      setHistoryStatus(detail.status)
      if (detail.source !== 'reset') {
        persistHighlights(
          uploadedFile?.name,
          next.ranges as ReaderSelectionRange[],
          next.rects as ReaderSelectionRectangle[]
        )
      }
    },
    [uploadedFile?.name]
  )

  // onSelect 回调：history 启用后，onAnnotationHistoryChange 是正规路径，
  // 此回调保持为 no-op。
  const handleSelectionSelect = useCallback(() => {}, [])

  // onHighlight 回调：history 启用后为 no-op（onAnnotationHistoryChange 负责状态更新）。
  const handleHighlight = useCallback(() => {}, [])

  const handleSelectionEnd = useCallback(() => {}, [])

  // onSelectRange 回调：用户点击已有 range 时触发（selection-only，不创建 checkpoint）
  const handleSelectRange = useCallback((id: string | null) => {
    setSelectedRangeId(id)
    // 文字选择和矩形选择互斥
    if (id !== null) {
      setSelectedRectId(null)
    }
  }, [])

  // onUpdateRange 回调：history 启用后为 no-op（onAnnotationHistoryChange 负责状态更新）。
  const handleUpdateRange = useCallback(() => {}, [])

  // Demo 内部直接受控变更（如颜色输入），不经过 library history 路径。
  // 此函数保留直接 setRanges + persistHighlights 行为。
  const handleUpdateRangeDirect = useCallback(
    (range: ReaderSelectionRange) => {
      setRanges((prev) => {
        const newRanges = prev.map((current) =>
          current.id === range.id ? range : current
        )
        persistHighlights(uploadedFile?.name, newRanges, rects)
        return newRanges
      })
    },
    [rects, uploadedFile?.name]
  )

  const handleCommentHighlight = useCallback(
    (highlight: ReaderSelectionRange) =>
      new Promise<ReaderSelectionRange>((resolve) => {
        commentResolverRef.current = resolve
        setCommentingHighlight(highlight)
      }),
    []
  )

  const handleFinishComment = useCallback(() => {
    if (!commentingHighlight || !commentResolverRef.current) return

    const resolve = commentResolverRef.current
    commentResolverRef.current = null
    setCommentingHighlight(null)
    setCommentDraft('')
    resolve(commentingHighlight)
  }, [commentingHighlight])

  // onCreateRect 回调：history 启用后为 no-op（onAnnotationHistoryChange 负责状态更新）。
  const handleCreateRect = useCallback(() => {}, [])

  const handleSelectRect = useCallback((id: string | null) => {
    setSelectedRectId(id)
    // 矩形选择和文字选择互斥
    if (id !== null) {
      setSelectedRangeId(null)
    }
  }, [])

  // onUpdateRect 回调：history 启用后为 no-op（onAnnotationHistoryChange 负责状态更新）。
  const handleUpdateRect = useCallback(() => {}, [])

  const handleRemoveRect = useCallback(
    (id: string) => {
      setRects((prev) => {
        const newRects = prev.filter((r) => r.id !== id)
        persistHighlights(uploadedFile?.name, ranges, newRects)
        return newRects
      })
      if (selectedRectId === id) {
        setSelectedRectId(null)
      }
    },
    [ranges, selectedRectId, uploadedFile?.name]
  )

  // 清空全部：通过 selectionRef.current?.clear() 触发 library 的 clear 命令，
  // library 会创建 checkpoint 并通过 onAnnotationHistoryChange 回传空快照。
  const handleClearAllRanges = useCallback(() => {
    selectionRef.current?.clear()
  }, [])

  const handleRemoveRange = useCallback(
    (id: string) => {
      setRanges((prev) => {
        const newRanges = prev.filter((r) => r.id !== id)
        persistHighlights(uploadedFile?.name, newRanges, rects)
        return newRanges
      })
      if (selectedRangeId === id) {
        setSelectedRangeId(null)
      }
    },
    [rects, selectedRangeId, uploadedFile?.name]
  )

  // 侧边栏文字高亮项点击：始终选中并滚动到该 range（不做 toggle-off）
  const handleHighlightSelect = useCallback((id: string) => {
    setSelectedRangeId(id)
    setSelectedRectId(null)
    selectionRef.current?.scrollToRange(id)
  }, [])

  // 侧边栏矩形高亮项点击：始终选中并滚动到该 rect
  const handleRectHighlightSelect = useCallback((id: string) => {
    setSelectedRectId(id)
    setSelectedRangeId(null)
    selectionRef.current?.scrollToRect(id)
  }, [])

  const handleApplyScroll = useCallback(() => {
    selectionRef.current?.scrollToPosition({ x: scrollX, y: scrollY })
  }, [scrollX, scrollY])

  // Demo-only 键盘快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做。
  // 必须忽略 input/textarea/contenteditable 中的按键，避免与文本编辑冲突。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      ) {
        return
      }

      const isMac = navigator.platform.toLowerCase().includes('mac')
      const modifier = isMac ? event.metaKey : event.ctrlKey
      if (!modifier) return

      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y'

      if (isUndo) {
        event.preventDefault()
        selectionRef.current?.undo()
      } else if (isRedo) {
        event.preventDefault()
        selectionRef.current?.redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleUndo = useCallback(() => {
    selectionRef.current?.undo()
  }, [])

  const handleRedo = useCallback(() => {
    selectionRef.current?.redo()
  }, [])

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
      const parsedHighlights = parseHighlights(storedHighlights)
      setRanges(Array.from(parsedHighlights.ranges))
      setRects(Array.from(parsedHighlights.rects))
      setSelectedRangeId(null)
      setSelectedRectId(null)
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
                  <span>渲染模式 Render Mode</span>
                  <select
                    value={renderMode}
                    onChange={(e) => {
                      const nextRenderMode = e.currentTarget.value
                      if (
                        nextRenderMode === 'layout' ||
                        nextRenderMode === 'text'
                      ) {
                        setRenderMode(nextRenderMode)
                      }
                    }}
                    data-testid='render-mode-select'
                    style={{
                      padding: '4px 8px',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      background: '#fff'
                    }}
                  >
                    <option value='layout'>Layout</option>
                    <option value='text'>Text</option>
                  </select>
                </label>
              </div>
              {renderMode === 'layout' && (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <span>滑动模式 Touch Pan Mode</span>
                      <select
                        value={touchPanMode}
                        onChange={(e) => {
                          const nextTouchPanMode = e.currentTarget.value
                          if (
                            nextTouchPanMode === 'single-finger' ||
                            nextTouchPanMode === 'two-finger'
                          ) {
                            setTouchPanMode(nextTouchPanMode)
                          }
                        }}
                        data-testid='touch-pan-mode-select'
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          background: '#fff'
                        }}
                      >
                        <option value='single-finger'>
                          单指 Single-finger
                        </option>
                        <option value='two-finger'>双指 Two-finger</option>
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
                        checked={showPageBrowser}
                        onChange={(event) =>
                          setShowPageBrowser(event.currentTarget.checked)
                        }
                        data-testid='page-browser-toggle'
                      />
                      <span>显示页面浏览栏 Page Browser</span>
                    </label>
                  </div>
                </>
              )}
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
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <span>水平留白 Margin X (px)</span>
                  <input
                    type='number'
                    min={0}
                    value={containMarginX}
                    onChange={(e) =>
                      setContainMarginX(
                        Math.max(0, Number(e.target.value) || 0)
                      )
                    }
                    style={{ width: '60px', padding: '4px' }}
                    data-testid='contain-margin-x-input'
                  />
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
                  <span>顶部留白 Margin Top (px)</span>
                  <input
                    type='number'
                    min={0}
                    value={containMarginTop}
                    onChange={(e) =>
                      setContainMarginTop(
                        Math.max(0, Number(e.target.value) || 0)
                      )
                    }
                    style={{ width: '60px', padding: '4px' }}
                    data-testid='contain-margin-top-input'
                  />
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
                  <span>底部留白 Margin Bottom (px)</span>
                  <input
                    type='number'
                    min={0}
                    value={containMarginBottom}
                    onChange={(e) =>
                      setContainMarginBottom(
                        Math.max(0, Number(e.target.value) || 0)
                      )
                    }
                    style={{ width: '60px', padding: '4px' }}
                    data-testid='contain-margin-bottom-input'
                  />
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
                  <span>工具 Tool</span>
                  <select
                    value={selectedTool}
                    onChange={(e) => {
                      const nextTool = e.currentTarget.value
                      if (
                        nextTool === 'text-selection' ||
                        nextTool === 'rect-selection' ||
                        nextTool === 'drawing'
                      ) {
                        setSelectedTool(nextTool)
                      }
                    }}
                    data-testid='selection-tool-select'
                    style={{
                      padding: '4px 8px',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      background: '#fff'
                    }}
                  >
                    <option value='text-selection'>文本选择 Text</option>
                    <option value='rect-selection'>矩形选择 Rect</option>
                    <option value='drawing'>绘图 Drawing</option>
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
                  <span>滚动 X (px)</span>
                  <input
                    type='number'
                    value={scrollX}
                    onChange={(e) => setScrollX(Number(e.target.value) || 0)}
                    style={{ width: '60px', padding: '4px' }}
                    data-testid='scroll-x-input'
                  />
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
                  <span>滚动 Y (px)</span>
                  <input
                    type='number'
                    value={scrollY}
                    onChange={(e) => setScrollY(Number(e.target.value) || 0)}
                    style={{ width: '60px', padding: '4px' }}
                    data-testid='scroll-y-input'
                  />
                </label>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <button
                  type='button'
                  onClick={handleApplyScroll}
                  style={{
                    padding: '4px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    background: '#fff'
                  }}
                  data-testid='apply-scroll-btn'
                >
                  应用滚动位置
                </button>
              </div>
              <div style={{ marginBottom: '12px' }}>
                {/* Highlight & Background Color Controls */}
                <div data-testid='background-color-select' />
                <div data-testid='highlight-color-select' />
              </div>
            </section>
          )}

          {document && (
            <section style={{ marginBottom: '24px' }}>
              <h2>Undo / Redo</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type='button'
                  onClick={handleUndo}
                  disabled={!historyStatus.canUndo}
                  data-testid='undo-btn'
                  style={{
                    padding: '4px 12px',
                    fontSize: '13px',
                    cursor: historyStatus.canUndo ? 'pointer' : 'not-allowed',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    background: historyStatus.canUndo ? '#fff' : '#f5f5f5',
                    opacity: historyStatus.canUndo ? 1 : 0.6
                  }}
                >
                  撤销 Undo
                </button>
                <button
                  type='button'
                  onClick={handleRedo}
                  disabled={!historyStatus.canRedo}
                  data-testid='redo-btn'
                  style={{
                    padding: '4px 12px',
                    fontSize: '13px',
                    cursor: historyStatus.canRedo ? 'pointer' : 'not-allowed',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    background: historyStatus.canRedo ? '#fff' : '#f5f5f5',
                    opacity: historyStatus.canRedo ? 1 : 0.6
                  }}
                >
                  重做 Redo
                </button>
              </div>
            </section>
          )}
        </div>

        {ranges.length + rects.length > 0 && (
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
                已创建高亮 ({ranges.length + rects.length})
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
                  key={`range-${range.id}`}
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
                    onClick={() => handleHighlightSelect(range.id)}
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
              {rects.map((rect) => (
                <li
                  key={`rect-${rect.id}`}
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
                    aria-label='Select rect highlight'
                    onClick={() => handleRectHighlightSelect(rect.id)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      border:
                        selectedRectId === rect.id
                          ? '2px solid #2196f3'
                          : '1px solid #ddd',
                      borderRadius: '4px',
                      background:
                        selectedRectId === rect.id ? '#e3f2fd' : '#fafafa',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    矩形 {rect.id}
                  </button>
                  <button
                    type='button'
                    aria-label='Remove rect highlight'
                    onClick={() => handleRemoveRect(rect.id)}
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
          renderMode={renderMode}
          touchPanMode={touchPanMode}
          onFileUpload={handleFileUpload}
          emptyText='No document loaded'
          pageRange={buildPageRange()}
          overlayRectType='percent'
          ocr={{ enabled: false }}
          onTextSelectionChange={() => {}}
          onTextSelectionEnd={() => {}}
          onSelectText={() => {}}
          ranges={ranges}
          selectedRangeId={selectedRangeId}
          onSelect={handleSelectionSelect}
          onSelectRange={handleSelectRange}
          onUpdateRange={handleUpdateRange}
          onHighlight={handleHighlight}
          onRemoveRange={handleRemoveRange}
          onHighlightColorChange={setHighlightColor}
          onSelectionEnd={handleSelectionEnd}
          selectionRef={selectionRef}
          selectionPopover={
            <DefaultSelectionPopover
              selectionRef={selectionRef}
              highlightColor={highlightColor}
              onHighlightColorChange={setHighlightColor}
              selectedRangeId={selectedRangeId}
              ranges={ranges}
              onUpdateRange={handleUpdateRange}
              onRemoveRange={handleRemoveRange}
            />
          }
          highlightColor={highlightColor}
          selectionColor='rgba(33, 150, 243, 0.2)'
          autoHighlight={autoHighlight}
          containMarginX={containMarginX}
          containMarginTop={containMarginTop}
          containMarginBottom={containMarginBottom}
          selectedTool={selectedTool}
          pagePaintings={pagePaintings}
          onPagePaintingsChange={setPagePaintings}
          showPageBrowser={showPageBrowser}
          rects={rects}
          selectedRectId={selectedRectId}
          onCreateRect={handleCreateRect}
          onSelectRect={handleSelectRect}
          onUpdateRect={handleUpdateRect}
          annotationHistory={{
            enabled: true,
            resetKey: uploadedFile?.name ?? 'none'
          }}
          onAnnotationHistoryChange={handleAnnotationHistoryChange}
          onCommentHighlight={handleCommentHighlight}
          highlightPopover={(highlight) => (
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
                onClick={() => handleRemoveRange(highlight.id)}
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
                  value={toColorInputValue(
                    highlight.markerStyle?.backgroundColor,
                    highlightColor
                  )}
                  aria-label='Highlight color'
                  onChange={(e) => {
                    const newColor = e.target.value
                    setHighlightColor(newColor)
                    handleUpdateRangeDirect({
                      ...highlight,
                      markerStyle: {
                        ...highlight.markerStyle,
                        backgroundColor: newColor
                      }
                    })
                  }}
                  style={{
                    width: '20px',
                    height: '20px',
                    padding: 0,
                    border: 'none'
                  }}
                />
              </label>
            </div>
          )}
        />
      </div>
      {commentingHighlight && (
        <aside
          role='dialog'
          aria-modal='true'
          aria-labelledby='highlight-comment-title'
          data-testid='highlight-comment-panel'
          style={{
            position: 'fixed',
            right: '24px',
            bottom: '24px',
            zIndex: 1000,
            width: 'min(360px, calc(100vw - 48px))',
            boxSizing: 'border-box',
            padding: '20px',
            border: '1px solid #cbd5e1',
            borderRadius: '12px',
            background: '#fff',
            boxShadow: '0 20px 48px rgba(15, 23, 42, 0.2)'
          }}
        >
          <h2
            id='highlight-comment-title'
            style={{ margin: '0 0 8px', fontSize: '18px' }}
          >
            评论高亮
          </h2>
          <p style={{ margin: '0 0 12px', color: '#64748b' }}>
            {commentingHighlight.text || '(空选区)'}
          </p>
          <textarea
            aria-label='评论内容'
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.currentTarget.value)}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              minHeight: '96px',
              marginBottom: '12px',
              padding: '10px',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              resize: 'vertical',
              font: 'inherit'
            }}
          />
          <button
            type='button'
            onClick={handleFinishComment}
            style={{
              width: '100%',
              minHeight: '44px',
              border: 0,
              borderRadius: '8px',
              background: '#2563eb',
              color: '#fff',
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            完成评论
          </button>
        </aside>
      )}
    </main>
  )
}
