import { DocxParser } from '@hamster-note/docx-parser'
import { EpubParser } from '@hamster-note/epub-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import { PdfParser } from '@hamster-note/pdf-parser'
import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue,
  ReaderBookmark,
  ReaderColorOption,
  ReaderComment,
  ReaderData,
  ReaderEdgeCrop,
  ReaderFontScale,
  ReaderLinkedSelectionData,
  ReaderLoadingProgress,
  ReaderOcrOptions,
  ReaderPageTool,
  ReaderRenderMode,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderTouchPanMode
} from '@hamster-note/reader'

import { TxtParser } from '@hamster-note/txt-parser'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized
} from '@hamster-note/types'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../demo/App'
import { loadFileToMemory } from '../demo/fileMemoryLoader'
import { createImagePreviewDocument } from '../demo/imagePreview'
import { configurePdfParserForReader } from '../demo/pdfParserForReader'
import {
  clearRecentFile,
  loadRecentFile,
  saveRecentFile
} from '../demo/recentFileStorage'

vi.mock('@hamster-note/pdf-parser', () => ({
  PdfParser: {
    encode: vi.fn(),
    loadPdfSession: vi.fn(),
    openDocument: vi.fn()
  }
}))

vi.mock('../demo/pdfParserForReader', async (importOriginal) => ({
  ...(await importOriginal()),
  configurePdfParserForReader: vi.fn(() => true)
}))

vi.mock('@hamster-note/txt-parser', () => ({
  TxtParser: {
    encode: vi.fn()
  }
}))

vi.mock('@hamster-note/docx-parser', () => ({
  DocxParser: {
    encodeToIntermediate: vi.fn()
  }
}))

vi.mock('@hamster-note/epub-parser', () => ({
  EpubParser: {
    encode: vi.fn()
  }
}))

vi.mock('@hamster-note/markdown-parser', () => ({
  MarkdownParser: {
    encode: vi.fn()
  }
}))

vi.mock('../demo/imagePreview', () => ({
  createImagePreviewDocument: vi.fn()
}))

vi.mock('../demo/fileMemoryLoader', () => ({
  loadFileToMemory: vi.fn(
    async (file: File, onProgress: (loaded: number, total: number) => void) => {
      onProgress(file.size, file.size)
      const buffer = new ArrayBuffer(file.size)
      pdfFilesByBuffer.set(buffer, file)
      return {
        file,
        buffer,
        elapsedMs: 1
      }
    }
  )
}))

vi.mock('../demo/recentFileStorage', () => ({
  clearRecentFile: vi.fn(),
  loadRecentFile: vi.fn(),
  saveRecentFile: vi.fn()
}))

beforeEach(() => {
  vi.mocked(clearRecentFile).mockResolvedValue(true)
  vi.mocked(loadRecentFile).mockResolvedValue(null)
  vi.mocked(saveRecentFile).mockResolvedValue(true)
  vi.mocked(configurePdfParserForReader).mockReturnValue(true)
  vi.mocked(PdfParser.openDocument).mockImplementation(
    async (buffer, options) => {
      const document = await vi.mocked(PdfParser.encode)(
        buffer instanceof ArrayBuffer
          ? (pdfFilesByBuffer.get(buffer) ?? latestUploadedPdfFile)
          : latestUploadedPdfFile,
        options?.pages ? { pages: options.pages } : undefined
      )
      if (document === undefined) {
        throw new Error('received undefined result')
      }
      options?.onProgress?.({
        stage: 'encode:complete',
        current: 1,
        total: 1
      })
      return {
        id: document.id,
        title: document.title,
        pageCount: 1,
        document,
        dispose: vi.fn().mockResolvedValue(undefined)
      }
    }
  )
})

let latestUploadedPdfFile = new File([], 'initial.pdf', {
  type: 'application/pdf'
})
const pdfFilesByBuffer = new WeakMap<ArrayBuffer, File>()

const mockCallbacks: {
  onTextSelectionChange?: (text: unknown, detail: unknown) => void
  onTextSelectionEnd?: (text: unknown, detail: unknown) => void
  onSelectText?: (
    selection: unknown,
    segments: unknown,
    extractedText: unknown
  ) => void
} = {}
type MockReaderProps = Record<string, unknown> & {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  emptyText?: string
  renderMode?: ReaderRenderMode
  onRenderModeChange?: (mode: ReaderRenderMode) => void
  fontScale?: ReaderFontScale
  onFontScaleChange?: (scale: ReaderFontScale) => void
  touchPanMode?: ReaderTouchPanMode
  onTouchPanModeChange?: (mode: ReaderTouchPanMode) => void
  ocr?: boolean | ReaderOcrOptions
  onOcrChange?: (enabled: boolean) => void
  selectedTool?: ReaderPageTool
  onSelectedToolChange?: (tool: ReaderPageTool) => void
  drawingStrokeColor?: string
  onDrawingStrokeColorChange?: (color: string) => void
  colors?: readonly ReaderColorOption[]
  data?: ReaderData
  onDataChange?: (nextData: ReaderData) => void
  onFileUpload?: (file: File) => void
  loadingProgress?: ReaderLoadingProgress | null
  onTextSelectionChange?: (text: unknown, detail: unknown) => void
  onTextSelectionEnd?: (text: unknown, detail: unknown) => void
  onSelectText?: (
    selection: unknown,
    segments: unknown,
    extractedText: unknown
  ) => void
  selectionRef?: React.MutableRefObject<ReaderSelectionRef | null>
  selectedRangeId?: string | null
  selectedRectId?: string | null
  selectionPopover?: ReactNode
  highlightPopover?: unknown
  highlightColor?: string
  onHighlightColorChange?: (color: string) => void
  onRemoveRange?: (id: string) => void
  annotationHistory?: { enabled?: boolean; resetKey?: string | number }
  onAnnotationHistoryChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
  onHighlight?: (range: ReaderSelectionRange) => void
  onLinkedDataChange?: (next: ReaderLinkedSelectionData) => void
  onUpdateRange?: (range: ReaderSelectionRange) => void
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  onPagePaintingsChange?: (paintings: unknown) => void
  onTogglePageBookmark?: (pageNumber: number) => void
  comments?: readonly ReaderComment[]
  onCommentsChange?: (next: readonly ReaderComment[]) => void
  commentCountByRangeId?: Record<string, number>
  commentCountByRectId?: Record<string, number>
  edgeCropEditing?: boolean
  onEdgeCropEditingChange?: (editing: boolean) => void
  onEdgeCropApply?: (pageNumber: number | null, crop: ReaderEdgeCrop) => void
  useVirtualPaper?: boolean
}

const mockReaderProps: MockReaderProps[] = []
const HIGHLIGHT_STORAGE_PREFIX = 'hamster-reader-demo:highlights:'
const COMMENT_STORAGE_PREFIX = 'hamster-reader-demo:comments:'
const BOOKMARK_STORAGE_PREFIX = 'hamster-reader-demo:bookmarks:'
const LAYOUT_READING_PROGRESS_STORAGE_PREFIX =
  'hamster-reader-demo:layout-reading-progress:'
const TEXT_READING_PROGRESS_STORAGE_PREFIX =
  'hamster-reader-demo:text-reading-progress:'

// --- Mock annotation history state ---
// 模拟 library 内部的 undo/redo 栈，让 mock Reader 能在测试中
// 通过 onAnnotationHistoryChange 驱动 App 的受控状态更新。
type MockHistorySnapshot = {
  ranges: ReaderSelectionRange[]
  rects: ReaderSelectionRectangle[]
  selectedRangeId: string | null
  selectedRectId: string | null
}

const mockHistoryState: {
  past: MockHistorySnapshot[]
  present: MockHistorySnapshot
  future: MockHistorySnapshot[]
} = {
  past: [],
  present: {
    ranges: [],
    rects: [],
    selectedRangeId: null,
    selectedRectId: null
  },
  future: []
}

let lastMockResetKey: string | number | undefined

// 始终保持最新的 onAnnotationHistoryChange 引用，
// 避免被 selectionRef.current spread 覆盖后使用过期的闭包。
let latestOnAHC:
  | ((
      next: ReaderAnnotationHistoryValue,
      detail: ReaderAnnotationHistoryChangeDetail
    ) => void)
  | undefined

function resetMockHistory() {
  mockHistoryState.past = []
  mockHistoryState.future = []
  mockHistoryState.present = {
    ranges: [],
    rects: [],
    selectedRangeId: null,
    selectedRectId: null
  }
  lastMockResetKey = undefined
  latestOnAHC = undefined
}

function getMockHistoryStatus(): ReaderAnnotationHistoryStatus {
  return {
    enabled: true,
    canUndo: mockHistoryState.past.length > 0,
    canRedo: mockHistoryState.future.length > 0,
    pastCount: mockHistoryState.past.length,
    futureCount: mockHistoryState.future.length
  }
}

function createCheckpoint(
  next: MockHistorySnapshot,
  source: ReaderAnnotationHistoryChangeDetail['source'],
  onAnnotationHistoryChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
) {
  mockHistoryState.past.push(mockHistoryState.present)
  mockHistoryState.future = []
  mockHistoryState.present = next
  onAnnotationHistoryChange?.(next, { source, status: getMockHistoryStatus() })
}

function mockUndo(): boolean {
  const target = mockHistoryState.past.pop()
  if (!target) return false
  mockHistoryState.future.unshift(mockHistoryState.present)
  mockHistoryState.present = target
  latestOnAHC?.(target, { source: 'undo', status: getMockHistoryStatus() })
  return true
}

function mockRedo(): boolean {
  const target = mockHistoryState.future.shift()
  if (!target) return false
  mockHistoryState.past.push(mockHistoryState.present)
  mockHistoryState.present = target
  latestOnAHC?.(target, { source: 'redo', status: getMockHistoryStatus() })
  return true
}

function mockClear(): void {
  const next: MockHistorySnapshot = {
    ranges: [],
    rects: [],
    selectedRangeId: null,
    selectedRectId: null
  }
  createCheckpoint(next, 'clear', latestOnAHC)
}

function wrapMutationCallback<
  T extends ReaderSelectionRange | ReaderSelectionRectangle
>(
  callback: ((item: T) => void) | undefined,
  source: ReaderAnnotationHistoryChangeDetail['source'],
  computeNext: (present: MockHistorySnapshot, item: T) => MockHistorySnapshot
): ((item: T) => void) | undefined {
  if (!callback) return undefined
  return (item: T) => {
    const next = computeNext(mockHistoryState.present, item)
    createCheckpoint(next, source, latestOnAHC)
    callback(item)
  }
}

vi.mock('@hamster-note/reader', async (importOriginal) => {
  // 部分 mock：保留库内纯函数，仅替换 Reader 组件
  const actual = await importOriginal<typeof import('@hamster-note/reader')>()
  const { useLayoutEffect } = await import('react')
  return {
    ...actual,
    Reader: (props: MockReaderProps) => {
      // 从受控 props 同步 present 快照（不创建 checkpoint）
      const ranges = props.data?.ranges ?? []
      const rects = props.data?.rects ?? []
      mockHistoryState.present = {
        ranges,
        rects,
        selectedRangeId: props.selectedRangeId ?? null,
        selectedRectId: props.selectedRectId ?? null
      }

      // 始终更新 latestOnAHC，避免 selectionRef.current spread 导致闭包过期
      latestOnAHC = props.onAnnotationHistoryChange

      useLayoutEffect(() => {
        const currentResetKey = props.annotationHistory?.resetKey
        if (currentResetKey === lastMockResetKey) return
        lastMockResetKey = currentResetKey
        mockHistoryState.past = []
        mockHistoryState.future = []
        latestOnAHC?.(mockHistoryState.present, {
          source: 'reset',
          status: getMockHistoryStatus()
        })
      }, [props.annotationHistory?.resetKey])

      // 包装 mutation callbacks：创建 checkpoint 并通过 onAnnotationHistoryChange 回传
      const wrappedOnHighlight = wrapMutationCallback(
        props.onHighlight,
        'highlight',
        (present, range: ReaderSelectionRange) => ({
          ...present,
          ranges: [...present.ranges, range]
        })
      )

      const wrappedOnUpdateRange = wrapMutationCallback(
        props.onUpdateRange,
        'update-range',
        (present, range: ReaderSelectionRange) => ({
          ...present,
          ranges: present.ranges.map((r) => (r.id === range.id ? range : r))
        })
      )

      const wrappedOnCreateRect = wrapMutationCallback(
        props.onCreateRect,
        'create-rect',
        (present, rect: ReaderSelectionRectangle) => ({
          ...present,
          rects: [...present.rects, rect]
        })
      )

      const wrappedOnUpdateRect = wrapMutationCallback(
        props.onUpdateRect,
        'update-rect',
        (present, rect: ReaderSelectionRectangle) => ({
          ...present,
          rects: present.rects.map((r) => (r.id === rect.id ? rect : r))
        })
      )

      const wrappedProps = {
        ...props,
        onHighlight: wrappedOnHighlight,
        onUpdateRange: wrappedOnUpdateRange,
        onCreateRect: wrappedOnCreateRect,
        onUpdateRect: wrappedOnUpdateRect
      }
      const popoverContext = {
        selectionRef: props.selectionRef ?? { current: null },
        highlightColor: props.highlightColor,
        onHighlightColorChange: props.onHighlightColorChange,
        selectedRangeId: props.selectedRangeId,
        ranges,
        onUpdateRange: wrappedOnUpdateRange,
        onRemoveRange: props.onRemoveRange
      }
      Object.assign(wrappedProps, {
        selectionPopover:
          props.selectionPopover ??
          createElement(actual.DefaultSelectionPopover, popoverContext),
        highlightPopover:
          props.highlightPopover ??
          ((highlight: ReaderSelectionRange) =>
            createElement(actual.DefaultHighlightPopover, {
              ...popoverContext,
              selectedRangeId: highlight.id,
              ranges: [
                ...ranges.filter((range) => range.id !== highlight.id),
                highlight
              ]
            }))
      })
      mockReaderProps.push(wrappedProps)

      if (props.onTextSelectionChange)
        mockCallbacks.onTextSelectionChange = props.onTextSelectionChange
      if (props.onTextSelectionEnd)
        mockCallbacks.onTextSelectionEnd = props.onTextSelectionEnd
      if (props.onSelectText) mockCallbacks.onSelectText = props.onSelectText
      if (props.selectionRef) {
        props.selectionRef.current = {
          highlight: vi.fn(),
          confirm: vi.fn(),
          confirmRect: vi.fn(),
          clear: mockClear,
          scrollToRange: vi.fn(),
          scrollToRect: vi.fn(),
          scrollToPosition: vi.fn(),
          undo: mockUndo,
          redo: mockRedo,
          canUndo: () => mockHistoryState.past.length > 0,
          canRedo: () => mockHistoryState.future.length > 0,
          getAnnotationHistoryState: () => getMockHistoryStatus(),
          ...(props.selectionRef.current ?? {})
        }
      }
      return (
        <div
          data-testid='mock-reader'
          className='hamster-reader'
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {props.document ? props.document.title : props.emptyText}
          {props.loadingProgress && (
            <section data-testid='mock-reader-loading-progress'>
              {props.loadingProgress.label}: {props.loadingProgress.current}/
              {props.loadingProgress.total}
            </section>
          )}
          {props.onFileUpload && (
            <input
              data-testid='file-input'
              type='file'
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]

                if (file) {
                  props.onFileUpload?.(file)
                }
              }}
            />
          )}
        </div>
      )
    }
  }
})

