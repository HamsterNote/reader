import { HtmlParser } from '@hamster-note/html-parser'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized
} from '@hamster-note/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SUPPORTED_UPLOAD_ACCEPT,
  SUPPORTED_UPLOAD_COPY
} from '../src/components/Reader'
import type { ReaderInteractionMode, ReaderProps } from '../src/index'
import { Reader } from '../src/index'
import { intersectionObserverMock } from './setup'

vi.mock('@hamster-note/html-parser', () => ({
  HtmlParser: {
    decodeToHtml: vi.fn(),
    decodePageToHtml: vi.fn()
  }
}))

let capturedViewerProps: Record<string, unknown> = {}

vi.mock(
  '../src/components/IntermediateDocumentViewer',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../src/components/IntermediateDocumentViewer')
      >()
    return {
      ...actual,
      IntermediateDocumentViewer: (props: Record<string, unknown>) => {
        capturedViewerProps = props
        return actual.IntermediateDocumentViewer(
          props as Parameters<typeof actual.IntermediateDocumentViewer>[0]
        )
      }
    }
  }
)

vi.mock('@system-ui-js/multi-drag', () => {
  const DragOperationType = {
    Start: 'start',
    Move: 'move',
    End: 'end',
    Inertial: 'inertial',
    InertialEnd: 'inertialEnd',
    AllEnd: 'allEnd'
  }

  const makeFinger = (event: MouseEvent | PointerEvent) => ({
    pointerId: (event as PointerEvent).pointerId ?? 1,
    getLastOperation: () => ({
      point: { x: event.clientX, y: event.clientY },
      timestamp: event.timeStamp
    })
  })

  return {
    DragOperationType,
    Drag: class MockedDrag {
      private readonly listeners = new Map<
        string,
        Array<(fingers: ReturnType<typeof makeFinger>[]) => void>
      >()
      private primaryPointerId: number | null = null

      constructor(private readonly element: HTMLElement) {
        this.element.addEventListener('pointerdown', this.handlePointerDown)
        this.element.addEventListener('pointermove', this.handlePointerMove)
        this.element.addEventListener('pointerup', this.handlePointerEnd)
        this.element.addEventListener('pointercancel', this.handlePointerEnd)
      }

      addEventListener(
        type: string,
        callback: (fingers: ReturnType<typeof makeFinger>[]) => void
      ) {
        const callbacks = this.listeners.get(type) ?? []
        callbacks.push(callback)
        this.listeners.set(type, callbacks)
      }

      removeEventListener(
        type: string,
        callback?: (fingers: ReturnType<typeof makeFinger>[]) => void
      ) {
        if (!callback) {
          this.listeners.delete(type)
          return
        }
        const callbacks = this.listeners.get(type) ?? []
        this.listeners.set(
          type,
          callbacks.filter((listener) => listener !== callback)
        )
      }

      destroy() {
        this.element.removeEventListener('pointerdown', this.handlePointerDown)
        this.element.removeEventListener('pointermove', this.handlePointerMove)
        this.element.removeEventListener('pointerup', this.handlePointerEnd)
        this.element.removeEventListener('pointercancel', this.handlePointerEnd)
      }

      getCurrentOperationType() {
        return this.primaryPointerId === null
          ? DragOperationType.AllEnd
          : DragOperationType.Move
      }

      private emit(type: string, event: MouseEvent | PointerEvent) {
        this.listeners.get(type)?.forEach((listener) => {
          listener([makeFinger(event)])
        })
      }

      private handlePointerDown = (event: MouseEvent | PointerEvent) => {
        if (event.button !== 0) return
        this.primaryPointerId = (event as PointerEvent).pointerId ?? 1
        this.emit(DragOperationType.Start, event)
      }

      private handlePointerMove = (event: MouseEvent | PointerEvent) => {
        if (this.primaryPointerId === null) return
        this.emit(DragOperationType.Move, event)
      }

      private handlePointerEnd = (event: MouseEvent | PointerEvent) => {
        if (this.primaryPointerId === null) return
        this.emit(DragOperationType.End, event)
        this.emit(DragOperationType.AllEnd, event)
        this.primaryPointerId = null
      }
    }
  }
})

function makePage(number: number) {
  return {
    id: `page-${number}`,
    texts: [],
    width: 100,
    height: 150,
    number,
    thumbnail: undefined
  }
}

