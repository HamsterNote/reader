import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  IntermediateContent,
  IntermediateDocument,
  IntermediateImage,
  IntermediateText
} from '@hamster-note/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  createRef,
  isValidElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useRef
} from 'react'
import * as sass from 'sass'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildSelectionPayload } from '../src/components/IntermediateDocumentViewer'
import { IntermediateDocumentTextViewer } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import {
  computePageOriginY,
  computeTransform,
  findRangeById,
  parsePublicPageId,
  rectCenterToPagePixels,
  resolveRangeJumpTarget,
  selectTargetRect
} from '../src/components/IntermediateDocumentViewer/rangeJumpHelpers'
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
import { IntermediateDocumentViewer, Reader } from '../src/index'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../src/types/selection'
import type {
  HandleRenderProps,
  LinkedSelectionRange,
  OverlayRectType,
  SelectionProps
} from './mocks/selection'
import {
  clearSelectionProps,
  getAllSelectionProps,
  getSelectionRefCallCounts,
  simulateLinkedDataChange,
  simulateLinkedSelect,
  simulateLinkedSelectRange,
  simulateLinkedUpdateRange
} from './mocks/selection'
import {
  VirtualPaper,
  VirtualPaperInteractionMode
} from './mocks/virtual-paper'
import {
  intersectionObserverMock,
  mockElementSize,
  setScrollContainerSize
} from './setup'

Reflect.set(globalThis, 'vi', vi)

// T7: 编译 reader.scss 为 CSS 字符串，在测试中注入 <style> 标签
// 使 jsdom 的 getComputedStyle 能读取 SCSS 规则
const readerStyles = sass.compile(
  path.resolve(__dirname, '../src/styles/reader.scss')
).css

function expectPopoverToContain(node: ReactNode, expected: ReactNode): void {
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    throw new Error('Expected popover to be a React element')
  }

  expect(node.props.children).toBe(expected)
}

function makeRuntimeLinkedRange(
  runtimeSelectionId: string,
  overrides: Partial<LinkedSelectionRange> = {}
): LinkedSelectionRange {
  return {
    id: 'runtime-range-1',
    text: 'Linked text',
    start: { selectionId: runtimeSelectionId, offset: 0 },
    end: { selectionId: runtimeSelectionId, offset: 11 },
    createdAt: 10,
    rectsBySelectionId: {
      [runtimeSelectionId]: [{ x: 1, y: 2, width: 3, height: 4 }]
    },
    ...overrides
  }
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

function requireSelectionPropsById(selectionId: string): SelectionProps {
  const selectionProps = getAllSelectionProps().find(
    (props) => props.selectionId === selectionId
  )

  if (!selectionProps) {
    throw new Error(`Expected Selection props for ${selectionId}`)
  }

  return selectionProps
}

function requireReaderSelectionRef(
  ref: RefObject<ReaderSelectionRef | null>
): ReaderSelectionRef {
  if (!ref.current) {
    throw new Error('Expected Reader selection ref to be available')
  }

  return ref.current
}

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

const _INTERMEDIATE_DOCUMENT_TIMING_STAGES = [
  'document-resolution',
  'shell-rendering',
  'initial-page-loading',
  'content-extraction',
  'page-content-rendering',
  'visibility-lazy-loading',
  'offscreen-unload',
  'ocr-processing'
] as const

type IntermediateDocumentTimingStage =
  (typeof _INTERMEDIATE_DOCUMENT_TIMING_STAGES)[number]

type IntermediateDocumentTimingEntry = {
  readonly stage: IntermediateDocumentTimingStage
  readonly pageNumber?: number
  readonly startedAt: number
  readonly endedAt: number
  readonly durationMs: number
}

type IntermediateDocumentTimingCallback = (
  entry: IntermediateDocumentTimingEntry
) => void

const makeTimingSpy = () => vi.fn<IntermediateDocumentTimingCallback>()

const getTimingEntries = (onTiming: ReturnType<typeof makeTimingSpy>) =>
  onTiming.mock.calls.map((call) => call[0])

const requireTimingStage = (
  entries: readonly IntermediateDocumentTimingEntry[],
  stage: IntermediateDocumentTimingStage
) => {
  const entry = entries.find((candidate) => candidate.stage === stage)
  if (!entry) {
    throw new Error(`Expected timing entry for stage ${stage}`)
  }
  return entry
}

const requirePageTimingStage = (
  entries: readonly IntermediateDocumentTimingEntry[],
  stage: IntermediateDocumentTimingStage,
  pageNumber: number
) => {
  const entry = entries.find(
    (candidate) =>
      candidate.stage === stage && candidate.pageNumber === pageNumber
  )
  if (!entry) {
    throw new Error(
      `Expected timing entry for stage ${stage} on page ${pageNumber}`
    )
  }
  return entry
}

const getPageTimingEntries = (
  entries: readonly IntermediateDocumentTimingEntry[],
  stage: IntermediateDocumentTimingStage,
  pageNumber: number
) =>
  entries.filter(
    (entry) => entry.stage === stage && entry.pageNumber === pageNumber
  )

const expectFiniteTimingEntry = (entry: IntermediateDocumentTimingEntry) => {
  expect(Number.isFinite(entry.startedAt)).toBe(true)
  expect(Number.isFinite(entry.endedAt)).toBe(true)
  expect(Number.isFinite(entry.durationMs)).toBe(true)
  expect(entry.durationMs).toBeGreaterThanOrEqual(0)
}

const flushIntermediateDocumentMicrotasks = async () => {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    await Promise.resolve()
  }
}

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

const makeTextMetrics = (width: number): TextMetrics => ({
  width,
  actualBoundingBoxLeft: 0,
  actualBoundingBoxRight: width,
  actualBoundingBoxAscent: 0,
  actualBoundingBoxDescent: 0,
  fontBoundingBoxAscent: 0,
  fontBoundingBoxDescent: 0,
  emHeightAscent: 0,
  emHeightDescent: 0,
  hangingBaseline: 0,
  alphabeticBaseline: 0,
  ideographicBaseline: 0
})

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

const TEXT_MODE_ROW_HEIGHTS = [35, 55, 45] as const

