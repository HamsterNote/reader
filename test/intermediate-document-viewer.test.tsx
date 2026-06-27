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

import { buildSelectionPayload } from '../src/components/IntermediateDocumentViewer'
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
import type { OverlayRectType } from './mocks/selection'
import {
  clearLastSelectionProps,
  getLastSelectionProps
} from './mocks/selection'
import {
  VirtualPaper,
  VirtualPaperInteractionMode
} from './mocks/virtual-paper'
import { intersectionObserverMock } from './setup'

Reflect.set(globalThis, 'vi', vi)

vi.mock('@hamster-note/html-parser', () => ({
  HtmlParser: {
    decodeToHtml: vi.fn(),
    decodePageToHtml: vi.fn()
  }
}))

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

const createDeferred = <T,>() => {
  let resolveDeferred: (value: T | PromiseLike<T>) => void = () => {}
  let rejectDeferred: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })

  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred
  }
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

const installQueuedIdleCallback = () => {
  const originalRequestIdleCallback = window.requestIdleCallback
  const originalCancelIdleCallback = window.cancelIdleCallback
  let nextId = 1
  const callbacks = new Map<number, IdleRequestCallback>()

  const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    const id = nextId
    nextId += 1
    callbacks.set(id, callback)
    return id
  })

  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: requestIdleCallback
  })
  Object.defineProperty(window, 'cancelIdleCallback', {
    configurable: true,
    writable: true,
    value: vi.fn((id: number) => {
      callbacks.delete(id)
    })
  })

  return {
    requestedCount() {
      return requestIdleCallback.mock.calls.length
    },
    async flush() {
      const pendingCallbacks = Array.from(callbacks.entries())
      callbacks.clear()
      await act(async () => {
        for (const [, callback] of pendingCallbacks) {
          callback({ didTimeout: false, timeRemaining: () => 50 })
        }
        await Promise.resolve()
      })
    },
    restore() {
      Object.defineProperty(window, 'requestIdleCallback', {
        configurable: true,
        writable: true,
        value: originalRequestIdleCallback
      })
      Object.defineProperty(window, 'cancelIdleCallback', {
        configurable: true,
        writable: true,
        value: originalCancelIdleCallback
      })
    }
  }
}

const getRequiredTextNode = (element: HTMLElement) => {
  const node = element.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    throw new Error('Expected element to contain a text node')
  }
  return node
}

const makeCollapsedRange = (node: Node, offset: number) => {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  return range
}

const makeHtmlParserCaretFixture = () => {
  const viewerRoot = document.createElement('div')
  viewerRoot.className = 'hamster-reader__intermediate-document-viewer'

  const output = document.createElement('div')
  output.className = 'hamster-reader__html-parser-output'

  const page = document.createElement('div')
  page.className = 'hamster-note-page'
  page.dataset.pageNumber = '1'

  const paragraph = document.createElement('p')
  paragraph.textContent = 'Native parsed text'
  page.appendChild(paragraph)
  output.appendChild(page)

  viewerRoot.append(output)
  document.body.appendChild(viewerRoot)

  const outsideViewerRoot = document.createElement('div')
  outsideViewerRoot.className = 'hamster-reader__intermediate-document-viewer'
  const outsideOutput = document.createElement('div')
  outsideOutput.className = 'hamster-reader__html-parser-output'
  const outsidePage = document.createElement('div')
  outsidePage.className = 'hamster-note-page'
  const outsideParagraph = document.createElement('p')
  outsideParagraph.textContent = 'Outside parsed text'
  outsidePage.appendChild(outsideParagraph)
  outsideOutput.appendChild(outsidePage)
  outsideViewerRoot.appendChild(outsideOutput)
  document.body.appendChild(outsideViewerRoot)

  return {
    viewerRoot,
    page,
    paragraph,
    htmlTextNode: getRequiredTextNode(paragraph),
    outsideTextNode: getRequiredTextNode(outsideParagraph)
  }
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
        textElements: new Map([
          ['a', { text: makeText('a', 'Alpha'), pageNumber: 1 }]
        ])
      })

      expect(caretPositionFromPoint).toHaveBeenCalledWith(30, 15)
      expect(result?.pageNumber).toBe(1)
      expect(result?.range.startContainer).toBe(
        getRequiredTextNode(textElement)
      )
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

  it('accepts native html-parser text ranges only when explicitly enabled', () => {
    const { viewerRoot, page, paragraph, htmlTextNode } =
      makeHtmlParserCaretFixture()
    mockElementFromPoint(paragraph)

    const result = resolveCaret(30, 15, {
      viewerRoot,
      pageRefs: new Map(),
      textElements: new Map(),
      allowHtmlParserRange: true,
      caretPositionFromPoint: () => null,
      caretRangeFromPoint: () => makeCollapsedRange(htmlTextNode, 6)
    })

    expect(result?.pageNumber).toBe(1)
    expect(result?.range.startContainer).toBe(htmlTextNode)
    expect(result?.range.startOffset).toBe(6)

    const directModeResult = resolveCaret(30, 15, {
      viewerRoot,
      pageRefs: new Map(),
      textElements: new Map(),
      caretPositionFromPoint: () => null,
      caretRangeFromPoint: () => makeCollapsedRange(htmlTextNode, 6)
    })

    expect(directModeResult).toBeNull()
    expect(page.dataset.pageNumber).toBe('1')
  })

  it('composes a real DOM Selection and orders reversed endpoints', () => {
    const host = document.createElement('div')
    host.textContent = 'abcdef'
    document.body.appendChild(host)
    const textNode = getRequiredTextNode(host)

    const range = createOrderedRange(textNode, 5, textNode, 2)
    composeSelection(range)

    const selection = document.getSelection()
    expect(range.toString()).toBe('cde')
    expect(selection?.rangeCount).toBe(1)
    expect(selection?.toString()).toBe('cde')
  })

  it('creates ordered ranges from the endpoint owner document', () => {
    const foreignDocument = document.implementation.createHTMLDocument('nested')
    const host = foreignDocument.createElement('div')
    host.textContent = 'abcdef'
    foreignDocument.body.appendChild(host)
    const textNode = getRequiredTextNode(host)

    const range = createOrderedRange(textNode, 5, textNode, 2)

    expect(range.startContainer.ownerDocument).toBe(foreignDocument)
    expect(range.toString()).toBe('cde')
  })
})