function makeText(id: string, content: string) {
  return {
    id,
    content,
    fontSize: 12,
    fontFamily: 'Arial',
    fontWeight: 400,
    italic: false,
    color: '#111111',
    polygon: [
      [10, 20],
      [50, 20],
      [50, 36],
      [10, 36]
    ],
    lineHeight: 16,
    ascent: 10,
    descent: 2,
    dir: 'ltr',
    skew: 0,
    isEOL: false
  }
}

function makeDocument(
  overrides?: Partial<IntermediateDocumentSerialized>
): IntermediateDocumentSerialized {
  return {
    id: 'doc-1',
    pages: [],
    title: 'Hamster Reader Title',
    ...overrides
  }
}

type MockPage = {
  getContent: ReturnType<typeof vi.fn<() => Promise<unknown[]>>>
  thumbnail?: string
  image?: string
}

function makeLazyDocument(pageCount: number = 1): {
  document: IntermediateDocument
  pages: Map<number, MockPage>
} {
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
  const pages = new Map<number, MockPage>()

  pageNumbers.forEach((pageNumber) => {
    pages.set(pageNumber, {
      getContent: vi.fn(async () => [
        makeText(`text-${pageNumber}`, `Page ${pageNumber} text`)
      ])
    })
  })

  const document = {
    id: 'doc-1',
    title: 'Hamster Reader Title',
    pageCount,
    pageNumbers,
    getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
    getPageByPageNumber: vi.fn((pageNumber: number) =>
      Promise.resolve(pages.get(pageNumber))
    )
  } as unknown as IntermediateDocument

  return { document, pages }
}

function createMockFile(
  name: string,
  size: number,
  type: string = 'application/pdf'
): File {
  const file = new File([], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('Reader public API', () => {
  beforeEach(() => {
    vi.mocked(HtmlParser.decodeToHtml).mockReset()
    vi.mocked(HtmlParser.decodePageToHtml).mockReset()
    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue('')
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')
  })

  it('renders the provided document title on the public entry', () => {
    render(<Reader document={makeDocument()} />)

    const root = screen.getByTestId('reader-root')

    expect(root).toBeInTheDocument()
    expect(root).toHaveTextContent('Hamster Reader Title')
  })

  it('renders emptyText when document is null', () => {
    render(<Reader document={null} emptyText='Nothing to render' />)

    const root = screen.getByTestId('reader-root')

    expect(root).toBeInTheDocument()
    expect(root).toHaveTextContent('Nothing to render')
  })

  it('renders the intermediate viewer when a document has pages', () => {
    render(<Reader document={makeDocument({ pages: [makePage(1)] })} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-1')).toHaveStyle({
      width: '100px',
      height: '150px'
    })
    expect(screen.queryByText('Hamster Reader Title')).not.toBeInTheDocument()
  })

  it('renders the intermediate viewer for a runtime document', () => {
    const runtimeDocument = IntermediateDocument.parse(
      makeDocument({ pages: [makePage(1)] })
    )

    render(<Reader document={runtimeDocument} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-1')).toHaveStyle({
      width: '100px',
      height: '150px'
    })
  })

  it('renders document content through html-parser-backed viewer path', async () => {
    const mockHtml = '<div class="hamster-note-page">Reader HTML</div>'
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(mockHtml)

    const { document, pages } = makeLazyDocument(1)
    const page = pages.get(1)

    render(<Reader document={document} renderMode='html-parser' />)

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(page, {
      background: { backgroundQuality: 0.8 }
    })
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
    expect(screen.getByTestId('html-parser-output')).toContainHTML(
      'Reader HTML'
    )
  })

  it('passes direct renderMode through without parser calls', async () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} renderMode='direct' />)

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    expect(capturedViewerProps.renderMode).toBe('direct')
    expect(HtmlParser.decodePageToHtml).not.toHaveBeenCalled()
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('falls back when html-parser decode fails', async () => {
    vi.mocked(HtmlParser.decodePageToHtml).mockRejectedValueOnce(
      new Error('decode failed')
    )

    const document = {
      id: 'doc-1',
      title: 'Test Document',
      pageCount: 1,
      pageNumbers: [1],
      getPageSizeByPageNumber: () => ({ x: 100, y: 150 }),
      getPageByPageNumber: () =>
        Promise.resolve({
          getContent: () =>
            Promise.resolve([
              { id: 't1', content: 'Reader fallback', fontSize: 12 }
            ])
        })
    } as unknown as IntermediateDocument

    render(<Reader document={document} renderMode='html-parser' />)

    await waitFor(() => {
      expect(screen.getByText('Reader fallback')).toBeInTheDocument()
    })

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalled()
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
    expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
  })

  it('shows the document title fallback when pages are empty', () => {
    render(<Reader document={makeDocument({ pages: [] })} />)

    expect(screen.getByTestId('reader-content')).toHaveTextContent(
      'Hamster Reader Title'
    )
    expect(
      screen.queryByTestId('intermediate-document-viewer')
    ).not.toBeInTheDocument()
  })
})

