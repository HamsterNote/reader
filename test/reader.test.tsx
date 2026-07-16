import type { DrawingValue } from '@hamster-note/painting'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized,
  type IntermediateTextSerialized,
  TextDir
} from '@hamster-note/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, type RefObject, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SUPPORTED_UPLOAD_ACCEPT,
  SUPPORTED_UPLOAD_COPY
} from '../src/components/Reader'
import { sanitizeDrawingValue } from '../src/components/PageDrawingLayer'
import type {
  ReaderInteractionMode,
  ReaderProps,
  ReaderRenderMode,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderTouchPanMode
} from '../src/index'
import { Page, Reader } from '../src/index'
import type {
  LinkedSelectionData,
  LinkedSelectionRange
} from './mocks/selection'
import {
  clearSelectionProps,
  getAllSelectionProps,
  getSelectionPropsById,
  simulateLinkedDataChange,
  simulateLinkedSelect,
  simulateLinkedSelectRange,
  simulateSelectionConfirmRect
} from './mocks/selection'
import { intersectionObserverMock } from './setup'

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

vi.mock('../src/components/PopoverPortal', () => ({
  PopoverPortal: ({
    children,
    visible
  }: {
    children: React.ReactNode
    visible: boolean
  }) => (visible ? children : null)
}))

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

