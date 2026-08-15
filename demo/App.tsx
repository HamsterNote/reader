import { DocxParser } from '@hamster-note/docx-parser'
import { EpubParser } from '@hamster-note/epub-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import type { DrawingValue } from '@hamster-note/painting'
import { type OpenDocumentHandle, PdfParser } from '@hamster-note/pdf-parser'
import {
  type ReaderAnnotationHistoryChangeDetail as AnnotationHistoryChangeDetail,
  type IntermediateDocumentRenderTimingEntry,
  Reader,
  type ReaderAnnotationHistoryStatus,
  type ReaderAnnotationHistoryValue,
  type ReaderBookmark,
  type ReaderColorOption,
  type ReaderComment,
  type ReaderData,
  type ReaderEdgeCrop,
  type ReaderFontScale,
  type ReaderLinkedSelectionData,
  type ReaderLoadingProgress,
  type ReaderPageRange,
  type ReaderPageTool,
  type ReaderRenderMode,
  type ReaderSelectionRange,
  type ReaderSelectionRectangle,
  type ReaderSelectionRef,
  type ReaderTextAnchor,
  type ReaderTextReadingProgress,
  type ReaderTouchPanMode,
  type ReaderVirtualPaperState,
  summarizeHighlightRanges,
  traceHighlight
} from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import { TxtParser } from '@hamster-note/txt-parser'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CommentPanel } from './CommentPanel'
import {
  parseComments,
  removeHighlightFromComments,
  serializeComments
} from './commentStorage'
import { convertEpubDocumentForReader } from './epubForReader'
import { loadFileToMemory } from './fileMemoryLoader'
import { parseHighlights, serializeHighlights } from './highlightStorage'
import { createImagePreviewDocument } from './imagePreview'
import {
  type DemoOcrMode,
  parseOcrStorage,
  serializeOcrStorage
} from './ocrStorage'
import {
  configurePdfParserForReader,
  openPdfDocumentForReader
} from './pdfParserForReader'
import {
  parseReaderPreferences,
  serializeReaderPreferences
} from './readerPreferencesStorage'
import {
  clearRecentFile,
  loadRecentFile,
  saveRecentFile
} from './recentFileStorage'
import {
  createViewerLifetimeToken,
  ViewerLifetimeBoundary,
  type ViewerLifetimeToken
} from './ViewerLifetimeBoundary'

type ReaderDocument = IntermediateDocument | IntermediateDocumentSerialized

type FileSelectionSource = 'reader-upload' | 'sidebar' | 'recent-file'

type FileSelection = {
  readonly epoch: number
  readonly file: File
  readonly source: FileSelectionSource
}

type PdfLoadState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'loading'
      readonly selection: FileSelection
      readonly loaded: number
      readonly total: number
    }
  | {
      readonly phase: 'ready'
      readonly selection: FileSelection
      readonly buffer: ArrayBuffer
      readonly elapsedMs: number
      readonly pages: number[] | undefined
    }
  | {
      readonly phase: 'parsing'
      readonly selection: FileSelection
      readonly elapsedMs: number
      readonly current: number
      readonly total: number
    }
  | {
      readonly phase: 'done' | 'error'
      readonly selection: FileSelection
    }

// 三段计时面板状态：文件加载 / 解析 / reader document-resolution 分别测量，
// 绝不做加总；otherStages 聚合滚动加载等后续阶段的耗时（nice-to-have）。
type PdfTimingPanelState = {
  readonly fileLoadMs: number | null
  readonly parseMs: number | null
  readonly parseFailed: boolean
  readonly documentResolutionMs: number | null
  readonly otherStages: Readonly<
    Record<string, { readonly count: number; readonly totalMs: number }>
  >
}

type RetiringPdfError = {
  readonly retirement: Promise<void>
}

type RetiredViewerOwnership = {
  readonly handle: OpenDocumentHandle | null
  readonly token: ViewerLifetimeToken | null
}

const INITIAL_PDF_TIMING: PdfTimingPanelState = {
  documentResolutionMs: null,
  fileLoadMs: null,
  otherStages: {},
  parseFailed: false,
  parseMs: null
}

// 毫秒展示：null 显示占位符，极小值显示 <0.1 ms，其余保留一位小数
function formatTimingMs(value: number | null): string {
  if (value === null) return '—'
  if (value < 0.1) return '<0.1 ms'
  return `${value.toFixed(1)} ms`
}

function getPdfRetirement(error: unknown): Promise<void> | null {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('retirement' in error) ||
    !(error.retirement instanceof Promise)
  ) {
    return null
  }

  return (error as RetiringPdfError).retirement
}

function reportLifecycleError(error: unknown): void {
  console.error('PDF viewer lifecycle cleanup failed', error)
}

type HighlightDragPreview = {
  readonly highlight: ReaderSelectionRange
  readonly pointerId: number
  readonly x: number
  readonly y: number
}

type PrimaryPointer = Omit<HighlightDragPreview, 'highlight'>

export const SUPPORTED_FILE_TYPE_LABEL =
  'PDF, TXT, DOCX, EPUB, Markdown, Images'

export const UNSUPPORTED_FILE_TYPE_MESSAGE =
  'Unsupported file type. Supported: PDF, TXT, DOCX, EPUB, Markdown, and images.'

export type SupportedParserLabel =
  | 'PDF'
  | 'TXT'
  | 'DOCX'
  | 'EPUB'
  | 'Markdown'
  | 'Image'

const FONT_SCALABLE_PARSER_LABELS: ReadonlySet<SupportedParserLabel> = new Set([
  'PDF',
  'TXT',
  'EPUB',
  'Markdown'
])

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
  file: File
): Promise<ParseUploadedDocumentResult> {
  switch (getFileExtension(file.name)) {
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
    case 'epub':
      try {
        const epubDocument = await EpubParser.encode(file)
        const document = await convertEpubDocumentForReader(epubDocument, file)
        return { status: 'parsed', label: 'EPUB', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'EPUB',
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
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'svg':
      try {
        const document = await createImagePreviewDocument(file)
        return { status: 'parsed', label: 'Image', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'Image',
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

const BOOKMARK_STORAGE_PREFIX = 'hamster-reader-demo:bookmarks:'
const OCR_STORAGE_PREFIX = 'hamster-reader-demo:ocr:'
const TEXT_READING_PROGRESS_STORAGE_PREFIX =
  'hamster-reader-demo:text-reading-progress:'
const LAYOUT_READING_PROGRESS_STORAGE_PREFIX =
  'hamster-reader-demo:layout-reading-progress:'
const READER_PREFERENCES_STORAGE_PREFIX = 'hamster-reader-demo:preferences:'
const DEMO_READER_COLORS = [
  { name: 'blue', color: '#7d9ec0' },
  { name: 'green', color: '#8eba8e' },
  { name: 'sand', color: '#d1b88a' },
  { name: 'rose', color: '#cf9cab' },
  { name: 'lavender', color: '#a99fc4' },
  { name: 'black', color: '#2a2a2a' }
] as const satisfies readonly ReaderColorOption[]

type OcrTextsByPage = Record<number, IntermediateText[]>

function parseStoredTextAnchor(value: unknown): ReaderTextAnchor | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('pageNumber' in value) ||
    !('textId' in value) ||
    !('text' in value) ||
    !('offset' in value)
  ) {
    return undefined
  }

  const { pageNumber, textId, text, offset } = value
  if (
    typeof pageNumber !== 'number' ||
    !Number.isInteger(pageNumber) ||
    pageNumber <= 0 ||
    typeof textId !== 'string' ||
    typeof text !== 'string' ||
    typeof offset !== 'number' ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    return undefined
  }

  return { pageNumber, textId, text, offset }
}

function parseStoredBookmark(value: unknown): ReaderBookmark | undefined {
  const textAnchor = parseStoredTextAnchor(value)
  if (textAnchor) return textAnchor
  if (
    typeof value !== 'object' ||
    value === null ||
    !('pageNumber' in value) ||
    !('verticalPercentage' in value)
  ) {
    return undefined
  }

  const { pageNumber, verticalPercentage } = value
  if (
    typeof pageNumber !== 'number' ||
    !Number.isInteger(pageNumber) ||
    pageNumber <= 0 ||
    typeof verticalPercentage !== 'number' ||
    !Number.isFinite(verticalPercentage) ||
    verticalPercentage < 0 ||
    verticalPercentage > 100
  ) {
    return undefined
  }
  return { pageNumber, verticalPercentage }
}

function getStoredBookmarkKey(bookmark: ReaderBookmark): string {
  return 'textId' in bookmark
    ? `${bookmark.pageNumber}:${bookmark.textId}:${bookmark.offset}`
    : `page:${bookmark.pageNumber}:${bookmark.verticalPercentage}`
}

function parseStoredBookmarks(raw: string | null): ReaderBookmark[] {
  if (raw === null || raw.trim() === '') return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const bookmarksByKey = new Map<string, ReaderBookmark>()
    for (const value of parsed) {
      const bookmark = parseStoredBookmark(value)
      if (!bookmark) continue

      const key = getStoredBookmarkKey(bookmark)
      bookmarksByKey.set(key, bookmark)
    }

    return Array.from(bookmarksByKey.values()).sort(
      (left, right) =>
        left.pageNumber - right.pageNumber ||
        getStoredBookmarkKey(left).localeCompare(getStoredBookmarkKey(right))
    )
  } catch {
    return []
  }
}

function parseStoredTextReadingProgress(
  raw: string | null
): ReaderTextReadingProgress | undefined {
  if (raw === null || raw.trim() === '') return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('currentPageNumber' in parsed)
    ) {
      return undefined
    }

    const { currentPageNumber } = parsed
    if (
      typeof currentPageNumber !== 'number' ||
      !Number.isInteger(currentPageNumber) ||
      currentPageNumber <= 0
    ) {
      return undefined
    }

    const anchor =
      'anchor' in parsed ? parseStoredTextAnchor(parsed.anchor) : undefined
    return anchor?.pageNumber === currentPageNumber
      ? { currentPageNumber, anchor }
      : { currentPageNumber }
  } catch {
    return undefined
  }
}

function parseStoredLayoutReadingProgress(
  raw: string | null
): ReaderBookmark | undefined {
  if (raw === null || raw.trim() === '') return undefined

  try {
    return parseStoredBookmark(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function persistHighlights(
  fileName: string | undefined,
  ranges: ReaderSelectionRange[],
  rects: ReaderSelectionRectangle[],
  paintings: Record<string, DrawingValue>
) {
  if (!fileName) return
  const persisted = parseHighlights(
    serializeHighlights(ranges, rects, paintings)
  )
  traceHighlight('demo.storage.write', {
    fileName,
    ranges: summarizeHighlightRanges(Array.from(persisted.ranges))
  })
  localStorage.setItem(
    `hamster-reader-demo:highlights:${fileName}`,
    serializeHighlights(
      Array.from(persisted.ranges),
      Array.from(persisted.rects),
      persisted.paintings
    )
  )
}

function useAnnotationHistoryShortcuts(
  selectionRef: React.RefObject<ReaderSelectionRef | null>
) {
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
      if (!isUndo && !isRedo) return

      event.preventDefault()
      if (isUndo) selectionRef.current?.undo()
      else selectionRef.current?.redo()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectionRef])
}

function useHighlightDragTracking(
  isHighlightDragging: boolean,
  setHighlightDragPreview: React.Dispatch<
    React.SetStateAction<HighlightDragPreview | null>
  >
) {
  useEffect(() => {
    if (!isHighlightDragging) return

    const handlePointerMove = (event: PointerEvent) => {
      setHighlightDragPreview((current) =>
        current?.pointerId === event.pointerId
          ? { ...current, x: event.clientX, y: event.clientY }
          : current
      )
    }
    const handlePointerEnd = (event: PointerEvent) => {
      setHighlightDragPreview((current) =>
        current?.pointerId === event.pointerId ? null : current
      )
    }

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerEnd, true)
    window.addEventListener('pointercancel', handlePointerEnd, true)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerEnd, true)
      window.removeEventListener('pointercancel', handlePointerEnd, true)
    }
  }, [isHighlightDragging, setHighlightDragPreview])
}