describe('Reader file upload', () => {
  it('shows upload zone when no document is provided', () => {
    render(<Reader document={null} />)

    const uploadZone = screen.getByTestId('upload-zone')
    const fileInput = screen.getByTestId('file-input')

    expect(uploadZone).toBeInTheDocument()
    expect(uploadZone).toHaveTextContent('Click or drag document to upload')
    expect(uploadZone).toHaveTextContent(
      'Supports PDF, TXT, DOCX, and Markdown files'
    )
    expect(fileInput.getAttribute('accept')).toBe(SUPPORTED_UPLOAD_ACCEPT)
  })

  it('does not show upload zone when document is provided', () => {
    render(<Reader document={makeDocument()} />)

    const uploadZone = screen.queryByTestId('upload-zone')

    expect(uploadZone).not.toBeInTheDocument()
  })

  it('triggers onFileUpload callback when file is selected', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024 * 100)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    expect(onFileUpload).toHaveBeenCalledWith(mockFile)
  })

  it('displays file info after upload', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024 * 100)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toBeInTheDocument()
    expect(fileInfo).toHaveTextContent('test.pdf')
    expect(fileInfo).toHaveTextContent('100.0 KB')
  })

  it('displays file name and size correctly for small files', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('small.pdf', 500)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toHaveTextContent('500 B')
  })

  it('displays file name and size correctly for large files', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('large.pdf', 2 * 1024 * 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toHaveTextContent('2.0 MB')
  })

  it('has upload another button after file is uploaded', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const uploadAnotherBtn = screen.getByTestId('upload-another-btn')
    expect(uploadAnotherBtn).toBeInTheDocument()
    expect(uploadAnotherBtn).toHaveTextContent('Upload Another')
  })

  it('clicking upload another button works without errors', async () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const uploadAnotherBtn = screen.getByTestId('upload-another-btn')
    expect(uploadAnotherBtn).toBeEnabled()

    await userEvent.click(uploadAnotherBtn)

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toBeInTheDocument()
  })

  it('shows unknown type for files without a MIME type', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('notype-file', 1024, '')

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toHaveTextContent('unknown type')
    expect(fileInfo).not.toHaveTextContent('application/pdf')
  })

  it('exports SUPPORTED_UPLOAD_COPY with expected value', () => {
    expect(SUPPORTED_UPLOAD_COPY).toBe('PDF, TXT, DOCX, and Markdown')
  })

  it('hides file info when document is provided', () => {
    render(<Reader document={makeDocument()} />)

    const fileInfo = screen.queryByTestId('file-info')

    expect(fileInfo).not.toBeInTheDocument()
  })
})