function makeText(id: string, content: string): IntermediateTextSerialized {
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
    dir: TextDir.LTR,
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

type RectInput = {
  left: number
  top: number
  width: number
  height: number
}

const makeDomRect = (rect: RectInput) =>
  ({
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    toJSON: () => rect
  }) as DOMRect

const mockElementRect = (element: HTMLElement, rect: RectInput) =>
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(makeDomRect(rect))

function requireReaderSelectionRef(
  ref: RefObject<ReaderSelectionRef | null>
): ReaderSelectionRef {
  if (!ref.current) {
    throw new Error('Expected Reader selection ref to be available')
  }

  return ref.current
}

function requireRuntimeSelectionId(pageSuffix = ':page-1'): string {
  const selectionId = getAllSelectionProps().find((props) =>
    props.selectionId?.endsWith(pageSuffix)
  )?.selectionId

  if (!selectionId) {
    throw new Error(`Expected runtime selection id ending with ${pageSuffix}`)
  }

  return selectionId
}

function requireLinkedData(selectionId: string): LinkedSelectionData {
  const linkedData = getAllSelectionProps().find(
    (props) => props.selectionId === selectionId
  )?.linkedData

  if (!linkedData) {
    throw new Error(`Expected linked data for ${selectionId}`)
  }

  return linkedData
}

function makeReaderRange(id: string, text: string): ReaderSelectionRange {
  return {
    id,
    text,
    start: { selectionId: 'page-1', offset: 0 },
    end: { selectionId: 'page-1', offset: text.length },
    createdAt: id.length,
    overlayRectType: 'percent',
    rectsBySelectionId: {
      'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
    }
  }
}

function makeRuntimeRange(
  runtimeSelectionId: string,
  id: string,
  text: string
): LinkedSelectionRange {
  return {
    id,
    text,
    start: { selectionId: runtimeSelectionId, offset: 0 },
    end: { selectionId: runtimeSelectionId, offset: text.length },
    createdAt: id.length,
    overlayRectType: 'percent',
    rectsBySelectionId: {
      [runtimeSelectionId]: [{ x: 10, y: 20, width: 30, height: 10 }]
    }
  }
}

function makeReaderRect(id: string): ReaderSelectionRectangle {
  return {
    id,
    createdAt: id.length,
    overlayRectType: 'percent',
    start: { x: 10, y: 20 },
    end: { x: 40, y: 60 },
    selectionId: 'page-1',
    rect: { x: 10, y: 20, width: 30, height: 40 }
  }
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
    capturedViewerProps = {}
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

  it('renders IntermediateDocumentViewer by default for a paged serialized document', () => {
    render(<Reader document={makeDocument({ pages: [makePage(1)] })} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
  })

  it('renders IntermediateDocumentViewer by default for a runtime document', () => {
    const runtimeDocument = IntermediateDocument.parse(
      makeDocument({ pages: [makePage(1)] })
    )

    render(<Reader document={runtimeDocument} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
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

  it('keeps the full layout viewer when drawing mode is enabled', async () => {
    const pagePaintings: Record<string, DrawingValue> = {
      'page-1': {
        strokes: [
          {
            id: 'stroke-1',
            tool: 'pen',
            strokeColor: '#2563eb',
            strokeWidth: 3,
            points: [
              { x: 10, y: 12 },
              { x: 40, y: 44 }
            ]
          }
        ]
      }
    }
    render(
      <Reader
        document={makeDocument({
          pages: [
            {
              ...makePage(1),
              texts: [makeText('legacy-text-1', 'Legacy page content')]
            }
          ]
        })}
        selectedTool='drawing'
        pagePaintings={pagePaintings}
        pageRange={{ start: 1, end: 1 }}
        scale={2}
      />
    )

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-1')).toHaveAttribute(
      'data-tool',
      'drawing'
    )
    expect(
      await screen.findByTestId('reader-painting-page-1')
    ).toBeInTheDocument()
    expect(capturedViewerProps.pageRange).toEqual({ start: 1, end: 1 })
    expect(capturedViewerProps.scale).toBe(2)
    expect(screen.getByTestId('reader-page-drawing-layer-page-1')).toHaveStyle({
      width: '200%',
      height: '200%',
      transform: 'scale(0.5)'
    })
    expect(
      screen.getByTestId('reader-painting-page-1').querySelector('path')
    ).toHaveAttribute('d', 'M 20 24 L 80 88')
  })

  it('lets selection modes receive pointer input through the drawing layer', async () => {
    const { rerender } = render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        selectedTool='text-selection'
      />
    )

    expect(
      screen.queryByTestId('reader-page-drawing-layer-page-1')
    ).not.toBeInTheDocument()

    rerender(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        selectedTool='drawing'
      />
    )

    expect(
      await screen.findByTestId('reader-page-drawing-layer-page-1')
    ).toHaveStyle({ pointerEvents: 'auto' })
  })

  it('bounds persisted drawing data before rendering viewer pages', async () => {
    const oversizedDrawing: DrawingValue = {
      strokes: Array.from({ length: 501 }, (_, index) => ({
        id: `stroke-${index}`,
        tool: 'pen',
        points: [{ x: index, y: index }]
      }))
    }

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        selectedTool='drawing'
        pagePaintings={{ 'page-1': oversizedDrawing }}
      />
    )

    expect(await screen.findByTestId('reader-painting-page-1')).toHaveAttribute(
      'data-stroke-count',
      '500'
    )
  })

  it('ignores malformed persisted drawing entries without crashing', async () => {
    const malformedDrawing = JSON.parse(
      '{"strokes":[null,{"id":"broken","points":null}]}'
    ) as DrawingValue

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        selectedTool='drawing'
        pagePaintings={{ 'page-1': malformedDrawing }}
      />
    )

    expect(await screen.findByTestId('reader-painting-page-1')).toHaveAttribute(
      'data-stroke-count',
      '0'
    )
  })

  it('bounds persisted drawing dash arrays before rendering', () => {
    // Given: one otherwise-valid stroke contains an attacker-controlled style array.
    const drawing: DrawingValue = {
      strokes: [
        {
          id: 'oversized-dash-array',
          tool: 'pen',
          points: [{ x: 10, y: 20 }],
          dashArray: Array.from({ length: 10_000 }, (_, index) => index + 1)
        }
      ]
    }

    // When: persisted page data crosses the drawing boundary.
    const sanitized = sanitizeDrawingValue(drawing)

    // Then: only a small, fixed prefix is retained for rendering.
    expect(sanitized.strokes[0]?.dashArray).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1)
    )
  })

  it('renders current serialized page content with container-scaled text geometry', () => {
    render(
      <Page
        page={{
          ...makePage(1),
          content: [makeText('content-text-1', 'Current page content')],
          texts: undefined
        }}
        selectedTool='text-selection'
      />
    )

    const text = screen.getByTestId('reader-page-text-content-text-1')
    expect(text).toHaveTextContent('Current page content')
    expect(text.getAttribute('style')).toContain('font-size: 12%')
    expect(text.getAttribute('style')).toContain(
      'line-height: 133.33333333333331%'
    )
    expect(screen.getByText('Content').nextElementSibling).toHaveTextContent(
      '1'
    )
  })

  it('preserves rapid uncontrolled painting updates across pages', () => {
    const onPagePaintingsChange = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1), makePage(2)] })}
        selectedTool='drawing'
        onPagePaintingsChange={onPagePaintingsChange}
      />
    )

    const updatePainting = capturedViewerProps.onPagePaintingChange
    if (typeof updatePainting !== 'function') {
      throw new Error('Expected viewer painting update callback')
    }

    const pageOneValue: DrawingValue = { strokes: [] }
    const pageTwoValue: DrawingValue = { strokes: [] }
    act(() => {
      updatePainting('page-1', pageOneValue)
      updatePainting('page-2', pageTwoValue)
    })

    expect(onPagePaintingsChange).toHaveBeenLastCalledWith({
      'page-1': pageOneValue,
      'page-2': pageTwoValue
    })
  })
})