function makeSerializedDocument(
  title: string,
  pages: IntermediateDocumentSerialized['pages'] = []
): IntermediateDocumentSerialized {
  return {
    id: title.toLowerCase().replaceAll(' ', '-'),
    title,
    pages
  }
}

function makeRuntimeDocument(title: string) {
  return IntermediateDocument.parse(makeSerializedDocument(title))
}

function mockEpubParserSuccess(document: IntermediateDocument) {
  const wrapper = Object.create(null) as Awaited<
    ReturnType<typeof EpubParser.encode>
  >
  Object.defineProperty(wrapper, 'getIntermediateDocument', {
    value: () => document
  })
  vi.mocked(EpubParser.encode).mockResolvedValue(wrapper)
}

function makeFile(name: string) {
  const file = new File(['pdf'], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { value: 3 })
  return file
}

function makeLinkedRange(
  id: string,
  text: string,
  selectionId = 'page-1'
): ReaderSelectionRange {
  return {
    id,
    text,
    start: { selectionId, offset: 1 },
    end: { selectionId, offset: 6 },
    createdAt: 1000,
    overlayRectType: 'percent',
    rectsBySelectionId: {
      [selectionId]: [{ x: 10, y: 20, width: 30, height: 40 }]
    }
  }
}

function highlightStorageKey(fileName: string): string {
  return `${HIGHLIGHT_STORAGE_PREFIX}${fileName}`
}

function commentStorageKey(fileName: string): string {
  return `${COMMENT_STORAGE_PREFIX}${fileName}`
}

function bookmarkStorageKey(fileName: string): string {
  return `${BOOKMARK_STORAGE_PREFIX}${fileName}`
}

function findDocumentReaderProps(): MockReaderProps | undefined {
  for (let index = mockReaderProps.length - 1; index >= 0; index -= 1) {
    const props = mockReaderProps[index]
    if (props.document !== undefined) {
      return props
    }
  }
  return undefined
}

type HighlightPopoverRenderer = (
  highlight: ReaderSelectionRange
) => React.ReactNode

function isHighlightPopoverRenderer(
  value: unknown
): value is HighlightPopoverRenderer {
  return typeof value === 'function'
}

function renderHighlightPopover(
  props: Record<string, unknown> | undefined,
  range: ReaderSelectionRange
) {
  const renderer = props?.highlightPopover
  if (!isHighlightPopoverRenderer(renderer)) {
    throw new Error('Expected highlightPopover to be a range renderer')
  }

  return render(renderer(range))
}

function isCommentHighlightCallback(
  value: unknown
): value is (highlight: ReaderSelectionRange) => Promise<ReaderSelectionRange> {
  return typeof value === 'function'
}

function selectFile(file: File) {
  if (file.name.toLowerCase().endsWith('.pdf')) {
    latestUploadedPdfFile = file
  }
  const input =
    screen.queryByTestId('file-input') ??
    screen.getByLabelText('Choose another file')
  fireEvent.change(input, {
    target: { files: [file] }
  })
}

async function upload(file: File): Promise<void> {
  selectFile(file)
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const button = await screen.findByRole('button', { name: '加载文件' })
    if (screen.getByTestId('pdf-ready-card').textContent?.includes(file.name)) {
      fireEvent.click(button)
    }
  }
}

