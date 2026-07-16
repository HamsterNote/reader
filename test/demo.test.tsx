import { DocxParser } from '@hamster-note/docx-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import { PdfParser } from '@hamster-note/pdf-parser'
import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue,
  ReaderRenderMode,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderTouchPanMode
} from '@hamster-note/reader'

import { TxtParser } from '@hamster-note/txt-parser'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized
} from '@hamster-note/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../demo/App'

vi.mock('@hamster-note/pdf-parser', () => ({
  PdfParser: {
    encode: vi.fn()
  }
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

vi.mock('@hamster-note/markdown-parser', () => ({
  MarkdownParser: {
    encode: vi.fn()
  }
}))

const mockCallbacks: {
  onTextSelectionChange?: (text: unknown, detail: unknown) => void
  onTextSelectionEnd?: (text: unknown, detail: unknown) => void
  onSelectText?: (
    selection: unknown,
    segments: unknown,
    extractedText: unknown
  ) => void
} = {}
const mockReaderProps: unknown[] = []
const HIGHLIGHT_STORAGE_PREFIX = 'hamster-reader-demo:highlights:'

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
  const { useEffect } = await import('react')
  return {
    ...actual,
    Reader: (props: {
      document?: IntermediateDocument | IntermediateDocumentSerialized | null
      emptyText?: string
      renderMode?: ReaderRenderMode
      touchPanMode?: ReaderTouchPanMode
      onFileUpload?: (file: File) => void
      onTextSelectionChange?: (text: unknown, detail: unknown) => void
      onTextSelectionEnd?: (text: unknown, detail: unknown) => void
      onSelectText?: (
        selection: unknown,
        segments: unknown,
        extractedText: unknown
      ) => void
      selectionRef?: React.MutableRefObject<unknown>
      ranges?: ReaderSelectionRange[]
      rects?: ReaderSelectionRectangle[]
      selectedRangeId?: string | null
      selectedRectId?: string | null
      annotationHistory?: { enabled?: boolean; resetKey?: string | number }
      onAnnotationHistoryChange?: (
        next: ReaderAnnotationHistoryValue,
        detail: ReaderAnnotationHistoryChangeDetail
      ) => void
      onHighlight?: (range: ReaderSelectionRange) => void
      onUpdateRange?: (range: ReaderSelectionRange) => void
      onCreateRect?: (rect: ReaderSelectionRectangle) => void
      onUpdateRect?: (rect: ReaderSelectionRectangle) => void
      pagePaintings?: unknown
      onPagePaintingsChange?: (paintings: unknown) => void
    }) => {
      // 从受控 props 同步 present 快照（不创建 checkpoint）
      mockHistoryState.present = {
        ranges: props.ranges ?? [],
        rects: props.rects ?? [],
        selectedRangeId: props.selectedRangeId ?? null,
        selectedRectId: props.selectedRectId ?? null
      }

      // 始终更新 latestOnAHC，避免 selectionRef.current spread 导致闭包过期
      latestOnAHC = props.onAnnotationHistoryChange

      // resetKey 变化时在 useEffect 中清空 undo/redo 栈并通知 host
      useEffect(() => {
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
          ...((props.selectionRef.current as Record<string, unknown>) || {})
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

function findDocumentReaderProps(): Record<string, unknown> | undefined {
  for (let index = mockReaderProps.length - 1; index >= 0; index -= 1) {
    const props = mockReaderProps[index]
    if (
      typeof props === 'object' &&
      props !== null &&
      'document' in props &&
      props.document !== undefined
    ) {
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

function upload(file: File) {
  fireEvent.change(screen.getByTestId('file-input'), {
    target: { files: [file] }
  })
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

  it('renders the parsed document and uploaded file details on success', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Success Document')
    )

    render(<App />)
    const uploadedFile = makeFile('success.pdf')
    upload(uploadedFile)

    expect(screen.getByText('Parsing...')).toBeInTheDocument()
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(screen.getByText('Success Document')).toBeInTheDocument()
    expect(screen.getByText('Name: success.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
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
        expect(TxtParser.encode).not.toHaveBeenCalled()
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
      upload(uploadedFile)

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

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

      expect(screen.getByText(caseData.title)).toBeInTheDocument()
      expect(screen.getByText(`Name: ${caseData.fileName}`)).toBeInTheDocument()
      expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
      caseData.assertParserCall(uploadedFile)
    }
  )

  it.each([
    'book.epub',
    'legacy.doc',
    'component.mdx',
    'README',
    'archive.zip'
  ])('rejects unsupported upload %s by extension', async (fileName) => {
    render(<App />)
    upload(makeFile(fileName))

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Unsupported file type. Supported: PDF, TXT, DOCX, Markdown.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(PdfParser.encode).not.toHaveBeenCalled()
    expect(TxtParser.encode).not.toHaveBeenCalled()
    expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
    expect(MarkdownParser.encode).not.toHaveBeenCalled()
  })

  it('shows a TXT parse error when the TXT parser rejects', async () => {
    vi.mocked(TxtParser.encode).mockRejectedValue(new Error('bad txt'))

    render(<App />)
    const uploadedFile = makeFile('broken.txt')
    upload(uploadedFile)

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(screen.getByText('Failed to parse TXT: bad txt')).toBeInTheDocument()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(TxtParser.encode).toHaveBeenCalledTimes(1)
    expect(TxtParser.encode).toHaveBeenCalledWith(uploadedFile)
    expect(PdfParser.encode).not.toHaveBeenCalled()
  })

  it('shows a parse error when the parser returns undefined', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(undefined)

    render(<App />)
    const uploadedFile = makeFile('undefined.pdf')
    upload(uploadedFile)

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
    upload(uploadedFile)

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
    upload(makeFile('ocr.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(screen.getByText('OCR Document')).toBeInTheDocument()
  })

  it('provides render mode select that updates Reader prop', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Render Mode Document')
    )

    render(<App />)
    upload(makeFile('rendermode.pdf'))
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

  it('provides touch pan mode select that updates Reader prop', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Touch Pan Mode Document')
    )

    render(<App />)
    upload(makeFile('touchpanmode.pdf'))
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
    upload(makeFile('drawing-tool.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const select = screen.getByTestId('selection-tool-select')
    expect(select).toHaveValue('text-selection')
    expect(select).toHaveTextContent('绘图 Drawing')

    fireEvent.change(select, { target: { value: 'drawing' } })

    await waitFor(() => {
      expect(select).toHaveValue('drawing')
      expect(findDocumentReaderProps()?.selectedTool).toBe('drawing')
      expect(findDocumentReaderProps()?.pagePaintings).toEqual({})
      expect(findDocumentReaderProps()?.onPagePaintingsChange).toBeTypeOf(
        'function'
      )
    })
  })

  it('hides touch pan mode select when render mode is text', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Text Mode Touch Pan Document')
    )

    render(<App />)
    upload(makeFile('textmode-touchpan.pdf'))
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
    upload(makeFile('callback.pdf'))

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
    upload(makeFile('selecttext.pdf'))

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
    const staleRequest = createDeferred<IntermediateDocument | undefined>()
    const freshRequest = createDeferred<IntermediateDocument | undefined>()

    vi.mocked(PdfParser.encode)
      .mockReturnValueOnce(staleRequest.promise)
      .mockReturnValueOnce(freshRequest.promise)

    render(<App />)
    upload(makeFile('stale.pdf'))
    upload(makeFile('fresh.pdf'))

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
      upload(makeFile('auto.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const toggle = screen.getByTestId('auto-highlight-toggle')
      expect(toggle).not.toBeChecked()

      let uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )
      expect(uploadReaderProps?.autoHighlight).toBe(false)

      fireEvent.click(toggle)
      expect(toggle).toBeChecked()

      await waitFor(() => {
        uploadReaderProps = mockReaderProps[
          mockReaderProps.length - 1
        ] as Record<string, unknown>
        expect(uploadReaderProps?.autoHighlight).toBe(true)
      })
    })

    it('renders selectionPopover with 高亮 and 背景颜色设置', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Popover Document')
      )
      render(<App />)
      upload(makeFile('popover.pdf'))
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
      upload(makeFile('hpopover.pdf'))
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
      upload(makeFile('own-highlight-color.pdf'))
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
      upload(makeFile('independent-margins.pdf'))
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
      upload(makeFile('highlight-comment.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      const range = makeLinkedRange('comment-range', 'comment target text')
      const callback = findDocumentReaderProps()?.onCommentHighlight
      if (!isCommentHighlightCallback(callback)) {
        throw new Error('Expected onCommentHighlight callback')
      }

      // When: 评论面板打开，用户填写内容并结束评论。
      const resultPromise = callback(range)
      expect(
        await screen.findByTestId('highlight-comment-panel')
      ).toHaveTextContent('comment target text')
      fireEvent.change(screen.getByLabelText('评论内容'), {
        target: { value: 'A useful note' }
      })
      fireEvent.click(screen.getByRole('button', { name: '完成评论' }))
      const result = await resultPromise

      // Then: Promise 返回同一个 range 引用，评论面板也已关闭。
      expect(result).toBe(range)
      expect(
        screen.queryByTestId('highlight-comment-panel')
      ).not.toBeInTheDocument()
    })

    it('does not store a highlight on selection end when autoHighlight is false', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('No Auto Highlight Document')
      )
      render(<App />)
      upload(makeFile('no-auto.pdf'))
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
      upload(makeFile('manual.pdf'))
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
      upload(makeFile('color.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      let uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const popover = render(
        uploadReaderProps?.selectionPopover as React.ReactElement
      )
      const colorInput = popover.container.querySelector(
        'input[type="color"]'
      ) as HTMLInputElement

      fireEvent.change(colorInput, { target: { value: '#ff0000' } })

      await waitFor(() => {
        uploadReaderProps = mockReaderProps[
          mockReaderProps.length - 1
        ] as Record<string, unknown>
        expect(uploadReaderProps?.highlightColor).toBe('#ff0000')
      })
    })

    it('updates the selected range markerStyle when highlightPopover color input is changed', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Highlight Color Document')
      )
      render(<App />)
      upload(makeFile('highlight-color.pdf'))
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
      const range = makeLinkedRange('highlight-color-range', 'highlight text')
      onHighlight(range)

      expect(await screen.findByText('highlight text')).toBeInTheDocument()

      const onSelectRange = uploadReaderProps?.onSelectRange as (
        id: string
      ) => void
      onSelectRange('highlight-color-range')

      await waitFor(() => {
        uploadReaderProps = mockReaderProps[
          mockReaderProps.length - 1
        ] as Record<string, unknown>
        expect(uploadReaderProps?.selectedRangeId).toBe('highlight-color-range')
      })

      const popover = renderHighlightPopover(uploadReaderProps, range)
      const colorInput = popover.container.querySelector(
        'input[type="color"]'
      ) as HTMLInputElement

      fireEvent.change(colorInput, { target: { value: '#ff0000' } })

      await waitFor(() => {
        uploadReaderProps = mockReaderProps[
          mockReaderProps.length - 1
        ] as Record<string, unknown>
        const ranges = uploadReaderProps?.ranges as
          | Array<{ markerStyle?: { backgroundColor?: string } }>
          | undefined
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
      upload(makeFile('delete.pdf'))
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
      expect(stored).toEqual({ version: 4, ranges: [], rects: [], paintings: {} })

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
      upload(makeFile('single.pdf'))
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
      upload(makeFile('sidebar-click.pdf'))
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
      upload(makeFile('double-click.pdf'))
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
      upload(makeFile('rect-sidebar.pdf'))
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
      upload(makeFile('no-scroll-delete.pdf'))
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
      upload(makeFile('null-ref.pdf'))
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
      upload(makeFile('absent-ref-current.pdf'))
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
      upload(makeFile('clean.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
    })

    it('writes a new highlight to localStorage when onHighlight is called', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Highlight Document')
      )

      render(<App />)
      upload(makeFile('highlight.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (
          props
        ): props is {
          emptyText?: string
          onHighlight?: (...args: unknown[]) => unknown
          document?: unknown
        } =>
          typeof props === 'object' &&
          props !== null &&
          'onHighlight' in props &&
          (props as Record<string, unknown>).document !== undefined
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
      upload(makeFile('mixed.pdf'))

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
      upload(makeFile('legacy.pdf'))

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
      upload(makeFile('update.pdf'))
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
      upload(makeFile('clear.pdf'))
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
      expect(stored).toEqual({ version: 4, ranges: [], rects: [], paintings: {} })
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
      upload(makeFile('runtime.pdf'))
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
      upload(makeFile('restored.pdf'))

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
      upload(makeFile('file-b.pdf'))

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
      upload(makeFile('corrupt.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      unmount()

      render(<App />)
      upload(makeFile('wrong-shape.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
    })

    it('ignores stale parser results applying older highlights to a newer file', async () => {
      const staleRequest = createDeferred<IntermediateDocument | undefined>()
      const freshRequest = createDeferred<IntermediateDocument | undefined>()

      localStorage.setItem(
        highlightStorageKey('stale.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-stale', 'stale text')]
        })
      )
      localStorage.setItem(
        highlightStorageKey('fresh.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-fresh', 'fresh text')]
        })
      )

      vi.mocked(PdfParser.encode)
        .mockReturnValueOnce(staleRequest.promise)
        .mockReturnValueOnce(freshRequest.promise)

      render(<App />)
      upload(makeFile('stale.pdf'))
      upload(makeFile('fresh.pdf'))

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
      upload(makeFile('undo-enable.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const undoBtn = screen.getByTestId('undo-btn')
      expect(undoBtn).toBeDisabled()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('undo-range', 'undo text'))

      await waitFor(() => {
        expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      })
    })

    it('Undo removes highlight and persists empty localStorage', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Undo Remove Document')
      )
      render(<App />)
      upload(makeFile('undo-remove.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('undo-rm', 'undo remove text'))

      expect(await screen.findByText('undo remove text')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('undo-btn'))

      await waitFor(() => {
        expect(screen.queryByText('undo remove text')).not.toBeInTheDocument()
      })

      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('undo-remove.pdf')) || '{}'
      )
      expect(stored).toEqual({ version: 4, ranges: [], rects: [], paintings: {} })

      expect(screen.getByTestId('undo-btn')).toBeDisabled()
      expect(screen.getByTestId('redo-btn')).not.toBeDisabled()
    })

    it('Redo restores highlight after Undo', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Redo Restore Document')
      )
      render(<App />)
      upload(makeFile('redo-restore.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.getByTestId('undo-btn')).toBeDisabled()
      expect(screen.getByTestId('redo-btn')).toBeDisabled()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('redo-range', 'redo text'))

      expect(await screen.findByText('redo text')).toBeInTheDocument()
      expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      expect(screen.getByTestId('redo-btn')).toBeDisabled()

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
      upload(makeFile('rect-undo.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onCreateRect = findDocumentReaderProps()?.onCreateRect as (
        rect: unknown
      ) => void
      onCreateRect({
        id: 'rect-undo-1',
        createdAt: 1,
        overlayRectType: 'percent',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        selectionId: 'page-1',
        rect: { x: 10, y: 20, width: 30, height: 40 }
      })

      expect(await screen.findByText('矩形 rect-undo-1')).toBeInTheDocument()

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
      upload(makeFile('file-a-reset.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('reset-range', 'reset text'))

      await waitFor(() => {
        expect(screen.getByTestId('undo-btn')).not.toBeDisabled()
      })

      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('File B Document')
      )
      upload(makeFile('file-b-reset.pdf'))

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
      upload(makeFile('painting-undo.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onPagePaintingsChange = findDocumentReaderProps()
        ?.onPagePaintingsChange as (paintings: unknown) => void
      const mockPaintings = { 'page-1': { shapes: [] } }
      onPagePaintingsChange(mockPaintings)

      await waitFor(() => {
        expect(findDocumentReaderProps()?.pagePaintings).toEqual(mockPaintings)
      })

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('paint-range', 'painting undo text'))

      expect(await screen.findByText('painting undo text')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('undo-btn'))

      await waitFor(() => {
        expect(screen.queryByText('painting undo text')).not.toBeInTheDocument()
      })

      expect(findDocumentReaderProps()?.pagePaintings).toEqual(mockPaintings)

      fireEvent.click(screen.getByTestId('redo-btn'))

      await waitFor(() => {
        expect(screen.getByText('painting undo text')).toBeInTheDocument()
      })

      expect(findDocumentReaderProps()?.pagePaintings).toEqual(mockPaintings)
    })
  })
})