describe('Reader renderMode', () => {
  it('default renderMode renders the layout viewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
    expect(
      screen.queryByTestId('intermediate-document-text-viewer')
    ).not.toBeInTheDocument()
  })

  it('explicit renderMode="layout" renders the layout viewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} renderMode='layout' />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
    expect(
      screen.queryByTestId('intermediate-document-text-viewer')
    ).not.toBeInTheDocument()
  })

  it('renderMode text renders the separate text viewer without VirtualPaper', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} renderMode='text' />)

    expect(
      screen.getByTestId('intermediate-document-text-viewer')
    ).toBeInTheDocument()
    // 文本模式必须不渲染 VirtualPaper wrapper
    expect(
      screen.queryByTestId('virtual-paper-wrapper')
    ).not.toBeInTheDocument()
    // 文本模式也不应渲染 layout 模式的 viewer 根节点
    expect(
      screen.queryByTestId('intermediate-document-viewer')
    ).not.toBeInTheDocument()
  })

  it('renderMode text forwards only text-mode props without runtime errors', () => {
    const onTextSelectionChange = vi.fn()
    const onTextSelectionEnd = vi.fn()
    const onSelectText = vi.fn()
    const onTiming = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })

    render(
      <Reader
        document={doc}
        renderMode='text'
        pageRange={{ start: 1, end: 1 }}
        maxLoadedPages={5}
        initialLoadedPages={2}
        pageLoadConcurrency={4}
        pageLoadEnterDelayMs={250}
        pageUnloadDelayMs={3000}
        onTextSelectionChange={onTextSelectionChange}
        onTextSelectionEnd={onTextSelectionEnd}
        onSelectText={onSelectText}
        onIntermediateDocumentRenderTiming={onTiming}
      />
    )

    const textViewer = screen.getByTestId('intermediate-document-text-viewer')
    expect(textViewer).toBeInTheDocument()
    expect(textViewer).toHaveAttribute('data-title', 'Hamster Reader Title')
    // 文本模式同样挂在 reader-content 内
    expect(screen.getByTestId('reader-content')).toContainElement(textViewer)
  })

  it('renderMode text renders for a runtime (lazy) document', () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} renderMode='text' />)

    expect(
      screen.getByTestId('intermediate-document-text-viewer')
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('virtual-paper-wrapper')
    ).not.toBeInTheDocument()
  })

  it('compile-time: renderMode satisfies ReaderProps as ReaderRenderMode', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      renderMode: 'text' as ReaderRenderMode
    }
    expect(props.renderMode).toBe('text')
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
    capturedViewerProps = {}
    clearSelectionProps()
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

  it('forwards touchPanMode="two-finger" to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} touchPanMode='two-finger' />)
    expect(capturedViewerProps.touchPanMode).toBe('two-finger')
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

  it('forwards Reader selection, scale, and lazy props to IntermediateDocumentViewer unchanged', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    const selectionRef = createRef<ReaderSelectionRef>()
    const onScaleChange = vi.fn()
    const ranges: ReaderSelectionRange[] = [
      {
        id: 'forwarded-range',
        text: 'Forwarded range',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 11 },
        createdAt: 10,
        overlayRectType: 'percent',
        rectsBySelectionId: {
          'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
        }
      }
    ]

    render(
      <Reader
        document={doc}
        selectionRef={selectionRef}
        ranges={ranges}
        selectedRangeId='forwarded-range'
        overlayRectType='percent'
        initialLoadedPages={2}
        pageLoadConcurrency={4}
        pageLoadEnterDelayMs={250}
        pageUnloadDelayMs={3000}
        onScaleChange={onScaleChange}
      />
    )

    expect(capturedViewerProps.selectionRef).toBe(selectionRef)
    expect(capturedViewerProps.ranges).toBe(ranges)
    expect(capturedViewerProps.selectedRangeId).toBe('forwarded-range')
    expect(capturedViewerProps.overlayRectType).toBe('percent')
    expect(capturedViewerProps.initialLoadedPages).toBe(2)
    expect(capturedViewerProps.pageLoadConcurrency).toBe(4)
    expect(capturedViewerProps.pageLoadEnterDelayMs).toBe(250)
    expect(capturedViewerProps.pageUnloadDelayMs).toBe(3000)
    expect(capturedViewerProps.onScaleChange).toBe(onScaleChange)
  })

  it('exposes scrollToRange on the forwarded Reader ref without firing onScaleChange', async () => {
    // Given: Reader owns the public ref and a controlled selected range on page 3.
    const selectionRef = createRef<ReaderSelectionRef>()
    const onScaleChange = vi.fn()
    const range: ReaderSelectionRange = {
      id: 'reader-jump-page-3',
      text: 'Reader jump target',
      start: { selectionId: 'page-3', offset: 0 },
      end: { selectionId: 'page-3', offset: 11 },
      createdAt: 30,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-3': [{ x: 10, y: 20, width: 20, height: 20 }]
      }
    }
    const { document } = makeLazyDocument(3)

    render(
      <Reader
        document={document}
        ranges={[range]}
        selectedRangeId='reader-jump-page-3'
        selectionRef={selectionRef}
        initialLoadedPages={1}
        scale={2}
        onScaleChange={onScaleChange}
      />
    )
    await screen.findByText('Page 1 text')
    mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
      left: 0,
      top: 0,
      width: 50,
      height: 100
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    expect(publicRef).toEqual({
      highlight: expect.any(Function),
      confirm: expect.any(Function),
      confirmRect: expect.any(Function),
      clear: expect.any(Function),
      scrollToRange: expect.any(Function),
      scrollToRect: expect.any(Function),
      undo: expect.any(Function),
      redo: expect.any(Function),
      canUndo: expect.any(Function),
      canRedo: expect.any(Function),
      getAnnotationHistoryState: expect.any(Function),
      scrollToPosition: expect.any(Function)
    })

    // When: callers jump through Reader's public selectionRef.
    act(() => {
      publicRef.scrollToRange('reader-jump-page-3')
    })

    // Then: VirtualPaper translation changes, scale stays controlled, and no scale callback fires.
    expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
      transform: 'translate3d(-15px, -704px, 0) scale(2)'
    })
    expect(onScaleChange).not.toHaveBeenCalled()

    // And: selected-range ownership stays with selectedRangeId and the range's start page.
    await screen.findByText('Page 3 text')
    await waitFor(() => {
      expect(
        getAllSelectionProps().some((props) =>
          props.selectionId?.endsWith(':page-3')
        )
      ).toBe(true)
    })
    const pageThreeSelectionProps = getAllSelectionProps().find((props) =>
      props.selectionId?.endsWith(':page-3')
    )
    expect(pageThreeSelectionProps?.linkedData?.selectedRangeId).toBe(
      'reader-jump-page-3'
    )
    expect(
      pageThreeSelectionProps?.linkedData?.items.find(
        (item) => item.id === 'reader-jump-page-3'
      )?.start.selectionId
    ).toBe(pageThreeSelectionProps?.selectionId)
  })

  it('exposes scrollToPosition on the forwarded Reader ref without firing onScaleChange', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onScaleChange = vi.fn()
    const { document } = makeLazyDocument(3)

    render(
      <Reader
        document={document}
        selectionRef={selectionRef}
        initialLoadedPages={1}
        scale={1.5}
        onScaleChange={onScaleChange}
      />
    )
    await screen.findByText('Page 1 text')
    mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
      left: 0,
      top: 0,
      width: 200,
      height: 300
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    act(() => {
      publicRef.scrollToPosition({ x: 120, y: 240 })
    })

    // scrollToPosition treats x/y as content-space scroll offsets.
    // With scale=1.5 and a 200x300 wrapper, the x offset is centered
    // because scaled content width (150px) fits; y is clamped to -360px
    // because scaled content height (723px) is taller than the wrapper.
    expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
      transform: 'translate3d(25px, -360px, 0) scale(1.5)'
    })
    expect(onScaleChange).not.toHaveBeenCalled()
  })

  it('exposes scrollToRect on the forwarded Reader ref without firing onScaleChange', async () => {
    // Given: Reader owns the public ref and a controlled rect on page 3.
    const selectionRef = createRef<ReaderSelectionRef>()
    const onScaleChange = vi.fn()
    const { document } = makeLazyDocument(3)

    render(
      <Reader
        document={document}
        rects={[
          {
            id: 'reader-rect-page-3',
            createdAt: 40,
            overlayRectType: 'percent',
            start: { x: 10, y: 20 },
            end: { x: 30, y: 40 },
            selectionId: 'page-3',
            rect: { x: 10, y: 20, width: 20, height: 20 }
          }
        ]}
        selectedRectId='reader-rect-page-3'
        selectionRef={selectionRef}
        initialLoadedPages={1}
        scale={2}
        onScaleChange={onScaleChange}
      />
    )
    await screen.findByText('Page 1 text')
    mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
      left: 0,
      top: 0,
      width: 50,
      height: 100
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    act(() => {
      publicRef.scrollToRect('reader-rect-page-3')
    })

    // Then: VirtualPaper translates to center page 3's rect, scale stays controlled.
    expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
      transform: 'translate3d(-15px, -704px, 0) scale(2)'
    })
    expect(onScaleChange).not.toHaveBeenCalled()

    await screen.findByText('Page 3 text')
  })

  it('maps public rect selection ids to runtime ids for Selection and back to public ids on create', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onCreateRect = vi.fn()
    const { document } = makeLazyDocument(3)

    render(
      <Reader
        document={document}
        rects={[
          {
            id: 'reader-rect-page-1',
            createdAt: 40,
            overlayRectType: 'percent',
            start: { x: 10, y: 20 },
            end: { x: 30, y: 40 },
            selectionId: 'page-1',
            rect: { x: 10, y: 20, width: 20, height: 20 }
          }
        ]}
        selectionRef={selectionRef}
        tool='rect'
        onCreateRect={onCreateRect}
        initialLoadedPages={1}
      />
    )

    await screen.findByText('Page 1 text')
    let pageOneSelectionProps = getAllSelectionProps().find((props) =>
      props.selectionId?.endsWith(':page-1')
    )
    await waitFor(() => {
      pageOneSelectionProps = getAllSelectionProps().find((props) =>
        props.selectionId?.endsWith(':page-1')
      )
      expect(pageOneSelectionProps?.rects).toEqual([
        expect.objectContaining({
          selectionId: pageOneSelectionProps?.selectionId
        })
      ])
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    act(() => {
      publicRef.confirmRect()
    })

    expect(onCreateRect).toHaveBeenCalledWith(
      expect.objectContaining({ selectionId: 'page-1' })
    )
  })

  it('forwards autoHighlight, highlightPopover, and highlight comments to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    const popover = <div>Test Popover</div>
    const onCommentHighlight = vi.fn(
      async (highlight: ReaderSelectionRange) => highlight
    )
    render(
      <Reader
        document={doc}
        autoHighlight={true}
        highlightPopover={popover}
        onCommentHighlight={onCommentHighlight}
      />
    )
    expect(capturedViewerProps.autoHighlight).toBe(true)
    expect(capturedViewerProps.highlightPopover).toBe(popover)
    expect(capturedViewerProps.onCommentHighlight).toBe(onCommentHighlight)
  })

  it('renders an existing highlight popover from the original range reference', async () => {
    // Given: the selected highlight has its own color, which differs from the
    // current global color used for newly-created highlights.
    const range: ReaderSelectionRange = {
      id: 'colored-highlight',
      text: 'Colored highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 8 },
      createdAt: 10,
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
      },
      markerStyle: { backgroundColor: '#ff3366' }
    }
    const highlightPopover = vi.fn((highlight: ReaderSelectionRange) => (
      <input
        aria-label='Existing highlight color'
        value={String(highlight.markerStyle?.backgroundColor ?? '#ffee00')}
        readOnly
      />
    ))

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        ranges={[range]}
        selectedRangeId={range.id}
        highlightColor='#ffee00'
        highlightPopover={highlightPopover}
      />
    )

    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const [selectionProps] = getAllSelectionProps()

    // When: Selection mounts the existing-highlight popover.
    render(selectionProps?.popover)

    // Then: the render function receives the exact public range object and can
    // prioritize that highlight's persisted color over the global picker color.
    expect(highlightPopover).toHaveBeenCalledWith(range)
    expect(screen.getByLabelText('Existing highlight color')).toHaveValue(
      '#ff3366'
    )
  })

  it('closes an existing highlight popover after its comment promise resolves', async () => {
    // Given: a selected public highlight and a host-controlled comment flow.
    const user = userEvent.setup()
    const range: ReaderSelectionRange = {
      id: 'commented-highlight',
      text: 'Commented highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 8 },
      createdAt: 11,
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
      }
    }
    let finishComment: ((highlight: ReaderSelectionRange) => void) | undefined
    const onCommentHighlight = vi.fn(
      (_highlight: ReaderSelectionRange) =>
        new Promise<ReaderSelectionRange>((resolve) => {
          finishComment = resolve
        })
    )
    const onSelectRange = vi.fn()

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        ranges={[range]}
        selectedRangeId={range.id}
        highlightPopover={<span>Highlight actions</span>}
        onCommentHighlight={onCommentHighlight}
        onSelectRange={onSelectRange}
      />
    )
    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const [selectionProps] = getAllSelectionProps()
    const popoverView = render(selectionProps?.popover)

    // When: the user starts commenting, the original range reference is passed
    // to the host and the popover stays open while the promise is pending.
    const commentButton = screen.getByRole('button', { name: '评论' })
    await user.click(commentButton)
    expect(onCommentHighlight).toHaveBeenCalledWith(range)
    const [pendingSelectionProps] = getAllSelectionProps()
    popoverView.rerender(pendingSelectionProps?.popover)
    expect(screen.getByRole('button', { name: '评论' })).toBeDisabled()
    expect(onSelectRange).not.toHaveBeenCalled()

    // Then: resolving with that same reference marks commenting as finished and
    // clears the selected range, which closes the existing-highlight popover.
    await act(async () => {
      finishComment?.(range)
      await Promise.resolve()
    })
    expect(onSelectRange).toHaveBeenCalledWith(null)
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

  it('compile-time: touchPanMode satisfies ReaderProps', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      touchPanMode: 'two-finger' as ReaderTouchPanMode
    }
    expect(props.touchPanMode).toBe('two-finger')
  })

  it('forwards onIntermediateDocumentRenderTiming to IntermediateDocumentViewer', () => {
    const onIntermediateDocumentRenderTiming = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })
    render(
      <Reader
        document={doc}
        onIntermediateDocumentRenderTiming={onIntermediateDocumentRenderTiming}
      />
    )
    expect(capturedViewerProps.onIntermediateDocumentRenderTiming).toBe(
      onIntermediateDocumentRenderTiming
    )
  })

  it('compile-time: onIntermediateDocumentRenderTiming satisfies ReaderProps', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      onIntermediateDocumentRenderTiming: (entry) => {
        expect(entry.durationMs).toBeGreaterThanOrEqual(0)
      }
    }
    expect(props.onIntermediateDocumentRenderTiming).toBeTypeOf('function')
  })

  it('normalizes and forwards annotationHistory options to IntermediateDocumentViewer', () => {
    const onAnnotationHistoryChange = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        annotationHistory={{ resetKey: 'doc-1' }}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
      />
    )

    expect(capturedViewerProps.annotationHistory).toEqual({
      enabled: true,
      resetKey: 'doc-1'
    })
    expect(capturedViewerProps.onAnnotationHistoryChange).toBe(
      onAnnotationHistoryChange
    )
  })
})