function TextModeVirtualizerHarness() {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: TEXT_MODE_ROW_HEIGHTS.length,
    estimateSize: (index) => TEXT_MODE_ROW_HEIGHTS[index] ?? 40,
    getScrollElement: () => parentRef.current,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 0
  })

  const setRowRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        return
      }

      const index = Number(element.dataset.index)
      mockElementSize(element, {
        width: 300,
        height: TEXT_MODE_ROW_HEIGHTS[index] ?? 40
      })
      virtualizer.measureElement(element)
    },
    [virtualizer]
  )

  return (
    <div
      ref={parentRef}
      data-testid='text-mode-scroll-container'
      style={{ height: 80, overflow: 'auto', width: 300 }}
    >
      <div
        data-testid='text-mode-virtual-spacer'
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={setRowRef}
            data-index={virtualItem.index}
            data-size={virtualItem.size}
            data-start={virtualItem.start}
            data-testid={`text-mode-row-${virtualItem.index}`}
            style={{
              height: TEXT_MODE_ROW_HEIGHTS[virtualItem.index],
              position: 'absolute',
              transform: `translateY(${virtualItem.start}px)`,
              width: '100%'
            }}
          >
            Row {virtualItem.index}
          </div>
        ))}
      </div>
    </div>
  )
}

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
  })

  it('is exported from the public entrypoint', () => {
    expect(IntermediateDocumentViewer).toBeTypeOf('function')
  })

  it('forwards containMarginX and containMarginY to VirtualPaper', async () => {
    const { document } = makeDocument({ pageCount: 1 })

    render(
      <IntermediateDocumentViewer
        document={document}
        containMarginX={24}
        containMarginY={48}
      />
    )

    const container = await screen.findByTestId('virtual-paper-container')
    expect(container).toHaveAttribute('data-contain-margin-x', '24')
    expect(container).toHaveAttribute('data-contain-margin-y', '48')
  })

  it('only fits the page during initialization and preserves later zoom', async () => {
    // Given: the 100px-wide page uses the Reader's 12px margin on both sides.
    const { document } = makeDocument({
      pageCount: 1,
      pageSize: { x: 100, y: 150 }
    })
    await act(async () => {
      render(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={0}
        />
      )
    })
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')

    // When: the visible container is narrower than the page margin box.
    mockElementSize(wrapper, { width: 120, height: 300 })

    // Then: the complete 124px margin box is scaled to the container width.
    await waitFor(() => {
      expect(container.style.transform).toContain(`scale(${String(120 / 124)})`)
    })

    // When: the user zooms beyond the initial fit scale.
    await act(async () => {
      VirtualPaper.__triggerTransform(container, { x: 0, y: 0, scale: 2 })
    })

    // Then: fitting does not become a runtime maximum-scale restriction.
    await waitFor(() => {
      expect(container.style.transform).toContain('scale(2)')
    })
  })

  it('upscales the page to fill a wider container during initialization', async () => {
    // Given: the page and its horizontal margins form a 124px-wide box.
    const { document } = makeDocument({
      pageCount: 1,
      pageSize: { x: 100, y: 150 }
    })
    render(
      <IntermediateDocumentViewer document={document} initialLoadedPages={0} />
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')

    // When: the visible container is exactly twice as wide as that margin box.
    mockElementSize(wrapper, { width: 248, height: 300 })

    // Then: initialization scales the Page up so the complete box fills the width.
    await waitFor(() => {
      expect(container.style.transform).toContain('scale(2)')
    })
  })

  it('fits the rendered fallback page when the document size is unavailable', async () => {
    // Given: the document has no usable page size, so the shell renders at 595px.
    const { document } = makeDocument({ pageCount: 1, pageSize: {} })
    render(<IntermediateDocumentViewer document={document} />)
    await screen.findByText('Page 1 text')
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')

    // When: the visible container is narrower than the fallback page margin box.
    mockElementSize(wrapper, { width: 200, height: 300 })

    // Then: fitting uses the same fallback width that the rendered page shell uses.
    await waitFor(() => {
      expect(container.style.transform).toContain(`scale(${String(200 / 619)})`)
    })
  })

  it('text mode virtualizer harness mounts with deterministic measurements', async () => {
    render(<TextModeVirtualizerHarness />)
    const scrollContainer = screen.getByTestId('text-mode-scroll-container')
    setScrollContainerSize(scrollContainer, {
      width: 300,
      height: 80,
      scrollHeight: 135
    })

    const firstRow = await screen.findByTestId('text-mode-row-0')

    await waitFor(() => {
      expect(firstRow).toHaveAttribute('data-size', '35')
      expect(firstRow).toHaveAttribute('data-start', '0')
      expect(firstRow).toHaveStyle({ transform: 'translateY(0px)' })
      expect(screen.getByTestId('text-mode-row-1')).toHaveAttribute(
        'data-start',
        '35'
      )
      expect(screen.getByTestId('text-mode-virtual-spacer')).toHaveStyle({
        height: '135px'
      })
    })
  })

  // ---- 文本模式虚拟化（T3）----
  // IntermediateDocumentTextViewer 使用 @tanstack/react-virtual 的原生滚动虚拟化，
  // overscan=0 严格保证只渲染可见视口内的页面 DOM。以下测试验证：
  // - 视口仅容纳一页时，只有 page 1 存在，page 2/20 不在 DOM 中
  // - 根节点有正确的 data-testid
  // - 文本模式不挂载 VirtualPaper（无 virtual-paper-wrapper）
  it('text mode renders only visible virtual pages', async () => {
    // 20 页文档，确保虚拟化有意义
    const { document } = makeDocument({ pageCount: 20 })

    render(<IntermediateDocumentTextViewer document={document} />)

    // 根节点存在且有 role='document'
    const scrollEl = screen.getByTestId('intermediate-document-text-viewer')
    expect(scrollEl).toHaveAttribute('role', 'document')

    // 视口高度 600px < 估计页高 800px，确保虚拟范围只含第一页
    setScrollContainerSize(scrollEl, { width: 800, height: 600 })

    // 等待页 1 进入虚拟范围
    const page1 = await screen.findByTestId('intermediate-text-page-1')
    expect(page1).toHaveAttribute('data-page-number', '1')

    // 用真实高度 mock 页 1，让虚拟化器测量稳定（防止 jsdom 0 高度级联）
    mockElementSize(page1, { width: 800, height: 800 })

    // 虚拟化器稳定后：只有 page 1 在 DOM，page 2/20 不存在
    await waitFor(() => {
      expect(screen.getByTestId('intermediate-text-page-1')).toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-text-page-2')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-text-page-20')
      ).not.toBeInTheDocument()
    })

    // 文本模式不挂载 VirtualPaper
    expect(
      screen.queryByTestId('virtual-paper-wrapper')
    ).not.toBeInTheDocument()
  })

  it('text mode lazy loads only visible pages', async () => {
    const pageNumbers = Array.from({ length: 20 }, (_, index) => index + 1)
    const thumbnailSpies = new Map<number, ReturnType<typeof vi.fn>>()
    const getContentSpies = new Map<number, ReturnType<typeof vi.fn>>()

    const document = {
      id: 'text-lazy-doc',
      title: 'Text Lazy Document',
      pageCount: 20,
      pageNumbers,
      getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
      getPageByPageNumber: vi.fn((pageNumber: number) => {
        if (pageNumber === 20) {
          throw new Error('text mode must not load page 20')
        }

        const getThumbnail = vi.fn(async () => {
          throw new Error('text mode must not request thumbnails')
        })
        const getContent = vi.fn(async () => [
          makeText(`text-${pageNumber}`, `Visible page ${pageNumber}`),
          {
            id: `image-${pageNumber}`,
            src: `data:image/png;base64,page-${pageNumber}`,
            polygon: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10]
            ],
            opacity: 1
          } as IntermediateImage
        ])
        thumbnailSpies.set(pageNumber, getThumbnail)
        getContentSpies.set(pageNumber, getContent)
        return Promise.resolve({ getContent, getThumbnail })
      })
    } as unknown as IntermediateDocument

    render(<IntermediateDocumentTextViewer document={document} />)

    const scrollEl = screen.getByTestId('intermediate-document-text-viewer')
    setScrollContainerSize(scrollEl, { width: 800, height: 600 })

    await waitFor(() => {
      expect(screen.getByText('Visible page 1')).toBeInTheDocument()
    })

    expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
    expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(20)
    expect(getContentSpies.get(1)).toHaveBeenCalledTimes(1)
    thumbnailSpies.forEach((getThumbnail) => {
      expect(getThumbnail).not.toHaveBeenCalled()
    })
    expect(
      screen.queryByTestId('intermediate-text-page-20')
    ).not.toBeInTheDocument()
  })

  it('text mode keeps virtual row content matched to the scrolled page number', async () => {
    const { document } = makeDocument({ pageCount: 3 })

    render(
      <IntermediateDocumentTextViewer
        document={document}
        pageLoadEnterDelayMs={0}
      />
    )

    const scrollEl = screen.getByTestId('intermediate-document-text-viewer')
    setScrollContainerSize(scrollEl, {
      width: 800,
      height: 600,
      scrollHeight: 2400
    })

    const page1 = await screen.findByTestId('intermediate-text-page-1')
    mockElementSize(page1, { width: 800, height: 800 })

    await screen.findByText('Page 1 text')

    act(() => {
      scrollEl.scrollTop = 800
      scrollEl.dispatchEvent(new Event('scroll'))
    })

    const page2 = await screen.findByTestId('intermediate-text-page-2')
    mockElementSize(page2, { width: 800, height: 800 })

    await waitFor(() => {
      expect(page2).toHaveAttribute('data-page-number', '2')
      expect(screen.getByText('Page 2 text')).toHaveAttribute(
        'data-page-number',
        '2'
      )
      expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
    })
  })

  // ---- 文本模式内容渲染（T5）----
  // IntermediateDocumentTextPageContent 以普通文档流绘制 IntermediateText：
  // 只渲染文本 span（带 --flow class + data-text-id），isEOL 后追加 <br>，
  // 图片 / OCR / 底图在文本模式下不渲染。
  it('text mode content renders only IntermediateText in flow order', async () => {
    const eolText: IntermediateText = {
      ...makeText('text-eol', 'Hello'),
      isEOL: true
    }

    const document = {
      id: 'text-content-doc',
      title: 'Text Content Document',
      pageCount: 1,
      pageNumbers: [1],
      getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
      getPageByPageNumber: vi.fn(() => {
        const getThumbnail = vi.fn(
          async () => 'data:image/png;base64,thumbnail'
        )
        const getContent = vi.fn(async () => [
          eolText,
          {
            id: 'image-1',
            src: 'data:image/png;base64,mixed-image',
            polygon: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10]
            ],
            opacity: 1
          } as IntermediateImage
        ])
        return Promise.resolve({ getContent, getThumbnail })
      })
    } as unknown as IntermediateDocument

    render(<IntermediateDocumentTextViewer document={document} />)

    const scrollEl = screen.getByTestId('intermediate-document-text-viewer')
    setScrollContainerSize(scrollEl, { width: 800, height: 600 })

    const helloText = await screen.findByText('Hello')
    expect(helloText).toBeInTheDocument()

    const textSpan = helloText.closest('.hamster-reader__intermediate-text')
    expect(textSpan).not.toBeNull()
    expect(textSpan).toHaveClass('hamster-reader__intermediate-text--flow')
    expect(textSpan).toHaveAttribute('data-text-id', 'text-eol')
    expect(textSpan).toHaveAttribute('data-page-number', '1')

    const pageDiv = screen.getByTestId('intermediate-text-page-1')
    expect(pageDiv).toHaveClass('hamster-reader__intermediate-text-page')
    expect(pageDiv.innerHTML).toContain('<br>')

    expect(pageDiv.querySelector('img')).not.toBeInTheDocument()
    expect(
      pageDiv.querySelector('.hamster-reader__intermediate-page-image')
    ).not.toBeInTheDocument()
    expect(
      pageDiv.querySelector('.hamster-reader__intermediate-page-base-image')
    ).not.toBeInTheDocument()
    expect(pageDiv.querySelector('[data-ocr]')).not.toBeInTheDocument()

    const allTextSpans = pageDiv.querySelectorAll(
      '.hamster-reader__intermediate-text--flow'
    )
    allTextSpans.forEach((span) => {
      expect(span.hasAttribute('data-text-id')).toBe(true)
      expect(span.hasAttribute('data-page-number')).toBe(true)
    })
  })

  it('text mode mounted selection callbacks', async () => {
    const onTextSelectionChange = vi.fn()
    const onTextSelectionEnd = vi.fn()
    const onSelectText = vi.fn()

    const document = {
      id: 'text-selection-doc',
      title: 'Text Selection Document',
      pageCount: 1,
      pageNumbers: [1],
      getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
      getPageByPageNumber: vi.fn(() => {
        const getContent = vi.fn(async () => [
          makeText('text-sel-1', 'Hello Text Mode')
        ])
        const getThumbnail = vi.fn(async () => 'data:image/png;base64,thumb')
        return Promise.resolve({ getContent, getThumbnail })
      })
    } as unknown as IntermediateDocument

    render(
      <IntermediateDocumentTextViewer
        document={document}
        onTextSelectionChange={onTextSelectionChange}
        onTextSelectionEnd={onTextSelectionEnd}
        onSelectText={onSelectText}
      />
    )

    const scrollEl = screen.getByTestId('intermediate-document-text-viewer')
    setScrollContainerSize(scrollEl, { width: 800, height: 600 })

    const textSpan = await screen.findByText('Hello Text Mode')
    expect(textSpan).toBeInTheDocument()
    expect(
      textSpan.closest('.hamster-reader__intermediate-text')
    ).toHaveAttribute('data-text-id', 'text-sel-1')

    // 页面 data-selection-id 须包含 runtimePageSelectionId 格式（scopeId:page-1）
    const pageDiv = screen.getByTestId('intermediate-text-page-1')
    const selectionId = pageDiv.getAttribute('data-selection-id')
    expect(selectionId).toMatch(/:page-1$/)

    // 构造 mock Selection
    const textNode = textSpan.firstChild
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected text span to contain a text node')
    }
    const range = globalThis.document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 'Hello Text Mode'.length)

    const selection = {
      isCollapsed: false,
      anchorNode: textNode,
      anchorOffset: 0,
      focusNode: textNode,
      focusOffset: 'Hello Text Mode'.length,
      rangeCount: 1,
      getRangeAt: (index: number) => {
        if (index !== 0) {
          throw new Error('Selection mock only contains one range')
        }
        return range
      },
      toString: () => 'Hello Text Mode',
      containsNode: (node: Node) => {
        try {
          return range.intersectsNode(node)
        } catch {
          return false
        }
      }
    } as unknown as Selection

    const getSelectionSpy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(selection)

    try {
      // 触发 selectionchange → onTextSelectionChange
      globalThis.document.dispatchEvent(new Event('selectionchange'))

      expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
      const [changeText, changeDetail] = onTextSelectionChange.mock.calls[0]
      expect(changeText.id).toBe('text-sel-1')
      expect(changeDetail.selectedText).toBe('Hello Text Mode')
      expect(changeDetail.pageNumber).toBe(1)

      // 触发 mouseup → onTextSelectionEnd + onSelectText
      scrollEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
      const [endText, endDetail] = onTextSelectionEnd.mock.calls[0]
      expect(endText.id).toBe('text-sel-1')
      expect(endDetail.selectedText).toBe('Hello Text Mode')

      expect(onSelectText).toHaveBeenCalledTimes(1)
      const [nativeSelection, segments, extractedText] =
        onSelectText.mock.calls[0]
      expect(nativeSelection).toBe(selection)
      expect(extractedText).toBe('Hello Text Mode')
      expect(segments.length).toBe(1)
      expect(segments[0].selectedText).toBe('Hello Text Mode')
      expect(extractedText).toBe(
        segments
          .map((segment: { selectedText: string }) => segment.selectedText)
          .join('')
      )
    } finally {
      getSelectionSpy.mockRestore()
    }
  })

  // ---- T7: text-mode scoped SCSS styles ----
  // 验证文本模式的静态布局样式已从 inline 迁移到 SCSS class，
  // 且 layout 模式不受影响。注入 reader.scss 编译后的 CSS 使
  // jsdom 的 getComputedStyle 能读取规则。
  describe('text mode scoped SCSS styles (T7)', () => {
    let styleEl: HTMLStyleElement | null = null

    beforeEach(() => {
      styleEl = document.createElement('style')
      styleEl.textContent = readerStyles
      document.head.appendChild(styleEl)
    })

    afterEach(() => {
      styleEl?.remove()
      styleEl = null
    })

    it('text mode page has scoped class and computed padding from CSS', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      render(<IntermediateDocumentTextViewer document={document} />)

      const scrollEl = screen.getByTestId('intermediate-document-text-viewer')
      setScrollContainerSize(scrollEl, { width: 800, height: 600 })

      const page = await screen.findByTestId('intermediate-text-page-1')

      expect(page).toHaveClass('hamster-reader__intermediate-text-page')
      expect(page.style.padding).toBe('')
      expect(
        window.getComputedStyle(page).getPropertyValue('padding-top')
      ).toBe('5px')
    })

    it('text mode root has scoped classes without inline overflow or display', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      render(<IntermediateDocumentTextViewer document={document} />)

      const root = screen.getByTestId('intermediate-document-text-viewer')

      expect(root).toHaveClass('hamster-reader__intermediate-text-viewer')
      expect(root).toHaveClass('hamster-reader__intermediate-text-scroll')
      expect(root).toHaveClass('hamster-reader__intermediate-document-viewer')
      expect(root.style.overflow).toBe('')
      expect(root.style.display).toBe('')

      const computed = window.getComputedStyle(root)
      expect(computed.getPropertyValue('overflow')).toBe('auto')
      expect(computed.getPropertyValue('display')).toBe('block')
    })

    it('text mode span has --flow class with static position from CSS', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      render(<IntermediateDocumentTextViewer document={document} />)

      const scrollEl = screen.getByTestId('intermediate-document-text-viewer')
      setScrollContainerSize(scrollEl, { width: 800, height: 600 })

      const textSpan = await screen.findByText('Page 1 text')
      expect(textSpan).toHaveClass('hamster-reader__intermediate-text--flow')

      const computed = window.getComputedStyle(textSpan)
      expect(computed.getPropertyValue('position')).toBe('static')
      expect(computed.getPropertyValue('display')).toBe('inline')
      expect(computed.getPropertyValue('white-space')).toBe('normal')
    })

    it('text mode page inline style only contains dynamic transform', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      render(<IntermediateDocumentTextViewer document={document} />)

      const scrollEl = screen.getByTestId('intermediate-document-text-viewer')
      setScrollContainerSize(scrollEl, { width: 800, height: 600 })

      const page = await screen.findByTestId('intermediate-text-page-1')

      const inlineStyle = page.style.cssText
      expect(inlineStyle).toContain('transform')
      expect(inlineStyle).not.toContain('padding')
      expect(inlineStyle).not.toContain('position')
      expect(inlineStyle).not.toContain('width')
    })

    it('text mode regression: layout mode renders VirtualPaper without text-mode classes', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      render(<IntermediateDocumentViewer document={document} />)

      expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-document-text-viewer')
      ).not.toBeInTheDocument()

      const page = screen.getByTestId('intermediate-page-1')
      expect(page).toHaveClass('hamster-reader__intermediate-page')
      expect(page).not.toHaveClass('hamster-reader__intermediate-text-page')

      const viewer = screen.getByTestId('intermediate-document-viewer')
      expect(viewer).not.toHaveClass('hamster-reader__intermediate-text-viewer')
      expect(viewer).not.toHaveClass('hamster-reader__intermediate-text-scroll')
      expect(viewer).not.toHaveClass('hamster-reader__intermediate-text-spacer')
    })
  })

  // ---- intermediate-document 默认渲染模式（任务 1）----
  // 当前唯一渲染路径，组件始终走 lazy intermediate-document 分支。
  describe('intermediate-document default branch', () => {
    beforeEach(() => {})

    it('renders intermediate-document by default', async () => {
      const { document, pages } = makeDocument({ pageCount: 1 })

      render(<IntermediateDocumentViewer document={document} />)

      // intermediate-document 默认分支仅渲染空外壳，不触发任何页面/内容加载
      expect(pages.get(1)?.getContent).not.toHaveBeenCalled()
      // 外壳分支不渲染 html-parser-output
      expect(screen.queryByTestId('html-parser-output')).not.toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
    })

    it('renders the lazy intermediate path when no mode is supplied', async () => {
      const { document, pages } = makeDocument({ pageCount: 1 })

      render(<IntermediateDocumentViewer document={document} />)

      expect(pages.get(1)?.getContent).not.toHaveBeenCalled()
    })
  })

  // ---- intermediate-document 外壳渲染（任务 2）----
  // 当前组件渲染纯页面外壳：每个页码对应一个 .hamster-reader__intermediate-page 空槽位，
  // 每个页码对应一个 .hamster-reader__intermediate-page 空槽位，
  // 设置 data-testid/data-page-number/data-selection-id 及尺寸，
  // 绝不调用 getPageByPageNumber/getContent/getThumbnail 等加载器。
  describe('intermediate-document shell rendering', () => {
    beforeEach(() => {})

    // 严格懒加载文档 fixture：
    // - pageNumbers 返回页码列表
    // - getPageSizeByPageNumber 返回每页尺寸
    // - pages getter 一旦读取即抛错（严格懒加载契约）
    // - getPageByPageNumber/getContent/getThumbnail 为 spy，
    //   在外壳-only 渲染期间被调用会让测试失败
    function makeStrictLazyDocument({
      pageCount = 3,
      pageSize = { x: 100, y: 150 }
    }: {
      pageCount?: number
      pageSize?: { x?: number; y?: number }
    } = {}) {
      const pageNumbers = Array.from(
        { length: pageCount },
        (_, index) => index + 1
      )
      const pages = new Map<
        number,
        {
          getContent: ReturnType<typeof vi.fn>
          getThumbnail?: ReturnType<typeof vi.fn>
        }
      >()

      pageNumbers.forEach((pageNumber) => {
        pages.set(pageNumber, {
          getContent: vi.fn(async () => [
            makeText(`text-${pageNumber}`, `Page ${pageNumber} text`)
          ]),
          getThumbnail: vi.fn(async () => undefined)
        })
      })

      const strictDocument = {
        id: 'strict-doc',
        title: 'Strict Lazy Document',
        pageCount,
        pageNumbers,
        getPageSizeByPageNumber: vi.fn((pageNumber: number) => {
          // 每页返回相同尺寸，便于断言；可按 pageNumber 做差异化
          if (pageNumber === 2) {
            return { x: 200, y: 300 }
          }
          return pageSize
        }),
        getPageByPageNumber: vi.fn((pageNumber: number) =>
          Promise.resolve(pages.get(pageNumber))
        )
      } as unknown as IntermediateDocument

      // 严格懒加载契约：pages getter 一旦读取即抛错
      Object.defineProperty(strictDocument, 'pages', {
        get() {
          throw new Error(
            'strict lazy document: pages getter must not be read for shell rendering'
          )
        },
        configurable: true
      })

      return { document: strictDocument, pages }
    }

    it('shell renders a sized slot per pageNumber with data-selection-id and no loader calls', () => {
      const { document, pages } = makeStrictLazyDocument({ pageCount: 3 })

      // initialLoadedPages=0 保持纯外壳契约：不触发任何页面内容加载
      render(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={0}
        />
      )

      // 外壳应立即渲染，不调用任何加载器
      expect(document.getPageSizeByPageNumber).toHaveBeenCalledWith(1)
      expect(document.getPageSizeByPageNumber).toHaveBeenCalledWith(2)
      expect(document.getPageSizeByPageNumber).toHaveBeenCalledWith(3)
      expect(document.getPageByPageNumber).not.toHaveBeenCalled()
      pages.forEach((page) => {
        expect(page.getContent).not.toHaveBeenCalled()
        expect(page.getThumbnail).not.toHaveBeenCalled()
      })

      // 每页外壳应有尺寸、选择 id 与 testid
      const page1 = screen.getByTestId('intermediate-page-1')
      expect(page1).toHaveClass('hamster-reader__intermediate-page')
      expect(page1).toHaveAttribute('data-page-number', '1')
      expect(page1).toHaveAttribute('data-selection-id')
      expect(page1.getAttribute('data-selection-id')).toMatch(/:page-1$/)
      expect(page1).toHaveStyle({ width: '100px', height: '150px' })

      // 第二页返回了不同尺寸
      const page2 = screen.getByTestId('intermediate-page-2')
      expect(page2).toHaveStyle({ width: '200px', height: '300px' })
      expect(page2).toHaveAttribute('data-page-number', '2')
      expect(page2.getAttribute('data-selection-id')).toMatch(/:page-2$/)

      const page3 = screen.getByTestId('intermediate-page-3')
      expect(page3).toHaveStyle({ width: '100px', height: '150px' })
    })

    it('shell uses the default intermediate path', () => {
      const { document, pages } = makeStrictLazyDocument({ pageCount: 1 })

      render(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={0}
        />
      )

      expect(document.getPageByPageNumber).not.toHaveBeenCalled()
      expect(pages.get(1)?.getContent).not.toHaveBeenCalled()
      expect(pages.get(1)?.getThumbnail).not.toHaveBeenCalled()
      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
    })

    it('shell renders empty slots without page text content', () => {
      const { document } = makeStrictLazyDocument({ pageCount: 2 })

      render(<IntermediateDocumentViewer document={document} />)

      // 外壳内不应渲染任何文本内容
      const page1 = screen.getByTestId('intermediate-page-1')
      expect(page1).toBeEmptyDOMElement()
      const page2 = screen.getByTestId('intermediate-page-2')
      expect(page2).toBeEmptyDOMElement()
      expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
      expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()
    })

    it('shell falls back to DEFAULT_PAGE_SIZE when getPageSizeByPageNumber returns undefined/invalid', () => {
      const { document } = makeStrictLazyDocument({ pageCount: 1 })

      // 返回 undefined 触发回退
      vi.mocked(document.getPageSizeByPageNumber).mockReturnValue(undefined)

      render(<IntermediateDocumentViewer document={document} />)

      const page1 = screen.getByTestId('intermediate-page-1')
      expect(page1).toHaveStyle({ width: '595px', height: '842px' })
      expect(page1).toHaveAttribute('data-page-size-unavailable', 'true')
    })

    it('shell falls back to DEFAULT_PAGE_SIZE when getPageSizeByPageNumber returns invalid dimensions', () => {
      const { document } = makeStrictLazyDocument({ pageCount: 1 })

      // 返回部分无效尺寸（x=0, y 非法）
      vi.mocked(document.getPageSizeByPageNumber).mockReturnValue({
        x: 0,
        y: -1
      })

      render(<IntermediateDocumentViewer document={document} />)

      const page1 = screen.getByTestId('intermediate-page-1')
      expect(page1).toHaveStyle({ width: '595px', height: '842px' })
      expect(page1).toHaveAttribute('data-page-size-unavailable', 'true')
    })

    it('shell respects pageRange filtering', () => {
      const { document } = makeStrictLazyDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageRange={{ start: 2, end: 4 }}
        />
      )

      // 仅渲染 pageRange 内的页码外壳
      expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-4')).toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-page-1')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('intermediate-page-5')
      ).not.toBeInTheDocument()

      // 仅对范围内的页码读取尺寸
      expect(document.getPageSizeByPageNumber).toHaveBeenCalledWith(2)
      expect(document.getPageSizeByPageNumber).toHaveBeenCalledWith(3)
      expect(document.getPageSizeByPageNumber).toHaveBeenCalledWith(4)
      expect(document.getPageSizeByPageNumber).not.toHaveBeenCalledWith(1)
      expect(document.getPageSizeByPageNumber).not.toHaveBeenCalledWith(5)
    })

    it('shell renders empty viewer for empty document', () => {
      const { document } = makeStrictLazyDocument({ pageCount: 0 })

      render(<IntermediateDocumentViewer document={document} />)

      expect(
        screen.getByTestId('intermediate-document-viewer')
      ).toBeEmptyDOMElement()
    })

    it('strict lazy document pages getter throws when read', () => {
      const { document } = makeStrictLazyDocument({ pageCount: 1 })

      // 严格懒加载契约：读取 pages getter 必须抛错。
      // 使用表达式箭头函数读取 getter（作为隐式返回值，避免 no-unused-expressions），
      // 不使用 void / any。
      expect(() => (document as unknown as { pages: unknown }).pages).toThrow(
        /pages getter must not be read/
      )
    })

    it('shell survives rerender without calling loaders', () => {
      const { document, pages } = makeStrictLazyDocument({ pageCount: 2 })

      const { rerender } = render(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={0}
        />
      )

      expect(document.getPageByPageNumber).not.toHaveBeenCalled()
      pages.forEach((page) => {
        expect(page.getContent).not.toHaveBeenCalled()
      })

      rerender(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={0}
        />
      )

      // 重新渲染后仍不应触发加载器
      expect(document.getPageByPageNumber).not.toHaveBeenCalled()
      pages.forEach((page) => {
        expect(page.getContent).not.toHaveBeenCalled()
      })
      expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
    })

    it('reuses cached page sizes during VirtualPaper pan rerenders', async () => {
      const { document } = makeStrictLazyDocument({ pageCount: 2 })

      render(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={0}
        />
      )

      expect(document.getPageSizeByPageNumber).toHaveBeenCalledTimes(2)

      const container = screen.getByTestId('virtual-paper-container')
      await act(async () => {
        VirtualPaper.__triggerTransform(container, { x: -32, y: 0, scale: 1 })
      })

      expect(container).toHaveStyle({
        transform: 'translate3d(-32px, 0px, 0) scale(1)'
      })
      expect(document.getPageSizeByPageNumber).toHaveBeenCalledTimes(2)
    })
  })
  // ---- end intermediate-document 外壳渲染 ----

  // ---- intermediate-document 已加载页面内容渲染（任务 3）----
  // 默认模式下，前 initialLoadedPages 页会通过最小加载触发器加载内容，
  // 然后由 IntermediateDocumentPageContent 渲染底图、文本 span、OCR span、
  // IntermediateImage 内容项。以下测试覆盖 thumbnail duck typing、文本几何、
  // 图片几何/样式以及旧版 texts/getTexts() 兼容性。
  describe('intermediate-document content rendering', () => {
    beforeEach(() => {})

    function makeImage(
      id: string,
      src: string,
      overrides: Partial<IntermediateImage> = {}
    ): IntermediateImage {
      return {
        id,
        src,
        polygon: [
          [10, 20],
          [110, 20],
          [110, 120],
          [10, 120]
        ],
        opacity: 0.8,
        ...overrides
      } as IntermediateImage
    }

    // 构建一个单页 intermediate-document 测试文档，允许自定义 page 行为
    function makeContentTestDocument(
      page: Record<string, unknown>
    ): IntermediateDocument {
      return {
        id: 'content-test-doc',
        title: 'Content Test',
        pageCount: 1,
        pageNumbers: [1],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 200, y: 300 })),
        getPageByPageNumber: vi.fn(() => Promise.resolve(page))
      } as unknown as IntermediateDocument
    }

    it('renders base image from getThumbnail() returning a raw string', async () => {
      const page = {
        getContent: vi.fn(async () => []),
        getThumbnail: vi.fn(async () => 'data:image/png;base64,thumb-str')
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        const baseImage = screen
          .getByTestId('intermediate-page-1')
          .querySelector('.hamster-reader__intermediate-page-base-image')
        expect(baseImage).toBeInTheDocument()
        expect(baseImage).toHaveAttribute(
          'src',
          'data:image/png;base64,thumb-str'
        )
      })
      expect(page.getThumbnail).toHaveBeenCalledTimes(1)
    })

    it('renders base image from getThumbnail() returning { src }', async () => {
      const page = {
        getContent: vi.fn(async () => []),
        getThumbnail: vi.fn(async () => ({
          src: 'data:image/png;base64,thumb-obj'
        }))
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        const baseImage = screen
          .getByTestId('intermediate-page-1')
          .querySelector('.hamster-reader__intermediate-page-base-image')
        expect(baseImage).toBeInTheDocument()
        expect(baseImage).toHaveAttribute(
          'src',
          'data:image/png;base64,thumb-obj'
        )
      })
      expect(page.getThumbnail).toHaveBeenCalledTimes(1)
    })

    it('renders IntermediateText spans from getContent() with correct text and geometry', async () => {
      const text = makeText('text-1', 'Hello World')
      const page = {
        getContent: vi.fn(async () => [text] as IntermediateContent[]),
        getThumbnail: vi.fn(async () => undefined)
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Hello World')).toBeInTheDocument()
      })

      const span = screen
        .getByTestId('intermediate-page-1')
        .querySelector('.hamster-reader__intermediate-text')
      expect(span).toBeInTheDocument()
      expect(span).toHaveAttribute('data-text-id', 'text-1')
      expect(span).toHaveAttribute('data-page-number', '1')
      // polygon [[10,20],[50,20],[50,36],[10,36]] → x=10, y=20, w=40, h=16
      expect(span).toHaveStyle({ left: '10px', top: '20px' })
    })

    it('scales IntermediateText width to match polygon width', async () => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext
      const measureText = vi.fn((content: string) =>
        makeTextMetrics(content === 'Scaled text' ? 80 : 40)
      )
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: vi.fn(() => ({
          font: '',
          measureText
        }))
      })
      const text = makeText('scaled-text', 'Scaled text')
      const page = {
        getContent: vi.fn(async () => [text] as IntermediateContent[]),
        getThumbnail: vi.fn(async () => undefined)
      }
      const document = makeContentTestDocument(page)

      try {
        render(<IntermediateDocumentViewer document={document} />)

        await waitFor(() => {
          expect(screen.getByText('Scaled text')).toBeInTheDocument()
        })

        const span = screen.getByText('Scaled text')
        expect(span.style.transform).toBe('scaleX(0.5)')
        expect(measureText).toHaveBeenCalledWith('Scaled text')
      } finally {
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
          configurable: true,
          value: originalGetContext
        })
      }
    })

    it('renders IntermediateImage content entries with geometry and opacity', async () => {
      const image = makeImage('img-1', 'data:image/png;base64,content-img')
      const page = {
        getContent: vi.fn(async () => [image] as IntermediateContent[]),
        getThumbnail: vi.fn(async () => undefined)
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        const img = screen
          .getByTestId('intermediate-page-1')
          .querySelector('.hamster-reader__intermediate-page-image')
        expect(img).toBeInTheDocument()
      })

      const img = screen
        .getByTestId('intermediate-page-1')
        .querySelector('.hamster-reader__intermediate-page-image')
      expect(img).toHaveAttribute('src', 'data:image/png;base64,content-img')
      expect(img).toHaveAttribute('data-image-id', 'img-1')
      // polygon [[10,20],[110,20],[110,120],[10,120]] → x=10,y=20,w=100,h=100
      expect(img).toHaveStyle({ left: '10px', top: '20px' })
      expect(img).toHaveStyle({ opacity: '0.8' })
    })

    it('does not render IntermediateImage content entries with blank src values', async () => {
      const emptyImage = makeImage('img-empty', '')
      const blankImage = makeImage('img-blank', '   ')
      const visibleImage = makeImage(
        'img-visible',
        'data:image/png;base64,visible'
      )
      const page = {
        getContent: vi.fn(
          async () =>
            [emptyImage, blankImage, visibleImage] as IntermediateContent[]
        ),
        getThumbnail: vi.fn(async () => undefined)
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(
          screen
            .getByTestId('intermediate-page-1')
            .querySelector('[data-image-id="img-visible"]')
        ).toBeInTheDocument()
      })

      const page1 = screen.getByTestId('intermediate-page-1')
      expect(page1.querySelector('[data-image-id="img-empty"]')).toBeNull()
      expect(page1.querySelector('[data-image-id="img-blank"]')).toBeNull()
      expect(
        page1.querySelectorAll('.hamster-reader__intermediate-page-image')
      ).toHaveLength(1)
    })

    it('filters out blank-only text spans from getContent()', async () => {
      const visibleText = makeText('text-visible', 'Real text')
      const blankText = makeText('text-blank', '')
      const page = {
        getContent: vi.fn(
          async () => [visibleText, blankText] as IntermediateContent[]
        ),
        getThumbnail: vi.fn(async () => undefined)
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Real text')).toBeInTheDocument()
      })

      const page1 = screen.getByTestId('intermediate-page-1')
      expect(page1.querySelector('[data-text-id="text-blank"]')).toBeNull()
      expect(
        page1.querySelectorAll('.hamster-reader__intermediate-text')
      ).toHaveLength(1)
    })

    it('supports older texts property shape instead of getContent()', async () => {
      const text = makeText('legacy-text', 'Legacy content')
      const page = {
        // 无 getContent / getTexts，仅有 texts 属性
        texts: [text]
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Legacy content')).toBeInTheDocument()
      })
    })

    it('supports older getTexts() method shape instead of getContent()', async () => {
      const text = makeText('legacy-gettexts', 'getTexts content')
      const page = {
        getTexts: vi.fn(async () => [text] as IntermediateContent[])
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('getTexts content')).toBeInTheDocument()
      })
      expect(page.getTexts).toHaveBeenCalledTimes(1)
    })

    it('renders both text and image content entries on the same loaded page', async () => {
      const text = makeText('mixed-text', 'Mixed page text')
      const image = makeImage('mixed-img', 'data:image/png;base64,mixed')
      const page = {
        getContent: vi.fn(async () => [text, image] as IntermediateContent[]),
        getThumbnail: vi.fn(async () => undefined)
      }
      const document = makeContentTestDocument(page)

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(screen.getByText('Mixed page text')).toBeInTheDocument()
      })
      const page1 = screen.getByTestId('intermediate-page-1')
      expect(
        page1.querySelector('.hamster-reader__intermediate-page-image')
      ).toBeInTheDocument()
      expect(
        page1.querySelector('.hamster-reader__intermediate-text')
      ).toBeInTheDocument()
    })

    it('does not load non-initial pages when initialLoadedPages=1', async () => {
      const page1 = {
        getContent: vi.fn(
          async () => [makeText('p1', 'Page 1')] as IntermediateContent[]
        ),
        getThumbnail: vi.fn(async () => undefined)
      }
      const page2 = {
        getContent: vi.fn(
          async () => [makeText('p2', 'Page 2')] as IntermediateContent[]
        ),
        getThumbnail: vi.fn(async () => undefined)
      }
      const document = {
        id: 'multi-doc',
        title: 'Multi',
        pageCount: 2,
        pageNumbers: [1, 2],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
        getPageByPageNumber: vi.fn((n: number) =>
          Promise.resolve(n === 1 ? page1 : page2)
        )
      } as unknown as IntermediateDocument

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(page1.getContent).toHaveBeenCalledTimes(1)
      })
      // 第二页不应被加载（initialLoadedPages 默认 1）
      expect(page2.getContent).not.toHaveBeenCalled()
      expect(screen.getByTestId('intermediate-page-2')).toBeEmptyDOMElement()
    })
  })
  // ---- end intermediate-document 内容渲染 ----

  // ---- intermediate-document 懒加载队列语义（任务 4）----
  // 队列项为页码，强制 pageLoadConcurrency 并发上限，去重 queued/in-flight/loaded，
  // 并通过 generation token 忽略 document 变更后的 stale async 结果。
  describe('intermediate-document lazy page queue', () => {
    beforeEach(() => {})

    // 构建一个多页 intermediate-document 测试文档，每页返回 deferred getContent，
    // 允许测试精确控制加载完成时机以验证并发语义。
    function makeDeferredPageDocument({ pageCount }: { pageCount: number }) {
      const pageNumbers = Array.from(
        { length: pageCount },
        (_, index) => index + 1
      )
      const pageDeferreds = new Map<
        number,
        {
          getContent: ReturnType<typeof vi.fn>
          getThumbnail: ReturnType<typeof vi.fn>
          resolveContent: (content: IntermediateContent[]) => void
        }
      >()

      pageNumbers.forEach((pageNumber) => {
        let resolveContent: (content: IntermediateContent[]) => void = () => {}
        const contentPromise = new Promise<IntermediateContent[]>((resolve) => {
          resolveContent = resolve
        })
        pageDeferreds.set(pageNumber, {
          getContent: vi.fn(() => contentPromise),
          getThumbnail: vi.fn(async () => undefined),
          resolveContent
        })
      })

      const document = {
        id: 'deferred-doc',
        title: 'Deferred Document',
        pageCount,
        pageNumbers,
        getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
        getPageByPageNumber: vi.fn((pageNumber: number) =>
          Promise.resolve({
            getContent: pageDeferreds.get(pageNumber)?.getContent,
            getThumbnail: pageDeferreds.get(pageNumber)?.getThumbnail
          })
        )
      } as unknown as IntermediateDocument

      return { document, pageDeferreds }
    }

    it('initialLoadedPages=1 loads only page 1 on mount, not page 100 of a 100-page doc', async () => {
      const { document, pageDeferreds } = makeDeferredPageDocument({
        pageCount: 100
      })

      render(<IntermediateDocumentViewer document={document} />)

      // 页 1 应被调用 getPageByPageNumber
      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })
      // 页 100 不应被加载
      expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(100)
      expect(pageDeferreds.get(100)?.getContent).not.toHaveBeenCalled()
    })

    it('no more than 3 page loads active at once with deferred promises', async () => {
      // initialLoadedPages=5 但 pageLoadConcurrency=3，仅 3 个应同时 in-flight
      const { document, pageDeferreds } = makeDeferredPageDocument({
        pageCount: 10
      })

      render(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={5}
          pageLoadConcurrency={3}
        />
      )

      // 等待 microtask 稳定
      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(2)
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(3)
      })

      // 恰好 3 页被调用 getPageByPageNumber（并发上限 3）
      expect(document.getPageByPageNumber).toHaveBeenCalledTimes(3)
      // 页 4、5 尚未入队（等待 3 个在途之一完成）
      expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(4)
      expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(5)
      // 页 1-3 的 getContent 已被调用（在途）
      expect(pageDeferreds.get(1)?.getContent).toHaveBeenCalled()
      expect(pageDeferreds.get(2)?.getContent).toHaveBeenCalled()
      expect(pageDeferreds.get(3)?.getContent).toHaveBeenCalled()
    })

    it('next queued page starts after an active load resolves', async () => {
      const { document, pageDeferreds } = makeDeferredPageDocument({
        pageCount: 10
      })

      render(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={5}
          pageLoadConcurrency={3}
        />
      )

      // 等待 3 个在途
      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledTimes(3)
      })

      // 解析页 1 的 getContent → 应触发页 4 入队
      pageDeferreds
        .get(1)
        ?.resolveContent([makeText('p1', 'Page 1') as IntermediateContent])

      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(4)
      })

      // 页 5 仍未入队（仍有 2 个在途：页 2、3）
      expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(5)
    })

    it('duplicate queue requests do not duplicate loader calls', async () => {
      const { document } = makeDeferredPageDocument({ pageCount: 3 })

      const { rerender } = render(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={1}
        />
      )

      // 等待页 1 入队
      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      const callsBeforeRerender = (
        document.getPageByPageNumber as ReturnType<typeof vi.fn>
      ).mock.calls.length

      // 重新渲染 → enqueueInitialPages 再次被调用
      rerender(
        <IntermediateDocumentViewer
          document={document}
          initialLoadedPages={1}
        />
      )

      // 等待 microtask
      await waitFor(() => {
        expect(
          (document.getPageByPageNumber as ReturnType<typeof vi.fn>).mock.calls
            .length
        ).toBeGreaterThanOrEqual(callsBeforeRerender)
      })

      // 页 1 不应被重复加载（已加载或在途 → 去重）
      const page1Calls = (
        document.getPageByPageNumber as ReturnType<typeof vi.fn>
      ).mock.calls.filter((call) => call[0] === 1).length
      expect(page1Calls).toBe(1)
    })

    it('stale results after document switch are ignored', async () => {
      const { document: doc1, pageDeferreds: deferreds1 } =
        makeDeferredPageDocument({ pageCount: 3 })
      const { document: doc2, pageDeferreds: deferreds2 } =
        makeDeferredPageDocument({ pageCount: 3 })

      const { rerender } = render(
        <IntermediateDocumentViewer document={doc1} initialLoadedPages={1} />
      )

      // 等待 doc1 页 1 入队
      await waitFor(() => {
        expect(doc1.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      // 切换到 doc2
      rerender(
        <IntermediateDocumentViewer document={doc2} initialLoadedPages={1} />
      )

      // 等待 doc2 页 1 入队
      await waitFor(() => {
        expect(doc2.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      // 解析 doc1 页 1 的 stale 结果
      deferreds1
        .get(1)
        ?.resolveContent([
          makeText('stale-p1', 'Stale Page 1') as IntermediateContent
        ])

      // 解析 doc2 页 1 的真实结果
      deferreds2
        .get(1)
        ?.resolveContent([
          makeText('fresh-p1', 'Fresh Page 1') as IntermediateContent
        ])

      // 等待 doc2 页 1 加载完成
      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-1').textContent).toContain(
          'Fresh Page 1'
        )
      })

      // doc1 的 stale 结果不应出现
      expect(screen.queryByText('Stale Page 1')).not.toBeInTheDocument()
    })

    it('stale images from old document are cleared on document switch', async () => {
      // doc1 页 1 包含 IntermediateImage 内容项
      const imageContent: IntermediateImage = {
        id: 'img-1',
        src: 'data:image/png;base64,old',
        polygon: [
          [0, 0],
          [50, 0],
          [50, 50],
          [0, 50]
        ],
        opacity: 1
      } as IntermediateImage

      const doc1 = {
        id: 'img-doc-1',
        title: 'Image Doc 1',
        pageCount: 1,
        pageNumbers: [1],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
        getPageByPageNumber: vi.fn(() =>
          Promise.resolve({
            getContent: vi.fn(async () => [imageContent]),
            getThumbnail: vi.fn(async () => undefined)
          })
        )
      } as unknown as IntermediateDocument

      // doc2 页 1 只有文本（无图片）
      const doc2 = {
        id: 'text-doc-2',
        title: 'Text Doc 2',
        pageCount: 1,
        pageNumbers: [1],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
        getPageByPageNumber: vi.fn(() =>
          Promise.resolve({
            getContent: vi.fn(async () => [
              makeText('fresh-text', 'Fresh Text') as IntermediateContent
            ]),
            getThumbnail: vi.fn(async () => undefined)
          })
        )
      } as unknown as IntermediateDocument

      const { rerender } = render(
        <IntermediateDocumentViewer document={doc1} />
      )

      // 等待 doc1 页 1 图片渲染
      await waitFor(() => {
        const img = screen
          .getByTestId('intermediate-page-1')
          .querySelector('.hamster-reader__intermediate-page-image')
        expect(img).toBeInTheDocument()
        expect(img).toHaveAttribute('src', 'data:image/png;base64,old')
      })

      // 切换到 doc2
      rerender(<IntermediateDocumentViewer document={doc2} />)

      // 等待 doc2 页 1 文本加载完成
      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-1').textContent).toContain(
          'Fresh Text'
        )
      })

      // doc1 的 stale 图片不应残留
      expect(
        screen
          .getByTestId('intermediate-page-1')
          .querySelector('.hamster-reader__intermediate-page-image')
      ).not.toBeInTheDocument()
    })
  })
  // ---- end intermediate-document 懒加载队列语义 ----

  // ---- intermediate-document 可见性 500ms 防抖与快速滚动取消（任务 5）----
  // 非初始页面需持续可见 pageLoadEnterDelayMs（默认 500ms）才会入队加载；
  // 页面在定时器触发前离开可加载窗口则取消挂起入队，保持空外壳。
  // 快速滚动经过多页不应把所有路过页面都入队。所有定时器在 unmount 与
  // document 变更时被清除，杜绝迟到入队。
  describe('intermediate-document visibility 500ms enqueue debounce', () => {
    beforeEach(() => {})

    // 注意：React 19 + testing-library 的 render/rerender 与 async act 在
    // vi.useFakeTimers() 下会因 React 内部 setTimeout(0) 不触发而挂死。故先以
    // 真实定时器 render 并用 waitFor 等待初始页加载稳态，再切入 fake timers
    // 测防抖，全程使用同步 act(() => vi.advanceTimersByTime(N))；任何 rerender
    // 必须先切回真实定时器。sync act 不会排空多 tick promise 链，故 getContent
    // 断言前用纯 microtask flush 推进队列的 async 加载链。

    // 纯微任务刷新（不依赖 fake/real timers，不触发 React 内部 act 定时器），
    // 用于在 sync act 推进假定时器后让队列的 getPageByPageNumber -> getContent
    // promise 链落地，以便断言 getContent 被调用。
    const flushQueueMicrotasks = async () => {
      for (let i = 0; i < 20; i += 1) {
        await Promise.resolve()
      }
    }

    it('page must remain continuously visible for 500ms before enqueueing (enter -> 499ms -> no load; -> 500ms -> load)', async () => {
      const { document, pages } = makeDocument({ pageCount: 3 })

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      vi.useFakeTimers()
      try {
        // 页 3 进入可加载窗口 → 启动 500ms 定时器
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        act(() => {
          vi.advanceTimersByTime(499)
        })
        expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(3)
        expect(pages.get(3)?.getContent).not.toHaveBeenCalled()

        // 继续推进到 500ms，页面仍可见 → 定时器触发 → enqueuePage → 加载
        act(() => {
          vi.advanceTimersByTime(1)
        })
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(3)
        // sync act 不排空多 tick promise 链，手动 flush 让 getContent 落地
        await flushQueueMicrotasks()
        expect(pages.get(3)?.getContent).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('page leaving before 500ms cancels pending enqueue (no load even after timers advance)', async () => {
      const { document, pages } = makeDocument({ pageCount: 3 })

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        act(() => {
          vi.advanceTimersByTime(400)
        })
        expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(3)

        // 页 3 在 500ms 前离开 → 取消挂起入队
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3'),
          false
        )
        act(() => {
          vi.advanceTimersByTime(2000)
        })
        await flushQueueMicrotasks()
        expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(3)
        expect(pages.get(3)?.getContent).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('fast scroll across many pages only loads initial pages (all transient pages leave before 500ms)', async () => {
      const pageCount = 10
      const { document } = makeDocument({ pageCount })

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      vi.useFakeTimers()
      try {
        // 快速滚动：每页短暂进入再离开（每页可见 <500ms）
        for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
          const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
          intersectionObserverMock.trigger(page)
          act(() => {
            vi.advanceTimersByTime(100)
          })
          intersectionObserverMock.trigger(page, false)
        }

        act(() => {
          vi.advanceTimersByTime(3000)
        })
        await flushQueueMicrotasks()

        // 仅初始页 1 被加载；页 2..10 均因 <500ms 离开被取消，不应入队
        const getPage = document.getPageByPageNumber as ReturnType<typeof vi.fn>
        const calledPageNumbers = Array.from(
          new Set(getPage.mock.calls.map((call) => call[0]))
        )
        expect(calledPageNumbers).toEqual([1])
      } finally {
        vi.useRealTimers()
      }
    })

    it('pending visibility timers are cleared on unmount (no late enqueue after unmount)', async () => {
      const { document, pages } = makeDocument({ pageCount: 3 })

      const { unmount } = render(
        <IntermediateDocumentViewer document={document} />
      )

      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        act(() => {
          vi.advanceTimersByTime(400)
        })

        unmount()

        const callsBefore = (
          document.getPageByPageNumber as ReturnType<typeof vi.fn>
        ).mock.calls.length

        act(() => {
          vi.advanceTimersByTime(2000)
        })
        await flushQueueMicrotasks()
        expect(
          (document.getPageByPageNumber as ReturnType<typeof vi.fn>).mock.calls
            .length
        ).toBe(callsBefore)
        expect(pages.get(3)?.getContent).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('pending visibility timers are cleared on document switch (no late enqueue after document change)', async () => {
      const { document: doc1 } = makeDocument({ pageCount: 3 })
      const { document: doc2, pages: pages2 } = makeDocument({ pageCount: 3 })

      const { rerender } = render(
        <IntermediateDocumentViewer document={doc1} />
      )

      await waitFor(() => {
        expect(doc1.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        act(() => {
          vi.advanceTimersByTime(400)
        })

        // rerender 必须在真实定时器下进行（RTL rerender 内部 act 在 fake
        // timers 下会挂死）；切到真实定时器后 rerender，IO effect cleanup 会
        // 清除 doc1 页 3 的挂起可见性定时器。
        vi.useRealTimers()
        rerender(<IntermediateDocumentViewer document={doc2} />)

        await waitFor(() => {
          expect(doc2.getPageByPageNumber).toHaveBeenCalledWith(1)
        })

        // 再切回 fake timers 推进远超 500ms，确认 doc1 页 3 的迟到入队未触发
        vi.useFakeTimers()
        act(() => {
          vi.advanceTimersByTime(2000)
        })
        await flushQueueMicrotasks()
        expect(doc1.getPageByPageNumber).not.toHaveBeenCalledWith(3)
        // doc2 页 3 也未被防抖入队（未进入可见窗口）
        expect(doc2.getPageByPageNumber).not.toHaveBeenCalledWith(3)
        expect(pages2.get(3)?.getContent).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('adjusting pageLoadEnterDelayMs applies the new debounce duration', async () => {
      const { document, pages } = makeDocument({ pageCount: 3 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageLoadEnterDelayMs={300}
        />
      )

      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        act(() => {
          vi.advanceTimersByTime(299)
        })
        expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(3)

        act(() => {
          vi.advanceTimersByTime(1)
        })
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(3)
        await flushQueueMicrotasks()
        expect(pages.get(3)?.getContent).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
  // ---- end intermediate-document 可见性 500ms 防抖 ----

  // ---- intermediate-document 离屏延迟卸载 5000ms ----
  describe('intermediate-document offscreen lazy release', () => {
    beforeEach(() => {})

    // 定义 deferred 页面文档辅助：每页返回 deferred getContent promise，
    // 允许精确控制加载完成时机以验证 in-flight 保护语义。
    function makeDeferredPageDocument({ pageCount }: { pageCount: number }) {
      const pageNumbers = Array.from(
        { length: pageCount },
        (_, index) => index + 1
      )
      const pageDeferreds = new Map<
        number,
        {
          getContent: ReturnType<typeof vi.fn>
          resolveContent: (content: IntermediateContent[]) => void
        }
      >()

      pageNumbers.forEach((pageNumber) => {
        let resolveContent: (content: IntermediateContent[]) => void = () => {}
        const contentPromise = new Promise<IntermediateContent[]>((resolve) => {
          resolveContent = resolve
        })
        pageDeferreds.set(pageNumber, {
          getContent: vi.fn(() => contentPromise),
          resolveContent
        })
      })

      const document = {
        id: 'deferred-doc',
        title: 'Deferred Document',
        pageCount,
        pageNumbers,
        getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
        getPageByPageNumber: vi.fn((pageNumber: number) =>
          Promise.resolve({
            getContent: pageDeferreds.get(pageNumber)?.getContent
          })
        )
      } as unknown as IntermediateDocument

      return { document, pageDeferreds }
    }

    it('leave -> 4999ms keeps content; 5000ms unloads to shell', async () => {
      const { document } = makeDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageLoadEnterDelayMs={0}
          overscan={0}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      // 把页 1 标记为可见，确保卸载页 3 时 protectedPages 不包含页 3
      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-1')
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // 使用真实定时器加载页 3（pageLoadEnterDelayMs=0 立即入队）
      // 必须在 async act 内触发 + 等待，因为 enqueue 通过 setTimeout(0) →
      // promise 链在 act 外执行，React 19 不会 flush 这些 setState
      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        // 等待 setTimeout(0) 触发 enqueue → promise 链落地
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(screen.getByText('Page 3 text')).toBeInTheDocument()

      vi.useFakeTimers()
      try {
        // 页 3 离开 → 启动 5000ms 卸载定时器
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3'),
          false
        )

        // 4999ms 后内容仍在
        act(() => {
          vi.advanceTimersByTime(4999)
        })
        expect(screen.getByText('Page 3 text')).toBeInTheDocument()

        // 再推 1ms（总计 5000ms）→ 卸载到空外壳
        act(() => {
          vi.advanceTimersByTime(1)
        })
        expect(screen.queryByText('Page 3 text')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('re-enter before 5000ms cancels unload (content persists past 5000ms)', async () => {
      const { document } = makeDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageLoadEnterDelayMs={0}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(screen.getByText('Page 3 text')).toBeInTheDocument()

      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3'),
          false
        )
        act(() => {
          vi.advanceTimersByTime(3000)
        })
        expect(screen.getByText('Page 3 text')).toBeInTheDocument()

        // 页 3 重新进入 → 取消卸载定时器
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        // 推过 5000ms（原卸载定时器应已被取消）
        act(() => {
          vi.advanceTimersByTime(5000)
        })
        expect(screen.getByText('Page 3 text')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('in-flight page does not unload ( getContent deferred while unload timer fires )', async () => {
      const { document, pageDeferreds } = makeDeferredPageDocument({
        pageCount: 5
      })

      render(<IntermediateDocumentViewer document={document} />)

      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      // 页 1 的 getContent 是 deferred → 页 1 处于 in-flight
      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-1'),
          false
        )
        // 5000ms 后定时器触发 → 但页 1 仍在 in-flight → 不应卸载
        act(() => {
          vi.advanceTimersByTime(5000)
        })

        // resolve 页 1 → 页 1 加载完成（证明未被卸载）
        vi.useRealTimers()
        pageDeferreds
          .get(1)
          ?.resolveContent([
            makeText('text-1', 'Page 1 text') as IntermediateContent
          ])
        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })
        vi.useFakeTimers()
      } finally {
        vi.useRealTimers()
      }
    })

    it('overscan-protected page does not unload when nearby visible page keeps it in protected window', async () => {
      const { document } = makeDocument({ pageCount: 5 })

      render(
        <IntermediateDocumentViewer
          document={document}
          overscan={1}
          pageLoadEnterDelayMs={0}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(screen.getByText('Page 3 text')).toBeInTheDocument()

      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-4')
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(screen.getByText('Page 4 text')).toBeInTheDocument()

      vi.useFakeTimers()
      try {
        // 页 3 离开 → 启动卸载定时器（但页 4 仍可见，overscan=1 保护页 3）
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3'),
          false
        )
        act(() => {
          vi.advanceTimersByTime(5000)
        })
        // 页 3 被 protectedPages 保护 → 不卸载
        expect(screen.getByText('Page 3 text')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    describe('active linked selection lazy release', () => {
      beforeEach(() => {
        clearSelectionProps()
      })

      afterEach(() => {
        clearSelectionProps()
      })

      it('keeps an offscreen page loaded while its linked activeRange is selecting text', async () => {
        // Given: page 3 is loaded and has a runtime linked Selection id.
        const { document } = makeDocument({ pageCount: 5 })

        render(
          <IntermediateDocumentViewer
            document={document}
            pageLoadEnterDelayMs={0}
            overscan={0}
          />
        )

        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })

        await act(async () => {
          intersectionObserverMock.trigger(
            screen.getByTestId('intermediate-page-3')
          )
          await new Promise((resolve) => setTimeout(resolve, 50))
        })
        expect(screen.getByText('Page 3 text')).toBeInTheDocument()

        const page3Id = await waitFor(() =>
          requireRuntimeSelectionId(':page-3')
        )
        const linkedData = requireSelectionPropsById(page3Id).linkedData
        if (!linkedData) {
          throw new Error('Expected linked data for page 3')
        }

        // When: linked selection is actively selecting text on page 3.
        const activeRange = makeRuntimeLinkedRange(page3Id, {
          id: 'als-happy-active-range'
        })
        act(() => {
          simulateLinkedDataChange(page3Id, {
            ...linkedData,
            activeRange,
            selectingText: true
          })
        })
        await waitFor(() => {
          expect(
            requireSelectionPropsById(page3Id).linkedData?.activeRange?.id
          ).toBe('als-happy-active-range')
        })

        await act(async () => {
          intersectionObserverMock.trigger(
            screen.getByTestId('intermediate-page-1')
          )
          await new Promise((resolve) => setTimeout(resolve, 50))
        })

        vi.useFakeTimers()
        try {
          intersectionObserverMock.trigger(
            screen.getByTestId('intermediate-page-3'),
            false
          )
          act(() => {
            vi.advanceTimersByTime(5000)
          })

          // Then: active linked selection should protect the offscreen page.
          expect(screen.getByText('Page 3 text')).toBeInTheDocument()
        } finally {
          vi.useRealTimers()
        }
      })

      it('keeps every page between activeRange endpoints loaded while selecting across pages', async () => {
        // Given: pages 2, 3, and 4 are loaded before the cross-page drag leaves view.
        const { document } = makeDocument({ pageCount: 5 })

        render(
          <IntermediateDocumentViewer
            document={document}
            pageLoadEnterDelayMs={0}
            overscan={0}
          />
        )

        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })

        for (const pageNumber of [2, 3, 4]) {
          await act(async () => {
            intersectionObserverMock.trigger(
              screen.getByTestId(`intermediate-page-${pageNumber}`)
            )
            await new Promise((resolve) => setTimeout(resolve, 50))
          })
          expect(
            screen.getByText(`Page ${pageNumber} text`)
          ).toBeInTheDocument()
        }

        const page2Id = await waitFor(() =>
          requireRuntimeSelectionId(':page-2')
        )
        const page4Id = await waitFor(() =>
          requireRuntimeSelectionId(':page-4')
        )
        const linkedData = requireSelectionPropsById(page2Id).linkedData
        if (!linkedData) {
          throw new Error('Expected linked data for page 2')
        }

        // When: activeRange spans from page 2 to page 4.
        const activeRange = makeRuntimeLinkedRange(page2Id, {
          id: 'als-span-active-range',
          end: { selectionId: page4Id, offset: 11 },
          rectsBySelectionId: {
            [page2Id]: [{ x: 1, y: 2, width: 3, height: 4 }],
            [page4Id]: [{ x: 5, y: 6, width: 7, height: 8 }]
          }
        })
        act(() => {
          simulateLinkedDataChange(page2Id, {
            ...linkedData,
            activeRange,
            selectingText: true
          })
        })
        await waitFor(() => {
          expect(
            requireSelectionPropsById(page2Id).linkedData?.activeRange?.id
          ).toBe('als-span-active-range')
        })

        await act(async () => {
          intersectionObserverMock.trigger(
            screen.getByTestId('intermediate-page-1')
          )
          await new Promise((resolve) => setTimeout(resolve, 50))
        })

        vi.useFakeTimers()
        try {
          for (const pageNumber of [2, 3, 4]) {
            intersectionObserverMock.trigger(
              screen.getByTestId(`intermediate-page-${pageNumber}`),
              false
            )
          }
          act(() => {
            vi.advanceTimersByTime(5000)
          })

          // Then: both endpoints and the page between them stay loaded.
          expect(screen.getByText('Page 2 text')).toBeInTheDocument()
          expect(screen.getByText('Page 3 text')).toBeInTheDocument()
          expect(screen.getByText('Page 4 text')).toBeInTheDocument()
        } finally {
          vi.useRealTimers()
        }
      })

      it('evicts an unrelated offscreen page while another page has an active linked selection', async () => {
        // Given: pages 3 and 4 are both loaded, but only page 3 owns the activeRange.
        const { document } = makeDocument({ pageCount: 5 })

        render(
          <IntermediateDocumentViewer
            document={document}
            pageLoadEnterDelayMs={0}
            overscan={0}
          />
        )

        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })

        for (const pageNumber of [3, 4]) {
          await act(async () => {
            intersectionObserverMock.trigger(
              screen.getByTestId(`intermediate-page-${pageNumber}`)
            )
            await new Promise((resolve) => setTimeout(resolve, 50))
          })
          expect(
            screen.getByText(`Page ${pageNumber} text`)
          ).toBeInTheDocument()
        }

        const page3Id = await waitFor(() =>
          requireRuntimeSelectionId(':page-3')
        )
        const linkedData = requireSelectionPropsById(page3Id).linkedData
        if (!linkedData) {
          throw new Error('Expected linked data for page 3')
        }

        // When: page 3 has an active linked selection and page 4 is unrelated.
        const activeRange = makeRuntimeLinkedRange(page3Id, {
          id: 'als-regress-active-range'
        })
        act(() => {
          simulateLinkedDataChange(page3Id, {
            ...linkedData,
            activeRange,
            selectingText: true
          })
        })
        await waitFor(() => {
          expect(
            requireSelectionPropsById(page3Id).linkedData?.activeRange?.id
          ).toBe('als-regress-active-range')
        })

        await act(async () => {
          intersectionObserverMock.trigger(
            screen.getByTestId('intermediate-page-1')
          )
          await new Promise((resolve) => setTimeout(resolve, 50))
        })

        vi.useFakeTimers()
        try {
          for (const pageNumber of [3, 4]) {
            intersectionObserverMock.trigger(
              screen.getByTestId(`intermediate-page-${pageNumber}`),
              false
            )
          }
          act(() => {
            vi.advanceTimersByTime(5000)
          })

          // Then: active page remains, unrelated offscreen page is evicted.
          expect(screen.getByText('Page 3 text')).toBeInTheDocument()
          expect(screen.queryByText('Page 4 text')).not.toBeInTheDocument()
        } finally {
          vi.useRealTimers()
        }
      })
    })

    it('stale async result after unload does not repopulate page', async () => {
      const { document, pageDeferreds } = makeDeferredPageDocument({
        pageCount: 5
      })

      render(
        <IntermediateDocumentViewer
          document={document}
          pageLoadEnterDelayMs={0}
          overscan={0}
        />
      )

      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      // resolve 初始页 1 → 加载完成
      pageDeferreds
        .get(1)
        ?.resolveContent([
          makeText('text-1', 'Page 1 text') as IntermediateContent
        ])
      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-1')
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // 页 3 进入 → 加载开始（getContent deferred）
      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(pageDeferreds.get(3)?.getContent).toHaveBeenCalled()

      // resolve 页 3 → 加载完成
      pageDeferreds
        .get(3)
        ?.resolveContent([
          makeText('text-3', 'Page 3 text') as IntermediateContent
        ])
      await waitFor(() => {
        expect(screen.getByText('Page 3 text')).toBeInTheDocument()
      })

      vi.useFakeTimers()
      try {
        // 页 3 离开 → 5000ms → 卸载
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3'),
          false
        )
        act(() => {
          vi.advanceTimersByTime(5000)
        })
        expect(screen.queryByText('Page 3 text')).not.toBeInTheDocument()

        // stale resolve 页 3 → 不应重新填充（promise 只 resolve 一次；
        // 重新加载需重新进入可见窗口触发新的 enqueuePage）
        vi.useRealTimers()
        pageDeferreds
          .get(3)
          ?.resolveContent([
            makeText('text-3-stale', 'Page 3 stale') as IntermediateContent
          ])
        await act(async () => {
          await Promise.resolve()
        })
        expect(screen.queryByText('Page 3 stale')).not.toBeInTheDocument()
        expect(screen.queryByText('Page 3 text')).not.toBeInTheDocument()
        vi.useFakeTimers()
      } finally {
        vi.useRealTimers()
      }
    })

    it('stale OCR result after unload is ignored (evictedOcrPagesRef guard)', async () => {
      const { ImageParser } = await import('@hamster-note/image-parser')
      const encodeSpy = vi.mocked(ImageParser.encode)
      encodeSpy.mockClear()

      // OCR 需要通过 fetch 获取 base image blob，必须 mock fetch
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(new Blob(['image'])))

      // OCR 延迟解析：mockImplementationOnce 使第一次 encode 调用返回
      // deferred promise，允许测试在 unload 后才 resolve，验证 stale guard。
      let resolveOcr: (doc: IntermediateDocument) => void = () => {}
      encodeSpy.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOcr = resolve
          })
      )

      // 页 1 无 thumbnail → 不触发 OCR，避免消耗 mockImplementationOnce。
      // 仅页 3 有 thumbnail，确保第一次 encode 调用属于页 3。
      const pageWithThumbnail = {
        getContent: vi.fn(
          async () =>
            [makeText('text-3', 'Page 3 text')] as IntermediateContent[]
        ),
        thumbnail: 'data:image/png;base64,thumb-3'
      }
      const document = {
        id: 'doc-ocr-deferred',
        title: 'OCR Deferred',
        pageCount: 5,
        pageNumbers: [1, 2, 3, 4, 5],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
        getPageByPageNumber: vi.fn((pn: number) => {
          if (pn === 1) {
            return Promise.resolve({
              getContent: vi.fn(
                async () =>
                  [makeText('text-1', 'Page 1 text')] as IntermediateContent[]
              )
            })
          }
          if (pn === 3) {
            return Promise.resolve(pageWithThumbnail)
          }
          return Promise.resolve({
            getContent: vi.fn(async () => [])
          })
        })
      } as unknown as IntermediateDocument

      render(
        <IntermediateDocumentViewer
          document={document}
          ocr
          pageLoadEnterDelayMs={0}
          overscan={0}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-1')
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // 页 3 进入 → 加载 → 有 base image → OCR 启动（deferred）
      await act(async () => {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3')
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(screen.getByText('Page 3 text')).toBeInTheDocument()
      await waitFor(() => {
        expect(encodeSpy).toHaveBeenCalledTimes(1)
      })

      // resolve OCR → 填充 OCR texts
      const mockOcrDoc = {
        id: 'ocr-doc-3',
        title: 'OCR Page 3',
        pageCount: 1,
        pageNumbers: [1],
        pages: [
          {
            id: 'ocr-page-3',
            number: 1,
            width: 100,
            height: 150,
            content: [makeText('ocr-3', 'OCR 3')]
          }
        ],
        getPageSizeByPageNumber: () => ({ x: 100, y: 150 }),
        getPageByPageNumber: () =>
          Promise.resolve({ getContent: async () => [] })
      } as unknown as IntermediateDocument

      resolveOcr(mockOcrDoc)
      await waitFor(() => {
        expect(screen.getByText('OCR 3')).toBeInTheDocument()
      })

      vi.useFakeTimers()
      try {
        // 页 3 离开 → 5000ms → 卸载
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-3'),
          false
        )
        act(() => {
          vi.advanceTimersByTime(5000)
        })
        // 页 3 内容和 OCR texts 均被清除
        expect(screen.queryByText('Page 3 text')).not.toBeInTheDocument()
        expect(screen.queryByText('OCR 3')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }

      // stale OCR 不会重新出现（evictedOcrPagesRef guard）
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.queryByText('OCR 3')).not.toBeInTheDocument()
      encodeSpy.mockRestore()
      fetchSpy.mockRestore()
    })

    it('maxLoadedPages evicts oldest eligible offscreen page while protecting visible pages', async () => {
      const idleCallback = installQueuedIdleCallback()

      try {
        const { document } = makeDocument({ pageCount: 10 })

        // getEffectiveMaxLoadedPages 有最低下限 5，因此 maxLoadedPages=5
        // 时 effective cap = max(5, floorCount, 5) = 5。需要 >5 页已加载
        // 才会触发驱逐。
        render(
          <IntermediateDocumentViewer
            document={document}
            maxLoadedPages={5}
            initialLoadedPages={5}
            overscan={0}
            pageLoadEnterDelayMs={0}
            pageUnloadDelayMs={60000}
          />
        )

        // 等 5 个初始页加载
        await waitFor(() => {
          expect(screen.getByText('Page 5 text')).toBeInTheDocument()
        })

        // 所有 5 页都标记为可见然后离开
        await act(async () => {
          for (let pn = 1; pn <= 5; pn += 1) {
            intersectionObserverMock.trigger(
              screen.getByTestId(`intermediate-page-${pn}`)
            )
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        })

        for (let pn = 1; pn <= 5; pn += 1) {
          intersectionObserverMock.trigger(
            screen.getByTestId(`intermediate-page-${pn}`),
            false
          )
        }

        // 页 7 进入可见 → 加载 → 6 页 > cap 5
        await act(async () => {
          intersectionObserverMock.trigger(
            screen.getByTestId('intermediate-page-7')
          )
          await new Promise((resolve) => setTimeout(resolve, 50))
        })
        expect(screen.getByText('Page 7 text')).toBeInTheDocument()

        // 刷新 idle callback 触发 maxLoadedPages 驱逐
        await idleCallback.flush()

        // 页 1 应被驱逐（最旧的离屏未保护页）
        await waitFor(() => {
          expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()
        })

        // 页 7（可见）应保留
        expect(screen.getByText('Page 7 text')).toBeInTheDocument()
      } finally {
        idleCallback.restore()
      }
    })
  })
  // ---- end intermediate-document 离屏延迟卸载 5000ms ----

  describe('intermediate-document render timing integration', () => {
    beforeEach(() => {
      delete process.env.READER_RENDER_TIMING_DEBUG
    })

    type ReaderTimingTestProps = {
      readonly document: IntermediateDocument
      readonly onIntermediateDocumentRenderTiming?: IntermediateDocumentTimingCallback
      readonly initialLoadedPages?: number
      readonly pageLoadEnterDelayMs?: number
      readonly pageUnloadDelayMs?: number
      readonly ocr?: boolean
      readonly overscan?: number
    }

    const ReaderWithTiming = (props: ReaderTimingTestProps) => (
      <Reader {...props} />
    )

    it('reports timing entries for document resolution, shell rendering, initial loading, content extraction, and page rendering', async () => {
      // Given: the callback is enabled for the intermediate-document Reader path.
      const onTiming = makeTimingSpy()
      const { document } = makeDocument({ pageCount: 1 })

      // When: the first page loads through the initial-page pipeline.
      render(
        <ReaderWithTiming
          document={document}
          onIntermediateDocumentRenderTiming={onTiming}
          initialLoadedPages={1}
        />
      )

      await screen.findByText('Page 1 text')

      // Then: all happy-path timing stages are emitted with valid timing fields.
      const entries = getTimingEntries(onTiming)
      for (const stage of [
        'document-resolution',
        'shell-rendering',
        'initial-page-loading',
        'content-extraction',
        'page-content-rendering'
      ] as const) {
        expectFiniteTimingEntry(requireTimingStage(entries, stage))
      }

      for (const stage of [
        'initial-page-loading',
        'content-extraction',
        'page-content-rendering'
      ] as const) {
        expect(requirePageTimingStage(entries, stage, 1).pageNumber).toBe(1)
      }

      entries.forEach(expectFiniteTimingEntry)
    })

    it('reports page content rendering only for initially loaded pages', async () => {
      // Given: the document has more shells than the configured initial page load count.
      const onTiming = makeTimingSpy()
      const { document } = makeDocument({ pageCount: 3 })

      // When: intermediate-document mounts with only page 1 in the initial lazy batch.
      render(
        <ReaderWithTiming
          document={document}
          onIntermediateDocumentRenderTiming={onTiming}
          initialLoadedPages={1}
        />
      )

      await screen.findByText('Page 1 text')
      expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()
      expect(screen.queryByText('Page 3 text')).not.toBeInTheDocument()

      // Then: page-content-rendering is scoped to the loaded page, not every empty shell.
      const entries = getTimingEntries(onTiming)
      expect(
        getPageTimingEntries(entries, 'page-content-rendering', 1)
      ).toHaveLength(1)
      expect(
        getPageTimingEntries(entries, 'page-content-rendering', 2)
      ).toHaveLength(0)
      expect(
        getPageTimingEntries(entries, 'page-content-rendering', 3)
      ).toHaveLength(0)
    })

    it('does not report page content rendering again for unchanged loaded pages during transform', async () => {
      // Given: page 1 has already rendered its loaded content once.
      const onTiming = makeTimingSpy()
      const { document } = makeDocument({ pageCount: 3 })

      render(
        <ReaderWithTiming
          document={document}
          onIntermediateDocumentRenderTiming={onTiming}
          initialLoadedPages={1}
        />
      )

      await screen.findByText('Page 1 text')
      const beforeTransformEntries = getTimingEntries(onTiming)
      expect(
        getPageTimingEntries(
          beforeTransformEntries,
          'page-content-rendering',
          1
        )
      ).toHaveLength(1)

      // When: VirtualPaper reports a transform change but visible loaded content is unchanged.
      act(() => {
        VirtualPaper.__triggerTransform(
          screen.getByTestId('virtual-paper-container'),
          {
            x: -16,
            y: 0,
            scale: 1
          }
        )
      })
      await flushIntermediateDocumentMicrotasks()

      // Then: shell timing may update, but page-content-rendering is not re-emitted.
      const afterTransformEntries = getTimingEntries(onTiming)
      expect(
        getPageTimingEntries(afterTransformEntries, 'page-content-rendering', 1)
      ).toHaveLength(1)
      expect(
        getPageTimingEntries(afterTransformEntries, 'page-content-rendering', 2)
      ).toHaveLength(0)
      expect(
        getPageTimingEntries(afterTransformEntries, 'page-content-rendering', 3)
      ).toHaveLength(0)
    })

    it('reports visibility lazy-loading and page 2 content extraction timing after delayed intersection', async () => {
      // Given: page 2 is outside the initial page set and needs the visibility delay.
      const onTiming = makeTimingSpy()
      const { document } = makeDocument({ pageCount: 2 })

      render(
        <ReaderWithTiming
          document={document}
          onIntermediateDocumentRenderTiming={onTiming}
          initialLoadedPages={1}
          pageLoadEnterDelayMs={20}
        />
      )

      await screen.findByText('Page 1 text')

      // When: page 2 remains visible past the configured enter delay.
      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(
          screen.getByTestId('intermediate-page-2')
        )
        act(() => {
          vi.advanceTimersByTime(20)
        })
        await flushIntermediateDocumentMicrotasks()
      } finally {
        vi.useRealTimers()
      }

      await screen.findByText('Page 2 text')

      // Then: visibility loading and content extraction are both page-scoped.
      const entries = getTimingEntries(onTiming)
      expectFiniteTimingEntry(
        requirePageTimingStage(entries, 'visibility-lazy-loading', 2)
      )
      expectFiniteTimingEntry(
        requirePageTimingStage(entries, 'content-extraction', 2)
      )
      expect(entries.length).toBeGreaterThanOrEqual(2)
    })

    it('reports offscreen unload timing when a loaded page leaves the viewport past the delay', async () => {
      // Given: enough pages are loaded for a later page to be unloaded independently.
      const onTiming = makeTimingSpy()
      const { document } = makeDocument({ pageCount: 3 })

      render(
        <ReaderWithTiming
          document={document}
          onIntermediateDocumentRenderTiming={onTiming}
          initialLoadedPages={3}
          pageUnloadDelayMs={20}
          overscan={0}
        />
      )

      await screen.findByText('Page 2 text')
      const page2 = screen.getByTestId('intermediate-page-2')

      // When: the loaded page stays offscreen past the unload delay.
      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(page2, false)
        act(() => {
          vi.advanceTimersByTime(20)
        })
      } finally {
        vi.useRealTimers()
      }

      // Then: the unload stage is reported for the page that left view.
      const entries = getTimingEntries(onTiming)
      expectFiniteTimingEntry(
        requirePageTimingStage(entries, 'offscreen-unload', 2)
      )
      expect(entries.length).toBeGreaterThanOrEqual(1)
    })

    it('reports OCR processing timing for a visible page with a base image', async () => {
      // Given: OCR is enabled and the loaded page has a thumbnail/base image.
      const { ImageParser } = await import('@hamster-note/image-parser')
      const encodeSpy = vi.mocked(ImageParser.encode)
      encodeSpy.mockClear()
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(new Blob(['image'])))
      const onTiming = makeTimingSpy()
      const { document, pages } = makeDocument({ pageCount: 1 })
      const page1 = pages.get(1)
      if (!page1) {
        throw new Error('Expected mock page 1 to exist')
      }
      page1.thumbnail = 'data:image/png;base64,page-1'

      try {
        render(
          <ReaderWithTiming
            document={document}
            onIntermediateDocumentRenderTiming={onTiming}
            initialLoadedPages={1}
            ocr
          />
        )

        const pageElement = screen.getByTestId('intermediate-page-1')
        await waitFor(() => {
          expect(
            pageElement.querySelector(
              '.hamster-reader__intermediate-page-base-image'
            )
          ).toBeInTheDocument()
        })

        // When: the page becomes visible and OCR starts.
        intersectionObserverMock.trigger(pageElement)

        await waitFor(() => {
          expect(encodeSpy).toHaveBeenCalled()
        })

        // Then: OCR processing timing is emitted for that page.
        const entries = getTimingEntries(onTiming)
        expectFiniteTimingEntry(
          requirePageTimingStage(entries, 'ocr-processing', 1)
        )
      } finally {
        fetchSpy.mockRestore()
      }
    })

    it('does not log timing output by default when no callback and no env flag are provided', async () => {
      // Given: timing debug output is disabled by default.
      const consoleDebugSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {})
      const { document } = makeDocument({ pageCount: 1 })

      try {
        // When: the Reader renders without a timing callback.
        render(<Reader document={document} initialLoadedPages={1} />)

        await screen.findByText('Page 1 text')

        // Then: no timing fallback log is emitted.
        expect(consoleDebugSpy).not.toHaveBeenCalled()
      } finally {
        consoleDebugSpy.mockRestore()
      }
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

    const rectSpies: ReturnType<typeof vi.spyOn>[] = []

    beforeEach(() => {
      vi.restoreAllMocks()
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

    const renderThreePageSelectionFixture = async (
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
      render(<IntermediateDocumentViewer document={mockDoc} {...props} />)

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

    it('provides a three-page fixture for direct-render selection only with stable data attributes and rects', async () => {
      await renderThreePageSelectionFixture()
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
      await renderThreePageSelectionFixture({ onTextSelectionEnd })
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
      await renderThreePageSelectionFixture({
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
      await renderThreePageSelectionFixture({ onSelectText })
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

    it('mouse blank drag start near last word does not snap to same-page last text', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageSelectionFixture({
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
      await renderThreePageSelectionFixture({
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
      await renderThreePageSelectionFixture({
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

    // Task 6 — live handle drag / chrome hit-testing / selector reuse
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

    it('SCSS suppresses native mobile selection handles on coarse pointers', () => {
      const scssSource = fs.readFileSync(
        path.resolve(__dirname, '../src/styles/reader.scss'),
        'utf-8'
      )
      const coarsePointerBlockMatch = scssSource.match(
        /@media\s*\(pointer:\s*coarse\)\s*\{([^}]*)\}/
      )
      expect(coarsePointerBlockMatch).toBeTruthy()
      if (!coarsePointerBlockMatch) {
        throw new Error('Expected coarse-pointer SCSS block to exist')
      }

      const block = coarsePointerBlockMatch[1]
      expect(block).toContain('&__intermediate-text')
      expect(block).toContain('.hsn-selection-content &__intermediate-text')
      expect(block).toContain('&__html-parser-output')
      expect(block).toContain('&__html-parser-output .hamster-note-page')
      expect(block).toContain('&__html-parser-output .hamster-note-page *')
      expect(block).toContain('user-select: none')
      expect(block).toContain('-webkit-user-select: none')
      expect(block).toContain('-webkit-touch-callout: none')
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

describe('selection overlayRectType integration', () => {
  beforeEach(() => {
    clearSelectionProps()
  })

  afterEach(() => {
    clearSelectionProps()
  })

  it('accepts overlayRectType values at type level', () => {
    const percentValue: OverlayRectType = 'percent'
    const pxValue: OverlayRectType = 'px'
    expect(percentValue).toBe('percent')
    expect(pxValue).toBe('px')
  })
})

describe('linked data adapter integration', () => {
  beforeEach(() => {
    clearSelectionProps()
  })

  afterEach(() => {
    clearSelectionProps()
  })

  it('keeps normalized mounted selection order across intermediate rerenders', async () => {
    // Given: only the first lazy page has mounted a linked Selection instance.
    const { document } = makeDocument({ pageCount: 3 })

    const { rerender } = render(
      <IntermediateDocumentViewer document={document} initialLoadedPages={1} />
    )

    await waitFor(() => {
      expect(getAllSelectionProps()).toHaveLength(1)
    })
    const runtimePage1Id = requireRuntimeSelectionId(':page-1')
    const currentLinkedData =
      requireSelectionPropsById(runtimePage1Id).linkedData
    if (!currentLinkedData) {
      throw new Error('Expected linked data for mounted page')
    }

    // When: the selection package normalizes selectionOrder to its mounted registry.
    act(() => {
      simulateLinkedDataChange(runtimePage1Id, {
        ...currentLinkedData,
        selectionOrder: [runtimePage1Id]
      })
    })

    rerender(
      <IntermediateDocumentViewer
        document={document}
        initialLoadedPages={1}
        className='second-render'
      />
    )

    // Then: the parent preserves the normalized order instead of rebuilding all pages.
    await waitFor(() => {
      expect(
        requireSelectionPropsById(runtimePage1Id).linkedData?.selectionOrder
      ).toEqual([runtimePage1Id])
    })
  })
})

describe('text range handle integration', () => {
  beforeEach(() => {
    clearSelectionProps()
  })

  afterEach(() => {
    clearSelectionProps()
  })

  it('renders document-order endpoint circles at range ends and drags from the circle center', async () => {
    // Given: a linked active range whose first and last rectangles have
    // different heights, making each endpoint geometry independently visible.
    const { document } = makeDocument({ pageCount: 1 })
    render(<IntermediateDocumentViewer document={document} scale={4} />)
    await screen.findByText('Page 1 text')
    await waitFor(() => {
      expect(getAllSelectionProps()).toHaveLength(1)
    })

    const pageId = requireRuntimeSelectionId(':page-1')
    const initialLinkedData = requireSelectionPropsById(pageId).linkedData
    if (!initialLinkedData) {
      throw new Error('Expected linked data for range handle test')
    }

    await act(async () => {
      simulateLinkedDataChange(pageId, {
        ...initialLinkedData,
        activeRange: makeRuntimeLinkedRange(pageId, {
          rectsBySelectionId: {
            [pageId]: [
              { x: 10, y: 20, width: 30, height: 8 },
              { x: 12, y: 40, width: 20, height: 12 }
            ]
          }
        })
      })
    })

    await waitFor(() => {
      expect(requireSelectionPropsById(pageId).renderHandle).toBeTypeOf(
        'function'
      )
    })
    const renderHandle = requireSelectionPropsById(pageId).renderHandle
    if (!renderHandle) {
      throw new Error('Expected custom range handle renderer')
    }

    const onPointerDown = vi.fn()
    const commonHandle = {
      owner: 'active-selection',
      rangeId: null,
      target: 'text',
      rectId: null,
      positionUnit: 'percent',
      isDragging: false,
      onPointerDown,
      className: 'hsn-selection-handle',
      style: { background: '#ff4fa3' }
    } satisfies Omit<HandleRenderProps, 'ariaLabel' | 'position' | 'type'>

    // When: the dependency asks the reader to render both document-order ends.
    const stopAtDocumentCapture = (event: PointerEvent) => {
      event.stopPropagation()
    }
    globalThis.document.addEventListener(
      'pointerdown',
      stopAtDocumentCapture,
      true
    )
    const { container } = render(
      <>
        {renderHandle({
          ...commonHandle,
          type: 'start',
          position: { x: 10, y: 24 },
          ariaLabel: 'start'
        })}
        {renderHandle({
          ...commonHandle,
          type: 'end',
          position: { x: 32, y: 46 },
          ariaLabel: 'end'
        })}
      </>
    )

    // Then: no stems are rendered; circles sit directly at the range
    // endpoints (handle.position) with a fixed 20px CSS diameter and a
    // reverse scale(1/scale = 0.25 at scale 4) that cancels the parent
    // transform, keeping the visual diameter at 20px; centered via
    // translate(-50%, -50%).
    expect(container.querySelector('[data-range-handle-stem]')).toBeNull()
    const startCircle = screen.getByRole('button', { name: 'start' })
    const endCircle = screen.getByRole('button', { name: 'end' })

    expect(startCircle).toHaveStyle({
      left: '10%',
      top: '24%',
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      transform: 'translate(-50%, -50%) scale(0.25)'
    })
    expect(endCircle).toHaveStyle({
      left: '32%',
      top: '46%',
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      transform: 'translate(-50%, -50%) scale(0.25)'
    })

    mockElementRect(startCircle, {
      left: 98,
      top: 96,
      width: 12,
      height: 12
    })
    const observedMoves: Array<{ x: number; y: number }> = []
    const observeMove = (event: PointerEvent) => {
      observedMoves.push({ x: event.clientX, y: event.clientY })
    }
    globalThis.document.addEventListener('pointermove', observeMove)

    // When: the user grabs off-center inside the circle and moves it.
    fireEvent.pointerDown(startCircle, {
      pointerId: 7,
      clientX: 100,
      clientY: 102,
      buttons: 1
    })
    fireEvent.pointerMove(globalThis.document, {
      pointerId: 7,
      clientX: 200,
      clientY: 300,
      buttons: 1
    })
    fireEvent.pointerUp(globalThis.document, { pointerId: 7 })
    globalThis.document.removeEventListener(
      'pointerdown',
      stopAtDocumentCapture,
      true
    )
    globalThis.document.removeEventListener('pointermove', observeMove)

    // Then: the dependency-facing event follows the circle center
    // (104, 102) for the start handle, preserving the 4px horizontal
    // grab offset.
    expect(onPointerDown).not.toHaveBeenCalled()
    expect(observedMoves).toEqual([{ x: 204, y: 300 }])
  })

  it('removes pointer correction when the dragged handle is not replaced', async () => {
    // Given: a text handle with an active correction session.
    const { document } = makeDocument({ pageCount: 1 })
    render(<IntermediateDocumentViewer document={document} />)
    await screen.findByText('Page 1 text')
    const pageId = requireRuntimeSelectionId(':page-1')
    const initialLinkedData = requireSelectionPropsById(pageId).linkedData
    const renderHandle = requireSelectionPropsById(pageId).renderHandle
    if (!initialLinkedData || !renderHandle) {
      throw new Error('Expected linked handle renderer')
    }

    await act(async () => {
      simulateLinkedDataChange(pageId, {
        ...initialLinkedData,
        activeRange: makeRuntimeLinkedRange(pageId, {
          rectsBySelectionId: {
            [pageId]: [{ x: 10, y: 20, width: 30, height: 8 }]
          }
        })
      })
    })
    const activeRenderHandle = requireSelectionPropsById(pageId).renderHandle
    if (!activeRenderHandle) {
      throw new Error('Expected active linked handle renderer')
    }

    const { unmount } = render(
      activeRenderHandle({
        type: 'start',
        owner: 'active-selection',
        rangeId: null,
        target: 'text',
        rectId: null,
        position: { x: 10, y: 24 },
        positionUnit: 'percent',
        isDragging: false,
        onPointerDown: vi.fn(),
        ariaLabel: 'temporary start',
        className: 'hsn-selection-handle hsn-selection-handle--start',
        style: { background: '#ff4fa3' }
      })
    )
    const circle = screen.getByRole('button', { name: 'temporary start' })
    mockElementRect(circle, { left: 98, top: 96, width: 12, height: 12 })
    fireEvent.pointerDown(circle, {
      pointerId: 8,
      clientX: 100,
      clientY: 102,
      buttons: 1
    })

    // When: selection removal unmounts the handle without a replacement.
    unmount()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const observedMoves: Array<{ x: number; y: number }> = []
    const observeMove = (event: PointerEvent) => {
      observedMoves.push({ x: event.clientX, y: event.clientY })
    }
    globalThis.document.addEventListener('pointermove', observeMove)
    fireEvent.pointerMove(globalThis.document, {
      pointerId: 8,
      clientX: 200,
      clientY: 300,
      buttons: 1
    })
    globalThis.document.removeEventListener('pointermove', observeMove)

    // Then: the stale session no longer rewrites subsequent pointer events.
    expect(observedMoves).toEqual([{ x: 200, y: 300 }])
  })

  it('keeps rectangle handles on the dependency default circle path', async () => {
    // Given: a loaded page with the custom renderer wired into Selection.
    const { document } = makeDocument({ pageCount: 1 })
    render(<IntermediateDocumentViewer document={document} />)
    await screen.findByText('Page 1 text')
    const pageId = requireRuntimeSelectionId(':page-1')
    const renderHandle = requireSelectionPropsById(pageId).renderHandle
    if (!renderHandle) {
      throw new Error('Expected custom range handle renderer')
    }

    // When: the selection dependency requests a rectangle handle.
    const { container } = render(
      renderHandle({
        type: 'start',
        owner: 'persisted-range',
        rangeId: 'rect-range',
        target: 'rect',
        rectId: 'rect-1',
        position: { x: 20, y: 30 },
        positionUnit: 'px',
        isDragging: false,
        onPointerDown: vi.fn(),
        ariaLabel: 'rectangle start',
        className: 'hsn-selection-handle hsn-selection-handle-rect',
        style: { left: 20, top: 30 }
      })
    )

    // Then: no text stem is introduced and the dependency position is intact.
    expect(container.querySelector('[data-range-handle-stem]')).toBeNull()
    expect(screen.getByRole('button', { name: 'rectangle start' })).toHaveStyle(
      {
        left: '20px',
        top: '30px'
      }
    )
  })
})

// T5：每页一个 linked-mode HamsterSelection 实例。
// 校验：实例数量、runtime id、共享 linkedData、popover gating、legacy 回调禁止通道。

// ---- intermediate-document selection 与 OCR 回归测试（任务 7）----
// 验证新增默认模式下 selection 行为与 html-parser 一致：
// - 已加载页面由 HamsterSelection linked-mode 包裹
// - selection create/update/delete 回调正确桥接到公共 API
// - popover 在包裹器内渲染
// - 空外壳不渲染 selection 包裹器
// - OCR 仅在已加载可见且有底图的页面上运行；
//   evictedOcrPagesRef 守卫使 stale OCR 结果不会写回已卸载的页面。
describe('intermediate-document selection and OCR regression (task-7)', () => {
  beforeEach(() => {
    clearSelectionProps()
  })

  afterEach(() => {
    clearSelectionProps()
  })

  it('renders one linked HamsterSelection per loaded page in intermediate-document mode', async () => {
    const { document, pages } = makeDocument({ pageCount: 3 })

    render(<IntermediateDocumentViewer document={document} />)

    // initialLoadedPages 默认为 1，仅页 1 加载
    await waitFor(() => {
      expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(1)
    })
    await screen.findByText('Page 1 text')

    // 仅页 1 已加载 → 注册了恰好 1 个 linked HamsterSelection 实例
    await waitFor(() => {
      expect(getAllSelectionProps()).toHaveLength(1)
      const props = getAllSelectionProps()[0]
      expect(props?.selectionId).toMatch(/:page-1$/u)
      expect(props?.linkedMode).toBe(true)
    })

    // 页 2、3 为空外壳 → 不渲染 selection 包裹器
    const page2 = screen.getByTestId('intermediate-page-2')
    expect(page2.querySelector('.hsn-selection-container')).toBeNull()
    const page3 = screen.getByTestId('intermediate-page-3')
    expect(page3.querySelector('.hsn-selection-container')).toBeNull()
  })

  it('fires public onSelect/onUpdateRange/onSelectRange when linked callbacks are simulated', async () => {
    const onSelect = vi.fn()
    const onUpdateRange = vi.fn()
    const onSelectRange = vi.fn()
    const onLinkedDataChange = vi.fn()

    const { document } = makeDocument({ pageCount: 1 })

    render(
      <IntermediateDocumentViewer
        document={document}
        onSelect={onSelect}
        onUpdateRange={onUpdateRange}
        onSelectRange={onSelectRange}
        onLinkedDataChange={onLinkedDataChange}
      />
    )

    await screen.findByText('Page 1 text')

    await waitFor(() => {
      expect(getAllSelectionProps()).toHaveLength(1)
    })

    const page1Id = requireRuntimeSelectionId(':page-1')

    // create：模拟 linked select → 公共 onSelect 触发（unscoped page-id）
    const range = makeRuntimeLinkedRange(page1Id, {
      id: 'sel-1',
      text: 'Selected'
    })
    act(() => {
      simulateLinkedSelect(page1Id, range)
    })

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1)
    })
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sel-1',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 11 }
      })
    )

    // update：模拟 linked update → 公共 onUpdateRange 触发
    const updatedRange = makeRuntimeLinkedRange(page1Id, {
      id: 'sel-1',
      text: 'Updated',
      end: { selectionId: page1Id, offset: 7 }
    })
    act(() => {
      simulateLinkedUpdateRange(page1Id, updatedRange)
    })

    await waitFor(() => {
      expect(onUpdateRange).toHaveBeenCalledTimes(1)
    })
    expect(onUpdateRange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sel-1',
        end: { selectionId: 'page-1', offset: 7 }
      })
    )

    // delete/deselect：模拟 linked selectRange → 公共 onSelectRange 触发
    act(() => {
      simulateLinkedSelectRange(page1Id, 'sel-1')
    })

    await waitFor(() => {
      expect(onSelectRange).toHaveBeenCalledWith('sel-1')
    })

    act(() => {
      simulateLinkedSelectRange(page1Id, null)
    })

    await waitFor(() => {
      expect(onSelectRange).toHaveBeenCalledWith(null)
    })
  })

  it('clears the selected highlight when a touch taps blank viewer space', async () => {
    // Given: a persisted highlight is selected in an uncontrolled viewer.
    const onSelectRange = vi.fn()
    const { document } = makeDocument({ pageCount: 1 })
    const selectedRange: ReaderSelectionRange = {
      id: 'touch-highlight-id',
      text: 'Touch highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 5 },
      createdAt: 10,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 10, width: 20, height: 10 }]
      }
    }

    render(
      <IntermediateDocumentViewer
        document={document}
        ranges={[selectedRange]}
        defaultSelectedRangeId={selectedRange.id}
        onSelectRange={onSelectRange}
      />
    )

    await screen.findByText('Page 1 text')
    await waitFor(() => {
      expect(requireSelectionPropsById(requireRuntimeSelectionId()).linkedData)
        .toMatchObject({ selectedRangeId: selectedRange.id })
    })

    // When: a primary touch taps the blank VirtualPaper viewport.
    const blankViewerSpace = screen.getByTestId('virtual-paper-wrapper')
    fireEvent.pointerDown(blankViewerSpace, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 200,
      clientY: 200
    })
    fireEvent.pointerUp(blankViewerSpace, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 200,
      clientY: 200
    })

    // Then: touch has the same blank-space deselection behavior as mouse click.
    expect(onSelectRange).toHaveBeenCalledWith(null)
  })

  it('keeps the selected highlight when a touch pan returns to its start point', async () => {
    // Given: a persisted highlight is selected in an uncontrolled viewer.
    const onSelectRange = vi.fn()
    const { document } = makeDocument({ pageCount: 1 })
    const selectedRange: ReaderSelectionRange = {
      id: 'touch-pan-highlight-id',
      text: 'Touch pan highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 5 },
      createdAt: 10,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 10, width: 20, height: 10 }]
      }
    }

    render(
      <IntermediateDocumentViewer
        document={document}
        ranges={[selectedRange]}
        defaultSelectedRangeId={selectedRange.id}
        onSelectRange={onSelectRange}
      />
    )

    await screen.findByText('Page 1 text')
    const blankViewerSpace = screen.getByTestId('virtual-paper-wrapper')

    // When: the pointer moves beyond tap tolerance before returning to start.
    fireEvent.pointerDown(blankViewerSpace, {
      pointerType: 'touch',
      pointerId: 2,
      isPrimary: true,
      clientX: 200,
      clientY: 200
    })
    fireEvent.pointerMove(blankViewerSpace, {
      pointerType: 'touch',
      pointerId: 2,
      isPrimary: true,
      clientX: 220,
      clientY: 220
    })
    fireEvent.pointerUp(blankViewerSpace, {
      pointerType: 'touch',
      pointerId: 2,
      isPrimary: true,
      clientX: 200,
      clientY: 200
    })

    // Then: a completed pan does not clear the selected highlight.
    expect(onSelectRange).not.toHaveBeenCalledWith(null)
  })

  it('keeps the selected highlight when touch lands inside its overlay', async () => {
    // Given: a selected highlight has a rendered overlay rectangle.
    const onSelectRange = vi.fn()
    const { document } = makeDocument({ pageCount: 1 })
    const selectedRange: ReaderSelectionRange = {
      id: 'touch-overlay-highlight-id',
      text: 'Touch overlay highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 5 },
      createdAt: 10,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 10, width: 20, height: 10 }]
      }
    }

    render(
      <IntermediateDocumentViewer
        document={document}
        ranges={[selectedRange]}
        defaultSelectedRangeId={selectedRange.id}
        onSelectRange={onSelectRange}
      />
    )

    await screen.findByText('Page 1 text')
    const viewer = screen.getByTestId('intermediate-document-viewer')
    const highlightOverlay = window.document.createElement('div')
    highlightOverlay.className = 'hsn-selection-percent-rect-highlight'
    viewer.append(highlightOverlay)
    mockElementRect(highlightOverlay, {
      left: 100,
      top: 100,
      width: 100,
      height: 40
    })

    // When: a primary touch taps within that overlay's visual bounds.
    const viewerSpace = screen.getByTestId('virtual-paper-wrapper')
    fireEvent.pointerDown(viewerSpace, {
      pointerType: 'touch',
      pointerId: 3,
      isPrimary: true,
      clientX: 120,
      clientY: 120
    })
    fireEvent.pointerUp(viewerSpace, {
      pointerType: 'touch',
      pointerId: 3,
      isPrimary: true,
      clientX: 120,
      clientY: 120
    })

    // Then: touching the highlight itself does not run blank-space deselection.
    expect(onSelectRange).not.toHaveBeenCalledWith(null)
  })

  it('switches the selected highlight when touch lands on another persisted range', async () => {
    // Given: two percent-based highlights share a page and the first is selected.
    const onSelectRange = vi.fn()
    const { document } = makeDocument({ pageCount: 1 })
    const firstRange: ReaderSelectionRange = {
      id: 'touch-switch-first-id',
      text: 'First touch highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 5 },
      createdAt: 10,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 10, width: 20, height: 10 }]
      }
    }
    const secondRange: ReaderSelectionRange = {
      id: 'touch-switch-second-id',
      text: 'Second touch highlight',
      start: { selectionId: 'page-1', offset: 6 },
      end: { selectionId: 'page-1', offset: 11 },
      createdAt: 20,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-1': [{ x: 50, y: 40, width: 20, height: 10 }]
      }
    }

    render(
      <IntermediateDocumentViewer
        document={document}
        ranges={[firstRange, secondRange]}
        defaultSelectedRangeId={firstRange.id}
        onSelectRange={onSelectRange}
      />
    )

    await screen.findByText('Page 1 text')
    const page = screen.getByTestId('intermediate-page-1')
    const selectionContainer = page.querySelector('.hsn-selection-container')
    if (!(selectionContainer instanceof HTMLElement)) {
      throw new Error('Expected the page selection container')
    }
    // The real selection dependency keeps the scoped ID on the Reader page shell.
    selectionContainer.removeAttribute('data-selection-id')
    mockElementRect(page, {
      left: 100,
      top: 100,
      width: 400,
      height: 600
    })

    // When: the primary touch lands inside the second range's visual bounds.
    const viewerSpace = screen.getByTestId('virtual-paper-wrapper')
    fireEvent.pointerDown(viewerSpace, {
      pointerType: 'touch',
      pointerId: 4,
      isPrimary: true,
      clientX: 340,
      clientY: 370
    })
    fireEvent.pointerUp(viewerSpace, {
      pointerType: 'touch',
      pointerId: 4,
      isPrimary: true,
      clientX: 340,
      clientY: 370
    })

    // Then: touch switches selection with the same public range ID as mouse.
    expect(onSelectRange).toHaveBeenCalledWith(secondRange.id)
  })

  it('emits onHighlight when the public text confirm commits a linked range', async () => {
    // Given: a controlled Reader with a mounted text-selection ref.
    const selectionRef = createRef<ReaderSelectionRef>()
    const onHighlight = vi.fn()
    const { document } = makeDocument({ pageCount: 1 })

    render(
      <IntermediateDocumentViewer
        document={document}
        ranges={[]}
        selectionRef={selectionRef}
        onHighlight={onHighlight}
      />
    )

    await screen.findByText('Page 1 text')
    await waitFor(() => {
      expect(selectionRef.current).not.toBeNull()
    })
    const runtimePageId = requireRuntimeSelectionId(':page-1')
    const currentLinkedData =
      requireSelectionPropsById(runtimePageId).linkedData
    if (!currentLinkedData) {
      throw new Error('Expected linked data for mounted page')
    }
    const linkedRange = makeRuntimeLinkedRange(runtimePageId, {
      id: 'highlight-id',
      text: 'Mocked highlight',
      end: { selectionId: runtimePageId, offset: 10 }
    })

    // When: the default popover path confirms the current text selection.
    act(() => {
      requireReaderSelectionRef(selectionRef).confirm()
      // 真实 Selection 会在 confirm() 返回前同步提交 linked callbacks。
      simulateLinkedDataChange(runtimePageId, {
        ...currentLinkedData,
        items: [...currentLinkedData.items, linkedRange],
        selectedRangeId: linkedRange.id,
        selectionOrder: [...currentLinkedData.selectionOrder, linkedRange.id],
        activeRange: null
      })
      simulateLinkedSelect(runtimePageId, linkedRange)
    })

    // Then: the linked range crosses the public controlled onHighlight boundary.
    expect(onHighlight).toHaveBeenCalledTimes(1)
    expect(onHighlight).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'highlight-id',
        text: 'Mocked highlight',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 10 }
      })
    )
  })

  it('commits an immediate public confirm to the page owning the latest active range', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onLinkedDataChange = vi.fn()
    const { document } = makeDocument({ pageCount: 2 })

    render(
      <IntermediateDocumentViewer
        document={document}
        initialLoadedPages={2}
        ranges={[]}
        selectionRef={selectionRef}
        onLinkedDataChange={onLinkedDataChange}
      />
    )

    await screen.findByText('Page 2 text')
    await waitFor(() => {
      expect(getAllSelectionProps()).toHaveLength(2)
      expect(selectionRef.current).not.toBeNull()
    })
    const page1Id = requireRuntimeSelectionId(':page-1')
    const page2Id = requireRuntimeSelectionId(':page-2')
    const currentLinkedData = requireSelectionPropsById(page2Id).linkedData
    if (!currentLinkedData) {
      throw new Error('Expected linked data for mounted pages')
    }

    await act(async () => {
      simulateLinkedDataChange(page2Id, {
        ...currentLinkedData,
        activeRange: makeRuntimeLinkedRange(page2Id)
      })
      requireReaderSelectionRef(selectionRef).confirm()
    })

    expect(onLinkedDataChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            start: expect.objectContaining({ selectionId: 'page-2' }),
            end: expect.objectContaining({ selectionId: 'page-2' })
          })
        ],
        activeRange: null
      })
    )
    expect(getSelectionRefCallCounts(page1Id).highlight).toBe(0)
    expect(getSelectionRefCallCounts(page2Id).highlight).toBe(0)
  })

  it('commits the latest linked active range when touch confirm has no native selection text', async () => {
    // Given: touch selection has synchronously published an active range, while
    // the browser-native Selection is already empty before the popover press.
    const selectionRef = createRef<ReaderSelectionRef>()
    const onHighlight = vi.fn()
    const onLinkedDataChange = vi.fn()
    const { document } = makeDocument({ pageCount: 1 })

    render(
      <IntermediateDocumentViewer
        document={document}
        ranges={[]}
        selectionRef={selectionRef}
        onHighlight={onHighlight}
        onLinkedDataChange={onLinkedDataChange}
      />
    )

    await screen.findByText('Page 1 text')
    await waitFor(() => {
      expect(selectionRef.current).not.toBeNull()
    })
    const runtimePageId = requireRuntimeSelectionId(':page-1')
    const currentLinkedData =
      requireSelectionPropsById(runtimePageId).linkedData
    if (!currentLinkedData) {
      throw new Error('Expected linked data for mounted page')
    }
    const activeRange = makeRuntimeLinkedRange(runtimePageId, {
      id: 'touch-highlight-id',
      text: 'Touch highlight'
    })
    globalThis.window.getSelection()?.removeAllRanges()
    expect(globalThis.window.getSelection()?.toString()).toBe('')

    // When: activeRange publication and public confirm happen in one event turn.
    await act(async () => {
      simulateLinkedDataChange(runtimePageId, {
        ...currentLinkedData,
        activeRange
      })
      requireReaderSelectionRef(selectionRef).confirm()
    })

    // Then: Reader persists the linked range even though the Selection instance
    // has not rendered the newly published activeRange yet.
    expect(onLinkedDataChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            id: 'touch-highlight-id',
            text: 'Touch highlight'
          })
        ],
        selectedRangeId: 'touch-highlight-id',
        activeRange: null
      })
    )
    expect(onHighlight).toHaveBeenCalledTimes(1)
    expect(onHighlight).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'touch-highlight-id' })
    )
  })

  it('popovers are forwarded to the HamsterSelection wrapper for loaded pages', async () => {
    const selectionPopover = <div data-testid='sel-popover'>SP</div>
    const highlightPopover = <div data-testid='hl-popover'>HP</div>

    const { document } = makeDocument({ pageCount: 1 })

    render(
      <IntermediateDocumentViewer
        document={document}
        selectionPopover={selectionPopover}
        highlightPopover={highlightPopover}
      />
    )

    await screen.findByText('Page 1 text')

    await waitFor(() => {
      expect(getAllSelectionProps()).toHaveLength(1)
    })

    const props = getAllSelectionProps()[0]
    expectPopoverToContain(props?.popover, highlightPopover)
    expectPopoverToContain(props?.selectionPopover, selectionPopover)
  })

  it('empty shells do not render HamsterSelection wrappers when initialLoadedPages=0', () => {
    const { document, pages } = makeDocument({ pageCount: 3 })

    render(
      <IntermediateDocumentViewer document={document} initialLoadedPages={0} />
    )

    expect(getAllSelectionProps()).toHaveLength(0)
    expect(pages.get(1)?.getContent).not.toHaveBeenCalled()

    for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
      const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
      expect(page).toHaveAttribute('data-selection-id')
      expect(page.querySelector('.hsn-selection-container')).toBeNull()
    }
  })

  it('OCR runs only for visible loaded pages with base images, not for empty shells', async () => {
    const { ImageParser } = await import('@hamster-note/image-parser')
    const encodeSpy = vi.mocked(ImageParser.encode)
    encodeSpy.mockClear()

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new Blob(['image'])))

    const { document, pages } = makeDocument({ pageCount: 3 })
    pages.forEach((page, pageNumber) => {
      page.thumbnail = `data:image/png;base64,page-${pageNumber}`
    })

    try {
      render(
        <IntermediateDocumentViewer
          document={document}
          ocr
          pageLoadEnterDelayMs={0}
        />
      )

      // 等待页 1加载并出现底图
      const page1 = screen.getByTestId('intermediate-page-1')
      await waitFor(() => {
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).toBeInTheDocument()
      })

      // 触发页 1 可见 → OCR 运行
      intersectionObserverMock.trigger(page1)

      await waitFor(() => {
        expect(encodeSpy).toHaveBeenCalledTimes(1)
        expect(
          page1.querySelector('[data-text-id^="ocr-"]')
        ).toBeInTheDocument()
      })

      // 页 2、3 为空外壳 → 不应有 OCR 文本
      const page2 = screen.getByTestId('intermediate-page-2')
      expect(
        page2.querySelector('[data-text-id^="ocr-"]')
      ).not.toBeInTheDocument()
      const page3 = screen.getByTestId('intermediate-page-3')
      expect(
        page3.querySelector('[data-text-id^="ocr-"]')
      ).not.toBeInTheDocument()

      // 加载页 2 并使其可见 → OCR 应在页 2 上运行
      intersectionObserverMock.trigger(page2)
      await waitFor(() => {
        expect(pages.get(2)?.getContent).toHaveBeenCalledTimes(1)
      })
      await waitFor(() => {
        expect(
          page2.querySelector('.hamster-reader__intermediate-page-base-image')
        ).toBeInTheDocument()
      })
      intersectionObserverMock.trigger(page2)

      await waitFor(() => {
        expect(encodeSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(
          page2.querySelector('[data-text-id^="ocr-"]')
        ).toBeInTheDocument()
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('stale OCR results are dropped after page eviction via evictedOcrPagesRef guard', async () => {
    const { ImageParser } = await import('@hamster-note/image-parser')
    const encodeSpy = vi.mocked(ImageParser.encode)
    encodeSpy.mockClear()

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new Blob(['image'])))

    const idleCallback = installQueuedIdleCallback()

    const { document, pages } = makeDocument({ pageCount: 8 })
    pages.forEach((page, pageNumber) => {
      page.thumbnail = `data:image/png;base64,page-${pageNumber}`
    })

    try {
      render(
        <IntermediateDocumentViewer
          document={document}
          ocr
          overscan={0}
          maxLoadedPages={3}
          pageLoadEnterDelayMs={0}
        />
      )

      // 加载页 1、可见 → OCR 运行
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

      // 离屏页 1，加载足够页面触发 LRU 驱逐
      // effective cap = max(maxLoadedPages=3, floor=5) = 5，需 6 页以上才触发
      intersectionObserverMock.trigger(page1, false)

      for (let pageNumber = 2; pageNumber <= 7; pageNumber += 1) {
        const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
        intersectionObserverMock.trigger(page)
        await waitFor(() => {
          expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
        })
        intersectionObserverMock.trigger(page, false)
      }

      await idleCallback.flush()

      // 页 1 被驱逐：文本、底图、OCR 文本均清空
      await waitFor(() => {
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).not.toBeInTheDocument()
      })
      expect(
        page1.querySelector('[data-text-id^="ocr-"]')
      ).not.toBeInTheDocument()
      expect(screen.queryByText('Page 1 text')).not.toBeInTheDocument()

      const callsAfterEviction = encodeSpy.mock.calls.length

      // 重新加载页 1 → OCR 被重新发起（cache 被 evictedOcrPagesRef 绕过）
      intersectionObserverMock.trigger(page1)

      await waitFor(() => {
        expect(pages.get(1)?.getContent).toHaveBeenCalledTimes(2)
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).toBeInTheDocument()
      })
      intersectionObserverMock.trigger(page1)

      await waitFor(() => {
        expect(encodeSpy.mock.calls.length).toBeGreaterThan(callsAfterEviction)
      })
    } finally {
      fetchSpy.mockRestore()
      idleCallback.restore()
    }
  })

  it('OCR text reappears after lazy unload then reload (reload deadlock fix)', async () => {
    const { ImageParser } = await import('@hamster-note/image-parser')
    const encodeSpy = vi.mocked(ImageParser.encode)
    encodeSpy.mockClear()

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new Blob(['image'])))

    const idleCallback = installQueuedIdleCallback()

    const { document, pages } = makeDocument({ pageCount: 8 })
    pages.forEach((page, pageNumber) => {
      page.thumbnail = `data:image/png;base64,page-${pageNumber}`
    })

    try {
      render(
        <IntermediateDocumentViewer
          document={document}
          ocr
          overscan={0}
          maxLoadedPages={3}
          pageLoadEnterDelayMs={0}
        />
      )

      // 页 1 加载并可见 → OCR 运行并出现 OCR 文本
      const page1 = screen.getByTestId('intermediate-page-1')
      await waitFor(() => {
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).toBeInTheDocument()
      })
      intersectionObserverMock.trigger(page1)

      await waitFor(() => {
        expect(
          page1.querySelector('[data-text-id^="ocr-"]')
        ).toBeInTheDocument()
      })

      // 离屏页 1，加载其余页面触发 LRU 驱逐（effective cap=5，需 >5 页）
      intersectionObserverMock.trigger(page1, false)
      for (let pageNumber = 2; pageNumber <= 7; pageNumber += 1) {
        const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
        intersectionObserverMock.trigger(page)
        await waitFor(() => {
          expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
        })
        intersectionObserverMock.trigger(page, false)
      }

      await idleCallback.flush()

      // 页 1 被驱逐：底图与 OCR 文本均清空
      await waitFor(() => {
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).not.toBeInTheDocument()
      })
      expect(
        page1.querySelector('[data-text-id^="ocr-"]')
      ).not.toBeInTheDocument()

      // 重新加载页 1 → 底图回来 → OCR 重新发起 → OCR 文本重新出现
      // （旧实现中 evictedOcrPagesRef 永不清除，OCR 结果被永久拒绝，此处会失败）
      intersectionObserverMock.trigger(page1)
      await waitFor(() => {
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).toBeInTheDocument()
      })
      intersectionObserverMock.trigger(page1)

      await waitFor(() => {
        expect(
          page1.querySelector('[data-text-id^="ocr-"]')
        ).toBeInTheDocument()
      })
    } finally {
      fetchSpy.mockRestore()
      idleCallback.restore()
    }
  })

  it('stale OCR result from before reload does not repopulate the reloaded page', async () => {
    const { ImageParser } = await import('@hamster-note/image-parser')
    const encodeSpy = vi.mocked(ImageParser.encode)
    encodeSpy.mockClear()

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new Blob(['image'])))

    // 每次 encode 返回不同 OCR 文本，用于区分卸载前（stale）与重载后（fresh）
    // 的结果：重载后页面必须显示新结果，而不能残留卸载前的旧 OCR 文本。
    const makeOcrDoc = (textContent: string) =>
      ({
        id: `ocr-${textContent}`,
        title: 'OCR',
        pageCount: 1,
        pageNumbers: [1],
        pages: [
          {
            id: `ocr-page-${textContent}`,
            number: 1,
            width: 100,
            height: 150,
            content: [makeText(`ocr-${textContent}`, textContent)]
          }
        ],
        getPageSizeByPageNumber: () => ({ x: 100, y: 150 }),
        getPageByPageNumber: () =>
          Promise.resolve({ getContent: async () => [] })
      }) as unknown as IntermediateDocument

    let encodeCallCount = 0
    encodeSpy.mockImplementation(async () => {
      encodeCallCount += 1
      return makeOcrDoc(
        encodeCallCount === 1 ? 'OCR before reload' : 'OCR after reload'
      )
    })

    const idleCallback = installQueuedIdleCallback()

    const { document, pages } = makeDocument({ pageCount: 8 })
    pages.forEach((page, pageNumber) => {
      page.thumbnail = `data:image/png;base64,page-${pageNumber}`
    })

    try {
      render(
        <IntermediateDocumentViewer
          document={document}
          ocr
          overscan={0}
          maxLoadedPages={3}
          pageLoadEnterDelayMs={0}
        />
      )

      // 页 1 可见 → 第一次 OCR 完成 → 显示「OCR before reload」并缓存
      const page1 = screen.getByTestId('intermediate-page-1')
      await waitFor(() => {
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).toBeInTheDocument()
      })
      intersectionObserverMock.trigger(page1)
      await waitFor(() => {
        expect(screen.getByText('OCR before reload')).toBeInTheDocument()
      })

      // 离屏页 1 并加载其余页面触发驱逐（OCR 已完成，可被驱逐；代际递增）
      intersectionObserverMock.trigger(page1, false)
      for (let pageNumber = 2; pageNumber <= 7; pageNumber += 1) {
        const page = screen.getByTestId(`intermediate-page-${pageNumber}`)
        intersectionObserverMock.trigger(page)
        await waitFor(() => {
          expect(pages.get(pageNumber)?.getContent).toHaveBeenCalledTimes(1)
        })
        intersectionObserverMock.trigger(page, false)
      }
      await idleCallback.flush()
      await waitFor(() => {
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).not.toBeInTheDocument()
      })
      expect(
        page1.querySelector('[data-text-id^="ocr-1-"]')
      ).not.toBeInTheDocument()

      // 重新加载页 1 → OCR 重新发起并返回「OCR after reload」。
      // 页面必须显示新结果，且卸载前的「OCR before reload」不得残留/回填。
      intersectionObserverMock.trigger(page1)
      await waitFor(() => {
        expect(
          page1.querySelector('.hamster-reader__intermediate-page-base-image')
        ).toBeInTheDocument()
      })
      intersectionObserverMock.trigger(page1)
      await waitFor(() => {
        const ocrSpan = page1.querySelector('[data-text-id^="ocr-1-"]')
        expect(ocrSpan).toBeInTheDocument()
        expect(ocrSpan?.textContent).toBe('OCR after reload')
      })
    } finally {
      fetchSpy.mockRestore()
      encodeSpy.mockReset()
      idleCallback.restore()
    }
  })

  describe('public selection ref range jumps', () => {
    const pageThreeRange: ReaderSelectionRange = {
      id: 'jump-page-3',
      text: 'Jump target',
      start: { selectionId: 'page-3', offset: 0 },
      end: { selectionId: 'page-3', offset: 11 },
      createdAt: 30,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-3': [{ x: 10, y: 20, width: 20, height: 20 }]
      }
    }
    const pageFourRange: ReaderSelectionRange = {
      id: 'jump-page-4',
      text: 'Out of range target',
      start: { selectionId: 'page-4', offset: 0 },
      end: { selectionId: 'page-4', offset: 11 },
      createdAt: 40,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-4': [{ x: 10, y: 20, width: 20, height: 20 }]
      }
    }
    const emptyRectsRange: ReaderSelectionRange = {
      id: 'empty-rects',
      text: 'No target rects',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 11 },
      createdAt: 50,
      overlayRectType: 'percent',
      rectsBySelectionId: {}
    }
    const malformedSelectionIdRange: ReaderSelectionRange = {
      id: 'malformed-selection-id',
      text: 'Malformed page id',
      start: { selectionId: 'not-a-page-id', offset: 0 },
      end: { selectionId: 'not-a-page-id', offset: 11 },
      createdAt: 60,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'not-a-page-id': [{ x: 10, y: 20, width: 20, height: 20 }]
      }
    }
    const unchangedTransform = 'translate3d(0px, 0px, 0) scale(1)'

    type NoOpJumpFixtureOptions = {
      ranges: ReaderSelectionRange[]
      pageCount?: number
      pageSize?: { x?: number; y?: number }
      wrapperRect?: RectInput
    }

    const renderNoOpJumpFixture = async ({
      ranges,
      pageCount = 3,
      pageSize = { x: 100, y: 150 },
      wrapperRect = { left: 0, top: 0, width: 50, height: 100 }
    }: NoOpJumpFixtureOptions) => {
      const selectionRef = createRef<ReaderSelectionRef>()
      const { document } = makeDocument({ pageCount, pageSize })

      render(
        <IntermediateDocumentViewer
          document={document}
          ranges={ranges}
          selectionRef={selectionRef}
          initialLoadedPages={1}
        />
      )
      await screen.findByText('Page 1 text')
      mockElementRect(screen.getByTestId('virtual-paper-wrapper'), wrapperRect)

      return {
        document,
        selectionRef,
        container: screen.getByTestId('virtual-paper-container')
      }
    }

    const expectScrollToRangeNoThrow = (
      selectionRef: RefObject<ReaderSelectionRef | null>,
      rangeId: string
    ) => {
      const readerSelectionRef = requireReaderSelectionRef(selectionRef)

      expect(() => {
        act(() => {
          readerSelectionRef.scrollToRange(rangeId)
        })
      }).not.toThrow()
    }

    describe('invalid/no-op scrollToRange paths', () => {
      it('keeps transform unchanged for an unknown range id', async () => {
        // Given: a mounted public ref and unchanged controlled ranges.
        const ranges = [pageThreeRange]
        const expectedRanges = structuredClone(ranges)
        const { selectionRef, container } = await renderNoOpJumpFixture({
          ranges
        })
        const previousTransform = container.style.transform

        // When: the caller asks the public ref to jump to an unknown id.
        expectScrollToRangeNoThrow(selectionRef, 'missing-range')

        // Then: VirtualPaper and stored ranges remain unchanged.
        expect(container.style.transform).toBe(previousTransform)
        expect(container.style.transform).toBe(unchangedTransform)
        expect(ranges).toEqual(expectedRanges)
      })

      it('keeps transform unchanged for empty rectsBySelectionId', async () => {
        // Given: the range id exists but has no stored target rects.
        const ranges = [emptyRectsRange]
        const expectedRanges = structuredClone(ranges)
        const { selectionRef, container } = await renderNoOpJumpFixture({
          ranges
        })
        const previousTransform = container.style.transform

        // When: the caller jumps through the public ref API.
        expectScrollToRangeNoThrow(selectionRef, 'empty-rects')

        // Then: no transform or range data mutates.
        expect(container.style.transform).toBe(previousTransform)
        expect(container.style.transform).toBe(unchangedTransform)
        expect(ranges).toEqual(expectedRanges)
      })

      it('keeps transform unchanged for a malformed selection id', async () => {
        // Given: rects exist, but their public page id cannot be parsed.
        const ranges = [malformedSelectionIdRange]
        const expectedRanges = structuredClone(ranges)
        const { selectionRef, container } = await renderNoOpJumpFixture({
          ranges
        })
        const previousTransform = container.style.transform

        // When: the caller jumps through the public ref API.
        expectScrollToRangeNoThrow(selectionRef, 'malformed-selection-id')

        // Then: no transform or range data mutates.
        expect(container.style.transform).toBe(previousTransform)
        expect(container.style.transform).toBe(unchangedTransform)
        expect(ranges).toEqual(expectedRanges)
      })

      it('keeps transform unchanged when target page is outside current pageNumbers', async () => {
        // Given: ranges mention page 4, but current pageNumbers only contain 1-3.
        const ranges = [pageFourRange]
        const expectedRanges = structuredClone(ranges)
        const { document, selectionRef, container } =
          await renderNoOpJumpFixture({ ranges })
        const previousTransform = container.style.transform

        // When: the caller selects a range outside the rendered pageNumbers.
        expectScrollToRangeNoThrow(selectionRef, 'jump-page-4')

        // Then: VirtualPaper no-ops and no parser/page-range expansion path runs.
        expect(container.style.transform).toBe(previousTransform)
        expect(container.style.transform).toBe(unchangedTransform)
        expect(document.getPageByPageNumber).not.toHaveBeenCalledWith(4)
        expect(document.getPageSizeByPageNumber).not.toHaveBeenCalledWith(4)
        expect(ranges).toEqual(expectedRanges)
      })

      it('keeps transform unchanged when page size is unavailable', async () => {
        // Given: every visible page falls back to the default size for render only.
        const ranges = [pageThreeRange]
        const expectedRanges = structuredClone(ranges)
        const { selectionRef, container } = await renderNoOpJumpFixture({
          ranges,
          pageSize: {}
        })
        const previousTransform = container.style.transform

        // When: scrollToRange cannot resolve a known page size for jump math.
        expectScrollToRangeNoThrow(selectionRef, 'jump-page-3')

        // Then: no transform or range data mutates.
        expect(container.style.transform).toBe(previousTransform)
        expect(container.style.transform).toBe(unchangedTransform)
        expect(ranges).toEqual(expectedRanges)
      })

      it('keeps transform unchanged when viewport dimensions are missing', async () => {
        // Given: jsdom exposes a mounted VirtualPaper wrapper with zero layout.
        const ranges = [pageThreeRange]
        const expectedRanges = structuredClone(ranges)
        const { selectionRef, container } = await renderNoOpJumpFixture({
          ranges,
          wrapperRect: { left: 0, top: 0, width: 0, height: 0 }
        })
        const previousTransform = container.style.transform

        // When: computeTransform receives missing viewport dimensions.
        expectScrollToRangeNoThrow(selectionRef, 'jump-page-3')

        // Then: no transform or range data mutates.
        expect(container.style.transform).toBe(previousTransform)
        expect(container.style.transform).toBe(unchangedTransform)
        expect(ranges).toEqual(expectedRanges)
      })

      it('keeps transform unchanged when content dimensions are unavailable', async () => {
        // Given: page sizes have invalid content dimensions for jump math.
        const ranges = [pageThreeRange]
        const expectedRanges = structuredClone(ranges)
        const { selectionRef, container } = await renderNoOpJumpFixture({
          ranges,
          pageSize: { x: 0, y: 0 }
        })
        const previousTransform = container.style.transform

        // When: scrollToRange cannot derive a valid content box.
        expectScrollToRangeNoThrow(selectionRef, 'jump-page-3')

        // Then: no transform or range data mutates.
        expect(container.style.transform).toBe(previousTransform)
        expect(container.style.transform).toBe(unchangedTransform)
        expect(ranges).toEqual(expectedRanges)
      })

      it('keeps transform unchanged when no runtime document is mounted', async () => {
        // Given: a public ref was exposed by a mounted runtime document.
        const selectionRef = createRef<ReaderSelectionRef>()
        const ranges = [pageThreeRange]
        const expectedRanges = structuredClone(ranges)
        const { document } = makeDocument({
          pageCount: 3,
          pageSize: { x: 100, y: 150 }
        })
        const { rerender } = render(
          <IntermediateDocumentViewer
            document={document}
            ranges={ranges}
            selectionRef={selectionRef}
            initialLoadedPages={1}
          />
        )
        await screen.findByText('Page 1 text')
        const previousTransform = screen.getByTestId('virtual-paper-container')
          .style.transform
        const publicRef = requireReaderSelectionRef(selectionRef)

        rerender(
          <IntermediateDocumentViewer
            ranges={ranges}
            selectionRef={selectionRef}
            initialLoadedPages={1}
          />
        )

        // When: a stale-but-public ref method is called after runtime document removal.
        expect(selectionRef.current).toBeNull()
        expect(() => {
          act(() => {
            publicRef.scrollToRange('jump-page-3')
          })
        }).not.toThrow()

        // Then: remounting the same document shows the stored transform/ranges unchanged.
        rerender(
          <IntermediateDocumentViewer
            document={document}
            ranges={ranges}
            selectionRef={selectionRef}
            initialLoadedPages={1}
          />
        )
        await screen.findByText('Page 1 text')
        expect(
          screen.getByTestId('virtual-paper-container').style.transform
        ).toBe(previousTransform)
        expect(
          screen.getByTestId('virtual-paper-container').style.transform
        ).toBe(unchangedTransform)
        expect(ranges).toEqual(expectedRanges)
      })
    })

    it('updates the controlled VirtualPaper translate for a page-3 range', async () => {
      // Given: a mounted reader selection ref and a measurable VirtualPaper viewport.
      const selectionRef = createRef<ReaderSelectionRef>()
      const { document } = makeDocument({
        pageCount: 3,
        pageSize: { x: 100, y: 150 }
      })
      render(
        <IntermediateDocumentViewer
          document={document}
          ranges={[pageThreeRange]}
          selectionRef={selectionRef}
          initialLoadedPages={1}
        />
      )
      await screen.findByText('Page 1 text')
      mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
        left: 0,
        top: 0,
        width: 50,
        height: 100
      })

      // When: the public ref is asked to jump to the range.
      act(() => {
        requireReaderSelectionRef(selectionRef).scrollToRange('jump-page-3')
      })

      // Then: the VirtualPaper container receives the computed translate.
      expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
        transform: 'translate3d(0px, -327px, 0) scale(1)'
      })
    })

    it('preserves controlled scale and does not call onScaleChange while jumping', async () => {
      // Given: scale is controlled externally at 2x.
      const selectionRef = createRef<ReaderSelectionRef>()
      const onScaleChange = vi.fn()
      const { document } = makeDocument({
        pageCount: 3,
        pageSize: { x: 100, y: 150 }
      })
      render(
        <IntermediateDocumentViewer
          document={document}
          ranges={[pageThreeRange]}
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

      // When: jumping to the page-3 target.
      act(() => {
        requireReaderSelectionRef(selectionRef).scrollToRange('jump-page-3')
      })

      // Then: translation changes, scale stays 2, and no scale callback fires.
      expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
        transform: 'translate3d(-15px, -704px, 0) scale(2)'
      })
      expect(onScaleChange).not.toHaveBeenCalled()
    })

    it('loads a lazy target page on jump and unpins it after load cleanup', async () => {
      // Given: only page 1 is initially loaded while page 3 exists as an empty shell.
      const selectionRef = createRef<ReaderSelectionRef>()
      const { document, pages } = makeDocument({
        pageCount: 3,
        pageSize: { x: 100, y: 150 }
      })
      render(
        <IntermediateDocumentViewer
          document={document}
          ranges={[pageThreeRange]}
          selectionRef={selectionRef}
          initialLoadedPages={1}
          overscan={0}
        />
      )
      await screen.findByText('Page 1 text')
      const page3 = screen.getByTestId('intermediate-page-3')
      expect(page3).toBeEmptyDOMElement()
      mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
        left: 0,
        top: 0,
        width: 50,
        height: 100
      })

      // When: jumping to page 3.
      act(() => {
        requireReaderSelectionRef(selectionRef).scrollToRange('jump-page-3')
      })

      // Then: the transform updates immediately, and only the target lazy page loads.
      expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
        transform: 'translate3d(0px, -327px, 0) scale(1)'
      })
      await screen.findByText('Page 3 text')
      expect(pages.get(3)?.getContent).toHaveBeenCalledTimes(1)
      expect(pages.get(2)?.getContent).not.toHaveBeenCalled()

      // And: once page 3 has loaded, the jump pin is removed so normal unload can evict it.
      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(page3, false)
        act(() => {
          vi.advanceTimersByTime(5000)
        })
        expect(screen.queryByText('Page 3 text')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not load pages outside overscan solely because of a jump', async () => {
      // Given: a five-page document with overscan disabled.
      const selectionRef = createRef<ReaderSelectionRef>()
      const { document, pages } = makeDocument({
        pageCount: 5,
        pageSize: { x: 100, y: 150 }
      })
      render(
        <IntermediateDocumentViewer
          document={document}
          ranges={[pageThreeRange]}
          selectionRef={selectionRef}
          initialLoadedPages={1}
          overscan={0}
        />
      )
      await screen.findByText('Page 1 text')
      mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
        left: 0,
        top: 0,
        width: 50,
        height: 100
      })

      // When: jumping directly to page 3.
      act(() => {
        requireReaderSelectionRef(selectionRef).scrollToRange('jump-page-3')
      })
      await screen.findByText('Page 3 text')

      // Then: adjacent and intervening pages remain unloaded shells.
      expect(pages.get(2)?.getContent).not.toHaveBeenCalled()
      expect(pages.get(4)?.getContent).not.toHaveBeenCalled()
      expect(pages.get(5)?.getContent).not.toHaveBeenCalled()
      expect(screen.queryByText('Page 2 text')).not.toBeInTheDocument()
      expect(screen.queryByText('Page 4 text')).not.toBeInTheDocument()
      expect(screen.queryByText('Page 5 text')).not.toBeInTheDocument()
    })

    it('reloads a lazily evicted jump target and cancels its pending unload', async () => {
      // Given: page 3 has loaded, left the viewport, and been evicted to an empty shell.
      const selectionRef = createRef<ReaderSelectionRef>()
      const { document, pages } = makeDocument({
        pageCount: 3,
        pageSize: { x: 100, y: 150 }
      })
      render(
        <IntermediateDocumentViewer
          document={document}
          ranges={[pageThreeRange]}
          selectionRef={selectionRef}
          initialLoadedPages={3}
          overscan={0}
        />
      )
      await screen.findByText('Page 3 text')
      const page3 = screen.getByTestId('intermediate-page-3')
      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(page3, false)
        act(() => {
          vi.advanceTimersByTime(5000)
        })
        expect(screen.queryByText('Page 3 text')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
      mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
        left: 0,
        top: 0,
        width: 50,
        height: 100
      })

      // When: the evicted page is targeted by scrollToRange, then an old hidden signal fires.
      act(() => {
        requireReaderSelectionRef(selectionRef).scrollToRange('jump-page-3')
      })
      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(page3, false)
        act(() => {
          vi.advanceTimersByTime(5000)
        })
      } finally {
        vi.useRealTimers()
      }

      // Then: lazilyEvictedPagesRef no longer makes the queue skip the page; it reloads once.
      await screen.findByText('Page 3 text')
      expect(pages.get(3)?.getContent).toHaveBeenCalledTimes(2)
    })
  })
})