function trackPrimaryPointer(
  event: React.PointerEvent<HTMLElement>,
  pointerRef: React.MutableRefObject<PrimaryPointer | null>
) {
  if (!event.isPrimary) return
  pointerRef.current = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY
  }
}

function ParseStatus({
  isParsing,
  parseError,
  pdfLoadState,
  timing,
  onLoadPdf
}: {
  readonly isParsing: boolean
  readonly parseError: string | null
  readonly pdfLoadState: PdfLoadState
  readonly timing: PdfTimingPanelState
  readonly onLoadPdf: () => void
}) {
  return (
    <>
      <section
        data-testid='pdf-timing-panel'
        style={{
          marginBottom: '24px',
          padding: '12px 16px',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          background: '#fff',
          fontSize: '13px'
        }}
      >
        <h2 style={{ marginTop: 0 }}>计时面板</h2>
        <p style={{ margin: '0 0 8px', color: '#64748b' }}>
          三段独立测量，含义不同，不做加总
        </p>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '4px 12px',
            margin: 0
          }}
        >
          <dt>① 文件加载</dt>
          <dd data-testid='pdf-timing-file-load' style={{ margin: 0 }}>
            {formatTimingMs(timing.fileLoadMs)}
          </dd>
          <dt>② 解析（openDocument）</dt>
          <dd data-testid='pdf-timing-parse' style={{ margin: 0 }}>
            {timing.parseFailed ? '解析失败' : formatTimingMs(timing.parseMs)}
          </dd>
          <dt>③ reader document-resolution</dt>
          <dd
            data-testid='pdf-timing-document-resolution'
            style={{ margin: 0 }}
          >
            {formatTimingMs(timing.documentResolutionMs)}
          </dd>
        </dl>
        {Object.keys(timing.otherStages).length > 0 && (
          <ul
            style={{ margin: '8px 0 0', paddingLeft: '16px', color: '#64748b' }}
          >
            {Object.entries(timing.otherStages).map(([stage, aggregate]) => (
              <li key={stage} data-testid={`pdf-timing-extra-${stage}`}>
                {stage}：平均 {(aggregate.totalMs / aggregate.count).toFixed(1)}{' '}
                ms（{aggregate.count} 次）
              </li>
            ))}
          </ul>
        )}
      </section>
      {isParsing && (
        <section style={{ marginBottom: '24px' }}>
          <h2>Parsing...</h2>
          <p>Loading file content...</p>
        </section>
      )}
      {pdfLoadState.phase === 'ready' && (
        <section
          data-testid='pdf-ready-card'
          style={{
            marginBottom: '24px',
            padding: '16px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            background: '#fff'
          }}
        >
          <h2>待加载</h2>
          <p>文件：{pdfLoadState.selection.file.name}</p>
          <p>大小：{pdfLoadState.selection.file.size} bytes</p>
          <p>读取耗时：{pdfLoadState.elapsedMs.toFixed(1)} ms</p>
          <button
            type='button'
            onClick={onLoadPdf}
            style={{
              padding: '8px 16px',
              border: '1px solid #2563eb',
              borderRadius: '4px',
              background: '#2563eb',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            加载文件
          </button>
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
    </>
  )
}

function EmptyState({
  document,
  parseError,
  isParsing
}: {
  readonly document: ReaderDocument | null
  readonly parseError: string | null
  readonly isParsing: boolean
}) {
  if (document || parseError || isParsing) return null
  return <div data-testid='demo-empty-state' style={{ display: 'none' }} />
}

function LoadedPagesStatus({
  document,
  pageNumbers
}: {
  readonly document: ReaderDocument | null
  readonly pageNumbers: readonly number[]
}) {
  if (!document) return null

  return (
    <section style={{ marginBottom: '24px' }}>
      <h2>已加载页面 ({pageNumbers.length})</h2>
      <div style={{ fontSize: '12px', color: '#64748b' }}>
        已加载: {pageNumbers.length > 0 ? pageNumbers.join(', ') : '无'}
      </div>
    </section>
  )
}

function ReadingProgressStatus({
  document,
  renderMode,
  layoutReadingProgress,
  textReadingProgress
}: {
  readonly document: ReaderDocument | null
  readonly renderMode: ReaderRenderMode
  readonly layoutReadingProgress: ReaderBookmark | undefined
  readonly textReadingProgress: ReaderTextReadingProgress | undefined
}) {
  if (!document) return null

  const progress =
    renderMode === 'layout'
      ? layoutReadingProgress
      : textReadingProgress?.anchor
  const pageNumber =
    progress?.pageNumber ?? textReadingProgress?.currentPageNumber
  let detail = '尚未保存'
  if (progress && 'textId' in progress) {
    const normalizedText = progress.text.replace(/\s+/g, ' ').trim()
    const textPreview =
      normalizedText.length > 84
        ? `${normalizedText.slice(0, 84).trimEnd()}…`
        : normalizedText
    detail = `第 ${progress.pageNumber} 页 · ${textPreview} · 偏移 ${progress.offset}`
  } else if (progress) {
    detail = `第 ${progress.pageNumber} 页 · ${progress.verticalPercentage}%`
  } else if (pageNumber !== undefined) {
    detail = `第 ${pageNumber} 页`
  }

  return (
    <section
      data-testid='demo-reading-progress-status'
      style={{ marginBottom: '24px' }}
    >
      <h2>最后保存的阅读进度</h2>
      <div style={{ fontSize: '12px', color: '#64748b' }}>{detail}</div>
    </section>
  )
}

function RecentFileStatus({
  file,
  isParsing,
  isSaved,
  onForget
}: {
  readonly file: File | null
  readonly isParsing: boolean
  readonly isSaved: boolean
  readonly onForget: () => void
}) {
  if (!file || isParsing) return null

  return (
    <section style={{ marginBottom: '24px' }}>
      <h2>Last Uploaded File</h2>
      <p>Name: {file.name}</p>
      <p>Size: {file.size} bytes</p>
      <p>Type: {file.type}</p>
      <p style={{ fontSize: '12px', color: '#64748b' }}>
        The last successful file is stored in this browser.
      </p>
      <button
        type='button'
        disabled={!isSaved}
        onClick={onForget}
        style={{
          padding: '4px 8px',
          fontSize: '12px',
          cursor: isSaved ? 'pointer' : 'not-allowed'
        }}
      >
        Forget saved file
      </button>
    </section>
  )
}

function AnnotationHistoryControls({
  document,
  status,
  onUndo,
  onRedo
}: {
  readonly document: ReaderDocument | null
  readonly status: ReaderAnnotationHistoryStatus
  readonly onUndo: () => void
  readonly onRedo: () => void
}) {
  if (!document) return null

  return (
    <section style={{ marginBottom: '24px' }}>
      <h2>Undo / Redo</h2>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type='button'
          onClick={onUndo}
          disabled={!status.canUndo}
          data-testid='undo-btn'
          style={{
            padding: '4px 12px',
            fontSize: '13px',
            cursor: status.canUndo ? 'pointer' : 'not-allowed',
            border: '1px solid #ccc',
            borderRadius: '4px',
            background: status.canUndo ? '#fff' : '#f5f5f5',
            opacity: status.canUndo ? 1 : 0.6
          }}
        >
          撤销 Undo
        </button>
        <button
          type='button'
          onClick={onRedo}
          disabled={!status.canRedo}
          data-testid='redo-btn'
          style={{
            padding: '4px 12px',
            fontSize: '13px',
            cursor: status.canRedo ? 'pointer' : 'not-allowed',
            border: '1px solid #ccc',
            borderRadius: '4px',
            background: status.canRedo ? '#fff' : '#f5f5f5',
            opacity: status.canRedo ? 1 : 0.6
          }}
        >
          重做 Redo
        </button>
      </div>
    </section>
  )
}

function getDocumentPageCount(document: ReaderDocument | null): number {
  if (!document) return 0
  const serialized = document as IntermediateDocumentSerialized
  if (Array.isArray(serialized.pages)) return serialized.pages.length
  return (document as IntermediateDocument).pageCount
}

function parserSupportsFontScale(
  parserLabel: SupportedParserLabel | null
): boolean {
  return parserLabel !== null && FONT_SCALABLE_PARSER_LABELS.has(parserLabel)
}

function getPageRange(
  enabled: boolean,
  start: number,
  end: number
): ReaderPageRange | undefined {
  return enabled ? { start, end } : undefined
}

function getParserPages(
  range: ReaderPageRange | undefined
): number[] | undefined {
  if (!range) return undefined

  const start = Math.trunc(range.start)
  const end = Math.trunc(range.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return undefined
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function useEdgeCropState() {
  const [all, setAll] = useState<ReaderEdgeCrop | undefined>(undefined)
  const [pages, setPages] = useState<
    Record<string, ReaderEdgeCrop> | undefined
  >(undefined)
  const [isEditing, setIsEditing] = useState(false)
  const apply = useCallback(
    (pageNumber: number | null, crop: ReaderEdgeCrop) => {
      if (pageNumber === null) {
        setAll(crop)
      } else {
        setPages((current) => ({
          ...current,
          [`page-${pageNumber}`]: crop
        }))
      }
      setIsEditing(false)
    },
    []
  )

  return { all, pages, isEditing, setAll, setPages, setIsEditing, apply }
}

// ---------------------------------------------------------------------------
// App 组件
// ---------------------------------------------------------------------------

export function App() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [stagedFile, setStagedFile] = useState<File | null>(null)
  const [document, setDocument] = useState<
    IntermediateDocument | IntermediateDocumentSerialized | null
  >(null)
  const [loadedParserLabel, setLoadedParserLabel] =
    useState<SupportedParserLabel | null>(null)
  const [textFontScale, setTextFontScale] = useState<ReaderFontScale>(1.5)
  const [layoutFontScale, setLayoutFontScale] = useState<ReaderFontScale>(1.5)
  const [isParsing, setIsParsing] = useState(false)
  const [pdfLoadState, setPdfLoadState] = useState<PdfLoadState>({
    phase: 'idle'
  })
  // 三段计时面板：state 驱动 UI，ref 供异步回调读取最新值（避免闭包过期）
  const [pdfTiming, setPdfTiming] =
    useState<PdfTimingPanelState>(INITIAL_PDF_TIMING)
  const pdfTimingRef = useRef<PdfTimingPanelState>(INITIAL_PDF_TIMING)
  // 额外阶段的聚合只进 ref，经防抖/首段落盘时才同步进 state——
  // 否则 Profiler onRender 派生的条目会造成 setState → 提交 → 新条目 的循环
  const extraTimingStagesRef = useRef<
    Record<string, { count: number; totalMs: number }>
  >({})
  const extraTimingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const [parseError, setParseError] = useState<string | null>(null)
  const [hasSavedRecentFile, setHasSavedRecentFile] = useState(false)
  const [pageRangeStart, setPageRangeStart] = useState<number>(1)
  const [pageRangeEnd, setPageRangeEnd] = useState<number>(3)
  const [usePageRange, setUsePageRange] = useState<boolean>(false)
  // --- OCR 受控演示 state ---
  const [automaticOcrEnabled, setAutomaticOcrEnabled] = useState(false)
  // ocrPages：已开启 OCR 的页码列表（传给 Reader 的 ocr.pages，移除即按页关闭）
  const [ocrPages, setOcrPages] = useState<number[]>([])
  // ocrTextsByPage：受控 OCR 数据，OCR 完成后由 onOcrTextsChange 回传并持久化
  const [ocrTextsByPage, setOcrTextsByPage] = useState<OcrTextsByPage>({})
  const [ocrPageInput, setOcrPageInput] = useState<string>('1')
  const [ocrError, setOcrError] = useState<string | null>(null)
  // ocrDevMode：OCR 开发调试模式开关，开启后 OCR 文字可见（黑色 50%）并加红色外框
  const [ocrDevMode, setOcrDevMode] = useState<boolean>(false)
  const [renderMode, setRenderMode] = useState<ReaderRenderMode>('layout')
  const [useVirtualPaper, setUseVirtualPaper] = useState(false)
  const [touchPanMode, setTouchPanMode] =
    useState<ReaderTouchPanMode>('single-finger')
  const [autoHighlight, setAutoHighlight] = useState(false)
  const [dictionaryMockEnabled, setDictionaryMockEnabled] = useState(false)
  const [dictionaryInitialWord, setDictionaryInitialWord] = useState<
    string | undefined
  >(undefined)
  const [showPageBrowser, setShowPageBrowser] = useState(false)
  const [bookmarks, setBookmarks] = useState<readonly ReaderBookmark[]>([])
  const [themeColor, setThemeColor] = useState('#2563eb')
  const [highlightColor, setHighlightColor] = useState(
    'rgba(255, 193, 7, 0.35)'
  )
  const [toolColor, setToolColor] = useState('#7d9ec0')
  const [containMarginX, setContainMarginX] = useState<number>(0)
  const [containMarginTop, setContainMarginTop] = useState<number>(0)
  const [containMarginBottom, setContainMarginBottom] = useState<number>(0)
  const {
    all: edgeCropAll,
    pages: edgeCropPages,
    isEditing: edgeCropEditing,
    setAll: setEdgeCropAll,
    setPages: setEdgeCropPages,
    setIsEditing: setEdgeCropEditing,
    apply: handleEdgeCropApply
  } = useEdgeCropState()
  const [hiddenPages, setHiddenPages] = useState<readonly (number | string)[]>(
    []
  )
  const [scrollX, setScrollX] = useState<number>(0)
  const [scrollY, setScrollY] = useState<number>(0)
  const [virtualPaper, setVirtualPaper] = useState<ReaderVirtualPaperState>({
    x: 0,
    y: 0,
    scale: 1
  })
  const [textReadingProgress, setTextReadingProgress] = useState<
    ReaderTextReadingProgress | undefined
  >(undefined)
  const selectionEpochRef = useRef<FileSelection | null>(null)
  const selectionAbortControllerRef = useRef<AbortController | null>(null)
  const openDocumentHandleRef = useRef<OpenDocumentHandle | null>(null)
  const [viewerLifetimeToken, setViewerLifetimeToken] =
    useState<ViewerLifetimeToken | null>(null)
  const viewerLifetimeTokenRef = useRef<ViewerLifetimeToken | null>(null)
  const mountedRef = useRef(false)
  const lifecycleGenerationRef = useRef(0)
  const terminalEnqueuedRef = useRef(false)
  const switchBarrierRef = useRef<Promise<void>>(Promise.resolve())
  const pdfRetirementRef = useRef<Promise<void>>(Promise.resolve())
  const recentFilePersistenceChainRef = useRef<Promise<void>>(Promise.resolve())
  const [layoutReadingProgress, setLayoutReadingProgress] = useState<
    ReaderBookmark | undefined
  >(undefined)
  const loadedReaderPreferencesFileNameRef = useRef<string | null>(null)

  // --- Selection 库集成演示 state ---
  // ranges 列表：受控模式，Reader 内部不修改，由 onSelect 回调外部追加
  const [ranges, setRanges] = useState<ReaderSelectionRange[]>([])
  useEffect(() => {
    traceHighlight('mode.render', {
      mode: renderMode,
      isEpub: loadedParserLabel === 'EPUB',
      fileName: uploadedFile?.name ?? null,
      ranges: summarizeHighlightRanges(ranges)
    })
  }, [loadedParserLabel, ranges, renderMode, uploadedFile?.name])
  const [highlightDragPreview, setHighlightDragPreview] =
    useState<HighlightDragPreview | null>(null)
  const latestPrimaryPointerRef = useRef<PrimaryPointer | null>(null)
  // 当前选中的 range ID（点击高亮列表项时切换）
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  const [selectedTool, setSelectedTool] =
    useState<ReaderPageTool>('text-selection')
  const [pagePaintings, setPagePaintings] = useState<
    Record<string, DrawingValue>
  >({})
  const [loadedPages, setLoadedPages] = useState<number[]>([])
  const [rects, setRects] = useState<ReaderSelectionRectangle[]>([])
  const [selectedRectId, setSelectedRectId] = useState<string | null>(null)
  const [comments, setComments] = useState<ReaderComment[]>([])
  const readerData = useMemo<ReaderData>(
    () => ({
      edgeCrop: {
        all: edgeCropAll,
        pages: edgeCropPages
      },
      hiddenPages,
      ranges,
      rects,
      pagePaintings,
      virtualPaper,
      layoutReadingProgress,
      textReadingProgress,
      bookmarks,
      renderMode,
      selectedTool
    }),
    [
      bookmarks,
      edgeCropAll,
      edgeCropPages,
      hiddenPages,
      layoutReadingProgress,
      pagePaintings,
      ranges,
      rects,
      renderMode,
      selectedTool,
      textReadingProgress,
      virtualPaper
    ]
  )
  const handleReaderDataChange = useCallback(
    (nextData: ReaderData) => {
      if (nextData.renderMode) {
        setRenderMode(nextData.renderMode)
      }

      if (nextData.selectedTool) {
        setSelectedTool(nextData.selectedTool)
        setSelectedRangeId(null)
        setSelectedRectId(null)
      }

      if (nextData.virtualPaper) {
        setVirtualPaper(nextData.virtualPaper)
      }

      if (nextData.textReadingProgress) {
        setTextReadingProgress(nextData.textReadingProgress)
        if (uploadedFile?.name) {
          localStorage.setItem(
            `${TEXT_READING_PROGRESS_STORAGE_PREFIX}${uploadedFile.name}`,
            JSON.stringify(nextData.textReadingProgress)
          )
        }
      }

      if (nextData.layoutReadingProgress) {
        setLayoutReadingProgress(nextData.layoutReadingProgress)
        if (uploadedFile?.name) {
          localStorage.setItem(
            `${LAYOUT_READING_PROGRESS_STORAGE_PREFIX}${uploadedFile.name}`,
            JSON.stringify(nextData.layoutReadingProgress)
          )
        }
      }

      if (nextData.bookmarks) {
        setBookmarks(nextData.bookmarks)
        if (uploadedFile?.name) {
          localStorage.setItem(
            `${BOOKMARK_STORAGE_PREFIX}${uploadedFile.name}`,
            JSON.stringify(nextData.bookmarks)
          )
        }
      }

      if (nextData.hiddenPages) {
        setHiddenPages(nextData.hiddenPages)
      }
    },
    [uploadedFile?.name]
  )
  // 评论面板开关状态 + 当前激活的高亮 ID（用于自动勾选评论绑定）
  const [isCommentPanelOpen, setIsCommentPanelOpen] = useState(false)
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null
  )
  // 只有当前文件成功恢复评论后，持久化 effect 才允许写入，避免解析期间覆盖旧数据。
  const loadedCommentsFileNameRef = useRef<string | null>(null)
  // OCR 持久化同理：仅当当前文件的 OCR 数据完成恢复后才允许写回
  const loadedOcrFileNameRef = useRef<string | null>(null)
  const selectionRef = useRef<ReaderSelectionRef>(null)
  useAnnotationHistoryShortcuts(selectionRef)

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
      detail: AnnotationHistoryChangeDetail
    ) => {
      traceHighlight('demo.history.change', {
        mode: renderMode,
        isEpub: loadedParserLabel === 'EPUB',
        source: detail.source,
        stateOwner: true,
        selectedRangeId: next.selectedRangeId,
        ranges: summarizeHighlightRanges(next.ranges)
      })
      setRanges(next.ranges as ReaderSelectionRange[])
      setRects(next.rects as ReaderSelectionRectangle[])
      setSelectedRangeId(next.selectedRangeId)
      setSelectedRectId(next.selectedRectId)
      setHistoryStatus(detail.status)
      if (detail.source !== 'reset') {
        persistHighlights(
          uploadedFile?.name,
          next.ranges as ReaderSelectionRange[],
          next.rects as ReaderSelectionRectangle[],
          pagePaintings
        )
      }
    },
    [loadedParserLabel, pagePaintings, renderMode, uploadedFile?.name]
  )

  // onSelect 回调：点击高亮按钮后输出高亮数据到控制台
  const handleSelectionSelect = useCallback(
    (range: ReaderSelectionRange) => {
      traceHighlight('demo.callback.select', {
        mode: renderMode,
        isEpub: loadedParserLabel === 'EPUB',
        ranges: summarizeHighlightRanges([range])
      })
    },
    [loadedParserLabel, renderMode]
  )

  const handleHighlight = useCallback(
    (range: ReaderSelectionRange) => {
      traceHighlight('demo.callback.highlight', {
        mode: renderMode,
        isEpub: loadedParserLabel === 'EPUB',
        stateOwner: renderMode === 'text',
        ranges: summarizeHighlightRanges([range])
      })
      if (renderMode !== 'text') return

      setRanges((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === range.id)
        const nextRanges =
          existingIndex === -1
            ? [...prev, range]
            : prev.map((item) => (item.id === range.id ? range : item))
        persistHighlights(uploadedFile?.name, nextRanges, rects, pagePaintings)
        return nextRanges
      })
      setSelectedRangeId(range.id)
    },
    [loadedParserLabel, pagePaintings, rects, renderMode, uploadedFile?.name]
  )

  const handleLinkedDataChange = useCallback(
    (next: ReaderLinkedSelectionData) => {
      traceHighlight('demo.callback.linked-data', {
        mode: renderMode,
        isEpub: loadedParserLabel === 'EPUB',
        stateOwner: renderMode === 'text',
        selectedRangeId: next.selectedRangeId,
        ranges: summarizeHighlightRanges(next.items)
      })
      if (renderMode !== 'text') return

      setRanges(next.items)
      setSelectedRangeId(next.selectedRangeId)
      persistHighlights(uploadedFile?.name, next.items, rects, pagePaintings)
    },
    [loadedParserLabel, pagePaintings, rects, renderMode, uploadedFile?.name]
  )

  const handleDragHighlight = useCallback((highlight: ReaderSelectionRange) => {
    const pointer = latestPrimaryPointerRef.current
    if (pointer === null) return

    setHighlightDragPreview({ highlight, ...pointer })
  }, [])

  const isHighlightDragging = highlightDragPreview !== null
  useHighlightDragTracking(isHighlightDragging, setHighlightDragPreview)

  const handleSelectionEnd = useCallback(() => {}, [])

  // 工具切换：底部栏与设置面板 select 共用；
  // 切换工具时仅重置 selectedRangeId/selectedRectId 选中态，不清除标注数据本身。
  const handleToolChange = useCallback((nextTool: ReaderPageTool) => {
    setSelectedTool(nextTool)
    setSelectedRangeId(null)
    setSelectedRectId(null)
  }, [])

  // onSelectRange 回调：用户点击已有 range 时触发（selection-only，不创建 checkpoint）
  const handleSelectRange = useCallback((id: string | null) => {
    setSelectedRangeId(id)
    // 文字选择和矩形选择互斥
    if (id !== null) {
      setSelectedRectId(null)
    }
  }, [])

  // onUpdateRange 回调：默认 Popover 的颜色选择器会直接调用此回调更新当前 range。
  // 由于该调用不经过 library history 路径，这里直接更新 ranges 并持久化。
  const handleUpdateRange = useCallback(
    (range: ReaderSelectionRange) => {
      setRanges((prev) => {
        const newRanges = prev.map((r) => (r.id === range.id ? range : r))
        persistHighlights(uploadedFile?.name, newRanges, rects, pagePaintings)
        return newRanges
      })
    },
    [rects, pagePaintings, uploadedFile?.name]
  )

  // onCommentHighlight：立即 resolve Promise 让 Reader 关闭 popover，
  // 同时打开 CommentPanel 并设置 activeHighlightId（自动勾选评论绑定）
  const handleCommentHighlight = useCallback(
    (highlight: ReaderSelectionRange) => {
      setActiveHighlightId(highlight.id)
      setIsCommentPanelOpen(true)
      return Promise.resolve(highlight)
    },
    []
  )

  // CommentPanel 的高亮跳转回调：滚动到指定 range
  const handleJumpToHighlight = useCallback((highlightId: string) => {
    selectionRef.current?.scrollToRange(highlightId)
  }, [])

  // CommentPanel 关闭回调
  const handleCloseCommentPanel = useCallback(() => {
    setIsCommentPanelOpen(false)
    setActiveHighlightId(null)
  }, [])

  const handleCommentsChange = useCallback((next: readonly ReaderComment[]) => {
    setComments(Array.from(next))
  }, [])

  // 评论数据持久化：随 comments 变化写入 localStorage
  useEffect(() => {
    const loadedFileName = loadedCommentsFileNameRef.current
    if (!loadedFileName) return

    localStorage.setItem(
      `hamster-reader-demo:comments:${loadedFileName}`,
      serializeComments(comments)
    )
  }, [comments])

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
        persistHighlights(uploadedFile?.name, ranges, newRects, pagePaintings)
        return newRects
      })
      if (selectedRectId === id) {
        setSelectedRectId(null)
      }
    },
    [ranges, pagePaintings, selectedRectId, uploadedFile?.name]
  )

  // 清空全部：通过 selectionRef.current?.clear() 触发 library 的 clear 命令，
  // library 会创建 checkpoint 并通过 onAnnotationHistoryChange 回传空快照。
  const handleClearAllRanges = useCallback(() => {
    selectionRef.current?.clear()
    setComments([])
    setIsCommentPanelOpen(false)
    setActiveHighlightId(null)
  }, [])

  const handleRemoveRange = useCallback(
    (id: string) => {
      setRanges((prev) => {
        const newRanges = prev.filter((r) => r.id !== id)
        persistHighlights(uploadedFile?.name, newRanges, rects, pagePaintings)
        return newRanges
      })
      setComments((prev) => removeHighlightFromComments(prev, id))
      if (selectedRangeId === id) {
        setSelectedRangeId(null)
      }
      if (activeHighlightId === id) {
        setActiveHighlightId(null)
      }
    },
    [
      rects,
      pagePaintings,
      selectedRangeId,
      activeHighlightId,
      uploadedFile?.name
    ]
  )

  // 包装 setPagePaintings：pagePaintings 不走 annotation history，需独立持久化。
  const handlePagePaintingsChange = useCallback(
    (next: Record<string, DrawingValue>) => {
      setPagePaintings(next)
      persistHighlights(uploadedFile?.name, ranges, rects, next)
    },
    [ranges, rects, uploadedFile?.name]
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

  // 当前文档页数（兼容 serialized pages 数组与运行时 pageCount）
  const documentPageCount = getDocumentPageCount(document)

  // 点击「OCR」按钮：校验页码后加入 ocrPages，Reader 会对该页发起识别
  const handleStartOcr = useCallback(() => {
    const page = Number(ocrPageInput)
    if (!Number.isInteger(page) || page <= 0) {
      setOcrError('请输入有效的页码（正整数）')
      return
    }
    if (documentPageCount > 0 && page > documentPageCount) {
      setOcrError(`页码超出范围（当前文档共 ${documentPageCount} 页）`)
      return
    }
    setOcrError(null)
    setAutomaticOcrEnabled(false)
    setOcrPages((current) =>
      current.includes(page)
        ? current
        : [...current, page].sort((left, right) => left - right)
    )
  }, [ocrPageInput, documentPageCount])

  // 按页关闭 OCR：仅从开启列表移除；已识别数据保留，重新开启时无需重复 OCR
  const handleCloseOcrPage = useCallback((page: number) => {
    setAutomaticOcrEnabled(false)
    setOcrPages((current) => current.filter((item) => item !== page))
  }, [])

  // 全局关闭：清空开启列表，文档内所有 OCR 文本层隐藏（数据同样保留）
  const handleCloseAllOcr = useCallback(() => {
    setAutomaticOcrEnabled(false)
    setOcrPages([])
  }, [])

  const handleOcrChange = useCallback((enabled: boolean) => {
    setOcrPages([])
    setAutomaticOcrEnabled(enabled)
  }, [])

  // Reader OCR 完成回调：写入受控 state（持久化 effect 会同步到 localStorage）
  const handleOcrTextsChange = useCallback(
    (pageNumber: number, texts: IntermediateText[]) => {
      setOcrTextsByPage((current) => ({ ...current, [pageNumber]: texts }))
    },
    []
  )

  const handleOcrError = useCallback(
    (error: unknown, detail: { pageNumber: number }) => {
      setOcrError(
        `第 ${detail.pageNumber} 页 OCR 失败：${getParserErrorMessage(error)}`
      )
    },
    []
  )

  useEffect(() => {
    const loadedFileName = loadedOcrFileNameRef.current
    if (!loadedFileName) return

    let mode: DemoOcrMode = ocrPages.length > 0 ? 'manual' : 'off'
    if (automaticOcrEnabled) {
      mode = 'automatic'
    }
    localStorage.setItem(
      `${OCR_STORAGE_PREFIX}${loadedFileName}`,
      serializeOcrStorage({
        mode,
        pages: ocrPages,
        textsByPage: ocrTextsByPage
      })
    )
  }, [automaticOcrEnabled, ocrPages, ocrTextsByPage])

  useEffect(() => {
    const loadedFileName = loadedReaderPreferencesFileNameRef.current
    if (!loadedFileName) return

    localStorage.setItem(
      `${READER_PREFERENCES_STORAGE_PREFIX}${loadedFileName}`,
      serializeReaderPreferences({
        renderMode,
        selectedTool,
        textFontScale,
        layoutFontScale,
        highlightColor
      })
    )
  }, [highlightColor, layoutFontScale, renderMode, selectedTool, textFontScale])

  const handleUndo = useCallback(() => {
    selectionRef.current?.undo()
  }, [])

  const handleRedo = useCallback(() => {
    selectionRef.current?.redo()
  }, [])

  const handleRenderModeChange = useCallback(
    (nextRenderMode: ReaderRenderMode) => {
      setRenderMode(nextRenderMode)
      if (nextRenderMode === 'text') {
        setEdgeCropEditing(false)
      }
    },
    [setEdgeCropEditing]
  )

  const isCurrentSelection = useCallback((selection: FileSelection) => {
    return (
      mountedRef.current && selectionEpochRef.current?.epoch === selection.epoch
    )
  }, [])

  const disposeRetiredViewer = useCallback(
    async ({ handle, token }: RetiredViewerOwnership) => {
      if (handle === null) return
      if (token?.mounted) await token.ack
      await handle.dispose()
    },
    []
  )

  const appendSwitchBarrier = useCallback(
    (selection: FileSelection): Promise<void> => {
      const runBarrier = async () => {
        if (!mountedRef.current) return

        let retired: RetiredViewerOwnership = { handle: null, token: null }
        flushSync(() => {
          retired = {
            handle: openDocumentHandleRef.current,
            token: viewerLifetimeTokenRef.current
          }
          openDocumentHandleRef.current = null
          viewerLifetimeTokenRef.current = null
          setViewerLifetimeToken(null)
          setDocument(null)
          setLoadedParserLabel(null)
        })

        try {
          await disposeRetiredViewer(retired)
        } catch (error) {
          reportLifecycleError(error)
        }

        if (!isCurrentSelection(selection)) return
      }

      const command = switchBarrierRef.current.then(runBarrier, runBarrier)
      switchBarrierRef.current = command.catch(reportLifecycleError)
      return command
    },
    [disposeRetiredViewer, isCurrentSelection]
  )

  // 计时面板的统一更新入口：同步维护 ref 与 state
  const updatePdfTiming = useCallback(
    (updater: (current: PdfTimingPanelState) => PdfTimingPanelState) => {
      const next = updater(pdfTimingRef.current)
      pdfTimingRef.current = next
      setPdfTiming(next)
    },
    []
  )

  // Reader 渲染计时回调：document-resolution 记入第三段并输出 console.table。
  // shell-rendering / page-content-rendering 由 Profiler onRender 在每次提交后发射，
  // 对其 setState 会形成「更新 → 提交 → 新条目 → 更新」循环，因此直接忽略；
  // 其余事件驱动阶段（滚动触发的 initial-page-loading 等）聚合到 ref 并防抖落盘。
  const handleIntermediateDocumentRenderTiming = useCallback(
    (entry: IntermediateDocumentRenderTimingEntry) => {
      if (entry.stage === 'document-resolution') {
        if (pdfTimingRef.current.documentResolutionMs !== null) return
        updatePdfTiming((current) => ({
          ...current,
          documentResolutionMs: entry.durationMs,
          otherStages: { ...extraTimingStagesRef.current }
        }))
        const timing = pdfTimingRef.current
        if (timing.fileLoadMs !== null && timing.parseMs !== null) {
          console.table([
            { 阶段: '① 文件加载', '耗时 (ms)': timing.fileLoadMs },
            { 阶段: '② 解析 (openDocument)', '耗时 (ms)': timing.parseMs },
            {
              阶段: '③ reader document-resolution',
              '耗时 (ms)': timing.documentResolutionMs
            }
          ])
        }
        return
      }

      if (
        entry.stage === 'shell-rendering' ||
        entry.stage === 'page-content-rendering'
      ) {
        return
      }

      const existing = extraTimingStagesRef.current[entry.stage]
      extraTimingStagesRef.current = {
        ...extraTimingStagesRef.current,
        [entry.stage]: {
          count: (existing?.count ?? 0) + 1,
          totalMs: (existing?.totalMs ?? 0) + entry.durationMs
        }
      }
      if (extraTimingFlushTimerRef.current === null) {
        extraTimingFlushTimerRef.current = setTimeout(() => {
          extraTimingFlushTimerRef.current = null
          updatePdfTiming((current) => ({
            ...current,
            otherStages: { ...extraTimingStagesRef.current }
          }))
        }, 300)
      }
    },
    [updatePdfTiming]
  )

  const commitParsedDocument = useCallback(
    (
      selection: FileSelection,
      parsedDocument: ReaderDocument,
      parserLabel: SupportedParserLabel
    ) => {
      if (!isCurrentSelection(selection)) return

      const { file } = selection
      setUploadedFile(file)
      setStagedFile(null)
      setDocument(parsedDocument)
      setLoadedParserLabel(parserLabel)
      const readerPreferences = parseReaderPreferences(
        localStorage.getItem(
          `${READER_PREFERENCES_STORAGE_PREFIX}${file.name}`
        ),
        {
          renderMode: parserLabel === 'EPUB' ? 'text' : 'layout',
          selectedTool: 'text-selection',
          textFontScale: 1.5,
          layoutFontScale: 1.5,
          highlightColor: 'rgba(255, 193, 7, 0.35)'
        }
      )
      setRenderMode(readerPreferences.renderMode)
      setSelectedTool(readerPreferences.selectedTool)
      setTextFontScale(readerPreferences.textFontScale)
      setLayoutFontScale(readerPreferences.layoutFontScale)
      setHighlightColor(readerPreferences.highlightColor)
      loadedReaderPreferencesFileNameRef.current = file.name
      setVirtualPaper({ x: 0, y: 0, scale: 1 })
      setLayoutReadingProgress(
        parseStoredLayoutReadingProgress(
          localStorage.getItem(
            `${LAYOUT_READING_PROGRESS_STORAGE_PREFIX}${file.name}`
          )
        )
      )
      setTextReadingProgress(
        parseStoredTextReadingProgress(
          localStorage.getItem(
            `${TEXT_READING_PROGRESS_STORAGE_PREFIX}${file.name}`
          )
        )
      )

      const storedHighlights = localStorage.getItem(
        `hamster-reader-demo:highlights:${file.name}`
      )
      const parsedHighlights = parseHighlights(storedHighlights)
      setRanges(Array.from(parsedHighlights.ranges))
      setRects(Array.from(parsedHighlights.rects))
      setPagePaintings(parsedHighlights.paintings)
      setBookmarks(
        parseStoredBookmarks(
          localStorage.getItem(`${BOOKMARK_STORAGE_PREFIX}${file.name}`)
        )
      )

      const storedComments = localStorage.getItem(
        `hamster-reader-demo:comments:${file.name}`
      )
      loadedCommentsFileNameRef.current = file.name
      setComments(parseComments(storedComments))

      const parsedOcr = parseOcrStorage(
        localStorage.getItem(`${OCR_STORAGE_PREFIX}${file.name}`)
      )
      loadedOcrFileNameRef.current = file.name
      setOcrPages(parsedOcr.pages)
      setAutomaticOcrEnabled(parsedOcr.mode === 'automatic')
      setOcrTextsByPage(parsedOcr.textsByPage)
      setSelectedRangeId(null)
      setSelectedRectId(null)
    },
    [isCurrentSelection]
  )

  const saveSelectedFile = useCallback(
    async (selection: FileSelection) => {
      const saveTask = recentFilePersistenceChainRef.current.then(async () => {
        if (!isCurrentSelection(selection)) return

        const saved = await saveRecentFile(selection.file)
        if (isCurrentSelection(selection)) {
          setHasSavedRecentFile(saved)
        }
      })
      recentFilePersistenceChainRef.current =
        saveTask.catch(reportLifecycleError)
      await saveTask
    },
    [isCurrentSelection]
  )

  const startPdfFileRead = useCallback(
    (
      selection: FileSelection,
      abortController: AbortController,
      pages: number[] | undefined
    ) => {
      loadFileToMemory(
        selection.file,
        (loaded, total) => {
          if (!isCurrentSelection(selection)) return
          setPdfLoadState({
            phase: 'loading',
            selection,
            loaded,
            total
          })
        },
        abortController.signal
      )
        .then((loadedFile) => {
          if (!isCurrentSelection(selection)) return
          updatePdfTiming((current) => ({
            ...current,
            fileLoadMs: loadedFile.elapsedMs
          }))
          setPdfLoadState({
            phase: 'ready',
            selection,
            buffer: loadedFile.buffer,
            elapsedMs: loadedFile.elapsedMs,
            pages
          })
        })
        .catch((error: unknown) => {
          if (!isCurrentSelection(selection)) return
          setPdfLoadState({ phase: 'error', selection })
          setParseError(`Failed to load PDF: ${getParserErrorMessage(error)}`)
        })
    },
    [isCurrentSelection, updatePdfTiming]
  )

  const startNonPdfParse = useCallback(
    async (selection: FileSelection) => {
      try {
        const result = await parseUploadedDocument(selection.file)
        if (!isCurrentSelection(selection)) return

        if (result.status === 'unsupported') {
          setParseError(result.error)
          return
        }
        if (result.status === 'failed') {
          setParseError(`Failed to parse ${result.label}: ${result.error}`)
          return
        }
        if (result.document === undefined) {
          setParseError(
            `Failed to parse ${result.label}: received undefined result`
          )
          return
        }

        await saveSelectedFile(selection)
        if (!isCurrentSelection(selection)) return
        commitParsedDocument(selection, result.document, result.label)
      } catch (error) {
        if (!isCurrentSelection(selection)) return
        setParseError(`Failed to parse file: ${getParserErrorMessage(error)}`)
      } finally {
        if (isCurrentSelection(selection)) setIsParsing(false)
      }
    },
    [commitParsedDocument, isCurrentSelection, saveSelectedFile]
  )

  const startFileSelection = useCallback(
    (file: File, source: FileSelectionSource) => {
      selectionAbortControllerRef.current?.abort()
      const selection: FileSelection = {
        epoch: (selectionEpochRef.current?.epoch ?? 0) + 1,
        file,
        source
      }
      const abortController = new AbortController()
      selectionEpochRef.current = selection
      selectionAbortControllerRef.current = abortController

      setOcrError(null)
      setParseError(null)
      setStagedFile(file)
      // 新选择开始时重置三段计时与额外阶段聚合，旧文件的耗时不再保留
      extraTimingStagesRef.current = {}
      if (extraTimingFlushTimerRef.current !== null) {
        clearTimeout(extraTimingFlushTimerRef.current)
        extraTimingFlushTimerRef.current = null
      }
      updatePdfTiming(() => INITIAL_PDF_TIMING)

      const isPdf = getFileExtension(file.name) === 'pdf'
      if (isPdf) {
        setIsParsing(false)
        setPdfLoadState({
          phase: 'loading',
          selection,
          loaded: 0,
          total: file.size
        })
      } else {
        setPdfLoadState({ phase: 'idle' })
        setIsParsing(true)
      }

      appendSwitchBarrier(selection).then(() => {
        if (!isCurrentSelection(selection)) return

        if (isPdf) {
          const pages = getParserPages(
            getPageRange(usePageRange, pageRangeStart, pageRangeEnd)
          )
          startPdfFileRead(selection, abortController, pages)
          return
        }

        startNonPdfParse(selection).catch(reportLifecycleError)
      }, reportLifecycleError)
    },
    [
      appendSwitchBarrier,
      isCurrentSelection,
      pageRangeEnd,
      pageRangeStart,
      startNonPdfParse,
      startPdfFileRead,
      updatePdfTiming,
      usePageRange
    ]
  )

  const handleLoadPdf = useCallback(() => {
    if (pdfLoadState.phase !== 'ready') return

    const { selection, buffer, elapsedMs, pages } = pdfLoadState
    if (!isCurrentSelection(selection)) return

    if (!configurePdfParserForReader(PdfParser)) {
      setPdfLoadState({ phase: 'error', selection })
      setParseError('Failed to parse PDF: parser configuration failed')
      return
    }

    setPdfLoadState({
      phase: 'parsing',
      selection,
      elapsedMs,
      current: 0,
      total: pages?.length ?? 0
    })

    let sourceBuffer: ArrayBuffer | null = buffer
    const parseStartedAt = performance.now()
    void (async () => {
      try {
        await pdfRetirementRef.current
        if (!isCurrentSelection(selection) || sourceBuffer === null) return

        const handle = await openPdfDocumentForReader(PdfParser, sourceBuffer, {
          pages,
          signal: selectionAbortControllerRef.current?.signal,
          onProgress: (progress) => {
            if (!isCurrentSelection(selection)) return
            setPdfLoadState({
              phase: 'parsing',
              selection,
              elapsedMs,
              current: Math.min(progress.current, progress.total),
              total: progress.total
            })
          }
        })
        sourceBuffer = null
        if (!isCurrentSelection(selection)) {
          await handle.dispose()
          return
        }

        const token = createViewerLifetimeToken()
        openDocumentHandleRef.current = handle
        viewerLifetimeTokenRef.current = token
        setViewerLifetimeToken(token)
        updatePdfTiming((current) => ({
          ...current,
          parseMs: performance.now() - parseStartedAt
        }))
        commitParsedDocument(selection, handle.document, 'PDF')
        setPdfLoadState({ phase: 'done', selection })

        await saveSelectedFile(selection)
      } catch (error) {
        sourceBuffer = null
        const retirement = getPdfRetirement(error)
        if (retirement !== null) {
          pdfRetirementRef.current = retirement.catch(reportLifecycleError)
        }
        if (!isCurrentSelection(selection)) return
        updatePdfTiming((current) => ({
          ...current,
          parseFailed: true,
          parseMs: null
        }))
        console.table([
          {
            阶段: '① 文件加载',
            '耗时 (ms)': pdfTimingRef.current.fileLoadMs ?? '—'
          },
          { 阶段: '② 解析 (openDocument)', '耗时 (ms)': '解析失败' }
        ])
        setPdfLoadState({ phase: 'error', selection })
        setParseError(`Failed to parse PDF: ${getParserErrorMessage(error)}`)
      }
    })()
  }, [
    commitParsedDocument,
    isCurrentSelection,
    pdfLoadState,
    saveSelectedFile,
    updatePdfTiming
  ])

  const handleForgetRecentFile = useCallback(() => {
    const epoch = selectionEpochRef.current?.epoch
    const clearTask = recentFilePersistenceChainRef.current.then(async () => {
      if (!mountedRef.current || selectionEpochRef.current?.epoch !== epoch)
        return
      const cleared = await clearRecentFile()
      if (
        cleared &&
        mountedRef.current &&
        selectionEpochRef.current?.epoch === epoch
      ) {
        setHasSavedRecentFile(false)
      }
    })
    recentFilePersistenceChainRef.current =
      clearTask.catch(reportLifecycleError)
  }, [])

  const handleManualFileUpload = useCallback(
    (file: File) => startFileSelection(file, 'sidebar'),
    [startFileSelection]
  )

  const handleReaderFileUpload = useCallback(
    (file: File) => startFileSelection(file, 'reader-upload'),
    [startFileSelection]
  )

  const startFileSelectionRef = useRef(startFileSelection)

  useEffect(() => {
    startFileSelectionRef.current = startFileSelection
  }, [startFileSelection])

  useEffect(() => {
    const restoreEpoch = selectionEpochRef.current?.epoch ?? 0

    loadRecentFile().then((file) => {
      if (
        !mountedRef.current ||
        !file ||
        (selectionEpochRef.current?.epoch ?? 0) !== restoreEpoch
      ) {
        return
      }

      setHasSavedRecentFile(true)
      startFileSelectionRef.current(file, 'recent-file')
    })

    return undefined
  }, [])

  const handleBoundarySetup = useCallback(() => {
    lifecycleGenerationRef.current += 1
    mountedRef.current = true
  }, [])

  const handleBoundaryCleanup = useCallback(() => {
    mountedRef.current = false
    const cleanupGeneration = lifecycleGenerationRef.current

    queueMicrotask(() => {
      if (
        mountedRef.current ||
        lifecycleGenerationRef.current !== cleanupGeneration ||
        terminalEnqueuedRef.current
      ) {
        return
      }
      terminalEnqueuedRef.current = true

      const runTerminal = async () => {
        if (
          mountedRef.current ||
          lifecycleGenerationRef.current !== cleanupGeneration
        ) {
          return
        }

        const selection = selectionEpochRef.current
        if (selection !== null) {
          selectionEpochRef.current = {
            ...selection,
            epoch: selection.epoch + 1
          }
        }
        selectionAbortControllerRef.current?.abort()
        selectionAbortControllerRef.current = null

        const handle = openDocumentHandleRef.current
        const token = viewerLifetimeTokenRef.current
        openDocumentHandleRef.current = null
        viewerLifetimeTokenRef.current = null

        if (extraTimingFlushTimerRef.current !== null) {
          clearTimeout(extraTimingFlushTimerRef.current)
          extraTimingFlushTimerRef.current = null
        }

        if (token !== null) await token.ack
        if (handle !== null) await handle.dispose()
      }

      const terminal = switchBarrierRef.current.then(runTerminal, runTerminal)
      switchBarrierRef.current = terminal.catch(reportLifecycleError)
    })
  }, [])

  const supportsFontScale = parserSupportsFontScale(loadedParserLabel)
  let readerLoadingProgress: ReaderLoadingProgress | null
  switch (pdfLoadState.phase) {
    case 'loading':
      readerLoadingProgress = {
        label: '正在读取文件',
        current: pdfLoadState.loaded,
        total: pdfLoadState.total
      }
      break
    case 'parsing':
      readerLoadingProgress = {
        label: '正在解析 PDF',
        current: pdfLoadState.current,
        total: pdfLoadState.total
      }
      break
    case 'done':
    case 'error':
    case 'idle':
    case 'ready':
      readerLoadingProgress = null
      break
  }
  const activeFontScale =
    renderMode === 'text' ? textFontScale : layoutFontScale

  return (
    <main
      data-testid='reader-demo-root'
      className='hamster-demo-shell'
      onPointerDownCapture={(event) =>
        trackPrimaryPointer(event, latestPrimaryPointerRef)
      }
      onPointerMoveCapture={(event) =>
        trackPrimaryPointer(event, latestPrimaryPointerRef)
      }
    >
      <div className='hamster-demo-sidebar'>
        <div data-testid='demo-sidebar-settings'>
          <h1>Hamster Reader Demo</h1>
          <ParseStatus
            isParsing={isParsing}
            parseError={parseError}
            pdfLoadState={pdfLoadState}
            timing={pdfTiming}
            onLoadPdf={handleLoadPdf}
          />

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
            {(stagedFile || uploadedFile) && (
              <label
                style={{
                  display: 'block',
                  marginBottom: '12px',
                  fontSize: '13px'
                }}
              >
                <span>Choose another file</span>
                <input
                  type='file'
                  aria-label='Choose another file'
                  accept='.pdf,.txt,.docx,.epub,.md,.markdown,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,image/*'
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    if (file) {
                      handleManualFileUpload(file)
                    }
                    event.currentTarget.value = ''
                  }}
                  style={{ display: 'block', marginTop: '6px', width: '100%' }}
                />
              </label>
            )}
            {/* The single Reader handles both upload and document rendering on the right panel */}
          </section>

          <LoadedPagesStatus document={document} pageNumbers={loadedPages} />

          <ReadingProgressStatus
            document={document}
            renderMode={renderMode}
            layoutReadingProgress={layoutReadingProgress}
            textReadingProgress={textReadingProgress}
          />

          {document && (
            <section
              style={{ marginBottom: '24px' }}
              data-testid='ocr-controls'
            >
              <h2>OCR 文字识别</h2>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}
              >
                <input
                  type='number'
                  min={1}
                  value={ocrPageInput}
                  onChange={(event) => setOcrPageInput(event.target.value)}
                  style={{ width: '70px', padding: '4px' }}
                  data-testid='ocr-page-input'
                  aria-label='OCR 页码'
                />
                <button
                  type='button'
                  onClick={handleStartOcr}
                  data-testid='ocr-start-btn'
                  style={{
                    padding: '4px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    background: '#fff'
                  }}
                >
                  OCR
                </button>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type='checkbox'
                    checked={ocrDevMode}
                    onChange={(event) => setOcrDevMode(event.target.checked)}
                    data-testid='ocr-dev-mode-toggle'
                  />
                  开发模式（红框标注 OCR 文字）
                </label>
              </div>
              {ocrError && (
                <p
                  data-testid='ocr-error'
                  style={{ color: '#b91c1c', fontSize: '12px' }}
                >
                  {ocrError}
                </p>
              )}
              {ocrPages.length > 0 && (
                <div data-testid='ocr-active-pages'>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      marginBottom: '8px'
                    }}
                  >
                    {ocrPages.map((page) => (
                      <span
                        key={`ocr-page-${page}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 6px',
                          fontSize: '12px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          background: '#fafafa'
                        }}
                        data-testid={`ocr-active-page-${page}`}
                      >
                        第 {page} 页
                        {ocrTextsByPage[page] ? '（已识别）' : '（识别中）'}
                        <button
                          type='button'
                          aria-label={`关闭第 ${page} 页 OCR`}
                          onClick={() => handleCloseOcrPage(page)}
                          data-testid={`ocr-close-page-${page}`}
                          style={{
                            padding: '0 4px',
                            cursor: 'pointer',
                            border: 'none',
                            background: 'transparent',
                            color: '#f44336',
                            fontSize: '13px'
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <button
                    type='button'
                    onClick={handleCloseAllOcr}
                    data-testid='ocr-close-all-btn'
                    style={{
                      padding: '4px 12px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      background: '#fff'
                    }}
                  >
                    全部关闭
                  </button>
                </div>
              )}
            </section>
          )}

          <RecentFileStatus
            file={uploadedFile}
            isParsing={isParsing}
            isSaved={hasSavedRecentFile}
            onForget={handleForgetRecentFile}
          />

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
                        handleRenderModeChange(nextRenderMode)
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
                      <option value='single-finger'>单指 Single-finger</option>
                      <option value='two-finger'>双指 Two-finger</option>
                    </select>
                  </label>
                </div>
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
                    checked={showPageBrowser}
                    onChange={(event) =>
                      setShowPageBrowser(event.currentTarget.checked)
                    }
                    data-testid='page-browser-toggle'
                  />
                  <span>显示页面浏览栏 Page Browser</span>
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
                    checked={useVirtualPaper}
                    onChange={(event) =>
                      setUseVirtualPaper(event.currentTarget.checked)
                    }
                    data-testid='virtual-paper-toggle'
                  />
                  <span>使用 VirtualPaper（beta）</span>
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
                    type='color'
                    value={themeColor}
                    onChange={(event) =>
                      setThemeColor(event.currentTarget.value)
                    }
                    data-testid='theme-color-picker'
                  />
                  <span>主题色 (Page Browser 选中项)</span>
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
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <input
                    type='checkbox'
                    checked={dictionaryMockEnabled}
                    onChange={(event) =>
                      setDictionaryMockEnabled(event.currentTarget.checked)
                    }
                    data-testid='dictionary-mock-toggle'
                  />
                  <span>查询单词 Mock</span>
                </label>
                <div
                  data-testid='dictionary-event-log'
                  style={{ marginTop: '6px', color: '#555' }}
                >
                  词典事件：{dictionaryInitialWord ?? '尚未调起'}
                </div>
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
                    checked={edgeCropAll !== undefined}
                    onChange={(event) =>
                      setEdgeCropAll(
                        event.currentTarget.checked
                          ? { top: 0.1, right: 0.2, bottom: 0.05, left: 0.15 }
                          : undefined
                      )
                    }
                    data-testid='global-edge-crop-toggle'
                  />
                  <span>全局四边裁切 Global edge crop</span>
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
                    checked={edgeCropPages !== undefined}
                    onChange={(event) =>
                      setEdgeCropPages(
                        event.currentTarget.checked
                          ? {
                              'page-1': {
                                top: 0.02,
                                right: 0.05,
                                bottom: 0.2,
                                left: 0.25
                              }
                            }
                          : undefined
                      )
                    }
                    data-testid='special-edge-crop-toggle'
                  />
                  <span>第 1 页特殊裁切 Page 1 override</span>
                </label>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <button
                  type='button'
                  onClick={() => setEdgeCropEditing((prev) => !prev)}
                  data-testid='edge-crop-edit-toggle'
                  style={{
                    padding: '4px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    background: edgeCropEditing ? '#2563eb' : '#fff',
                    color: edgeCropEditing ? '#fff' : '#333'
                  }}
                >
                  边缘裁切 Edge Crop
                </button>
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
                    checked={hiddenPages.some(
                      (page) => page === 2 || page === 'page-2'
                    )}
                    onChange={(event) => {
                      const shouldHide = event.currentTarget.checked
                      setHiddenPages((currentPages) => {
                        const pagesWithoutSecond = currentPages.filter(
                          (page) => page !== 2 && page !== 'page-2'
                        )
                        return shouldHide
                          ? [...pagesWithoutSecond, 2]
                          : pagesWithoutSecond
                      })
                    }}
                    data-testid='hide-second-page-toggle'
                  />
                  <span>隐藏第 2 页 Hide page 2</span>
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
                        handleToolChange(nextTool)
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

          <AnnotationHistoryControls
            document={document}
            status={historyStatus}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />
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
              {ranges.map((range) => {
                return (
                  <li
                    key={`range-${range.id}`}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
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
                )
              })}
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
        <EmptyState
          document={document}
          parseError={parseError}
          isParsing={isParsing}
        />
        <ViewerLifetimeBoundary
          token={viewerLifetimeToken}
          onSetup={handleBoundarySetup}
          onCleanup={handleBoundaryCleanup}
        >
          {pdfLoadState.phase !== 'ready' && (
            <Reader
              document={document || undefined}
              loadingProgress={readerLoadingProgress}
              isEpub={loadedParserLabel === 'EPUB'}
              isPdf={loadedParserLabel === 'PDF'}
              data={readerData}
              onDataChange={handleReaderDataChange}
              edgeCropEditing={edgeCropEditing}
              onEdgeCropEditingChange={setEdgeCropEditing}
              onEdgeCropApply={handleEdgeCropApply}
              renderMode={renderMode}
              onRenderModeChange={handleRenderModeChange}
              fontScale={supportsFontScale ? activeFontScale : undefined}
              onFontScaleChange={
                renderMode === 'text' ? setTextFontScale : setLayoutFontScale
              }
              touchPanMode={touchPanMode}
              onTouchPanModeChange={setTouchPanMode}
              onFileUpload={handleReaderFileUpload}
              emptyText='No document loaded'
              pageRange={getPageRange(
                usePageRange,
                pageRangeStart,
                pageRangeEnd
              )}
              overlayRectType='percent'
              ocr={
                ocrPages.length > 0
                  ? { enabled: true, pages: ocrPages }
                  : automaticOcrEnabled
              }
              onOcrChange={handleOcrChange}
              ocrTexts={ocrTextsByPage}
              onOcrTextsChange={handleOcrTextsChange}
              onOcrError={handleOcrError}
              ocrDebug={ocrDevMode}
              onTextSelectionChange={() => {}}
              onTextSelectionEnd={() => {}}
              onSelectText={() => {}}
              useVirtualPaper={useVirtualPaper}
              selectedRangeId={selectedRangeId}
              onSelect={handleSelectionSelect}
              onLinkedDataChange={handleLinkedDataChange}
              onSelectRange={handleSelectRange}
              onUpdateRange={handleUpdateRange}
              onHighlight={handleHighlight}
              onDragHighlight={handleDragHighlight}
              onRemoveRange={handleRemoveRange}
              onHighlightColorChange={setHighlightColor}
              onSelectionEnd={handleSelectionEnd}
              selectionRef={selectionRef}
              highlightColor={highlightColor}
              selectionColor='rgba(33, 150, 243, 0.2)'
              autoHighlight={autoHighlight}
              queryWord={(word) =>
                dictionaryMockEnabled
                  ? `${word}\nmock definition\nmock example sentence`
                  : ''
              }
              onOpenDictionary={setDictionaryInitialWord}
              containMarginX={containMarginX}
              containMarginTop={containMarginTop}
              containMarginBottom={containMarginBottom}
              selectedTool={selectedTool}
              onSelectedToolChange={handleToolChange}
              onPagePaintingsChange={handlePagePaintingsChange}
              showPageBrowser={showPageBrowser}
              onPageBrowserClose={() => setShowPageBrowser(false)}
              themeColor={themeColor}
              drawingStrokeColor={toolColor}
              onDrawingStrokeColorChange={setToolColor}
              colors={DEMO_READER_COLORS}
              comments={comments}
              onCommentsChange={handleCommentsChange}
              selectedRectId={selectedRectId}
              onCreateRect={handleCreateRect}
              onSelectRect={handleSelectRect}
              onUpdateRect={handleUpdateRect}
              onRemoveRect={handleRemoveRect}
              annotationHistory={{
                enabled: true,
                resetKey: uploadedFile?.name ?? 'none'
              }}
              onAnnotationHistoryChange={handleAnnotationHistoryChange}
              onCommentHighlight={handleCommentHighlight}
              onIntermediateDocumentRenderTiming={
                handleIntermediateDocumentRenderTiming
              }
              onPageLoadStatusChange={setLoadedPages}
            />
          )}
        </ViewerLifetimeBoundary>
      </div>
      {highlightDragPreview !== null ? (
        <div
          aria-hidden='true'
          className='hamster-demo-highlight-drag-preview'
          data-testid='highlight-drag-preview'
          style={{
            transform: `translate3d(${highlightDragPreview.x + 14}px, ${highlightDragPreview.y + 14}px, 0)`
          }}
        >
          {highlightDragPreview.highlight.text.trim() || '高亮内容'}
        </div>
      ) : null}
      {isCommentPanelOpen && (
        <CommentPanel
          comments={comments}
          ranges={ranges}
          activeHighlightId={activeHighlightId}
          onCommentsChange={handleCommentsChange}
          onJumpToHighlight={handleJumpToHighlight}
          onClose={handleCloseCommentPanel}
        />
      )}
    </main>
  )
}