describe('Reader annotation history', () => {
  beforeEach(() => {
    clearSelectionProps()
  })

  it('undoes controlled ranges and rects by proposing the previous full snapshot', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const initialRect = makeReaderRect('rect-1')
    const onAnnotationHistoryChange = vi.fn()
    const { document } = makeLazyDocument(1)

    function ControlledReader() {
      const [controlledRanges, setControlledRanges] = useState([initialRange])
      const [controlledRects, setControlledRects] = useState([initialRect])
      const [selectedRangeId, setSelectedRangeId] = useState<string | null>(
        initialRange.id
      )
      const [selectedRectId, setSelectedRectId] = useState<string | null>(
        initialRect.id
      )

      return (
        <Reader
          document={document}
          ranges={controlledRanges}
          rects={controlledRects}
          selectedRangeId={selectedRangeId}
          selectedRectId={selectedRectId}
          annotationHistory
          selectionRef={selectionRef}
          onAnnotationHistoryChange={(next, detail) => {
            onAnnotationHistoryChange(next, detail)
            setControlledRanges(next.ranges)
            setControlledRects(next.rects)
            setSelectedRangeId(next.selectedRangeId)
            setSelectedRectId(next.selectedRectId)
          }}
        />
      )
    }

    render(<ControlledReader />)
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const updatedRange = makeRuntimeRange(
      runtimeSelectionId,
      initialRange.id,
      'After'
    )

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [updatedRange],
        selectedRangeId: initialRange.id
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ranges: [expect.objectContaining({ text: 'After' })]
        }),
        expect.objectContaining({ source: 'update-range' })
      )
    })

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })

    expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
      {
        ranges: [initialRange],
        rects: [initialRect],
        selectedRangeId: initialRange.id,
        selectedRectId: initialRect.id
      },
      expect.objectContaining({ source: 'undo' })
    )
  })

  it('returns false for controlled undo and redo without onAnnotationHistoryChange', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        ranges={[initialRange]}
        annotationHistory
        selectionRef={selectionRef}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, initialRange.id, 'After')],
        selectedRangeId: initialRange.id
      })
    })

    expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe('Before')
    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(false)
      expect(requireReaderSelectionRef(selectionRef).redo()).toBe(false)
    })
    expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe('Before')
  })

  it('does not call single-item mutation callbacks during undo or redo replay', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const onCreateRect = vi.fn()
    const onUpdateRect = vi.fn()
    const onSelect = vi.fn()
    const onUpdateRange = vi.fn()
    const { document } = makeLazyDocument(1)

    function ControlledReader() {
      const [controlledRects, setControlledRects] = useState<
        ReaderSelectionRectangle[]
      >([])

      return (
        <Reader
          document={document}
          rects={controlledRects}
          annotationHistory
          selectionRef={selectionRef}
          onAnnotationHistoryChange={(next, detail) => {
            onAnnotationHistoryChange(next, detail)
            setControlledRects(next.rects)
          }}
          onCreateRect={onCreateRect}
          onUpdateRect={onUpdateRect}
          onSelect={onSelect}
          onUpdateRange={onUpdateRange}
          tool='rect'
        />
      )
    }

    render(<ControlledReader />)
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateSelectionConfirmRect(runtimeSelectionId)
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rects: [expect.objectContaining({ id: 'rect-highlight-id' })]
        }),
        expect.objectContaining({ source: 'create-rect' })
      )
    })
    expect(onCreateRect).toHaveBeenCalledTimes(1)

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })
    act(() => {
      expect(requireReaderSelectionRef(selectionRef).redo()).toBe(true)
    })

    expect(onCreateRect).toHaveBeenCalledTimes(1)
    expect(onUpdateRect).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onUpdateRange).not.toHaveBeenCalled()
  })

  it('calls onAnnotationHistoryChange for direct annotation mutations', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const { document } = makeLazyDocument(1)

    function ControlledReader() {
      const [controlledRanges, setControlledRanges] = useState<
        ReaderSelectionRange[]
      >([])
      const [controlledRects, setControlledRects] = useState<
        ReaderSelectionRectangle[]
      >([])
      const [selectedRangeId, setSelectedRangeId] = useState<string | null>(
        null
      )
      const [selectedRectId, setSelectedRectId] = useState<string | null>(null)

      return (
        <Reader
          document={document}
          ranges={controlledRanges}
          rects={controlledRects}
          selectedRangeId={selectedRangeId}
          selectedRectId={selectedRectId}
          annotationHistory
          selectionRef={selectionRef}
          onAnnotationHistoryChange={(next, detail) => {
            onAnnotationHistoryChange(next, detail)
            setControlledRanges(next.ranges)
            setControlledRects(next.rects)
            setSelectedRangeId(next.selectedRangeId)
            setSelectedRectId(next.selectedRectId)
          }}
        />
      )
    }

    render(<ControlledReader />)
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const createdRange = makeRuntimeRange(
      runtimeSelectionId,
      'range-1',
      'Before'
    )

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [createdRange],
        selectedRangeId: createdRange.id
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ranges: [expect.objectContaining({ id: createdRange.id })]
        }),
        expect.objectContaining({ source: 'select' })
      )
    })

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, createdRange.id, 'After')],
        selectedRangeId: createdRange.id
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ranges: [expect.objectContaining({ text: 'After' })]
        }),
        expect.objectContaining({ source: 'update-range' })
      )
    })

    act(() => {
      getSelectionPropsById(runtimeSelectionId)?.onCreateRect?.({
        ...makeReaderRect('rect-1'),
        selectionId: runtimeSelectionId
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rects: [expect.objectContaining({ id: 'rect-1' })]
        }),
        expect.objectContaining({ source: 'create-rect' })
      )
    })

    act(() => {
      getSelectionPropsById(runtimeSelectionId)?.onUpdateRect?.({
        ...makeReaderRect('rect-1'),
        end: { x: 80, y: 90 },
        rect: { x: 10, y: 20, width: 70, height: 70 },
        selectionId: runtimeSelectionId
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rects: [expect.objectContaining({ end: { x: 80, y: 90 } })]
        }),
        expect.objectContaining({ source: 'update-rect' })
      )
    })

    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges: vi.fn()
    } as unknown as Selection)

    act(() => {
      requireReaderSelectionRef(selectionRef).clear()
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        { ranges: [], rects: [], selectedRangeId: null, selectedRectId: null },
        expect.objectContaining({ source: 'clear' })
      )
    })
  })

  it('does not create a checkpoint for selection-only clicks', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory
        selectionRef={selectionRef}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedSelectRange(runtimeSelectionId, initialRange.id)
    })

    expect(onAnnotationHistoryChange).not.toHaveBeenCalled()
    expect(requireReaderSelectionRef(selectionRef).canUndo()).toBe(false)
    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(false)
    })
  })

  it('creates one highlight checkpoint when a new range surfaces through select and highlight callbacks', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const onSelect = vi.fn()
    const onHighlight = vi.fn()
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        annotationHistory
        selectionRef={selectionRef}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
        onSelect={onSelect}
        onHighlight={onHighlight}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const createdRange = makeRuntimeRange(
      runtimeSelectionId,
      'range-1',
      'Created'
    )

    act(() => {
      requireReaderSelectionRef(selectionRef).highlight()
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [createdRange],
        selectedRangeId: createdRange.id
      })
      simulateLinkedSelect(runtimeSelectionId, createdRange)
    })

    expect(onAnnotationHistoryChange).toHaveBeenCalledTimes(1)
    expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ranges: [expect.objectContaining({ id: createdRange.id })]
      }),
      expect.objectContaining({ source: 'highlight' })
    )
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onHighlight).toHaveBeenCalledTimes(1)
    expect(
      requireReaderSelectionRef(selectionRef).getAnnotationHistoryState()
    ).toEqual(expect.objectContaining({ canUndo: true, pastCount: 1 }))
  })

  it('excludes pagePaintings from history entries and undo replay', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const onPagePaintingsChange = vi.fn()
    const pagePaintings: Record<string, DrawingValue> = {
      'page-1': { strokes: [] }
    }
    const nextPaintings: Record<string, DrawingValue> = {
      'page-1': {
        strokes: [
          {
            id: 'stroke-1',
            tool: 'pen',
            points: [{ x: 1, y: 2 }]
          }
        ]
      }
    }
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        annotationHistory
        selectionRef={selectionRef}
        pagePaintings={pagePaintings}
        onPagePaintingsChange={onPagePaintingsChange}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
      />
    )
    await screen.findByText('Page 1 text')
    const updatePainting = capturedViewerProps.onPagePaintingChange
    if (typeof updatePainting !== 'function') {
      throw new Error('Expected viewer painting update callback')
    }

    act(() => {
      updatePainting('page-1', nextPaintings['page-1'])
    })

    expect(onPagePaintingsChange).toHaveBeenCalledTimes(1)
    expect(onPagePaintingsChange).toHaveBeenLastCalledWith(nextPaintings)
    expect(onAnnotationHistoryChange).not.toHaveBeenCalled()
    expect(requireReaderSelectionRef(selectionRef).canUndo()).toBe(false)

    const runtimeSelectionId = requireRuntimeSelectionId()
    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, 'range-1', 'Paint safe')],
        selectedRangeId: 'range-1'
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ pagePaintings: expect.anything() }),
        expect.objectContaining({ source: 'select' })
      )
    })

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })

    expect(onPagePaintingsChange).toHaveBeenCalledTimes(1)
    expect(capturedViewerProps.pagePaintings).toBe(pagePaintings)
  })

  it('undoes and redoes an uncontrolled text range mutation through selectionRef', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory
        selectionRef={selectionRef}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const updatedRange = makeRuntimeRange(
      runtimeSelectionId,
      'range-1',
      'After'
    )

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [updatedRange],
        selectedRangeId: 'range-1'
      })
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    expect(publicRef.canUndo()).toBe(true)

    act(() => {
      expect(publicRef.undo()).toBe(true)
    })
    await waitFor(() => {
      expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe(
        'Before'
      )
    })

    act(() => {
      expect(publicRef.redo()).toBe(true)
    })
    await waitFor(() => {
      expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe('After')
    })
  })

  it('emits the previous snapshot when controlled text history is undone', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const onAnnotationHistoryChange = vi.fn()
    const { document } = makeLazyDocument(1)

    function ControlledReader() {
      const [controlledRanges, setControlledRanges] = useState([initialRange])

      return (
        <Reader
          document={document}
          ranges={controlledRanges}
          annotationHistory
          selectionRef={selectionRef}
          onAnnotationHistoryChange={(next, detail) => {
            onAnnotationHistoryChange(next, detail)
            setControlledRanges(next.ranges)
          }}
        />
      )
    }

    render(<ControlledReader />)
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, 'range-1', 'After')],
        selectedRangeId: 'range-1'
      })
    })
    await waitFor(() => {
      expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe('After')
    })

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })

    expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ ranges: [initialRange] }),
      expect.objectContaining({ source: 'undo' })
    )
  })

  it('syncs selection-only changes without adding an undo checkpoint', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory
        selectionRef={selectionRef}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, 'range-1', 'After')],
        selectedRangeId: null
      })
    })
    const mutationCallCount = onAnnotationHistoryChange.mock.calls.length

    act(() => {
      simulateLinkedSelectRange(runtimeSelectionId, 'range-1')
    })

    expect(onAnnotationHistoryChange).toHaveBeenCalledTimes(mutationCallCount)

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })
    await waitFor(() => {
      expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe(
        'Before'
      )
    })
  })

  it('returns false when redo would apply unsupported uncontrolled rectangle history', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        annotationHistory
        selectionRef={selectionRef}
        tool='rect'
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const publicRef = requireReaderSelectionRef(selectionRef)

    act(() => {
      simulateSelectionConfirmRect(runtimeSelectionId)
    })
    act(() => {
      expect(publicRef.undo()).toBe(true)
    })
    act(() => {
      expect(publicRef.redo()).toBe(false)
    })
  })

  it('clears undo and redo stacks when resetKey changes', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)
    const { rerender } = render(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory={{ enabled: true, resetKey: 1 }}
        selectionRef={selectionRef}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, 'range-1', 'After')],
        selectedRangeId: 'range-1'
      })
    })
    expect(requireReaderSelectionRef(selectionRef).canUndo()).toBe(true)

    rerender(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory={{ enabled: true, resetKey: 2 }}
        selectionRef={selectionRef}
      />
    )

    await waitFor(() => {
      expect(requireReaderSelectionRef(selectionRef).canUndo()).toBe(false)
      expect(requireReaderSelectionRef(selectionRef).canRedo()).toBe(false)
    })
  })
})