// ── rangeJumpHelpers (task 3) ─────────────────────────────────────────
// Pure helpers for resolving a public range id → { pageNumber, centerX, centerY }
// using page-N ids, stable rect key ordering, and percent/px coordinate conversion.

describe('rangeJumpHelpers', () => {
  // ── parsePublicPageId ────────────────────────────────────────────────

  describe('parsePublicPageId', () => {
    it('parses valid page-3 to 3', () => {
      expect(parsePublicPageId('page-3')).toBe(3)
    })

    it('parses page-1 to 1', () => {
      expect(parsePublicPageId('page-1')).toBe(1)
    })

    it('parses page-999 to 999', () => {
      expect(parsePublicPageId('page-999')).toBe(999)
    })

    it('returns null for malformed id "foo"', () => {
      expect(parsePublicPageId('foo')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parsePublicPageId('')).toBeNull()
    })

    it('returns null for page-0 (zero page number)', () => {
      expect(parsePublicPageId('page-0')).toBeNull()
    })

    it('returns null for page-1.5 (non-integer)', () => {
      expect(parsePublicPageId('page-1.5')).toBeNull()
    })

    it('returns null for page- (missing number)', () => {
      expect(parsePublicPageId('page-')).toBeNull()
    })

    it('returns null for scoped id like "scope-1:page-2"', () => {
      expect(parsePublicPageId('scope-1:page-2')).toBeNull()
    })
  })

  // ── findRangeById ────────────────────────────────────────────────────

  describe('findRangeById', () => {
    const ranges: ReaderSelectionRange[] = [
      {
        id: 'range-a',
        text: 'Alpha',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 5 },
        createdAt: 100,
        rectsBySelectionId: {
          'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
        }
      },
      {
        id: 'range-b',
        text: 'Bravo',
        start: { selectionId: 'page-2', offset: 0 },
        end: { selectionId: 'page-2', offset: 5 },
        createdAt: 200,
        rectsBySelectionId: {
          'page-2': [{ x: 50, y: 60, width: 40, height: 20 }]
        }
      }
    ]

    it('finds range-a by id', () => {
      const found = findRangeById(ranges, 'range-a')
      expect(found?.id).toBe('range-a')
      expect(found?.text).toBe('Alpha')
    })

    it('finds range-b by id', () => {
      const found = findRangeById(ranges, 'range-b')
      expect(found?.id).toBe('range-b')
    })

    it('returns null for missing id', () => {
      expect(findRangeById(ranges, 'range-missing')).toBeNull()
    })

    it('returns null for empty ranges array', () => {
      expect(findRangeById([], 'range-a')).toBeNull()
    })
  })

  // ── selectTargetRect ─────────────────────────────────────────────────

  describe('selectTargetRect', () => {
    it('selects first rect from start.selectionId when that key has rects', () => {
      const range: ReaderSelectionRange = {
        id: 'r1',
        text: '',
        start: { selectionId: 'page-2', offset: 0 },
        end: { selectionId: 'page-2', offset: 5 },
        createdAt: 0,
        rectsBySelectionId: {
          'page-1': [{ x: 10, y: 10, width: 10, height: 10 }],
          'page-2': [
            { x: 20, y: 20, width: 20, height: 20 },
            { x: 30, y: 30, width: 30, height: 30 }
          ]
        }
      }

      const result = selectTargetRect(range)
      expect(result?.pageId).toBe('page-2')
      expect(result?.rect).toEqual({ x: 20, y: 20, width: 20, height: 20 })
    })

    it('falls back to first available rect by stable key order when start key is missing', () => {
      const range: ReaderSelectionRange = {
        id: 'r2',
        text: '',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 5 },
        createdAt: 0,
        rectsBySelectionId: {
          'page-3': [{ x: 50, y: 60, width: 40, height: 20 }],
          'page-2': [{ x: 10, y: 20, width: 30, height: 10 }]
        }
      }

      // start key 'page-1' has no rects → fallback to sorted keys → 'page-2' < 'page-3'
      const result = selectTargetRect(range)
      expect(result?.pageId).toBe('page-2')
      expect(result?.rect).toEqual({ x: 10, y: 20, width: 30, height: 10 })
    })

    it('returns null when rectsBySelectionId is empty', () => {
      const range: ReaderSelectionRange = {
        id: 'r3',
        text: '',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 5 },
        createdAt: 0,
        rectsBySelectionId: {}
      }

      expect(selectTargetRect(range)).toBeNull()
    })

    it('returns null when all rect arrays are empty', () => {
      const range: ReaderSelectionRange = {
        id: 'r4',
        text: '',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 5 },
        createdAt: 0,
        rectsBySelectionId: { 'page-1': [], 'page-2': [] }
      }

      expect(selectTargetRect(range)).toBeNull()
    })

    it('skips start key with empty rect array and falls back', () => {
      const range: ReaderSelectionRange = {
        id: 'r5',
        text: '',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 5 },
        createdAt: 0,
        rectsBySelectionId: {
          'page-1': [],
          'page-2': [{ x: 5, y: 5, width: 5, height: 5 }]
        }
      }

      const result = selectTargetRect(range)
      expect(result?.pageId).toBe('page-2')
      expect(result?.rect).toEqual({ x: 5, y: 5, width: 5, height: 5 })
    })
  })

  // ── rectCenterToPagePixels ───────────────────────────────────────────

  describe('rectCenterToPagePixels', () => {
    it('converts percent rect { x:60, y:20, width:20, height:10 } on 1000x1000 page to center (700,250)', () => {
      const center = rectCenterToPagePixels(
        { x: 60, y: 20, width: 20, height: 10 },
        'percent',
        1000,
        1000
      )
      expect(center).toEqual({ centerX: 700, centerY: 250 })
    })

    it('converts px rect { x:600, y:200, width:200, height:100 } to center (700,250)', () => {
      const center = rectCenterToPagePixels(
        { x: 600, y: 200, width: 200, height: 100 },
        'px',
        1000,
        1000
      )
      // centerX = 600 + 200/2 = 700, centerY = 200 + 100/2 = 250
      expect(center).toEqual({ centerX: 700, centerY: 250 })
    })

    it('handles zero-size rect (point)', () => {
      const center = rectCenterToPagePixels(
        { x: 500, y: 500, width: 0, height: 0 },
        'px',
        1000,
        1000
      )
      expect(center).toEqual({ centerX: 500, centerY: 500 })
    })

    it('percent rect on non-square page scales axes independently', () => {
      const center = rectCenterToPagePixels(
        { x: 0, y: 0, width: 100, height: 100 },
        'percent',
        800,
        600
      )
      // Full-page rect: centerX = 50% * 800 = 400, centerY = 50% * 600 = 300
      expect(center).toEqual({ centerX: 400, centerY: 300 })
    })
  })

  // ── resolveRangeJumpTarget (integration) ─────────────────────────────

  describe('resolveRangeJumpTarget', () => {
    const ranges: ReaderSelectionRange[] = [
      {
        id: 'hl-1',
        text: 'Page 1 highlight',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 10 },
        createdAt: 100,
        overlayRectType: 'percent',
        rectsBySelectionId: {
          'page-1': [{ x: 10, y: 20, width: 50, height: 5 }]
        }
      },
      {
        id: 'hl-2',
        text: 'Page 3 cross-page',
        start: { selectionId: 'page-3', offset: 0 },
        end: { selectionId: 'page-4', offset: 5 },
        createdAt: 200,
        overlayRectType: 'percent',
        rectsBySelectionId: {
          'page-3': [
            { x: 60, y: 20, width: 20, height: 10 },
            { x: 80, y: 30, width: 10, height: 5 }
          ],
          'page-4': [{ x: 5, y: 10, width: 80, height: 5 }]
        }
      },
      {
        id: 'hl-3',
        text: 'Page 2 no rects',
        start: { selectionId: 'page-2', offset: 0 },
        end: { selectionId: 'page-2', offset: 5 },
        createdAt: 300,
        rectsBySelectionId: {}
      },
      {
        id: 'hl-4',
        text: 'Page 5 px rect',
        start: { selectionId: 'page-5', offset: 0 },
        end: { selectionId: 'page-5', offset: 5 },
        createdAt: 400,
        overlayRectType: 'px',
        rectsBySelectionId: {
          'page-5': [{ x: 600, y: 200, width: 200, height: 100 }]
        }
      }
    ]

    it('resolves hl-1 on page-1 with percent rect center', () => {
      const target = resolveRangeJumpTarget({
        ranges,
        rangeId: 'hl-1',
        pageWidth: 1000,
        pageHeight: 1000
      })
      // percent: x=10+50/2=35% → 350, y=20+5/2=22.5% → 225
      expect(target).toEqual({
        pageNumber: 1,
        centerX: 350,
        centerY: 225
      })
    })

    it('resolves hl-2 using start page-3 first rect (percent on 1000x1000)', () => {
      const target = resolveRangeJumpTarget({
        ranges,
        rangeId: 'hl-2',
        pageWidth: 1000,
        pageHeight: 1000
      })
      // start page = page-3, first rect = {x:60,y:20,w:20,h:10}
      // centerX = (60+10)/100*1000 = 700, centerY = (20+5)/100*1000 = 250
      expect(target).toEqual({
        pageNumber: 3,
        centerX: 700,
        centerY: 250
      })
    })

    it('returns null for range with empty rectsBySelectionId (hl-3)', () => {
      const target = resolveRangeJumpTarget({
        ranges,
        rangeId: 'hl-3',
        pageWidth: 1000,
        pageHeight: 1000
      })
      expect(target).toBeNull()
    })

    it('resolves hl-4 with px rect (700, 250)', () => {
      const target = resolveRangeJumpTarget({
        ranges,
        rangeId: 'hl-4',
        pageWidth: 1000,
        pageHeight: 1000
      })
      // px: centerX = 600+100=700, centerY = 200+50=250
      expect(target).toEqual({
        pageNumber: 5,
        centerX: 700,
        centerY: 250
      })
    })

    it('returns null for non-existent range id', () => {
      const target = resolveRangeJumpTarget({
        ranges,
        rangeId: 'does-not-exist',
        pageWidth: 1000,
        pageHeight: 1000
      })
      expect(target).toBeNull()
    })

    it('explicit rectType overrides range.overlayRectType', () => {
      // hl-4 has overlayRectType='px', but force 'percent' override
      const target = resolveRangeJumpTarget({
        ranges,
        rangeId: 'hl-4',
        rectType: 'percent',
        pageWidth: 1000,
        pageHeight: 1000
      })
      // percent: (600+200/2)/100*1000 = 7000 → huge, but proves override works
      expect(target).not.toBeNull()
      expect(target?.centerX).toBe(7000)
    })

    it('falls back to percent when no overlayRectType is set', () => {
      const noTypeRanges: ReaderSelectionRange[] = [
        {
          id: 'no-type',
          text: '',
          start: { selectionId: 'page-1', offset: 0 },
          end: { selectionId: 'page-1', offset: 5 },
          createdAt: 0,
          rectsBySelectionId: {
            'page-1': [{ x: 50, y: 50, width: 0, height: 0 }]
          }
        }
      ]

      const target = resolveRangeJumpTarget({
        ranges: noTypeRanges,
        rangeId: 'no-type',
        pageWidth: 800,
        pageHeight: 600
      })
      // percent: 50%*800=400, 50%*600=300
      expect(target).toEqual({
        pageNumber: 1,
        centerX: 400,
        centerY: 300
      })
    })
  })

  // ── computePageOriginY ──────────────────────────────────────────────

  describe('computePageOriginY', () => {
    const pageSizes = new Map([
      [1, { width: 1000, height: 3000 }],
      [2, { width: 800, height: 1200 }],
      [3, { width: 600, height: 900 }]
    ])
    const pageNumbers = [1, 2, 3]

    it('returns 0 for the first page (no preceding pages)', () => {
      expect(computePageOriginY(1, pageNumbers, pageSizes)).toBe(0)
    })

    it('sums preceding page heights + gaps for page 2', () => {
      // page 1 height (3000) + gap (16) = 3016
      expect(computePageOriginY(2, pageNumbers, pageSizes)).toBe(3016)
    })

    it('sums all preceding pages for page 3', () => {
      // page1(3000)+gap(16) + page2(1200)+gap(16) = 4232
      expect(computePageOriginY(3, pageNumbers, pageSizes)).toBe(4232)
    })

    it('treats missing page size as height 0', () => {
      const sparseSizes = new Map([[2, { width: 800, height: 500 }]])
      // page 1 missing → height 0 + gap 16 = 16
      expect(computePageOriginY(2, [1, 2], sparseSizes)).toBe(16)
    })
  })

  // ── computeTransform ────────────────────────────────────────────────

  describe('computeTransform', () => {
    // Spec test matrix: viewport 500×500, content 1000×3000, scale 1.
    const base = {
      viewportWidth: 500,
      viewportHeight: 500,
      contentWidth: 1000,
      contentHeight: 3000,
      scale: 1
    }

    it('centers target (700, 2250) → unclamped x=-450, y=-2000', () => {
      // rawX = 500/2 - 700*1 = -450  (within [-500, 0])
      // rawY = 500/2 - 2250*1 = -2000 (within [-2500, 0])
      const t = computeTransform({
        ...base,
        targetContentX: 700,
        targetContentY: 2250
      })
      expect(t).toEqual({ x: -450, y: -2000, scale: 1 })
    })

    it('clamps x and y for target beyond bottom-right edge', () => {
      // rawX = 250 - 1500*1 = -1250 → clamped to -500
      // rawY = 250 - 4000*1 = -3750 → clamped to -2500
      const t = computeTransform({
        ...base,
        targetContentX: 1500,
        targetContentY: 4000
      })
      expect(t).not.toBeNull()
      if (t === null) {
        throw new Error('Expected transform to be available')
      }
      expect(t.x).toBe(-500)
      expect(t.y).toBe(-2500)
    })

    it('clamps x and y for target beyond top-left edge', () => {
      // rawX = 250 - (-200)*1 = 450 → clamped to 0
      // rawY = 250 - (-100)*1 = 350 → clamped to 0
      const t = computeTransform({
        ...base,
        targetContentX: -200,
        targetContentY: -100
      })
      expect(t).not.toBeNull()
      if (t === null) {
        throw new Error('Expected transform to be available')
      }
      expect(t.x).toBe(0)
      expect(t.y).toBe(0)
    })

    it('centers axis when content is smaller than viewport', () => {
      // content 400×300, viewport 500×500, scale 1
      // scaledW=400 < 500 → center: (500-400)/2 = 50
      // scaledH=300 < 500 → center: (500-300)/2 = 100
      const t = computeTransform({
        viewportWidth: 500,
        viewportHeight: 500,
        contentWidth: 400,
        contentHeight: 300,
        targetContentX: 200,
        targetContentY: 150,
        scale: 1
      })
      expect(t).toEqual({ x: 50, y: 100, scale: 1 })
    })

    it('ignores target position when content < viewport (always centered)', () => {
      // Same content/viewport as above but target at extreme position
      const t = computeTransform({
        viewportWidth: 500,
        viewportHeight: 500,
        contentWidth: 400,
        contentHeight: 300,
        targetContentX: 0,
        targetContentY: 0,
        scale: 1
      })
      // Still centered at (50, 100) — contain forces centering.
      expect(t).toEqual({ x: 50, y: 100, scale: 1 })
    })

    it('returns null for zero viewport width', () => {
      expect(
        computeTransform({
          ...base,
          viewportWidth: 0,
          targetContentX: 100,
          targetContentY: 100
        })
      ).toBeNull()
    })

    it('returns null for zero viewport height', () => {
      expect(
        computeTransform({
          ...base,
          viewportHeight: 0,
          targetContentX: 100,
          targetContentY: 100
        })
      ).toBeNull()
    })

    it('returns null for zero content width', () => {
      expect(
        computeTransform({
          ...base,
          contentWidth: 0,
          targetContentX: 100,
          targetContentY: 100
        })
      ).toBeNull()
    })

    it('returns null for zero content height', () => {
      expect(
        computeTransform({
          ...base,
          contentHeight: 0,
          targetContentX: 100,
          targetContentY: 100
        })
      ).toBeNull()
    })

    it('returns null for zero scale', () => {
      expect(
        computeTransform({
          ...base,
          scale: 0,
          targetContentX: 100,
          targetContentY: 100
        })
      ).toBeNull()
    })

    it('returns null for NaN viewport', () => {
      expect(
        computeTransform({
          ...base,
          viewportWidth: NaN,
          targetContentX: 100,
          targetContentY: 100
        })
      ).toBeNull()
    })

    it('returns null for NaN target coordinates', () => {
      expect(
        computeTransform({ ...base, targetContentX: NaN, targetContentY: 100 })
      ).toBeNull()
    })

    it('returns null for negative scale', () => {
      expect(
        computeTransform({
          ...base,
          scale: -1,
          targetContentX: 100,
          targetContentY: 100
        })
      ).toBeNull()
    })

    it('applies scale correctly to clamping', () => {
      // content 1000×3000, scale 0.5 → scaled 500×1500, viewport 500×500
      // scaledW=500 == viewportW=500 → center: (500-500)/2 = 0
      // scaledH=1500 > 500 → clamp
      // rawY = 250 - 1500*0.5 = -500, clamp to [-1000, 0] → -500
      const t = computeTransform({
        viewportWidth: 500,
        viewportHeight: 500,
        contentWidth: 1000,
        contentHeight: 3000,
        targetContentX: 500,
        targetContentY: 1500,
        scale: 0.5
      })
      expect(t).toEqual({ x: 0, y: -500, scale: 0.5 })
    })

    it('applies scale > 1 correctly', () => {
      // content 300×200, scale 2 → scaled 600×400, viewport 500×500
      // scaledW=600 > 500 → clamp
      // rawX = 250 - 150*2 = -50, clamp to [-100, 0] → -50
      // scaledH=400 < 500 → center: (500-400)/2 = 50
      const t = computeTransform({
        viewportWidth: 500,
        viewportHeight: 500,
        contentWidth: 300,
        contentHeight: 200,
        targetContentX: 150,
        targetContentY: 100,
        scale: 2
      })
      expect(t).toEqual({ x: -50, y: 50, scale: 2 })
    })
  })
})

