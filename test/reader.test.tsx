import { HtmlParser } from '@hamster-note/html-parser'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized
} from '@hamster-note/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Reader } from '../src/index'
import { intersectionObserverMock } from './setup'

vi.mock('@hamster-note/html-parser', () => ({
  HtmlParser: {
    decodeToHtml: vi.fn()
  }
}))

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
    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue('')
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
    const mockHtml =
      '<div class="hamster-note-document"><div class="page">Reader HTML</div></div>'
    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(mockHtml)

    const document = {
      id: 'doc-1',
      title: 'Test Document',
      pageCount: 1,
      pageNumbers: [1],
      getPageSizeByPageNumber: () => ({ x: 100, y: 150 }),
      getPageByPageNumber: () =>
        Promise.resolve({
          getContent: () => Promise.resolve([{ id: 't1', content: 'text' }])
        })
    } as unknown as IntermediateDocument

    render(<Reader document={document} />)

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    expect(HtmlParser.decodeToHtml).toHaveBeenCalledWith(document, undefined)
    expect(screen.getByTestId('html-parser-output')).toContainHTML(
      'Reader HTML'
    )
  })

  it('falls back when html-parser decode fails', async () => {
    vi.mocked(HtmlParser.decodeToHtml).mockRejectedValueOnce(
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

    render(<Reader document={document} />)

    await waitFor(() => {
      expect(screen.getByText('Reader fallback')).toBeInTheDocument()
    })

    expect(HtmlParser.decodeToHtml).toHaveBeenCalledWith(document, undefined)
    expect(screen.queryByTestId('html-parser-output')).not.toBeInTheDocument()
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

    expect(uploadZone).toBeInTheDocument()
    expect(uploadZone).toHaveTextContent('Click or drag PDF to upload')
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

  it('hides file info when document is provided', () => {
    render(<Reader document={makeDocument()} />)

    const fileInfo = screen.queryByTestId('file-info')

    expect(fileInfo).not.toBeInTheDocument()
  })
})

describe('Reader prop forwarding', () => {
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

  it('forwards selected-text body drag lifecycle props to the viewer', async () => {
    const onDragSelectedTextStart = vi.fn()
    const onDragSelectedTextMove = vi.fn()
    const onDragSelectedTextEnd = vi.fn()
    const { document } = makeLazyDocument(1)
    render(
      <Reader
        document={document}
        selectionOverlay
        onDragSelectedTextStart={onDragSelectedTextStart}
        onDragSelectedTextMove={onDragSelectedTextMove}
        onDragSelectedTextEnd={onDragSelectedTextEnd}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const page = screen.getByTestId('intermediate-page-1')
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
    const collapsedRange = {
      getClientRects: vi.fn(() => [
        {
          left: 20,
          top: 24,
          right: 20,
          bottom: 36,
          x: 20,
          y: 24,
          width: 0,
          height: 12,
          toJSON: () => ({ left: 20, top: 24, width: 0, height: 12 })
        } as DOMRect
      ]),
      getBoundingClientRect: vi.fn(
        () =>
          ({
            left: 20,
            top: 24,
            right: 20,
            bottom: 36,
            x: 20,
            y: 24,
            width: 0,
            height: 12,
            toJSON: () => ({ left: 20, top: 24, width: 0, height: 12 })
          }) as DOMRect
      ),
      collapse: vi.fn()
    } as unknown as Range
    Object.defineProperty(range, 'getClientRects', {
      configurable: true,
      value: vi.fn(() => [
        {
          left: 20,
          top: 24,
          right: 80,
          bottom: 36,
          x: 20,
          y: 24,
          width: 60,
          height: 12,
          toJSON: () => ({ left: 20, top: 24, width: 60, height: 12 })
        } as DOMRect
      ])
    })
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: vi.fn(
        () =>
          ({
            left: 20,
            top: 24,
            right: 80,
            bottom: 36,
            x: 20,
            y: 24,
            width: 60,
            height: 12,
            toJSON: () => ({ left: 20, top: 24, width: 60, height: 12 })
          }) as DOMRect
      )
    })
    Object.defineProperty(range, 'cloneRange', {
      configurable: true,
      value: vi.fn(() => collapsedRange)
    })
    vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 10,
      right: 110,
      bottom: 160,
      x: 10,
      y: 10,
      width: 100,
      height: 150,
      toJSON: () => ({ left: 10, top: 10, width: 100, height: 150 })
    } as DOMRect)
    if (!('elementFromPoint' in globalThis.document)) {
      Object.defineProperty(globalThis.document, 'elementFromPoint', {
        value: vi.fn(() => page),
        writable: true,
        configurable: true
      })
    }
    vi.spyOn(globalThis.document, 'elementFromPoint').mockReturnValue(page)

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
    globalThis.document.dispatchEvent(new Event('selectionchange'))

    const overlay = page.querySelector(
      '.hamster-reader__selection-overlay'
    ) as HTMLElement
    overlay.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 30,
        clientY: 30
      })
    )
    overlay.dispatchEvent(
      new MouseEvent('pointercancel', {
        bubbles: true,
        clientX: 500,
        clientY: 500
      })
    )

    expect(onDragSelectedTextStart).toHaveBeenCalledTimes(1)
    expect(onDragSelectedTextMove).not.toHaveBeenCalled()
    expect(onDragSelectedTextEnd).toHaveBeenCalledTimes(1)
    expect(onDragSelectedTextStart.mock.calls[0][0]).toBe(selection)
    expect(onDragSelectedTextStart.mock.calls[0][2]).toBe('Page 1 text')
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
})