function makePdfHandle(document: IntermediateDocument) {
  return {
    id: document.id,
    title: document.title,
    pageCount: 1,
    document,
    dispose: vi.fn().mockResolvedValue(undefined)
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('demo parser flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReaderProps.length = 0
    resetMockHistory()
  })

  afterEach(async () => {
    await act(async () => {
      await Promise.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  })

  it('renders the parsed document and uploaded file details on success', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Success Document')
    )

    render(<App />)
    const uploadedFile = makeFile('success.pdf')
    await upload(uploadedFile)

    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(screen.getByText('Success Document')).toBeInTheDocument()
    expect(screen.getByText('Name: success.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
    expect(EpubParser.encode).not.toHaveBeenCalled()
  })

  it('keeps a PDF in the ready state until the user clicks 加载文件', async () => {
    const document = makeRuntimeDocument('Two Phase Document')
    vi.mocked(PdfParser.openDocument).mockResolvedValue(makePdfHandle(document))

    render(<App />)
    const file = makeFile('two-phase.pdf')
    selectFile(file)

    expect(await screen.findByTestId('pdf-ready-card')).toHaveTextContent(
      'two-phase.pdf'
    )
    expect(screen.queryByTestId('mock-reader')).not.toBeInTheDocument()
    expect(configurePdfParserForReader).not.toHaveBeenCalled()
    expect(PdfParser.openDocument).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '加载文件' }))

    expect(await screen.findByText('Two Phase Document')).toBeInTheDocument()
    expect(configurePdfParserForReader).toHaveBeenCalledOnce()
    expect(PdfParser.openDocument).toHaveBeenCalledOnce()
  })

  it('renders PDF file-read progress inside the Reader container', async () => {
    // Given: PDF 文件读取已报告部分字节，但读取任务尚未结束。
    const pendingLoad =
      createDeferred<Awaited<ReturnType<typeof loadFileToMemory>>>()
    vi.mocked(loadFileToMemory).mockImplementationOnce((file, onProgress) => {
      onProgress?.(1, file.size)
      return pendingLoad.promise
    })

    render(<App />)

    // When: 用户选择 PDF 并进入文件读取阶段。
    selectFile(makeFile('reader-progress.pdf'))
    const reader = await screen.findByTestId('mock-reader')
    const progress = await screen.findByTestId('mock-reader-loading-progress')

    // Then: 进度属于 Reader 容器，侧栏不再渲染旧进度组件。
    expect(reader).toContainElement(progress)
    expect(progress).toHaveTextContent('正在读取文件: 1/3')
    expect(screen.queryByTestId('pdf-progress-status')).not.toBeInTheDocument()
  })

  it('configures the PDF parser immediately before every openDocument call', async () => {
    const events: string[] = []
    vi.mocked(configurePdfParserForReader).mockImplementation(() => {
      events.push('configure')
      return true
    })
    vi.mocked(PdfParser.openDocument).mockImplementation(async () => {
      events.push('openDocument')
      return makePdfHandle(makeRuntimeDocument(`Document ${events.length}`))
    })

    render(<App />)
    await upload(makeFile('first-configure.pdf'))
    expect(await screen.findByText('Document 2')).toBeInTheDocument()
    await upload(makeFile('second-configure.pdf'))
    expect(await screen.findByText('Document 4')).toBeInTheDocument()

    expect(events).toEqual([
      'configure',
      'openDocument',
      'configure',
      'openDocument'
    ])
  })

  it('enters an explicit error state without opening when parser configuration fails', async () => {
    vi.mocked(configurePdfParserForReader).mockReturnValue(false)

    render(<App />)
    selectFile(makeFile('configuration-failure.pdf'))
    fireEvent.click(await screen.findByRole('button', { name: '加载文件' }))

    expect(await screen.findByTestId('demo-error-state')).toHaveTextContent(
      'parser configuration failed'
    )
    expect(PdfParser.openDocument).not.toHaveBeenCalled()
  })

  it('restores a recent PDF as a ready card without parsing it', async () => {
    const recentFile = makeFile('restored-ready.pdf')
    vi.mocked(loadRecentFile).mockResolvedValue(recentFile)

    render(<App />)

    expect(await screen.findByTestId('pdf-ready-card')).toHaveTextContent(
      'restored-ready.pdf'
    )
    expect(PdfParser.openDocument).not.toHaveBeenCalled()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
  })

  it('lets a newer PDF win while an older TXT parser is pending', async () => {
    const staleTxt = createDeferred<IntermediateDocument>()
    vi.mocked(TxtParser.encode).mockReturnValue(staleTxt.promise)
    vi.mocked(PdfParser.openDocument).mockResolvedValue(
      makePdfHandle(makeRuntimeDocument('Fresh PDF'))
    )

    render(<App />)
    selectFile(makeFile('stale.txt'))
    await upload(makeFile('fresh.pdf'))

    expect(await screen.findByText('Fresh PDF')).toBeInTheDocument()
    staleTxt.resolve(makeRuntimeDocument('Stale TXT'))
    await act(async () => Promise.resolve())

    expect(screen.queryByText('Stale TXT')).not.toBeInTheDocument()
    expect(saveRecentFile).toHaveBeenCalledTimes(1)
    expect(saveRecentFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fresh.pdf' })
    )
  })

  it('disposes a late PDF handle after a newer TXT selection wins', async () => {
    const staleOpen = createDeferred<ReturnType<typeof makePdfHandle>>()
    const staleHandle = makePdfHandle(makeRuntimeDocument('Stale PDF'))
    vi.mocked(PdfParser.openDocument).mockReturnValue(staleOpen.promise)
    vi.mocked(TxtParser.encode).mockResolvedValue(
      makeRuntimeDocument('Fresh TXT')
    )

    render(<App />)
    await upload(makeFile('stale.pdf'))
    expect(
      await screen.findByTestId('mock-reader-loading-progress')
    ).toHaveTextContent('正在解析 PDF')
    selectFile(makeFile('fresh.txt'))
    expect(await screen.findByText('Fresh TXT')).toBeInTheDocument()

    staleOpen.resolve(staleHandle)
    await waitFor(() => expect(staleHandle.dispose).toHaveBeenCalledOnce())
    expect(screen.queryByText('Stale PDF')).not.toBeInTheDocument()
    expect(saveRecentFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'stale.pdf' })
    )
  })

  it('keeps only TXT B when TXT A resolves after it', async () => {
    const staleTxt = createDeferred<IntermediateDocument>()
    vi.mocked(TxtParser.encode)
      .mockReturnValueOnce(staleTxt.promise)
      .mockResolvedValueOnce(makeRuntimeDocument('TXT B'))

    render(<App />)
    selectFile(makeFile('a.txt'))
    await waitFor(() => expect(TxtParser.encode).toHaveBeenCalledTimes(1))
    selectFile(makeFile('b.txt'))
    await waitFor(() => expect(TxtParser.encode).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('TXT B')).toBeInTheDocument()

    staleTxt.resolve(makeRuntimeDocument('TXT A'))
    await act(async () => Promise.resolve())
    expect(screen.queryByText('TXT A')).not.toBeInTheDocument()
    expect(saveRecentFile).toHaveBeenCalledTimes(1)
    expect(saveRecentFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'b.txt' })
    )
  })

  it('aborts stale phase-one loading and shows the newer PDF ready card', async () => {
    const staleLoad = createDeferred<{
      file: File
      buffer: ArrayBuffer
      elapsedMs: number
    }>()
    vi.mocked(loadFileToMemory)
      .mockReturnValueOnce(staleLoad.promise)
      .mockImplementationOnce(async (file, onProgress) => {
        onProgress(file.size, file.size)
        return { file, buffer: new ArrayBuffer(file.size), elapsedMs: 2 }
      })

    render(<App />)
    selectFile(makeFile('loading-a.pdf'))
    await waitFor(() => expect(loadFileToMemory).toHaveBeenCalledTimes(1))
    selectFile(makeFile('loading-b.pdf'))

    expect(await screen.findByTestId('pdf-ready-card')).toHaveTextContent(
      'loading-b.pdf'
    )
    staleLoad.resolve({
      file: makeFile('loading-a.pdf'),
      buffer: new ArrayBuffer(3),
      elapsedMs: 3
    })
    await act(async () => Promise.resolve())

    expect(screen.getByTestId('pdf-ready-card')).toHaveTextContent(
      'loading-b.pdf'
    )
    expect(screen.getByLabelText('Choose another file')).not.toBeDisabled()
  })

  it('defaults VirtualPaper beta off and lets the sidebar enable it', async () => {
    // Given: a parsed document opens the Demo settings and Reader.
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('VirtualPaper Toggle Document')
    )
    render(<App />)
    await upload(makeFile('virtual-paper-toggle.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    // Then: the beta switch is off and the Demo opts into native rendering.
    const toggle = screen.getByRole('checkbox', {
      name: '使用 VirtualPaper（beta）'
    })
    expect(toggle).not.toBeChecked()
    expect(findDocumentReaderProps()?.useVirtualPaper).toBe(false)

    // When: the user enables VirtualPaper.
    fireEvent.click(toggle)

    // Then: the same Reader receives the enabled preference.
    await waitFor(() => {
      expect(toggle).toBeChecked()
      expect(findDocumentReaderProps()?.useVirtualPaper).toBe(true)
    })
  })

  it.each([
    {
      fileName: 'success.pdf',
      label: 'PDF',
      title: 'PDF Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(PdfParser.encode).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(PdfParser.encode).toHaveBeenCalledWith(file, undefined)
        expect(EpubParser.encode).not.toHaveBeenCalled()
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
        expect(MarkdownParser.encode).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'BOOK.TXT',
      label: 'TXT',
      title: 'TXT Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(TxtParser.encode).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(TxtParser.encode).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(EpubParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
        expect(MarkdownParser.encode).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'file.DOCX',
      label: 'DOCX',
      title: 'DOCX Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(DocxParser.encodeToIntermediate).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(DocxParser.encodeToIntermediate).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(EpubParser.encode).not.toHaveBeenCalled()
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(MarkdownParser.encode).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'BOOK.EPUB',
      label: 'EPUB',
      title: 'EPUB Routed Document',
      arrange: (document: IntermediateDocument) =>
        mockEpubParserSuccess(document),
      assertParserCall: (file: File) => {
        expect(EpubParser.encode).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
        expect(MarkdownParser.encode).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'notes.final.md',
      label: 'Markdown',
      title: 'Markdown MD Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(MarkdownParser.encode).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(MarkdownParser.encode).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(EpubParser.encode).not.toHaveBeenCalled()
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'README.markdown',
      label: 'Markdown',
      title: 'Markdown Long Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(MarkdownParser.encode).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(MarkdownParser.encode).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(EpubParser.encode).not.toHaveBeenCalled()
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
      }
    }
  ])(
    'routes supported $label upload $fileName by extension',
    async (caseData) => {
      const document = makeRuntimeDocument(caseData.title)
      caseData.arrange(document)

      render(<App />)
      const uploadedFile = makeFile(caseData.fileName)
      await upload(uploadedFile)

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(await screen.findByText(caseData.title)).toBeInTheDocument()

      const shell = screen.getByTestId('reader-demo-root')
      expect(shell).toHaveClass('hamster-demo-shell')

      const sidebar = screen.getByTestId('demo-sidebar-settings').parentElement
      expect(sidebar).toHaveClass('hamster-demo-sidebar')

      const main = screen.getByTestId('mock-reader').parentElement
      expect(main).toHaveClass('hamster-demo-main')

      // Check Reader height fill integration
      const readerRoot = screen.getByTestId('mock-reader')
      expect(readerRoot).toHaveStyle({
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column'
      })

      const highlightGroup = screen.queryByTestId('demo-sidebar-highlights')
      if (highlightGroup) {
        expect(
          highlightGroup.querySelectorAll('button[aria-label]')
        ).not.toHaveLength(0)
      }

      expect(screen.getByText(`Name: ${caseData.fileName}`)).toBeInTheDocument()
      expect(screen.getByLabelText('Choose another file')).toHaveAttribute(
        'accept',
        '.pdf,.txt,.docx,.epub,.md,.markdown,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,image/*'
      )
      expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
      caseData.assertParserCall(uploadedFile)
    }
  )

  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])(
    'routes .%s uploads to the image preview parser without starting OCR',
    async (extension) => {
      const document = makeRuntimeDocument('Image Preview Document')
      vi.mocked(createImagePreviewDocument).mockResolvedValue(document)

      render(<App />)
      const uploadedFile = makeFile(`scan.${extension}`)
      await upload(uploadedFile)

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(createImagePreviewDocument).toHaveBeenCalledWith(uploadedFile)
      expect(findDocumentReaderProps()?.ocr).toBe(false)
      expect(PdfParser.encode).not.toHaveBeenCalled()
      expect(EpubParser.encode).not.toHaveBeenCalled()
      expect(TxtParser.encode).not.toHaveBeenCalled()
      expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
      expect(MarkdownParser.encode).not.toHaveBeenCalled()
    }
  )

  it('loads and persists EPUB highlights as canonical Layout-shaped ranges', async () => {
    // Given: EPUB 文件已有统一存储的 Layout 形态 range。
    const fileName = 'stable-anchors.epub'
    const storedHighlight = makeLinkedRange(
      'stored-epub-highlight',
      'Stored EPUB text'
    )
    localStorage.setItem(
      highlightStorageKey(fileName),
      JSON.stringify({
        version: 4,
        ranges: [storedHighlight],
        rects: [],
        paintings: {}
      })
    )
    mockEpubParserSuccess(makeRuntimeDocument('Stable EPUB Document'))

    // When: 文件加载完成，并由 Text Reader 创建一条新的 canonical range。
    render(<App />)
    await upload(makeFile(fileName))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(findDocumentReaderProps()?.renderMode).toBe('text')
    expect(findDocumentReaderProps()?.data?.ranges).toEqual([storedHighlight])
    const nextHighlight = makeLinkedRange(
      'new-epub-highlight',
      'New EPUB text',
      'page-2'
    )
    act(() => {
      findDocumentReaderProps()?.onHighlight?.(nextHighlight)
    })

    // Then: ReaderData 与统一 localStorage 都保存完整的 Layout 形态 range。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.data?.ranges).toEqual([
        storedHighlight,
        nextHighlight
      ])
    })
    const persisted = localStorage.getItem(highlightStorageKey(fileName))
    expect(persisted).toContain('"selectionId":"page-2"')
    expect(persisted).toContain('"rectsBySelectionId"')
    expect(persisted).toContain('"overlayRectType":"percent"')
  })

  it('reports annotation history as the EPUB Layout highlight state owner', async () => {
    // Given: EPUB 已切换到 Layout，并显式开启高亮诊断日志。
    const fileName = 'layout-history-owner.epub'
    localStorage.setItem('hamster-reader:debug-highlights', '1')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    mockEpubParserSuccess(makeRuntimeDocument('Layout History Owner'))
    render(<App />)
    await upload(makeFile(fileName))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('render-mode-select'), {
      target: { value: 'layout' }
    })
    await waitFor(() => {
      expect(findDocumentReaderProps()?.renderMode).toBe('layout')
    })
    const range: ReaderSelectionRange = {
      ...makeLinkedRange('layout-history-range', 'Layout history text'),
      rectsBySelectionId: {}
    }

    // When: Layout Reader 提交一条仅含字符锚点的 EPUB 高亮。
    act(() => {
      findDocumentReaderProps()?.onHighlight?.(range)
    })

    // Then: history 是唯一状态写入路径，普通 callback 只作为通知被记录。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.data?.ranges).toEqual([range])
    })
    expect(info).toHaveBeenCalledWith(
      '[hamster-reader:highlight]',
      expect.objectContaining({
        event: 'demo.history.change',
        source: 'highlight',
        stateOwner: true
      })
    )
    expect(info).toHaveBeenCalledWith(
      '[hamster-reader:highlight]',
      expect.objectContaining({
        event: 'demo.callback.highlight',
        stateOwner: false
      })
    )
  })

  it.each(['legacy.doc', 'component.mdx', 'README', 'archive.zip'])(
    'rejects unsupported upload %s by extension',
    async (fileName) => {
      render(<App />)
      await upload(makeFile(fileName))

      expect(await screen.findByText('Parse Error')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Unsupported file type. Supported: PDF, TXT, DOCX, EPUB, Markdown, and images.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
      expect(PdfParser.encode).not.toHaveBeenCalled()
      expect(EpubParser.encode).not.toHaveBeenCalled()
      expect(TxtParser.encode).not.toHaveBeenCalled()
      expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
      expect(MarkdownParser.encode).not.toHaveBeenCalled()
    }
  )

  it('shows an EPUB parse error when the EPUB parser rejects', async () => {
    vi.mocked(EpubParser.encode).mockRejectedValue(new Error('bad epub'))

    render(<App />)
    const uploadedFile = makeFile('broken.epub')
    await upload(uploadedFile)

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(
      screen.getByText('Failed to parse EPUB: bad epub')
    ).toBeInTheDocument()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(EpubParser.encode).toHaveBeenCalledTimes(1)
    expect(EpubParser.encode).toHaveBeenCalledWith(uploadedFile)
    expect(PdfParser.encode).not.toHaveBeenCalled()
    expect(TxtParser.encode).not.toHaveBeenCalled()
    expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
    expect(MarkdownParser.encode).not.toHaveBeenCalled()
  })

  it('shows a TXT parse error when the TXT parser rejects', async () => {
    vi.mocked(TxtParser.encode).mockRejectedValue(new Error('bad txt'))

    render(<App />)
    const uploadedFile = makeFile('broken.txt')
    await upload(uploadedFile)

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(screen.getByText('Failed to parse TXT: bad txt')).toBeInTheDocument()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(TxtParser.encode).toHaveBeenCalledTimes(1)
    expect(TxtParser.encode).toHaveBeenCalledWith(uploadedFile)
    expect(PdfParser.encode).not.toHaveBeenCalled()
    expect(EpubParser.encode).not.toHaveBeenCalled()
  })

  it('shows a parse error when the parser returns undefined', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(undefined)

    render(<App />)
    const uploadedFile = makeFile('undefined.pdf')
    await upload(uploadedFile)

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(
      screen.getByText('Failed to parse PDF: received undefined result')
    ).toBeInTheDocument()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
  })

  it('shows a parse error when the parser throws', async () => {
    vi.mocked(PdfParser.encode).mockRejectedValue(new Error('bad pdf'))

    render(<App />)
    const uploadedFile = makeFile('broken.pdf')
    await upload(uploadedFile)

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(screen.getByText('Failed to parse PDF: bad pdf')).toBeInTheDocument()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
  })

  it('renders parsed document Reader without errors when OCR and selection props are provided', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('OCR Document')
    )

    render(<App />)
    await upload(makeFile('ocr.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(screen.getByText('OCR Document')).toBeInTheDocument()
  })

  it('controls automatic OCR through the Reader toolbar callback', async () => {
    // Given: 文档已加载，OCR 默认关闭。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Automatic OCR Document')
    )
    render(<App />)
    await upload(makeFile('automatic-ocr.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(findDocumentReaderProps()?.ocr).toBe(false)

    // When: Reader 底栏请求开启 OCR。
    act(() => {
      findDocumentReaderProps()?.onOcrChange?.(true)
    })

    // Then: Reader 进入自动模式，覆盖当前及后续加载页。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toBe(true)
    })

    // When: Reader 底栏请求关闭 OCR。
    act(() => {
      findDocumentReaderProps()?.onOcrChange?.(false)
    })

    // Then: OCR 返回关闭状态。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toBe(false)
    })
  })

  it('restores automatic OCR and completed empty pages after remounting the same file', async () => {
    // Given: 底栏已开启自动 OCR，且第 1 页成功完成但没有识别出文本。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Persisted Automatic OCR Document')
    )
    const file = makeFile('persisted-automatic-ocr.pdf')
    const firstRender = render(<App />)
    await upload(file)
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    act(() => {
      findDocumentReaderProps()?.onOcrChange?.(true)
      const onOcrTextsChange = findDocumentReaderProps()?.onOcrTextsChange
      if (typeof onOcrTextsChange === 'function') {
        onOcrTextsChange(1, [])
      }
    })
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toBe(true)
      expect(findDocumentReaderProps()?.ocrTexts).toEqual({ 1: [] })
    })

    // When: Demo 卸载后重新加载同名文件。
    firstRender.unmount()
    render(<App />)
    await upload(makeFile('persisted-automatic-ocr.pdf'))

    // Then: 自动模式和空结果完成态均恢复，Reader 不会把该页当作未识别。
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toBe(true)
      expect(findDocumentReaderProps()?.ocrTexts).toEqual({ 1: [] })
    })
  })

  it('starts OCR for the entered page and echoes recognized texts back as controlled data', async () => {
    // Given: PDF 解析成功，文档已加载。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('OCR Target Document')
    )

    render(<App />)
    await upload(makeFile('ocr-target.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(findDocumentReaderProps()?.ocr).toBe(false)

    // When: 用户输入页码并点击 OCR 按钮。
    fireEvent.change(screen.getByTestId('ocr-page-input'), {
      target: { value: '2' }
    })
    fireEvent.click(screen.getByTestId('ocr-start-btn'))

    // Then: Reader 收到手动模式 OCR 页码列表，侧栏出现该页标识。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toEqual({
        enabled: true,
        pages: [2]
      })
    })
    expect(screen.getByTestId('ocr-active-page-2')).toBeInTheDocument()

    // When: Reader 完成识别并通过 onOcrTextsChange 回传结果。
    const recognizedTexts = [
      {
        id: 'ocr-2-text-1',
        content: 'recognized text',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10]
        ]
      }
    ]
    act(() => {
      const onOcrTextsChange = findDocumentReaderProps()?.onOcrTextsChange as (
        pageNumber: number,
        texts: unknown[]
      ) => void
      onOcrTextsChange(2, recognizedTexts)
    })

    // Then: 受控 OCR 数据回传给 Reader，且按文件名持久化到 localStorage。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocrTexts).toEqual({
        2: recognizedTexts
      })
    })
    const stored = localStorage.getItem(
      'hamster-reader-demo:ocr:ocr-target.pdf'
    )
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored ?? '{}') as {
      pages: number[]
      textsByPage: Record<string, unknown[]>
    }
    expect(parsed.pages).toEqual([2])
    expect(parsed.textsByPage['2']).toHaveLength(1)
  })

  it('closes OCR per page and globally for the current document', async () => {
    // Given: 文档已加载，且第 1、2 页均已开启 OCR。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('OCR Close Document')
    )

    render(<App />)
    await upload(makeFile('ocr-close.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const pageInput = screen.getByTestId('ocr-page-input')
    fireEvent.change(pageInput, { target: { value: '1' } })
    fireEvent.click(screen.getByTestId('ocr-start-btn'))
    fireEvent.change(pageInput, { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('ocr-start-btn'))
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toEqual({
        enabled: true,
        pages: [1, 2]
      })
    })

    // When: 用户按页关闭第 1 页 OCR。
    fireEvent.click(screen.getByTestId('ocr-close-page-1'))

    // Then: 仅第 2 页保持开启。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toEqual({
        enabled: true,
        pages: [2]
      })
    })
    expect(screen.queryByTestId('ocr-active-page-1')).not.toBeInTheDocument()

    // When: 用户点击「全部关闭」全局关闭 OCR。
    fireEvent.click(screen.getByTestId('ocr-close-all-btn'))

    // Then: 开启列表清空，OCR 全局关闭，侧栏不再展示任何页标识。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toBe(false)
    })
    expect(screen.queryByTestId('ocr-active-pages')).not.toBeInTheDocument()
  })

  it('rejects an OCR page number beyond the document page count', async () => {
    // Given: 单页文档已加载。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      IntermediateDocument.parse(
        makeSerializedDocument('Single Page Document', [
          {
            id: 'single-page-1',
            number: 1,
            width: 100,
            height: 200,
            content: []
          }
        ])
      )
    )

    render(<App />)
    await upload(makeFile('single-page.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    // When: 用户输入超出页数范围的页码并点击 OCR。
    fireEvent.change(screen.getByTestId('ocr-page-input'), {
      target: { value: '99' }
    })
    fireEvent.click(screen.getByTestId('ocr-start-btn'))

    // Then: 展示错误提示，OCR 开启列表保持不变。
    expect(await screen.findByTestId('ocr-error')).toHaveTextContent(
      '页码超出范围'
    )
    expect(findDocumentReaderProps()?.ocr).toBe(false)
  })

  it('restores persisted OCR pages and texts when the file is uploaded again', async () => {
    // Given: localStorage 中已有该文件的 OCR 持久化数据。
    const persistedTexts = [
      {
        id: 'ocr-1-text-1',
        content: 'persisted ocr text',
        polygon: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5]
        ]
      }
    ]
    localStorage.setItem(
      'hamster-reader-demo:ocr:restore-ocr.pdf',
      JSON.stringify({
        version: 1,
        pages: [1],
        textsByPage: { 1: persistedTexts }
      })
    )
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Restored OCR Document')
    )

    // When: 用户重新上传该文件。
    render(<App />)
    await upload(makeFile('restore-ocr.pdf'))

    // Then: OCR 开启列表与受控识别数据被恢复，无需重复 OCR。
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocr).toEqual({
        enabled: true,
        pages: [1]
      })
      expect(findDocumentReaderProps()?.ocrTexts).toEqual({
        1: persistedTexts
      })
    })
    expect(screen.getByTestId('ocr-active-page-1')).toBeInTheDocument()
  })

  it('toggles OCR dev mode and forwards ocrDebug to Reader', async () => {
    // Given: 已上传并解析文档，OCR 控制区可见。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('OCR Dev Mode Document')
    )
    render(<App />)
    await upload(makeFile('ocr-dev-mode.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    // Then: 开发模式默认关闭，Reader 收到 ocrDebug=false。
    const toggle = screen.getByTestId('ocr-dev-mode-toggle')
    expect(toggle).not.toBeChecked()
    expect(findDocumentReaderProps()?.ocrDebug).toBe(false)

    // When: 用户打开开发模式开关。
    fireEvent.click(toggle)

    // Then: Reader 收到 ocrDebug=true（OCR 文字可见并加红色外框）。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.ocrDebug).toBe(true)
    })
  })

  it('provides render mode select that updates Reader prop', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Render Mode Document')
    )

    render(<App />)
    await upload(makeFile('rendermode.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const select = screen.getByTestId('render-mode-select')
    expect(select).toHaveValue('layout')
    expect(select).toHaveTextContent('Layout')
    expect(select).toHaveTextContent('Text')

    let readerProps = findDocumentReaderProps()
    expect(readerProps?.renderMode).toBe('layout')

    fireEvent.change(select, { target: { value: 'text' } })

    await waitFor(() => {
      readerProps = findDocumentReaderProps()
      expect(select).toHaveValue('text')
      expect(readerProps?.renderMode).toBe('text')
    })
  })

  it('keeps Text mode linked highlights when switching back to Layout', async () => {
    // Given: 已加载文档并切换到 Text 模式。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Text Highlight Roundtrip Document')
    )
    render(<App />)
    await upload(makeFile('text-highlight-roundtrip.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    const renderModeSelect = screen.getByTestId('render-mode-select')
    fireEvent.change(renderModeSelect, { target: { value: 'text' } })

    const canonicalRange: ReaderSelectionRange = {
      id: 'text-highlight-1',
      text: 'Text highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 4 },
      createdAt: 1,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 20, width: 30, height: 4 }]
      }
    }

    // When: Text viewer 发布 canonical linked-data 快照，随后用户切回 Layout。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.renderMode).toBe('text')
    })
    act(() => {
      findDocumentReaderProps()?.onLinkedDataChange?.({
        items: [canonicalRange],
        selectionOrder: [canonicalRange.id],
        selectedRangeId: canonicalRange.id,
        activeRange: null
      })
    })
    fireEvent.change(renderModeSelect, { target: { value: 'layout' } })

    // Then: Layout Reader 继续收到同一条 canonical range。
    await waitFor(() => {
      const readerProps = findDocumentReaderProps()
      expect(readerProps?.renderMode).toBe('layout')
      expect(readerProps?.data?.ranges).toEqual([canonicalRange])
    })
  })

  it('keeps a manually committed Text highlight when switching back to Layout', async () => {
    // Given: 已加载文档并切换到 Text 模式。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Manual Text Highlight Roundtrip Document')
    )
    render(<App />)
    await upload(makeFile('manual-text-highlight-roundtrip.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    const renderModeSelect = screen.getByTestId('render-mode-select')
    fireEvent.change(renderModeSelect, { target: { value: 'text' } })

    const canonicalRange: ReaderSelectionRange = {
      id: 'manual-text-highlight-1',
      text: 'Manual text highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 4 },
      createdAt: 1,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 20, width: 30, height: 4 }]
      }
    }

    // When: 用户通过 Text popover 手动提交高亮，随后切回 Layout。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.renderMode).toBe('text')
    })
    act(() => {
      findDocumentReaderProps()?.onHighlight?.(canonicalRange)
    })
    fireEvent.change(renderModeSelect, { target: { value: 'layout' } })

    // Then: Layout Reader 继续收到手动提交的 canonical range。
    await waitFor(() => {
      const readerProps = findDocumentReaderProps()
      expect(readerProps?.renderMode).toBe('layout')
      expect(readerProps?.data?.ranges).toEqual([canonicalRange])
    })
  })

  it('provides touch pan mode select that updates Reader prop', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Touch Pan Mode Document')
    )

    render(<App />)
    await upload(makeFile('touchpanmode.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const select = screen.getByTestId('touch-pan-mode-select')
    expect(select).toHaveValue('single-finger')
    expect(select).toHaveTextContent('单指 Single-finger')
    expect(select).toHaveTextContent('双指 Two-finger')

    let readerProps = findDocumentReaderProps()
    expect(readerProps?.touchPanMode).toBe('single-finger')

    fireEvent.change(select, { target: { value: 'two-finger' } })

    await waitFor(() => {
      readerProps = findDocumentReaderProps()
      expect(select).toHaveValue('two-finger')
      expect(readerProps?.touchPanMode).toBe('two-finger')
    })
  })

  it('provides drawing in the tool selector and forwards it to Reader', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Drawing Tool Document')
    )

    render(<App />)
    await upload(makeFile('drawing-tool.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const select = screen.getByTestId('selection-tool-select')
    expect(select).toHaveValue('text-selection')
    expect(select).toHaveTextContent('绘图 Drawing')

    fireEvent.change(select, { target: { value: 'drawing' } })

    await waitFor(() => {
      expect(select).toHaveValue('drawing')
      expect(findDocumentReaderProps()?.selectedTool).toBe('drawing')
      expect(findDocumentReaderProps()?.data?.pagePaintings).toEqual({})
      expect(findDocumentReaderProps()?.onPagePaintingsChange).toBeTypeOf(
        'function'
      )
    })
  })

  it('forwards default bottom bar state and callbacks to Reader', async () => {
    // Given: Demo 已加载支持字号控制的 PDF，并由 Reader 自己渲染默认底栏。
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Reader Bottom Bar Contract')
    )
    render(<App />)
    await upload(makeFile('reader-bottom-bar-contract.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const initialProps = findDocumentReaderProps()
    expect(initialProps).toMatchObject({
      renderMode: 'layout',
      fontScale: 1.5,
      touchPanMode: 'single-finger',
      edgeCropEditing: false,
      selectedTool: 'text-selection',
      drawingStrokeColor: '#7d9ec0'
    })
    expect(initialProps?.data).toMatchObject({
      renderMode: 'layout',
      selectedTool: 'text-selection'
    })
    expect(initialProps?.colors).toEqual([
      { name: 'blue', color: '#7d9ec0' },
      { name: 'green', color: '#8eba8e' },
      { name: 'sand', color: '#d1b88a' },
      { name: 'rose', color: '#cf9cab' },
      { name: 'lavender', color: '#a99fc4' },
      { name: 'black', color: '#2a2a2a' }
    ])
    expect(initialProps?.onRenderModeChange).toBeTypeOf('function')
    expect(initialProps?.onFontScaleChange).toBeTypeOf('function')
    expect(initialProps?.onTouchPanModeChange).toBeTypeOf('function')
    expect(initialProps?.onEdgeCropEditingChange).toBeTypeOf('function')
    expect(initialProps?.onSelectedToolChange).toBeTypeOf('function')
    expect(initialProps?.onDrawingStrokeColorChange).toBeTypeOf('function')

    // When: Reader 默认底栏通过回调修改所有受控值。
    act(() => {
      initialProps?.onFontScaleChange?.(0.5)
      initialProps?.onTouchPanModeChange?.('two-finger')
      initialProps?.onEdgeCropEditingChange?.(true)
      initialProps?.onSelectedToolChange?.('drawing')
      initialProps?.onDrawingStrokeColorChange?.('#8eba8e')
    })

    // Then: Demo 将新值回传给 Reader，设置面板也与同一状态同步。
    await waitFor(() => {
      expect(findDocumentReaderProps()).toMatchObject({
        fontScale: 0.5,
        touchPanMode: 'two-finger',
        edgeCropEditing: true,
        selectedTool: 'drawing',
        drawingStrokeColor: '#8eba8e'
      })
      expect(screen.getByTestId('selection-tool-select')).toHaveValue('drawing')
      expect(screen.getByTestId('touch-pan-mode-select')).toHaveValue(
        'two-finger'
      )
    })

    // When: 默认底栏切换到 Text 模式。
    act(() => {
      findDocumentReaderProps()?.onRenderModeChange?.('text')
    })

    // Then: Demo 同步模式，并退出仅 Layout 可用的裁边编辑。
    await waitFor(() => {
      expect(findDocumentReaderProps()).toMatchObject({
        renderMode: 'text',
        edgeCropEditing: false
      })
      expect(screen.getByTestId('render-mode-select')).toHaveValue('text')
    })
  })

  it('restores legacy reader preferences and persists all preferences per file', async () => {
    // Given: 当前文件已有持久化的阅读偏好。
    localStorage.clear()
    localStorage.setItem(
      'hamster-reader-demo:preferences:reader-preferences.pdf',
      JSON.stringify({
        version: 1,
        renderMode: 'text',
        selectedTool: 'drawing'
      })
    )
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Reader Preferences Document')
    )

    // When: 用户重新上传同名文件。
    render(<App />)
    await upload(makeFile('reader-preferences.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    // Then: Reader 从统一 data 中恢复模式与工具。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.data).toMatchObject({
        renderMode: 'text',
        selectedTool: 'drawing'
      })
      expect(screen.getByTestId('render-mode-select')).toHaveValue('text')
      expect(screen.getByTestId('selection-tool-select')).toHaveValue('drawing')
      expect(findDocumentReaderProps()).toMatchObject({
        fontScale: 1.5,
        highlightColor: 'rgba(255, 193, 7, 0.35)'
      })
    })

    // When: Reader 更新 Text 字号和高亮色，再切换到 Layout 更新另一端字号。
    const readerProps = findDocumentReaderProps()
    act(() => {
      readerProps?.onFontScaleChange?.(0.75)
      readerProps?.onHighlightColorChange?.('#ff0000')
      readerProps?.onDataChange?.({
        ...readerProps.data,
        renderMode: 'layout',
        selectedTool: 'rect-selection'
      })
    })
    await waitFor(() => {
      expect(findDocumentReaderProps()).toMatchObject({
        renderMode: 'layout',
        fontScale: 1.5
      })
    })
    act(() => {
      findDocumentReaderProps()?.onFontScaleChange?.(2)
    })

    // Then: Demo 保存模式、工具、两种模式各自字号及当前高亮色。
    await waitFor(() => {
      expect(findDocumentReaderProps()?.data).toMatchObject({
        renderMode: 'layout',
        selectedTool: 'rect-selection'
      })
      expect(
        localStorage.getItem(
          'hamster-reader-demo:preferences:reader-preferences.pdf'
        )
      ).toBe(
        JSON.stringify({
          version: 2,
          renderMode: 'layout',
          selectedTool: 'rect-selection',
          textFontScale: 0.75,
          layoutFontScale: 2,
          highlightColor: '#ff0000'
        })
      )
    })

    // When: 切回 Text Mode。
    act(() => {
      findDocumentReaderProps()?.onRenderModeChange?.('text')
    })

    // Then: Text Mode 恢复自己的字号，颜色选择保持不变。
    await waitFor(() => {
      expect(findDocumentReaderProps()).toMatchObject({
        renderMode: 'text',
        fontScale: 0.75,
        highlightColor: '#ff0000'
      })
    })
  })

  it('exposes edge crop and hidden-page data controls', async () => {
    // Given: a parsed document is rendered with the unified data model.
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Page Display Data Document')
    )
    render(<App />)
    await upload(makeFile('page-display-data.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    // When: the demo enables global crop, a page override, and page hiding.
    fireEvent.click(screen.getByTestId('global-edge-crop-toggle'))
    fireEvent.click(screen.getByTestId('special-edge-crop-toggle'))
    fireEvent.click(screen.getByTestId('hide-second-page-toggle'))

    // Then: Reader receives every setting through props.data.
    await waitFor(() => {
      expect(findDocumentReaderProps()?.data).toMatchObject({
        edgeCrop: {
          all: { top: 0.1, right: 0.2, bottom: 0.05, left: 0.15 },
          pages: {
            'page-1': { top: 0.02, right: 0.05, bottom: 0.2, left: 0.25 }
          }
        },
        hiddenPages: [2]
      })
    })
  })

  it('toggles edge crop editing mode and applies crop via onEdgeCropApply', async () => {
    // Given: 已解析的文档已渲染
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Edge Crop Edit Document')
    )
    render(<App />)
    await upload(makeFile('edge-crop-edit.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    // 初始状态：编辑模式关闭
    expect(findDocumentReaderProps()?.edgeCropEditing).toBe(false)

    // When: 勾选编辑模式开关
    fireEvent.click(screen.getByTestId('edge-crop-edit-toggle'))

    // Then: Reader 收到 edgeCropEditing=true
    await waitFor(() => {
      expect(findDocumentReaderProps()?.edgeCropEditing).toBe(true)
    })

    // When: 调用 onEdgeCropApply 应用到第 1 页
    const pageCrop: ReaderEdgeCrop = {
      top: 0.1,
      right: 0.1,
      bottom: 0.1,
      left: 0.1
    }
    await act(async () => {
      findDocumentReaderProps()?.onEdgeCropApply?.(1, pageCrop)
    })

    // Then: 裁切值写入 data.edgeCrop.pages['page-1']，且编辑模式退出
    await waitFor(() => {
      expect(
        findDocumentReaderProps()?.data?.edgeCrop?.pages?.['page-1']
      ).toEqual(pageCrop)
      expect(findDocumentReaderProps()?.edgeCropEditing).toBe(false)
    })

    // When: 再次开启编辑模式，调用 onEdgeCropApply(null, crop) 应用到所有页
    fireEvent.click(screen.getByTestId('edge-crop-edit-toggle'))
    await waitFor(() => {
      expect(findDocumentReaderProps()?.edgeCropEditing).toBe(true)
    })

    const allCrop: ReaderEdgeCrop = {
      top: 0.2,
      right: 0.05,
      bottom: 0.1,
      left: 0.05
    }
    await act(async () => {
      findDocumentReaderProps()?.onEdgeCropApply?.(null, allCrop)
    })

    // Then: 裁切值写入 data.edgeCrop.all，且编辑模式退出
    await waitFor(() => {
      expect(findDocumentReaderProps()?.data?.edgeCrop?.all).toEqual(allCrop)
      expect(findDocumentReaderProps()?.edgeCropEditing).toBe(false)
    })
  })

  it('hides touch pan mode select when render mode is text', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Text Mode Touch Pan Document')
    )

    render(<App />)
    await upload(makeFile('textmode-touchpan.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    expect(screen.getByTestId('touch-pan-mode-select')).toBeInTheDocument()

    const renderModeSelect = screen.getByTestId('render-mode-select')
    fireEvent.change(renderModeSelect, { target: { value: 'text' } })

    await waitFor(() => {
      expect(
        screen.queryByTestId('touch-pan-mode-select')
      ).not.toBeInTheDocument()
    })
  })

  it('logs selection events when callbacks are invoked', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Callback Document')
    )

    render(<App />)
    await upload(makeFile('callback.pdf'))

    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const mockText = { id: 'text-1', content: 'Hello' }
    const mockDetail = {
      text: mockText,
      texts: [mockText],
      selectedText: 'Hello',
      pageNumber: 1,
      selection: {} as Selection
    }

    mockCallbacks.onTextSelectionChange?.(mockText, mockDetail)
    mockCallbacks.onTextSelectionEnd?.(mockText, mockDetail)

    expect(consoleSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('does not log upload Reader selection payloads', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('SelectText Document')
    )

    render(<App />)
    await upload(makeFile('selecttext.pdf'))

    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const uploadReaderProps = mockReaderProps.find(
      (
        props
      ): props is {
        emptyText?: string
        onSelectText?: (...args: unknown[]) => unknown
      } =>
        typeof props === 'object' &&
        props !== null &&
        'emptyText' in props &&
        (props as { emptyText?: string }).emptyText === 'No document loaded'
    )

    uploadReaderProps?.onSelectText?.(
      { isCollapsed: false } as unknown as Selection,
      [{ selectedText: 'Hello' }],
      'Hello'
    )

    expect(consoleSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('ignores stale parser results after a replacement upload', async () => {
    const staleRequest = createDeferred<IntermediateDocument>()
    const freshRequest = createDeferred<IntermediateDocument>()

    vi.mocked(TxtParser.encode)
      .mockReturnValueOnce(staleRequest.promise)
      .mockReturnValueOnce(freshRequest.promise)

    render(<App />)
    await upload(makeFile('stale.txt'))
    await waitFor(() => expect(TxtParser.encode).toHaveBeenCalledTimes(1))
    await upload(makeFile('fresh.txt'))
    await waitFor(() => expect(TxtParser.encode).toHaveBeenCalledTimes(2))

    freshRequest.resolve(makeRuntimeDocument('Fresh Document'))

    expect(await screen.findByText('Fresh Document')).toBeInTheDocument()

    staleRequest.resolve(makeRuntimeDocument('Stale Document'))

    await waitFor(() => {
      expect(screen.queryByText('Stale Document')).not.toBeInTheDocument()
      expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
      expect(screen.queryByText('Parsing...')).not.toBeInTheDocument()
    })
  })

  describe('demo highlighting interactions', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockReaderProps.length = 0
      localStorage.clear()
      resetMockHistory()
    })

    it('provides autoHighlight toggle that updates Reader prop', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Auto Highlight Document')
      )
      render(<App />)
      await upload(makeFile('auto.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const toggle = screen.getByTestId('auto-highlight-toggle')
      expect(toggle).not.toBeChecked()

      let uploadReaderProps = findDocumentReaderProps()
      expect(uploadReaderProps?.autoHighlight).toBe(false)

      fireEvent.click(toggle)
      expect(toggle).toBeChecked()

      await waitFor(() => {
        uploadReaderProps = findDocumentReaderProps()
        expect(uploadReaderProps?.autoHighlight).toBe(true)
      })
    })

    it('renders selectionPopover with 高亮 and 背景颜色设置', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Popover Document')
      )
      render(<App />)
      await upload(makeFile('popover.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const popover = render(
        uploadReaderProps?.selectionPopover as React.ReactElement
      )
      expect(popover.getByText('高亮')).toBeInTheDocument()
      expect(popover.getByText('背景颜色设置')).toBeInTheDocument()

      const colorInput = popover.container.querySelector('input[type="color"]')
      expect(colorInput).toBeInTheDocument()
    })

    it('renders highlightPopover with 删除 and 背景颜色设置', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Highlight Popover Document')
      )
      render(<App />)
      await upload(makeFile('hpopover.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const range = makeLinkedRange('popover-range', 'popover highlight')
      const popover = renderHighlightPopover(uploadReaderProps, range)
      expect(popover.getByText('删除')).toBeInTheDocument()
      expect(popover.getByText('背景颜色设置')).toBeInTheDocument()
    })

    it('uses the existing highlight color in highlightPopover', async () => {
      // Given: 全局颜色保持默认值，但已有高亮保存了自己的颜色。
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Own Highlight Color Document')
      )
      render(<App />)
      await upload(makeFile('own-highlight-color.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range: ReaderSelectionRange = {
        ...makeLinkedRange('own-color-range', 'own color text'),
        markerStyle: { backgroundColor: '#ff3366' }
      }

      // When: 宿主使用 Reader 提供的原始高亮数据渲染 Popover。
      const popover = renderHighlightPopover(findDocumentReaderProps(), range)

      // Then: 颜色输入优先显示该高亮自身颜色，而不是全局颜色。
      expect(popover.getByLabelText('Highlight color')).toHaveValue('#ff3366')
    })

    it('forwards independent top and bottom margins from the settings', async () => {
      // Given: Demo 已加载可配置 Reader。
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Independent Margins Document')
      )
      render(<App />)
      await upload(makeFile('independent-margins.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      // When: 分别设置顶部和底部留白。
      fireEvent.change(screen.getByTestId('contain-margin-top-input'), {
        target: { value: '32' }
      })
      fireEvent.change(screen.getByTestId('contain-margin-bottom-input'), {
        target: { value: '64' }
      })

      // Then: Reader 接收两个独立值，Demo 不再传旧的统一垂直留白。
      await waitFor(() => {
        const readerProps = findDocumentReaderProps()
        expect(readerProps?.containMarginTop).toBe(32)
        expect(readerProps?.containMarginBottom).toBe(64)
        expect(readerProps).not.toHaveProperty('containMarginY')
      })
    })

    it('resolves highlight comments with the original range reference', async () => {
      // Given: Reader 请求宿主为一个已有高亮开启评论流程。
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Highlight Comment Document')
      )
      render(<App />)
      await upload(makeFile('highlight-comment.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('comment-range', 'comment target text')
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      // When: 回调立即 resolve 并打开 CommentPanel。
      const result = await callback(range)

      // Then: Promise 返回同一个 range 引用，CommentPanel 可见。
      expect(result).toBe(range)
      expect(await screen.findByTestId('comment-panel')).toBeInTheDocument()
    })

    it('does not store a highlight on selection end when autoHighlight is false', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('No Auto Highlight Document')
      )
      render(<App />)
      await upload(makeFile('no-auto.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const onSelectionEnd = uploadReaderProps?.onSelectionEnd as () => void
      onSelectionEnd()

      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
    })

    it('calls selectionRef.current?.highlight() when 高亮 is clicked', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Manual Highlight Document')
      )
      render(<App />)
      await upload(makeFile('manual.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const confirmSpy = vi.fn()
      const refFromProps =
        uploadReaderProps?.selectionRef as React.MutableRefObject<unknown>

      refFromProps.current = {
        highlight: vi.fn(),
        confirm: confirmSpy,
        confirmRect: vi.fn(),
        clear: vi.fn()
      }

      const popover = render(
        uploadReaderProps?.selectionPopover as React.ReactElement
      )
      fireEvent.click(popover.getByText('高亮'))

      expect(confirmSpy).toHaveBeenCalledTimes(1)
    })

    it('changes the highlightColor prop when color input is changed', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Color Document')
      )
      render(<App />)
      await upload(makeFile('color.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      let uploadReaderProps = findDocumentReaderProps()

      const popover = render(
        uploadReaderProps?.selectionPopover as React.ReactElement
      )
      const colorInput = popover.container.querySelector(
        'input[type="color"]'
      ) as HTMLInputElement

      fireEvent.change(colorInput, { target: { value: '#ff0000' } })

      await waitFor(() => {
        uploadReaderProps = findDocumentReaderProps()
        expect(uploadReaderProps?.highlightColor).toBe('#ff0000')
      })
    })

    it('updates the selected range markerStyle when highlightPopover color input is changed', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Highlight Color Document')
      )
      render(<App />)
      await upload(makeFile('highlight-color.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      let uploadReaderProps = findDocumentReaderProps()

      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      const range = makeLinkedRange('highlight-color-range', 'highlight text')
      onHighlight(range)

      expect(await screen.findByText('highlight text')).toBeInTheDocument()

      const onSelectRange = uploadReaderProps?.onSelectRange as (
        id: string
      ) => void
      onSelectRange('highlight-color-range')

      await waitFor(() => {
        uploadReaderProps = findDocumentReaderProps()
        expect(uploadReaderProps?.selectedRangeId).toBe('highlight-color-range')
      })

      const popover = renderHighlightPopover(uploadReaderProps, range)
      const colorInput = popover.container.querySelector(
        'input[type="color"]'
      ) as HTMLInputElement

      fireEvent.change(colorInput, { target: { value: '#ff0000' } })

      await waitFor(() => {
        uploadReaderProps = findDocumentReaderProps()
        const ranges = uploadReaderProps?.data?.ranges
        const selectedRange = ranges?.find(
          (range) => range?.markerStyle?.backgroundColor === '#ff0000'
        )
        expect(selectedRange).toBeDefined()
      })
    })

    it('removes range by id and clears selectedRangeId when 删除 is clicked', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Delete Document')
      )
      render(<App />)
      await upload(makeFile('delete.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      let uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      const range = makeLinkedRange('del-range', 'text to delete')
      onHighlight(range)

      expect(await screen.findByText('text to delete')).toBeInTheDocument()

      const onSelectRange = uploadReaderProps?.onSelectRange as (
        id: string
      ) => void

      onSelectRange('del-range')

      await waitFor(() => {
        uploadReaderProps = mockReaderProps[
          mockReaderProps.length - 1
        ] as Record<string, unknown>
        expect(uploadReaderProps?.selectedRangeId).toBe('del-range')
      })

      const popover = renderHighlightPopover(uploadReaderProps, range)

      const deleteButton = popover.container.querySelector('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
      }

      await waitFor(() => {
        const elements = screen.queryAllByText('text to delete')
        expect(elements).toHaveLength(0)
      })

      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('delete.pdf')) || '{}'
      )
      expect(stored).toEqual({
        version: 4,
        ranges: [],
        rects: [],
        paintings: {}
      })

      uploadReaderProps = mockReaderProps[mockReaderProps.length - 1] as Record<
        string,
        unknown
      >
      expect(uploadReaderProps?.selectedRangeId).toBe(null)
    })

    it('stores exactly one range even if both onSelect and onHighlight are triggered', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Single Store Document')
      )
      render(<App />)
      await upload(makeFile('single.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      const onSelect = uploadReaderProps?.onSelect as (range: unknown) => void

      const range = makeLinkedRange('single-range', 'single text')
      onHighlight(range)
      onSelect(range)

      expect(await screen.findByText('已创建高亮 (1)')).toBeInTheDocument()
      expect(screen.getAllByText('single text')).toHaveLength(1)
    })

    it('sets selectedRangeId and calls scrollToRange when sidebar highlight item is clicked', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Sidebar Click Document')
      )
      render(<App />)
      await upload(makeFile('sidebar-click.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = findDocumentReaderProps()
      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('sidebar-range', 'sidebar text'))

      expect(await screen.findByText('sidebar text')).toBeInTheDocument()

      const refObj = uploadReaderProps?.selectionRef as React.MutableRefObject<{
        scrollToRange: ReturnType<typeof vi.fn>
      } | null>

      fireEvent.click(screen.getByText('sidebar text'))

      await waitFor(() => {
        const updatedProps = findDocumentReaderProps()
        expect(updatedProps?.selectedRangeId).toBe('sidebar-range')
      })
      expect(refObj.current?.scrollToRange).toHaveBeenCalledWith(
        'sidebar-range'
      )
      expect(refObj.current?.scrollToRange).toHaveBeenCalledTimes(1)
    })

    it('clicking the same sidebar highlight twice keeps it selected and calls scrollToRange twice', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Double Click Document')
      )
      render(<App />)
      await upload(makeFile('double-click.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = findDocumentReaderProps()
      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('dc-range', 'double click text'))

      expect(await screen.findByText('double click text')).toBeInTheDocument()

      const refObj = uploadReaderProps?.selectionRef as React.MutableRefObject<{
        scrollToRange: ReturnType<typeof vi.fn>
      } | null>

      fireEvent.click(screen.getByText('double click text'))
      fireEvent.click(screen.getByText('double click text'))

      await waitFor(() => {
        const updatedProps = findDocumentReaderProps()
        expect(updatedProps?.selectedRangeId).toBe('dc-range')
      })
      expect(refObj.current?.scrollToRange).toHaveBeenCalledTimes(2)
      expect(refObj.current?.scrollToRange).toHaveBeenCalledWith('dc-range')
    })

    it('selects rect and text highlights exclusively and scrolls rect with scrollToRect', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Rect Sidebar Document')
      )
      render(<App />)
      await upload(makeFile('rect-sidebar.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = findDocumentReaderProps()
      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('text-item', 'text item'))

      const onCreateRect = uploadReaderProps?.onCreateRect as (
        rect: unknown
      ) => void
      onCreateRect({
        id: 'rect-item',
        createdAt: 1,
        overlayRectType: 'percent',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        selectionId: 'page-1',
        rect: { x: 10, y: 20, width: 30, height: 40 }
      })

      expect(await screen.findByText('text item')).toBeInTheDocument()
      expect(await screen.findByText('矩形 rect-item')).toBeInTheDocument()

      const refObj = uploadReaderProps?.selectionRef as React.MutableRefObject<{
        scrollToRect: ReturnType<typeof vi.fn>
      } | null>

      fireEvent.click(screen.getByText('矩形 rect-item'))
      await waitFor(() => {
        const updatedProps = findDocumentReaderProps()
        expect(updatedProps?.selectedRectId).toBe('rect-item')
      })
      expect(findDocumentReaderProps()?.selectedRangeId).toBeNull()
      expect(refObj.current?.scrollToRect).toHaveBeenCalledWith('rect-item')

      fireEvent.click(screen.getByText('text item'))
      await waitFor(() => {
        const updatedProps = findDocumentReaderProps()
        expect(updatedProps?.selectedRangeId).toBe('text-item')
      })
      expect(findDocumentReaderProps()?.selectedRectId).toBeNull()
    })

    it('delete and clear do not call scrollToRange', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('No Scroll Delete Document')
      )
      render(<App />)
      await upload(makeFile('no-scroll-delete.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      let uploadReaderProps = findDocumentReaderProps()
      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      const range = makeLinkedRange(
        'no-scroll-del',
        'text for no scroll delete'
      )
      onHighlight(range)

      expect(
        await screen.findByText('text for no scroll delete')
      ).toBeInTheDocument()

      const refObj = uploadReaderProps?.selectionRef as React.MutableRefObject<{
        scrollToRange: ReturnType<typeof vi.fn>
      } | null>

      const onSelectRange = uploadReaderProps?.onSelectRange as (
        id: string
      ) => void
      onSelectRange('no-scroll-del')

      await waitFor(() => {
        const nextReaderProps = findDocumentReaderProps()
        if (!nextReaderProps) {
          throw new Error('Expected document Reader props')
        }
        uploadReaderProps = nextReaderProps
        expect(uploadReaderProps?.selectedRangeId).toBe('no-scroll-del')
      })

      const popover = renderHighlightPopover(uploadReaderProps, range)
      const deleteButton = popover.container.querySelector('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
      }

      await waitFor(() => {
        expect(
          screen.queryByText('text for no scroll delete')
        ).not.toBeInTheDocument()
      })

      expect(refObj.current?.scrollToRange).not.toHaveBeenCalled()
    })

    it('null selectionRef does not throw and still updates selectedRangeId', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Null Ref Document')
      )
      render(<App />)
      await upload(makeFile('null-ref.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = findDocumentReaderProps()
      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('null-ref-range', 'null ref text'))

      expect(await screen.findByText('null ref text')).toBeInTheDocument()

      const refObj =
        uploadReaderProps?.selectionRef as React.MutableRefObject<null>
      refObj.current = null

      expect(() => {
        fireEvent.click(screen.getByText('null ref text'))
      }).not.toThrow()

      await waitFor(() => {
        const updatedProps = findDocumentReaderProps()
        expect(updatedProps?.selectedRangeId).toBe('null-ref-range')
      })
    })

    it('absent selectionRef.current does not throw and still updates selectedRangeId', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Absent Ref Current Document')
      )
      render(<App />)
      await upload(makeFile('absent-ref-current.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = findDocumentReaderProps()
      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('absent-ref-range', 'absent ref text'))

      expect(await screen.findByText('absent ref text')).toBeInTheDocument()

      const refObj =
        uploadReaderProps?.selectionRef as React.MutableRefObject<unknown>
      refObj.current = undefined

      expect(() => {
        fireEvent.click(screen.getByText('absent ref text'))
      }).not.toThrow()

      await waitFor(() => {
        const updatedProps = findDocumentReaderProps()
        expect(updatedProps?.selectedRangeId).toBe('absent-ref-range')
      })
      expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
    })
  })

  describe('demo highlighting persistence', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockReaderProps.length = 0
      localStorage.clear()
      resetMockHistory()
    })

    it('defaults to no highlights on fresh render with empty localStorage', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Clean Document')
      )

      render(<App />)
      await upload(makeFile('clean.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
    })

    it('restores the most recently parsed file when the demo mounts after a reload', async () => {
      const recentFile = new File(['restored'], 'recent.txt', {
        type: 'text/plain'
      })
      const range = makeLinkedRange('recent-range', 'restored highlight')
      localStorage.setItem(
        highlightStorageKey(recentFile.name),
        JSON.stringify({
          version: 4,
          ranges: [range],
          rects: [],
          paintings: {}
        })
      )
      localStorage.setItem(
        commentStorageKey(recentFile.name),
        JSON.stringify({
          version: 2,
          comments: [
            {
              id: 'recent-comment',
              highlightIds: [range.id],
              content: 'restored comment after reload',
              createdAt: 1000,
              parentId: null
            }
          ]
        })
      )
      vi.mocked(loadRecentFile).mockResolvedValue(recentFile)
      vi.mocked(TxtParser.encode).mockResolvedValue(
        makeRuntimeDocument('Restored After Reload')
      )

      render(<App />)

      await waitFor(() => expect(TxtParser.encode).toHaveBeenCalledOnce())
      expect(
        await screen.findByText('Restored After Reload')
      ).toBeInTheDocument()
      expect(await screen.findByText('restored highlight')).toBeInTheDocument()
      // 内联评论展示已移除，改为检查 Reader 接收的 comments prop
      await waitFor(() => {
        expect(findDocumentReaderProps()?.comments).toMatchObject([
          {
            id: 'recent-comment',
            highlightIds: [range.id],
            content: 'restored comment after reload',
            createdAt: 1000,
            parentId: null
          }
        ])
      })
      expect(TxtParser.encode).toHaveBeenCalledWith(recentFile)
    })

    it('keeps a replacement file control available after restoring a recent file', async () => {
      const recentFile = new File(['restored'], 'recent.txt', {
        type: 'text/plain'
      })
      vi.mocked(loadRecentFile).mockResolvedValue(recentFile)
      vi.mocked(TxtParser.encode).mockResolvedValue(
        makeRuntimeDocument('Restored Document')
      )

      render(<App />)

      expect(await screen.findByText('Restored Document')).toBeInTheDocument()
      expect(screen.getByLabelText('Choose another file')).toBeInTheDocument()
    })

    it('keeps a manually selected file when recent-file loading finishes later', async () => {
      // Given：最近文件仍在异步读取，而用户选择的文件可以立即解析。
      const recentFileLoad = createDeferred<File | null>()
      const recentFile = new File(['restored'], 'recent.txt', {
        type: 'text/plain'
      })
      const selectedFile = makeFile('selected.pdf')
      vi.mocked(loadRecentFile).mockReturnValue(recentFileLoad.promise)
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Manually Selected Document')
      )
      vi.mocked(TxtParser.encode).mockResolvedValue(
        makeRuntimeDocument('Delayed Recent Document')
      )

      render(<App />)

      // When：用户先完成手动选择，随后 IndexedDB 才返回旧文件。
      await upload(selectedFile)
      expect(
        await screen.findByText('Manually Selected Document')
      ).toBeInTheDocument()
      await act(async () => {
        recentFileLoad.resolve(recentFile)
      })

      // Then：延迟恢复不能覆盖用户主动选择，也不能重新解析或保存旧文件。
      expect(screen.getByText('Manually Selected Document')).toBeInTheDocument()
      expect(
        screen.queryByText('Delayed Recent Document')
      ).not.toBeInTheDocument()
      expect(TxtParser.encode).not.toHaveBeenCalled()
      expect(saveRecentFile).toHaveBeenCalledOnce()
      expect(saveRecentFile).toHaveBeenCalledWith(selectedFile)
    })

    it('discloses local file persistence and lets the user clear it', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Cached Document')
      )

      render(<App />)
      await upload(makeFile('cached.pdf'))

      expect(await screen.findByText('Cached Document')).toBeInTheDocument()
      expect(
        screen.getByText('The last successful file is stored in this browser.')
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Forget saved file' }))

      await waitFor(() => {
        expect(clearRecentFile).toHaveBeenCalledTimes(1)
      })
    })

    it('serializes recent file saves so the latest upload remains cached', async () => {
      const firstSave = createDeferred<boolean>()
      vi.mocked(PdfParser.encode)
        .mockResolvedValueOnce(makeRuntimeDocument('First Document'))
        .mockResolvedValueOnce(makeRuntimeDocument('Second Document'))
      vi.mocked(saveRecentFile)
        .mockReturnValueOnce(firstSave.promise)
        .mockResolvedValueOnce(true)

      render(<App />)
      const firstFile = makeFile('first.pdf')
      const secondFile = makeFile('second.pdf')

      await upload(firstFile)
      await waitFor(() => {
        expect(saveRecentFile).toHaveBeenCalledWith(firstFile)
      })

      await upload(secondFile)
      await waitFor(() => {
        expect(PdfParser.encode).toHaveBeenCalledTimes(2)
      })
      expect(saveRecentFile).toHaveBeenCalledTimes(1)

      firstSave.resolve(true)

      await waitFor(() => {
        expect(saveRecentFile).toHaveBeenNthCalledWith(2, secondFile)
      })
      expect(await screen.findByText('Second Document')).toBeInTheDocument()
    })

    it('preserves stored comments while a newly uploaded file is still parsing', async () => {
      const fileName = 'comment-restore.pdf'
      const range = makeLinkedRange('comment-restore-range', 'restored text')
      const storedComments = {
        version: 2,
        comments: [
          {
            id: 'comment-1',
            highlightIds: [range.id],
            content: 'persisted note',
            createdAt: 1000,
            parentId: null
          }
        ]
      }
      const pendingParse = createDeferred<IntermediateDocument | undefined>()

      localStorage.setItem(
        highlightStorageKey(fileName),
        JSON.stringify({
          version: 4,
          ranges: [range],
          rects: [],
          paintings: {}
        })
      )
      localStorage.setItem(
        commentStorageKey(fileName),
        JSON.stringify(storedComments)
      )
      vi.mocked(PdfParser.encode).mockReturnValue(pendingParse.promise)

      render(<App />)
      await upload(makeFile(fileName))

      expect(localStorage.getItem(commentStorageKey(fileName))).toBe(
        JSON.stringify(storedComments)
      )

      pendingParse.resolve(makeRuntimeDocument('Comment Restore Document'))

      expect(
        await screen.findByText('Comment Restore Document')
      ).toBeInTheDocument()
      // 评论已从 localStorage 恢复并传递给 Reader（CommentPanel 仅在打开时显示）
      await waitFor(() => {
        expect(findDocumentReaderProps()?.comments).toMatchObject([
          {
            id: 'comment-1',
            highlightIds: [range.id],
            content: 'persisted note',
            parentId: null
          }
        ])
      })
      expect(localStorage.getItem(commentStorageKey(fileName))).toBe(
        JSON.stringify(storedComments)
      )
    })

    it('persists comment edits while the same file is being parsed again', async () => {
      const fileName = 'comment-reupload.pdf'
      const range = makeLinkedRange('comment-reupload-range', 'reupload text')
      const pendingParse = createDeferred<IntermediateDocument | undefined>()

      vi.mocked(PdfParser.encode).mockResolvedValueOnce(
        makeRuntimeDocument('Initial Comment Document')
      )

      render(<App />)
      await upload(makeFile(fileName))
      expect(
        await screen.findByText('Initial Comment Document')
      ).toBeInTheDocument()

      vi.mocked(PdfParser.encode).mockReturnValueOnce(pendingParse.promise)
      await upload(makeFile(fileName))

      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      // When: CommentPanel 打开，用户填写内容并添加评论。
      await callback(range)
      fireEvent.change(await screen.findByLabelText('评论内容'), {
        target: { value: 'note added during reupload' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))
      fireEvent.click(screen.getByRole('button', { name: '关闭评论' }))

      await waitFor(() => {
        const stored = JSON.parse(
          localStorage.getItem(commentStorageKey(fileName)) || '{}'
        )
        expect(stored).toMatchObject({
          version: 2,
          comments: [
            {
              highlightIds: [range.id],
              content: 'note added during reupload',
              parentId: null
            }
          ]
        })
      })

      pendingParse.resolve(makeRuntimeDocument('Reloaded Comment Document'))
      expect(
        await screen.findByText('Reloaded Comment Document')
      ).toBeInTheDocument()
    })

    it('adds highlight comments through the flat controlled Reader model and persists v2', async () => {
      // Given: Demo 已加载一个文件，Reader 请求打开评论面板。
      const fileName = 'flat-comments.pdf'
      const range = makeLinkedRange('flat-comment-range', 'flat comment text')
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Flat Comment Document')
      )
      render(<App />)
      await upload(makeFile(fileName))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(range)
      expect(await screen.findByText('flat comment text')).toBeInTheDocument()
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      // When: 用户新增一条评论。
      await callback(range)
      fireEvent.change(await screen.findByLabelText('评论内容'), {
        target: { value: 'flat note' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))
      fireEvent.click(screen.getByRole('button', { name: '关闭评论' }))

      // Then: Reader 只收到 flat comments，不再收到显式 badge map。
      await waitFor(() => {
        const readerProps = findDocumentReaderProps()
        expect(readerProps?.comments).toMatchObject([
          {
            highlightIds: [range.id],
            content: 'flat note',
            parentId: null
          }
        ])
        expect(readerProps).not.toHaveProperty('commentCountByRangeId')
        expect(readerProps).not.toHaveProperty('commentCountByRectId')
      })
      const stored = JSON.parse(
        localStorage.getItem(commentStorageKey(fileName)) || '{}'
      )
      expect(stored).toMatchObject({
        version: 2,
        comments: [
          {
            highlightIds: [range.id],
            content: 'flat note',
            parentId: null
          }
        ]
      })
    })

    it('shows an empty state when the comment panel has no comments', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Empty Comment Document')
      )
      render(<App />)
      await upload(makeFile('empty-comments.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('empty-range', 'empty range text')
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await callback(range)
      await screen.findByTestId('comment-panel')

      expect(screen.getByTestId('comment-panel')).toHaveTextContent('暂无评论')
      expect(screen.getByText('评论 (0)')).toBeInTheDocument()
    })

    it('shows the comment count in the panel header', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Comment Count Document')
      )
      render(<App />)
      await upload(makeFile('count-comments.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('count-range', 'count range text')
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await callback(range)
      await screen.findByTestId('comment-panel')
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'first comment' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))

      expect(screen.getByText('评论 (1)')).toBeInTheDocument()
    })

    it('renders replies nested under their parent comment', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Reply Nesting Document')
      )
      render(<App />)
      await upload(makeFile('reply-nesting.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('reply-range', 'reply range text')
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await callback(range)
      await screen.findByTestId('comment-panel')
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'parent comment' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))

      // 回复父评论
      fireEvent.click(screen.getByRole('button', { name: '回复' }))
      fireEvent.change(screen.getByLabelText('回复内容'), {
        target: { value: 'a nested reply' }
      })
      fireEvent.click(screen.getByRole('button', { name: '发送回复' }))

      // 子评论嵌套在父评论容器内
      const commentItems = screen.getAllByTestId(/^comment-item-/)
      expect(commentItems).toHaveLength(2)
      expect(commentItems[0]).toHaveTextContent('parent comment')
      expect(commentItems[0]).toHaveTextContent('a nested reply')
      expect(commentItems[1]).toHaveTextContent('a nested reply')
      expect(commentItems[1]).not.toHaveTextContent('parent comment')
    })

    it('updates comment content and sets updatedAt when editing', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Edit Comment Document')
      )
      render(<App />)
      await upload(makeFile('edit-comment.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('edit-range', 'edit range text')
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await callback(range)
      await screen.findByTestId('comment-panel')
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'original content' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))

      // 编辑评论
      fireEvent.click(screen.getByRole('button', { name: '编辑' }))
      fireEvent.change(screen.getByLabelText('编辑内容'), {
        target: { value: 'edited content' }
      })
      fireEvent.click(screen.getByRole('button', { name: '保存' }))

      expect(screen.getByText('edited content')).toBeInTheDocument()
      expect(screen.queryByText('original content')).not.toBeInTheDocument()

      // Reader 收到的评论应包含 updatedAt
      await waitFor(() => {
        expect(findDocumentReaderProps()?.comments).toMatchObject([
          {
            content: 'edited content',
            updatedAt: expect.any(Number)
          }
        ])
      })
    })

    it('deletes only the reply when deleting a reply comment', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Delete Reply Document')
      )
      render(<App />)
      await upload(makeFile('delete-reply.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('delete-reply-range', 'delete reply text')
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await callback(range)
      await screen.findByTestId('comment-panel')
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'parent keeps' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))
      fireEvent.click(screen.getByRole('button', { name: '回复' }))
      fireEvent.change(screen.getByLabelText('回复内容'), {
        target: { value: 'reply gets deleted' }
      })
      fireEvent.click(screen.getByRole('button', { name: '发送回复' }))

      // 删除回复：定位第二个评论项的删除按钮
      const replyItem = screen.getAllByTestId(/^comment-item-/)[1]
      fireEvent.click(within(replyItem).getByRole('button', { name: '删除' }))

      expect(screen.queryByText('reply gets deleted')).not.toBeInTheDocument()
      expect(screen.getByText('parent keeps')).toBeInTheDocument()
    })

    it('deletes a parent comment and all its replies', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Cascade Delete Document')
      )
      render(<App />)
      await upload(makeFile('cascade-delete.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('cascade-range', 'cascade text')
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await callback(range)
      await screen.findByTestId('comment-panel')
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'parent to delete' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))
      fireEvent.click(screen.getByRole('button', { name: '回复' }))
      fireEvent.change(screen.getByLabelText('回复内容'), {
        target: { value: 'child will cascade' }
      })
      fireEvent.click(screen.getByRole('button', { name: '发送回复' }))

      // 删除父评论：定位第一个评论项自身的删除按钮
      // （父 div 包含子评论的嵌套 div，因此用 getAllByRole 取第一个）
      const parentItem = screen.getAllByTestId(/^comment-item-/)[0]
      fireEvent.click(
        within(parentItem).getAllByRole('button', { name: '删除' })[0]
      )

      expect(screen.queryByText('parent to delete')).not.toBeInTheDocument()
      expect(screen.queryByText('child will cascade')).not.toBeInTheDocument()
    })

    it('binds a comment to multiple highlights via the checklist', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Multi Bind Document')
      )
      render(<App />)
      await upload(makeFile('multi-bind.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const rangeA = makeLinkedRange('multi-a', 'multi range a')
      const rangeB = makeLinkedRange('multi-b', 'multi range b')
      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      act(() => {
        onHighlight(rangeA)
        onHighlight(rangeB)
      })

      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await act(async () => {
        await callback(rangeA)
      })
      await screen.findByTestId('comment-panel')
      // 勾选第二个高亮
      fireEvent.click(screen.getByRole('checkbox', { name: 'multi range b' }))
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'multi-bound comment' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))

      await waitFor(() => {
        expect(findDocumentReaderProps()?.comments).toMatchObject([
          {
            content: 'multi-bound comment',
            highlightIds: expect.arrayContaining(['multi-a', 'multi-b'])
          }
        ])
      })
    })

    it('renders a chip for each bound highlight on a comment', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Chips Document')
      )
      render(<App />)
      await upload(makeFile('chips.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const rangeA = makeLinkedRange('chip-a', 'chip range a')
      const rangeB = makeLinkedRange('chip-b', 'chip range b')
      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      act(() => {
        onHighlight(rangeA)
        onHighlight(rangeB)
      })

      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await act(async () => {
        await callback(rangeA)
      })
      await screen.findByTestId('comment-panel')
      fireEvent.click(screen.getByRole('checkbox', { name: 'chip range b' }))
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'chipped comment' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))

      expect(screen.getByTestId('comment-chip-chip-a')).toHaveTextContent(
        'chip range a'
      )
      expect(screen.getByTestId('comment-chip-chip-b')).toHaveTextContent(
        'chip range b'
      )
    })

    it('calls scrollToRange when a highlight chip is clicked', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Chip Click Document')
      )
      render(<App />)
      await upload(makeFile('chip-click.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('chip-click-range', 'chip click text')
      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(range)

      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      await callback(range)
      await screen.findByTestId('comment-panel')
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'clickable chip comment' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加评论' }))

      const refObj = findDocumentReaderProps()
        ?.selectionRef as React.MutableRefObject<{
        scrollToRange: ReturnType<typeof vi.fn>
      } | null>

      fireEvent.click(screen.getByTestId('comment-chip-chip-click-range'))
      expect(refObj.current?.scrollToRange).toHaveBeenCalledWith(
        'chip-click-range'
      )
    })

    it('writes a new highlight to localStorage when onHighlight is called', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Highlight Document')
      )

      render(<App />)
      await upload(makeFile('highlight.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props) =>
          props.onHighlight !== undefined && props.document !== undefined
      )

      uploadReaderProps?.onHighlight?.({
        ...makeLinkedRange('range-1', 'hello highlight')
      })

      expect(await screen.findByText('已创建高亮 (1)')).toBeInTheDocument()
      expect(screen.getByText('hello highlight')).toBeInTheDocument()

      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('highlight.pdf')) || '{}'
      )
      expect(stored).toEqual({
        version: 4,
        ranges: [makeLinkedRange('range-1', 'hello highlight')],
        rects: [],
        paintings: {}
      })
    })

    it('keeps valid v2 ranges and drops invalid v2 entries when loading', async () => {
      const validRangeA = makeLinkedRange('range-a', 'valid A')
      const validRangeB = makeLinkedRange('range-b', 'valid B', 'page-2')
      localStorage.setItem(
        highlightStorageKey('mixed.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [
            validRangeA,
            {
              ...validRangeA,
              start: { selectionId: 'reader-1:page-1', offset: 1 }
            },
            { ...validRangeA, rectsBySelectionId: { 'page-0': [] } },
            null,
            validRangeB
          ]
        })
      )
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Mixed Document')
      )

      render(<App />)
      await upload(makeFile('mixed.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.getByText('已创建高亮 (2)')).toBeInTheDocument()
      expect(screen.getByText('valid A')).toBeInTheDocument()
      expect(screen.getByText('valid B')).toBeInTheDocument()
    })

    it('ignores old unversioned bare-array highlights instead of guessing page ownership', async () => {
      localStorage.setItem(
        highlightStorageKey('legacy.pdf'),
        JSON.stringify([
          {
            id: 'legacy-range',
            text: 'legacy highlight',
            start: 0,
            end: 10,
            createdAt: 1000,
            rects: [{ x: 1, y: 2, width: 3, height: 4 }]
          }
        ])
      )
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Legacy Document')
      )

      render(<App />)
      await upload(makeFile('legacy.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      expect(screen.queryByText('legacy highlight')).not.toBeInTheDocument()
    })

    it('updates a highlight by id and persists the v2 envelope', async () => {
      const originalRange = makeLinkedRange('range-update', 'before update')
      const updatedRange = {
        ...originalRange,
        text: 'after update',
        markerStyle: { backgroundColor: '#ff0000' }
      }
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Update Document')
      )

      render(<App />)
      await upload(makeFile('update.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(originalRange)
      expect(await screen.findByText('before update')).toBeInTheDocument()

      const onUpdateRange = findDocumentReaderProps()?.onUpdateRange as (
        range: unknown
      ) => void
      onUpdateRange(updatedRange)

      await waitFor(() => {
        expect(screen.getByText('after update')).toBeInTheDocument()
      })
      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('update.pdf')) || '{}'
      )
      expect(stored).toEqual({
        version: 4,
        ranges: [updatedRange],
        rects: [],
        paintings: {}
      })
    })

    it('clears all highlights and persists an empty v4 envelope', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Clear Document')
      )

      render(<App />)
      await upload(makeFile('clear.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('range-clear-a', 'clear A'))
      onHighlight(makeLinkedRange('range-clear-b', 'clear B', 'page-2'))
      expect(await screen.findByText('已创建高亮 (2)')).toBeInTheDocument()

      fireEvent.click(screen.getByText('清空全部'))

      await waitFor(() => {
        expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      })
      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('clear.pdf')) || '{}'
      )
      expect(stored).toEqual({
        version: 4,
        ranges: [],
        rects: [],
        paintings: {}
      })
    })

    it('does not persist runtime-scoped selection ids', async () => {
      const runtimeScopedRange = {
        ...makeLinkedRange('runtime-range', 'runtime scoped'),
        start: { selectionId: 'reader-linked-1:page-1', offset: 1 },
        end: { selectionId: 'reader-linked-1:page-1', offset: 6 },
        rectsBySelectionId: {
          'reader-linked-1:page-1': [{ x: 10, y: 20, width: 30, height: 40 }]
        }
      }
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Runtime Id Document')
      )

      render(<App />)
      await upload(makeFile('runtime.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(runtimeScopedRange)

      await waitFor(() => {
        expect(
          localStorage.getItem(highlightStorageKey('runtime.pdf'))
        ).not.toBe(null)
      })
      const storedRaw = localStorage.getItem(highlightStorageKey('runtime.pdf'))
      expect(storedRaw).not.toContain('reader-linked-1')
      expect(JSON.parse(storedRaw || '{}')).toEqual({
        version: 4,
        ranges: [],
        rects: [],
        paintings: {}
      })
    })

    it('restores stored highlights when reloading a file', async () => {
      localStorage.setItem(
        highlightStorageKey('restored.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-1', 'restored highlight')]
        })
      )

      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Restored Document')
      )

      render(<App />)
      await upload(makeFile('restored.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.getByText('已创建高亮 (1)')).toBeInTheDocument()
      expect(screen.getByText('restored highlight')).toBeInTheDocument()
    })

    it('isolates highlights per file name', async () => {
      localStorage.setItem(
        highlightStorageKey('file-a.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-a', 'file A highlight')]
        })
      )

      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('File B Document')
      )

      render(<App />)
      await upload(makeFile('file-b.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      expect(screen.queryByText('file A highlight')).not.toBeInTheDocument()
    })

    it('yields empty array for invalid JSON or wrong shape', async () => {
      localStorage.setItem(
        highlightStorageKey('corrupt.pdf'),
        '{ not valid json ]'
      )
      localStorage.setItem(
        highlightStorageKey('wrong-shape.pdf'),
        JSON.stringify([{ id: 'partial' }])
      )

      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Corrupt Document')
      )

      const { unmount } = render(<App />)
      await upload(makeFile('corrupt.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      unmount()

      render(<App />)
      await upload(makeFile('wrong-shape.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
    })

    it('ignores stale parser results applying older highlights to a newer file', async () => {
      const staleRequest = createDeferred<IntermediateDocument>()
      const freshRequest = createDeferred<IntermediateDocument>()

      localStorage.setItem(
        highlightStorageKey('stale.txt'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-stale', 'stale text')]
        })
      )
      localStorage.setItem(
        highlightStorageKey('fresh.txt'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-fresh', 'fresh text')]
        })
      )

      vi.mocked(TxtParser.encode)
        .mockReturnValueOnce(staleRequest.promise)
        .mockReturnValueOnce(freshRequest.promise)

      render(<App />)
      await upload(makeFile('stale.txt'))
      await waitFor(() => expect(TxtParser.encode).toHaveBeenCalledTimes(1))
      await upload(makeFile('fresh.txt'))
      await waitFor(() => expect(TxtParser.encode).toHaveBeenCalledTimes(2))

      freshRequest.resolve(makeRuntimeDocument('Fresh Document'))
      expect(await screen.findByText('Fresh Document')).toBeInTheDocument()

      expect(screen.getByText('已创建高亮 (1)')).toBeInTheDocument()
      expect(screen.getByText('fresh text')).toBeInTheDocument()
      expect(screen.queryByText('stale text')).not.toBeInTheDocument()

      staleRequest.resolve(makeRuntimeDocument('Stale Document'))
      await new Promise((r) => setTimeout(r, 10))

      expect(screen.queryByText('Stale Document')).not.toBeInTheDocument()
      expect(screen.queryByText('stale text')).not.toBeInTheDocument()
    })
  })

  describe('demo bookmark persistence', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockReaderProps.length = 0
      localStorage.clear()
      resetMockHistory()
    })

    it('restores sorted unique valid text bookmarks for the parsed file', async () => {
      // Given: persisted data contains duplicate and invalid text anchors.
      const firstBookmark: ReaderBookmark = {
        pageNumber: 1,
        textId: 'page-1-intro',
        text: 'First saved paragraph',
        offset: 0
      }
      const thirdPageBookmark: ReaderBookmark = {
        pageNumber: 3,
        textId: 'page-3-summary',
        text: 'Third-page summary',
        offset: 42
      }
      localStorage.setItem(
        bookmarkStorageKey('bookmarked.pdf'),
        JSON.stringify([
          thirdPageBookmark,
          firstBookmark,
          thirdPageBookmark,
          1,
          { ...firstBookmark, offset: -1 },
          { pageNumber: 2, textId: null, text: 'Invalid', offset: 0 }
        ])
      )
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Bookmarked Document')
      )

      // When: that file is parsed by the demo.
      render(<App />)
      await upload(makeFile('bookmarked.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      // Then: Reader receives only canonical full-text anchors.
      await waitFor(() => {
        expect(findDocumentReaderProps()?.data?.bookmarks).toEqual([
          firstBookmark,
          thirdPageBookmark
        ])
      })
    })

    it('persists text bookmark additions and removals through ReaderData', async () => {
      // Given: a freshly parsed file has no saved bookmarks.
      const bookmark: ReaderBookmark = {
        pageNumber: 2,
        textId: 'page-2-body',
        text: 'Current viewport text',
        offset: 18
      }
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Bookmark Toggle Document')
      )
      render(<App />)
      await upload(makeFile('bookmark-toggle.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(findDocumentReaderProps()?.data?.bookmarks).toEqual([])

      // When: Reader returns a bookmark anchored to the viewport's top text.
      act(() => {
        const props = findDocumentReaderProps()
        props?.onDataChange?.({ ...props.data, bookmarks: [bookmark] })
      })

      // Then: controlled data and per-file storage retain the full anchor.
      await waitFor(() => {
        expect(findDocumentReaderProps()?.data?.bookmarks).toEqual([bookmark])
      })
      expect(
        JSON.parse(
          localStorage.getItem(bookmarkStorageKey('bookmark-toggle.pdf')) ||
            '[]'
        )
      ).toEqual([bookmark])

      // When: Reader returns the bookmark collection after removal.
      act(() => {
        const props = findDocumentReaderProps()
        props?.onDataChange?.({ ...props.data, bookmarks: [] })
      })

      // Then: the bookmark is removed from props and persistence.
      await waitFor(() => {
        expect(findDocumentReaderProps()?.data?.bookmarks).toEqual([])
      })
      expect(
        JSON.parse(
          localStorage.getItem(bookmarkStorageKey('bookmark-toggle.pdf')) ||
            '[]'
        )
      ).toEqual([])
    })

    it('restores and persists the text reading progress anchor', async () => {
      // Given: Text Mode progress identifies a concrete text and page-local offset.
      const progress = {
        currentPageNumber: 2,
        anchor: {
          pageNumber: 2,
          textId: 'page-2-paragraph',
          text: 'Resume from this paragraph',
          offset: 31
        }
      } as const
      localStorage.setItem(
        `${TEXT_READING_PROGRESS_STORAGE_PREFIX}progress.pdf`,
        JSON.stringify(progress)
      )
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Progress Document')
      )

      // When: the document is parsed and Reader reports a new anchored position.
      render(<App />)
      await upload(makeFile('progress.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      await waitFor(() => {
        expect(findDocumentReaderProps()?.data?.textReadingProgress).toEqual(
          progress
        )
      })
      const nextProgress = {
        currentPageNumber: 3,
        anchor: {
          pageNumber: 3,
          textId: 'page-3-paragraph',
          text: 'New viewport text',
          offset: 12
        }
      } as const
      act(() => {
        const props = findDocumentReaderProps()
        props?.onDataChange?.({
          ...props.data,
          textReadingProgress: nextProgress
        })
      })

      // Then: the full anchor remains in controlled data and browser storage.
      await waitFor(() => {
        expect(findDocumentReaderProps()?.data?.textReadingProgress).toEqual(
          nextProgress
        )
      })
      expect(
        JSON.parse(
          localStorage.getItem(
            `${TEXT_READING_PROGRESS_STORAGE_PREFIX}progress.pdf`
          ) || '{}'
        )
      ).toEqual(nextProgress)
    })

    it('restores, persists, and displays native layout reading progress', async () => {
      // Given: 当前文件上次停在无文字页面的 42.5% 位置。
      const progress = { pageNumber: 2, verticalPercentage: 42.5 } as const
      localStorage.setItem(
        `${LAYOUT_READING_PROGRESS_STORAGE_PREFIX}layout-progress.pdf`,
        JSON.stringify(progress)
      )
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Layout Progress Document')
      )

      // When: 文件打开后，Reader 又报告了一个具体文字位置。
      render(<App />)
      upload(makeFile('layout-progress.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      await waitFor(() => {
        expect(findDocumentReaderProps()?.data?.layoutReadingProgress).toEqual(
          progress
        )
      })
      expect(
        screen.getByTestId('demo-reading-progress-status')
      ).toHaveTextContent('第 2 页 · 42.5%')
      const nextProgress = {
        pageNumber: 3,
        textId: 'page-3-paragraph',
        text: 'New native viewport text with enough additional content to verify the sidebar keeps the saved anchor concise and readable.',
        offset: 12
      } as const
      act(() => {
        const props = findDocumentReaderProps()
        props?.onDataChange?.({
          ...props.data,
          layoutReadingProgress: nextProgress
        })
      })

      // Then: 精确文字进度同步到受控数据、浏览器存储和 Demo 信息区。
      await waitFor(() => {
        expect(findDocumentReaderProps()?.data?.layoutReadingProgress).toEqual(
          nextProgress
        )
      })
      expect(
        JSON.parse(
          localStorage.getItem(
            `${LAYOUT_READING_PROGRESS_STORAGE_PREFIX}layout-progress.pdf`
          ) || '{}'
        )
      ).toEqual(nextProgress)
      expect(
        screen.getByTestId('demo-reading-progress-status')
      ).toHaveTextContent(
        '第 3 页 · New native viewport text with enough additional content to verify the sidebar keeps… · 偏移 12'
      )
    })
  })

  describe('demo undo/redo', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockReaderProps.length = 0
      localStorage.clear()
      resetMockHistory()
    })

    it('enables Undo button after creating a highlight', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Undo Enable Document')
      )
      render(<App />)
      await upload(makeFile('undo-enable.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const undoBtn = screen.getByTestId('undo-btn')
      expect(undoBtn).toBeDisabled()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      act(() => {
        onHighlight(makeLinkedRange('undo-range', 'undo text'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      })
    })

    it('Undo removes highlight and persists empty localStorage', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Undo Remove Document')
      )
      render(<App />)
      await upload(makeFile('undo-remove.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      act(() => {
        onHighlight(makeLinkedRange('undo-rm', 'undo remove text'))
      })

      await waitFor(() => {
        expect(screen.getByText('undo remove text')).toBeInTheDocument()
        expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      })

      fireEvent.click(screen.getByTestId('undo-btn'))

      await waitFor(() => {
        expect(screen.queryByText('undo remove text')).not.toBeInTheDocument()
      })

      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('undo-remove.pdf')) || '{}'
      )
      expect(stored).toEqual({
        version: 4,
        ranges: [],
        rects: [],
        paintings: {}
      })

      expect(screen.getByTestId('undo-btn')).toBeDisabled()
      expect(screen.getByTestId('redo-btn')).not.toBeDisabled()
    })

    it('Redo restores highlight after Undo', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Redo Restore Document')
      )
      render(<App />)
      await upload(makeFile('redo-restore.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.getByTestId('undo-btn')).toBeDisabled()
      expect(screen.getByTestId('redo-btn')).toBeDisabled()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      act(() => {
        onHighlight(makeLinkedRange('redo-range', 'redo text'))
      })

      await waitFor(() => {
        expect(screen.getByText('redo text')).toBeInTheDocument()
        expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
        expect(screen.getByTestId('redo-btn')).toBeDisabled()
      })

      fireEvent.click(screen.getByTestId('undo-btn'))

      await waitFor(() => {
        expect(screen.queryByText('redo text')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('undo-btn')).toBeDisabled()
      expect(screen.getByTestId('redo-btn')).not.toBeDisabled()
      expect(
        JSON.parse(
          localStorage.getItem(highlightStorageKey('redo-restore.pdf')) || '{}'
        )
      ).toEqual({ version: 4, ranges: [], rects: [], paintings: {} })

      fireEvent.click(screen.getByTestId('redo-btn'))

      await waitFor(() => {
        expect(screen.getByText('redo text')).toBeInTheDocument()
      })
      expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      expect(screen.getByTestId('redo-btn')).toBeDisabled()

      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('redo-restore.pdf')) || '{}'
      )
      expect(stored).toEqual({
        version: 4,
        ranges: [makeLinkedRange('redo-range', 'redo text')],
        rects: [],
        paintings: {}
      })
    })

    it('rectangle create can be undone and redone', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Rect Undo Redo Document')
      )
      render(<App />)
      await upload(makeFile('rect-undo.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onCreateRect = findDocumentReaderProps()?.onCreateRect as (
        rect: unknown
      ) => void
      act(() => {
        onCreateRect({
          id: 'rect-undo-1',
          createdAt: 1,
          overlayRectType: 'percent',
          start: { x: 0, y: 0 },
          end: { x: 100, y: 100 },
          selectionId: 'page-1',
          rect: { x: 10, y: 20, width: 30, height: 40 }
        })
      })

      await waitFor(() => {
        expect(screen.getByText('矩形 rect-undo-1')).toBeInTheDocument()
        expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      })

      fireEvent.click(screen.getByTestId('undo-btn'))

      await waitFor(() => {
        expect(screen.queryByText('矩形 rect-undo-1')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('redo-btn'))

      await waitFor(() => {
        expect(screen.getByText('矩形 rect-undo-1')).toBeInTheDocument()
      })
    })

    it('switching to a different file resets undo history', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('File A Document')
      )
      render(<App />)
      await upload(makeFile('file-a-reset.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      act(() => {
        onHighlight(makeLinkedRange('reset-range', 'reset text'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      })

      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('File B Document')
      )
      await upload(makeFile('file-b-reset.pdf'))

      expect(await screen.findByText('File B Document')).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.getByTestId('undo-btn')).toBeDisabled()
        expect(screen.getByTestId('redo-btn')).toBeDisabled()
      })
    })

    it('pagePaintings stay unaffected by undo/redo', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Painting Undo Document')
      )
      render(<App />)
      await upload(makeFile('painting-undo.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onPagePaintingsChange = findDocumentReaderProps()
        ?.onPagePaintingsChange as (paintings: unknown) => void
      const mockPaintings = { 'page-1': { shapes: [] } }
      act(() => {
        onPagePaintingsChange(mockPaintings)
      })

      await waitFor(() => {
        expect(findDocumentReaderProps()?.data?.pagePaintings).toEqual(
          mockPaintings
        )
      })

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      act(() => {
        onHighlight(makeLinkedRange('paint-range', 'painting undo text'))
      })

      await waitFor(() => {
        expect(screen.getByText('painting undo text')).toBeInTheDocument()
        expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      })

      fireEvent.click(screen.getByTestId('undo-btn'))

      await waitFor(() => {
        expect(screen.queryByText('painting undo text')).not.toBeInTheDocument()
      })

      expect(findDocumentReaderProps()?.data?.pagePaintings).toEqual(
        mockPaintings
      )

      fireEvent.click(screen.getByTestId('redo-btn'))

      await waitFor(() => {
        expect(screen.getByText('painting undo text')).toBeInTheDocument()
      })

      expect(findDocumentReaderProps()?.data?.pagePaintings).toEqual(
        mockPaintings
      )
    })
  })
})