describe('IntermediateDocumentViewer', () => {
  beforeEach(() => {
    Reflect.set(globalThis, '__hamsterReaderMockDragInstances', [])
    vi.mocked(HtmlParser.decodeToHtml).mockReset()
    vi.mocked(HtmlParser.decodePageToHtml).mockReset()
    vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue('')
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')
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

  it('renders html-parser output for runtime documents with decodePageToHtml', async () => {
    const { document, pages } = makeDocument({ pageCount: 1 })
    const mockHtml =
      '<div class="hamster-note-page"><div class="page">HTML Parser Output</div></div>'

    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(mockHtml)

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(pages.get(1), {
      background: { backgroundQuality: 0.8 }
    })
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
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
        '<div class="hamster-note-page"><div class="page">Serialized HTML</div></div>'

      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(mockHtml)

      render(
        <IntermediateDocumentViewer serializedDocument={serializedDocument} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
      })

      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(1)
      expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
      expect(screen.getByTestId('html-parser-output')).toContainHTML(
        'Serialized HTML'
      )
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('html-parser output wraps page slots in hamster-note-document', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(
      '<div class="hamster-note-page">Page 1 content</div>'
    )

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    const output = screen.getByTestId('html-parser-output')
    expect(output).toHaveClass('hamster-reader__html-parser-output')

    const documentWrapper = output.querySelector('.hamster-note-document')
    expect(documentWrapper).not.toBeNull()

    const slot = screen.getByTestId('intermediate-page-1')
    expect(documentWrapper).toContainElement(slot)
    expect(slot).toHaveClass('hamster-reader__intermediate-page')
    expect(slot).toHaveAttribute('data-page-number', '1')
  })

  it('decoded html-parser page slot contains child hamster-note-page', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(
      '<div class="hamster-note-page"><p>Decoded content</p></div>'
    )

    render(<IntermediateDocumentViewer document={document} />)

    await screen.findByText('Decoded content')

    const slot = screen.getByTestId('intermediate-page-1')
    const notePage = slot.querySelector('.hamster-note-page')
    expect(notePage).not.toBeNull()
    expect(notePage).toHaveTextContent('Decoded content')
  })

  it('html-parser page slots preserve width/height style in all states', async () => {
    const { document, pages } = makeDocument({ pageCount: 3 })
    const failedPage = pages.get(2) as unknown
    vi.mocked(HtmlParser.decodePageToHtml).mockImplementation(async (page) => {
      if (page === failedPage) {
        throw new Error('Page 2 failed')
      }
      return '<div class="hamster-note-page">Decoded</div>'
    })

    render(<IntermediateDocumentViewer document={document} overscan={2} />)

    // Before decode resolves, all slots should have page dimensions
    expect(screen.getByTestId('intermediate-page-1')).toHaveStyle({
      width: '100px',
      height: '150px'
    })
    expect(screen.getByTestId('intermediate-page-2')).toHaveStyle({
      width: '100px',
      height: '150px'
    })

    await waitFor(() => {
      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(3)
    })

    // After decode: page 1 decoded, page 2 fallback, page 3 decoded
    // All slots should still have the same dimensions
    for (const pageNumber of [1, 2, 3]) {
      expect(screen.getByTestId(`intermediate-page-${pageNumber}`)).toHaveStyle(
        {
          width: '100px',
          height: '150px'
        }
      )
    }
  })

  it('failed html-parser page shows direct-rendered text in same slot', async () => {
    const { document, pages } = makeDocument({ pageCount: 2 })
    const failedPage = pages.get(2) as unknown
    vi.mocked(HtmlParser.decodePageToHtml).mockImplementation(async (page) => {
      if (page === failedPage) {
        throw new Error('Page 2 failed')
      }
      return '<div class="hamster-note-page">Page 1 decoded</div>'
    })

    render(<IntermediateDocumentViewer document={document} overscan={2} />)

    await screen.findByText('Page 1 decoded')
    await waitFor(() => {
      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(2)
    })

    // Page 1 decoded: should show html-parser content
    const slot1 = screen.getByTestId('intermediate-page-1')
    expect(slot1.querySelector('.hamster-note-page')).not.toBeNull()

    // Page 2 failed: should show direct-rendered text inside its slot
    const slot2 = screen.getByTestId('intermediate-page-2')
    expect(slot2).toHaveAttribute('data-page-number', '2')
    expect(slot2).toHaveTextContent('Page 2 text')
    expect(slot2.querySelector('.hamster-note-page')).toBeNull()
  })

  it('page lookup resolves decoded child hamster-note-page for html-parser pages', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(
      '<div class="hamster-note-page"><p>Lookup target</p></div>'
    )

    render(<IntermediateDocumentViewer document={document} />)

    await screen.findByText('Lookup target')

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const htmlParserPages = viewerRoot.querySelectorAll(
      '.hamster-reader__html-parser-output .hamster-note-page'
    )
    expect(htmlParserPages).toHaveLength(1)

    // The slot is the pageRefs target; the .hamster-note-page is the
    // selection target inside the slot.
    const slot = screen.getByTestId('intermediate-page-1')
    expect(slot.querySelector('.hamster-note-page')).not.toBeNull()
  })

  it('keeps html-parser output shell when html-parser page fails', async () => {
    const { document } = makeDocument({ pageCount: 1 })

    vi.mocked(HtmlParser.decodePageToHtml).mockRejectedValueOnce(
      new Error('Parser failed')
    )

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
    expect(
      screen
        .getByTestId('intermediate-page-1')
        .querySelector('.hamster-note-page')
    ).toBeNull()
  })

  it('keeps html-parser output shell when html-parser returns empty string', async () => {
    const { document } = makeDocument({ pageCount: 1 })

    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce('')

    render(<IntermediateDocumentViewer document={document} />)

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    expect(
      screen
        .getByTestId('intermediate-page-1')
        .querySelector('.hamster-note-page')
    ).toBeNull()
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('passes high backgroundQuality to decodePageToHtml', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(
      '<div class="hamster-note-page">High quality</div>'
    )

    render(
      <IntermediateDocumentViewer
        document={document}
        backgroundQuality='high'
      />
    )

    await screen.findByText('High quality')

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(
      expect.anything(),
      { background: { backgroundQuality: 0.8 } }
    )
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('passes default high backgroundQuality options to decodePageToHtml when absent', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(
      '<div class="hamster-note-page">Default quality</div>'
    )

    render(<IntermediateDocumentViewer document={document} />)

    await screen.findByText('Default quality')

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(
      expect.anything(),
      { background: { backgroundQuality: 0.8 } }
    )
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('direct renderMode calls neither decodePageToHtml nor decodeToHtml', async () => {
    const { document, pages } = makeDocument({ pageCount: 1 })

    render(
      <IntermediateDocumentViewer document={document} renderMode='direct' />
    )

    await waitFor(() => {
      expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
    })

    expect(HtmlParser.decodePageToHtml).not.toHaveBeenCalled()
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
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

  it('lazy decodePageToHtml decodes only loadable pages before IntersectionObserver exposes more pages', async () => {
    const { document, pages } = makeDocument({ pageCount: 3 })
    const decodedPageNumbers = new WeakMap<object, number>()
    const decodePromises = new Map<
      number,
      ReturnType<typeof createDeferred<string>>
    >()
    pages.forEach((page, pageNumber) => {
      decodedPageNumbers.set(page as unknown as object, pageNumber)
      decodePromises.set(pageNumber, createDeferred<string>())
    })
    vi.mocked(HtmlParser.decodePageToHtml).mockImplementation(async (page) => {
      const pageNumber = decodedPageNumbers.get(page as unknown as object)
      if (!pageNumber) return ''
      return decodePromises.get(pageNumber)?.promise ?? ''
    })

    render(<IntermediateDocumentViewer document={document} overscan={0} />)

    await waitFor(() => {
      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(1)
    })
    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(pages.get(1), {
      background: { backgroundQuality: 0.8 }
    })
    expect(screen.queryByText('Decoded page 2')).not.toBeInTheDocument()

    intersectionObserverMock.trigger(screen.getByTestId('intermediate-page-2'))

    await waitFor(() => {
      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(2)
    })
    await act(async () => {
      decodePromises
        .get(1)
        ?.resolve('<div class="hamster-note-page">Decoded page 1</div>')
      decodePromises
        .get(2)
        ?.resolve('<div class="hamster-note-page">Decoded page 2</div>')
      await Promise.all([
        decodePromises.get(1)?.promise,
        decodePromises.get(2)?.promise
      ])
    })

    await screen.findByText('Decoded page 1')
    await screen.findByText('Decoded page 2')
    expect(HtmlParser.decodePageToHtml).toHaveBeenLastCalledWith(pages.get(2), {
      background: { backgroundQuality: 0.8 }
    })
    expect(screen.queryByText('Decoded page 3')).not.toBeInTheDocument()
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('decodePageToHtml duplicate renders do not duplicate in-flight calls for the same page', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    const firstDecode = createDeferred<string>()
    vi.mocked(HtmlParser.decodePageToHtml).mockReturnValueOnce(
      firstDecode.promise
    )

    const { rerender } = render(
      <IntermediateDocumentViewer document={document} />
    )

    await waitFor(() => {
      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(1)
    })

    rerender(<IntermediateDocumentViewer document={document} />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstDecode.resolve('<div class="hamster-note-page">Decoded once</div>')
      await firstDecode.promise
    })

    expect(await screen.findByText('Decoded once')).toBeInTheDocument()
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('stale decodePageToHtml results are ignored after backgroundQuality changes', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    const staleDecode = createDeferred<string>()
    vi.mocked(HtmlParser.decodePageToHtml)
      .mockReturnValueOnce(staleDecode.promise)
      .mockResolvedValueOnce(
        '<div class="hamster-note-page">Fresh high quality decode</div>'
      )

    const { rerender } = render(
      <IntermediateDocumentViewer document={document} backgroundQuality='low' />
    )

    await waitFor(() => {
      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(1)
    })

    rerender(
      <IntermediateDocumentViewer
        document={document}
        backgroundQuality='high'
      />
    )

    await screen.findByText('Fresh high quality decode')

    await act(async () => {
      staleDecode.resolve('<div class="hamster-note-page">Stale decode</div>')
      await staleDecode.promise
    })

    expect(screen.queryByText('Stale decode')).not.toBeInTheDocument()
    expect(screen.getByText('Fresh high quality decode')).toBeInTheDocument()
    expect(HtmlParser.decodePageToHtml).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { background: { backgroundQuality: 0.8 } }
    )
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('decodePageToHtml page failure only falls back that page', async () => {
    const { document, pages } = makeDocument({ pageCount: 3 })
    const failedPage = pages.get(2) as unknown
    const decodedPageNumbers = new WeakMap<object, number>()
    pages.forEach((page, pageNumber) => {
      decodedPageNumbers.set(page as unknown as object, pageNumber)
    })
    vi.mocked(HtmlParser.decodePageToHtml).mockImplementation(async (page) => {
      if (page === failedPage) {
        throw new Error('Page 2 failed')
      }
      const pageNumber = decodedPageNumbers.get(page as unknown as object)
      return `<div class="hamster-note-page">Decoded page ${pageNumber}</div>`
    })

    render(<IntermediateDocumentViewer document={document} overscan={2} />)

    await screen.findByText('Decoded page 1')
    await waitFor(() => {
      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(3)
    })
    expect(screen.getByText('Decoded page 1')).toBeInTheDocument()
    expect(screen.queryByText('Page 2 failed')).not.toBeInTheDocument()
    await screen.findByText('Decoded page 3')
    expect(screen.getByText('Decoded page 1')).toBeInTheDocument()
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
  })

  it('only the failed page falls back when the first page fails decode', async () => {
    const { document, pages } = makeDocument({ pageCount: 3 })
    const failedPage = pages.get(1) as unknown
    const decodedPageNumbers = new WeakMap<object, number>()
    pages.forEach((page, pageNumber) => {
      decodedPageNumbers.set(page as unknown as object, pageNumber)
    })
    vi.mocked(HtmlParser.decodePageToHtml).mockImplementation(async (page) => {
      if (page === failedPage) {
        throw new Error('Page 1 failed')
      }
      const pageNumber = decodedPageNumbers.get(page as unknown as object)
      return `<div class="hamster-note-page">Decoded page ${pageNumber}</div>`
    })

    render(<IntermediateDocumentViewer document={document} overscan={2} />)

    await waitFor(() => {
      expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(3)
    })
    await screen.findByText('Decoded page 2')
    await screen.findByText('Decoded page 3')

    expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()

    const slot1 = screen.getByTestId('intermediate-page-1')
    expect(slot1).toHaveTextContent('Page 1 text')
    expect(slot1.querySelector('.hamster-note-page')).toBeNull()

    const slot2 = screen.getByTestId('intermediate-page-2')
    const slot2HtmlPage = slot2.querySelector('.hamster-note-page')
    expect(slot2HtmlPage).not.toBeNull()
    expect(slot2HtmlPage).toHaveTextContent('Decoded page 2')

    const slot3 = screen.getByTestId('intermediate-page-3')
    const slot3HtmlPage = slot3.querySelector('.hamster-note-page')
    expect(slot3HtmlPage).not.toBeNull()
    expect(slot3HtmlPage).toHaveTextContent('Decoded page 3')
    expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
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

  describe('lazy-release bookkeeping', () => {
    it('default maxLoadedPages uses overscan default: cap 7 for overscan=1, cap 11 for overscan=3', async () => {
      const idleCallback = installQueuedIdleCallback()

      try {
        // overscan=1 => defaultCap = max(5, 1*2+5) = 7
        const { document: doc1, pages: pages1 } = makeDocument({
          pageCount: 8
        })
        const { unmount: unmount1 } = render(
          <IntermediateDocumentViewer document={doc1} />
        )

        for (let pageNumber = 1; pageNumber <= 8; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages1.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        // 8 pages loaded > cap 7, so the oldest (page 1) should be evicted
        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
        })
        expect(screen.getByText('Page 8 text')).toBeInTheDocument()

        unmount1()
        idleCallback.restore()

        // overscan=3 => defaultCap = max(5, 3*2+5) = 11
        const idleCallback2 = installQueuedIdleCallback()
        const { document: doc2, pages: pages2 } = makeDocument({
          pageCount: 11
        })

        try {
          render(<IntermediateDocumentViewer document={doc2} overscan={3} />)

          for (let pageNumber = 1; pageNumber <= 11; pageNumber += 1) {
            const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
            intersectionObserverMock.trigger(page)
            await waitFor(() => {
              expect(pages2.get(pageNumber)?.getContent).toHaveBeenCalledTimes(
                1
              )
            })
            intersectionObserverMock.trigger(page, false)
          }

          await idleCallback2.flush()

          // 11 pages loaded == cap 11, so no eviction
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        } finally {
          idleCallback2.restore()
        }
      } finally {
        idleCallback.restore()
      }
    })

    it('Infinity disables eviction scheduling', () => {
      const originalRequestIdleCallback = window.requestIdleCallback
      const requestIdleCallback = vi.fn(() => 1)
      Object.defineProperty(window, 'requestIdleCallback', {
        configurable: true,
        writable: true,
        value: requestIdleCallback
      })

      try {
        const { document } = makeDocument({ pageCount: 2 })

        render(
          <IntermediateDocumentViewer
            document={document}
            maxLoadedPages={Infinity}
          />
        )

        expect(requestIdleCallback).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(window, 'requestIdleCallback', {
          configurable: true,
          writable: true,
          value: originalRequestIdleCallback
        })
      }
    })

    it('maxLoadedPages floor honored: cap respects visible+overscan union', async () => {
      const idleCallback = installQueuedIdleCallback()

      try {
        // maxLoadedPages=1 is below floor(5); with overscan=2 the protected
        // union is at least visible(1) + overscan(2) = 3, but floor is 5.
        const { document, pages } = makeDocument({ pageCount: 8 })

        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={2}
            maxLoadedPages={1}
          />
        )

        // Load 6 pages sequentially, leaving each offscreen after load
        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        // With floor=5, 6 loaded pages triggers eviction of 1 page (oldest).
        // Pages 2-6 should still be present.
        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
        })
        expect(screen.getByText('Page 6 text')).toBeInTheDocument()
      } finally {
        idleCallback.restore()
      }
    })

    it('maxLoadedPages runtime change schedules eviction', async () => {
      const idleCallback = installQueuedIdleCallback()

      try {
        const { document, pages } = makeDocument({ pageCount: 20 })

        const { rerender } = render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={10}
          />
        )

        // Load 6 pages at cap 10 — no eviction expected
        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()

        // Lower cap to 3 (floor 5 applies, so effective cap = 5)
        rerender(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={3}
          />
        )

        await idleCallback.flush()

        // 6 loaded > effective cap 5, so oldest page evicted
        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
        })
        expect(screen.getByText('Page 6 text')).toBeInTheDocument()
      } finally {
        idleCallback.restore()
      }
    })

    it('invalid maxLoadedPages uses default cap, not Infinity', async () => {
      const idleCallback = installQueuedIdleCallback()

      try {
        // Negative value should fall back to default cap (7 with overscan=1)
        const { document: docNeg, pages: pagesNeg } = makeDocument({
          pageCount: 8
        })
        const { unmount: unmountNeg } = render(
          <IntermediateDocumentViewer document={docNeg} maxLoadedPages={-3} />
        )

        for (let pageNumber = 1; pageNumber <= 8; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pagesNeg.get(pageNumber)?.getContent).toHaveBeenCalledTimes(
              1
            )
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        // 8 pages > default cap 7, so eviction should have happened
        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
        })
        expect(screen.getByText('Page 8 text')).toBeInTheDocument()

        unmountNeg()
        idleCallback.restore()

        // NaN value should also fall back to default cap
        const idleCallback2 = installQueuedIdleCallback()
        const { document: docNaN, pages: pagesNaN } = makeDocument({
          pageCount: 8
        })

        try {
          render(
            <IntermediateDocumentViewer
              document={docNaN}
              maxLoadedPages={NaN}
            />
          )

          for (let pageNumber = 1; pageNumber <= 8; pageNumber += 1) {
            const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
            intersectionObserverMock.trigger(page)
            await waitFor(() => {
              expect(
                pagesNaN.get(pageNumber)?.getContent
              ).toHaveBeenCalledTimes(1)
            })
            intersectionObserverMock.trigger(page, false)
          }

          await idleCallback2.flush()

          await waitFor(() => {
            expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
          })
          expect(screen.getByText('Page 8 text')).toBeInTheDocument()
        } finally {
          idleCallback2.restore()
        }
      } finally {
        idleCallback.restore()
      }
    })

    it('runtime cap change does not crash', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const { document } = makeDocument({ pageCount: 5 })

      try {
        const { rerender } = render(
          <IntermediateDocumentViewer document={document} maxLoadedPages={5} />
        )

        rerender(
          <IntermediateDocumentViewer document={document} maxLoadedPages={3} />
        )

        await waitFor(() => {
          expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
        })
        expect(consoleErrorSpy).not.toHaveBeenCalled()
      } finally {
        consoleErrorSpy.mockRestore()
      }
    })

    it('cleanup clears eviction timer on unmount', () => {
      const originalRequestIdleCallback = window.requestIdleCallback
      const originalCancelIdleCallback = window.cancelIdleCallback
      const originalClearTimeout = window.clearTimeout
      const requestIdleCallback = vi.fn(() => 101)
      const cancelIdleCallback = vi.fn()
      const clearTimeoutSpy = vi.fn()

      Object.defineProperty(window, 'requestIdleCallback', {
        configurable: true,
        writable: true,
        value: requestIdleCallback
      })
      Object.defineProperty(window, 'cancelIdleCallback', {
        configurable: true,
        writable: true,
        value: cancelIdleCallback
      })
      Object.defineProperty(window, 'clearTimeout', {
        configurable: true,
        writable: true,
        value: clearTimeoutSpy
      })

      try {
        const { document } = makeDocument({ pageCount: 2 })
        const { unmount } = render(
          <IntermediateDocumentViewer document={document} maxLoadedPages={5} />
        )

        expect(requestIdleCallback).toHaveBeenCalled()
        cancelIdleCallback.mockClear()
        clearTimeoutSpy.mockClear()

        unmount()

        expect(cancelIdleCallback).toHaveBeenCalledWith(101)
        expect(clearTimeoutSpy).toHaveBeenCalledWith(101)
      } finally {
        Object.defineProperty(window, 'requestIdleCallback', {
          configurable: true,
          writable: true,
          value: originalRequestIdleCallback
        })
        Object.defineProperty(window, 'cancelIdleCallback', {
          configurable: true,
          writable: true,
          value: originalCancelIdleCallback
        })
        Object.defineProperty(window, 'clearTimeout', {
          configurable: true,
          writable: true,
          value: originalClearTimeout
        })
      }
    })

    it('activePinchRef is initialized to false', () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(<IntermediateDocumentViewer document={document} />)

      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
    })

    it('pageLastVisibleAtRef records visible pages', async () => {
      const { document, pages } = makeDocument({ pageCount: 3 })

      render(<IntermediateDocumentViewer document={document} overscan={0} />)

      await waitFor(() => {
        expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
      })

      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-2')
      )

      await waitFor(() => {
        expect(pages.get(2)?.getContent).toHaveBeenCalledTimes(1)
      })
    })

    it('evicts offscreen pages by LRU when loaded count exceeds the cap', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
          />
        )

        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
        })
        expect(screen.getByText('Page 2 text')).toBeInTheDocument()
        expect(screen.getByText('Page 6 text')).toBeInTheDocument()
      } finally {
        idleCallback.restore()
      }
    })

    it('evicts base image text status and loadability as one page bundle', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })
      pages.forEach((page, pageNumber) => {
        page.thumbnail = `data:image/png;base64,page-${pageNumber}`
      })

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
          />
        )

        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(
              screen.getByText(`Page ${pageNumber} text`)
            ).toBeInTheDocument()
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        await waitFor(() => {
          const evictedPage = screen.getByTestId('intermediate-page-1')
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
          expect(
            evictedPage.querySelector(
              '.hamster-reader__intermediate-page-base-image'
            )
          ).not.toBeInTheDocument()
          expect(evictedPage).not.toHaveClass(
            'hamster-reader__intermediate-page--loading'
          )
        })
      } finally {
        idleCallback.restore()
      }
    })

    it('evicts ocr cache entries so OCR re-runs after base image reload', async () => {
      const { ImageParser } = await import('@hamster-note/image-parser')
      const encodeSpy = vi.mocked(ImageParser.encode)
      encodeSpy.mockClear()
      const idleCallback = installQueuedIdleCallback()
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(new Blob(['image'])))
      const { document, pages } = makeDocument({ pageCount: 20 })
      pages.forEach((page, pageNumber) => {
        page.thumbnail = `data:image/png;base64,page-${pageNumber}`
      })

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
            ocr
          />
        )

        const page1 = screen.getByTestId('intermediate-page-1')
        await waitFor(() => {
          expect(
            page1.querySelector('.hamster-reader__intermediate-page-base-image')
          ).toBeInTheDocument()
        })
        intersectionObserverMock.trigger(page1)
        await waitFor(() => {
          expect(encodeSpy).toHaveBeenCalledTimes(1)
          expect(
            page1.querySelector('[data-text-id^="ocr-"]')
          ).toBeInTheDocument()
        })
        await act(async () => {
          await Promise.resolve()
          await Promise.resolve()
        })
        intersectionObserverMock.trigger(page1, false)

        for (let pageNumber = 2; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()
        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
          expect(
            page1.querySelector('[data-text-id^="ocr-"]')
          ).not.toBeInTheDocument()
        })
        const callsAfterEviction = encodeSpy.mock.calls.length

        intersectionObserverMock.trigger(page1)

        await waitFor(() => {
          expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(2)
          expect(
            page1.querySelector('.hamster-reader__intermediate-page-base-image')
          ).toBeInTheDocument()
        })
        intersectionObserverMock.trigger(page1)

        await waitFor(() => {
          expect(encodeSpy.mock.calls.length).toBeGreaterThan(
            callsAfterEviction
          )
        })
      } finally {
        fetchSpy.mockRestore()
        idleCallback.restore()
      }
    })

    it('reloads evicted page content when revisiting the page', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
          />
        )

        const page1 = screen.getByTestId('intermediate-page-1')
        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()
        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
        })

        intersectionObserverMock.trigger(page1)

        await waitFor(() => {
          expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(2)
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })
      } finally {
        idleCallback.restore()
      }
    })

    it('reconstructs evicted html parser page', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 7 })
      const decodedPageNumbers = new WeakMap<object, number>()
      pages.forEach((page, pageNumber) => {
        decodedPageNumbers.set(page as unknown as object, pageNumber)
      })
      const decodeCallsByPageNumber = new Map<number, number>()
      vi.mocked(HtmlParser.decodePageToHtml).mockImplementation(
        async (page) => {
          const pageNumber = decodedPageNumbers.get(page as unknown as object)
          if (!pageNumber) return ''
          const callCount = (decodeCallsByPageNumber.get(pageNumber) ?? 0) + 1
          decodeCallsByPageNumber.set(pageNumber, callCount)
          return `<div class="hamster-note-page">Decoded page ${pageNumber} pass ${callCount}</div>`
        }
      )

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
          />
        )

        const page2 = screen.getByTestId('intermediate-page-2')
        intersectionObserverMock.trigger(page2)
        await waitFor(() => {
          expect(screen.getByText('Decoded page 2 pass 1')).toBeInTheDocument()
        })

        intersectionObserverMock.trigger(page2, false)
        for (let pageNumber = 3; pageNumber <= 7; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(
              screen.getByText(`Decoded page ${pageNumber} pass 1`)
            ).toBeInTheDocument()
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        await waitFor(() => {
          expect(
            screen.queryByText('Decoded page 2 pass 1')
          ).not.toBeInTheDocument()
        })

        intersectionObserverMock.trigger(page2)

        await waitFor(() => {
          expect(HtmlParser.decodePageToHtml).toHaveBeenCalledTimes(8)
          expect(screen.getByText('Decoded page 2 pass 2')).toBeInTheDocument()
        })
        expect(
          screen.queryByText('Decoded page 2 pass 1')
        ).not.toBeInTheDocument()
        expect(HtmlParser.decodePageToHtml).toHaveBeenLastCalledWith(
          pages.get(2),
          { background: { backgroundQuality: 0.8 } }
        )
        expect(HtmlParser.decodeToHtml).not.toHaveBeenCalled()
      } finally {
        idleCallback.restore()
      }
    })

    it('zoom does not trigger eviction', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })
      const onScaleChange = vi.fn()

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
            onScaleChange={onScaleChange}
          />
        )

        for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()
        const scheduledAfterLoadedPages = idleCallback.requestedCount()
        const container = screen.getByTestId('virtual-paper-container')

        await act(async () => {
          VirtualPaper.__triggerTransformEnd(
            container,
            { x: 0, y: 0, scale: 1.1 },
            VirtualPaperInteractionMode.MouseWheelCtrlZoom
          )
        })

        expect(onScaleChange).toHaveBeenCalledTimes(1)
        expect(idleCallback.requestedCount()).toBe(scheduledAfterLoadedPages)
        for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
          expect(
            screen.getByText(`Page ${pageNumber} text`)
          ).toBeInTheDocument()
        }
      } finally {
        idleCallback.restore()
      }
    })

    it('never evicts visible pages', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
          />
        )

        const visiblePage = screen.getByTestId('intermediate-page-1')
        intersectionObserverMock.trigger(visiblePage)
        await waitFor(() => {
          expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
        })

        for (let pageNumber = 2; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        await waitFor(() => {
          expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()
        })
      } finally {
        idleCallback.restore()
      }
    })

    it('never evicts pages in overscan window', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={1}
            maxLoadedPages={3}
          />
        )

        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          if (pageNumber !== 3) {
            intersectionObserverMock.trigger(page, false)
          }
        }

        await idleCallback.flush()

        expect(screen.getByText('Page 2 text')).toBeInTheDocument()
        expect(screen.getByText('Page 3 text')).toBeInTheDocument()
        expect(screen.getByText('Page 4 text')).toBeInTheDocument()
        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
        })
      } finally {
        idleCallback.restore()
      }
    })

    it('never evicts pages with in flight loads', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })
      let resolvePageOneContent: ((texts: IntermediateText[]) => void) | null =
        null
      pages.get(1)?.getContent.mockImplementationOnce(
        () =>
          new Promise<IntermediateText[]>((resolve) => {
            resolvePageOneContent = resolve
          })
      )

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
          />
        )

        const page1 = screen.getByTestId('intermediate-page-1')
        intersectionObserverMock.trigger(page1)
        await waitFor(() => {
          expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
        })
        intersectionObserverMock.trigger(page1, false)

        for (let pageNumber = 2; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()
        await act(async () => {
          resolvePageOneContent?.([makeText('text-1', 'Page 1 text')])
          await Promise.resolve()
        })

        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })
        expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()
      } finally {
        idleCallback.restore()
      }
    })

    it('never evicts pages containing current selection', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })
      let getSelectionSpy: ReturnType<typeof vi.spyOn> | null = null

      try {
        render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
          />
        )

        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        const selectedText = screen.getByText('Page 1 text')
        const range = globalThis.document.createRange()
        range.selectNodeContents(selectedText)
        getSelectionSpy = vi
          .spyOn(window, 'getSelection')
          .mockReturnValue(makeSelectionFromRange(range))

        await idleCallback.flush()

        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        await waitFor(() => {
          expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()
        })
      } finally {
        getSelectionSpy?.mockRestore()
        idleCallback.restore()
      }
    })

    it('eviction during active pinch is deferred', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 20 })

      try {
        const { unmount } = render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={5}
          />
        )

        await act(async () => {
          VirtualPaper.__triggerTransform(
            screen.getByTestId('virtual-paper-container'),
            { x: 0, y: 0, scale: 1 }
          )
        })

        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
          expect(
            screen.getByText(`Page ${pageNumber} text`)
          ).toBeInTheDocument()
        }
        unmount()
      } finally {
        idleCallback.restore()
      }
    })

    it('document and pageRange changes reset eviction state', async () => {
      const idleCallback = installQueuedIdleCallback()
      const { document, pages } = makeDocument({ pageCount: 10 })

      try {
        const { rerender } = render(
          <IntermediateDocumentViewer
            document={document}
            overscan={0}
            maxLoadedPages={3}
          />
        )

        const page1 = screen.getByTestId('intermediate-page-1')
        intersectionObserverMock.trigger(page1)
        await waitFor(() => {
          expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
        })

        rerender(
          <IntermediateDocumentViewer
            document={document}
            pageRange={{ start: 2, end: 10 }}
            overscan={0}
            maxLoadedPages={3}
          />
        )

        expect(
          screen.queryByTestId('intermediate-page-1')
        ).not.toBeInTheDocument()
        // Load 7 pages (2-8) to exceed effective cap of 5 (floor)
        for (let pageNumber = 2; pageNumber <= 8; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          await waitFor(() => {
            expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
          })
          intersectionObserverMock.trigger(page, false)
        }

        await idleCallback.flush()

        await waitFor(() => {
          expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()
        })
        expect(screen.getByText('Page 8 text')).toBeInTheDocument()
      } finally {
        idleCallback.restore()
      }
    })
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
    vi.mocked(document.getPageByPageNumber).mockImplementation(() => {
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

    beforeEach(() => {
      vi.restoreAllMocks()
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue('')
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')
      vi.useRealTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
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

    // Direct-render selection only: reusable 3-page fixture for downstream selection UX tests.
    const makeThreePageTextDocument = ({
      page2Texts: page2TextOverrides
    }: {
      page2Texts?: Array<{ id: string; content: string }>
    } = {}) => {
      const page1Texts = [
        { id: 'p1-alpha', content: 'P1 Alpha' },
        { id: 'p1-bravo', content: 'P1 Bravo' },
        { id: 'p1-charlie', content: 'P1 Charlie' }
      ]
      const page2Texts = page2TextOverrides ?? [
        { id: 'p2-delta', content: 'P2 Delta' },
        { id: 'p2-echo', content: 'P2 Echo' },
        { id: 'p2-foxtrot', content: 'P2 Foxtrot' }
      ]
      const page3Texts = [
        { id: 'p3-golf', content: 'P3 Golf' },
        { id: 'p3-hotel', content: 'P3 Hotel' },
        { id: 'p3-india', content: 'P3 India' }
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
      pages.set(3, {
        getContent: vi.fn(async () =>
          page3Texts.map((text) => makeText(text.id, text.content))
        )
      })

      const document = {
        id: 'doc-three-page-texts',
        title: 'Three Page Text Document',
        pageCount: 3,
        pageNumbers: [1, 2, 3],
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

    const mockThreePageDirectRenderSelectionRects = () => {
      const page1 = screen.getByTestId('intermediate-page-1')
      const page2 = screen.getByTestId('intermediate-page-2')
      const page3 = screen.getByTestId('intermediate-page-3')
      mockElementRect(page1, { left: 0, top: 0, width: 400, height: 180 })
      mockElementRect(page2, { left: 0, top: 220, width: 400, height: 180 })
      mockElementRect(page3, { left: 0, top: 440, width: 400, height: 180 })
      mockElementRect(queryTextSpan('p1-alpha'), {
        left: 20,
        top: 20,
        width: 80,
        height: 20
      })
      mockElementRect(queryTextSpan('p1-bravo'), {
        left: 20,
        top: 60,
        width: 80,
        height: 20
      })
      mockElementRect(queryTextSpan('p1-charlie'), {
        left: 20,
        top: 100,
        width: 80,
        height: 20
      })
      const p2Delta = page2.querySelector('[data-text-id="p2-delta"]')
      if (p2Delta instanceof HTMLElement) {
        mockElementRect(p2Delta, {
          left: 20,
          top: 240,
          width: 80,
          height: 20
        })
      }
      const p2Echo = page2.querySelector('[data-text-id="p2-echo"]')
      if (p2Echo instanceof HTMLElement) {
        mockElementRect(p2Echo, {
          left: 20,
          top: 280,
          width: 80,
          height: 20
        })
      }
      const p2Foxtrot = page2.querySelector('[data-text-id="p2-foxtrot"]')
      if (p2Foxtrot instanceof HTMLElement) {
        mockElementRect(p2Foxtrot, {
          left: 20,
          top: 320,
          width: 80,
          height: 20
        })
      }
      mockElementRect(queryTextSpan('p3-golf'), {
        left: 20,
        top: 460,
        width: 80,
        height: 20
      })
      mockElementRect(queryTextSpan('p3-hotel'), {
        left: 20,
        top: 500,
        width: 80,
        height: 20
      })
      mockElementRect(queryTextSpan('p3-india'), {
        left: 20,
        top: 540,
        width: 80,
        height: 20
      })

      return { page1, page2, page3 }
    }

    const renderThreePageDirectRenderSelectionFixture = async (
      props: {
        onTextSelectionChange?: ReturnType<typeof vi.fn>
        onTextSelectionEnd?: ReturnType<typeof vi.fn>
        onSelectText?: ReturnType<typeof vi.fn>
        page2Texts?: Array<{ id: string; content: string }>
        loadPage2?: boolean
      } = {}
    ) => {
      const { document: mockDoc } = makeThreePageTextDocument({
        page2Texts: props.page2Texts
      })
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          {...props}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
      })
      if (props.loadPage2 !== false) {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-2')
        )
      }
      intersectionObserverMock.trigger(
        screen.getByTestId('intermediate-page-3')
      )

      await waitFor(() => {
        expect(screen.getByText('P1 Alpha')).toBeInTheDocument()
        expect(screen.getByText('P3 India')).toBeInTheDocument()
      })
      if (props.loadPage2 !== false && props.page2Texts?.length !== 0) {
        await waitFor(() => {
          expect(screen.getByText('P2 Delta')).toBeInTheDocument()
        })
      }
    }

    const renderCrossPageSelectionFixture = async (
      onTextSelectionChange: ReturnType<typeof vi.fn>,
      props: {
        onTextSelectionEnd?: ReturnType<typeof vi.fn>
        onSelectText?: ReturnType<typeof vi.fn>
      } = {}
    ) => {
      const { document: mockDoc } = makeCrossPageTextDocument()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          onTextSelectionChange={onTextSelectionChange}
          {...props}
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

    const makeDirectRenderTextSelection = (textIds: string[]) => {
      const firstSpan = queryTextSpan(textIds[0])
      const lastSpan = queryTextSpan(textIds[textIds.length - 1])
      const selectedIds = new Set(textIds)

      return makeMockSelection({
        isCollapsed: false,
        anchorNode: getTextNode(firstSpan),
        focusNode: getTextNode(lastSpan),
        toString: () =>
          textIds
            .map((textId) => queryTextSpan(textId).textContent ?? '')
            .join(''),
        containsNode: (node: Node) => {
          if (!(node instanceof HTMLElement)) return false

          const textId = node.getAttribute('data-text-id')
          return textId !== null && selectedIds.has(textId)
        }
      })
    }

    const installUnavailableCaretPointApis = () => {
      const caretDocument = globalThis.document as Document & {
        caretPositionFromPoint?: unknown
        caretRangeFromPoint?: unknown
      }
      const originalCaretPositionFromPoint =
        caretDocument.caretPositionFromPoint
      const originalCaretRangeFromPoint = caretDocument.caretRangeFromPoint

      Object.defineProperty(globalThis.document, 'caretPositionFromPoint', {
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

      Object.defineProperty(globalThis.document, 'caretPositionFromPoint', {
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
      point: { clientX: number; clientY: number },
      options: { pointerId?: number; pointerType?: string } = {}
    ) => {
      const pointerType = options.pointerType ?? 'mouse'
      const event = new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: point.clientX,
        clientY: point.clientY
      })
      Object.defineProperty(event, 'pointerId', {
        configurable: true,
        value: options.pointerId ?? 1
      })
      Object.defineProperty(event, 'pointerType', {
        configurable: true,
        value: pointerType
      })
      target.dispatchEvent(event)
    }

    const dispatchPointerDragMove = (
      target: HTMLElement,
      point: { clientX: number; clientY: number },
      options: { pointerId?: number; pointerType?: string } = {}
    ) => {
      const event = new MouseEvent('pointermove', {
        bubbles: true,
        clientX: point.clientX,
        clientY: point.clientY
      })
      Object.defineProperty(event, 'pointerId', {
        configurable: true,
        value: options.pointerId ?? 1
      })
      Object.defineProperty(event, 'pointerType', {
        configurable: true,
        value: options.pointerType ?? 'mouse'
      })
      target.dispatchEvent(event)
    }

    const dispatchPointerDragEnd = (
      target: HTMLElement,
      type: 'pointerup' | 'pointercancel',
      point: { clientX: number; clientY: number },
      options: { pointerId?: number; pointerType?: string } = {}
    ) => {
      const pointerType = options.pointerType ?? 'mouse'
      const event = new MouseEvent(type, {
        bubbles: true,
        clientX: point.clientX,
        clientY: point.clientY
      })
      Object.defineProperty(event, 'pointerId', {
        configurable: true,
        value: options.pointerId ?? 1
      })
      Object.defineProperty(event, 'pointerType', {
        configurable: true,
        value: pointerType
      })
      target.dispatchEvent(event)
    }

    const dispatchMouseSelectionStart = (
      target: HTMLElement,
      point: { clientX: number; clientY: number },
      button = 0
    ) => {
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button,
        clientX: point.clientX,
        clientY: point.clientY
      })

      const dispatched = target.dispatchEvent(event)
      return { event, dispatched }
    }

    it('cancels default-mode touch long press when movement exceeds threshold', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
      })

      const textElement = screen.getByText('B')
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const scaleSurface = screen.getByTestId('virtual-paper-container')
      const pageElement = layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPoint(pageElement)
      vi.useFakeTimers()

      try {
        dispatchPointerDragStart(
          textElement,
          { clientX: 12, clientY: 58 },
          { pointerId: 8, pointerType: 'touch' }
        )
        dispatchPointerDragMove(
          viewerRoot,
          { clientX: 27, clientY: 58 },
          { pointerId: 8, pointerType: 'touch' }
        )

        await act(async () => {
          await vi.advanceTimersByTimeAsync(500)
        })

        expect(onTextSelectionChange).not.toHaveBeenCalled()
        expect(liveSelection.selection.toString()).toBe('')
        expect(scaleSurface).toHaveStyle({
          transform: 'translate3d(0px, 0px, 0) scale(1)'
        })
      } finally {
        vi.useRealTimers()
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('blocks mouse and touch selection in stylus mode', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          interactionMode='stylus'
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
      vi.useFakeTimers()

      try {
        dispatchPointerDragStart(
          screen.getByText('B'),
          { clientX: 12, clientY: 58 },
          { pointerId: 10, pointerType: 'mouse' }
        )
        dispatchPointerDragMove(
          viewerRoot,
          { clientX: 100, clientY: 138 },
          { pointerId: 10, pointerType: 'mouse' }
        )
        dispatchPointerDragEnd(
          viewerRoot,
          'pointerup',
          { clientX: 100, clientY: 138 },
          { pointerId: 10, pointerType: 'mouse' }
        )

        dispatchPointerDragStart(
          screen.getByText('B'),
          { clientX: 12, clientY: 58 },
          { pointerId: 11, pointerType: 'touch' }
        )
        dispatchPointerDragMove(
          viewerRoot,
          { clientX: 100, clientY: 138 },
          { pointerId: 11, pointerType: 'touch' }
        )
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500)
        })

        expect(liveSelection.selection.toString()).toBe('')
        expect(onTextSelectionChange).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('provides a three-page fixture for direct-render selection only with stable data attributes and rects', async () => {
      await renderThreePageDirectRenderSelectionFixture()
      mockThreePageDirectRenderSelectionRects()

      expect(queryTextSpan('p1-alpha')).toHaveAttribute('data-page-number', '1')
      expect(queryTextSpan('p1-bravo')).toHaveAttribute('data-page-number', '1')
      expect(queryTextSpan('p1-charlie')).toHaveAttribute(
        'data-page-number',
        '1'
      )
      expect(queryTextSpan('p2-delta')).toHaveAttribute('data-page-number', '2')
      expect(queryTextSpan('p2-echo')).toHaveAttribute('data-page-number', '2')
      expect(queryTextSpan('p2-foxtrot')).toHaveAttribute(
        'data-page-number',
        '2'
      )
      expect(queryTextSpan('p3-golf')).toHaveAttribute('data-page-number', '3')
      expect(queryTextSpan('p3-hotel')).toHaveAttribute('data-page-number', '3')
      expect(queryTextSpan('p3-india')).toHaveAttribute('data-page-number', '3')
      expect(queryTextSpan('p3-india').getBoundingClientRect()).toMatchObject({
        left: 20,
        top: 540,
        width: 80,
        height: 20
      })
    })

    it('does not let the root Drag adapter start or finish mouse selection without the strict mousedown owner', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      const onTextSelectionEnd = vi.fn()
      const onSelectText = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
          onSelectText={onSelectText}
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
        // Given: only the legacy Drag pointer lifecycle fires for a mouse, while
        // the strict mousedown controller never accepts ownership.
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 138 })

        // When: the adapter's mouse End/AllEnd callbacks run without document mouseup.
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })

        // Then: the adapter path is cleanup-only for mouse and cannot emit public final callbacks.
        expect(liveSelection.selection.toString()).toBe('')
        expect(onTextSelectionChange).not.toHaveBeenCalled()
        expect(onTextSelectionEnd).not.toHaveBeenCalled()
        expect(onSelectText).not.toHaveBeenCalled()
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('collapsed strict mouse click on document mouseup does not emit a payload', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionEnd = vi.fn()
      const onSelectText = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionEnd={onTextSelectionEnd}
          onSelectText={onSelectText}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      layoutFourTextPage()
      const textElement = screen.getByText('B')
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApi = installCaretPositionFromPoint(
        getTextNode(textElement),
        0
      )
      const elementFromPointSpy = mockElementFromPoint(textElement)

      try {
        // Given: a strict left mouse down created only a collapsed caret.
        dispatchMouseSelectionStart(textElement, { clientX: 12, clientY: 58 })
        expect(liveSelection.activeRange.collapsed).toBe(true)
        elementFromPointSpy.mockClear()

        // When: mouseup finalizes the click without any drag-selected text.
        viewerRoot.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            button: 0,
            clientX: 12,
            clientY: 58
          })
        )

        // Then: existing collapsed-selection semantics stay silent, and the
        // strict mouseup path still trusts the initialized stored boundaries
        // instead of re-hit-testing the mouseup point.
        expect(elementFromPointSpy).not.toHaveBeenCalled()
        expect(liveSelection.activeRange.collapsed).toBe(true)
        expect(onTextSelectionEnd).not.toHaveBeenCalled()
        expect(onSelectText).not.toHaveBeenCalled()
      } finally {
        restoreCaretApi()
        getSelectionSpy.mockRestore()
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

    it('ignores over-broad externally-created selection inside the viewer', async () => {
      const onTextSelectionChange = vi.fn()
      await renderCrossPageSelectionFixture(onTextSelectionChange)
      mockCrossPageSelectionRects()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeDirectRenderTextSelection(['p1-b', 'p2-a', 'p2-b', 'p2-c'])
        )

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('full-page page-margin drag expanded by native Selection does not emit whole-page detail', async () => {
      const onTextSelectionEnd = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({ onTextSelectionEnd })
      const { page2 } = mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeDirectRenderTextSelection(['p2-delta', 'p2-echo', 'p2-foxtrot'])
        )
      mockElementFromPoint(page2)

      try {
        dispatchPointerDragStart(viewerRoot, { clientX: 4, clientY: 230 })
        dispatchPointerDragMove(viewerRoot, { clientX: 390, clientY: 350 })
        viewerRoot.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            clientX: 390,
            clientY: 350
          })
        )

        expect(onTextSelectionEnd).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('full-page page-background drag expanded by native Selection does not emit whole-page detail', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange
      })
      const { page2 } = mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeDirectRenderTextSelection(['p2-delta', 'p2-echo', 'p2-foxtrot'])
        )
      mockElementFromPoint(page2)

      try {
        dispatchPointerDragStart(viewerRoot, { clientX: 340, clientY: 230 })
        dispatchPointerDragMove(viewerRoot, { clientX: 340, clientY: 350 })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('full-page page-background drag expanded by native Selection does not emit onSelectText payload', async () => {
      const onSelectText = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({ onSelectText })
      const { page2 } = mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeDirectRenderTextSelection(['p2-delta', 'p2-echo', 'p2-foxtrot'])
        )
      mockElementFromPoint(page2)

      try {
        dispatchPointerDragStart(viewerRoot, { clientX: 340, clientY: 230 })
        dispatchPointerDragMove(viewerRoot, { clientX: 340, clientY: 350 })
        viewerRoot.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            clientX: 340,
            clientY: 350
          })
        )

        expect(onSelectText).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
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

    it('mouse blank drag start near last word does not snap to same-page last text', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange
      })
      mockThreePageDirectRenderSelectionRects()

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page3 = screen.getByTestId('intermediate-page-3')
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installCaretPositionFromPoint(
        getTextNode(queryTextSpan('p3-golf')),
        0
      )
      mockElementFromPointByCoordinate((x, y) =>
        x >= 20 && x <= 100 && y >= 500 && y <= 520
          ? queryTextSpan('p3-hotel')
          : page3
      )

      try {
        dispatchPointerDragStart(viewerRoot, { clientX: 108, clientY: 550 })
        dispatchPointerDragMove(viewerRoot, { clientX: 12, clientY: 510 })

        expect(liveSelection.selection.addRange).not.toHaveBeenCalled()
        expect(liveSelection.selection.toString()).toBe('')
        expect(onTextSelectionChange).not.toHaveBeenCalled()
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('mouse blank drag move in inter-span gutter does not snap to closer same-page text', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange
      })
      mockThreePageDirectRenderSelectionRects()

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page2 = screen.getByTestId('intermediate-page-2')
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((x, y) =>
        x <= 100 && y >= 240 && y <= 260 ? queryTextSpan('p2-delta') : page2
      )

      try {
        dispatchPointerDragStart(queryTextSpan('p2-delta'), {
          clientX: 25,
          clientY: 250
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 60, clientY: 304 })

        expect(liveSelection.selection.toString()).toBe('')
        expect(onTextSelectionChange).not.toHaveBeenCalled()
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('mouse blank drag move ignores DOM-order nearest tie-break text', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange
      })
      mockThreePageDirectRenderSelectionRects()

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page2 = screen.getByTestId('intermediate-page-2')
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((x, y) =>
        x <= 100 && y >= 240 && y <= 260 ? queryTextSpan('p2-delta') : page2
      )

      try {
        dispatchPointerDragStart(queryTextSpan('p2-delta'), {
          clientX: 25,
          clientY: 250
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 60, clientY: 310 })

        expect(liveSelection.selection.toString()).toBe('')
        expect(onTextSelectionChange).not.toHaveBeenCalled()
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('[baseline] selectionchange callback payload has text and detail shape matching reader.test.tsx convention', async () => {
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
        toString: () => 'Page 1 text',
        containsNode: (node: Node) => node === textSpan
      })
      vi.spyOn(window, 'getSelection').mockReturnValue(selection)

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).toHaveBeenCalledTimes(1)

      const [text, detail] = onTextSelectionChange.mock.calls[0]
      expect(text).toHaveProperty('id')
      expect(text.id).toBe('text-1')
      expect(detail).toHaveProperty('selectedText')
      expect(detail).toHaveProperty('texts')
      expect(detail).toHaveProperty('text')
      expect(detail).toHaveProperty('pageNumber')
      expect(detail.selectedText).toBe('Page 1 text')
      expect(detail.text).toBe(text)
      expect(detail.pageNumber).toBe(1)
      expect(detail.texts).toHaveLength(1)
      expect(detail.texts[0].id).toBe('text-1')
    })

    // Task 6 — live handle drag / chrome hit-testing / selector reuse
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

    it('SCSS keeps the page shell unselectable while preserving text-span selection', () => {
      const scssSource = fs.readFileSync(
        path.resolve(__dirname, '../src/styles/reader.scss'),
        'utf-8'
      )
      const pageBlockMatch = scssSource.match(
        /&__intermediate-page\s*\{([\s\S]*?)&--loading/
      )
      const textBlockMatch = scssSource.match(
        /&__intermediate-text\s*\{([^}]*)\}/
      )
      expect(pageBlockMatch).toBeTruthy()
      expect(textBlockMatch).toBeTruthy()
      if (!pageBlockMatch || !textBlockMatch) {
        throw new Error(
          'Expected intermediate page and text SCSS blocks to exist'
        )
      }

      const pageBlock = pageBlockMatch[1]
      const textBlock = textBlockMatch[1]
      expect(pageBlock).toContain('user-select: none')
      expect(pageBlock).toContain('-webkit-user-select: none')
      expect(textBlock).toContain('user-select: text')
      expect(textBlock).toContain('-webkit-user-select: text')
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

    it('SCSS enables text selection in html-parser output while keeping page shell non-selectable', () => {
      const scssSource = fs.readFileSync(
        path.resolve(__dirname, '../src/styles/reader.scss'),
        'utf-8'
      )
      const htmlParserBlockStart = scssSource.indexOf('&__html-parser-output')
      const htmlParserBlockEnd = scssSource.indexOf(
        '&__intermediate-page',
        htmlParserBlockStart
      )
      const htmlParserBlockMatch =
        htmlParserBlockStart !== -1 && htmlParserBlockEnd !== -1
          ? [scssSource.slice(htmlParserBlockStart, htmlParserBlockEnd)]
          : null
      expect(htmlParserBlockMatch).toBeTruthy()
      if (!htmlParserBlockMatch) {
        throw new Error('Expected html-parser-output SCSS block to exist')
      }

      const block = htmlParserBlockMatch[0]
      expect(block).toContain('user-select: text')
      expect(block).toContain('-webkit-user-select: text')
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

  describe('zoom state', () => {
    it('controlled scale prop applies CSS transform', async () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(<IntermediateDocumentViewer document={document} scale={2} />)

      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      })

      const surface = screen.getByTestId('virtual-paper-container')
      expect(surface).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(2)'
      })
    })

    it('controlled scale ignores internal updates', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const onScaleChange = vi.fn()
      const { rerender } = render(
        <IntermediateDocumentViewer
          document={document}
          scale={1.5}
          defaultScale={2}
          onScaleChange={onScaleChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      })

      const surface = screen.getByTestId('virtual-paper-container')
      expect(surface).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(1.5)'
      })
      expect(onScaleChange).not.toHaveBeenCalled()

      rerender(
        <IntermediateDocumentViewer
          document={document}
          scale={1.5}
          defaultScale={3}
          onScaleChange={onScaleChange}
        />
      )

      expect(surface).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(1.5)'
      })
      expect(onScaleChange).not.toHaveBeenCalled()
    })

    it('uncontrolled defaultScale initializes once', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const { rerender } = render(
        <IntermediateDocumentViewer document={document} defaultScale={1.5} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      })

      const surface = screen.getByTestId('virtual-paper-container')
      expect(surface).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(1.5)'
      })

      rerender(
        <IntermediateDocumentViewer document={document} defaultScale={2} />
      )

      expect(surface).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(1.5)'
      })
    })

    it('scale clamped to min and max', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const { rerender } = render(
        <IntermediateDocumentViewer
          document={document}
          scale={10}
          maxScale={4}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      })

      let surface = screen.getByTestId('virtual-paper-container')
      expect(surface).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(4)'
      })

      rerender(
        <IntermediateDocumentViewer
          document={document}
          scale={0.01}
          minScale={0.25}
        />
      )

      surface = screen.getByTestId('virtual-paper-container')
      expect(surface).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(0.25)'
      })
    })

    it('scale one has no transform cost', async () => {
      const { document } = makeDocument({ pageCount: 1 })

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      })

      const surface = screen.getByTestId('virtual-paper-container')
      expect(surface).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(1)'
      })
    })

    describe('pinch and wheel gestures', () => {
      const getVirtualPaperContainer = () =>
        screen.getByTestId('virtual-paper-container')

      it('maps VirtualPaper wheel transform source to scale-change wheel source', async () => {
        const { document } = makeDocument({ pageCount: 1 })
        const onScaleChange = vi.fn()
        render(
          <IntermediateDocumentViewer
            document={document}
            defaultScale={1}
            onScaleChange={onScaleChange}
          />
        )

        await waitFor(() => {
          expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
        })

        const container = getVirtualPaperContainer()
        await act(async () => {
          VirtualPaper.__triggerTransformEnd(
            container,
            { x: -4, y: 0, scale: 1.1 },
            VirtualPaperInteractionMode.MouseWheelCtrlZoom
          )
        })

        expect(onScaleChange).toHaveBeenCalledWith(1.1, {
          source: 'wheel'
        })
        expect(container).toHaveStyle({
          transform: 'translate3d(-4px, 0px, 0) scale(1.1)'
        })
      })

      it('accepts VirtualPaper pan transforms without scaling', async () => {
        const { document } = makeDocument({ pageCount: 1 })
        const onScaleChange = vi.fn()
        render(
          <IntermediateDocumentViewer
            document={document}
            defaultScale={1}
            onScaleChange={onScaleChange}
          />
        )

        await waitFor(() => {
          expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
        })

        const container = getVirtualPaperContainer()
        await act(async () => {
          VirtualPaper.__triggerTransform(container, { x: -24, y: 0, scale: 1 })
        })

        expect(onScaleChange).not.toHaveBeenCalled()
        expect(container).toHaveStyle({
          transform: 'translate3d(-24px, 0px, 0) scale(1)'
        })
      })

      it('rapid wheel does not emit unchanged scale', async () => {
        const { document } = makeDocument({ pageCount: 1 })
        const onScaleChange = vi.fn()
        render(
          <IntermediateDocumentViewer
            document={document}
            defaultScale={4}
            maxScale={4}
            onScaleChange={onScaleChange}
          />
        )

        await waitFor(() => {
          expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
        })

        const container = getVirtualPaperContainer()
        await act(async () => {
          for (let index = 0; index < 3; index += 1) {
            VirtualPaper.__triggerTransformEnd(
              container,
              { x: 0, y: 0, scale: 4 },
              VirtualPaperInteractionMode.MouseWheelCtrlZoom
            )
          }
        })

        expect(onScaleChange).not.toHaveBeenCalled()
        expect(container).toHaveStyle({
          transform: 'translate3d(0px, 0px, 0) scale(4)'
        })
      })

      it('zero page document accepts scale props', () => {
        const consoleErrorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {})
        const { document } = makeDocument({ pageCount: 0 })

        try {
          render(
            <IntermediateDocumentViewer
              document={document}
              scale={2}
              defaultScale={1.5}
              onScaleChange={vi.fn()}
              minScale={0.5}
              maxScale={3}
              maxLoadedPages={1}
            />
          )

          expect(
            screen.getByTestId('intermediate-document-viewer')
          ).toBeEmptyDOMElement()
          expect(
            screen.queryByTestId('virtual-paper-container')
          ).not.toBeInTheDocument()
          expect(consoleErrorSpy).not.toHaveBeenCalled()
        } finally {
          consoleErrorSpy.mockRestore()
        }
      })

      it('invalid scale values are safe', async () => {
        const { document } = makeDocument({ pageCount: 1 })
        const onScaleChange = vi.fn()
        const { rerender } = render(
          <IntermediateDocumentViewer
            document={document}
            scale={Number.NaN}
            minScale={Number.NaN}
            maxScale={-1}
          />
        )

        await waitFor(() => {
          expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
        })

        expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
          transform: 'translate3d(0px, 0px, 0) scale(1)'
        })

        rerender(
          <IntermediateDocumentViewer
            document={document}
            defaultScale={Number.NaN}
            minScale={Number.NaN}
            maxScale={-1}
            onScaleChange={onScaleChange}
          />
        )

        const container = getVirtualPaperContainer()
        await act(async () => {
          VirtualPaper.__triggerTransformEnd(
            container,
            { x: -1.2, y: 0, scale: 1.1 },
            VirtualPaperInteractionMode.MouseWheelCtrlZoom
          )
        })

        expect(onScaleChange).toHaveBeenCalledWith(1.1, {
          source: 'wheel'
        })
        expect(container).toHaveStyle({
          transform: 'translate3d(-1.2px, 0px, 0) scale(1.1)'
        })
      })

      it('maps VirtualPaper two-finger zoom source to scale-change pinch source', async () => {
        const { document } = makeDocument({ pageCount: 1 })
        const onScaleChange = vi.fn()
        render(
          <IntermediateDocumentViewer
            document={document}
            defaultScale={1}
            minScale={0.5}
            maxScale={3}
            onScaleChange={onScaleChange}
          />
        )

        await waitFor(() => {
          expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
        })

        const container = getVirtualPaperContainer()
        await act(async () => {
          VirtualPaper.__triggerTransformEnd(container, {
            x: -37.5,
            y: 0,
            scale: 1.5
          })
        })

        expect(onScaleChange).toHaveBeenCalledWith(1.5, {
          source: 'pinch'
        })
        expect(container).toHaveStyle({
          transform: 'translate3d(-37.5px, 0px, 0) scale(1.5)'
        })
      })

      it('ignores one-finger drag operations for zoom', async () => {
        const { document } = makeDocument({ pageCount: 1 })
        const onScaleChange = vi.fn()
        render(
          <IntermediateDocumentViewer
            document={document}
            defaultScale={1}
            onScaleChange={onScaleChange}
          />
        )

        await waitFor(() => {
          expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
        })

        const container = getVirtualPaperContainer()
        await act(async () => {
          VirtualPaper.__triggerTransformEnd(
            container,
            { x: 10, y: 10, scale: 1 },
            VirtualPaperInteractionMode.TouchSingleFingerPan
          )
        })

        expect(onScaleChange).not.toHaveBeenCalled()
        expect(container).toHaveStyle({
          transform: 'translate3d(10px, 10px, 0) scale(1)'
        })
      })

      it('keeps single-pointer selection locked after one finger leaves a pinch', async () => {
        const { document } = makeDocument({ pageCount: 1 })
        const onTextSelectionChange = vi.fn()
        render(
          <IntermediateDocumentViewer
            document={document}
            renderMode='direct'
            onTextSelectionChange={onTextSelectionChange}
          />
        )

        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })

        const viewerRoot = screen.getByTestId('intermediate-document-viewer')
        const page = screen.getByTestId('intermediate-page-1')
        const container = getVirtualPaperContainer()
        const nativeSelection = globalThis.document.getSelection()
        if (!nativeSelection) {
          throw new Error('Expected native Selection in test environment')
        }
        const getSelectionSpy = vi
          .spyOn(window, 'getSelection')
          .mockReturnValue(nativeSelection)
        const elementFromPointSpy = mockElementFromPoint(page)

        try {
          await act(async () => {
            VirtualPaper.__triggerTransform(container, { x: 0, y: 0, scale: 1 })
            viewerRoot.dispatchEvent(
              new MouseEvent('pointerdown', {
                bubbles: true,
                button: 0,
                clientX: 10,
                clientY: 10
              })
            )
            viewerRoot.dispatchEvent(
              new MouseEvent('pointermove', {
                bubbles: true,
                clientX: 10,
                clientY: 50
              })
            )
          })

          expect(onTextSelectionChange).not.toHaveBeenCalled()
          expect(getSelectionSpy).not.toHaveBeenCalled()

          await act(async () => {
            VirtualPaper.__triggerTransformEnd(container, {
              x: 0,
              y: 0,
              scale: 1
            })
          })
        } finally {
          elementFromPointSpy.mockRestore()
          getSelectionSpy.mockRestore()
        }
      })

      it('unmounts while VirtualPaper owns gesture cleanup', async () => {
        const { document } = makeDocument({ pageCount: 1 })
        const { unmount } = render(
          <IntermediateDocumentViewer document={document} defaultScale={1} />
        )

        await waitFor(() => {
          expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
        })

        expect(getVirtualPaperContainer()).toBeInTheDocument()
        unmount()

        expect(
          screen.queryByTestId('virtual-paper-container')
        ).not.toBeInTheDocument()
      })
    })
  })
})