describe('touchPanMode', () => {
  it('默认模式包含 TouchSingleFingerPan 和 TouchTwoFingerZoom', () => {
    const { document } = makeDocument({ pageCount: 1 })
    render(<IntermediateDocumentViewer document={document} />)
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const interactions = wrapper.dataset.enabledInteractions ?? ''
    expect(interactions).toContain(
      VirtualPaperInteractionMode.TouchSingleFingerPan
    )
    expect(interactions).toContain(
      VirtualPaperInteractionMode.TouchTwoFingerZoom
    )
  })

  it('显式 single-finger 模式与默认一致', () => {
    const { document } = makeDocument({ pageCount: 1 })
    render(
      <IntermediateDocumentViewer
        document={document}
        touchPanMode='single-finger'
      />
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const interactions = wrapper.dataset.enabledInteractions ?? ''
    expect(interactions).toContain(
      VirtualPaperInteractionMode.TouchSingleFingerPan
    )
    expect(interactions).toContain(
      VirtualPaperInteractionMode.TouchTwoFingerZoom
    )
  })

  it('two-finger 模式排除 TouchSingleFingerPan，保留其他交互', () => {
    const { document } = makeDocument({ pageCount: 1 })
    render(
      <IntermediateDocumentViewer
        document={document}
        touchPanMode='two-finger'
      />
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const interactions = wrapper.dataset.enabledInteractions ?? ''
    expect(interactions).not.toContain(
      VirtualPaperInteractionMode.TouchSingleFingerPan
    )
    expect(interactions).toContain(
      VirtualPaperInteractionMode.TouchTwoFingerZoom
    )
    expect(interactions).toContain(
      VirtualPaperInteractionMode.TrackpadScrollPan
    )
    expect(interactions).toContain(
      VirtualPaperInteractionMode.MouseWheelCtrlZoom
    )
  })

  it('从 two-finger 切换到 single-finger 后 TouchSingleFingerPan 重新出现', () => {
    const { document } = makeDocument({ pageCount: 1 })
    const { rerender } = render(
      <IntermediateDocumentViewer
        document={document}
        touchPanMode='two-finger'
      />
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.dataset.enabledInteractions).not.toContain(
      VirtualPaperInteractionMode.TouchSingleFingerPan
    )

    rerender(
      <IntermediateDocumentViewer
        document={document}
        touchPanMode='single-finger'
      />
    )
    expect(wrapper.dataset.enabledInteractions).toContain(
      VirtualPaperInteractionMode.TouchSingleFingerPan
    )
  })

  describe('page browser', () => {
    it('is hidden by default and slides open through the public prop', () => {
      const { document } = makeDocument({ pageCount: 3 })
      const { rerender } = render(
        <IntermediateDocumentViewer document={document} />
      )
      const browser = screen.getByTestId('page-browser')

      expect(browser).toHaveAttribute('aria-hidden', 'true')
      expect(browser).not.toHaveClass('hamster-reader__page-browser--open')

      rerender(
        <IntermediateDocumentViewer
          document={document}
          showPageBrowser={true}
        />
      )

      expect(browser).toHaveAttribute('aria-hidden', 'false')
      expect(browser).toHaveClass('hamster-reader__page-browser--open')
      expect(
        screen.getAllByRole('button', { name: /Go to page/ })
      ).toHaveLength(3)
    })

    it('loads a sustained visible thumbnail through the shared lazy queue', async () => {
      const { document, pages } = makeDocument({ pageCount: 3 })
      const pageThree = pages.get(3)
      if (!pageThree) {
        throw new Error('Expected page 3 fixture')
      }
      pageThree.getThumbnail = vi.fn(async () => 'page-3-thumbnail')

      render(
        <IntermediateDocumentViewer
          document={document}
          showPageBrowser={true}
        />
      )
      await waitFor(() => {
        expect(document.getPageByPageNumber).toHaveBeenCalledWith(1)
      })

      vi.useFakeTimers()
      try {
        intersectionObserverMock.trigger(
          screen.getByTestId('page-browser-page-3')
        )
        act(() => {
          vi.advanceTimersByTime(500)
        })
        for (let index = 0; index < 20; index += 1) {
          await Promise.resolve()
        }

        expect(document.getPageByPageNumber).toHaveBeenCalledWith(3)
        expect(pages.get(3)?.getThumbnail).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