describe('Reader prop forwarding', () => {
  beforeEach(() => {
    vi.mocked(HtmlParser.decodeToHtml).mockReset()
    vi.mocked(HtmlParser.decodePageToHtml).mockReset()
    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue('')
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')
  })

  it('renders IntermediateDocumentViewer when ocr prop is passed', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} ocr />)
    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
  })

  it('renders IntermediateDocumentViewer when onTextSelectionEnd is passed', () => {
    const onTextSelectionEnd = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} onTextSelectionEnd={onTextSelectionEnd} />)
    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
  })

  it('renders IntermediateDocumentViewer when onTextSelectionChange is passed', () => {
    const onTextSelectionChange = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })
    render(
      <Reader document={doc} onTextSelectionChange={onTextSelectionChange} />
    )
    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
  })

  it('forwards onTextSelectionEnd so viewer calls it on mouseup', async () => {
    const onTextSelectionEnd = vi.fn()
    const { document } = makeLazyDocument(1)
    render(
      <Reader document={document} onTextSelectionEnd={onTextSelectionEnd} />
    )

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const textSpan = viewerRoot.querySelector(
      '[data-text-id="text-1"]'
    ) as HTMLElement

    const selection = {
      isCollapsed: false,
      anchorNode: textSpan,
      focusNode: textSpan,
      toString: () => 'Page 1 text',
      containsNode: (node: Node) => node === textSpan
    } as unknown as Selection

    vi.spyOn(window, 'getSelection').mockReturnValue(selection)

    viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
    const [text, detail] = onTextSelectionEnd.mock.calls[0]
    expect(text.id).toBe('text-1')
    expect(detail.selectedText).toBe('Page 1 text')
  })

  it('forwards onSelectText so viewer calls it on mouseup', async () => {
    const onSelectText = vi.fn()
    const { document } = makeLazyDocument(1)
    render(<Reader document={document} onSelectText={onSelectText} />)

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const textSpan = viewerRoot.querySelector(
      '[data-text-id="text-1"]'
    ) as HTMLElement
    const textNode = textSpan.firstChild
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected rendered text span to contain a text node')
    }
    const range = globalThis.document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 11)

    const selection = {
      isCollapsed: false,
      anchorNode: textNode,
      anchorOffset: 0,
      focusNode: textNode,
      focusOffset: 11,
      rangeCount: 1,
      getRangeAt: (index: number) => {
        if (index !== 0) {
          throw new Error('Selection mock only contains one range')
        }
        return range
      },
      toString: () => 'Page 1 text',
      containsNode: (node: Node) => range.intersectsNode(node)
    } as unknown as Selection

    vi.spyOn(window, 'getSelection').mockReturnValue(selection)

    viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(onSelectText).toHaveBeenCalledTimes(1)
    const [nativeSelection, segments, extractedText] =
      onSelectText.mock.calls[0]
    expect(nativeSelection).toBe(selection)
    expect(extractedText).toBe('Page 1 text')
    expect(extractedText).toBe(
      segments
        .map((segment: { selectedText: string }) => segment.selectedText)
        .join('')
    )
    expect(segments[0]).toMatchObject({
      id: 'text-1',
      selectedText: 'Page 1 text',
      startCharIndex: 0,
      endCharIndex: 11
    })
  })

  it('forwards onTextSelectionChange so viewer calls it on selection', async () => {
    const onTextSelectionChange = vi.fn()
    const { document } = makeLazyDocument(1)
    render(
      <Reader
        document={document}
        onTextSelectionChange={onTextSelectionChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const textSpan = viewerRoot.querySelector(
      '[data-text-id="text-1"]'
    ) as HTMLElement

    const selection = {
      isCollapsed: false,
      anchorNode: textSpan,
      focusNode: textSpan,
      toString: () => 'Page 1 text',
      containsNode: (node: Node) => node === textSpan
    } as unknown as Selection

    vi.spyOn(window, 'getSelection').mockReturnValue(selection)

    globalThis.document.dispatchEvent(new Event('selectionchange'))

    expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
    const [text, detail] = onTextSelectionChange.mock.calls[0]
    expect(text.id).toBe('text-1')
    expect(detail.selectedText).toBe('Page 1 text')
  })

  it('forwards ocr prop so viewer attempts OCR on visible pages with thumbnails', async () => {
    const { ImageParser } = await import('@hamster-note/image-parser')
    const encodeSpy = vi.mocked(ImageParser.encode)
    encodeSpy.mockClear()

    const { document } = makeLazyDocument(1)
    const pageWithThumbnail = {
      getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
      thumbnail: 'data:image/png;base64,abc123'
    }
    vi.mocked(document.getPageByPageNumber).mockResolvedValue(
      pageWithThumbnail as unknown as Awaited<
        ReturnType<typeof document.getPageByPageNumber>
      >
    )

    render(<Reader document={document} ocr />)

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    intersectionObserverMock.trigger(screen.getByTestId('intermediate-page-1'))

    await waitFor(() => {
      expect(encodeSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('forwards pageRange to IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(5)

    render(<Reader document={document} pageRange={{ start: 2, end: 4 }} />)

    // Pages outside range should not exist
    expect(screen.queryByTestId('intermediate-page-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('intermediate-page-5')).not.toBeInTheDocument()

    // Pages within range should exist
    expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-4')).toBeInTheDocument()
  })

  it('renders all pages when pageRange is not provided', () => {
    const { document } = makeLazyDocument(3)

    render(<Reader document={document} />)

    expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
  })

  it('forwards interactionMode="stylus" to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} interactionMode='stylus' />)
    expect(capturedViewerProps.interactionMode).toBe('stylus')
  })

  it('defaults interactionMode to undefined when not provided (viewer defaults to "default")', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} />)
    expect(capturedViewerProps.interactionMode).toBeUndefined()
  })

  it('forwards overlayRectType="percent" to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} {...{ overlayRectType: 'percent' }} />)
    expect(capturedViewerProps.overlayRectType).toBe('percent')
  })

  it('forwards overlayRectType="px" to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} {...{ overlayRectType: 'px' }} />)
    expect(capturedViewerProps.overlayRectType).toBe('px')
  })

  it('forwards autoHighlight and highlightPopover to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    const popover = <div>Test Popover</div>
    render(
      <Reader document={doc} autoHighlight={true} highlightPopover={popover} />
    )
    expect(capturedViewerProps.autoHighlight).toBe(true)
    expect(capturedViewerProps.highlightPopover).toBe(popover)
  })

  it('compile-time: overlayRectType satisfies ReaderProps', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      overlayRectType: 'percent'
    }
    expect(props.overlayRectType).toBe('percent')
  })

  it('compile-time: interactionMode satisfies ReaderProps', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      interactionMode: 'stylus' as ReaderInteractionMode
    }
    expect(props.interactionMode).toBe('stylus')
  })
})