describe('Reader zoom props', () => {
  beforeEach(() => {
    capturedViewerProps = {}
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

  it('renders IntermediateDocumentViewer by default', () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
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
        initialLoadedPages={2}
        pageLoadConcurrency={5}
        pageLoadEnterDelayMs={250}
        pageUnloadDelayMs={3000}
      />
    )

    expect(capturedViewerProps.initialLoadedPages).toBe(2)
    expect(capturedViewerProps.pageLoadConcurrency).toBe(5)
    expect(capturedViewerProps.pageLoadEnterDelayMs).toBe(250)
    expect(capturedViewerProps.pageUnloadDelayMs).toBe(3000)
  })

  it('VirtualPaper receives containMode={true} via IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} />)

    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper).toHaveAttribute('data-contain-mode', 'true')
  })

  it('forwards horizontal and independent vertical margins to IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        containMarginX={24}
        containMarginTop={32}
        containMarginBottom={64}
      />
    )

    expect(capturedViewerProps.containMarginX).toBe(24)
    expect(capturedViewerProps.containMarginTop).toBe(32)
    expect(capturedViewerProps.containMarginBottom).toBe(64)
    expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
      paddingTop: '32px',
      paddingBottom: '64px'
    })
  })

  it('defaults the page browser to closed and forwards an explicit open state', () => {
    const { document } = makeLazyDocument(2)
    const { rerender } = render(<Reader document={document} />)

    expect(capturedViewerProps.showPageBrowser).toBeUndefined()

    rerender(<Reader document={document} showPageBrowser={true} />)

    expect(capturedViewerProps.showPageBrowser).toBe(true)
  })
})