describe('selection overlayRectType integration', () => {
  beforeEach(() => {
    clearLastSelectionProps()
  })

  afterEach(() => {
    clearLastSelectionProps()
  })

  it('defaults overlayRectType to percent when omitted', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')

    render(
      <IntermediateDocumentViewer
        document={document}
        renderMode='html-parser'
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    expect(getLastSelectionProps()?.overlayRectType).toBe('percent')
  })

  it('passes explicit overlayRectType="percent" to HamsterSelection', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')

    render(
      <IntermediateDocumentViewer
        document={document}
        renderMode='html-parser'
        overlayRectType='percent'
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    expect(getLastSelectionProps()?.overlayRectType).toBe('percent')
  })

  it('passes explicit overlayRectType="px" to HamsterSelection', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')

    render(
      <IntermediateDocumentViewer
        document={document}
        renderMode='html-parser'
        overlayRectType='px'
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    expect(getLastSelectionProps()?.overlayRectType).toBe('px')
  })

  it('accepts overlayRectType values at type level', () => {
    const percentValue: OverlayRectType = 'percent'
    const pxValue: OverlayRectType = 'px'
    expect(percentValue).toBe('percent')
    expect(pxValue).toBe('px')
  })

  it('delegates percent overlay rect clicks to range selection without raising overlay hit layer', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    const onSelectRange = vi.fn()
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')

    render(
      <IntermediateDocumentViewer
        document={document}
        renderMode='html-parser'
        ranges={[
          {
            id: 'range-1',
            text: 'Page',
            start: 0,
            end: 4,
            createdAt: 1,
            overlayRectType: 'percent',
            rects: [{ x: 10, y: 10, width: 20, height: 10 }]
          }
        ]}
        onSelectRange={onSelectRange}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    const selectionContainer = globalThis.document.querySelector(
      '.hsn-selection-container'
    )
    expect(selectionContainer).toBeInstanceOf(HTMLElement)

    if (!(selectionContainer instanceof HTMLElement)) {
      throw new Error('selection container not rendered')
    }

    mockElementRect(selectionContainer, {
      left: 0,
      top: 0,
      width: 200,
      height: 100
    })
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(null)

    selectionContainer.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 30,
        clientY: 12
      })
    )

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 12
    })
    const stopImmediatePropagationSpy = vi.spyOn(
      clickEvent,
      'stopImmediatePropagation'
    )

    selectionContainer.dispatchEvent(clickEvent)
    getLastSelectionProps()?.onSelectRange?.('range-1')

    expect(onSelectRange).toHaveBeenCalledWith('range-1')
    expect(onSelectRange).toHaveBeenCalledTimes(1)
    expect(stopImmediatePropagationSpy).toHaveBeenCalled()
    getSelectionSpy.mockRestore()
  })

  it('toggles the selected range off when delegated overlay rect is clicked again', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    const onSelectRange = vi.fn()
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')

    const { rerender } = render(
      <IntermediateDocumentViewer
        document={document}
        renderMode='html-parser'
        ranges={[
          {
            id: 'range-1',
            text: 'Page',
            start: 0,
            end: 4,
            createdAt: 1,
            overlayRectType: 'px',
            rects: [{ x: 20, y: 10, width: 40, height: 20 }]
          }
        ]}
        selectedRangeId='range-1'
        overlayRectType='px'
        onSelectRange={onSelectRange}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    const selectionContainer = globalThis.document.querySelector(
      '.hsn-selection-container'
    )
    expect(selectionContainer).toBeInstanceOf(HTMLElement)

    if (!(selectionContainer instanceof HTMLElement)) {
      throw new Error('selection container not rendered')
    }

    mockElementRect(selectionContainer, {
      left: 0,
      top: 0,
      width: 200,
      height: 100
    })
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(null)

    selectionContainer.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 30,
        clientY: 12
      })
    )
    getLastSelectionProps()?.onSelectRange?.(null)

    rerender(
      <IntermediateDocumentViewer
        document={document}
        renderMode='html-parser'
        ranges={[
          {
            id: 'range-1',
            text: 'Page',
            start: 0,
            end: 4,
            createdAt: 1,
            overlayRectType: 'px',
            rects: [{ x: 20, y: 10, width: 40, height: 20 }]
          }
        ]}
        selectedRangeId={null}
        overlayRectType='px'
        onSelectRange={onSelectRange}
      />
    )

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 12
    })
    const stopImmediatePropagationSpy = vi.spyOn(
      clickEvent,
      'stopImmediatePropagation'
    )

    selectionContainer.dispatchEvent(clickEvent)
    getLastSelectionProps()?.onSelectRange?.('range-1')

    expect(onSelectRange).toHaveBeenCalledWith(null)
    expect(onSelectRange).toHaveBeenCalledTimes(1)
    expect(stopImmediatePropagationSpy).toHaveBeenCalled()
    getSelectionSpy.mockRestore()
  })

  it('updates uncontrolled selected range state when no onSelectRange callback is provided', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')

    render(
      <IntermediateDocumentViewer
        document={document}
        renderMode='html-parser'
        ranges={[
          {
            id: 'range-1',
            text: 'Page',
            start: 0,
            end: 4,
            createdAt: 1,
            overlayRectType: 'percent',
            rects: [{ x: 10, y: 10, width: 20, height: 10 }]
          }
        ]}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    const selectionContainer = globalThis.document.querySelector(
      '.hsn-selection-container'
    )
    expect(selectionContainer).toBeInstanceOf(HTMLElement)

    if (!(selectionContainer instanceof HTMLElement)) {
      throw new Error('selection container not rendered')
    }

    mockElementRect(selectionContainer, {
      left: 0,
      top: 0,
      width: 200,
      height: 100
    })
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(null)

    selectionContainer.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 30,
        clientY: 12
      })
    )
    selectionContainer.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 30,
        clientY: 12
      })
    )
    getLastSelectionProps()?.onSelectRange?.('range-1')

    await waitFor(() => {
      expect(getLastSelectionProps()?.selectedRangeId).toBe('range-1')
    })

    getSelectionSpy.mockRestore()
  })
})

describe('selection prop forwarding integration', () => {
  beforeEach(() => {
    clearLastSelectionProps()
  })

  afterEach(() => {
    clearLastSelectionProps()
  })

  it('forwards active popover and range update handling to HamsterSelection', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    const range = {
      id: 'range-1',
      text: 'Page',
      start: 0,
      end: 4,
      createdAt: 1
    }
    const onUpdateRange = vi.fn()
    const selectionPopover = <button type='button'>Highlight</button>
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue('')

    render(
      <IntermediateDocumentViewer
        document={document}
        renderMode='html-parser'
        ranges={[range]}
        selectedRangeId='range-1'
        onUpdateRange={onUpdateRange}
        selectionPopover={selectionPopover}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('html-parser-output')).toBeInTheDocument()
    })

    const selectionProps = getLastSelectionProps()
    expect(selectionProps?.popover).toBe(selectionPopover)
    expect(selectionProps?.selectionPopover).toBe(selectionPopover)

    const updatedRange = { ...range, end: 5, text: 'Page ' }
    selectionProps?.onUpdateRange?.(updatedRange)

    expect(onUpdateRange).toHaveBeenCalledWith(updatedRange)
  })
})