describe('Reader zoom props', () => {
  beforeEach(() => {
    vi.mocked(HtmlParser.decodeToHtml).mockReset()
    vi.mocked(HtmlParser.decodePageToHtml).mockReset()
    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue('')
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')
  })

  it('compile-time: zoom props satisfy ReaderProps', () => {
    const props = {
      scale: 2,
      defaultScale: 1.5,
      onScaleChange: (
        _scale: number,
        detail: {
          source: 'wheel' | 'pinch'
          focalPoint?: { x: number; y: number }
        }
      ) => detail.source,
      minScale: 0.25,
      maxScale: 4,
      maxLoadedPages: 7
    } satisfies ReaderProps

    expect(props.scale).toBe(2)
    expect(props.maxLoadedPages).toBe(7)
  })

  it('renders with all zoom and lazy-release props without errors', () => {
    const onScaleChange = vi.fn()
    render(
      <Reader
        scale={2}
        defaultScale={1.5}
        onScaleChange={onScaleChange}
        minScale={0.25}
        maxScale={4}
        maxLoadedPages={7}
        document={makeDocument({ pages: [makePage(1)] })}
      />
    )

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(capturedViewerProps.scale).toBe(2)
    expect(capturedViewerProps.defaultScale).toBe(1.5)
    expect(capturedViewerProps.onScaleChange).toBe(onScaleChange)
    expect(capturedViewerProps.minScale).toBe(0.25)
    expect(capturedViewerProps.maxScale).toBe(4)
    expect(capturedViewerProps.maxLoadedPages).toBe(7)
  })

  it('omitted renderMode forwards intermediate-document as the new viewer default', async () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} />)

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    // Reader 不传 renderMode，由 viewer 内部默认为 'intermediate-document'，
    // 因此 forwarded 到 IntermediateDocumentViewer 的 renderMode 应为 undefined。
    expect(capturedViewerProps.renderMode).toBeUndefined()
    expect(HtmlParser.decodePageToHtml).not.toHaveBeenCalled()
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('explicit renderMode="html-parser" still decodes via HtmlParser.decodePageToHtml', async () => {
    const mockHtml = '<div class="hamster-note-page">Reader HTML</div>'
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(mockHtml)

    const { document, pages } = makeLazyDocument(1)
    const page = pages.get(1)

    render(<Reader document={document} renderMode='html-parser' />)

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(page, {
      background: { backgroundQuality: 0.8 }
    })
    expect(capturedViewerProps.renderMode).toBe('html-parser')
  })

  it('forwards intermediate-document lazy props with defaults to IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} />)

    expect(capturedViewerProps.initialLoadedPages).toBeUndefined()
    expect(capturedViewerProps.pageLoadConcurrency).toBeUndefined()
    expect(capturedViewerProps.pageLoadEnterDelayMs).toBeUndefined()
    expect(capturedViewerProps.pageUnloadDelayMs).toBeUndefined()
  })

  it('forwards explicit intermediate-document lazy props to IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        renderMode='intermediate-document'
        initialLoadedPages={2}
        pageLoadConcurrency={5}
        pageLoadEnterDelayMs={250}
        pageUnloadDelayMs={3000}
      />
    )

    expect(capturedViewerProps.renderMode).toBe('intermediate-document')
    expect(capturedViewerProps.initialLoadedPages).toBe(2)
    expect(capturedViewerProps.pageLoadConcurrency).toBe(5)
    expect(capturedViewerProps.pageLoadEnterDelayMs).toBe(250)
    expect(capturedViewerProps.pageUnloadDelayMs).toBe(3000)
  })
})
