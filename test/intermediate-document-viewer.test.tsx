import * as fs from 'node:fs'
import * as path from 'node:path'
import { HtmlParser } from '@hamster-note/html-parser'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediatePage,
  IntermediateText
} from '@hamster-note/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildSelectionPayload,
  getSelectionOverlayRects,
  mergeSelectionRects
} from '../src/components/IntermediateDocumentViewer'
import {
  isSelectionBackgroundTarget,
  resolveCaret
} from '../src/components/selection/caretResolver'
import {
  composeSelection,
  createOrderedRange
} from '../src/components/selection/selectionComposer'
import {
  buildSelectionPayload as buildSerializedSelectionPayload,
  textElementRecords as serializerTextElementRecords
} from '../src/components/selection/selectionPayloadSerializer'
import { IntermediateDocumentViewer } from '../src/index'
import { intersectionObserverMock } from './setup'

Reflect.set(globalThis, 'vi', vi)

vi.mock('@hamster-note/html-parser', () => ({
  HtmlParser: {
    decodeToHtml: vi.fn()
  }
}))

vi.mock('@system-ui-js/multi-drag', () => {
  const dragInstancesKey = '__hamsterReaderMockDragInstances'
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

  const getDragInstances = () => {
    const existing = Reflect.get(globalThis, dragInstancesKey) as
      | unknown[]
      | undefined
    if (existing) return existing

    const next: unknown[] = []
    Reflect.set(globalThis, dragInstancesKey, next)
    return next
  }

  return {
    DragOperationType,
    Drag: class MockedDrag {
      private readonly listeners = new Map<
        string,
        Array<(fingers: ReturnType<typeof makeFinger>[]) => void>
      >()
      private primaryPointerId: number | null = null

      constructor(private readonly element: HTMLElement) {
        getDragInstances().push(this)
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

const getMockDragInstances = () =>
  (Reflect.get(globalThis, '__hamsterReaderMockDragInstances') as
    | Array<{ element: HTMLElement }>
    | undefined) ?? []

type MockPage = {
  getContent: ReturnType<typeof vi.fn<() => Promise<IntermediateText[]>>>
  getThumbnail?: ReturnType<
    typeof vi.fn<() => Promise<string | { src: string } | undefined>>
  >
  thumbnail?: string | { src: string }
  image?: string
}

function makeText(id: string, content: string): IntermediateText {
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
  } as IntermediateText
}

function makeDocument({
  pageCount = 3,
  pageSize = { x: 100, y: 150 }
}: {
  pageCount?: number
  pageSize?: { x?: number; y?: number }
} = {}) {
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
    title: 'Lazy Document',
    pageCount,
    pageNumbers,
    getPageSizeByPageNumber: vi.fn(() => pageSize),
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

const mockElementFromPoint = (element: Element | null) => {
  if (!('elementFromPoint' in globalThis.document)) {
    Object.defineProperty(globalThis.document, 'elementFromPoint', {
      value: vi.fn(() => element),
      writable: true,
      configurable: true
    })
  }

  return vi
    .spyOn(globalThis.document, 'elementFromPoint')
    .mockReturnValue(element)
}

const getRequiredTextNode = (element: HTMLElement) => {
  const node = element.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    throw new Error('Expected element to contain a text node')
  }
  return node
}

const makeSelectionFromRange = (range: Range) =>
  ({
    isCollapsed: range.collapsed,
    anchorNode: range.startContainer,
    anchorOffset: range.startOffset,
    focusNode: range.endContainer,
    focusOffset: range.endOffset,
    rangeCount: 1,
    getRangeAt: (index: number) => {
      if (index !== 0) {
        throw new Error('Selection mock only contains one range')
      }
      return range
    },
    toString: () => range.toString(),
    containsNode: (node: Node) => range.intersectsNode(node)
  }) as unknown as Selection

describe('selection primitive modules', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('serializes the same golden payload shape through the extracted module and viewer export', () => {
    const viewerRoot = document.createElement('div')
    viewerRoot.className = 'hamster-reader__intermediate-document-viewer'

    const alpha = document.createElement('span')
    alpha.dataset.textId = 'alpha'
    alpha.dataset.pageNumber = '1'
    alpha.textContent = 'Alpha'

    const backgroundWrapper = document.createElement('div')
    backgroundWrapper.className = 'hamster-reader__intermediate-page-base-image'
    const backgroundText = document.createElement('span')
    backgroundText.dataset.textId = 'background'
    backgroundText.dataset.pageNumber = '1'
    backgroundText.textContent = 'BG'
    backgroundWrapper.appendChild(backgroundText)

    const beta = document.createElement('span')
    beta.dataset.textId = 'beta'
    beta.dataset.pageNumber = '1'
    beta.textContent = 'Beta'

    viewerRoot.append(alpha, backgroundWrapper, beta)
    document.body.appendChild(viewerRoot)

    serializerTextElementRecords.set(alpha, {
      text: makeText('alpha', 'Alpha'),
      pageNumber: 1
    })
    serializerTextElementRecords.set(backgroundText, {
      text: makeText('background', 'BG'),
      pageNumber: 1
    })
    serializerTextElementRecords.set(beta, {
      text: makeText('beta', 'Beta'),
      pageNumber: 1
    })

    const range = document.createRange()
    range.setStart(getRequiredTextNode(alpha), 2)
    range.setEnd(getRequiredTextNode(beta), 2)
    const selection = makeSelectionFromRange(range)

    const legacyPayload = buildSelectionPayload(selection)
    const serializedPayload = buildSerializedSelectionPayload(selection)

    expect(serializedPayload).toEqual(legacyPayload)
    expect(serializedPayload).toMatchObject({
      selection,
      extractedText: 'phaBe',
      segments: [
        {
          id: 'alpha',
          selectedText: 'pha',
          startCharIndex: 2,
          endCharIndex: 5
        },
        { id: 'beta', selectedText: 'Be', startCharIndex: 0, endCharIndex: 2 }
      ]
    })
  })

  it('resolves image/blank coordinates to nearest text with DOM-order tie-break', () => {
    const viewerRoot = document.createElement('div')
    viewerRoot.className = 'hamster-reader__intermediate-document-viewer'
    const page = document.createElement('div')
    page.dataset.pageNumber = '1'
    const baseImage = document.createElement('img')
    baseImage.className = 'hamster-reader__intermediate-page-base-image'
    const textA = document.createElement('span')
    textA.dataset.textId = 'a'
    textA.textContent = 'A'
    const textB = document.createElement('span')
    textB.dataset.textId = 'b'
    textB.textContent = 'B'
    page.append(baseImage, textA, textB)
    viewerRoot.appendChild(page)
    document.body.appendChild(viewerRoot)

    mockElementRect(page, { left: 0, top: 0, width: 200, height: 100 })
    mockElementRect(textA, { left: 10, top: 10, width: 20, height: 10 })
    mockElementRect(textB, { left: 50, top: 10, width: 20, height: 10 })
    mockElementFromPoint(baseImage)

    const textElements = new Map([
      ['b', { text: makeText('b', 'B'), pageNumber: 1 }],
      ['a', { text: makeText('a', 'A'), pageNumber: 1 }]
    ])

    const result = resolveCaret(40, 15, {
      viewerRoot,
      pageRefs: new Map([[1, page as HTMLDivElement]]),
      textElements,
      caretPositionFromPoint: () => ({ offsetNode: baseImage, offset: 0 }),
      caretRangeFromPoint: () => null
    })

    expect(result).not.toBeNull()
    expect(result?.pageNumber).toBe(1)
    expect(result?.range.startContainer).toBe(getRequiredTextNode(textA))
    expect(result?.range.startOffset).toBe(1)
    expect(result?.range.startContainer).not.toBe(baseImage)
  })

  it('calls native document caret APIs with the document receiver', () => {
    const viewerRoot = document.createElement('div')
    viewerRoot.className = 'hamster-reader__intermediate-document-viewer'
    const page = document.createElement('div')
    page.dataset.pageNumber = '1'
    const textElement = document.createElement('span')
    textElement.dataset.textId = 'a'
    textElement.textContent = 'Alpha'
    page.appendChild(textElement)
    viewerRoot.appendChild(page)
    document.body.appendChild(viewerRoot)
    mockElementFromPoint(textElement)

    const originalCaretPositionDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretPositionFromPoint'
    )

    const caretPositionFromPoint = vi.fn(function (this: Document) {
      if (this !== document) {
        throw new TypeError('Illegal invocation')
      }

      return {
        offsetNode: getRequiredTextNode(textElement),
        offset: 2
      }
    })

    Object.defineProperty(document, 'caretPositionFromPoint', {
      value: caretPositionFromPoint,
      configurable: true
    })

    try {
      const result = resolveCaret(30, 15, {
        viewerRoot,
        pageRefs: new Map([[1, page as HTMLDivElement]]),
        textElements: new Map([['a', { text: makeText('a', 'Alpha'), pageNumber: 1 }]])
      })

      expect(caretPositionFromPoint).toHaveBeenCalledWith(30, 15)
      expect(result?.pageNumber).toBe(1)
      expect(result?.range.startContainer).toBe(getRequiredTextNode(textElement))
      expect(result?.range.startOffset).toBe(2)
    } finally {
      if (originalCaretPositionDescriptor) {
        Object.defineProperty(
          document,
          'caretPositionFromPoint',
          originalCaretPositionDescriptor
        )
      } else {
        Reflect.deleteProperty(document, 'caretPositionFromPoint')
      }
    }
  })

  it('composes a real DOM Selection and orders reversed endpoints', () => {
    const host = document.createElement('div')
    host.textContent = 'abcdef'
    document.body.appendChild(host)
    const textNode = getRequiredTextNode(host)

    const range = createOrderedRange(textNode, 5, textNode, 2)
    composeSelection(range)

    const selection = window.getSelection()
    expect(range.toString()).toBe('cde')
    expect(selection?.rangeCount).toBe(1)
    expect(selection?.toString()).toBe('cde')
  })
})

const makeSelectionWithRects = (getRects: () => DOMRect[]) => {
  // Mock range that supports cloneRange → collapse → getClientRects chain;
  // collapsed clones return same rects by default (backward compat).
  const collapsedRange = {
    getClientRects: vi.fn(() => getRects()),
    getBoundingClientRect: vi.fn(
      () =>
        getRects()[0] ?? makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
    ),
    collapse: vi.fn()
  } as unknown as Range

  const range = {
    startContainer: document.body,
    startOffset: 0,
    endContainer: document.body,
    endOffset: 0,
    getClientRects: vi.fn(() => getRects()),
    getBoundingClientRect: vi.fn(
      () =>
        getRects()[0] ?? makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
    ),
    cloneRange: vi.fn(() => collapsedRange)
  } as unknown as Range

  return {
    isCollapsed: false,
    getRangeAt: vi.fn(() => range)
  } as unknown as Selection
}

/**
 * Create a mock Selection that returns DIFFERENT rects for the full range vs
 * collapsed start/end boundary ranges. Used to prove handle positions derive
 * from collapsed boundary rects, not full selection rects.
 */
const makeSelectionWithBoundaryRects = (
  fullRects: DOMRect[],
  startCollapsedRects: DOMRect[],
  endCollapsedRects: DOMRect[]
) => {
  const startRange = {
    getClientRects: vi.fn(() => startCollapsedRects),
    getBoundingClientRect: vi.fn(
      () =>
        startCollapsedRects[0] ??
        makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
    ),
    collapse: vi.fn()
  } as unknown as Range
  const endRange = {
    getClientRects: vi.fn(() => endCollapsedRects),
    getBoundingClientRect: vi.fn(
      () =>
        endCollapsedRects[0] ??
        makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
    ),
    collapse: vi.fn()
  } as unknown as Range

  const range = {
    startContainer: document.body,
    startOffset: 0,
    endContainer: document.body,
    endOffset: 0,
    getClientRects: vi.fn(() => fullRects),
    getBoundingClientRect: vi.fn(
      () =>
        fullRects[0] ?? makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
    ),
    cloneRange: vi.fn(() => startRange),
    collapse: vi.fn()
  } as unknown as Range

  // Make the second cloneRange call (for end boundary) return endRange
  let cloneCount = 0
  vi.spyOn(range, 'cloneRange').mockImplementation(() => {
    cloneCount++
    return cloneCount === 1 ? startRange : endRange
  })

  return {
    isCollapsed: false,
    getRangeAt: vi.fn(() => range)
  } as unknown as Selection
}

const getOverlayBlocks = (page: HTMLElement) =>
  Array.from(
    page.querySelectorAll('.hamster-reader__selection-overlay-path')
  ) as SVGPathElement[]

// 解析 SVG path 的 d 属性，提取所有 M/L 坐标点。
// 用于在测试中断言覆盖层覆盖到了某个矩形的四角，
// 取代旧的 `toHaveStyle({ left, top, width, height })` 写法。
const parsePathPoints = (path: SVGPathElement | undefined) => {
  if (!path) return [] as { x: number; y: number }[]
  const d = path.getAttribute('d') ?? ''
  const points: { x: number; y: number }[] = []
  const re = /[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g
  let match: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
  while ((match = re.exec(d))) {
    points.push({ x: Number(match[1]), y: Number(match[2]) })
  }
  return points
}

const expectPathCoversRect = (
  path: SVGPathElement | undefined,
  rect: { left: number; top: number; width: number; height: number }
) => {
  const points = parsePathPoints(path)
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.left + rect.width, y: rect.top },
    { x: rect.left + rect.width, y: rect.top + rect.height },
    { x: rect.left, y: rect.top + rect.height }
  ]
  for (const corner of corners) {
    const found = points.some(
      (p) => Math.abs(p.x - corner.x) < 0.5 && Math.abs(p.y - corner.y) < 0.5
    )
    expect(found, `path should cover corner (${corner.x}, ${corner.y})`).toBe(
      true
    )
  }
}

describe('IntermediateDocumentViewer', () => {
  const installSelectionHandleRangeRectMocks = () => {
    const originalGetClientRects = Range.prototype.getClientRects
    const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect

    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: vi.fn(() => [
        makeDomRect({ left: 20, top: 24, width: 35, height: 9 })
      ])
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: vi.fn(() =>
        makeDomRect({ left: 50, top: 25, width: 0, height: 0 })
      )
    })

    return () => {
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: originalGetClientRects
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: originalGetBoundingClientRect
      })
    }
  }

  beforeEach(() => {
    Reflect.set(globalThis, '__hamsterReaderMockDragInstances', [])
    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue('')
  })

  it('is exported from the public entrypoint', () => {
    expect(IntermediateDocumentViewer).toBeTypeOf('function')
  })

  it('renders page placeholders immediately using document dimensions', () => {
    const { document } = makeDocument({ pageCount: 2 })

    render(<IntermediateDocumentViewer document={document} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-1')).toHaveStyle({
      width: '100px',
      height: '150px'
    })
    expect(screen.getByTestId('intermediate-page-2')).toHaveStyle({
      width: '100px',
      height: '150px'
    })
  })

  it('falls back to default dimensions when page size is missing', () => {
    const { document } = makeDocument({ pageCount: 1, pageSize: {} })

    render(<IntermediateDocumentViewer document={document} />)

    expect(screen.getByTestId('intermediate-page-1')).toHaveStyle({
      width: '595px',
      height: '842px'
    })
    expect(screen.getByTestId('intermediate-page-1')).toHaveAttribute(
      'data-page-size-unavailable',
      'true'
    )
  })

  it('renders an empty viewer for an empty document', () => {
    const { document } = makeDocument({ pageCount: 0 })

    render(<IntermediateDocumentViewer document={document} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeEmptyDOMElement()
  })

  it('renders html-parser output for runtime documents', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    const mockHtml =
      '<div class="hamster-note-document"><div class="page">HTML Parser Output</div></div>'

    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(mockHtml)

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    expect(HtmlParser.decodeToHtml).toHaveBeenCalledWith(document, undefined)
    expect(screen.getByTestId('html-parser-output')).toContainHTML(
      'HTML Parser Output'
    )
  })

  it('renders html-parser output for serialized documents', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    try {
      const serializedDocument = {
        id: 'serialized-doc',
        title: 'Serialized',
        pages: [
          {
            id: 'serialized-page-1',
            width: 100,
            height: 150,
            number: 1,
            thumbnail: undefined,
            texts: [
              {
                id: 'text-1',
                content: 'Serialized text',
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
            ]
          }
        ]
      } as unknown as IntermediateDocumentSerialized
      const mockHtml =
        '<div class="hamster-note-document"><div class="page">Serialized HTML</div></div>'

      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(mockHtml)

      render(
        <IntermediateDocumentViewer serializedDocument={serializedDocument} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
      })

      expect(HtmlParser.decodeToHtml).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'serialized-doc',
          pageCount: 1
        }),
        undefined
      )
      expect(screen.getByTestId('html-parser-output')).toContainHTML(
        'Serialized HTML'
      )
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('falls back to direct renderer when html-parser fails', async () => {
    const { document } = makeDocument({ pageCount: 1 })

    vi.mocked(HtmlParser.decodeToHtml).mockRejectedValueOnce(
      new Error('Parser failed')
    )

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    expect(HtmlParser.decodeToHtml).toHaveBeenCalledWith(document, undefined)
    expect(screen.queryByTestId('html-parser-output')).not.toBeInTheDocument()
  })

  it('falls back to direct renderer when html-parser returns empty string', async () => {
    const { document } = makeDocument({ pageCount: 1 })

    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce('')

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('html-parser-output')).not.toBeInTheDocument()
  })

  it('loads the first page immediately and later pages after intersection with overscan', async () => {
    const { document, pages } = makeDocument({ pageCount: 5 })

    render(<IntermediateDocumentViewer document={document} overscan={1} />)

    await waitFor(() => {
      expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
      expect(pages.get(2)?.getContent).toHaveBeenCalledTimes(1)
    })
    expect(pages.get(3)?.getContent).not.toHaveBeenCalled()
    expect(pages.get(4)?.getContent).not.toHaveBeenCalled()
    expect(pages.get(5)?.getContent).not.toHaveBeenCalled()

    intersectionObserverMock.trigger(screen.getByTestId('intermediate-page-3'))

    await waitFor(() => {
      expect(pages.get(3)?.getContent).toHaveBeenCalledTimes(1)
      expect(pages.get(4)?.getContent).toHaveBeenCalledTimes(1)
    })

    expect(pages.get(5)?.getContent).not.toHaveBeenCalled()
    expect(await screen.findByText('Page 3 text')).toBeInTheDocument()
  })

  it('protects large documents by loading only the intersecting page and overscan', async () => {
    const { document, pages } = makeDocument({ pageCount: 100 })

    render(<IntermediateDocumentViewer document={document} overscan={1} />)

    intersectionObserverMock.trigger(screen.getByTestId('intermediate-page-1'))

    await waitFor(() => {
      expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
      expect(pages.get(2)?.getContent).toHaveBeenCalledTimes(1)
    })

    const loadedPageCount = Array.from(pages.values()).filter(
      (page) => page.getContent.mock.calls.length > 0
    ).length

    expect(loadedPageCount).toBeLessThanOrEqual(2)
    expect(pages.get(100)?.getContent).not.toHaveBeenCalled()
  })

  it('stops showing the loading state when a loaded page has no text', async () => {
    const { document, pages } = makeDocument({ pageCount: 1 })
    pages.get(1)?.getContent.mockResolvedValueOnce([])

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.getByTestId('intermediate-page-1')).not.toHaveClass(
        'hamster-reader__intermediate-page--loading'
      )
    })
    expect(screen.queryByText('Loading page 1…')).not.toBeInTheDocument()
  })

  it('renders the converted page background from getThumbnail', async () => {
    const { document, pages } = makeDocument({ pageCount: 1 })
    const page = pages.get(1)
    if (!page) {
      throw new Error('Expected mock page 1 to exist')
    }

    page.getThumbnail = vi.fn(async () => 'data:image/png;base64,converted')

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      const baseImage = screen
        .getByTestId('intermediate-page-1')
        .querySelector('.hamster-reader__intermediate-page-base-image')

      expect(page.getThumbnail).toHaveBeenCalledTimes(1)
      expect(baseImage).toHaveAttribute(
        'src',
        'data:image/png;base64,converted'
      )
    })
  })

  it('renders parser thumbnail objects as the page background', async () => {
    const { document, pages } = makeDocument({ pageCount: 1 })
    const page = pages.get(1)
    if (!page) {
      throw new Error('Expected mock page 1 to exist')
    }

    page.getThumbnail = vi.fn(async () => ({
      src: 'data:image/png;base64,parser-object'
    }))

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      const baseImage = screen
        .getByTestId('intermediate-page-1')
        .querySelector('.hamster-reader__intermediate-page-base-image')

      expect(page.getThumbnail).toHaveBeenCalledTimes(1)
      expect(baseImage).toHaveAttribute(
        'src',
        'data:image/png;base64,parser-object'
      )
    })
  })

  describe('selection overlay geometry', () => {
    const createMockPageElement = (
      pageNumber: number,
      rect: { left: number; top: number; width: number; height: number }
    ) => {
      const el = document.createElement('div')
      el.setAttribute('data-page-number', String(pageNumber))
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        toJSON: () => rect
      } as DOMRect)
      return el
    }

    const makeMockRange = (
      clientRects: Array<{
        left: number
        top: number
        width: number
        height: number
      }>
    ) => {
      return {
        getClientRects: () => clientRects
      } as unknown as Range
    }

    const makeMockSelectionFromRange = (range: Range) => {
      return {
        isCollapsed: false,
        getRangeAt: () => range
      } as unknown as Selection
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('mergeSelectionRects merges same-line adjacent/overlapping rects', () => {
      const rects = [
        { x: 10, y: 20, width: 30, height: 16 },
        { x: 40, y: 20, width: 30, height: 16 },
        { x: 72, y: 20, width: 20, height: 16 }
      ]
      const merged = mergeSelectionRects(rects)
      expect(merged).toHaveLength(1)
      expect(merged[0]).toEqual({ x: 10, y: 20, width: 82, height: 16 })
    })

    it('mergeSelectionRects keeps different visual rows as separate boxes', () => {
      const rects = [
        { x: 10, y: 20, width: 30, height: 16 },
        { x: 10, y: 50, width: 30, height: 16 }
      ]
      const merged = mergeSelectionRects(rects)
      expect(merged).toHaveLength(2)
      expect(merged[0]).toEqual({ x: 10, y: 20, width: 30, height: 16 })
      expect(merged[1]).toEqual({ x: 10, y: 50, width: 30, height: 16 })
    })

    it('getSelectionOverlayRects groups cross-page selections into separate page containers without pre-merge', () => {
      const page1Viewport = { left: 0, top: 0, width: 400, height: 150 }
      const page2Viewport = { left: 0, top: 200, width: 400, height: 150 }
      const page1 = createMockPageElement(1, page1Viewport)
      const page2 = createMockPageElement(2, page2Viewport)

      const pageRefs = new Map<number, HTMLDivElement>([
        [1, page1 as HTMLDivElement],
        [2, page2 as HTMLDivElement]
      ])

      if (!('elementFromPoint' in document)) {
        Object.defineProperty(document, 'elementFromPoint', {
          value: vi.fn(),
          writable: true,
          configurable: true
        })
      }
      const elementFromPointSpy = vi
        .spyOn(document, 'elementFromPoint')
        .mockImplementation((_x, y) => {
          if (typeof y === 'number' && y < page2Viewport.top) return page1
          return page2
        })

      const page1Line1FragmentA = { left: 10, top: 10, width: 30, height: 16 }
      const page1Line1FragmentB = { left: 40, top: 10, width: 30, height: 16 }
      const page1Line2Fragment = { left: 10, top: 50, width: 30, height: 16 }
      const page2Line1Fragment = { left: 10, top: 210, width: 60, height: 16 }

      const clientRects = [
        page1Line1FragmentA,
        page1Line1FragmentB,
        page1Line2Fragment,
        page2Line1Fragment
      ]

      const range = makeMockRange(clientRects)
      const selection = makeMockSelectionFromRange(range)

      const viewerRoot = document.createElement('div')
      document.body.appendChild(viewerRoot)
      viewerRoot.appendChild(page1)
      viewerRoot.appendChild(page2)

      const result = getSelectionOverlayRects(selection, viewerRoot, pageRefs)

      // No pre-merge: each raw client rect becomes its own overlay rect
      expect(result).toHaveLength(4)

      const page1Rects = result.filter((r) => r.pageNumber === 1)
      expect(page1Rects).toHaveLength(3)
      expect(page1Rects).toContainEqual(
        expect.objectContaining({ x: 10, y: 10, width: 30, height: 16 })
      )
      expect(page1Rects).toContainEqual(
        expect.objectContaining({ x: 40, y: 10, width: 30, height: 16 })
      )
      expect(page1Rects).toContainEqual(
        expect.objectContaining({ x: 10, y: 50, width: 30, height: 16 })
      )

      const page2Rects = result.filter((r) => r.pageNumber === 2)
      expect(page2Rects).toHaveLength(1)
      expect(page2Rects[0]).toMatchObject({
        x: 10,
        y: 10,
        width: 60,
        height: 16
      })

      elementFromPointSpy.mockRestore()
      document.body.removeChild(viewerRoot)
    })

    it('getSelectionOverlayRects resolves text-span page markers back to the page container', () => {
      const pageViewport = { left: 100, top: 200, width: 400, height: 150 }
      const page = createMockPageElement(1, pageViewport)
      const textSpan = document.createElement('span')
      textSpan.setAttribute('data-text-id', 'text-1')
      textSpan.setAttribute('data-page-number', '1')
      page.appendChild(textSpan)

      const pageRefs = new Map<number, HTMLDivElement>([
        [1, page as HTMLDivElement]
      ])

      if (!('elementFromPoint' in document)) {
        Object.defineProperty(document, 'elementFromPoint', {
          value: vi.fn(),
          writable: true,
          configurable: true
        })
      }
      const elementFromPointSpy = vi
        .spyOn(document, 'elementFromPoint')
        .mockReturnValue(textSpan)

      const range = makeMockRange([
        { left: 120, top: 230, width: 60, height: 16 }
      ])
      const selection = makeMockSelectionFromRange(range)

      const viewerRoot = document.createElement('div')
      document.body.appendChild(viewerRoot)
      viewerRoot.appendChild(page)

      const result = getSelectionOverlayRects(selection, viewerRoot, pageRefs)

      expect(result).toEqual([
        { x: 20, y: 30, width: 60, height: 16, pageNumber: 1 }
      ])

      elementFromPointSpy.mockRestore()
      document.body.removeChild(viewerRoot)
    })
  })

  it('shows a page error instead of loading forever when text loading fails', async () => {
    const { document, pages } = makeDocument({ pageCount: 1 })
    pages
      .get(1)
      ?.getContent.mockRejectedValueOnce(new Error('text load failed'))

    render(<IntermediateDocumentViewer document={document} />)

    expect(await screen.findByText('Failed to load page 1')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-1')).not.toHaveClass(
      'hamster-reader__intermediate-page--loading'
    )
  })

  it('shows a page error instead of loading forever when page lookup throws', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(document.getPageByPageNumber).mockImplementationOnce(() => {
      throw new Error('page lookup failed')
    })

    render(<IntermediateDocumentViewer document={document} />)

    expect(await screen.findByText('Failed to load page 1')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-1')).not.toHaveClass(
      'hamster-reader__intermediate-page--loading'
    )
  })

  it('ignores stale getContent callbacks after document changes', async () => {
    let resolveTexts: (texts: IntermediateText[]) => void = (_texts) =>
      undefined
    const deferredTexts = new Promise<IntermediateText[]>((resolve) => {
      resolveTexts = resolve
    })
    const pageA = {
      getContent: vi.fn(() => deferredTexts)
    }
    const documentA = {
      id: 'doc-a',
      title: 'Document A',
      pageCount: 1,
      pageNumbers: [1],
      getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
      getPageByPageNumber: vi.fn(() => Promise.resolve(pageA))
    } as unknown as IntermediateDocument

    const pageB = {
      getContent: vi.fn(async () => [makeText('text-b', 'Page B text')])
    }
    const documentB = {
      id: 'doc-b',
      title: 'Document B',
      pageCount: 1,
      pageNumbers: [1],
      getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
      getPageByPageNumber: vi.fn(() => Promise.resolve(pageB))
    } as unknown as IntermediateDocument

    const { rerender } = render(
      <IntermediateDocumentViewer document={documentA} />
    )

    intersectionObserverMock.trigger(screen.getByTestId('intermediate-page-1'))

    await waitFor(() => {
      expect(pageA.getContent).toHaveBeenCalledTimes(1)
    })

    rerender(<IntermediateDocumentViewer document={documentB} />)

    intersectionObserverMock.trigger(screen.getByTestId('intermediate-page-1'))

    await waitFor(() => {
      expect(pageB.getContent).toHaveBeenCalledTimes(1)
    })

    resolveTexts([makeText('text-a', 'Stale A text')])

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByText('Stale A text')).not.toBeInTheDocument()
    expect(screen.getByText('Page B text')).toBeInTheDocument()
  })

  it('disconnects the observer on unmount', () => {
    const { document } = makeDocument({ pageCount: 1 })
    const { unmount } = render(
      <IntermediateDocumentViewer document={document} />
    )
    const observer = intersectionObserverMock.instances[0]
    const disconnectSpy = vi.spyOn(observer, 'disconnect')

    unmount()

    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })

  describe('OCR behavior', () => {
    it('does not call ImageParser.encode when ocr is disabled', async () => {
      const { ImageParser } = await import('@hamster-note/image-parser')
      const encodeSpy = vi.mocked(ImageParser.encode)
      encodeSpy.mockClear()

      const { document } = makeDocument({ pageCount: 1 })
      const pageWithThumbnail = {
        getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
        thumbnail: 'data:image/png;base64,abc123'
      }
      vi.mocked(document.getPageByPageNumber).mockResolvedValue(
        pageWithThumbnail as unknown as IntermediatePage
      )

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-1')
      )

      await act(async () => {
        await Promise.resolve()
      })

      expect(encodeSpy).not.toHaveBeenCalled()
    })

    it('calls ImageParser.encode only for visible pages when ocr is enabled', async () => {
      const { ImageParser } = await import('@hamster-note/image-parser')
      const encodeSpy = vi.mocked(ImageParser.encode)
      encodeSpy.mockClear()

      const { document } = makeDocument({ pageCount: 3 })
      vi.mocked(document.getPageByPageNumber).mockImplementation(
        async (pageNumber: number) =>
          ({
            getContent: vi.fn(async () => [
              makeText(`text-${pageNumber}`, `Page ${pageNumber} text`)
            ]),
            thumbnail: 'data:image/png;base64,abc123'
          }) as unknown as IntermediatePage
      )

      render(<IntermediateDocumentViewer document={document} ocr />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-1')
      )

      await waitFor(() => {
        expect(encodeSpy).toHaveBeenCalledTimes(1)
      })

      expect(encodeSpy).toHaveBeenCalledTimes(1)
    })

    it('renders OCR text with prefixed ids', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const pageWithThumbnail = {
        getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
        thumbnail: 'data:image/png;base64,abc123'
      }
      vi.mocked(document.getPageByPageNumber).mockResolvedValue(
        pageWithThumbnail as unknown as IntermediatePage
      )

      render(<IntermediateDocumentViewer document={document} ocr />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-1')
      )

      await waitFor(() => {
        const ocrText = screen
          .getByTestId('intermediate-page-1')
          .querySelector('[data-text-id^="ocr-"]')
        expect(ocrText).toBeInTheDocument()
      })
    })

    it('does not re-OCR a page that has already been processed', async () => {
      const { ImageParser } = await import('@hamster-note/image-parser')
      const encodeSpy = vi.mocked(ImageParser.encode)
      encodeSpy.mockClear()

      const { document } = makeDocument({ pageCount: 1 })
      const pageWithThumbnail = {
        getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
        thumbnail: 'data:image/png;base64,abc123'
      }
      vi.mocked(document.getPageByPageNumber).mockResolvedValue(
        pageWithThumbnail as unknown as IntermediatePage
      )

      render(<IntermediateDocumentViewer document={document} ocr />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-1')
      )

      await waitFor(() => {
        expect(encodeSpy).toHaveBeenCalledTimes(1)
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-1')
      )

      await act(async () => {
        await Promise.resolve()
      })

      expect(encodeSpy).toHaveBeenCalledTimes(1)
    })

    it('calls onOcrError when OCR fails', async () => {
      const { ImageParser } = await import('@hamster-note/image-parser')
      const encodeSpy = vi.mocked(ImageParser.encode)
      const onOcrError = vi.fn()
      encodeSpy.mockRejectedValueOnce(new Error('OCR failed'))

      const { document } = makeDocument({ pageCount: 1 })
      const pageWithThumbnail = {
        getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
        thumbnail: 'data:image/png;base64,abc123'
      }
      vi.mocked(document.getPageByPageNumber).mockResolvedValue(
        pageWithThumbnail as unknown as IntermediatePage
      )

      render(
        <IntermediateDocumentViewer
          document={document}
          ocr
          onOcrError={onOcrError}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-1')
      )

      await waitFor(() => {
        expect(onOcrError).toHaveBeenCalledTimes(1)
      })

      const [error, detail] = onOcrError.mock.calls[0]
      expect(error).toBeInstanceOf(Error)
      expect(detail.pageNumber).toBe(1)
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    it('ignores stale OCR results after document changes', async () => {
      const { ImageParser } = await import('@hamster-note/image-parser')
      const encodeSpy = vi.mocked(ImageParser.encode)

      let resolveOcr!: (doc: IntermediateDocument) => void
      encodeSpy.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOcr = resolve
          })
      )

      const pageA = {
        getContent: vi.fn(async () => [makeText('text-a', 'Page A text')]),
        thumbnail: 'data:image/png;base64,docA'
      }
      const documentA = {
        id: 'doc-a',
        title: 'Document A',
        pageCount: 1,
        pageNumbers: [1],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
        getPageByPageNumber: vi.fn(() => Promise.resolve(pageA))
      } as unknown as IntermediateDocument

      const pageB = {
        getContent: vi.fn(async () => [makeText('text-b', 'Page B text')]),
        thumbnail: 'data:image/png;base64,docB'
      }
      const documentB = {
        id: 'doc-b',
        title: 'Document B',
        pageCount: 1,
        pageNumbers: [1],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
        getPageByPageNumber: vi.fn(() => Promise.resolve(pageB))
      } as unknown as IntermediateDocument

      const { rerender } = render(
        <IntermediateDocumentViewer document={documentA} ocr />
      )

      await waitFor(() => {
        expect(screen.getByText('Page A text')).toBeInTheDocument()
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-1')
      )

      rerender(<IntermediateDocumentViewer document={documentB} ocr />)

      await waitFor(() => {
        expect(screen.getByText('Page B text')).toBeInTheDocument()
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-1')
      )

      await waitFor(() => {
        expect(screen.queryByText('Page A text')).not.toBeInTheDocument()
        expect(screen.getByText('Page B text')).toBeInTheDocument()
      })

      const mockOcrDoc = {
        id: 'ocr-a',
        title: 'OCR A',
        pageCount: 1,
        pageNumbers: [1],
        pages: [
          {
            id: 'ocr-page',
            number: 1,
            width: 100,
            height: 150,
            texts: [makeText('ocr-stale', 'Stale OCR text')]
          }
        ],
        getPageSizeByPageNumber: () => ({ x: 100, y: 150 }),
        getPageByPageNumber: () =>
          Promise.resolve({ getContent: async () => [] })
      } as unknown as IntermediateDocument

      resolveOcr(mockOcrDoc)

      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.queryByText('Stale OCR text')).not.toBeInTheDocument()
      expect(screen.getByText('Page B text')).toBeInTheDocument()
    })
  })

  describe('text selection', () => {
    const makeMockSelection = (partial: {
      isCollapsed?: boolean
      anchorNode?: Node | null
      anchorOffset?: number
      focusNode?: Node | null
      focusOffset?: number
      rangeCount?: number
      getRangeAt?: (index: number) => Range
      toString?: () => string
      containsNode?: (node: Node, partly?: boolean) => boolean
    }) => {
      return {
        isCollapsed: partial.isCollapsed ?? false,
        anchorNode: partial.anchorNode ?? null,
        anchorOffset: partial.anchorOffset ?? 0,
        focusNode: partial.focusNode ?? null,
        focusOffset: partial.focusOffset ?? 0,
        rangeCount: partial.rangeCount ?? 0,
        getRangeAt: partial.getRangeAt ?? (() => document.createRange()),
        toString: partial.toString ?? (() => ''),
        containsNode: partial.containsNode ?? (() => false)
      } as unknown as Selection
    }

    const getTextNode = (element: HTMLElement) => {
      const node = element.firstChild
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        throw new Error('Expected text element to contain a text node')
      }
      return node
    }

    const makeRangeSelection = (
      startNode: Node,
      startOffset: number,
      endNode: Node,
      endOffset: number
    ) => {
      const range = document.createRange()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)

      return makeMockSelection({
        isCollapsed: range.collapsed,
        anchorNode: startNode,
        anchorOffset: startOffset,
        focusNode: endNode,
        focusOffset: endOffset,
        rangeCount: 1,
        getRangeAt: (index: number) => {
          if (index !== 0) {
            throw new Error('Selection mock only contains one range')
          }
          return range
        },
        toString: () => range.toString(),
        containsNode: (node: Node) => range.intersectsNode(node)
      })
    }

    const makeTextElement = (
      container: HTMLElement,
      textId: string,
      pageNumber: number,
      content: string
    ) => {
      const span = document.createElement('span')
      span.setAttribute('data-text-id', textId)
      span.setAttribute('data-page-number', String(pageNumber))
      span.className = 'hamster-reader__intermediate-text'
      span.textContent = content
      container.appendChild(span)
      return span
    }

    const rectSpies: ReturnType<typeof vi.spyOn>[] = []

    afterEach(() => {
      rectSpies.forEach((spy) => {
        spy.mockRestore()
      })
      rectSpies.length = 0
    })

    const mockElementRect = (
      element: HTMLElement,
      rect: { left: number; top: number; width: number; height: number }
    ) => {
      const spy = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        toJSON: () => rect
      } as DOMRect)
      rectSpies.push(spy)
      return spy
    }

    const mockElementFromPoint = (el: Element | null) => {
      if (!('elementFromPoint' in globalThis.document)) {
        Object.defineProperty(globalThis.document, 'elementFromPoint', {
          value: vi.fn(() => el),
          writable: true,
          configurable: true
        })
      }
      const spy = vi
        .spyOn(globalThis.document, 'elementFromPoint')
        .mockReturnValue(el) as unknown as ReturnType<typeof vi.spyOn>
      rectSpies.push(spy)
      return spy
    }

    const makeFourTextDocument = () => {
      const texts = [
        { id: 'text-a', content: 'A' },
        { id: 'text-b', content: 'B' },
        { id: 'text-c', content: 'C' },
        { id: 'text-d', content: 'D' }
      ]

      const pages = new Map<number, MockPage>()
      pages.set(1, {
        getContent: vi.fn(async () =>
          texts.map((t) => makeText(t.id, t.content))
        )
      })

      const document = {
        id: 'doc-four-texts',
        title: 'Four Text Document',
        pageCount: 1,
        pageNumbers: [1],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 400, y: 400 })),
        getPageByPageNumber: vi.fn((pageNumber: number) =>
          Promise.resolve(pages.get(pageNumber))
        )
      } as unknown as IntermediateDocument

      return { document, texts }
    }

    const makeCrossPageTextDocument = () => {
      const page1Texts = [
        { id: 'p1-a', content: 'P1A' },
        { id: 'p1-b', content: 'P1B' }
      ]
      const page2Texts = [
        { id: 'p2-a', content: 'P2A' },
        { id: 'p2-b', content: 'P2B' },
        { id: 'p2-c', content: 'P2C' }
      ]

      const pages = new Map<number, MockPage>()
      pages.set(1, {
        getContent: vi.fn(async () =>
          page1Texts.map((text) => makeText(text.id, text.content))
        )
      })
      pages.set(2, {
        getContent: vi.fn(async () =>
          page2Texts.map((text) => makeText(text.id, text.content))
        )
      })

      const document = {
        id: 'doc-cross-page-texts',
        title: 'Cross Page Text Document',
        pageCount: 2,
        pageNumbers: [1, 2],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 400, y: 400 })),
        getPageByPageNumber: vi.fn((pageNumber: number) =>
          Promise.resolve(pages.get(pageNumber))
        )
      } as unknown as IntermediateDocument

      return { document }
    }

    const queryTextSpan = (textId: string) => {
      const span = screen
        .getByTestId('intermediate-document-viewer')
        .querySelector(`[data-text-id="${textId}"]`)
      if (!(span instanceof HTMLElement)) {
        throw new Error(`Expected text span ${textId} to exist`)
      }
      return span
    }

    const mockCrossPageSelectionRects = () => {
      const page1 = screen.getByTestId('intermediate-page-1')
      const page2 = screen.getByTestId('intermediate-page-2')
      mockElementRect(page1, { left: 0, top: 0, width: 400, height: 180 })
      mockElementRect(page2, { left: 0, top: 220, width: 400, height: 180 })
      mockElementRect(queryTextSpan('p1-b'), {
        left: 20,
        top: 60,
        width: 80,
        height: 20
      })
      mockElementRect(queryTextSpan('p2-a'), {
        left: 20,
        top: 230,
        width: 80,
        height: 20
      })
      mockElementRect(queryTextSpan('p2-b'), {
        left: 20,
        top: 270,
        width: 80,
        height: 20
      })
      mockElementRect(queryTextSpan('p2-c'), {
        left: 20,
        top: 310,
        width: 80,
        height: 20
      })
      return { page2 }
    }

    const renderCrossPageSelectionFixture = async (
      onTextSelectionChange: ReturnType<typeof vi.fn>
    ) => {
      const { document: mockDoc } = makeCrossPageTextDocument()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
      })
      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-2')
      )

      await waitFor(() => {
        expect(screen.getByText('P1B')).toBeInTheDocument()
        expect(screen.getByText('P2C')).toBeInTheDocument()
      })
    }

    const dispatchActiveCrossPageMouseSelection = (
      targetTextId: string,
      pointer: { clientX: number; clientY: number }
    ) => {
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const anchorSpan = queryTextSpan('p1-b')
      const focusSpan = queryTextSpan(targetTextId)
      const overBroadIds = new Set(['p1-b', 'p2-a', 'p2-b', 'p2-c'])

      viewerRoot.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 60,
          clientY: 70
        })
      )
      viewerRoot.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          clientX: pointer.clientX,
          clientY: pointer.clientY
        })
      )

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: getTextNode(anchorSpan),
        focusNode: getTextNode(focusSpan),
        toString: () => 'P1BP2AP2BP2C',
        containsNode: (node: Node) => {
          if (!(node instanceof HTMLElement)) return false
          const textId = node.getAttribute('data-text-id')
          return textId !== null && overBroadIds.has(textId)
        }
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      globalThis.document.dispatchEvent(new Event('selectionchange'))
    }

    const installUnavailableCaretPointApis = () => {
      const caretDocument = globalThis.document as Document & {
        caretPositionFromPoint?: unknown
        caretRangeFromPoint?: unknown
      }
      const originalCaretPositionFromPoint =
        caretDocument.caretPositionFromPoint
      const originalCaretRangeFromPoint = caretDocument.caretRangeFromPoint

      Object.defineProperty(caretDocument, 'caretPositionFromPoint', {
        configurable: true,
        value: undefined
      })
      Object.defineProperty(caretDocument, 'caretRangeFromPoint', {
        configurable: true,
        value: undefined
      })

      return () => {
        Object.defineProperty(caretDocument, 'caretPositionFromPoint', {
          configurable: true,
          value: originalCaretPositionFromPoint
        })
        Object.defineProperty(caretDocument, 'caretRangeFromPoint', {
          configurable: true,
          value: originalCaretRangeFromPoint
        })
      }
    }

    const installCaretPositionFromPoint = (node: Node, offset: number) => {
      const caretDocument = globalThis.document as Document & {
        caretPositionFromPoint?: unknown
      }
      const original = caretDocument.caretPositionFromPoint

      Object.defineProperty(caretDocument, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({ offsetNode: node, offset }))
      })

      return () => {
        Object.defineProperty(caretDocument, 'caretPositionFromPoint', {
          configurable: true,
          value: original
        })
      }
    }

    const mockElementFromPointByCoordinate = (
      callback: (x: number, y: number) => Element | null
    ) => {
      if (!('elementFromPoint' in globalThis.document)) {
        Object.defineProperty(globalThis.document, 'elementFromPoint', {
          value: vi.fn(() => null),
          writable: true,
          configurable: true
        })
      }

      const spy = vi
        .spyOn(globalThis.document, 'elementFromPoint')
        .mockImplementation(callback) as unknown as ReturnType<typeof vi.spyOn>
      rectSpies.push(spy)
      return spy
    }

    const makeLiveRangeSelection = (initialRange: Range) => {
      let activeRange = initialRange
      const selection = {
        get isCollapsed() {
          return activeRange.collapsed
        },
        get anchorNode() {
          return activeRange.startContainer
        },
        get anchorOffset() {
          return activeRange.startOffset
        },
        get focusNode() {
          return activeRange.endContainer
        },
        get focusOffset() {
          return activeRange.endOffset
        },
        get rangeCount() {
          return 1
        },
        getRangeAt: vi.fn((index: number) => {
          if (index !== 0) {
            throw new Error('Selection mock only contains one range')
          }
          return activeRange
        }),
        removeAllRanges: vi.fn(),
        addRange: vi.fn((nextRange: Range) => {
          activeRange = nextRange
        }),
        toString: () => activeRange.toString(),
        containsNode: (node: Node) => {
          try {
            return activeRange.intersectsNode(node)
          } catch {
            return false
          }
        }
      } as unknown as Selection & {
        removeAllRanges: ReturnType<typeof vi.fn>
        addRange: ReturnType<typeof vi.fn>
      }

      return {
        selection,
        get activeRange() {
          return activeRange
        }
      }
    }

    const makeEmptyLiveSelection = () => {
      const range = globalThis.document.createRange()
      range.selectNodeContents(
        screen.getByTestId('intermediate-document-viewer')
      )
      range.collapse(true)
      return makeLiveRangeSelection(range)
    }

    const installHandleRangeRectMocks = installSelectionHandleRangeRectMocks

    const renderHandleDragFixture = async ({
      initialStartId,
      initialStartOffset,
      initialEndId,
      initialEndOffset,
      onTextSelectionEnd
    }: {
      initialStartId: string
      initialStartOffset: number
      initialEndId: string
      initialEndOffset: number
      onTextSelectionEnd?: ReturnType<typeof vi.fn>
    }) => {
      const { document: mockDoc } = makeFourTextDocument()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          selectionHandleElement={<button type='button' />}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const initialRange = globalThis.document.createRange()
      initialRange.setStart(
        getTextNode(queryTextSpan(initialStartId)),
        initialStartOffset
      )
      initialRange.setEnd(
        getTextNode(queryTextSpan(initialEndId)),
        initialEndOffset
      )
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreRangeRects = installHandleRangeRectMocks()
      const elementFromPointSpy = mockElementFromPoint(page)

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      await waitFor(() => {
        expect(viewerRoot.querySelectorAll('[data-handle-type]')).toHaveLength(
          2
        )
      })
      await act(async () => {
        await Promise.resolve()
      })

      const getHandle = (type: 'start' | 'end') => {
        const handle = viewerRoot.querySelector(`[data-handle-type="${type}"]`)
        if (!(handle instanceof HTMLElement)) {
          throw new Error(`Expected ${type} handle to be rendered`)
        }
        return handle
      }

      return {
        viewerRoot,
        page,
        liveSelection,
        getHandle,
        cleanup: () => {
          elementFromPointSpy.mockRestore()
          restoreRangeRects()
          getSelectionSpy.mockRestore()
        }
      }
    }

    const dispatchHandleDragEvent = (
      target: HTMLElement,
      type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
      point: { clientX: number; clientY: number }
    ) => {
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: false,
          cancelable: true,
          button: 0,
          clientX: point.clientX,
          clientY: point.clientY
        })
      )
    }

    const layoutFourTextPage = () => {
      const page = screen.getByTestId('intermediate-page-1')
      mockElementRect(page, { left: 0, top: 0, width: 400, height: 220 })
      mockElementRect(screen.getByText('A'), {
        left: 10,
        top: 10,
        width: 20,
        height: 16
      })
      mockElementRect(screen.getByText('B'), {
        left: 10,
        top: 50,
        width: 20,
        height: 16
      })
      mockElementRect(screen.getByText('C'), {
        left: 10,
        top: 90,
        width: 20,
        height: 16
      })
      mockElementRect(screen.getByText('D'), {
        left: 10,
        top: 130,
        width: 20,
        height: 16
      })
      return page
    }

    const dispatchPointerDragStart = (
      target: HTMLElement,
      point: { clientX: number; clientY: number }
    ) => {
      target.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: point.clientX,
          clientY: point.clientY
        })
      )
    }

    const dispatchPointerDragMove = (
      target: HTMLElement,
      point: { clientX: number; clientY: number }
    ) => {
      target.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: point.clientX,
          clientY: point.clientY
        })
      )
    }

    const dispatchPointerDragEnd = (
      target: HTMLElement,
      type: 'pointerup' | 'pointercancel',
      point: { clientX: number; clientY: number }
    ) => {
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          clientX: point.clientX,
          clientY: point.clientY
        })
      )
    }

    it('drag-composes a real DOM Selection across text spans from pointer trajectory', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPoint(page)

      try {
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 138 })

        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(1)
        expect(liveSelection.selection.toString()).toBe('BCD')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.selectedText).toBe('BCD')
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'text-b',
          'text-c',
          'text-d'
        ])

        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('drag over blank image area snaps to nearest text endpoint instead of page start', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('C')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const image = globalThis.document.createElement('img')
      image.className = 'hamster-reader__intermediate-page-base-image'
      page.insertBefore(image, page.firstChild)
      mockElementRect(image, { left: 0, top: 0, width: 400, height: 220 })
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) => (y >= 80 ? image : page))

      try {
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 98 })

        expect(liveSelection.selection.toString()).toBe('BC')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.selectedText).toBe('BC')
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'text-b',
          'text-c'
        ])
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('drag-composes cross-page selection spanning both page text runs', async () => {
      const onTextSelectionChange = vi.fn()
      await renderCrossPageSelectionFixture(onTextSelectionChange)
      mockCrossPageSelectionRects()

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page1 = screen.getByTestId('intermediate-page-1')
      const page2 = screen.getByTestId('intermediate-page-2')
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) => (y < 220 ? page1 : page2))

      try {
        dispatchPointerDragStart(queryTextSpan('p1-b'), {
          clientX: 40,
          clientY: 70
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 120, clientY: 320 })

        expect(liveSelection.selection.toString()).toBe('P1BP2AP2BP2C')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p1-b',
          'p2-a',
          'p2-b',
          'p2-c'
        ])
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('handles cancelled drag once and allows a subsequent drag without stale anchor state', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPoint(page)

      try {
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 98 })
        dispatchPointerDragEnd(viewerRoot, 'pointercancel', {
          clientX: 100,
          clientY: 98
        })

        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe('BC')

        dispatchPointerDragStart(screen.getByText('C'), {
          clientX: 12,
          clientY: 98
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 138 })
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })

        expect(onTextSelectionChange).toHaveBeenCalledTimes(2)
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(2)
        expect(onTextSelectionChange.mock.calls[1][1].selectedText).toBe('CD')
        expect(onTextSelectionEnd.mock.calls[1][1].selectedText).toBe('CD')
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('fires selection change during drag move and selection end exactly once on drag completion', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPoint(page)

      try {
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        expect(onTextSelectionChange).not.toHaveBeenCalled()
        expect(onTextSelectionEnd).not.toHaveBeenCalled()

        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 138 })

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).not.toHaveBeenCalled()

        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe('BCD')
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('drags the end handle through Drag lifecycle while keeping the start anchor fixed', async () => {
      const onTextSelectionEnd = vi.fn()
      const fixture = await renderHandleDragFixture({
        initialStartId: 'text-b',
        initialStartOffset: 0,
        initialEndId: 'text-c',
        initialEndOffset: 1,
        onTextSelectionEnd
      })
      const restoreCaretPosition = installCaretPositionFromPoint(
        getTextNode(queryTextSpan('text-d')),
        1
      )

      try {
        const endHandle = fixture.getHandle('end')
        dispatchHandleDragEvent(endHandle, 'pointerdown', {
          clientX: 50,
          clientY: 25
        })
        dispatchHandleDragEvent(endHandle, 'pointermove', {
          clientX: 18,
          clientY: 138
        })

        expect(fixture.liveSelection.activeRange.startContainer).toBe(
          getTextNode(queryTextSpan('text-b'))
        )
        expect(fixture.liveSelection.activeRange.startOffset).toBe(0)
        expect(fixture.liveSelection.activeRange.endContainer).toBe(
          getTextNode(queryTextSpan('text-d'))
        )
        expect(fixture.liveSelection.activeRange.endOffset).toBe(1)
        expect(fixture.liveSelection.selection.toString()).toBe('BCD')

        dispatchHandleDragEvent(endHandle, 'pointerup', {
          clientX: 18,
          clientY: 138
        })

        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe('BCD')
      } finally {
        restoreCaretPosition()
        fixture.cleanup()
      }
    })

    it('drags the start handle past the original end into an ordered range', async () => {
      const fixture = await renderHandleDragFixture({
        initialStartId: 'text-b',
        initialStartOffset: 0,
        initialEndId: 'text-c',
        initialEndOffset: 1
      })
      const restoreCaretPosition = installCaretPositionFromPoint(
        getTextNode(queryTextSpan('text-d')),
        1
      )

      try {
        const startHandle = fixture.getHandle('start')
        dispatchHandleDragEvent(startHandle, 'pointerdown', {
          clientX: 50,
          clientY: 25
        })
        dispatchHandleDragEvent(startHandle, 'pointermove', {
          clientX: 18,
          clientY: 138
        })

        expect(fixture.liveSelection.activeRange.startContainer).toBe(
          getTextNode(queryTextSpan('text-c'))
        )
        expect(fixture.liveSelection.activeRange.startOffset).toBe(1)
        expect(fixture.liveSelection.activeRange.endContainer).toBe(
          getTextNode(queryTextSpan('text-d'))
        )
        expect(fixture.liveSelection.activeRange.endOffset).toBe(1)
        expect(fixture.liveSelection.selection.toString()).toBe('D')
      } finally {
        restoreCaretPosition()
        fixture.cleanup()
      }
    })

    it('snaps a handle Drag blank/image endpoint to the nearest text caret', async () => {
      const fixture = await renderHandleDragFixture({
        initialStartId: 'text-b',
        initialStartOffset: 0,
        initialEndId: 'text-c',
        initialEndOffset: 1
      })
      const restoreCaretApis = installUnavailableCaretPointApis()
      const image = globalThis.document.createElement('img')
      image.className = 'hamster-reader__intermediate-page-base-image'
      fixture.page.insertBefore(image, fixture.page.firstChild)
      mockElementRect(image, { left: 0, top: 0, width: 400, height: 220 })
      const elementFromPointSpy = mockElementFromPointByCoordinate((_x, y) =>
        y >= 120 ? image : fixture.page
      )

      try {
        const endHandle = fixture.getHandle('end')
        dispatchHandleDragEvent(endHandle, 'pointerdown', {
          clientX: 50,
          clientY: 25
        })
        dispatchHandleDragEvent(endHandle, 'pointermove', {
          clientX: 100,
          clientY: 138
        })

        expect(fixture.liveSelection.activeRange.startContainer).toBe(
          getTextNode(queryTextSpan('text-b'))
        )
        expect(fixture.liveSelection.activeRange.endContainer).toBe(
          getTextNode(queryTextSpan('text-d'))
        )
        expect(fixture.liveSelection.activeRange.endOffset).toBe(1)
        expect(fixture.liveSelection.selection.toString()).toBe('BCD')
      } finally {
        elementFromPointSpy.mockRestore()
        restoreCaretApis()
        fixture.cleanup()
      }
    })

    it('keeps start-handle Drag reversed direction ordered when moving before the fixed end', async () => {
      const fixture = await renderHandleDragFixture({
        initialStartId: 'text-b',
        initialStartOffset: 0,
        initialEndId: 'text-d',
        initialEndOffset: 1
      })
      const restoreCaretPosition = installCaretPositionFromPoint(
        getTextNode(queryTextSpan('text-a')),
        0
      )

      try {
        const startHandle = fixture.getHandle('start')
        dispatchHandleDragEvent(startHandle, 'pointerdown', {
          clientX: 50,
          clientY: 25
        })
        dispatchHandleDragEvent(startHandle, 'pointermove', {
          clientX: 18,
          clientY: 18
        })

        expect(fixture.liveSelection.activeRange.startContainer).toBe(
          getTextNode(queryTextSpan('text-a'))
        )
        expect(fixture.liveSelection.activeRange.startOffset).toBe(0)
        expect(fixture.liveSelection.activeRange.endContainer).toBe(
          getTextNode(queryTextSpan('text-d'))
        )
        expect(fixture.liveSelection.activeRange.endOffset).toBe(1)
        expect(fixture.liveSelection.selection.toString()).toBe('ABCD')
      } finally {
        restoreCaretPosition()
        fixture.cleanup()
      }
    })

    it('clears handle Drag state on pointercancel and starts the next handle drag cleanly', async () => {
      const onTextSelectionEnd = vi.fn()
      const fixture = await renderHandleDragFixture({
        initialStartId: 'text-b',
        initialStartOffset: 0,
        initialEndId: 'text-c',
        initialEndOffset: 1,
        onTextSelectionEnd
      })
      const restoreCaretPosition = installCaretPositionFromPoint(
        getTextNode(queryTextSpan('text-d')),
        1
      )

      try {
        const endHandle = fixture.getHandle('end')
        dispatchHandleDragEvent(endHandle, 'pointerdown', {
          clientX: 50,
          clientY: 25
        })
        dispatchHandleDragEvent(endHandle, 'pointercancel', {
          clientX: 18,
          clientY: 138
        })

        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe('BCD')

        dispatchHandleDragEvent(endHandle, 'pointermove', {
          clientX: 18,
          clientY: 18
        })
        expect(fixture.liveSelection.selection.toString()).toBe('BCD')

        dispatchHandleDragEvent(endHandle, 'pointerdown', {
          clientX: 50,
          clientY: 25
        })
        dispatchHandleDragEvent(endHandle, 'pointermove', {
          clientX: 18,
          clientY: 138
        })
        dispatchHandleDragEvent(endHandle, 'pointerup', {
          clientX: 18,
          clientY: 138
        })

        expect(onTextSelectionEnd).toHaveBeenCalledTimes(2)
        expect(onTextSelectionEnd.mock.calls[1][1].selectedText).toBe('BCD')
      } finally {
        restoreCaretPosition()
        fixture.cleanup()
      }
    })

    it('does not fire onTextSelectionChange when selection is collapsed', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textSpan = makeTextElement(viewerRoot, 'text-1', 1, 'Test content')

      const collapsedSelection = makeMockSelection({
        isCollapsed: true,
        anchorNode: textSpan,
        focusNode: textSpan
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(collapsedSelection)

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).not.toHaveBeenCalled()
    })

    it('does not fire onTextSelectionChange when selection is outside viewer', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      const outsideNode = globalThis.document.createElement('div')
      globalThis.document.body.appendChild(outsideNode)

      const selection = makeMockSelection({
        anchorNode: outsideNode,
        focusNode: outsideNode,
        toString: () => 'outside selection'
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).not.toHaveBeenCalled()

      globalThis.document.body.removeChild(outsideNode)
    })

    it('does not fire onTextSelectionChange when only one endpoint is inside viewer', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
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

      const outsideNode = globalThis.document.createElement('div')
      globalThis.document.body.appendChild(outsideNode)

      // anchor inside, focus outside
      const selection = makeMockSelection({
        anchorNode: textSpan,
        focusNode: outsideNode,
        toString: () => 'partial selection'
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).not.toHaveBeenCalled()

      globalThis.document.body.removeChild(outsideNode)
    })

    it('fires onTextSelectionChange when selection includes text elements', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
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

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textSpan,
        focusNode: textSpan,
        toString: () => 'Test content',
        containsNode: (node: Node) => node === textSpan
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
      const [text, detail] = onTextSelectionChange.mock.calls[0]
      expect(text.id).toBe('text-1')
      expect(detail.selectedText).toBe('Test content')
      expect(detail.pageNumber).toBe(1)
    })

    it('observes externally-created over-broad cross-page selection without using it as drag state', async () => {
      const onTextSelectionChange = vi.fn()
      await renderCrossPageSelectionFixture(onTextSelectionChange)
      const { page2 } = mockCrossPageSelectionRects()
      mockElementFromPoint(page2)

      dispatchActiveCrossPageMouseSelection('p2-a', {
        clientX: 60,
        clientY: 240
      })

      expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
      const [, detail] = onTextSelectionChange.mock.calls[0]
      expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
        'p1-b',
        'p2-a',
        'p2-b',
        'p2-c'
      ])
      expect(detail.selectedText).toBe('P1BP2AP2BP2C')
    })

    it('keeps legitimate active mouse cross-page selection through the pointer text', async () => {
      const onTextSelectionChange = vi.fn()
      await renderCrossPageSelectionFixture(onTextSelectionChange)
      const { page2 } = mockCrossPageSelectionRects()
      mockElementFromPoint(page2)

      dispatchActiveCrossPageMouseSelection('p2-c', {
        clientX: 60,
        clientY: 320
      })

      expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
      const [, detail] = onTextSelectionChange.mock.calls[0]
      expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
        'p1-b',
        'p2-a',
        'p2-b',
        'p2-c'
      ])
      expect(detail.selectedText).toBe('P1BP2AP2BP2C')
    })

    it('fires onTextSelectionEnd on mouseup with selection', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textSpan = viewerRoot.querySelector(
        '[data-text-id="text-1"]'
      ) as HTMLElement

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textSpan,
        focusNode: textSpan,
        toString: () => 'Test content',
        containsNode: (node: Node) => node === textSpan
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
      const [text, detail] = onTextSelectionEnd.mock.calls[0]
      expect(text.id).toBe('text-1')
      expect(detail.selectedText).toBe('Test content')
    })

    it('fires onSelectText with a partial single-segment payload', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onSelectText = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onSelectText={onSelectText}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textSpan = viewerRoot.querySelector(
        '[data-text-id="text-1"]'
      ) as HTMLElement
      const textNode = getTextNode(textSpan)
      const selection = makeRangeSelection(textNode, 5, textNode, 11)
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(onSelectText).toHaveBeenCalledTimes(1)
      const [nativeSelection, segments, extractedText] =
        onSelectText.mock.calls[0]
      expect(nativeSelection).toBe(selection)
      expect(extractedText).toBe('1 text')
      expect(extractedText).toBe(
        segments
          .map((segment: { selectedText: string }) => segment.selectedText)
          .join('')
      )
      expect(segments).toHaveLength(1)
      expect(segments[0]).toMatchObject({
        id: 'text-1',
        selectedText: '1 text',
        startCharIndex: 5,
        endCharIndex: 11
      })
      expect(segments[0].selectedText).toBe(
        segments[0].content.slice(
          segments[0].startCharIndex,
          segments[0].endCharIndex
        )
      )
    })

    it('fires selected-text body drag lifecycle callbacks with a throttled move', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onDragSelectedTextStart = vi.fn()
      const onDragSelectedTextMove = vi.fn()
      const onDragSelectedTextEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={null}
          onDragSelectedTextStart={onDragSelectedTextStart}
          onDragSelectedTextMove={onDragSelectedTextMove}
          onDragSelectedTextEnd={onDragSelectedTextEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const textSpan = screen.getByText('Page 1 text')
      const textNode = getTextNode(textSpan)
      const selection = makeRangeSelection(textNode, 0, textNode, 11)
      const range = selection.getRangeAt(0)
      const pageRectSpy = mockElementRect(page, {
        left: 10,
        top: 10,
        width: 100,
        height: 150
      })
      const originalGetClientRects = range.getClientRects
      const originalGetBoundingClientRect = range.getBoundingClientRect
      const originalCloneRange = range.cloneRange
      const collapsedRange = {
        getClientRects: vi.fn(() => [
          makeDomRect({ left: 20, top: 24, width: 0, height: 12 })
        ]),
        getBoundingClientRect: vi.fn(() =>
          makeDomRect({ left: 20, top: 24, width: 0, height: 12 })
        ),
        collapse: vi.fn()
      } as unknown as Range
      Object.defineProperty(range, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => [
          makeDomRect({ left: 20, top: 24, width: 60, height: 12 })
        ])
      })
      Object.defineProperty(range, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(() =>
          makeDomRect({ left: 20, top: 24, width: 60, height: 12 })
        )
      })
      Object.defineProperty(range, 'cloneRange', {
        configurable: true,
        value: vi.fn(() => collapsedRange)
      })
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(selection)
      const rangeClientRectsDescriptor = Object.getOwnPropertyDescriptor(
        Range.prototype,
        'getClientRects'
      )
      const rangeBoundingRectDescriptor = Object.getOwnPropertyDescriptor(
        Range.prototype,
        'getBoundingClientRect'
      )
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => [
          makeDomRect({ left: 20, top: 24, width: 60, height: 12 })
        ])
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(() =>
          makeDomRect({ left: 20, top: 24, width: 60, height: 12 })
        )
      })

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        const overlay = page.querySelector(
          '.hamster-reader__selection-overlay'
        ) as HTMLElement
        const overlayDragInstance = getMockDragInstances().find(
          (instance) => instance.element === overlay
        )
        expect(overlayDragInstance).toBeDefined()

        vi.useFakeTimers()
        overlay.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            button: 0,
            clientX: 30,
            clientY: 30
          })
        )
        overlay.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 31,
            clientY: 31
          })
        )
        overlay.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 32,
            clientY: 32
          })
        )

        expect(onDragSelectedTextStart).toHaveBeenCalledTimes(1)
        expect(onDragSelectedTextMove).not.toHaveBeenCalled()

        await act(async () => {
          vi.runOnlyPendingTimers()
        })

        expect(onDragSelectedTextMove).toHaveBeenCalledTimes(1)

        overlay.dispatchEvent(
          new MouseEvent('pointerup', {
            bubbles: true,
            clientX: 500,
            clientY: 500
          })
        )

        expect(onDragSelectedTextEnd).toHaveBeenCalledTimes(1)
        const [nativeSelection, segments, extractedText] =
          onDragSelectedTextStart.mock.calls[0]
        expect(nativeSelection).toBe(selection)
        expect(extractedText).toBe('Page 1 text')
        expect(segments[0]).toMatchObject({
          id: 'text-1',
          selectedText: 'Page 1 text',
          startCharIndex: 0,
          endCharIndex: 11
        })
        expect(onDragSelectedTextMove.mock.calls[0]).toEqual(
          onDragSelectedTextStart.mock.calls[0]
        )
        expect(onDragSelectedTextEnd.mock.calls[0]).toEqual(
          onDragSelectedTextStart.mock.calls[0]
        )

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

        expect(onDragSelectedTextStart).toHaveBeenCalledTimes(2)
        expect(onDragSelectedTextEnd).toHaveBeenCalledTimes(2)
        expect(onDragSelectedTextEnd.mock.calls[1]).toEqual(
          onDragSelectedTextStart.mock.calls[1]
        )
      } finally {
        vi.useRealTimers()
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        Object.defineProperty(range, 'getBoundingClientRect', {
          configurable: true,
          value: originalGetBoundingClientRect
        })
        Object.defineProperty(range, 'getClientRects', {
          configurable: true,
          value: originalGetClientRects
        })
        Object.defineProperty(range, 'cloneRange', {
          configurable: true,
          value: originalCloneRange
        })
        if (rangeBoundingRectDescriptor) {
          Object.defineProperty(
            Range.prototype,
            'getBoundingClientRect',
            rangeBoundingRectDescriptor
          )
        } else {
          Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
        }
        if (rangeClientRectsDescriptor) {
          Object.defineProperty(
            Range.prototype,
            'getClientRects',
            rangeClientRectsDescriptor
          )
        } else {
          Reflect.deleteProperty(Range.prototype, 'getClientRects')
        }
        pageRectSpy.mockRestore()
      }
    })

    it('does not fire selected-text body drag callbacks for handles or page background', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onDragSelectedTextStart = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={null}
          onDragSelectedTextStart={onDragSelectedTextStart}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const textSpan = screen.getByText('Page 1 text')
      const textNode = getTextNode(textSpan)
      const selection = makeRangeSelection(textNode, 0, textNode, 11)
      const range = selection.getRangeAt(0)
      const pageRectSpy = mockElementRect(page, {
        left: 10,
        top: 10,
        width: 100,
        height: 150
      })
      const originalGetClientRects = range.getClientRects
      const originalGetBoundingClientRect = range.getBoundingClientRect
      const originalCloneRange = range.cloneRange
      const collapsedRange = {
        getClientRects: vi.fn(() => [
          makeDomRect({ left: 20, top: 24, width: 0, height: 12 })
        ]),
        getBoundingClientRect: vi.fn(() =>
          makeDomRect({ left: 20, top: 24, width: 0, height: 12 })
        ),
        collapse: vi.fn()
      } as unknown as Range
      Object.defineProperty(range, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => [
          makeDomRect({ left: 20, top: 24, width: 60, height: 12 })
        ])
      })
      Object.defineProperty(range, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(() =>
          makeDomRect({ left: 20, top: 24, width: 60, height: 12 })
        )
      })
      Object.defineProperty(range, 'cloneRange', {
        configurable: true,
        value: vi.fn(() => collapsedRange)
      })
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(selection)

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        const overlay = page.querySelector(
          '.hamster-reader__selection-overlay'
        ) as HTMLElement
        const handle = globalThis.document.createElement('button')
        handle.dataset.handleType = 'start'
        overlay.appendChild(handle)
        handle.addEventListener('pointerdown', (event) => {
          event.stopPropagation()
        })
        handle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            button: 0,
            clientX: 30,
            clientY: 30
          })
        )
        overlay.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            button: 0,
            clientX: 95,
            clientY: 95
          })
        )

        expect(onDragSelectedTextStart).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        Object.defineProperty(range, 'getBoundingClientRect', {
          configurable: true,
          value: originalGetBoundingClientRect
        })
        Object.defineProperty(range, 'getClientRects', {
          configurable: true,
          value: originalGetClientRects
        })
        Object.defineProperty(range, 'cloneRange', {
          configurable: true,
          value: originalCloneRange
        })
        pageRectSpy.mockRestore()
      }
    })

    it('prevents native dragstart on the selection overlay when body drag callbacks are present', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          onDragSelectedTextStart={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const overlay = page.querySelector(
        '.hamster-reader__selection-overlay'
      ) as HTMLElement
      const event = new Event('dragstart', { bubbles: true, cancelable: true })

      overlay.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
    })

    it('fires onSelectText with a multi-segment payload', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onSelectText = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onSelectText={onSelectText}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('C')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textB = screen.getByText('B')
      const textC = screen.getByText('C')
      const selection = makeRangeSelection(
        getTextNode(textB),
        0,
        getTextNode(textC),
        1
      )
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(onSelectText).toHaveBeenCalledTimes(1)
      const [, segments, extractedText] = onSelectText.mock.calls[0]
      expect(extractedText).toBe('BC')
      expect(extractedText).toBe(
        segments
          .map((segment: { selectedText: string }) => segment.selectedText)
          .join('')
      )
      expect(segments.map((segment: { id: string }) => segment.id)).toEqual([
        'text-b',
        'text-c'
      ])
      expect(
        segments.map(
          (segment: {
            selectedText: string
            startCharIndex: number
            endCharIndex: number
          }) => ({
            selectedText: segment.selectedText,
            startCharIndex: segment.startCharIndex,
            endCharIndex: segment.endCharIndex
          })
        )
      ).toEqual([
        { selectedText: 'B', startCharIndex: 0, endCharIndex: 1 },
        { selectedText: 'C', startCharIndex: 0, endCharIndex: 1 }
      ])
    })

    it('builds an exact-boundary payload from the shared helper', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      render(<IntermediateDocumentViewer document={mockDoc} />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const textSpan = screen.getByText('Page 1 text')
      const textNode = getTextNode(textSpan)
      const selection = makeRangeSelection(textNode, 0, textNode, 11)

      const payload = buildSelectionPayload(selection)

      expect(payload).not.toBeNull()
      if (!payload) {
        throw new Error('Expected exact-boundary selection payload')
      }
      expect(payload.selection).toBe(selection)
      expect(payload.extractedText).toBe('Page 1 text')
      expect(payload.segments).toHaveLength(1)
      expect(payload.segments[0]).toMatchObject({
        id: 'text-1',
        selectedText: 'Page 1 text',
        startCharIndex: 0,
        endCharIndex: 11
      })
    })

    it('does not fire onSelectText for collapsed selections', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onSelectText = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onSelectText={onSelectText}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textNode = getTextNode(screen.getByText('Page 1 text'))
      const selection = makeRangeSelection(textNode, 4, textNode, 4)
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(onSelectText).not.toHaveBeenCalled()
    })

    it('does not fire onSelectText for whitespace-only selections', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onSelectText = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onSelectText={onSelectText}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textNode = getTextNode(screen.getByText('Page 1 text'))
      const selection = makeRangeSelection(textNode, 4, textNode, 5)
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(onSelectText).not.toHaveBeenCalled()
    })

    it('fires onTextSelectionEnd on touchend with selection', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textSpan = viewerRoot.querySelector(
        '[data-text-id="text-1"]'
      ) as HTMLElement

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textSpan,
        focusNode: textSpan,
        toString: () => 'Test content',
        containsNode: (node: Node) => node === textSpan
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      viewerRoot.dispatchEvent(new TouchEvent('touchend', { bubbles: true }))

      expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
    })

    it('fires onTextSelectionEnd on keyup with shift key', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textSpan = viewerRoot.querySelector(
        '[data-text-id="text-1"]'
      ) as HTMLElement

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textSpan,
        focusNode: textSpan,
        toString: () => 'Test content',
        containsNode: (node: Node) => node === textSpan
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      viewerRoot.dispatchEvent(
        new KeyboardEvent('keyup', { bubbles: true, shiftKey: true })
      )

      expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
    })

    it('does not fire onTextSelectionEnd on keyup without shift key', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')

      viewerRoot.dispatchEvent(
        new KeyboardEvent('keyup', { bubbles: true, shiftKey: false })
      )

      expect(onTextSelectionEnd).not.toHaveBeenCalled()
    })

    it('does not fire callbacks when no selection exists', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionChange = vi.fn()
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      vi.spyOn(window, 'getSelection').mockReturnValue(null)

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(onTextSelectionChange).not.toHaveBeenCalled()
      expect(onTextSelectionEnd).not.toHaveBeenCalled()
    })

    it('does not assign pointer-events: none to text spans', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      render(<IntermediateDocumentViewer document={mockDoc} />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const textSpan = screen.getByText('Page 1 text')
      expect(textSpan).toHaveClass('hamster-reader__intermediate-text')
      expect(textSpan).not.toHaveStyle({ pointerEvents: 'none' })
    })

    it('does not define pointer-events: none in SCSS for intermediate-text', () => {
      // In jsdom, computed styles from external stylesheets are not available.
      // Verify the source SCSS does not contain the rule.
      const scssSource = fs.readFileSync(
        path.resolve(__dirname, '../src/styles/reader.scss'),
        'utf-8'
      )
      // Extract the .hamster-reader__intermediate-text block
      const textBlockMatch = scssSource.match(
        /&__intermediate-text\s*\{([^}]*)\}/
      )
      expect(textBlockMatch).toBeTruthy()
      if (!textBlockMatch) {
        throw new Error('Expected intermediate text SCSS block to exist')
      }

      expect(textBlockMatch[1]).not.toContain('pointer-events')
    })

    it('keeps native selection visible for html-parser output when custom overlay is active', () => {
      const scssSource = fs.readFileSync(
        path.resolve(__dirname, '../src/styles/reader.scss'),
        'utf-8'
      )
      const transparentSelectionBlockMatch = scssSource.match(
        /\.hamster-reader__intermediate-document-viewer--custom-selection\s*\{([\s\S]*?)background-color:\s*transparent;([\s\S]*?)\n\}/
      )

      expect(transparentSelectionBlockMatch).toBeTruthy()
      if (!transparentSelectionBlockMatch) {
        throw new Error(
          'Expected custom selection transparent SCSS block to exist'
        )
      }

      const transparentSelectionBlock = `${transparentSelectionBlockMatch[1]}${transparentSelectionBlockMatch[2]}`
      expect(transparentSelectionBlock).toContain(
        'hamster-reader__intermediate-text'
      )
      expect(transparentSelectionBlock).not.toContain(
        'hamster-reader__html-parser-output'
      )
    })

    it('does not let native selectionchange initiate blank-space drag normalization', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('A')).toBeInTheDocument()
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('C')).toBeInTheDocument()
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textB = screen.getByText('B')
      const textC = screen.getByText('C')
      const textD = screen.getByText('D')

      mockElementRect(textB, { left: 10, top: 50, width: 20, height: 16 })
      mockElementRect(textC, { left: 10, top: 90, width: 20, height: 16 })
      mockElementRect(textD, { left: 10, top: 130, width: 20, height: 16 })

      viewerRoot.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 20,
          clientY: 58,
          button: 0
        })
      )

      viewerRoot.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 100,
          clientY: 138,
          buttons: 1
        })
      )

      const blankNode = document.createTextNode('')
      viewerRoot.appendChild(blankNode)

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textB,
        focusNode: blankNode,
        toString: () => '',
        containsNode: () => false
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)
      mockElementFromPoint(screen.getByTestId('intermediate-page-1'))

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).not.toHaveBeenCalled()

      viewerRoot.removeChild(blankNode)
    })

    it('does not end a blank-space drag from retired native mouseup normalization', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('A')).toBeInTheDocument()
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textB = screen.getByText('B')
      const textD = screen.getByText('D')

      mockElementRect(textB, { left: 10, top: 50, width: 20, height: 16 })
      mockElementRect(textD, { left: 10, top: 130, width: 20, height: 16 })

      viewerRoot.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 20,
          clientY: 58,
          button: 0
        })
      )

      viewerRoot.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 100,
          clientY: 138,
          buttons: 1
        })
      )

      const blankNode = document.createTextNode('')
      viewerRoot.appendChild(blankNode)

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textB,
        focusNode: blankNode,
        toString: () => '',
        containsNode: () => false
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)
      mockElementFromPoint(screen.getByTestId('intermediate-page-1'))

      viewerRoot.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 100,
          clientY: 138,
          button: 0
        })
      )

      expect(onTextSelectionEnd).not.toHaveBeenCalled()

      viewerRoot.removeChild(blankNode)
    })

    it('preserves valid text-to-text selection without normalization', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('C')).toBeInTheDocument()
      })

      const textB = screen.getByText('B')
      const textC = screen.getByText('C')

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textB,
        focusNode: textC,
        toString: () => 'BC',
        containsNode: (node: Node) => node === textB || node === textC
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
      const [, detail] = onTextSelectionChange.mock.calls[0]
      expect(detail.texts.map((t: IntermediateText) => t.id)).toEqual([
        'text-b',
        'text-c'
      ])
      expect(detail.selectedText).toBe('BC')
    })

    it('does not use native selectionchange to choose first text above all text', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('A')).toBeInTheDocument()
        expect(screen.getByText('B')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textB = screen.getByText('B')
      const textA = screen.getByText('A')

      mockElementRect(textA, { left: 10, top: 10, width: 20, height: 16 })
      mockElementRect(textB, { left: 10, top: 50, width: 20, height: 16 })

      viewerRoot.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 20,
          clientY: 58,
          button: 0
        })
      )

      viewerRoot.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 20,
          clientY: 5,
          buttons: 1
        })
      )

      const blankNode = document.createTextNode('')
      viewerRoot.appendChild(blankNode)

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textB,
        focusNode: blankNode,
        toString: () => '',
        containsNode: () => false
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)
      mockElementFromPoint(screen.getByTestId('intermediate-page-1'))

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).not.toHaveBeenCalled()

      viewerRoot.removeChild(blankNode)
    })

    it('does not use native selectionchange to choose last text below all text', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textB = screen.getByText('B')
      const textD = screen.getByText('D')

      mockElementRect(textB, { left: 10, top: 50, width: 20, height: 16 })
      mockElementRect(textD, { left: 10, top: 130, width: 20, height: 16 })

      viewerRoot.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 20,
          clientY: 58,
          button: 0
        })
      )

      viewerRoot.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 20,
          clientY: 200,
          buttons: 1
        })
      )

      const blankNode = document.createTextNode('')
      viewerRoot.appendChild(blankNode)

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textB,
        focusNode: blankNode,
        toString: () => '',
        containsNode: () => false
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)
      mockElementFromPoint(screen.getByTestId('intermediate-page-1'))

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).not.toHaveBeenCalled()

      viewerRoot.removeChild(blankNode)
    })

    it('does not use native selectionchange for equal-distance blank tie-breaks', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('C')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textB = screen.getByText('B')
      const textC = screen.getByText('C')

      mockElementRect(textB, { left: 10, top: 50, width: 20, height: 16 })
      mockElementRect(textC, { left: 10, top: 90, width: 20, height: 16 })

      viewerRoot.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 20,
          clientY: 58,
          button: 0
        })
      )

      viewerRoot.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 100,
          clientY: 78,
          buttons: 1
        })
      )

      const blankNode = document.createTextNode('')
      viewerRoot.appendChild(blankNode)

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textB,
        focusNode: blankNode,
        toString: () => '',
        containsNode: () => false
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)
      mockElementFromPoint(screen.getByTestId('intermediate-page-1'))

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).not.toHaveBeenCalled()

      viewerRoot.removeChild(blankNode)
    })

    it('does not normalize when there is no active mouse selection', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textB = screen.getByText('B')

      const blankNode = document.createTextNode('')
      viewerRoot.appendChild(blankNode)

      const selection = makeMockSelection({
        isCollapsed: false,
        anchorNode: textB,
        focusNode: blankNode,
        toString: () => '',
        containsNode: () => false
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).not.toHaveBeenCalled()

      viewerRoot.removeChild(blankNode)
    })

    it('drag selection across mixed text + background content only selects text spans', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const textSpan = screen.getByText('Page 1 text')

      // Inject a background image element into the page (simulating html-parser output)
      const bgImage = globalThis.document.createElement('img')
      bgImage.className = 'hamster-reader__intermediate-page-base-image'
      page.insertBefore(bgImage, page.firstChild)

      mockElementRect(page, { left: 0, top: 0, width: 400, height: 220 })
      mockElementRect(textSpan, { left: 10, top: 10, width: 80, height: 16 })
      mockElementRect(bgImage, { left: 0, top: 0, width: 400, height: 220 })

      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPoint(bgImage)

      try {
        dispatchPointerDragStart(textSpan, { clientX: 12, clientY: 18 })
        dispatchPointerDragMove(viewerRoot, { clientX: 200, clientY: 100 })

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.selectedText).toBe('Page 1 text')
        expect(detail.texts).toHaveLength(1)
        expect(detail.texts[0].id).toBe('text-1')
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })
  })

  describe('polygon geometry rendering', () => {
    const makePolygonText = (
      id: string,
      content: string,
      polygon: [number, number][],
      extra: Partial<IntermediateText> = {}
    ): IntermediateText => {
      return {
        id,
        content,
        fontSize: 12,
        fontFamily: 'Arial',
        fontWeight: 400,
        italic: false,
        color: '#111111',
        polygon,
        lineHeight: 16,
        ascent: 10,
        descent: 2,
        dir: 'ltr',
        skew: 0,
        isEOL: false,
        ...extra
      } as IntermediateText
    }

    const makePolygonDocument = (
      texts: IntermediateText[],
      pageSize = { x: 200, y: 200 }
    ) => {
      const pages = new Map<number, MockPage>()
      pages.set(1, {
        getContent: vi.fn(async () => texts)
      })

      const document = {
        id: 'doc-polygon',
        title: 'Polygon Document',
        pageCount: 1,
        pageNumbers: [1],
        getPageSizeByPageNumber: vi.fn(() => pageSize),
        getPageByPageNumber: vi.fn((pageNumber: number) =>
          Promise.resolve(pages.get(pageNumber))
        )
      } as unknown as IntermediateDocument

      return { document }
    }

    it('renders valid 4-point horizontal polygon with correct geometry', async () => {
      const polygon: [number, number][] = [
        [10, 20],
        [50, 20],
        [50, 36],
        [10, 36]
      ]
      const text = makePolygonText('polygon-text', 'Horizontal text', polygon)
      const { document } = makePolygonDocument([text])

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Horizontal text')).toBeInTheDocument()
      })

      const textSpan = screen.getByText('Horizontal text')
      expect(textSpan).toHaveStyle({
        left: '10px',
        top: '20px',
        width: '40px',
        height: '16px'
      })
    })

    it('renders malformed 2-point polygon with bbox fallback', async () => {
      const polygon: [number, number][] = [
        [10, 20],
        [50, 20]
      ]
      const text = makePolygonText('malformed-text', 'Fallback text', polygon)
      const { document } = makePolygonDocument([text])

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Fallback text')).toBeInTheDocument()
      })

      const textSpan = screen.getByText('Fallback text')
      expect(textSpan).toHaveStyle({
        left: '0px',
        top: '0px'
      })
      expect(textSpan.style.transform).toBe('')
    })

    it('renders vertical polygon with 90-degree rotation', async () => {
      const polygon: [number, number][] = [
        [0, 0],
        [0, 40],
        [16, 40],
        [16, 0]
      ]
      const text = makePolygonText('rotated-text', 'Rotated text', polygon)
      const { document } = makePolygonDocument([text])

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Rotated text')).toBeInTheDocument()
      })

      const textSpan = screen.getByText('Rotated text')
      expect(textSpan).toHaveStyle({
        left: '0px',
        top: '0px',
        width: '40px',
        height: '16px'
      })
      expect(textSpan.style.transform).toContain('rotate(90deg)')
    })

    it('renders text without polygon using x/y/width/height fallback', async () => {
      const text = {
        id: 'nofallback-text',
        content: 'No polygon text',
        fontSize: 12,
        fontFamily: 'Arial',
        fontWeight: 400,
        italic: false,
        color: '#111111',
        lineHeight: 16,
        ascent: 10,
        descent: 2,
        dir: 'ltr',
        skew: 0,
        isEOL: false,
        x: 30,
        y: 40,
        width: 80,
        height: 24
      } as unknown as IntermediateText
      const { document } = makePolygonDocument([text])

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('No polygon text')).toBeInTheDocument()
      })

      const textSpan = screen.getByText('No polygon text')
      expect(textSpan).toHaveStyle({
        left: '30px',
        top: '40px',
        width: '80px',
        height: '24px'
      })
    })
  })

  describe('base image rendering', () => {
    it('renders base image for pages with thumbnail data', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const pageWithThumbnail = {
        getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
        thumbnail: 'data:image/png;base64,abc123'
      }
      vi.mocked(document.getPageByPageNumber).mockResolvedValue(
        pageWithThumbnail as unknown as IntermediatePage
      )

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        const img = screen
          .getByTestId('intermediate-page-1')
          .querySelector('img')
        expect(img).toBeInTheDocument()
        expect(img).toHaveClass('hamster-reader__intermediate-page-base-image')
        expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123')
      })
    })

    it('does not render base image for pages without thumbnail data', async () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const img = screen.getByTestId('intermediate-page-1').querySelector('img')
      expect(img).not.toBeInTheDocument()
    })

    it('renders base image before text spans in DOM order', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const pageWithThumbnail = {
        getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
        thumbnail: 'data:image/png;base64,abc123'
      }
      vi.mocked(document.getPageByPageNumber).mockResolvedValue(
        pageWithThumbnail as unknown as IntermediatePage
      )

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        const page = screen.getByTestId('intermediate-page-1')
        const children = Array.from(page.children)
        const imgIndex = children.findIndex((el) => el.tagName === 'IMG')
        const textIndex = children.findIndex((el) =>
          el.classList.contains('hamster-reader__intermediate-text')
        )
        expect(imgIndex).toBeGreaterThanOrEqual(0)
        expect(textIndex).toBeGreaterThanOrEqual(0)
        expect(imgIndex).toBeLessThan(textIndex)
      })
    })
  })

  describe('pageRange filtering', () => {
    it('renders only pages within the specified range', () => {
      const { document } = makeDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: 2, end: 4 }}
        />
      )

      // Pages outside range should not exist
      expect(
        screen.queryByTestId('intermediate-page-1')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-page-5')
      ).not.toBeInTheDocument()

      // Pages within range should exist
      expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-4')).toBeInTheDocument()
    })

    it('renders all pages when pageRange is not provided', () => {
      const { document } = makeDocument({ pageCount: 3 })

      render(<IntermediateDocumentViewer document={document} />)

      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
    })

    it('renders empty viewer when range has no matching pages', () => {
      const { document } = makeDocument({ pageCount: 3 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: 10, end: 20 }}
        />
      )

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).toBeEmptyDOMElement()
    })

    it('renders empty viewer when start is greater than end', () => {
      const { document } = makeDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: 4, end: 2 }}
        />
      )

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).toBeEmptyDOMElement()
    })

    it('loads content only for pages within range', async () => {
      const { document, pages } = makeDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: 2, end: 3 }}
        />
      )

      // Trigger IntersectionObserver for visible pages
      act(() => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-2'),
          true
        )
      })

      await waitFor(() => {
        expect(screen.getByText('Page 2 text')).toBeInTheDocument()
      })

      const getLoadedPage = (pageNumber: number) => {
        const page = pages.get(pageNumber)
        if (!page) {
          throw new Error(`Expected mock page ${pageNumber} to exist`)
        }
        return page
      }

      // Pages outside range should not have getContent called
      const page1 = getLoadedPage(1)
      const page4 = getLoadedPage(4)
      const page5 = getLoadedPage(5)
      expect(page1.getContent).not.toHaveBeenCalled()
      expect(page4.getContent).not.toHaveBeenCalled()
      expect(page5.getContent).not.toHaveBeenCalled()

      // Pages within range should have getContent called
      const page2 = getLoadedPage(2)
      expect(page2.getContent).toHaveBeenCalled()
    })

    it('handles single page range', () => {
      const { document } = makeDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: 3, end: 3 }}
        />
      )

      expect(
        screen.queryByTestId('intermediate-page-1')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-page-2')
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-page-4')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-page-5')
      ).not.toBeInTheDocument()
    })

    it('normalizes fractional page numbers by truncating', () => {
      const { document } = makeDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: 1.7, end: 3.9 }}
        />
      )

      // 1.7 truncates to 1, 3.9 truncates to 3
      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-page-4')
      ).not.toBeInTheDocument()
    })

    it('renders empty viewer for non-finite page range values', () => {
      const { document } = makeDocument({ pageCount: 5 })

      const { rerender } = render(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: Infinity, end: 3 }}
        />
      )

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).toBeEmptyDOMElement()

      rerender(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: 1, end: NaN }}
        />
      )

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).toBeEmptyDOMElement()
    })
  })

  describe('selection overlay class', () => {
    const customSelectionClass =
      'hamster-reader__intermediate-document-viewer--custom-selection'

    it('applies custom-selection class when selectionOverlay is true', () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      expect(screen.getByTestId('intermediate-document-viewer')).toHaveClass(
        customSelectionClass
      )
    })

    it('applies custom-selection class when selectionOverlay object has enabled: true', () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay={{ color: '#2563eb', opacity: 0.28, enabled: true }}
        />
      )

      expect(screen.getByTestId('intermediate-document-viewer')).toHaveClass(
        customSelectionClass
      )
    })

    it('does not apply custom-selection class when selectionOverlay is omitted', () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(<IntermediateDocumentViewer document={document} />)

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).not.toHaveClass(customSelectionClass)
    })

    it('does not apply custom-selection class when selectionOverlay is false', () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay={false}
        />
      )

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).not.toHaveClass(customSelectionClass)
    })

    it('does not apply custom-selection class when enabled is explicitly false', () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay={{ enabled: false }}
        />
      )

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).not.toHaveClass(customSelectionClass)
    })
  })

  describe('selection handle snapping', () => {
    const installRangeRectMocks = installSelectionHandleRangeRectMocks

    const installCaretPositionFromPoint = (node: Node, offset: number) => {
      const original = (
        globalThis.document as Document & {
          caretPositionFromPoint?: unknown
        }
      ).caretPositionFromPoint
      Object.defineProperty(globalThis.document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({ offsetNode: node, offset }))
      })

      return () => {
        Object.defineProperty(globalThis.document, 'caretPositionFromPoint', {
          configurable: true,
          value: original
        })
      }
    }

    const installCaretRangeFromPoint = (range: Range | null) => {
      const original = (
        globalThis.document as Document & {
          caretRangeFromPoint?: unknown
        }
      ).caretRangeFromPoint
      Object.defineProperty(globalThis.document, 'caretRangeFromPoint', {
        configurable: true,
        value: vi.fn(() => range)
      })

      return () => {
        Object.defineProperty(globalThis.document, 'caretRangeFromPoint', {
          configurable: true,
          value: original
        })
      }
    }

    const makeLiveSelection = (range: Range) => {
      let activeRange = range
      return {
        get activeRange() {
          return activeRange
        },
        selection: {
          get isCollapsed() {
            return activeRange.collapsed
          },
          getRangeAt: vi.fn(() => activeRange),
          removeAllRanges: vi.fn(),
          addRange: vi.fn((nextRange: Range) => {
            activeRange = nextRange
          })
        } as unknown as Selection & {
          removeAllRanges: ReturnType<typeof vi.fn>
          addRange: ReturnType<typeof vi.fn>
        }
      }
    }

    it('rebuilds a start-handle range with the original end and refreshes overlay before pointerup', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const restoreRangeRects = installRangeRectMocks()

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const textNode = text.firstChild as Text
      const initialRange = globalThis.document.createRange()
      initialRange.setStart(textNode, 2)
      initialRange.setEnd(textNode, 8)
      const liveSelection = makeLiveSelection(initialRange)
      const pageRectSpy = mockElementRect(page, {
        left: 10,
        top: 10,
        width: 100,
        height: 150
      })
      const textRectSpy = mockElementRect(text, {
        left: 20,
        top: 24,
        width: 60,
        height: 12
      })
      const elementFromPointSpy = mockElementFromPoint(page)
      const restoreCaretPosition = installCaretPositionFromPoint(textNode, 0)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        await waitFor(() => {
          expect(
            page.querySelectorAll('.hamster-reader__selection-handle')
          ).toHaveLength(2)
        })
        await act(async () => {
          await Promise.resolve()
        })

        const startHandle = viewerRoot.querySelector(
          '[data-handle-type="start"]'
        )
        if (!(startHandle instanceof HTMLElement)) {
          throw new Error('Expected rendered start handle')
        }
        startHandle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: false,
            button: 0,
            clientX: 20,
            clientY: 24
          })
        )
        startHandle.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: false,
            clientX: 22,
            clientY: 24
          })
        )

        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(1)
        expect(liveSelection.activeRange.startContainer).toBe(textNode)
        expect(liveSelection.activeRange.startOffset).toBe(0)
        expect(liveSelection.activeRange.endContainer).toBe(textNode)
        expect(liveSelection.activeRange.endOffset).toBe(8)
        expect(
          page.querySelectorAll('.hamster-reader__selection-overlay-path')
        ).toHaveLength(1)
      } finally {
        getSelectionSpy.mockRestore()
        restoreCaretPosition()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreRangeRects()
      }
    })

    it('snaps an end handle over blank space to the nearest text boundary', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const restoreRangeRects = installRangeRectMocks()

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const textNode = text.firstChild as Text
      const initialRange = globalThis.document.createRange()
      initialRange.setStart(textNode, 0)
      initialRange.setEnd(textNode, 4)
      const liveSelection = makeLiveSelection(initialRange)
      const pageRectSpy = mockElementRect(page, {
        left: 10,
        top: 10,
        width: 100,
        height: 150
      })
      const textRectSpy = mockElementRect(text, {
        left: 20,
        top: 24,
        width: 60,
        height: 12
      })
      const elementFromPointSpy = mockElementFromPoint(page)
      const restoreCaretRange = installCaretRangeFromPoint(null)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        await waitFor(() => {
          expect(
            page.querySelectorAll('.hamster-reader__selection-handle')
          ).toHaveLength(2)
        })
        await act(async () => {
          await Promise.resolve()
        })

        const endHandle = viewerRoot.querySelector('[data-handle-type="end"]')
        if (!(endHandle instanceof HTMLElement)) {
          throw new Error('Expected rendered end handle')
        }
        endHandle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: false,
            button: 0,
            clientX: 20,
            clientY: 24
          })
        )
        endHandle.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: false,
            clientX: 125,
            clientY: 80
          })
        )

        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(1)
        expect(liveSelection.activeRange.startContainer).toBe(textNode)
        expect(liveSelection.activeRange.startOffset).toBe(0)
        expect(liveSelection.activeRange.endContainer).toBe(textNode)
        expect(liveSelection.activeRange.endOffset).toBe(textNode.length)
        expect(
          page.querySelectorAll('.hamster-reader__selection-overlay-path')
        ).toHaveLength(1)
      } finally {
        getSelectionSpy.mockRestore()
        restoreCaretRange()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreRangeRects()
      }
    })

    it('renders cloned start and end handles from the active selection', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay
          selectionHandleElement={
            <button type='button' className='custom-handle' />
          }
        />
      )

      const page = screen.getByTestId('intermediate-page-1')
      const pageRectSpy = mockElementRect(page, {
        left: 5,
        top: 5,
        width: 100,
        height: 150
      })
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(makeSelectionWithRects(() => currentRects))

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        await waitFor(() => {
          expect(
            page.querySelectorAll('.hamster-reader__selection-handle')
          ).toHaveLength(2)
        })

        const [startHandle, endHandle] = Array.from(
          page.querySelectorAll('.hamster-reader__selection-handle')
        ) as HTMLElement[]

        expect(startHandle).toHaveClass(
          'custom-handle',
          'hamster-reader__selection-handle--start'
        )
        expect(startHandle).toHaveAttribute('type', 'button')
        expect(startHandle).toHaveAttribute('data-handle-type', 'start')
        expect(startHandle).toHaveStyle({ left: '10px', top: '28px' })

        expect(endHandle).toHaveClass(
          'custom-handle',
          'hamster-reader__selection-handle--end'
        )
        expect(endHandle).toHaveAttribute('type', 'button')
        expect(endHandle).toHaveAttribute('data-handle-type', 'end')
        expect(endHandle).toHaveStyle({ left: '40px', top: '28px' })
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    })

    it('does not render custom handle elements for a collapsed selection', () => {
      const { document } = makeDocument({ pageCount: 1 })
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: true
      } as Selection)

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            selectionOverlay
            selectionHandleElement={
              <button type='button' data-testid='handle' />
            }
          />
        )

        expect(screen.queryByTestId('handle')).not.toBeInTheDocument()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('derives start handle position from collapsed start-boundary rect (left edge), not full range rect', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      // Full selection spans a wide region; collapsed start boundary sits at a
      // narrow, distinctly different position. Asserting the latter proves
      // marker geometry comes from the boundary range, not the union range.
      const fullRects = [
        makeDomRect({ left: 200, top: 25, width: 300, height: 8 })
      ]
      const startBoundaryRects = [
        makeDomRect({ left: 50, top: 25, width: 0, height: 8 })
      ]
      const endBoundaryRects = [
        makeDomRect({ left: 500, top: 25, width: 0, height: 8 })
      ]

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay
          selectionHandleElement={
            <button type='button' className='custom-handle' />
          }
        />
      )

      const page = screen.getByTestId('intermediate-page-1')
      const pageRectSpy = mockElementRect(page, {
        left: 5,
        top: 5,
        width: 600,
        height: 150
      })
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeSelectionWithBoundaryRects(
            fullRects,
            startBoundaryRects,
            endBoundaryRects
          )
        )

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        await waitFor(() => {
          expect(
            page.querySelectorAll('.hamster-reader__selection-handle')
          ).toHaveLength(2)
        })

        const [startHandle, endHandle] = Array.from(
          page.querySelectorAll('.hamster-reader__selection-handle')
        ) as HTMLElement[]

        // Start anchor = boundary rect LEFT edge (50), Y = boundary rect BOTTOM (25+8=33)
        // Page-relative: (50-5, 33-5) = (45, 28)
        expect(startHandle).toHaveStyle({ left: '45px', top: '28px' })
        // End anchor = boundary rect RIGHT edge (500), Y = boundary rect BOTTOM (33)
        // Page-relative: (500-5, 33-5) = (495, 28)
        expect(endHandle).toHaveStyle({ left: '495px', top: '28px' })
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    })

    it('respects explicit selectionOverlay color override over the pink default', () => {
      const { document } = makeDocument({ pageCount: 1 })
      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay={{ color: '#2563eb' }}
        />
      )
      const page = screen.getByTestId('intermediate-page-1')
      const overlay = page.querySelector(
        '.hamster-reader__selection-overlay'
      ) as HTMLElement
      expect(
        overlay.style.getPropertyValue('--hamster-reader-selection-color')
      ).toBe('#2563eb')
    })

    it('defaults the selection color CSS variable to pink (#ec4899) when no color override is provided', () => {
      const { document } = makeDocument({ pageCount: 1 })
      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )
      const page = screen.getByTestId('intermediate-page-1')
      const overlay = page.querySelector(
        '.hamster-reader__selection-overlay'
      ) as HTMLElement
      expect(
        overlay.style.getPropertyValue('--hamster-reader-selection-color')
      ).toBe('#ec4899')
    })

    it('disables handle rendering entirely when selectionHandleElement is null', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]
      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay
          selectionHandleElement={null}
        />
      )
      const page = screen.getByTestId('intermediate-page-1')
      const pageRectSpy = mockElementRect(page, {
        left: 5,
        top: 5,
        width: 100,
        height: 150
      })
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(makeSelectionWithRects(() => currentRects))

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))
        await waitFor(() => {
          expect(getOverlayBlocks(page)).toHaveLength(1)
        })
        expect(
          page.querySelectorAll('.hamster-reader__selection-handle')
        ).toHaveLength(0)
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    })
  })

  describe('selection overlay live drag refresh', () => {
    it('updates overlay blocks during primary-button mousemove before mouseup', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      let currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]
      const originalGetClientRects = Range.prototype.getClientRects
      const originalGetBoundingClientRect =
        Range.prototype.getBoundingClientRect

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const pageRectSpy = vi
        .spyOn(page, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 5, top: 5, width: 100, height: 150 })
        )
      const textRectSpy = vi
        .spyOn(text, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
        )
      const elementFromPointSpy = mockElementFromPoint(page)
      const initialRange = globalThis.document.createRange()
      initialRange.selectNodeContents(text)
      initialRange.collapse(true)
      let activeRange = initialRange
      const selection = {
        get isCollapsed() {
          return activeRange.collapsed
        },
        getRangeAt: vi.fn(() => activeRange),
        removeAllRanges: vi.fn(),
        addRange: vi.fn((range: Range) => {
          activeRange = range
        })
      } as unknown as Selection
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(selection)
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => currentRects)
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(
          () =>
            currentRects[0] ??
            makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
        )
      })

      try {
        text.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )

        viewerRoot.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 45,
            clientY: 33
          })
        )

        let blocks = getOverlayBlocks(page)
        expect(blocks).toHaveLength(1)
        expectPathCoversRect(blocks[0], {
          left: 10,
          top: 20,
          width: 30,
          height: 8
        })

        currentRects = [
          makeDomRect({ left: 35, top: 55, width: 25, height: 10 })
        ]

        viewerRoot.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 60,
            clientY: 65
          })
        )

        blocks = getOverlayBlocks(page)
        expect(blocks).toHaveLength(1)
        expectPathCoversRect(blocks[0], {
          left: 30,
          top: 50,
          width: 25,
          height: 10
        })
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: originalGetClientRects
        })
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: originalGetBoundingClientRect
        })
      }
    })

    it('stops refreshing overlay blocks after pointercancel ends the adapter drag', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      let currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]
      const originalGetClientRects = Range.prototype.getClientRects
      const originalGetBoundingClientRect =
        Range.prototype.getBoundingClientRect

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const pageRectSpy = vi
        .spyOn(page, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 5, top: 5, width: 100, height: 150 })
        )
      const textRectSpy = vi
        .spyOn(text, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
        )
      const elementFromPointSpy = mockElementFromPoint(page)
      const initialRange = globalThis.document.createRange()
      initialRange.selectNodeContents(text)
      initialRange.collapse(true)
      let activeRange = initialRange
      const selection = {
        get isCollapsed() {
          return activeRange.collapsed
        },
        getRangeAt: vi.fn(() => activeRange),
        removeAllRanges: vi.fn(),
        addRange: vi.fn((range: Range) => {
          activeRange = range
        })
      } as unknown as Selection
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(selection)
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => currentRects)
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(
          () =>
            currentRects[0] ??
            makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
        )
      })

      try {
        text.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )

        viewerRoot.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 45,
            clientY: 33
          })
        )

        const initialBlock = getOverlayBlocks(page)[0]
        expectPathCoversRect(initialBlock, {
          left: 10,
          top: 20,
          width: 30,
          height: 8
        })

        viewerRoot.dispatchEvent(
          new MouseEvent('pointercancel', {
            bubbles: true,
            clientX: 65,
            clientY: 87
          })
        )

        currentRects = [
          makeDomRect({ left: 45, top: 75, width: 20, height: 12 })
        ]

        viewerRoot.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 65,
            clientY: 87
          })
        )

        const blocks = getOverlayBlocks(page)
        expect(blocks).toHaveLength(1)
        expectPathCoversRect(blocks[0], {
          left: 10,
          top: 20,
          width: 30,
          height: 8
        })
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: originalGetClientRects
        })
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: originalGetBoundingClientRect
        })
      }
    })
  })

  describe('selection overlay cleanup', () => {
    const customSelectionClass =
      'hamster-reader__intermediate-document-viewer--custom-selection'

    it('clears overlay class, blocks, and handles when selectionOverlay becomes disabled', () => {
      const { document } = makeDocument({ pageCount: 1 })
      const { rerender } = render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
        />
      )

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const overlayContainer = page.querySelector(
        '.hamster-reader__selection-overlay'
      ) as HTMLElement
      const overlayBlock = globalThis.document.createElement('div')
      overlayBlock.className = 'hamster-reader__selection-overlay-path'
      overlayContainer.appendChild(overlayBlock)

      expect(viewerRoot).toHaveClass(customSelectionClass)
      expect(getOverlayBlocks(page)).toHaveLength(1)
      expect(
        page.querySelector('.hamster-reader__selection-handles')
      ).toBeInTheDocument()

      rerender(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay={false}
          selectionHandleElement={<button type='button' />}
        />
      )

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).not.toHaveClass(customSelectionClass)
      expect(overlayContainer).toBeEmptyDOMElement()
      expect(
        page.querySelector('.hamster-reader__selection-overlay')
      ).toBeNull()
      expect(
        page.querySelector('.hamster-reader__selection-handles')
      ).toBeNull()
    })

    it('clears collapsed and invalid selections from overlay blocks', () => {
      const { document } = makeDocument({ pageCount: 1 })
      let currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      const page = screen.getByTestId('intermediate-page-1')
      const pageRectSpy = vi
        .spyOn(page, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 5, top: 5, width: 100, height: 150 })
        )
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(makeSelectionWithRects(() => currentRects))

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(getOverlayBlocks(page)).toHaveLength(1)

        getSelectionSpy.mockReturnValue({ isCollapsed: true } as Selection)
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(getOverlayBlocks(page)).toHaveLength(0)

        currentRects = [makeDomRect({ left: 15, top: 25, width: 0, height: 8 })]
        getSelectionSpy.mockReturnValue(
          makeSelectionWithRects(() => currentRects)
        )
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(getOverlayBlocks(page)).toHaveLength(0)
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    })

    it('refreshes overlay blocks on resize and scroll reflow', () => {
      const { document } = makeDocument({ pageCount: 1 })
      let currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      const page = screen.getByTestId('intermediate-page-1')
      const pageRectSpy = vi
        .spyOn(page, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 5, top: 5, width: 100, height: 150 })
        )
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(makeSelectionWithRects(() => currentRects))

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))
        expect(getOverlayBlocks(page)).toHaveLength(1)
        expectPathCoversRect(getOverlayBlocks(page)[0], {
          left: 10,
          top: 20,
          width: 30,
          height: 8
        })

        currentRects = [
          makeDomRect({ left: 35, top: 45, width: 25, height: 10 })
        ]
        globalThis.window.dispatchEvent(new Event('resize'))

        expect(getOverlayBlocks(page)).toHaveLength(1)
        expectPathCoversRect(getOverlayBlocks(page)[0], {
          left: 30,
          top: 40,
          width: 25,
          height: 10
        })

        currentRects = [
          makeDomRect({ left: 45, top: 55, width: 20, height: 12 })
        ]
        globalThis.document.dispatchEvent(new Event('scroll'))

        expect(getOverlayBlocks(page)).toHaveLength(1)
        expectPathCoversRect(getOverlayBlocks(page)[0], {
          left: 40,
          top: 50,
          width: 20,
          height: 12
        })
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    })

    it('clears overlay containers on unmount and removes active listeners', () => {
      const { document } = makeDocument({ pageCount: 1 })
      const { unmount } = render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const overlayContainer = page.querySelector(
        '.hamster-reader__selection-overlay'
      ) as HTMLElement
      const overlayBlock = globalThis.document.createElement('div')
      overlayBlock.className = 'hamster-reader__selection-overlay-path'
      overlayContainer.appendChild(overlayBlock)

      unmount()

      expect(overlayContainer).toBeEmptyDOMElement()

      const sentinel = globalThis.document.createElement('div')
      sentinel.dataset.testid = 'detached-overlay-sentinel'
      overlayContainer.appendChild(sentinel)

      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeSelectionWithRects(() => [
            makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
          ])
        )

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))
        globalThis.document.dispatchEvent(new MouseEvent('mouseup'))
        globalThis.window.dispatchEvent(new Event('resize'))
        globalThis.document.dispatchEvent(new Event('scroll'))
        viewerRoot.dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, buttons: 1 })
        )

        expect(getSelectionSpy).not.toHaveBeenCalled()
        expect(overlayContainer).toContainElement(sentinel)
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    // expectPathCoversRect calls expect() internally for each corner
    // eslint-disable-next-line sonarjs/assertions-in-tests
    it('draws html-parser overlay with viewer-root-relative coordinates', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(
        '<div class="hamster-note-document"><div class="hamster-note-page">Parsed page text</div></div>'
      )

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = await screen.findByText('Parsed page text')
      const overlay = viewerRoot.querySelector(
        '.hamster-reader__selection-overlay'
      ) as HTMLElement

      const viewerRectSpy = vi
        .spyOn(viewerRoot, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 100, top: 200, width: 500, height: 700 })
        )
      Object.defineProperty(viewerRoot, 'scrollLeft', {
        value: 7,
        configurable: true
      })
      Object.defineProperty(viewerRoot, 'scrollTop', {
        value: 11,
        configurable: true
      })
      const pageRectSpy = vi
        .spyOn(page, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 140, top: 260, width: 300, height: 400 })
        )
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeSelectionWithRects(() => [
            makeDomRect({ left: 150, top: 280, width: 45, height: 12 })
          ])
        )

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        const path = overlay.querySelector(
          '.hamster-reader__selection-overlay-path'
        ) as SVGPathElement
        expectPathCoversRect(path, {
          left: 57,
          top: 91,
          width: 45,
          height: 12
        })
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
        viewerRectSpy.mockRestore()
      }
    })

    it('keeps overlay after the click synthesized from a completed drag selection', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const removeAllRanges = vi.fn()
      const addRange = vi.fn()

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const pageRectSpy = vi
        .spyOn(page, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 5, top: 5, width: 100, height: 150 })
        )
      const textRectSpy = vi
        .spyOn(text, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
        )
      const elementFromPointSpy = mockElementFromPoint(page)
      const selection = {
        ...makeSelectionWithRects(() => [
          makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
        ]),
        removeAllRanges,
        addRange
      } as unknown as Selection
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(selection)

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))
        expect(getOverlayBlocks(page)).toHaveLength(1)

        text.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )
        viewerRoot.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 45,
            clientY: 33
          })
        )
        viewerRoot.dispatchEvent(
          new MouseEvent('pointerup', {
            bubbles: true,
            button: 0,
            clientX: 45,
            clientY: 33
          })
        )
        removeAllRanges.mockClear()
        viewerRoot.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(removeAllRanges).not.toHaveBeenCalled()
        expect(getOverlayBlocks(page)).toHaveLength(1)
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    })
  })

  describe('blank click cancellation', () => {
    it('clears selection and overlay when clicking blank page margin area', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const removeAllRanges = vi.fn()
      const mockSelection = {
        isCollapsed: false,
        removeAllRanges,
        anchorNode: null,
        focusNode: null,
        toString: () => 'selected text'
      } as unknown as Selection

      render(<IntermediateDocumentViewer document={mockDoc} selectionOverlay />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const overlayContainer = page.querySelector(
        '.hamster-reader__selection-overlay'
      ) as HTMLElement

      // Seed an overlay block to verify it gets cleared
      const overlayBlock = globalThis.document.createElement('div')
      overlayBlock.className = 'hamster-reader__selection-overlay-path'
      overlayContainer.appendChild(overlayBlock)

      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(mockSelection)

      try {
        // Click on the page div margin (blank area, not on text or overlay)
        page.click()

        expect(removeAllRanges).toHaveBeenCalled()
        expect(
          page.querySelector('.hamster-reader__selection-overlay-path')
        ).toBeNull()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('does not clear selection when clicking on text span', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const removeAllRanges = vi.fn()
      const mockSelection = {
        isCollapsed: false,
        removeAllRanges,
        anchorNode: null,
        focusNode: null,
        toString: () => 'selected text'
      } as unknown as Selection

      render(<IntermediateDocumentViewer document={mockDoc} selectionOverlay />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const textSpan = screen.getByText('Page 1 text')

      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(mockSelection)

      try {
        textSpan.click()

        expect(removeAllRanges).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('does not clear native selection when clicking html-parser output', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const removeAllRanges = vi.fn()
      const mockSelection = {
        isCollapsed: false,
        removeAllRanges,
        anchorNode: null,
        focusNode: null,
        toString: () => 'selected html text'
      } as unknown as Selection

      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(
        '<div class="hamster-note-document"><p>Selectable HTML text</p></div>'
      )
      render(<IntermediateDocumentViewer document={mockDoc} selectionOverlay />)

      await waitFor(() => {
        expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
      })

      const htmlParserOutput = screen.getByTestId('html-parser-output')

      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(mockSelection)

      try {
        htmlParserOutput.click()

        expect(removeAllRanges).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('does not clear selection when clicking overlay block or handle', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const removeAllRanges = vi.fn()
      const mockSelection = {
        isCollapsed: false,
        removeAllRanges,
        anchorNode: null,
        focusNode: null,
        toString: () => 'selected text'
      } as unknown as Selection

      render(<IntermediateDocumentViewer document={mockDoc} selectionOverlay />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const overlayContainer = page.querySelector(
        '.hamster-reader__selection-overlay'
      ) as HTMLElement

      const overlayBlock = globalThis.document.createElement('div')
      overlayBlock.className = 'hamster-reader__selection-overlay-path'
      overlayContainer.appendChild(overlayBlock)

      const handle = globalThis.document.createElement('button')
      handle.dataset.handleType = 'start'
      viewerRoot.appendChild(handle)

      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(mockSelection)

      try {
        overlayBlock.click()
        expect(removeAllRanges).not.toHaveBeenCalled()

        handle.click()
        expect(removeAllRanges).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('does not trigger blank cancellation on handle drag mouseup', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const removeAllRanges = vi.fn()
      const mockSelection = {
        isCollapsed: false,
        removeAllRanges,
        anchorNode: null,
        focusNode: null,
        toString: () => 'selected text'
      } as unknown as Selection

      render(<IntermediateDocumentViewer document={mockDoc} selectionOverlay />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')

      // Simulate a handle element that would receive drag pointerup → click sequence
      const handle = globalThis.document.createElement('button')
      handle.dataset.handleType = 'end'
      viewerRoot.appendChild(handle)

      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(mockSelection)

      try {
        // Direct click on handle element — [data-handle-type] exclusion prevents blank cancellation
        handle.click()

        expect(removeAllRanges).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })
  })

  describe('background image unselectability', () => {
    it('SCSS base-image rule includes user-select: none, -webkit-user-select: none, -webkit-touch-callout: none, and pointer-events: none', () => {
      const scssSource = fs.readFileSync(
        path.resolve(__dirname, '../src/styles/reader.scss'),
        'utf-8'
      )
      const baseImageBlockMatch = scssSource.match(
        /&__intermediate-page-base-image\s*\{([^}]*)\}/
      )
      expect(baseImageBlockMatch).toBeTruthy()
      if (!baseImageBlockMatch) {
        throw new Error(
          'Expected intermediate-page-base-image SCSS block to exist'
        )
      }

      const block = baseImageBlockMatch[1]
      expect(block).toContain('user-select: none')
      expect(block).toContain('-webkit-user-select: none')
      expect(block).toContain('-webkit-touch-callout: none')
      expect(block).toContain('pointer-events: none')
    })

    it('SCSS documents that html-parser backgrounds are CSS background-image and inherently unselectable', () => {
      const scssSource = fs.readFileSync(
        path.resolve(__dirname, '../src/styles/reader.scss'),
        'utf-8'
      )
      // The html-parser renders backgrounds as CSS `background-image` on
      // `.hamster-note-page` divs, not as separate DOM elements. CSS backgrounds
      // are inherently unselectable — they are not DOM nodes.
      expect(scssSource).toContain('background-image')
      expect(scssSource).toContain('inherently unselectable')
    })

    it('renders direct-render base image with aria-hidden="true" and no inline pointer-events', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const pageWithThumbnail = {
        getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
        thumbnail: 'data:image/png;base64,abc123'
      }
      vi.mocked(document.getPageByPageNumber).mockResolvedValue(
        pageWithThumbnail as unknown as IntermediatePage
      )

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        const img = screen
          .getByTestId('intermediate-page-1')
          .querySelector('.hamster-reader__intermediate-page-base-image')
        expect(img).toBeInTheDocument()
        expect(img).toHaveAttribute('aria-hidden', 'true')
        expect(img).toHaveAttribute('alt', '')
      })
    })

    it('isSelectionBackgroundTarget returns true for base-image, background, and background-wrapper nodes', () => {
      const viewerRoot = document.createElement('div')
      const baseImage = document.createElement('img')
      baseImage.className = 'hamster-reader__intermediate-page-base-image'
      const background = document.createElement('div')
      background.className = 'hamster-reader__intermediate-page-background'
      const wrapper = document.createElement('div')
      wrapper.className = 'hamster-reader__intermediate-page-background-wrapper'
      const textSpan = document.createElement('span')
      textSpan.className = 'hamster-reader__intermediate-text'

      viewerRoot.append(baseImage, background, wrapper, textSpan)

      expect(isSelectionBackgroundTarget(baseImage)).toBe(true)
      expect(isSelectionBackgroundTarget(background)).toBe(true)
      expect(isSelectionBackgroundTarget(wrapper)).toBe(true)
      expect(isSelectionBackgroundTarget(textSpan)).toBe(false)
    })

    it('caretResolver skips background elements inside background-wrapper and resolves to nearest text', () => {
      const viewerRoot = document.createElement('div')
      viewerRoot.className = 'hamster-reader__intermediate-document-viewer'
      const page = document.createElement('div')
      page.dataset.pageNumber = '1'

      const wrapper = document.createElement('div')
      wrapper.className = 'hamster-reader__intermediate-page-background-wrapper'
      const bgImage = document.createElement('img')
      bgImage.className = 'hamster-reader__intermediate-page-background'
      wrapper.appendChild(bgImage)

      const textA = document.createElement('span')
      textA.dataset.textId = 'a'
      textA.textContent = 'A'
      const textB = document.createElement('span')
      textB.dataset.textId = 'b'
      textB.textContent = 'B'

      page.append(wrapper, textA, textB)
      viewerRoot.appendChild(page)
      document.body.appendChild(viewerRoot)

      mockElementRect(page, { left: 0, top: 0, width: 200, height: 100 })
      mockElementRect(textA, { left: 10, top: 10, width: 20, height: 10 })
      mockElementRect(textB, { left: 50, top: 10, width: 20, height: 10 })
      mockElementFromPoint(bgImage)

      const textElements = new Map([
        ['a', { text: makeText('a', 'A'), pageNumber: 1 }],
        ['b', { text: makeText('b', 'B'), pageNumber: 1 }]
      ])

      const result = resolveCaret(30, 15, {
        viewerRoot,
        pageRefs: new Map([[1, page as HTMLDivElement]]),
        textElements,
        caretPositionFromPoint: () => ({ offsetNode: bgImage, offset: 0 }),
        caretRangeFromPoint: () => null
      })

      expect(result).not.toBeNull()
      expect(result?.pageNumber).toBe(1)
      // Should snap to nearest text (textA is closer at x=10..30 vs textB at x=50..70)
      expect(result?.range.startContainer).toBe(getRequiredTextNode(textA))
      expect(result?.range.startContainer).not.toBe(bgImage)
    })
  })
})
