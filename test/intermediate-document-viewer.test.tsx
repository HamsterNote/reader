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
  getPageElementByPageNumber,
  isNonSpaceBlankText,
  mergeSelectionRects,
  type ReaderSavedSelection,
  type ReaderSelectionHandleRenderProps
} from '../src/components/IntermediateDocumentViewer'
import {
  getPageElementForPoint,
  isSelectionBackgroundTarget,
  resolveCaret
} from '../src/components/selection/caretResolver'
import { textHash } from '../src/components/selection/savedSelection'
import {
  composeSelection,
  createOrderedRange
} from '../src/components/selection/selectionComposer'
import {
  buildSelectionPayload as buildSerializedSelectionPayload,
  type ReaderSelectedTextSegment,
  textElementRecords as serializerTextElementRecords
} from '../src/components/selection/selectionPayloadSerializer'
import { IntermediateDocumentViewer } from '../src/index'
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

vi.mock('@system-ui-js/multi-drag', () => {
  const dragInstancesKey = '__hamsterReaderMockDragInstances'
  type MockFingerInput = {
    pointerId: number
    clientX: number
    clientY: number
    timeStamp?: number
  }
  type MockFinger = {
    pointerId: number
    getLastOperation: () => {
      point: { x: number; y: number }
      timestamp: number
    }
  }
  type MockDragOptions = {
    maxFingerCount?: number
    inertial?: boolean
    passive?: boolean
    getPose?: (element: HTMLElement) => unknown
    setPose?: (element: HTMLElement, pose: unknown) => void
    setPoseOnEnd?: (element: HTMLElement, pose: unknown) => void
  }
  const DragOperationType = {
    Start: 'start',
    Move: 'move',
    End: 'end',
    Inertial: 'inertial',
    InertialEnd: 'inertialEnd',
    AllEnd: 'allEnd'
  }

  const makeFinger = (input: MockFingerInput): MockFinger => {
    const timestamp = input.timeStamp ?? 0
    return {
      pointerId: input.pointerId,
      getLastOperation: () => ({
        point: { x: input.clientX, y: input.clientY },
        timestamp
      })
    }
  }

  const makeFingerFromEvent = (event: MouseEvent | PointerEvent) =>
    makeFinger({
      pointerId: (event as PointerEvent).pointerId ?? 1,
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: event.timeStamp
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
        Array<(fingers: MockFinger[]) => void>
      >()
      private primaryPointerId: number | null = null
      public destroyCount = 0

      constructor(
        private readonly element: HTMLElement,
        public readonly options: MockDragOptions = {}
      ) {
        getDragInstances().push(this)
        this.element.addEventListener('pointerdown', this.handlePointerDown)
        this.element.addEventListener('pointermove', this.handlePointerMove)
        this.element.addEventListener('pointerup', this.handlePointerEnd)
        this.element.addEventListener('pointercancel', this.handlePointerEnd)
      }

      addEventListener(
        type: string,
        callback: (fingers: MockFinger[]) => void
      ) {
        const callbacks = this.listeners.get(type) ?? []
        callbacks.push(callback)
        this.listeners.set(type, callbacks)
      }

      removeEventListener(
        type: string,
        callback?: (fingers: MockFinger[]) => void
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
        this.destroyCount += 1
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

      emit(type: string, fingers: MockFingerInput[]) {
        this.listeners.get(type)?.forEach((listener) => {
          listener(fingers.map(makeFinger))
        })
      }

      private emitPointer(type: string, event: MouseEvent | PointerEvent) {
        this.listeners.get(type)?.forEach((listener) => {
          listener([makeFingerFromEvent(event)])
        })
      }

      private handlePointerDown = (event: MouseEvent | PointerEvent) => {
        if (event.button !== 0) return
        this.primaryPointerId = (event as PointerEvent).pointerId ?? 1
        this.emitPointer(DragOperationType.Start, event)
      }

      private handlePointerMove = (event: MouseEvent | PointerEvent) => {
        if (this.primaryPointerId === null) return
        this.emitPointer(DragOperationType.Move, event)
      }

      private handlePointerEnd = (event: MouseEvent | PointerEvent) => {
        if (this.primaryPointerId === null) return
        this.emitPointer(DragOperationType.End, event)
        this.emitPointer(DragOperationType.AllEnd, event)
        this.primaryPointerId = null
      }
    }
  }
})

const getMockDragInstances = () =>
  (Reflect.get(globalThis, '__hamsterReaderMockDragInstances') as
    | Array<{
        element: HTMLElement
        options: {
          maxFingerCount?: number
          inertial?: boolean
          passive?: boolean
          getPose?: (element: HTMLElement) => unknown
          setPose?: (element: HTMLElement, pose: unknown) => void
          setPoseOnEnd?: (element: HTMLElement, pose: unknown) => void
        }
        destroyCount: number
        emit: (
          type: string,
          fingers: Array<{
            pointerId: number
            clientX: number
            clientY: number
            timeStamp?: number
          }>
        ) => void
      }>
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

const makeSavedSelection = (options: {
  id: string
  pageNumber?: number
  textId?: string
  content?: string
  startCharIndex?: number
  endCharIndex?: number
  visualRects?: Array<{
    pageNumber: number
    x: number
    y: number
    width: number
    height: number
  }>
  pageSize?: { width: number; height: number }
  fallbackOnly?: boolean
}): ReaderSavedSelection => {
  const pageNumber = options.pageNumber ?? 1
  const content = options.content ?? ''
  const textId = options.textId
  const startCharIndex = options.startCharIndex ?? 0
  const endCharIndex = options.endCharIndex ?? content.length
  const pageSize = options.pageSize ?? { width: 100, height: 150 }
  const hash = textHash(content)

  const normalize = (rect: {
    pageNumber: number
    x: number
    y: number
    width: number
    height: number
  }) => ({
    x: Number((rect.x / pageSize.width).toFixed(6)),
    y: Number((rect.y / pageSize.height).toFixed(6)),
    width: Number((rect.width / pageSize.width).toFixed(6)),
    height: Number((rect.height / pageSize.height).toFixed(6))
  })

  const visual = (options.visualRects ?? []).map((rect) => ({
    pageNumber: rect.pageNumber,
    pageSize,
    rects: [normalize(rect)]
  }))

  const contextBefore = (index: number) =>
    content.slice(Math.max(0, index - 24), index)
  const contextAfter = (index: number) => content.slice(index, index + 24)

  const anchor = (charIndex: number) => ({
    pageNumber,
    textId,
    textHash: hash,
    charIndex,
    contextBefore: contextBefore(charIndex),
    contextAfter: contextAfter(charIndex),
    bbox: undefined
  })

  const segment = {
    pageNumber,
    textId,
    textHash: hash,
    startCharIndex,
    endCharIndex,
    selectedText: content.slice(startCharIndex, endCharIndex),
    contextBefore: contextBefore(startCharIndex),
    contextAfter: contextAfter(endCharIndex),
    bbox: undefined
  }

  return {
    version: 1,
    id: options.id,
    text: content,
    start: options.fallbackOnly ? { pageNumber } : anchor(startCharIndex),
    end: options.fallbackOnly ? { pageNumber } : anchor(endCharIndex),
    segments: options.fallbackOnly ? [] : [segment],
    visual
  }
}

// Task 4: 查询已保存选择手柄容器中的 start/end 手柄。
const getSavedHandles = (container: HTMLElement) => {
  const handlesContainer = container.querySelector(
    '.hamster-reader__saved-selection-handles'
  ) as HTMLElement | null
  if (!handlesContainer) return { start: null, end: null, all: [] }
  const all = Array.from(
    handlesContainer.querySelectorAll('.hamster-reader__selection-handle')
  ) as HTMLElement[]
  const start = handlesContainer.querySelector('[data-handle-type="start"]')
  const end = handlesContainer.querySelector('[data-handle-type="end"]')
  return { start, end, all }
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

  const control = document.createElement('button')
  control.className = 'hamster-reader__selection-handle'
  control.textContent = 'Control'

  const savedOverlay = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path'
  )
  savedOverlay.setAttribute('class', 'hamster-reader__selection-overlay-path')

  viewerRoot.append(output, control, savedOverlay)
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
    controlTextNode: getRequiredTextNode(control),
    savedOverlay,
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

  it('rejects html-parser background, control, overlay, and outside ranges', () => {
    const { viewerRoot, page, controlTextNode, savedOverlay, outsideTextNode } =
      makeHtmlParserCaretFixture()
    mockElementFromPoint(page)

    const resolveHtmlParserRange = (range: Range) =>
      resolveCaret(30, 15, {
        viewerRoot,
        pageRefs: new Map(),
        textElements: new Map(),
        allowHtmlParserRange: true,
        caretPositionFromPoint: () => null,
        caretRangeFromPoint: () => range
      })

    expect(resolveHtmlParserRange(makeCollapsedRange(page, 0))).toBeNull()
    expect(
      resolveHtmlParserRange(makeCollapsedRange(controlTextNode, 1))
    ).toBeNull()
    expect(
      resolveHtmlParserRange(makeCollapsedRange(savedOverlay, 0))
    ).toBeNull()
    expect(
      resolveHtmlParserRange(makeCollapsedRange(outsideTextNode, 1))
    ).toBeNull()
  })

  it('resolves html-parser page when point hits selection overlay chrome', () => {
    const { viewerRoot, page, savedOverlay } = makeHtmlParserCaretFixture()
    const localElementFromPointSpy = mockElementFromPoint(savedOverlay)
    const pageRectSpy = mockElementRect(page, {
      left: 10,
      top: 20,
      width: 100,
      height: 150
    })

    try {
      const result = getPageElementForPoint(40, 60, viewerRoot, new Map())

      expect(result?.pageElement).toBe(page)
      expect(result?.pageNumber).toBe(1)
    } finally {
      pageRectSpy.mockRestore()
      localElementFromPointSpy.mockRestore()
    }
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

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(
      pages.get(1),
      undefined
    )
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

  it('passes undefined backgroundQuality options to decodePageToHtml when absent', async () => {
    const { document } = makeDocument({ pageCount: 1 })
    vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(
      '<div class="hamster-note-page">Default quality</div>'
    )

    render(<IntermediateDocumentViewer document={document} />)

    await screen.findByText('Default quality')

    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(
      expect.anything(),
      undefined
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
    expect(HtmlParser.decodePageToHtml).toHaveBeenCalledWith(
      pages.get(1),
      undefined
    )
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
    expect(HtmlParser.decodePageToHtml).toHaveBeenLastCalledWith(
      pages.get(2),
      undefined
    )
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
      <IntermediateDocumentViewer document={document} />
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

  it('resolves decoded page after first page html parser failure', async () => {
    const { document, pages } = makeDocument({ pageCount: 2 })
    const failedPage = pages.get(1) as unknown
    const savedSelection = makeSavedSelection({
      id: 'saved-page-2',
      fallbackOnly: true,
      visualRects: [{ pageNumber: 2, x: 10, y: 20, width: 40, height: 12 }]
    })
    vi.mocked(HtmlParser.decodePageToHtml).mockImplementation(async (page) => {
      if (page === failedPage) {
        throw new Error('Page 1 failed')
      }
      return '<div class="hamster-note-page"><p>Selectable page 2</p></div>'
    })

    const { rerender } = render(
      <IntermediateDocumentViewer
        document={document}
        overscan={1}
        selectionOverlay
        savedSelections={[savedSelection]}
      />
    )

    await screen.findByText('Selectable page 2')

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const slot1 = screen.getByTestId('intermediate-page-1')
    const slot2 = screen.getByTestId('intermediate-page-2')
    const page2 = slot2.querySelector(
      '.hamster-note-page'
    ) as HTMLElement | null
    if (!page2) {
      throw new Error('Expected page 2 to decode through html-parser')
    }
    expect(slot1.querySelector('.hamster-note-page')).toBeNull()
    expect(
      getPageElementByPageNumber(
        2,
        viewerRoot,
        new Map([[2, slot2 as HTMLDivElement]])
      )
    ).toBe(page2)

    const viewerRectSpy = vi
      .spyOn(viewerRoot, 'getBoundingClientRect')
      .mockReturnValue(
        makeDomRect({ left: 100, top: 200, width: 500, height: 700 })
      )
    const slotRectSpy = vi
      .spyOn(slot2, 'getBoundingClientRect')
      .mockReturnValue(
        makeDomRect({ left: 140, top: 260, width: 300, height: 400 })
      )
    const pageRectSpy = vi
      .spyOn(page2, 'getBoundingClientRect')
      .mockReturnValue(
        makeDomRect({ left: 160, top: 290, width: 250, height: 320 })
      )

    try {
      rerender(
        <IntermediateDocumentViewer
          document={document}
          overscan={1}
          selectionOverlay
          savedSelections={[savedSelection]}
        />
      )

      const getSavedPath = () =>
        Array.from(
          viewerRoot.querySelectorAll(
            '.hamster-reader__saved-selection-overlay'
          )
        )
          .filter(
            (element) => !element.closest('.hamster-reader__intermediate-page')
          )
          .map((element) =>
            element.querySelector(
              '.hamster-reader__saved-selection-overlay-path'
            )
          )
          .find(
            (element): element is SVGPathElement =>
              element instanceof SVGElement
          )
      await waitFor(() => {
        expect(getSavedPath()).toBeInTheDocument()
      })
      const path = getSavedPath()
      expect(path?.getAttribute('data-saved-selection-id')).toBe('saved-page-2')
      expect(path?.getAttribute('d')).toContain('50')
    } finally {
      viewerRectSpy.mockRestore()
      slotRectSpy.mockRestore()
      pageRectSpy.mockRestore()
    }

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
          undefined
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

    it('identifies non-space blank text without hiding ordinary spaces', () => {
      expect(isNonSpaceBlankText('\n')).toBe(true)
      expect(isNonSpaceBlankText('\t')).toBe(true)
      expect(isNonSpaceBlankText('\u00A0')).toBe(true)
      expect(isNonSpaceBlankText('\u200B')).toBe(true)
      expect(isNonSpaceBlankText('')).toBe(false)
      expect(isNonSpaceBlankText(' ')).toBe(false)
      expect(isNonSpaceBlankText('  ')).toBe(false)
      expect(isNonSpaceBlankText(' A ')).toBe(false)
      expect(isNonSpaceBlankText('A')).toBe(false)
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

    it('getSelectionOverlayRects omits non-space blank text rects while preserving space rects', () => {
      const pageViewport = { left: 0, top: 0, width: 400, height: 150 }
      const page = createMockPageElement(1, pageViewport)
      const viewerRoot = document.createElement('div')
      document.body.appendChild(viewerRoot)
      viewerRoot.appendChild(page)

      const makeTextSpan = (
        id: string,
        content: string,
        rect: { left: number; top: number; width: number; height: number }
      ) => {
        const span = document.createElement('span')
        span.setAttribute('data-text-id', id)
        span.setAttribute('data-page-number', '1')
        span.textContent = content
        vi.spyOn(span, 'getBoundingClientRect').mockReturnValue({
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
        page.appendChild(span)
        return span
      }

      const visibleA = makeTextSpan('text-a', 'A', {
        left: 10,
        top: 10,
        width: 10,
        height: 16
      })
      makeTextSpan('text-blank', '\u200B', {
        left: 20,
        top: 10,
        width: 10,
        height: 16
      })
      makeTextSpan('text-space', ' ', {
        left: 30,
        top: 10,
        width: 10,
        height: 16
      })
      const visibleB = makeTextSpan('text-b', 'B', {
        left: 40,
        top: 10,
        width: 10,
        height: 16
      })

      if (!('elementFromPoint' in document)) {
        Object.defineProperty(document, 'elementFromPoint', {
          value: vi.fn(),
          writable: true,
          configurable: true
        })
      }
      const elementFromPointSpy = vi
        .spyOn(document, 'elementFromPoint')
        .mockReturnValue(page)

      const range = document.createRange()
      range.setStart(visibleA.firstChild ?? visibleA, 0)
      range.setEnd(visibleB.firstChild ?? visibleB, 1)
      const selection = makeMockSelectionFromRange(range)
      const pageRefs = new Map<number, HTMLDivElement>([
        [1, page as HTMLDivElement]
      ])
      const textElements = new Map<
        string,
        { text: IntermediateText; pageNumber: number }
      >([
        [
          'text-a',
          {
            text: { id: 'text-a', content: 'A' } as IntermediateText,
            pageNumber: 1
          }
        ],
        [
          'text-blank',
          {
            text: { id: 'text-blank', content: '\u200B' } as IntermediateText,
            pageNumber: 1
          }
        ],
        [
          'text-space',
          {
            text: { id: 'text-space', content: ' ' } as IntermediateText,
            pageNumber: 1
          }
        ],
        [
          'text-b',
          {
            text: { id: 'text-b', content: 'B' } as IntermediateText,
            pageNumber: 1
          }
        ]
      ])

      const result = getSelectionOverlayRects(
        selection,
        viewerRoot,
        pageRefs,
        textElements
      )

      expect(result).toHaveLength(3)
      expect(result).toContainEqual(
        expect.objectContaining({ x: 10, y: 10, width: 10, height: 16 })
      )
      expect(result).toContainEqual(
        expect.objectContaining({ x: 30, y: 10, width: 10, height: 16 })
      )
      expect(result).toContainEqual(
        expect.objectContaining({ x: 40, y: 10, width: 10, height: 16 })
      )
      expect(result).not.toContainEqual(
        expect.objectContaining({ x: 20, y: 10, width: 10, height: 16 })
      )

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

    it('scale geometry keeps getSelectionOverlayRects page-relative under transformed pages', () => {
      const pageViewport = { left: 20, top: 40, width: 200, height: 200 }
      const page = createMockPageElement(1, pageViewport)
      const scaleSurface = document.createElement('div')
      scaleSurface.dataset.testid = 'virtual-paper-container'
      scaleSurface.style.transform = 'translate3d(12px, 0px, 0) scale(2)'

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
        .mockReturnValue(page)

      const range = makeMockRange([
        { left: 60, top: 80, width: 40, height: 20 }
      ])
      const selection = makeMockSelectionFromRange(range)
      const viewerRoot = document.createElement('div')
      document.body.appendChild(viewerRoot)
      viewerRoot.appendChild(scaleSurface)
      scaleSurface.appendChild(page)

      const result = getSelectionOverlayRects(selection, viewerRoot, pageRefs)

      expect(result).toEqual([
        { x: 20, y: 20, width: 20, height: 10, pageNumber: 1 }
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

    const getDescendantTextNode = (element: HTMLElement, index: number) => {
      const nodes: Text[] = []
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let currentNode = walker.nextNode()
      while (currentNode) {
        if (currentNode.nodeType === Node.TEXT_NODE) {
          nodes.push(currentNode as Text)
        }
        currentNode = walker.nextNode()
      }

      const node = nodes[index]
      if (!node) {
        throw new Error('Expected descendant text node')
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
      Reflect.set(globalThis, '__hamsterReaderMockDragInstances', [])
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
        selectionOverlay?: boolean
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

    const makeDirectRenderTextSelectionWithEndpoints = ({
      selectedTextIds,
      anchorTextId,
      focusTextId,
      selectedText
    }: {
      selectedTextIds: string[]
      anchorTextId: string
      focusTextId: string
      selectedText?: string
    }) => {
      const selectedIds = new Set(selectedTextIds)

      return makeMockSelection({
        isCollapsed: false,
        anchorNode: getTextNode(queryTextSpan(anchorTextId)),
        focusNode: getTextNode(queryTextSpan(focusTextId)),
        toString: () =>
          selectedText ??
          selectedTextIds
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

    const dispatchMouseSelectionMove = (
      target: HTMLElement,
      point: { clientX: number; clientY: number },
      buttons = 1
    ) => {
      const event = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        buttons,
        clientX: point.clientX,
        clientY: point.clientY
      })

      const dispatched = target.dispatchEvent(event)
      return { event, dispatched }
    }

    const dispatchMouseSelectionEnd = (
      point: {
        clientX: number
        clientY: number
      },
      button = 0
    ) => {
      const event = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button,
        clientX: point.clientX,
        clientY: point.clientY
      })

      const dispatched = globalThis.document.dispatchEvent(event)
      return { event, dispatched }
    }

    const dispatchPenDragStart = (
      target: HTMLElement,
      point: { clientX: number; clientY: number }
    ) => {
      dispatchPointerDragStart(target, point, { pointerType: 'pen' })
    }

    const dispatchPenDragMove = (
      target: HTMLElement,
      point: { clientX: number; clientY: number }
    ) => {
      dispatchPointerDragMove(target, point, { pointerType: 'pen' })
    }

    const dispatchPenDragEnd = (
      target: HTMLElement,
      type: 'pointerup' | 'pointercancel',
      point: { clientX: number; clientY: number }
    ) => {
      dispatchPointerDragEnd(target, type, point, { pointerType: 'pen' })
    }

    type RangeRectResolver = (range: Range) => DOMRect[]

    const installRangeGeometryOnObject = (
      range: Range,
      resolveRects: RangeRectResolver
    ) => {
      const originalCloneRange = range.cloneRange.bind(range)
      Object.defineProperty(range, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => resolveRects(range))
      })
      Object.defineProperty(range, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(
          () =>
            resolveRects(range)[0] ??
            makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
        )
      })
      Object.defineProperty(range, 'cloneRange', {
        configurable: true,
        value: vi.fn(() =>
          installRangeGeometryOnObject(originalCloneRange(), resolveRects)
        )
      })
      return range
    }

    const installCreatedRangeGeometry = (resolveRects: RangeRectResolver) => {
      const originalCreateRange = globalThis.document.createRange
      Object.defineProperty(globalThis.document, 'createRange', {
        configurable: true,
        value: vi.fn(() =>
          installRangeGeometryOnObject(
            originalCreateRange.call(globalThis.document),
            resolveRects
          )
        )
      })

      return () => {
        Object.defineProperty(globalThis.document, 'createRange', {
          configurable: true,
          value: originalCreateRange
        })
      }
    }

    const installHtmlParserCaretRangeFromPoint = (
      makeRange: (x: number, y: number) => Range | null
    ) => {
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
        value: vi.fn(makeRange)
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

    it('html-parser long-press shows caret preview from native Range geometry', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p>Native parsed text</p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue(parserHtml)

      render(<IntermediateDocumentViewer document={mockDoc} selectionOverlay />)

      await waitFor(() => {
        expect(screen.getByText('Native parsed text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const paragraph = screen.getByText('Native parsed text')
      const htmlPage = paragraph.closest('.hamster-note-page')
      if (!(htmlPage instanceof HTMLElement)) {
        throw new Error('Expected html-parser page element')
      }

      const textNode = getTextNode(paragraph)
      const wordRect = makeDomRect({ left: 65, top: 95, width: 45, height: 18 })
      const focusCaretRect = makeDomRect({
        left: 130,
        top: 95,
        width: 0,
        height: 18
      })
      let selectedNativeRange: Range | null = null
      const resolveRects: RangeRectResolver = (range) => {
        if (range === selectedNativeRange) return [wordRect]
        if (range.startContainer !== textNode) return []
        if (range.collapsed) return [focusCaretRect]
        if (range.startOffset === 0 && range.endOffset === 6) {
          return [wordRect]
        }
        return [makeDomRect({ left: 65, top: 95, width: 66, height: 18 })]
      }

      const restoreCreatedRangeGeometry =
        installCreatedRangeGeometry(resolveRects)
      const pageRectSpy = mockElementRect(htmlPage, {
        left: 50,
        top: 80,
        width: 200,
        height: 200
      })
      const rootRectSpy = mockElementRect(viewerRoot, {
        left: 10,
        top: 20,
        width: 300,
        height: 300
      })
      const elementFromPointSpy = mockElementFromPoint(paragraph)
      const caretOffset = 2
      const restoreCaretRangeFromPoint = installHtmlParserCaretRangeFromPoint(
        () => {
          const range = globalThis.document.createRange()
          range.setStart(textNode, caretOffset)
          range.collapse(true)
          return range
        }
      )
      const initialRange = globalThis.document.createRange()
      initialRange.selectNodeContents(viewerRoot)
      initialRange.collapse(true)
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      await waitFor(() => {
        expect(
          getMockDragInstances().some(
            (instance) => instance.element === viewerRoot
          )
        ).toBe(true)
      })

      const liveParagraph = screen.getByText('Native parsed text')
      const liveViewerRoot = screen.getByTestId('intermediate-document-viewer')
      const liveHtmlPage = liveParagraph.closest('.hamster-note-page')
      if (!(liveHtmlPage instanceof HTMLElement)) {
        throw new Error('Expected html-parser page element')
      }
      elementFromPointSpy.mockImplementation(() =>
        screen.getByText('Native parsed text')
      )
      mockElementRect(liveHtmlPage, {
        left: 50,
        top: 80,
        width: 200,
        height: 200
      })
      mockElementRect(liveViewerRoot, {
        left: 10,
        top: 20,
        width: 300,
        height: 300
      })

      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (liveSelection.selection.addRange.mock.calls.length > 0) break
          const retryParagraph = screen.getByText('Native parsed text')
          elementFromPointSpy.mockImplementation(() =>
            screen.getByText('Native parsed text')
          )
          await act(async () => {
            dispatchPointerDragStart(
              retryParagraph,
              { clientX: 70, clientY: 100 },
              { pointerId: 31 + attempt, pointerType: 'touch' }
            )
            await new Promise<void>((r) => setTimeout(r, 600))
          })
        }
        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(1)

        const selectedParagraph = screen.getByText('Native parsed text')
        const selectedHtmlPage = selectedParagraph.closest('.hamster-note-page')
        if (!(selectedHtmlPage instanceof HTMLElement)) {
          throw new Error('Expected selected html-parser page element')
        }
        const selectedTextNode = getTextNode(selectedParagraph)

        const nativeRange = globalThis.document.createRange()
        nativeRange.setStart(selectedTextNode, 0)
        nativeRange.setEnd(selectedTextNode, 6)
        installRangeGeometryOnObject(nativeRange, resolveRects)
        selectedNativeRange = nativeRange
        Object.defineProperty(nativeRange, 'getClientRects', {
          configurable: true,
          value: vi.fn(() => [wordRect])
        })
        Object.defineProperty(nativeRange, 'getBoundingClientRect', {
          configurable: true,
          value: vi.fn(() => wordRect)
        })
        getSelectionSpy.mockReturnValue(
          makeMockSelection({
            isCollapsed: false,
            anchorNode: selectedTextNode,
            anchorOffset: 0,
            focusNode: selectedTextNode,
            focusOffset: 6,
            rangeCount: 1,
            getRangeAt: () => nativeRange,
            toString: () => 'Native',
            containsNode: (node) => nativeRange.intersectsNode(node)
          })
        )
        expect(Array.from(nativeRange.getClientRects())).toEqual([wordRect])
        elementFromPointSpy.mockReturnValue(selectedParagraph)
        pageRectSpy.mockRestore()
        mockElementRect(selectedHtmlPage, {
          left: 50,
          top: 80,
          width: 200,
          height: 200
        })
        const previewRects = getSelectionOverlayRects(
          makeMockSelection({
            isCollapsed: false,
            rangeCount: 1,
            getRangeAt: () => nativeRange
          }),
          viewerRoot,
          new Map()
        )

        await act(async () => {
          globalThis.document.dispatchEvent(new Event('selectionchange'))
          globalThis.document.dispatchEvent(new MouseEvent('mouseup'))
          await Promise.resolve()
        })

        expect(previewRects).toEqual([
          { x: 15, y: 15, width: 45, height: 18, pageNumber: 1 }
        ])
      } finally {
        vi.useRealTimers()
        getSelectionSpy.mockRestore()
        restoreCaretRangeFromPoint()
        elementFromPointSpy.mockRestore()
        rootRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreCreatedRangeGeometry()
      }
    })

    it('html-parser drag creates overlay SVG and handles', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p>Native parsed text</p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Native parsed text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const output = screen.getByTestId('html-parser-output')
      const paragraph = screen.getByText('Native parsed text')
      const htmlPage = paragraph.closest('.hamster-note-page')
      if (!(htmlPage instanceof HTMLElement)) {
        throw new Error('Expected html-parser page element')
      }

      const textNode = getTextNode(paragraph)
      const startBoundaryRect = makeDomRect({
        left: 70,
        top: 100,
        width: 0,
        height: 16
      })
      const endBoundaryRect = makeDomRect({
        left: 160,
        top: 100,
        width: 0,
        height: 16
      })
      const fullSelectionRect = makeDomRect({
        left: 70,
        top: 100,
        width: 90,
        height: 16
      })
      const resolveRects: RangeRectResolver = (range) => {
        if (range.startContainer !== textNode) return []
        if (range.collapsed) {
          return range.startOffset <= 1
            ? [startBoundaryRect]
            : [endBoundaryRect]
        }
        return [fullSelectionRect]
      }

      const restoreCreatedRangeGeometry =
        installCreatedRangeGeometry(resolveRects)
      const pageRectSpy = mockElementRect(htmlPage, {
        left: 50,
        top: 80,
        width: 200,
        height: 200
      })
      const slotRectSpy = mockElementRect(
        screen.getByTestId('intermediate-page-1'),
        {
          left: 50,
          top: 80,
          width: 200,
          height: 200
        }
      )
      const rootRectSpy = mockElementRect(viewerRoot, {
        left: 10,
        top: 20,
        width: 300,
        height: 300
      })
      const elementFromPointSpy = mockElementFromPoint(paragraph)
      let caretOffset = 1
      const restoreCaretRangeFromPoint = installHtmlParserCaretRangeFromPoint(
        () => {
          const range = globalThis.document.createRange()
          range.setStart(textNode, caretOffset)
          range.collapse(true)
          return range
        }
      )
      const initialRange = globalThis.document.createRange()
      initialRange.selectNodeContents(viewerRoot)
      initialRange.collapse(true)
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        dispatchPointerDragStart(
          paragraph,
          { clientX: 70, clientY: 108 },
          { pointerType: 'pen' }
        )
        caretOffset = 14
        dispatchPointerDragMove(
          viewerRoot,
          { clientX: 160, clientY: 108 },
          { pointerType: 'pen' }
        )
        dispatchPointerDragEnd(
          viewerRoot,
          'pointerup',
          { clientX: 160, clientY: 108 },
          { pointerType: 'pen' }
        )

        const overlaySvg = viewerRoot.querySelector(
          '.hamster-reader__selection-overlay > .hamster-reader__selection-overlay-svg'
        )
        expect(overlaySvg).toBeInstanceOf(SVGSVGElement)
        expect(
          output.querySelector('.hamster-reader__selection-overlay-svg')
        ).toBeNull()

        const overlayPath = viewerRoot.querySelector(
          '.hamster-reader__selection-overlay .hamster-reader__selection-overlay-path'
        ) as SVGPathElement | null
        expect(overlayPath?.tagName.toLowerCase()).toBe('path')

        await waitFor(() => {
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })
        const startHandle = viewerRoot.querySelector(
          '[data-handle-type="start"]'
        )
        const endHandle = viewerRoot.querySelector('[data-handle-type="end"]')
        expect(startHandle).toHaveStyle({ left: '60px', top: '96px' })
        expect(endHandle).toHaveStyle({ left: '150px', top: '96px' })
      } finally {
        getSelectionSpy.mockRestore()
        restoreCaretRangeFromPoint()
        elementFromPointSpy.mockRestore()
        rootRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        slotRectSpy.mockRestore()
        restoreCreatedRangeGeometry()
      }
    })

    it('html-parser strict mouse drag creates selection overlay and live save payload', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p><span class="hamster-note-text">Native parsed text</span></p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)
      const onSelectText = vi.fn()

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
          onSelectText={onSelectText}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Native parsed text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textElement = screen.getByText('Native parsed text')
      const htmlPage = textElement.closest('.hamster-note-page')
      if (!(htmlPage instanceof HTMLElement)) {
        throw new Error('Expected html-parser page element')
      }

      const textNode = getTextNode(textElement)
      const startBoundaryRect = makeDomRect({
        left: 70,
        top: 100,
        width: 0,
        height: 16
      })
      const endBoundaryRect = makeDomRect({
        left: 160,
        top: 100,
        width: 0,
        height: 16
      })
      const fullSelectionRect = makeDomRect({
        left: 70,
        top: 100,
        width: 90,
        height: 16
      })
      const restoreCreatedRangeGeometry = installCreatedRangeGeometry(
        (range) => {
          if (range.startContainer !== textNode) return []
          if (range.collapsed) {
            return range.startOffset <= 1
              ? [startBoundaryRect]
              : [endBoundaryRect]
          }
          return [fullSelectionRect]
        }
      )
      const pageRectSpy = mockElementRect(htmlPage, {
        left: 50,
        top: 80,
        width: 200,
        height: 200
      })
      const rootRectSpy = mockElementRect(viewerRoot, {
        left: 10,
        top: 20,
        width: 300,
        height: 300
      })
      const textRectSpy = mockElementRect(textElement, {
        left: 70,
        top: 100,
        width: 180,
        height: 16
      })
      const elementFromPointSpy = mockElementFromPointByCoordinate(
        () => htmlPage
      )
      let caretOffset = 1
      const restoreCaretRangeFromPoint = installHtmlParserCaretRangeFromPoint(
        () => {
          const range = globalThis.document.createRange()
          range.setStart(textNode, caretOffset)
          range.collapse(true)
          return range
        }
      )
      const initialRange = globalThis.document.createRange()
      initialRange.selectNodeContents(viewerRoot)
      initialRange.collapse(true)
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        dispatchPointerDragStart(textElement, {
          clientX: 70,
          clientY: 108
        })
        const start = dispatchMouseSelectionStart(textElement, {
          clientX: 70,
          clientY: 108
        })
        expect(start.event.defaultPrevented).toBe(true)

        caretOffset = 14
        const move = dispatchMouseSelectionMove(viewerRoot, {
          clientX: 160,
          clientY: 108
        })
        dispatchPointerDragMove(viewerRoot, {
          clientX: 160,
          clientY: 108
        })
        expect(move.event.defaultPrevented).toBe(true)

        const mouseup = dispatchMouseSelectionEnd({
          clientX: 160,
          clientY: 108
        })
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 160,
          clientY: 108
        })
        expect(mouseup.event.defaultPrevented).toBe(true)

        expect(liveSelection.selection.toString()).toBe('ative parsed ')
        await waitFor(() => {
          const overlayPath = viewerRoot.querySelector(
            '.hamster-reader__selection-overlay .hamster-reader__selection-overlay-path'
          ) as SVGPathElement | null
          expect(overlayPath?.tagName.toLowerCase()).toBe('path')
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })
        await waitFor(() => {
          expect(onSelectText).toHaveBeenCalledWith(
            liveSelection.selection,
            expect.arrayContaining([
              expect.objectContaining({ selectedText: 'ative parsed ' })
            ]),
            'ative parsed '
          )
        })
      } finally {
        getSelectionSpy.mockRestore()
        restoreCaretRangeFromPoint()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        rootRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreCreatedRangeGeometry()
      }
    })

    it('html-parser right click before strict mouse selection keeps native behavior', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p><span class="hamster-note-text">Native parsed text</span></p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)

      render(<IntermediateDocumentViewer document={mockDoc} selectionOverlay />)

      await waitFor(() => {
        expect(screen.getByText('Native parsed text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textElement = screen.getByText('Native parsed text')

      expect(
        viewerRoot.querySelector(
          '.hamster-reader__selection-overlay .hamster-reader__selection-overlay-path'
        )
      ).toBeNull()
      expect(window.getSelection()?.toString() ?? '').toBe('')

      const rightMouseDown = dispatchMouseSelectionStart(
        textElement,
        { clientX: 100, clientY: 108 },
        2
      )
      const rightMouseUp = dispatchMouseSelectionEnd(
        { clientX: 100, clientY: 108 },
        2
      )
      const contextMenu = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 100,
        clientY: 108
      })
      viewerRoot.dispatchEvent(contextMenu)

      expect(rightMouseDown.event.defaultPrevented).toBe(false)
      expect(rightMouseUp.event.defaultPrevented).toBe(false)
      expect(contextMenu.defaultPrevented).toBe(false)
      expect(
        viewerRoot.querySelector(
          '.hamster-reader__selection-overlay .hamster-reader__selection-overlay-path'
        )
      ).toBeNull()
      expect(window.getSelection()?.toString() ?? '').toBe('')
    })

    it('html-parser right click during active strict mouse selection preserves selection', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p><span class="hamster-note-text">Native parsed text</span></p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Native parsed text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textElement = screen.getByText('Native parsed text')
      const htmlPage = textElement.closest('.hamster-note-page')
      if (!(htmlPage instanceof HTMLElement)) {
        throw new Error('Expected html-parser page element')
      }

      const textNode = getTextNode(textElement)
      const startBoundaryRect = makeDomRect({
        left: 70,
        top: 100,
        width: 0,
        height: 16
      })
      const endBoundaryRect = makeDomRect({
        left: 160,
        top: 100,
        width: 0,
        height: 16
      })
      const fullSelectionRect = makeDomRect({
        left: 70,
        top: 100,
        width: 90,
        height: 16
      })
      const restoreCreatedRangeGeometry = installCreatedRangeGeometry(
        (range) => {
          if (range.startContainer !== textNode) return []
          if (range.collapsed) {
            return range.startOffset <= 1
              ? [startBoundaryRect]
              : [endBoundaryRect]
          }
          return [fullSelectionRect]
        }
      )
      const pageRectSpy = mockElementRect(htmlPage, {
        left: 50,
        top: 80,
        width: 200,
        height: 200
      })
      const rootRectSpy = mockElementRect(viewerRoot, {
        left: 10,
        top: 20,
        width: 300,
        height: 300
      })
      const textRectSpy = mockElementRect(textElement, {
        left: 70,
        top: 100,
        width: 180,
        height: 16
      })
      const elementFromPointSpy = mockElementFromPointByCoordinate(
        () => htmlPage
      )
      let caretOffset = 1
      const restoreCaretRangeFromPoint = installHtmlParserCaretRangeFromPoint(
        () => {
          const range = globalThis.document.createRange()
          range.setStart(textNode, caretOffset)
          range.collapse(true)
          return range
        }
      )
      const initialRange = globalThis.document.createRange()
      initialRange.selectNodeContents(viewerRoot)
      initialRange.collapse(true)
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        dispatchPointerDragStart(textElement, { clientX: 70, clientY: 108 })
        dispatchMouseSelectionStart(textElement, { clientX: 70, clientY: 108 })
        caretOffset = 14
        dispatchMouseSelectionMove(viewerRoot, { clientX: 160, clientY: 108 })
        dispatchPointerDragMove(viewerRoot, { clientX: 160, clientY: 108 })

        expect(liveSelection.selection.toString()).toBe('ative parsed ')
        expect(liveSelection.selection.anchorNode?.nodeType).toBe(
          Node.TEXT_NODE
        )
        expect(liveSelection.selection.focusNode?.nodeType).toBe(Node.TEXT_NODE)
        const selectedTextBeforeRightClick = liveSelection.selection.toString()
        await waitFor(() => {
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })

        const rightMouseDown = dispatchMouseSelectionStart(
          textElement,
          { clientX: 100, clientY: 108 },
          2
        )
        expect(rightMouseDown.event.defaultPrevented).toBe(false)
        const rightMouseUp = dispatchMouseSelectionEnd(
          { clientX: 100, clientY: 108 },
          2
        )
        expect(rightMouseUp.event.defaultPrevented).toBe(true)
        expect(liveSelection.selection.toString()).toBe(
          selectedTextBeforeRightClick
        )
        expect(liveSelection.selection.anchorNode?.nodeType).toBe(
          Node.TEXT_NODE
        )
        expect(liveSelection.selection.focusNode?.nodeType).toBe(Node.TEXT_NODE)
        const contextMenu = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 100,
          clientY: 108
        })
        viewerRoot.dispatchEvent(contextMenu)
        expect(contextMenu.defaultPrevented).toBe(true)

        expect(liveSelection.selection.toString()).toBe(
          selectedTextBeforeRightClick
        )
        expect(liveSelection.selection.anchorNode?.nodeType).toBe(
          Node.TEXT_NODE
        )
        expect(liveSelection.selection.focusNode?.nodeType).toBe(Node.TEXT_NODE)
        expect(
          viewerRoot.querySelectorAll(
            '.hamster-reader__selection-overlay .hamster-reader__selection-overlay-path'
          )
        ).toHaveLength(1)
        expect(viewerRoot.querySelectorAll('[data-handle-type]')).toHaveLength(
          2
        )
        dispatchMouseSelectionEnd({ clientX: 160, clientY: 108 })
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 160,
          clientY: 108
        })
      } finally {
        getSelectionSpy.mockRestore()
        restoreCaretRangeFromPoint()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        rootRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreCreatedRangeGeometry()
      }
    })

    it('html-parser non-primary mouseup after finalized strict selection keeps native behavior', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p><span class="hamster-note-text">Native parsed text</span></p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)
      const onSelectText = vi.fn()

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
          onSelectText={onSelectText}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Native parsed text')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textElement = screen.getByText('Native parsed text')
      const htmlPage = textElement.closest('.hamster-note-page')
      if (!(htmlPage instanceof HTMLElement)) {
        throw new Error('Expected html-parser page element')
      }

      const textNode = getTextNode(textElement)
      const startBoundaryRect = makeDomRect({
        left: 70,
        top: 100,
        width: 0,
        height: 16
      })
      const endBoundaryRect = makeDomRect({
        left: 160,
        top: 100,
        width: 0,
        height: 16
      })
      const fullSelectionRect = makeDomRect({
        left: 70,
        top: 100,
        width: 90,
        height: 16
      })
      const restoreCreatedRangeGeometry = installCreatedRangeGeometry(
        (range) => {
          if (range.startContainer !== textNode) return []
          if (range.collapsed) {
            return range.startOffset <= 1
              ? [startBoundaryRect]
              : [endBoundaryRect]
          }
          return [fullSelectionRect]
        }
      )
      const pageRectSpy = mockElementRect(htmlPage, {
        left: 50,
        top: 80,
        width: 200,
        height: 200
      })
      const rootRectSpy = mockElementRect(viewerRoot, {
        left: 10,
        top: 20,
        width: 300,
        height: 300
      })
      const textRectSpy = mockElementRect(textElement, {
        left: 70,
        top: 100,
        width: 180,
        height: 16
      })
      const elementFromPointSpy = mockElementFromPointByCoordinate(
        () => htmlPage
      )
      let caretOffset = 1
      const restoreCaretRangeFromPoint = installHtmlParserCaretRangeFromPoint(
        () => {
          const range = textElement.ownerDocument.createRange()
          range.setStart(textNode, caretOffset)
          range.collapse(true)
          return range
        }
      )
      const initialRange = textElement.ownerDocument.createRange()
      initialRange.selectNodeContents(viewerRoot)
      initialRange.collapse(true)
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        dispatchPointerDragStart(textElement, { clientX: 70, clientY: 108 })
        const start = dispatchMouseSelectionStart(textElement, {
          clientX: 70,
          clientY: 108
        })
        expect(start.event.defaultPrevented).toBe(true)

        caretOffset = 14
        dispatchMouseSelectionMove(viewerRoot, { clientX: 160, clientY: 108 })
        dispatchPointerDragMove(viewerRoot, { clientX: 160, clientY: 108 })

        const leftMouseUp = dispatchMouseSelectionEnd({
          clientX: 160,
          clientY: 108
        })
        expect(leftMouseUp.event.defaultPrevented).toBe(true)
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 160,
          clientY: 108
        })

        await waitFor(() => {
          expect(onSelectText).toHaveBeenCalled()
        })

        const nonPrimaryMouseUp = dispatchMouseSelectionEnd(
          { clientX: 100, clientY: 108 },
          2
        )

        expect(nonPrimaryMouseUp.event.defaultPrevented).toBe(false)
      } finally {
        getSelectionSpy.mockRestore()
        restoreCaretRangeFromPoint()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        rootRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreCreatedRangeGeometry()
      }
    })

    it('html-parser strict mouse drag normalizes container caret ranges before blank mouseup finalization', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p><span class="hamster-note-text"><strong>Native</strong><em> parsed text</em></span></p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Native')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textElement = viewerRoot.querySelector('.hamster-note-text')
      if (!(textElement instanceof HTMLElement)) {
        throw new Error('Expected html-parser text element')
      }
      const htmlPage = textElement.closest('.hamster-note-page')
      if (!(htmlPage instanceof HTMLElement)) {
        throw new Error('Expected html-parser page element')
      }

      const startTextNode = getDescendantTextNode(textElement, 0)
      const endTextNode = getDescendantTextNode(textElement, 1)
      const startBoundaryRect = makeDomRect({
        left: 70,
        top: 100,
        width: 0,
        height: 16
      })
      const endBoundaryRect = makeDomRect({
        left: 160,
        top: 100,
        width: 0,
        height: 16
      })
      const fullSelectionRect = makeDomRect({
        left: 70,
        top: 100,
        width: 90,
        height: 16
      })
      const restoreCreatedRangeGeometry = installCreatedRangeGeometry(
        (range) => {
          if (range.collapsed) {
            if (range.startContainer === startTextNode) {
              return [startBoundaryRect]
            }
            if (range.startContainer === endTextNode) return [endBoundaryRect]
            return []
          }
          if (
            range.startContainer === startTextNode &&
            range.endContainer === startTextNode
          ) {
            return [fullSelectionRect]
          }
          if (
            range.startContainer === endTextNode &&
            range.endContainer === endTextNode
          ) {
            return [fullSelectionRect]
          }
          return range.startContainer === startTextNode ||
            range.startContainer === endTextNode
            ? [fullSelectionRect]
            : []
        }
      )
      const pageRectSpy = mockElementRect(htmlPage, {
        left: 50,
        top: 80,
        width: 220,
        height: 220
      })
      const rootRectSpy = mockElementRect(viewerRoot, {
        left: 10,
        top: 20,
        width: 320,
        height: 320
      })
      const textRectSpy = mockElementRect(textElement, {
        left: 70,
        top: 100,
        width: 180,
        height: 16
      })
      const elementFromPointSpy = mockElementFromPointByCoordinate((_x, y) => {
        return y > 150 ? htmlPage : textElement
      })
      const restoreCaretRangeFromPoint = installHtmlParserCaretRangeFromPoint(
        () => {
          const range = globalThis.document.createRange()
          range.setStart(htmlPage, 0)
          range.collapse(true)
          return range
        }
      )
      const initialRange = globalThis.document.createRange()
      initialRange.selectNodeContents(viewerRoot)
      initialRange.collapse(true)
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        dispatchPointerDragStart(textElement, {
          clientX: 70,
          clientY: 108
        })
        const start = dispatchMouseSelectionStart(textElement, {
          clientX: 70,
          clientY: 108
        })
        expect(start.event.defaultPrevented).toBe(true)

        const move = dispatchMouseSelectionMove(viewerRoot, {
          clientX: 160,
          clientY: 108
        })
        dispatchPointerDragMove(viewerRoot, {
          clientX: 160,
          clientY: 108
        })
        expect(move.event.defaultPrevented).toBe(true)

        const mouseup = dispatchMouseSelectionEnd({
          clientX: 220,
          clientY: 180
        })
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 220,
          clientY: 180
        })
        expect(mouseup.event.defaultPrevented).toBe(true)

        expect(liveSelection.selection.toString()).not.toBe('')
        expect(
          liveSelection.selection.getRangeAt(0).startContainer.nodeType
        ).toBe(Node.TEXT_NODE)
        expect(
          textElement.contains(
            liveSelection.selection.getRangeAt(0).startContainer
          )
        ).toBe(true)
        expect(
          liveSelection.selection.getRangeAt(0).endContainer.nodeType
        ).toBe(Node.TEXT_NODE)
        expect(
          textElement.contains(
            liveSelection.selection.getRangeAt(0).endContainer
          )
        ).toBe(true)
        await waitFor(() => {
          const overlayPath = viewerRoot.querySelector(
            '.hamster-reader__selection-overlay .hamster-reader__selection-overlay-path'
          )
          expect(overlayPath?.tagName.toLowerCase()).toBe('path')
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })
      } finally {
        getSelectionSpy.mockRestore()
        restoreCaretRangeFromPoint()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        rootRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreCreatedRangeGeometry()
      }
    })

    it('html-parser strict mouse drag recovers when stored text nodes are detached before finalization', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p><span class="hamster-note-text"><strong>Native</strong><em> parsed text</em></span></p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Native')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const textElement = viewerRoot.querySelector('.hamster-note-text')
      if (!(textElement instanceof HTMLElement)) {
        throw new Error('Expected html-parser text element')
      }
      const htmlPage = textElement.closest('.hamster-note-page')
      if (!(htmlPage instanceof HTMLElement)) {
        throw new Error('Expected html-parser page element')
      }

      const startBoundaryRect = makeDomRect({
        left: 70,
        top: 100,
        width: 0,
        height: 16
      })
      const endBoundaryRect = makeDomRect({
        left: 160,
        top: 100,
        width: 0,
        height: 16
      })
      const fullSelectionRect = makeDomRect({
        left: 70,
        top: 100,
        width: 90,
        height: 16
      })
      const restoreCreatedRangeGeometry = installCreatedRangeGeometry(
        (range) => {
          if (range.collapsed) {
            if (
              range.startContainer === getDescendantTextNode(textElement, 0)
            ) {
              return [startBoundaryRect]
            }
            if (
              range.startContainer === getDescendantTextNode(textElement, 1)
            ) {
              return [endBoundaryRect]
            }
            return []
          }
          return textElement.contains(range.startContainer) &&
            textElement.contains(range.endContainer)
            ? [fullSelectionRect]
            : []
        }
      )
      const pageRectSpy = mockElementRect(htmlPage, {
        left: 50,
        top: 80,
        width: 220,
        height: 220
      })
      const rootRectSpy = mockElementRect(viewerRoot, {
        left: 10,
        top: 20,
        width: 320,
        height: 320
      })
      const textRectSpy = mockElementRect(textElement, {
        left: 70,
        top: 100,
        width: 180,
        height: 16
      })
      const elementFromPointSpy = mockElementFromPointByCoordinate((_x, y) => {
        return y > 150 ? htmlPage : textElement
      })
      const restoreCaretRangeFromPoint = installHtmlParserCaretRangeFromPoint(
        (x) => {
          const range = globalThis.document.createRange()
          if (x > 120) {
            const endNode = getDescendantTextNode(textElement, 1)
            range.setStart(endNode, endNode.data.length)
          } else {
            range.setStart(getDescendantTextNode(textElement, 0), 0)
          }
          range.collapse(true)
          return range
        }
      )
      const initialRange = globalThis.document.createRange()
      initialRange.selectNodeContents(viewerRoot)
      initialRange.collapse(true)
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        dispatchPointerDragStart(textElement, { clientX: 70, clientY: 108 })
        dispatchMouseSelectionStart(textElement, { clientX: 70, clientY: 108 })

        textElement.innerHTML = '<strong>Native</strong><em> parsed text</em>'

        dispatchMouseSelectionMove(viewerRoot, { clientX: 160, clientY: 108 })
        dispatchPointerDragMove(viewerRoot, { clientX: 160, clientY: 108 })
        dispatchMouseSelectionEnd({ clientX: 220, clientY: 180 })
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 220,
          clientY: 180
        })

        const finalRange = liveSelection.selection.getRangeAt(0)
        expect(liveSelection.selection.toString()).not.toBe('')
        expect(finalRange.startContainer.nodeType).toBe(Node.TEXT_NODE)
        expect(finalRange.endContainer.nodeType).toBe(Node.TEXT_NODE)
        expect(finalRange.startContainer.isConnected).toBe(true)
        expect(finalRange.endContainer.isConnected).toBe(true)
        expect(textElement.contains(finalRange.startContainer)).toBe(true)
        expect(textElement.contains(finalRange.endContainer)).toBe(true)
        await waitFor(() => {
          expect(
            viewerRoot.querySelector(
              '.hamster-reader__selection-overlay .hamster-reader__selection-overlay-path'
            )
          ).not.toBeNull()
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })
      } finally {
        getSelectionSpy.mockRestore()
        restoreCaretRangeFromPoint()
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        rootRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreCreatedRangeGeometry()
      }
    })

    describe('html-parser callbacks', () => {
      const setupHtmlParserNativeSelection = async (callbacks?: {
        onTextSelectionEnd?: ReturnType<typeof vi.fn>
        onSelectText?: ReturnType<typeof vi.fn>
        onDragSelectedTextStart?: ReturnType<typeof vi.fn>
        onDragSelectedTextMove?: ReturnType<typeof vi.fn>
        onDragSelectedTextEnd?: ReturnType<typeof vi.fn>
      }) => {
        const { document: mockDoc } = makeDocument({ pageCount: 1 })
        const parserHtml =
          '<div class="hamster-note-page"><p>Native parsed text</p></div>'
        vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
        vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)

        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            selectionOverlay
            onTextSelectionEnd={callbacks?.onTextSelectionEnd}
            onSelectText={callbacks?.onSelectText}
            onDragSelectedTextStart={callbacks?.onDragSelectedTextStart}
            onDragSelectedTextMove={callbacks?.onDragSelectedTextMove}
            onDragSelectedTextEnd={callbacks?.onDragSelectedTextEnd}
          />
        )

        await waitFor(() => {
          expect(screen.getByText('Native parsed text')).toBeInTheDocument()
        })

        const viewerRoot = screen.getByTestId('intermediate-document-viewer')
        const paragraph = screen.getByText('Native parsed text')
        const htmlPage = paragraph.closest('.hamster-note-page')
        if (!(htmlPage instanceof HTMLElement)) {
          throw new Error('Expected html-parser page element')
        }

        const textNode = getTextNode(paragraph)
        const nativeRange = globalThis.document.createRange()
        nativeRange.setStart(textNode, 0)
        nativeRange.setEnd(textNode, 6)

        const selectionRect = makeDomRect({
          left: 70,
          top: 100,
          width: 90,
          height: 16
        })
        const resolveRects: RangeRectResolver = (range) => {
          if (range.collapsed) {
            return [
              makeDomRect({
                left: range.startOffset <= 1 ? 70 : 160,
                top: 100,
                width: 0,
                height: 16
              })
            ]
          }
          return range.startContainer === textNode ? [selectionRect] : []
        }
        installRangeGeometryOnObject(nativeRange, resolveRects)
        const restoreCreatedRangeGeometry =
          installCreatedRangeGeometry(resolveRects)
        const pageRectSpy = mockElementRect(htmlPage, {
          left: 50,
          top: 80,
          width: 200,
          height: 200
        })
        // 页面 slot（hamster-reader__intermediate-page）是 html-parser 模式下
        // getRootOverlayRect 的 pageRefs 来源，必须与 .hamster-note-page 保持相同几何。
        const slotRectSpy = mockElementRect(
          screen.getByTestId('intermediate-page-1'),
          {
            left: 50,
            top: 80,
            width: 200,
            height: 200
          }
        )
        const rootRectSpy = mockElementRect(viewerRoot, {
          left: 10,
          top: 20,
          width: 300,
          height: 300
        })
        const elementFromPointSpy = mockElementFromPoint(paragraph)
        const selection = makeMockSelection({
          isCollapsed: false,
          anchorNode: textNode,
          anchorOffset: 0,
          focusNode: textNode,
          focusOffset: 6,
          rangeCount: 1,
          getRangeAt: () => nativeRange,
          toString: () => 'Native',
          containsNode: (node) => nativeRange.intersectsNode(node)
        })
        const getSelectionSpy = vi
          .spyOn(window, 'getSelection')
          .mockReturnValue(selection)

        return {
          viewerRoot,
          htmlPage,
          selection,
          getSelectionSpy,
          elementFromPointSpy,
          rootRectSpy,
          pageRectSpy,
          slotRectSpy,
          restoreCreatedRangeGeometry
        }
      }

      it('html-parser native selection does not fire onTextSelectionEnd or onSelectText', async () => {
        const onTextSelectionEnd = vi.fn()
        const onSelectText = vi.fn()
        const fixture = await setupHtmlParserNativeSelection({
          onTextSelectionEnd,
          onSelectText
        })

        try {
          await act(async () => {
            globalThis.document.dispatchEvent(new Event('selectionchange'))
            fixture.viewerRoot.dispatchEvent(
              new MouseEvent('mouseup', {
                bubbles: true,
                clientX: 80,
                clientY: 108
              })
            )
            await Promise.resolve()
          })

          await waitFor(() => {
            const overlayPath = fixture.viewerRoot.querySelector(
              '.hamster-reader__selection-overlay .hamster-reader__selection-overlay-path'
            )
            expect(overlayPath).toBeInstanceOf(SVGElement)
            expect(overlayPath?.tagName.toLowerCase()).toBe('path')
          })
          expect(onTextSelectionEnd).not.toHaveBeenCalled()
          expect(onSelectText).not.toHaveBeenCalled()
        } finally {
          fixture.getSelectionSpy.mockRestore()
          fixture.elementFromPointSpy.mockRestore()
          fixture.rootRectSpy.mockRestore()
          fixture.pageRectSpy.mockRestore()
          fixture.slotRectSpy.mockRestore()
          fixture.restoreCreatedRangeGeometry()
        }
      })

      it('html-parser native selection does not start selected-text body drag callbacks', async () => {
        const onDragSelectedTextStart = vi.fn()
        const onDragSelectedTextMove = vi.fn()
        const onDragSelectedTextEnd = vi.fn()
        const fixture = await setupHtmlParserNativeSelection({
          onDragSelectedTextStart,
          onDragSelectedTextMove,
          onDragSelectedTextEnd
        })

        try {
          await act(async () => {
            globalThis.document.dispatchEvent(new Event('selectionchange'))
            await Promise.resolve()
          })

          const overlay = await waitFor(() => {
            const element = fixture.viewerRoot.querySelector(
              '.hamster-reader__selection-overlay'
            )
            expect(element).toBeInstanceOf(HTMLElement)
            return element as HTMLElement
          })
          await waitFor(() => {
            expect(
              getMockDragInstances().find(
                (instance) => instance.element === overlay
              )
            ).toBeDefined()
          })

          vi.useFakeTimers()
          overlay.dispatchEvent(
            new MouseEvent('pointerdown', {
              bubbles: true,
              button: 0,
              clientX: 80,
              clientY: 108
            })
          )
          overlay.dispatchEvent(
            new MouseEvent('pointermove', {
              bubbles: true,
              clientX: 81,
              clientY: 109
            })
          )

          await act(async () => {
            vi.runOnlyPendingTimers()
          })

          overlay.dispatchEvent(
            new MouseEvent('pointerup', {
              bubbles: true,
              clientX: 82,
              clientY: 110
            })
          )

          expect(onDragSelectedTextStart).not.toHaveBeenCalled()
          expect(onDragSelectedTextMove).not.toHaveBeenCalled()
          expect(onDragSelectedTextEnd).not.toHaveBeenCalled()
        } finally {
          vi.useRealTimers()
          fixture.getSelectionSpy.mockRestore()
          fixture.elementFromPointSpy.mockRestore()
          fixture.rootRectSpy.mockRestore()
          fixture.pageRectSpy.mockRestore()
          fixture.restoreCreatedRangeGeometry()
        }
      })
    })

    it('direct drag selection still works', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      const restoreRangeRects = installSelectionHandleRangeRectMocks()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          selectionHandleElement={<button type='button' />}
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
      mockElementFromPointByCoordinate((_x, y) => {
        if (y >= 120) return screen.getByText('D')
        if (y >= 80) return screen.getByText('C')
        return screen.getByText('B')
      })

      try {
        dispatchPointerDragStart(
          screen.getByText('B'),
          { clientX: 12, clientY: 58 },
          { pointerType: 'pen' }
        )
        dispatchPointerDragMove(
          viewerRoot,
          { clientX: 100, clientY: 138 },
          { pointerType: 'pen' }
        )
        dispatchPointerDragEnd(
          viewerRoot,
          'pointerup',
          { clientX: 100, clientY: 138 },
          { pointerType: 'pen' }
        )

        expect(liveSelection.selection.toString()).toBe('BCD')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        await waitFor(() => {
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })
        // T3: live selection renders independent rect-region paths (one per
        // text-element rect) instead of a single union path. BCD spans 3
        // text elements, so expect 3 paths.
        expect(getOverlayBlocks(page)).toHaveLength(3)
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
        restoreRangeRects()
      }
    })

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
      layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) => {
        if (y >= 120) return screen.getByText('D')
        if (y >= 80) return screen.getByText('C')
        return screen.getByText('B')
      })

      try {
        dispatchPointerDragStart(
          screen.getByText('B'),
          { clientX: 12, clientY: 58 },
          { pointerType: 'pen' }
        )
        dispatchPointerDragMove(
          viewerRoot,
          { clientX: 100, clientY: 138 },
          { pointerType: 'pen' }
        )

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

    it('selects the touched word after the default-mode long press delay', async () => {
      const page = {
        getContent: vi.fn(async () => [makeText('text-alpha', 'Alpha beta')])
      }
      const mockDoc = {
        id: 'doc-long-press-word',
        title: 'Long Press Word Document',
        pageCount: 1,
        pageNumbers: [1],
        getPageSizeByPageNumber: vi.fn(() => ({ x: 400, y: 400 })),
        getPageByPageNumber: vi.fn(() => Promise.resolve(page))
      } as unknown as IntermediateDocument
      const onTextSelectionChange = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          onTextSelectionChange={onTextSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Alpha beta')).toBeInTheDocument()
      })

      const textElement = screen.getByText('Alpha beta')
      const pageElement = screen.getByTestId('intermediate-page-1')
      mockElementRect(pageElement, { left: 0, top: 0, width: 400, height: 220 })
      mockElementRect(textElement, {
        left: 10,
        top: 20,
        width: 100,
        height: 16
      })
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPoint(textElement)
      vi.useFakeTimers()

      try {
        dispatchPointerDragStart(
          textElement,
          { clientX: 12, clientY: 28 },
          { pointerId: 7, pointerType: 'touch' }
        )

        expect(onTextSelectionChange).not.toHaveBeenCalled()

        await act(async () => {
          await vi.advanceTimersByTimeAsync(500)
        })

        expect(liveSelection.selection.toString()).toBe('Alpha')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.selectedText).toBe('Alpha')
      } finally {
        vi.useRealTimers()
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

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

    it('allows pen selection in stylus mode', async () => {
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

      try {
        dispatchPointerDragStart(
          screen.getByText('B'),
          { clientX: 12, clientY: 58 },
          { pointerId: 9, pointerType: 'pen' }
        )
        dispatchPointerDragMove(
          viewerRoot,
          { clientX: 100, clientY: 138 },
          { pointerId: 9, pointerType: 'pen' }
        )

        expect(liveSelection.selection.toString()).toBe('BCD')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.selectedText).toBe('BCD')
      } finally {
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

    it('mouse drag resolves a caret when elementFromPoint hits supported text', async () => {
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
      layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) =>
        y >= 80 ? screen.getByText('C') : screen.getByText('B')
      )

      try {
        // Given: both mouse points directly hit supported text spans.
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchMouseSelectionStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        const nativeMove = dispatchMouseSelectionMove(viewerRoot, {
          clientX: 30,
          clientY: 98
        })

        // When: the mouse moves to another supported text span.
        dispatchPointerDragMove(viewerRoot, { clientX: 30, clientY: 98 })

        // Then: a real caret is composed inside the hit text element.
        expect(nativeMove.dispatched).toBe(false)
        expect(nativeMove.event.defaultPrevented).toBe(true)
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

    it('mouse drag over blank keeps the previous touched text caret', async () => {
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
        expect(screen.getByText('C')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) => {
        if (y >= 120) return page
        return y >= 80 ? screen.getByText('C') : screen.getByText('B')
      })

      try {
        // Given: the strict mouse drag has already touched B and then C.
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchMouseSelectionStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 30, clientY: 98 })
        expect(liveSelection.selection.toString()).toBe('BC')
        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(2)

        // When: the native mouse moves over blank page background while held.
        const nativeMove = dispatchMouseSelectionMove(viewerRoot, {
          clientX: 100,
          clientY: 138
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 138 })

        // Then: the endpoint remains at C; no nearest-text snap or final callback fires.
        expect(nativeMove.dispatched).toBe(false)
        expect(nativeMove.event.defaultPrevented).toBe(true)
        expect(liveSelection.selection.toString()).toBe('BC')
        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(2)
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).not.toHaveBeenCalled()
        expect(onSelectText).not.toHaveBeenCalled()
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('left mouse down on supported text composes a collapsed selection immediately', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      render(<IntermediateDocumentViewer document={mockDoc} />)

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
      })

      layoutFourTextPage()
      const textElement = screen.getByText('B')
      const textNode = getTextNode(textElement)
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApi = installCaretPositionFromPoint(textNode, 0)
      mockElementFromPoint(textElement)

      try {
        // Given: elementFromPoint and the caret API both resolve inside the supported text span.
        const { event, dispatched } = dispatchMouseSelectionStart(textElement, {
          clientX: 12,
          clientY: 58
        })

        // Then: accepted left mousedown prevents native drag start and writes
        // a collapsed Selection at the exact start caret immediately.
        expect(dispatched).toBe(false)
        expect(event.defaultPrevented).toBe(true)
        expect(liveSelection.selection.rangeCount).toBe(1)
        expect(liveSelection.activeRange.collapsed).toBe(true)
        expect(liveSelection.activeRange.startContainer).toBe(textNode)
        expect(liveSelection.activeRange.endContainer).toBe(textNode)
        expect(liveSelection.activeRange.startOffset).toBe(0)
        expect(liveSelection.activeRange.endOffset).toBe(0)
        expect(liveSelection.selection.removeAllRanges).toHaveBeenCalledTimes(1)
        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(1)
      } finally {
        restoreCaretApi()
        getSelectionSpy.mockRestore()
      }
    })

    it('right middle and blank mouse down do not start mouse selection callbacks', async () => {
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

      const page = layoutFourTextPage()
      const textElement = screen.getByText('B')
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        // Given: text exists, but the user presses non-left buttons or blank page background.
        mockElementFromPoint(textElement)
        const rightMouseDown = dispatchMouseSelectionStart(
          textElement,
          { clientX: 12, clientY: 58 },
          2
        )
        const middleMouseDown = dispatchMouseSelectionStart(
          textElement,
          { clientX: 12, clientY: 58 },
          1
        )
        mockElementFromPoint(page)
        const blankMouseDown = dispatchMouseSelectionStart(page, {
          clientX: 200,
          clientY: 180
        })

        globalThis.document.dispatchEvent(new MouseEvent('mouseup'))

        // Then: no active mouse selection is armed, no collapsed range is composed,
        // and public selection callbacks remain silent.
        expect(rightMouseDown.dispatched).toBe(true)
        expect(rightMouseDown.event.defaultPrevented).toBe(false)
        expect(middleMouseDown.dispatched).toBe(true)
        expect(middleMouseDown.event.defaultPrevented).toBe(false)
        // 空白区域的左键按下应被拦截（preventDefault），阻止浏览器默认 Selection；
        // dispatchEvent 返回 false 表示事件已被 cancel
        expect(blankMouseDown.event.defaultPrevented).toBe(true)
        expect(liveSelection.selection.addRange).not.toHaveBeenCalled()
        expect(onTextSelectionEnd).not.toHaveBeenCalled()
        expect(onSelectText).not.toHaveBeenCalled()
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('mouse drag over blank image area does not resolve a new caret', async () => {
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
      mockElementFromPointByCoordinate((_x, y) =>
        y >= 80 ? image : screen.getByText('B')
      )

      try {
        // Given: drag starts on text but the move point hits page chrome.
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchMouseSelectionStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })

        // When: the mouse moves over blank image/background.
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 98 })

        // Then: the mouse path must not snap to the nearest text element.
        expect(liveSelection.selection.toString()).toBe('')
        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionChange).not.toHaveBeenCalled()
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('mouse blank point within nearest-text snap distance does not select that text', async () => {
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
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) =>
        y >= 84 ? page : screen.getByText('B')
      )

      try {
        // Given: the move point is inside the 100px legacy snap radius of C.
        dispatchPointerDragMove(viewerRoot, { clientX: 12, clientY: 58 })
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchMouseSelectionStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })

        // When: elementFromPoint reports the page background, not text.
        dispatchPointerDragMove(viewerRoot, { clientX: 12, clientY: 84 })

        // Then: no nearest text is selected through the mouse path.
        expect(liveSelection.selection.toString()).toBe('')
        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionChange).not.toHaveBeenCalled()
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('backward strict mouse drag composes an ordered text selection', async () => {
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
      layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) =>
        y >= 80 ? screen.getByText('C') : screen.getByText('B')
      )

      try {
        // Given: a strict mouse drag starts at the right edge of C.
        dispatchPointerDragStart(screen.getByText('C'), {
          clientX: 30,
          clientY: 98
        })
        dispatchMouseSelectionStart(screen.getByText('C'), {
          clientX: 30,
          clientY: 98
        })

        // When: the pointer drags backward to the left edge of B.
        dispatchPointerDragMove(viewerRoot, { clientX: 12, clientY: 58 })

        // Then: createOrderedRange normalizes the reversed endpoints to B..C.
        expect(liveSelection.selection.toString()).toBe('BC')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.selectedText).toBe('BC')
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
        dispatchPenDragStart(queryTextSpan('p1-b'), {
          clientX: 40,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, { clientX: 120, clientY: 320 })

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
        dispatchPointerDragStart(
          screen.getByText('B'),
          {
            clientX: 12,
            clientY: 58
          },
          {
            pointerType: 'pen'
          }
        )
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 98 })
        dispatchPointerDragEnd(
          viewerRoot,
          'pointercancel',
          {
            clientX: 100,
            clientY: 98
          },
          {
            pointerType: 'pen'
          }
        )

        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe('BC')

        dispatchPointerDragStart(
          screen.getByText('C'),
          {
            clientX: 12,
            clientY: 98
          },
          {
            pointerType: 'pen'
          }
        )
        dispatchPointerDragMove(
          viewerRoot,
          { clientX: 100, clientY: 138 },
          { pointerType: 'pen' }
        )
        dispatchPointerDragEnd(
          viewerRoot,
          'pointerup',
          {
            clientX: 100,
            clientY: 138
          },
          {
            pointerType: 'pen'
          }
        )

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
        dispatchPenDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchMouseSelectionStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        expect(onTextSelectionChange).not.toHaveBeenCalled()
        expect(onTextSelectionEnd).not.toHaveBeenCalled()

        dispatchPenDragMove(viewerRoot, { clientX: 100, clientY: 138 })

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).not.toHaveBeenCalled()

        dispatchPenDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe('BCD')
        expect(liveSelection.selection.toString()).toBe('BCD')
        expect(liveSelection.selection.isCollapsed).toBe(false)
        expect(liveSelection.selection.rangeCount).toBe(1)
        expect(liveSelection.selection.removeAllRanges).toHaveBeenCalledTimes(2)
        expect(liveSelection.selection.addRange).toHaveBeenCalledTimes(2)
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
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

    it('finalizes strict mouseup fallback from the last stored caret and emits callbacks once', async () => {
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
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      const elementFromPointSpy = mockElementFromPointByCoordinate((_x, y) => {
        if (y >= 120) return page
        return y >= 80 ? screen.getByText('C') : screen.getByText('B')
      })

      try {
        // Given: a strict mouse drag has a stored endpoint at C.
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchMouseSelectionStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 30, clientY: 98 })
        expect(liveSelection.selection.toString()).toBe('BC')
        elementFromPointSpy.mockClear()

        // When: document mouseup fallback runs on blank page background, then
        // the adapter's pointerup lifecycle follows for the same gesture.
        viewerRoot.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            button: 0,
            clientX: 100,
            clientY: 138
          })
        )
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })

        // Then: final data remains B..C, no blank mouseup re-hit-test snaps to D,
        // and each public final callback fires exactly once.
        expect(elementFromPointSpy).not.toHaveBeenCalled()
        expect(liveSelection.selection.toString()).toBe('BC')
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe('BC')
        expect(onSelectText).toHaveBeenCalledTimes(1)
        expect(onSelectText.mock.calls[0][2]).toBe('BC')
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('strict mouseup on blank keeps the last touched offset instead of snapping to nearest text', async () => {
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
        expect(screen.getByText('C')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) => {
        if (y >= 120) return page
        return y >= 80 ? screen.getByText('C') : screen.getByText('B')
      })

      try {
        // Given: the last strict text hit stored the caret at C before the
        // pointer finished on blank background near D.
        dispatchPointerDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchMouseSelectionStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 30, clientY: 98 })

        // When: document mouseup finalizes on blank/background.
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })
        viewerRoot.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            button: 0,
            clientX: 100,
            clientY: 138
          })
        )

        // Then: finalization uses stored B..C boundaries, not the nearest D snap.
        expect(liveSelection.selection.toString()).toBe('BC')
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe('BC')
        expect(onSelectText).toHaveBeenCalledTimes(1)
        expect(onSelectText.mock.calls[0][2]).toBe('BC')
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

    it('strict mouse integration matrix finalizes retained text boundary with exact detail payload and overlay geometry', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      const onTextSelectionEnd = vi.fn()
      const onSelectText = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          selectionHandleElement={<button type='button' />}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
          onSelectText={onSelectText}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('C')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const textB = queryTextSpan('text-b')
      const textC = queryTextSpan('text-c')
      const textBNode = getTextNode(textB)
      const textCNode = getTextNode(textC)
      const selectionRect = makeDomRect({
        left: 10,
        top: 50,
        width: 20,
        height: 56
      })
      const restoreCreatedRangeGeometry = installCreatedRangeGeometry(
        (range) => {
          if (range.collapsed) {
            if (range.startContainer === textBNode) {
              return [makeDomRect({ left: 10, top: 50, width: 0, height: 16 })]
            }
            if (range.startContainer === textCNode) {
              return [makeDomRect({ left: 30, top: 90, width: 0, height: 16 })]
            }
            return []
          }

          return range.toString() === 'BC' ? [selectionRect] : []
        }
      )
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) => {
        if (y >= 120) return page
        return y >= 80 ? textC : textB
      })

      try {
        // Given: browser pointerdown is cleanup-only for mouse, then strict mousedown owns selection.
        dispatchPointerDragStart(textB, { clientX: 12, clientY: 58 })
        const start = dispatchMouseSelectionStart(textB, {
          clientX: 12,
          clientY: 58
        })

        expect(start.dispatched).toBe(false)
        expect(start.event.defaultPrevented).toBe(true)
        expect(liveSelection.activeRange.collapsed).toBe(true)
        expect(liveSelection.activeRange.startContainer).toBe(textBNode)
        expect(liveSelection.activeRange.startOffset).toBe(0)
        expect(liveSelection.activeRange.endContainer).toBe(textBNode)
        expect(liveSelection.activeRange.endOffset).toBe(0)
        expect(onTextSelectionChange).not.toHaveBeenCalled()

        // When: strict mouse movement reaches C, the adapter move composes B..C.
        const moveToText = dispatchMouseSelectionMove(viewerRoot, {
          clientX: 30,
          clientY: 98
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 30, clientY: 98 })

        expect(moveToText.dispatched).toBe(false)
        expect(moveToText.event.defaultPrevented).toBe(true)
        expect(liveSelection.selection.toString()).toBe('BC')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [changeText, changeDetail] = onTextSelectionChange.mock.calls[0]
        expect(changeText.id).toBe('text-b')
        expect(changeDetail).toMatchObject({
          text: changeText,
          selectedText: 'BC',
          pageNumber: 1
        })
        expect(changeDetail.selection).toBe(liveSelection.selection)
        expect(
          changeDetail.texts.map((text: IntermediateText) => text.id)
        ).toEqual(['text-b', 'text-c'])

        // When: the cursor moves over nearby blank/page chrome near D, strict mouse retains C.
        const moveToBlank = dispatchMouseSelectionMove(viewerRoot, {
          clientX: 100,
          clientY: 138
        })
        dispatchPointerDragMove(viewerRoot, { clientX: 100, clientY: 138 })

        expect(moveToBlank.dispatched).toBe(false)
        expect(moveToBlank.event.defaultPrevented).toBe(true)
        expect(liveSelection.selection.toString()).toBe('BC')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)

        // When: mouseup lands on blank/outside and adapter pointerup follows.
        const mouseup = dispatchMouseSelectionEnd({
          clientX: 100,
          clientY: 138
        })
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })

        // Then: finalizers use stored B..C boundaries exactly once.
        expect(mouseup.dispatched).toBe(false)
        expect(mouseup.event.defaultPrevented).toBe(true)
        expect(liveSelection.selection.toString()).toBe('BC')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onSelectText).toHaveBeenCalledTimes(1)

        const [endText, endDetail] = onTextSelectionEnd.mock.calls[0]
        expect(endText).toBe(changeText)
        expect(endDetail).toMatchObject({
          text: endText,
          selectedText: 'BC',
          pageNumber: 1
        })
        expect(endDetail.selection).toBe(liveSelection.selection)
        expect(
          endDetail.texts.map((text: IntermediateText) => text.id)
        ).toEqual(['text-b', 'text-c'])

        const [payloadSelection, payloadSegments, extractedText] =
          onSelectText.mock.calls[0]
        expect(payloadSelection).toBe(liveSelection.selection)
        expect(extractedText).toBe('BC')
        expect(
          payloadSegments.map((segment: ReaderSelectedTextSegment) => ({
            id: segment.id,
            selectedText: segment.selectedText,
            startCharIndex: segment.startCharIndex,
            endCharIndex: segment.endCharIndex
          }))
        ).toEqual([
          {
            id: 'text-b',
            selectedText: 'B',
            startCharIndex: 0,
            endCharIndex: 1
          },
          {
            id: 'text-c',
            selectedText: 'C',
            startCharIndex: 0,
            endCharIndex: 1
          }
        ])

        const payload = buildSelectionPayload(liveSelection.selection)
        expect(payload?.extractedText).toBe('BC')
        expect(
          payload?.segments.map((segment: ReaderSelectedTextSegment) => ({
            id: segment.id,
            selectedText: segment.selectedText,
            startCharIndex: segment.startCharIndex,
            endCharIndex: segment.endCharIndex
          }))
        ).toEqual([
          {
            id: 'text-b',
            selectedText: 'B',
            startCharIndex: 0,
            endCharIndex: 1
          },
          {
            id: 'text-c',
            selectedText: 'C',
            startCharIndex: 0,
            endCharIndex: 1
          }
        ])

        await waitFor(() => {
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })
        const overlayPath = page.querySelector(
          '.hamster-reader__selection-overlay-path'
        ) as SVGPathElement | null
        expectPathCoversRect(overlayPath ?? undefined, {
          left: 10,
          top: 50,
          width: 20,
          height: 56
        })

        const startHandle = page.querySelector(
          '[data-handle-type="start"]'
        ) as HTMLElement | null
        const endHandle = page.querySelector(
          '[data-handle-type="end"]'
        ) as HTMLElement | null
        expect(startHandle).toHaveStyle({ left: '10px', top: '66px' })
        expect(endHandle).toHaveStyle({ left: '30px', top: '106px' })
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
        restoreCreatedRangeGeometry()
      }
    })

    it('strict mouse integration matrix normalizes backward final detail exactly once', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('C')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      layoutFourTextPage()
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) =>
        y >= 80 ? queryTextSpan('text-c') : queryTextSpan('text-b')
      )

      try {
        dispatchPointerDragStart(queryTextSpan('text-c'), {
          clientX: 30,
          clientY: 98
        })
        dispatchMouseSelectionStart(queryTextSpan('text-c'), {
          clientX: 30,
          clientY: 98
        })
        dispatchMouseSelectionMove(viewerRoot, { clientX: 12, clientY: 58 })
        dispatchPointerDragMove(viewerRoot, { clientX: 12, clientY: 58 })
        dispatchMouseSelectionEnd({ clientX: 12, clientY: 58 })
        dispatchPointerDragEnd(viewerRoot, 'pointerup', {
          clientX: 12,
          clientY: 58
        })

        expect(liveSelection.selection.toString()).toBe('BC')
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        const [endText, detail] = onTextSelectionEnd.mock.calls[0]
        expect(endText.id).toBe('text-b')
        expect(detail.selectedText).toBe('BC')
        expect(detail.text).toBe(endText)
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'text-b',
          'text-c'
        ])
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

    it('keeps legitimate full-page active mouse text-to-text drag selected text', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange
      })
      mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeDirectRenderTextSelection(['p2-delta', 'p2-echo', 'p2-foxtrot'])
        )
      mockElementFromPointByCoordinate((x, y) => {
        if (x >= 20 && x <= 100 && y >= 240 && y <= 260) {
          return queryTextSpan('p2-delta')
        }
        if (x >= 20 && x <= 100 && y >= 320 && y <= 340) {
          return queryTextSpan('p2-foxtrot')
        }
        return screen.getByTestId('intermediate-page-2')
      })

      try {
        dispatchPenDragStart(queryTextSpan('p2-delta'), {
          clientX: 25,
          clientY: 250
        })
        dispatchPenDragMove(viewerRoot, { clientX: 95, clientY: 330 })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p2-delta',
          'p2-echo',
          'p2-foxtrot'
        ])
        expect(detail.selectedText).toBe('P2 DeltaP2 EchoP2 Foxtrot')
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('keeps legitimate active mouse cross-page selection through the pointer text', async () => {
      const onTextSelectionChange = vi.fn()
      await renderCrossPageSelectionFixture(onTextSelectionChange)
      const { page2 } = mockCrossPageSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeDirectRenderTextSelection(['p1-b', 'p2-a', 'p2-b', 'p2-c'])
        )
      mockElementFromPointByCoordinate((_x, y) =>
        y < 220 ? queryTextSpan('p1-b') : page2
      )

      try {
        dispatchPenDragStart(queryTextSpan('p1-b'), {
          clientX: 60,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 320
        })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p1-b',
          'p2-a',
          'p2-b',
          'p2-c'
        ])
        expect(detail.selectedText).toBe('P1BP2AP2BP2C')
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('cross-page active drag from page 1 word 2 to page 2 word 2 avoids selecting next full page', async () => {
      const onTextSelectionChange = vi.fn()
      await renderCrossPageSelectionFixture(onTextSelectionChange)
      const { page2 } = mockCrossPageSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(
        makeDirectRenderTextSelectionWithEndpoints({
          selectedTextIds: ['p1-b', 'p2-a', 'p2-b', 'p2-c'],
          anchorTextId: 'p1-b',
          focusTextId: 'p2-c'
        })
      )
      mockElementFromPointByCoordinate((_x, y) =>
        y < 220 ? queryTextSpan('p1-b') : page2
      )

      try {
        dispatchPenDragStart(queryTextSpan('p1-b'), {
          clientX: 60,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 280
        })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p1-b',
          'p2-a',
          'p2-b'
        ])
        expect(detail.selectedText).toBe('P1BP2AP2B')
        expect(detail.selectedText).not.toContain('P2C')
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('cross-page active drag from page 1 word 2 to page 3 word 2 is ordered and bounded', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange
      })
      const { page1, page2, page3 } = mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(
        makeDirectRenderTextSelectionWithEndpoints({
          selectedTextIds: [
            'p1-bravo',
            'p1-charlie',
            'p2-delta',
            'p2-echo',
            'p2-foxtrot',
            'p3-golf',
            'p3-hotel',
            'p3-india'
          ],
          anchorTextId: 'p1-bravo',
          focusTextId: 'p3-india'
        })
      )
      mockElementFromPointByCoordinate((_x, y) => {
        if (y < 220) return page1
        if (y < 440) return page2
        return page3
      })

      try {
        dispatchPenDragStart(queryTextSpan('p1-bravo'), {
          clientX: 60,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 510
        })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p1-bravo',
          'p1-charlie',
          'p2-delta',
          'p2-echo',
          'p2-foxtrot',
          'p3-golf',
          'p3-hotel'
        ])
        expect(detail.selectedText).toBe(
          'P1 BravoP1 CharlieP2 DeltaP2 EchoP2 FoxtrotP3 GolfP3 Hotel'
        )
        expect(detail.selectedText).not.toContain('P3 India')
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('cross-page reverse drag from page 3 to page 1 returns the same ordered bounded text', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange
      })
      const { page1, page2, page3 } = mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(
        makeDirectRenderTextSelectionWithEndpoints({
          selectedTextIds: [
            'p1-bravo',
            'p1-charlie',
            'p2-delta',
            'p2-echo',
            'p2-foxtrot',
            'p3-golf',
            'p3-hotel',
            'p3-india'
          ],
          anchorTextId: 'p1-bravo',
          focusTextId: 'p3-india'
        })
      )
      mockElementFromPointByCoordinate((_x, y) => {
        if (y < 220) return page1
        if (y < 440) return page2
        return page3
      })

      try {
        dispatchPenDragStart(queryTextSpan('p3-hotel'), {
          clientX: 60,
          clientY: 510
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 70
        })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p1-bravo',
          'p1-charlie',
          'p2-delta',
          'p2-echo',
          'p2-foxtrot',
          'p3-golf',
          'p3-hotel'
        ])
        expect(detail.selectedText).toBe(
          'P1 BravoP1 CharlieP2 DeltaP2 EchoP2 FoxtrotP3 GolfP3 Hotel'
        )
        expect(detail.text).toBe(detail.texts[0])
        expect(detail.pageNumber).toBe(1)
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('cross-page page-gutter endpoint resolves to nearest text on the pointer page', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange
      })
      const { page1, page2, page3 } = mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(
        makeDirectRenderTextSelectionWithEndpoints({
          selectedTextIds: [
            'p1-bravo',
            'p1-charlie',
            'p2-delta',
            'p2-echo',
            'p2-foxtrot',
            'p3-golf'
          ],
          anchorTextId: 'p1-bravo',
          focusTextId: 'p3-golf'
        })
      )
      mockElementFromPointByCoordinate((_x, y) => {
        if (y < 220) return page1
        if (y < 440) return page2
        return page3
      })

      try {
        dispatchPenDragStart(queryTextSpan('p1-bravo'), {
          clientX: 60,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 360
        })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p1-bravo',
          'p1-charlie',
          'p2-delta',
          'p2-echo',
          'p2-foxtrot'
        ])
        expect(detail.selectedText).not.toContain('P3 Golf')
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('cross-page active drag skips an empty loaded middle page', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange,
        page2Texts: []
      })
      const { page1, page2, page3 } = mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(
        makeDirectRenderTextSelectionWithEndpoints({
          selectedTextIds: [
            'p1-bravo',
            'p1-charlie',
            'p3-golf',
            'p3-hotel',
            'p3-india'
          ],
          anchorTextId: 'p1-bravo',
          focusTextId: 'p3-india'
        })
      )
      mockElementFromPointByCoordinate((_x, y) => {
        if (y < 220) return page1
        if (y < 440) return page2
        return page3
      })

      try {
        dispatchPenDragStart(queryTextSpan('p1-bravo'), {
          clientX: 60,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 510
        })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p1-bravo',
          'p1-charlie',
          'p3-golf',
          'p3-hotel'
        ])
        expect(detail.selectedText).toBe('P1 BravoP1 CharlieP3 GolfP3 Hotel')
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('cross-page fast pointer skip from page 1 to page 3 includes loaded middle-page text only when available', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange,
        loadPage2: false
      })
      const { page1, page2, page3 } = mockThreePageDirectRenderSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(
        makeDirectRenderTextSelectionWithEndpoints({
          selectedTextIds: [
            'p1-bravo',
            'p1-charlie',
            'p3-golf',
            'p3-hotel',
            'p3-india'
          ],
          anchorTextId: 'p1-bravo',
          focusTextId: 'p3-india'
        })
      )
      mockElementFromPointByCoordinate((_x, y) => {
        if (y < 220) return page1
        if (y < 440) return page2
        return page3
      })

      try {
        dispatchPenDragStart(queryTextSpan('p1-bravo'), {
          clientX: 60,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 510
        })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.texts.map((text: IntermediateText) => text.id)).toEqual([
          'p1-bravo',
          'p1-charlie',
          'p2-delta',
          'p2-echo',
          'p2-foxtrot',
          'p3-golf',
          'p3-hotel'
        ])
        expect(detail.selectedText).toContain('P2 DeltaP2 EchoP2 Foxtrot')
        expect(detail.selectedText).not.toContain('P3 India')
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('cross-page onSelectText receives bounded ordered segments without signature changes', async () => {
      const onSelectText = vi.fn()
      await renderCrossPageSelectionFixture(vi.fn(), { onSelectText })
      const { page2 } = mockCrossPageSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const selection = makeDirectRenderTextSelectionWithEndpoints({
        selectedTextIds: ['p1-b', 'p2-a', 'p2-b', 'p2-c'],
        anchorTextId: 'p1-b',
        focusTextId: 'p2-c'
      })
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(selection)
      mockElementFromPointByCoordinate((_x, y) =>
        y < 220 ? queryTextSpan('p1-b') : page2
      )

      try {
        dispatchPenDragStart(queryTextSpan('p1-b'), {
          clientX: 60,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 280
        })
        viewerRoot.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            clientX: 60,
            clientY: 280
          })
        )

        expect(onSelectText).toHaveBeenCalledTimes(1)
        expect(onSelectText.mock.calls[0]).toHaveLength(3)
        const [callbackSelection, segments, extractedText] =
          onSelectText.mock.calls[0]
        expect(callbackSelection).toBe(selection)
        expect(
          segments.map((segment: ReaderSelectedTextSegment) => segment.id)
        ).toEqual(['p1-b', 'p2-a', 'p2-b'])
        expect(
          segments.map(
            (segment: ReaderSelectedTextSegment) => segment.selectedText
          )
        ).toEqual(['P1B', 'P2A', 'P2B'])
        expect(extractedText).toBe('P1BP2AP2B')
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

    it('hides native selection for html-parser output when custom overlay is active', () => {
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
      expect(transparentSelectionBlock).toContain(
        'hamster-reader__html-parser-output'
      )
      expect(transparentSelectionBlock).toContain('hamster-note-page')
      expect(transparentSelectionBlock).toContain('[data-text-id]')
      expect(transparentSelectionBlock).toContain('span.hamster-note-text')
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

    it('nearest blank drag more than 100px from page text creates no selection', async () => {
      const onTextSelectionChange = vi.fn()
      await renderThreePageDirectRenderSelectionFixture({
        onTextSelectionChange,
        selectionOverlay: true
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
      mockElementFromPoint(page3)

      try {
        dispatchPointerDragStart(viewerRoot, { clientX: 320, clientY: 610 })
        dispatchPointerDragMove(viewerRoot, { clientX: 25, clientY: 550 })

        expect(liveSelection.selection.addRange).not.toHaveBeenCalled()
        expect(onTextSelectionChange).not.toHaveBeenCalled()
        expect(viewerRoot.querySelectorAll('[data-handle-type]')).toHaveLength(
          0
        )
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
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
        dispatchPenDragStart(textSpan, { clientX: 12, clientY: 18 })
        dispatchPenDragMove(viewerRoot, { clientX: 95, clientY: 80 })

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

    it('[baseline] multi-text selectionchange callback has detail.text equal to detail.texts[0]', async () => {
      const onTextSelectionChange = vi.fn()
      await renderCrossPageSelectionFixture(onTextSelectionChange)
      mockCrossPageSelectionRects()

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const selection = makeDirectRenderTextSelectionWithEndpoints({
        selectedTextIds: ['p1-b', 'p2-a', 'p2-b', 'p2-c'],
        anchorTextId: 'p1-b',
        focusTextId: 'p2-c'
      })
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(selection)
      const page2 = screen.getByTestId('intermediate-page-2')
      mockElementFromPointByCoordinate((_x, y) =>
        y < 220 ? queryTextSpan('p1-b') : page2
      )

      try {
        dispatchPenDragStart(queryTextSpan('p1-b'), {
          clientX: 60,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, {
          clientX: 60,
          clientY: 280
        })
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        const [text, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.text).toBe(detail.texts[0])
        expect(detail.text).toBe(text)
        expect(detail.pageNumber).toBe(1)
        expect(detail.texts).toHaveLength(3)
      } finally {
        getSelectionSpy.mockRestore()
      }
    })

    it('[baseline] completed selection renders start and end handles via data-handle-type', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          selectionHandleElement={<button type='button' />}
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

        const startHandle = page.querySelector('[data-handle-type="start"]')
        const endHandle = page.querySelector('[data-handle-type="end"]')
        expect(startHandle).toBeInstanceOf(HTMLElement)
        expect(endHandle).toBeInstanceOf(HTMLElement)
        expect(startHandle).not.toBe(endHandle)
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    })

    it('[baseline] drag flow fires onTextSelectionChange during move and onTextSelectionEnd on completion', async () => {
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
        dispatchPenDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        expect(onTextSelectionChange).not.toHaveBeenCalled()
        expect(onTextSelectionEnd).not.toHaveBeenCalled()

        dispatchPenDragMove(viewerRoot, { clientX: 100, clientY: 138 })
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).not.toHaveBeenCalled()

        dispatchPenDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)

        const [endText, endDetail] = onTextSelectionEnd.mock.calls[0]
        expect(endText).toHaveProperty('id')
        expect(endDetail).toHaveProperty('selectedText')
        expect(endDetail).toHaveProperty('texts')
        expect(endDetail).toHaveProperty('text')
        expect(endDetail.text).toBe(endText)
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('normalizes active mouseup selection away from page container boundaries', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          onTextSelectionEnd={onTextSelectionEnd}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('B')).toBeInTheDocument()
        expect(screen.getByText('D')).toBeInTheDocument()
      })

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = layoutFourTextPage()
      const pageRange = globalThis.document.createRange()
      pageRange.selectNodeContents(page)
      const liveSelection = makeLiveRangeSelection(pageRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPoint(page)

      try {
        dispatchPenDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchMouseSelectionStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        viewerRoot.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            clientX: 100,
            clientY: 138
          })
        )

        expect(liveSelection.activeRange.startContainer).toBe(
          getTextNode(queryTextSpan('text-b'))
        )
        expect(liveSelection.activeRange.endContainer).toBe(
          getTextNode(queryTextSpan('text-d'))
        )
        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('[baseline] drag flow callback detail.texts contains all selected text objects in order', async () => {
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
        dispatchPenDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPenDragMove(viewerRoot, { clientX: 100, clientY: 138 })

        const [, detail] = onTextSelectionChange.mock.calls[0]
        expect(detail.selectedText).toBe('BCD')
        expect(detail.texts.map((t: IntermediateText) => t.id)).toEqual([
          'text-b',
          'text-c',
          'text-d'
        ])
        for (const t of detail.texts) {
          expect(t).toHaveProperty('content')
          expect(t).toHaveProperty('id')
        }
      } finally {
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('renders drag preview overlay from preview geometry while native Selection rects are empty, then finalizes from native Selection', async () => {
      const { document: mockDoc } = makeFourTextDocument()
      const onTextSelectionChange = vi.fn()
      const onTextSelectionEnd = vi.fn()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          selectionHandleElement={<button type='button' />}
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
      const initialRange = globalThis.document.createRange()
      initialRange.setStart(getTextNode(queryTextSpan('text-b')), 0)
      initialRange.setEnd(getTextNode(queryTextSpan('text-c')), 1)
      const liveSelection = makeLiveRangeSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPoint(page)

      const originalGetClientRects = Range.prototype.getClientRects
      const originalGetBoundingClientRect =
        Range.prototype.getBoundingClientRect
      let nativeSelectionRects = [
        makeDomRect({ left: 10, top: 50, width: 20, height: 56 })
      ]
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => nativeSelectionRects)
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(
          () =>
            nativeSelectionRects[0] ??
            makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
        )
      })

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        await waitFor(() => {
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })
        onTextSelectionChange.mockClear()

        nativeSelectionRects = []
        dispatchPenDragStart(screen.getByText('B'), {
          clientX: 12,
          clientY: 58
        })
        dispatchPenDragMove(viewerRoot, { clientX: 100, clientY: 138 })

        const previewPath = page.querySelector(
          '.hamster-reader__selection-overlay-path'
        ) as SVGPathElement | null
        expectPathCoversRect(previewPath ?? undefined, {
          left: 10,
          top: 50,
          width: 0,
          height: 96
        })
        await waitFor(() => {
          const handles = viewerRoot.querySelectorAll('[data-handle-type]')
          expect(handles).toHaveLength(2)
          handles.forEach((handle) => {
            expect(handle).toHaveAttribute('aria-hidden', 'true')
            expect(handle).toHaveAttribute(
              'data-selection-handle-hidden',
              'true'
            )
            expect(
              handle.classList.contains(
                'hamster-reader__selection-handle--hidden'
              )
            ).toBe(true)
          })
        })
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd).not.toHaveBeenCalled()

        nativeSelectionRects = [
          makeDomRect({ left: 10, top: 50, width: 20, height: 96 })
        ]
        dispatchPenDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 138
        })

        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        const [endText, endDetail] = onTextSelectionEnd.mock.calls[0]
        expect(endText).toHaveProperty('id', 'text-b')
        expect(endDetail.text).toBe(endText)
        expect(endDetail.selectedText).toBe('BCD')
        expect(
          endDetail.texts.map((text: IntermediateText) => text.id)
        ).toEqual(['text-b', 'text-c', 'text-d'])
        await waitFor(() => {
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })
        const finalPath = page.querySelector(
          '.hamster-reader__selection-overlay-path'
        ) as SVGPathElement | null
        expectPathCoversRect(finalPath ?? undefined, {
          left: 10,
          top: 50,
          width: 20,
          height: 96
        })
      } finally {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: originalGetClientRects
        })
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: originalGetBoundingClientRect
        })
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    it('cross-page drag preview spans pages, then final pointerup scopes overlay and handles from native Selection rects', async () => {
      const onTextSelectionChange = vi.fn()
      const onTextSelectionEnd = vi.fn()
      const { document: mockDoc } = makeCrossPageTextDocument()
      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          selectionHandleElement={<button type='button' />}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
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

      mockCrossPageSelectionRects()
      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page1 = screen.getByTestId('intermediate-page-1')
      const page2 = screen.getByTestId('intermediate-page-2')
      const liveSelection = makeEmptyLiveSelection()
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaretApis = installUnavailableCaretPointApis()
      mockElementFromPointByCoordinate((_x, y) => {
        if (y < 220) return queryTextSpan('p1-b')
        return queryTextSpan('p2-c')
      })

      const originalGetClientRects = Range.prototype.getClientRects
      const originalGetBoundingClientRect =
        Range.prototype.getBoundingClientRect
      const p1TextNode = getTextNode(queryTextSpan('p1-b'))
      const p2TextNode = getTextNode(queryTextSpan('p2-c'))
      let rangeRectPhase: 'preview' | 'final' = 'preview'
      const previewMustNotLeakRect = makeDomRect({
        left: 200,
        top: 80,
        width: 55,
        height: 17
      })
      const finalPage1Rect = makeDomRect({
        left: 20,
        top: 60,
        width: 80,
        height: 20
      })
      const finalPage2Rect = makeDomRect({
        left: 20,
        top: 310,
        width: 80,
        height: 20
      })
      const startBoundaryRect = makeDomRect({
        left: 20,
        top: 60,
        width: 0,
        height: 20
      })
      const endBoundaryRect = makeDomRect({
        left: 100,
        top: 310,
        width: 0,
        height: 20
      })

      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: vi.fn(function (this: Range) {
          if (this.collapsed) {
            if (this.startContainer === p1TextNode) return [startBoundaryRect]
            if (this.startContainer === p2TextNode) return [endBoundaryRect]
            return []
          }
          return rangeRectPhase === 'final'
            ? [finalPage1Rect, finalPage2Rect]
            : []
        })
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(function (this: Range) {
          if (this.collapsed) {
            if (this.startContainer === p1TextNode) return startBoundaryRect
            if (this.startContainer === p2TextNode) return endBoundaryRect
            return makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
          }
          return rangeRectPhase === 'final'
            ? finalPage1Rect
            : previewMustNotLeakRect
        })
      })

      try {
        dispatchPenDragStart(queryTextSpan('p1-b'), {
          clientX: 40,
          clientY: 70
        })
        dispatchPenDragMove(viewerRoot, { clientX: 100, clientY: 320 })

        await waitFor(() => {
          expect(getOverlayBlocks(page1)).toHaveLength(1)
          expect(getOverlayBlocks(page2)).toHaveLength(1)
        })
        expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
        expect(liveSelection.selection.toString()).toBe('P1BP2AP2BP2C')
        expectPathCoversRect(getOverlayBlocks(page1)[0], {
          left: 20,
          top: 60,
          width: 1,
          height: 20
        })
        expectPathCoversRect(getOverlayBlocks(page2)[0], {
          left: 100,
          top: 90,
          width: 1,
          height: 20
        })

        rangeRectPhase = 'final'
        dispatchPenDragEnd(viewerRoot, 'pointerup', {
          clientX: 100,
          clientY: 320
        })

        expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
        expect(onTextSelectionEnd.mock.calls[0][1].selectedText).toBe(
          'P1BP2AP2BP2C'
        )
        expect(liveSelection.selection.toString()).toBe('P1BP2AP2BP2C')
        expect(liveSelection.selection.isCollapsed).toBe(false)

        await waitFor(() => {
          expect(page1.querySelector('[data-handle-type="start"]')).toBeTruthy()
          expect(page2.querySelector('[data-handle-type="end"]')).toBeTruthy()
        })
        expect(page1.querySelector('[data-handle-type="end"]')).toBeNull()
        expect(page2.querySelector('[data-handle-type="start"]')).toBeNull()

        expectPathCoversRect(getOverlayBlocks(page1)[0], {
          left: 20,
          top: 60,
          width: 80,
          height: 20
        })
        expectPathCoversRect(getOverlayBlocks(page2)[0], {
          left: 20,
          top: 90,
          width: 80,
          height: 20
        })

        const page1StartHandle = page1.querySelector(
          '[data-handle-type="start"]'
        ) as HTMLElement
        const page2EndHandle = page2.querySelector(
          '[data-handle-type="end"]'
        ) as HTMLElement
        expect(page1StartHandle).toHaveStyle({ left: '20px', top: '80px' })
        expect(page2EndHandle).toHaveStyle({ left: '100px', top: '110px' })
      } finally {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: originalGetClientRects
        })
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: originalGetBoundingClientRect
        })
        restoreCaretApis()
        getSelectionSpy.mockRestore()
      }
    })

    describe('handle visibility during drag preview', () => {
      const assertHandlesVisible = (root: HTMLElement) => {
        const handles = root.querySelectorAll('[data-handle-type]')
        expect(handles.length).toBeGreaterThanOrEqual(2)
        handles.forEach((handle) => {
          expect(handle).not.toHaveAttribute('aria-hidden', 'true')
          expect(handle).not.toHaveAttribute(
            'data-selection-handle-hidden',
            'true'
          )
          expect(
            handle.classList.contains(
              'hamster-reader__selection-handle--hidden'
            )
          ).toBe(false)
        })
      }

      const assertHandlesHidden = (root: HTMLElement) => {
        const handles = root.querySelectorAll('[data-handle-type]')
        expect(handles.length).toBeGreaterThanOrEqual(2)
        handles.forEach((handle) => {
          expect(handle).toHaveAttribute('aria-hidden', 'true')
          expect(handle).toHaveAttribute('data-selection-handle-hidden', 'true')
          expect(
            handle.classList.contains(
              'hamster-reader__selection-handle--hidden'
            )
          ).toBe(true)
        })
      }

      const setupHandleVisibilityTest = () => {
        const { document: mockDoc } = makeFourTextDocument()
        const onTextSelectionChange = vi.fn()
        const onTextSelectionEnd = vi.fn()
        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            renderMode='direct'
            selectionOverlay
            selectionHandleElement={<button type='button' />}
            onTextSelectionChange={onTextSelectionChange}
            onTextSelectionEnd={onTextSelectionEnd}
          />
        )

        return { mockDoc, onTextSelectionChange, onTextSelectionEnd }
      }

      const setupSelectionAndDragContext = async () => {
        const helpers = setupHandleVisibilityTest()

        await waitFor(() => {
          expect(screen.getByText('B')).toBeInTheDocument()
        })

        const viewerRoot = screen.getByTestId('intermediate-document-viewer')
        const page = layoutFourTextPage()
        const initialRange = globalThis.document.createRange()
        initialRange.setStart(getTextNode(queryTextSpan('text-b')), 0)
        initialRange.setEnd(getTextNode(queryTextSpan('text-c')), 1)
        const liveSelection = makeLiveRangeSelection(initialRange)
        const getSelectionSpy = vi
          .spyOn(window, 'getSelection')
          .mockReturnValue(liveSelection.selection)
        const restoreCaretApis = installUnavailableCaretPointApis()
        mockElementFromPoint(page)

        const originalGetClientRects = Range.prototype.getClientRects
        const originalGetBoundingClientRect =
          Range.prototype.getBoundingClientRect
        let nativeSelectionRects = [
          makeDomRect({ left: 10, top: 50, width: 20, height: 56 })
        ]
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: vi.fn(() => nativeSelectionRects)
        })
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: vi.fn(
            () =>
              nativeSelectionRects[0] ??
              makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
          )
        })

        globalThis.document.dispatchEvent(new Event('selectionchange'))
        await waitFor(() => {
          expect(
            viewerRoot.querySelectorAll('[data-handle-type]')
          ).toHaveLength(2)
        })

        return {
          ...helpers,
          viewerRoot,
          page,
          liveSelection,
          getSelectionSpy,
          restoreCaretApis,
          originalGetClientRects,
          originalGetBoundingClientRect,
          setNativeSelectionRects: (rects: DOMRect[]) => {
            nativeSelectionRects = rects
          }
        }
      }

      // eslint-disable-next-line sonarjs/assertions-in-tests -- assertHandlesVisible contains expect()
      it('keeps completed-selection handles visible after pointerdown without movement', async () => {
        const ctx = await setupSelectionAndDragContext()
        try {
          dispatchPointerDragStart(screen.getByText('B'), {
            clientX: 12,
            clientY: 58
          })

          assertHandlesVisible(ctx.viewerRoot)
        } finally {
          Object.defineProperty(Range.prototype, 'getClientRects', {
            configurable: true,
            value: ctx.originalGetClientRects
          })
          Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: ctx.originalGetBoundingClientRect
          })
          ctx.restoreCaretApis()
          ctx.getSelectionSpy.mockRestore()
        }
      })

      // eslint-disable-next-line sonarjs/assertions-in-tests -- assertHandlesHidden contains expect()
      it('hides both handles after pointermove past drag threshold', async () => {
        const ctx = await setupSelectionAndDragContext()
        try {
          ctx.setNativeSelectionRects([])
          dispatchPenDragStart(screen.getByText('B'), {
            clientX: 12,
            clientY: 58
          })
          dispatchPenDragMove(ctx.viewerRoot, {
            clientX: 100,
            clientY: 138
          })

          await waitFor(() => {
            assertHandlesHidden(ctx.viewerRoot)
          })
        } finally {
          Object.defineProperty(Range.prototype, 'getClientRects', {
            configurable: true,
            value: ctx.originalGetClientRects
          })
          Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: ctx.originalGetBoundingClientRect
          })
          ctx.restoreCaretApis()
          ctx.getSelectionSpy.mockRestore()
        }
      })

      // eslint-disable-next-line sonarjs/assertions-in-tests -- assertHandlesVisible/Hidden contain expect()
      it('restores handles visible after pointerup finalizes overlay', async () => {
        const ctx = await setupSelectionAndDragContext()
        try {
          ctx.setNativeSelectionRects([])
          dispatchPenDragStart(screen.getByText('B'), {
            clientX: 12,
            clientY: 58
          })
          dispatchPenDragMove(ctx.viewerRoot, {
            clientX: 100,
            clientY: 138
          })

          await waitFor(() => {
            assertHandlesHidden(ctx.viewerRoot)
          })

          ctx.setNativeSelectionRects([
            makeDomRect({ left: 10, top: 50, width: 20, height: 96 })
          ])
          dispatchPenDragEnd(ctx.viewerRoot, 'pointerup', {
            clientX: 100,
            clientY: 138
          })

          await waitFor(() => {
            assertHandlesVisible(ctx.viewerRoot)
          })
        } finally {
          Object.defineProperty(Range.prototype, 'getClientRects', {
            configurable: true,
            value: ctx.originalGetClientRects
          })
          Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: ctx.originalGetBoundingClientRect
          })
          ctx.restoreCaretApis()
          ctx.getSelectionSpy.mockRestore()
        }
      })

      // eslint-disable-next-line sonarjs/assertions-in-tests -- assertHandlesVisible contains expect()
      it('restores handles visible after pointercancel and returns to idle', async () => {
        const ctx = await setupSelectionAndDragContext()
        try {
          ctx.setNativeSelectionRects([])
          dispatchPenDragStart(screen.getByText('B'), {
            clientX: 12,
            clientY: 58
          })
          dispatchPenDragMove(ctx.viewerRoot, {
            clientX: 100,
            clientY: 138
          })

          await waitFor(() => {
            assertHandlesHidden(ctx.viewerRoot)
          })

          ctx.setNativeSelectionRects([
            makeDomRect({ left: 10, top: 50, width: 20, height: 96 })
          ])
          dispatchPenDragEnd(ctx.viewerRoot, 'pointercancel', {
            clientX: 100,
            clientY: 138
          })

          await waitFor(() => {
            assertHandlesVisible(ctx.viewerRoot)
          })
        } finally {
          Object.defineProperty(Range.prototype, 'getClientRects', {
            configurable: true,
            value: ctx.originalGetClientRects
          })
          Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: ctx.originalGetBoundingClientRect
          })
          ctx.restoreCaretApis()
          ctx.getSelectionSpy.mockRestore()
        }
      })

      it('cancels from armed without collapsing the existing native Selection and keeps handles visible', async () => {
        const ctx = await setupSelectionAndDragContext()
        try {
          ctx.onTextSelectionChange.mockClear()
          ctx.onTextSelectionEnd.mockClear()
          ctx.liveSelection.selection.removeAllRanges.mockClear()
          ctx.liveSelection.selection.addRange.mockClear()

          dispatchPointerDragStart(screen.getByText('B'), {
            clientX: 12,
            clientY: 58
          })
          dispatchPointerDragEnd(ctx.viewerRoot, 'pointercancel', {
            clientX: 12,
            clientY: 58
          })

          expect(ctx.onTextSelectionChange).not.toHaveBeenCalled()
          expect(ctx.onTextSelectionEnd).not.toHaveBeenCalled()
          expect(ctx.liveSelection.selection.toString()).toBe('BC')
          expect(ctx.liveSelection.selection.isCollapsed).toBe(false)
          expect(
            ctx.liveSelection.selection.removeAllRanges
          ).not.toHaveBeenCalled()
          expect(ctx.liveSelection.selection.addRange).not.toHaveBeenCalled()
          assertHandlesVisible(ctx.viewerRoot)

          dispatchPenDragStart(screen.getByText('C'), {
            clientX: 12,
            clientY: 98
          })
          dispatchPenDragMove(ctx.viewerRoot, {
            clientX: 100,
            clientY: 138
          })

          expect(ctx.onTextSelectionChange).toHaveBeenCalledTimes(1)
          expect(ctx.onTextSelectionChange.mock.calls[0][1].selectedText).toBe(
            'CD'
          )
        } finally {
          Object.defineProperty(Range.prototype, 'getClientRects', {
            configurable: true,
            value: ctx.originalGetClientRects
          })
          Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: ctx.originalGetBoundingClientRect
          })
          ctx.restoreCaretApis()
          ctx.getSelectionSpy.mockRestore()
        }
      })

      it('cancels from dragging once, restores handles, and starts the next drag with a fresh anchor', async () => {
        const ctx = await setupSelectionAndDragContext()
        try {
          ctx.onTextSelectionChange.mockClear()
          ctx.onTextSelectionEnd.mockClear()

          ctx.setNativeSelectionRects([])
          dispatchPenDragStart(screen.getByText('B'), {
            clientX: 12,
            clientY: 58
          })
          dispatchPenDragMove(ctx.viewerRoot, {
            clientX: 100,
            clientY: 98
          })
          await waitFor(() => {
            assertHandlesHidden(ctx.viewerRoot)
          })

          ctx.setNativeSelectionRects([
            makeDomRect({ left: 10, top: 50, width: 20, height: 56 })
          ])
          dispatchPenDragEnd(ctx.viewerRoot, 'pointercancel', {
            clientX: 100,
            clientY: 98
          })

          expect(ctx.onTextSelectionEnd).toHaveBeenCalledTimes(1)
          expect(ctx.onTextSelectionEnd.mock.calls[0][1].selectedText).toBe(
            'BC'
          )
          await waitFor(() => {
            assertHandlesVisible(ctx.viewerRoot)
          })

          dispatchPenDragStart(screen.getByText('C'), {
            clientX: 12,
            clientY: 98
          })
          dispatchPenDragMove(ctx.viewerRoot, {
            clientX: 100,
            clientY: 138
          })

          expect(ctx.onTextSelectionChange).toHaveBeenCalledTimes(2)
          expect(ctx.onTextSelectionChange.mock.calls[1][1].selectedText).toBe(
            'CD'
          )
        } finally {
          Object.defineProperty(Range.prototype, 'getClientRects', {
            configurable: true,
            value: ctx.originalGetClientRects
          })
          Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: ctx.originalGetBoundingClientRect
          })
          ctx.restoreCaretApis()
          ctx.getSelectionSpy.mockRestore()
        }
      })
    })

    // Task 6 — live handle drag / chrome hit-testing / selector reuse
    describe('Task 6: live handle drag and overlay chrome hardening', () => {
      const installDynamicRangeRectMocks = () => {
        const originalGetClientRects = Range.prototype.getClientRects
        const originalGetBoundingClientRect =
          Range.prototype.getBoundingClientRect

        // 根据 range 的 startContainer/endContainer 所在元素的位置返回对应 rect。
        // collectSelectionOverlayClientRects 为每个文本元素创建 clippedRange，
        // 所以这里按 clippedRange 覆盖的文本元素返回该元素的 viewport rect —
        // 这样 B/C/D 各有不同坐标，overlay path data 在选区扩展时可见地改变。
        const getRectForRange = (range: Range): DOMRect[] => {
          // 检查 range 是否与某个已知 text-id 元素相交，返回该元素的 rect
          const startEl = range.startContainer.parentElement
          const endEl = range.endContainer.parentElement
          for (const [id, rect] of [
            ['text-a', { left: 10, top: 10, width: 20, height: 16 }],
            ['text-b', { left: 10, top: 50, width: 20, height: 16 }],
            ['text-c', { left: 10, top: 90, width: 20, height: 16 }],
            ['text-d', { left: 10, top: 130, width: 20, height: 16 }]
          ] as const) {
            const el = globalThis.document.querySelector(
              `[data-text-id="${id}"]`
            )
            if (
              el &&
              (el === startEl || el === endEl || range.intersectsNode(el))
            ) {
              // 如果 range 横跨多行，返回包含所有行的合并 rect
              return [makeDomRect(rect)]
            }
          }
          return [makeDomRect({ left: 20, top: 24, width: 35, height: 9 })]
        }

        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: vi.fn(function (this: Range) {
            return getRectForRange(this)
          })
        })
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: vi.fn(function (this: Range) {
            const rects = getRectForRange(this)
            return (
              rects[0] ?? makeDomRect({ left: 0, top: 0, width: 0, height: 0 })
            )
          })
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

      it('changes live SVG path data when dragging the end handle extends the selection', async () => {
        // 验证 T3 独立 SVG path 渲染下，实时手柄拖拽改变 overlay path data
        const { document: mockDoc } = makeFourTextDocument()
        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            renderMode='direct'
            selectionOverlay
            selectionHandleElement={<button type='button' />}
          />
        )

        await waitFor(() => {
          expect(screen.getByText('B')).toBeInTheDocument()
          expect(screen.getByText('D')).toBeInTheDocument()
        })

        const viewerRoot = screen.getByTestId('intermediate-document-viewer')
        const page = layoutFourTextPage()

        // 初始选区 BC
        const initialRange = globalThis.document.createRange()
        initialRange.setStart(getTextNode(queryTextSpan('text-b')), 0)
        initialRange.setEnd(getTextNode(queryTextSpan('text-c')), 1)
        const liveSelection = makeLiveRangeSelection(initialRange)
        const getSelectionSpy = vi
          .spyOn(window, 'getSelection')
          .mockReturnValue(liveSelection.selection)
        const restoreRangeRects = installDynamicRangeRectMocks()
        const elementFromPointSpy = mockElementFromPoint(page)

        try {
          globalThis.document.dispatchEvent(new Event('selectionchange'))

          await waitFor(() => {
            expect(
              viewerRoot.querySelectorAll('[data-handle-type]')
            ).toHaveLength(2)
          })
          await act(async () => {
            await Promise.resolve()
          })

          // 初始 overlay path：选区 "BC" → B 和 C 各一条独立 path（T3 独立路径渲染）
          let blocks = getOverlayBlocks(page)
          expect(blocks.length).toBe(2)
          // 记录所有 path d 的拼接 — 拖拽后整体应变化
          const initialAllPathD = blocks
            .map((b) => b.getAttribute('d') || '')
            .join('|')
          expect(initialAllPathD).toBeTruthy()

          // caret API 定位到 text-d
          const restoreCaret = installCaretPositionFromPoint(
            getTextNode(queryTextSpan('text-d')),
            1
          )

          // 拖拽 end handle 到 D（clientY:138 → text-d 区域）
          const endHandle = page.querySelector(
            '[data-handle-type="end"]'
          ) as HTMLElement
          dispatchHandleDragEvent(endHandle, 'pointerdown', {
            clientX: 50,
            clientY: 25
          })
          dispatchHandleDragEvent(endHandle, 'pointermove', {
            clientX: 18,
            clientY: 138
          })

          expect(liveSelection.selection.toString()).toBe('BCD')

          // 拖拽后 overlay path 数量应增加（BCD → B、C、D 三条独立 path）
          blocks = getOverlayBlocks(page)
          expect(blocks.length).toBe(3)
          // 所有 path d 拼接应与初始不同 — 证明拖拽改变了 SVG 覆盖层
          const updatedAllPathD = blocks
            .map((b) => b.getAttribute('d') || '')
            .join('|')
          expect(updatedAllPathD).not.toBe(initialAllPathD)

          // 验证第三条 path 覆盖了 D 的区域（page-relative {10,130,20,16}）
          expectPathCoversRect(blocks[2], {
            left: 10,
            top: 130,
            width: 20,
            height: 16
          })

          dispatchHandleDragEvent(endHandle, 'pointerup', {
            clientX: 18,
            clientY: 138
          })

          restoreCaret()
        } finally {
          elementFromPointSpy.mockRestore()
          restoreRangeRects()
          getSelectionSpy.mockRestore()
        }
      })

      it('clicking overlay path does not start accidental text selection', async () => {
        // 验证 caret hit-testing 跳过 overlay chrome：
        // 点击 overlay-path 不应触发文本选区
        const { document: mockDoc } = makeDocument({ pageCount: 1 })
        const onTextSelectionChange = vi.fn()
        const onTextSelectionEnd = vi.fn()

        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            renderMode='direct'
            selectionOverlay
            onTextSelectionChange={onTextSelectionChange}
            onTextSelectionEnd={onTextSelectionEnd}
          />
        )

        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })

        const viewerRoot = screen.getByTestId('intermediate-document-viewer')
        const page = screen.getByTestId('intermediate-page-1')
        const liveSelection = makeEmptyLiveSelection()
        const getSelectionSpy = vi
          .spyOn(window, 'getSelection')
          .mockReturnValue(liveSelection.selection)
        const restoreCaretApis = installUnavailableCaretPointApis()
        mockElementFromPoint(page)

        try {
          const overlayContainer = page.querySelector(
            '.hamster-reader__selection-overlay'
          ) as HTMLElement
          // jsdom 测试中用 div 模拟 overlay-path 即可（caret hit-testing 通过 className 匹配）
          const overlayPath = globalThis.document.createElement('div')
          overlayPath.className = 'hamster-reader__selection-overlay-path'
          overlayContainer.appendChild(overlayPath)

          // SELECTION_CHROME_HIT_SELECTOR 排除 overlay-path → 不触发选区
          dispatchPointerDragStart(overlayPath, { clientX: 25, clientY: 28 })
          dispatchPointerDragMove(viewerRoot, { clientX: 30, clientY: 35 })
          dispatchPointerDragEnd(viewerRoot, 'pointerup', {
            clientX: 30,
            clientY: 35
          })

          expect(onTextSelectionChange).not.toHaveBeenCalled()
          expect(onTextSelectionEnd).not.toHaveBeenCalled()
        } finally {
          restoreCaretApis()
          getSelectionSpy.mockRestore()
        }
      })

      it('overlay path matches SELECTION_CHROME_TARGET_SELECTOR in caretResolver', () => {
        // 直接验证 overlay path 元素匹配 caretResolver 的 chrome selector
        const path = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'path'
        )
        path.setAttribute('class', 'hamster-reader__selection-overlay-path')

        expect(
          path.closest(
            '.hamster-reader__selection-overlay, .hamster-reader__selection-overlay-path, .hamster-reader__saved-selection-handles, .hamster-reader__saved-selection-overlay, .hamster-reader__selection-handle'
          )
        ).toBe(path)
      })

      it('SELECTION_CHROME_HIT_SELECTOR includes .hamster-reader__selection-overlay-path', () => {
        // 断言 T3 未引入新类名：viewer selector 仍包含 overlay-path
        const viewerSource = fs.readFileSync(
          path.resolve(
            __dirname,
            '../src/components/IntermediateDocumentViewer/IntermediateDocumentViewer.tsx'
          ),
          'utf-8'
        )
        const selectorBlockMatch = viewerSource.match(
          /SELECTION_CHROME_HIT_SELECTOR\s*=\s*\[([\s\S]*?)\]\.join\(',\s*'\)/
        )
        expect(selectorBlockMatch).toBeTruthy()
        if (selectorBlockMatch) {
          expect(selectorBlockMatch[1]).toContain(
            '.hamster-reader__selection-overlay-path'
          )
        }
      })

      it('SELECTION_CHROME_TARGET_SELECTOR in caretResolver includes .hamster-reader__selection-overlay-path', () => {
        // 断言 caretResolver selector 仍包含 overlay-path
        const caretSource = fs.readFileSync(
          path.resolve(
            __dirname,
            '../src/components/selection/caretResolver.ts'
          ),
          'utf-8'
        )
        const selectorBlockMatch = caretSource.match(
          /SELECTION_CHROME_TARGET_SELECTOR\s*=\s*\[([\s\S]*?)\]\.join\(',\s*'\)/
        )
        expect(selectorBlockMatch).toBeTruthy()
        if (selectorBlockMatch) {
          expect(selectorBlockMatch[1]).toContain(
            '.hamster-reader__selection-overlay-path'
          )
        }
      })

      it('live overlay uses hamster-reader__selection-overlay-path class (no new class from T3)', async () => {
        // 实际渲染后断言 DOM 中 path 使用现有类名
        const { document: mockDoc } = makeDocument({ pageCount: 1 })
        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            renderMode='direct'
            selectionOverlay
          />
        )

        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })

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
          .mockReturnValue(
            makeSelectionWithRects(() => [
              makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
            ])
          )

        try {
          globalThis.document.dispatchEvent(new Event('selectionchange'))
          await waitFor(() => {
            expect(getOverlayBlocks(page).length).toBeGreaterThanOrEqual(1)
          })

          expect(
            page.querySelector('.hamster-reader__selection-overlay-path')
          ).toBeInTheDocument()
          expect(
            page.querySelector('.hamster-reader__selection-overlay-svg')
          ).toBeInTheDocument()
        } finally {
          getSelectionSpy.mockRestore()
          elementFromPointSpy.mockRestore()
          pageRectSpy.mockRestore()
        }
      })
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

    type CapturedHandleProps = Partial<ReaderSelectionHandleRenderProps> & {
      className?: string
      style?: React.CSSProperties
      'data-handle-type'?: string
    }

    const createCapturingCustomHandle = () => {
      const capturedProps: CapturedHandleProps[] = []
      const CustomHandle = (props: CapturedHandleProps) => {
        capturedProps.push(props)
        return (
          <button
            type='button'
            data-handle-type={props['data-handle-type']}
            className={props.className}
            style={props.style}
          />
        )
      }
      return { CustomHandle, capturedProps }
    }

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

    // 回归测试：拖动手柄时，鼠标稍微偏离行的 Y 坐标（行间空隙、行下方 5px 等）
    // 应根据鼠标 X 位置在行内插值出正确字符偏移，而不是退化为「行首/行末」二选一。
    // Bug 修复前：caretPositionFromPoint 在文本 rect 之外返回 null，
    // 然后 fallback buildSnapRange 仅根据 clientX 与 rect 中点比较选 0 或 textContent.length。
    // Bug 修复后：handle drag 路径使用 snapToNearestLine 选项，
    // 把 Y 钳制到最近文本行 rect 内，再次调用浏览器 caret API，从而拿到行内字符级偏移。
    it('drags an end handle with off-line Y but mid-line X to a mid-line caret offset', async () => {
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
      // text rect: x in [20, 80], y in [24, 36], height 12, vertical center y=30
      const textRectSpy = mockElementRect(text, {
        left: 20,
        top: 24,
        width: 60,
        height: 12
      })
      // elementFromPoint 在 (50, 80)（远在行下方）返回 page，模拟空白命中。
      const elementFromPointSpy = mockElementFromPoint(page)

      // 关键：caretPositionFromPoint 仅当 Y 落在 text rect 内时才返回有效结果。
      // 用 Y=80 调用应返回 null（模拟浏览器 native API 在文本外的行为）。
      // 修复后实现会把 Y 钳制到 [24+ε, 36-ε]，再次调用，此时返回 mid-line offset。
      const caretPositionMock = vi.fn(
        (x: number, y: number): { offsetNode: Node; offset: number } | null => {
          if (y < 24 || y > 36) return null
          // 行内：把 X 比例映射到字符偏移 [0, textNode.length]
          // textNode.length === 'Page 1 text'.length === 11
          const rectLeft = 20
          const rectWidth = 60
          const ratio = Math.min(1, Math.max(0, (x - rectLeft) / rectWidth))
          return {
            offsetNode: textNode,
            offset: Math.round(ratio * textNode.length)
          }
        }
      )
      const originalCaretPosition = (
        globalThis.document as Document & {
          caretPositionFromPoint?: unknown
        }
      ).caretPositionFromPoint
      Object.defineProperty(globalThis.document, 'caretPositionFromPoint', {
        configurable: true,
        value: caretPositionMock
      })

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
            clientX: 30,
            clientY: 30
          })
        )
        // pointermove：X 在文本水平中点 (50)，Y 在文本下方 50px（行下方空白）。
        // 期望选区端点最终为行中点附近的字符（textNode.length / 2 ≈ 5-6），
        // 不是 0 也不是 textNode.length。
        endHandle.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: false,
            clientX: 50,
            clientY: 80
          })
        )

        expect(liveSelection.selection.addRange).toHaveBeenCalled()
        expect(liveSelection.activeRange.endContainer).toBe(textNode)
        const finalEndOffset = liveSelection.activeRange.endOffset
        // 这是回归断言：Y 偏离行时不应再被吸附到行首/行末。
        expect(finalEndOffset).not.toBe(0)
        expect(finalEndOffset).not.toBe(textNode.length)
        // 应靠近水平中点对应的字符偏移（X=50 落在 rect [20,80] 的正中，比例 0.5）。
        expect(finalEndOffset).toBeGreaterThanOrEqual(4)
        expect(finalEndOffset).toBeLessThanOrEqual(7)
      } finally {
        getSelectionSpy.mockRestore()
        Object.defineProperty(globalThis.document, 'caretPositionFromPoint', {
          configurable: true,
          value: originalCaretPosition
        })
        elementFromPointSpy.mockRestore()
        textRectSpy.mockRestore()
        pageRectSpy.mockRestore()
        restoreRangeRects()
      }
    })

    it('keeps the selection after an end-handle drag followed by a blank synthesized click', async () => {
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
      const restoreCaretPosition = installCaretPositionFromPoint(textNode, 8)
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
            clientX: 50,
            clientY: 25
          })
        )
        endHandle.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: false,
            clientX: 70,
            clientY: 24
          })
        )
        endHandle.dispatchEvent(
          new MouseEvent('pointerup', {
            bubbles: false,
            clientX: 70,
            clientY: 24
          })
        )

        liveSelection.selection.removeAllRanges.mockClear()

        page.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            clientX: 95,
            clientY: 95
          })
        )

        expect(liveSelection.selection.removeAllRanges).not.toHaveBeenCalled()
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

    it('passes text-height-aware sizing metadata to custom selection handles', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const fullRects = [
        makeDomRect({ left: 200, top: 25, width: 300, height: 20 })
      ]
      const startBoundaryRects = [
        makeDomRect({ left: 50, top: 25, width: 0, height: 16 })
      ]
      const endBoundaryRects = [
        makeDomRect({ left: 500, top: 25, width: 0, height: 24 })
      ]

      const { CustomHandle, capturedProps } = createCapturingCustomHandle()

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay
          selectionHandleElement={<CustomHandle />}
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

        const startProps = capturedProps.find(
          (p) => p['data-handle-type'] === 'start'
        )
        const endProps = capturedProps.find(
          (p) => p['data-handle-type'] === 'end'
        )

        expect(startProps).toBeDefined()
        expect(startProps?.position?.textHeight).toBe(16)
        expect(startProps?.position?.hitAreaWidth).toBe(8)
        expect(startProps?.position?.hitAreaHeight).toBe(16)
        expect(startProps?.textHeight).toBe(16)
        expect(startProps?.hitAreaWidth).toBe(8)
        expect(startProps?.hitAreaHeight).toBe(16)

        expect(endProps).toBeDefined()
        expect(endProps?.position?.textHeight).toBe(24)
        expect(endProps?.position?.hitAreaWidth).toBe(12)
        expect(endProps?.position?.hitAreaHeight).toBe(24)
        expect(endProps?.textHeight).toBe(24)
        expect(endProps?.hitAreaWidth).toBe(12)
        expect(endProps?.hitAreaHeight).toBe(24)
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    })

    it('falls back sizing metadata when boundary rect height is zero or missing', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const fullRects = [
        makeDomRect({ left: 200, top: 25, width: 300, height: 20 })
      ]
      const startBoundaryRects = [
        makeDomRect({ left: 50, top: 25, width: 0, height: 0 })
      ]
      const endBoundaryRects: DOMRect[] = []

      const { CustomHandle, capturedProps } = createCapturingCustomHandle()

      render(
        <IntermediateDocumentViewer
          document={document}
          selectionOverlay
          selectionHandleElement={<CustomHandle />}
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

        const startProps = capturedProps.find(
          (p) => p['data-handle-type'] === 'start'
        )
        const endProps = capturedProps.find(
          (p) => p['data-handle-type'] === 'end'
        )

        expect(startProps).toBeDefined()
        expect(startProps?.position?.textHeight).toBe(24)
        expect(startProps?.position?.hitAreaWidth).toBe(12)
        expect(startProps?.position?.hitAreaHeight).toBe(24)

        expect(endProps).toBeDefined()
        expect(endProps?.position?.textHeight).toBe(24)
        expect(endProps?.position?.hitAreaWidth).toBe(12)
        expect(endProps?.position?.hitAreaHeight).toBe(24)
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
    const dispatchLivePenDragStart = (
      target: HTMLElement,
      point: { clientX: number; clientY: number }
    ) => {
      const event = new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: point.clientX,
        clientY: point.clientY
      })
      Object.defineProperty(event, 'pointerId', {
        configurable: true,
        value: 1
      })
      Object.defineProperty(event, 'pointerType', {
        configurable: true,
        value: 'pen'
      })
      target.dispatchEvent(event)
    }

    const dispatchLivePenDragMove = (
      target: HTMLElement,
      point: { clientX: number; clientY: number }
    ) => {
      const event = new MouseEvent('pointermove', {
        bubbles: true,
        clientX: point.clientX,
        clientY: point.clientY
      })
      Object.defineProperty(event, 'pointerId', {
        configurable: true,
        value: 1
      })
      Object.defineProperty(event, 'pointerType', {
        configurable: true,
        value: 'pen'
      })
      target.dispatchEvent(event)
    }

    const dispatchLivePenDragEnd = (
      target: HTMLElement,
      type: 'pointerup' | 'pointercancel',
      point: { clientX: number; clientY: number }
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        clientX: point.clientX,
        clientY: point.clientY
      })
      Object.defineProperty(event, 'pointerId', {
        configurable: true,
        value: 1
      })
      Object.defineProperty(event, 'pointerType', {
        configurable: true,
        value: 'pen'
      })
      target.dispatchEvent(event)
    }

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
        dispatchLivePenDragStart(text, { clientX: 15, clientY: 25 })

        dispatchLivePenDragMove(viewerRoot, { clientX: 45, clientY: 33 })

        let blocks = getOverlayBlocks(page)
        expect(blocks).toHaveLength(1)
        expectPathCoversRect(blocks[0], {
          left: 10,
          top: 20,
          width: 31,
          height: 8
        })

        currentRects = [
          makeDomRect({ left: 35, top: 55, width: 25, height: 10 })
        ]

        dispatchLivePenDragMove(viewerRoot, { clientX: 60, clientY: 65 })

        blocks = getOverlayBlocks(page)
        expect(blocks).toHaveLength(1)
        expectPathCoversRect(blocks[0], {
          left: 10,
          top: 20,
          width: 31,
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
        dispatchLivePenDragStart(text, { clientX: 15, clientY: 25 })

        dispatchLivePenDragMove(viewerRoot, { clientX: 45, clientY: 33 })

        const initialBlock = getOverlayBlocks(page)[0]
        expectPathCoversRect(initialBlock, {
          left: 10,
          top: 20,
          width: 31,
          height: 8
        })

        dispatchLivePenDragEnd(viewerRoot, 'pointercancel', {
          clientX: 65,
          clientY: 87
        })

        currentRects = [
          makeDomRect({ left: 45, top: 75, width: 20, height: 12 })
        ]

        dispatchLivePenDragMove(viewerRoot, { clientX: 65, clientY: 87 })

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

    it('draws html-parser overlay with viewer-root-relative coordinates', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      const parserHtml =
        '<div class="hamster-note-page"><p>Parsed page text</p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue(parserHtml)

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      await screen.findByText('Parsed page text')
      const page = globalThis.document.querySelector(
        '.hamster-reader__html-parser-output .hamster-note-page'
      ) as HTMLElement
      const text = page.querySelector('p')?.firstChild
      if (!(text instanceof Text)) {
        throw new TypeError('Expected html-parser page to contain real text')
      }
      expect(page.querySelector('[data-text-id]')).toBeNull()

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      expect(viewerRoot.querySelector('[data-text-id]')).toBeNull()
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
      const slotPage = screen.getByTestId('intermediate-page-1')
      const slotRectSpy = vi
        .spyOn(slotPage, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 140, top: 260, width: 300, height: 400 })
        )
      const elementFromPointSpy = mockElementFromPoint(page)
      const range = globalThis.document.createRange()
      range.selectNodeContents(text)
      const mockClientRects = [
        makeDomRect({ left: 150, top: 280, width: 45, height: 12 })
      ] as unknown as DOMRectList
      Object.defineProperty(range, 'getClientRects', {
        value: () => mockClientRects,
        configurable: true,
        writable: true
      })
      Object.defineProperty(range, 'cloneRange', {
        value: () => {
          const cloned = globalThis.document.createRange()
          cloned.selectNodeContents(text)
          Object.defineProperty(cloned, 'getClientRects', {
            value: () => mockClientRects,
            configurable: true,
            writable: true
          })
          Object.defineProperty(cloned, 'getBoundingClientRect', {
            value: () =>
              makeDomRect({ left: 150, top: 280, width: 45, height: 12 }),
            configurable: true,
            writable: true
          })
          return cloned
        },
        configurable: true,
        writable: true
      })
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
        getRangeAt: vi.fn(() => range)
      } as unknown as Selection)

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        const rootOverlaySvgs = Array.from(overlay.children).filter((element) =>
          element.classList.contains('hamster-reader__selection-overlay-svg')
        )
        expect(rootOverlaySvgs).toHaveLength(1)
        expect(
          page.querySelector('.hamster-reader__selection-overlay-svg')
        ).toBeNull()

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
        range.detach()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
        slotRectSpy.mockRestore()
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
      const dispatchPenPointerEvent = (
        target: HTMLElement,
        type: 'pointerdown' | 'pointermove' | 'pointerup',
        point: { clientX: number; clientY: number }
      ) => {
        const event = new MouseEvent(type, {
          bubbles: true,
          button: 0,
          clientX: point.clientX,
          clientY: point.clientY
        })
        Object.defineProperty(event, 'pointerId', {
          configurable: true,
          value: 1
        })
        Object.defineProperty(event, 'pointerType', {
          configurable: true,
          value: 'pen'
        })
        target.dispatchEvent(event)
      }

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))
        expect(getOverlayBlocks(page)).toHaveLength(1)

        dispatchPenPointerEvent(text, 'pointerdown', {
          clientX: 15,
          clientY: 25
        })
        dispatchPenPointerEvent(viewerRoot, 'pointermove', {
          clientX: 45,
          clientY: 33
        })
        dispatchPenPointerEvent(viewerRoot, 'pointerup', {
          clientX: 45,
          clientY: 33
        })
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

  describe('saved selection overlay', () => {
    let originalGetClientRects: (() => DOMRectList) | undefined
    let originalGetBoundingClientRect: (() => DOMRect) | undefined

    const makeMutableSelection = (initialRange: Range) => {
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
        addRange: ReturnType<typeof vi.fn>
        removeAllRanges: ReturnType<typeof vi.fn>
      }

      return {
        selection,
        get activeRange() {
          return activeRange
        }
      }
    }

    const installSavedSelectionCaret = (node: Node, offset: number) => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        globalThis.document,
        'caretPositionFromPoint'
      )
      Object.defineProperty(globalThis.document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({ offsetNode: node, offset }))
      })

      return () => {
        if (originalDescriptor) {
          Object.defineProperty(
            globalThis.document,
            'caretPositionFromPoint',
            originalDescriptor
          )
        } else {
          Reflect.deleteProperty(globalThis.document, 'caretPositionFromPoint')
        }
      }
    }

    const dragSavedHandle = (
      handle: HTMLElement,
      point: { clientX: number; clientY: number }
    ) => {
      handle.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: false,
          cancelable: true,
          button: 0,
          clientX: 15,
          clientY: 25
        })
      )
      handle.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: false,
          cancelable: true,
          button: 0,
          clientX: point.clientX,
          clientY: point.clientY
        })
      )
      handle.dispatchEvent(
        new MouseEvent('pointerup', {
          bubbles: false,
          cancelable: true,
          button: 0,
          clientX: point.clientX,
          clientY: point.clientY
        })
      )
    }

    beforeEach(() => {
      originalGetClientRects = Range.prototype
        .getClientRects as () => DOMRectList
      originalGetBoundingClientRect = Range.prototype
        .getBoundingClientRect as () => DOMRect

      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: vi.fn(() => [
          makeDomRect({ left: 10, top: 20, width: 30, height: 8 })
        ])
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(() =>
          makeDomRect({ left: 10, top: 20, width: 30, height: 8 })
        )
      })
    })

    afterEach(() => {
      if (originalGetClientRects !== undefined) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: originalGetClientRects
        })
      }
      if (originalGetBoundingClientRect !== undefined) {
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
          configurable: true,
          value: originalGetBoundingClientRect
        })
      }
    })

    it('renders saved selection overlay paths in html-parser mode using visual fallback', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(
        '<div class="hamster-note-page">Parsed page text</div>'
      )

      const savedSelection = makeSavedSelection({
        id: 'saved-1',
        fallbackOnly: true,
        visualRects: [{ pageNumber: 1, x: 10, y: 20, width: 40, height: 12 }]
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
        />
      )

      const viewerRoot = await screen.findByTestId(
        'intermediate-document-viewer'
      )
      const savedOverlay = viewerRoot.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement

      await waitFor(() => {
        const path = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        )
        expect(path).toBeInTheDocument()
      })

      const path = savedOverlay.querySelector(
        '.hamster-reader__saved-selection-overlay-path'
      ) as SVGPathElement
      expect(path).toHaveAttribute('data-saved-selection-id', 'saved-1')
      expect(path).toHaveClass(
        'hamster-reader__saved-selection-overlay-path--fallback'
      )
    })

    it('renders saved selection overlay paths in direct-render mode', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })

      const savedSelection = makeSavedSelection({
        id: 'saved-direct-1',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 0,
        endCharIndex: 6
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const savedOverlay = page.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement

      await waitFor(() => {
        const path = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        )
        expect(path).toBeInTheDocument()
      })

      const path = savedOverlay.querySelector(
        '.hamster-reader__saved-selection-overlay-path'
      ) as SVGPathElement
      expect(path).toHaveAttribute('data-saved-selection-id', 'saved-direct-1')
      expect(path).not.toHaveClass(
        'hamster-reader__saved-selection-overlay-path--fallback'
      )
    })

    it('keeps visual fallback saved overlays on their saved page while scrolling', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 3 })

      const savedSelection = makeSavedSelection({
        id: 'saved-direct-page-3',
        fallbackOnly: true,
        visualRects: [{ pageNumber: 3, x: 10, y: 20, width: 40, height: 12 }]
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
        />
      )

      const page1 = screen.getByTestId('intermediate-page-1')
      const page3 = screen.getByTestId('intermediate-page-3')
      const page1Overlay = page1.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement
      const page3Overlay = page3.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement

      await waitFor(() => {
        expect(
          page3Overlay.querySelector(
            '.hamster-reader__saved-selection-overlay-path'
          )
        ).toBeInTheDocument()
      })

      expect(
        page1Overlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        )
      ).not.toBeInTheDocument()

      const path = page3Overlay.querySelector(
        '.hamster-reader__saved-selection-overlay-path'
      ) as SVGPathElement
      expect(path).toHaveAttribute(
        'data-saved-selection-id',
        'saved-direct-page-3'
      )
      expect(path).toHaveClass(
        'hamster-reader__saved-selection-overlay-path--fallback'
      )
      const initialPathData = path.getAttribute('d')

      act(() => {
        globalThis.document.dispatchEvent(new Event('scroll'))
      })

      await waitFor(() => {
        expect(
          (
            page3Overlay.querySelector(
              '.hamster-reader__saved-selection-overlay-path'
            ) as SVGPathElement
          ).getAttribute('d')
        ).toBe(initialPathData)
      })
    })

    it('escapes saved selection ids before writing SVG overlay innerHTML', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onActiveSavedSelectionChange = vi.fn()
      const maliciousId = 'bad" onmouseover="alert(1)<script>'

      const savedSelection = makeSavedSelection({
        id: maliciousId,
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 0,
        endCharIndex: 6
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const localElementFromPointSpy = mockElementFromPoint(page)
      const savedOverlay = page.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement

      try {
        await waitFor(() => {
          const paths = savedOverlay.querySelectorAll(
            '.hamster-reader__saved-selection-overlay-path'
          )
          expect(paths).toHaveLength(1)
        })

        const [path] = Array.from(
          savedOverlay.querySelectorAll(
            '.hamster-reader__saved-selection-overlay-path'
          )
        ) as SVGPathElement[]

        expect(path).toHaveAttribute('data-saved-selection-id', maliciousId)
        expect(path).not.toHaveAttribute('onmouseover')
        expect(savedOverlay.querySelector('script')).not.toBeInTheDocument()

        path.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 15, clientY: 25 })
        )

        await waitFor(() => {
          expect(onActiveSavedSelectionChange).toHaveBeenCalledWith(maliciousId)
        })
      } finally {
        localElementFromPointSpy.mockRestore()
      }
    })

    it('activates a saved selection when its overlay path is clicked', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onActiveSavedSelectionChange = vi.fn()

      const savedSelection = makeSavedSelection({
        id: 'saved-active-1',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 0,
        endCharIndex: 6
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const localElementFromPointSpy = mockElementFromPoint(page)
      const savedOverlay = page.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement

      try {
        await waitFor(() => {
          const path = savedOverlay.querySelector(
            '.hamster-reader__saved-selection-overlay-path'
          )
          expect(path).toBeInTheDocument()
        })

        const path = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        ) as SVGPathElement

        path.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 15, clientY: 25 })
        )

        await waitFor(() => {
          expect(onActiveSavedSelectionChange).toHaveBeenCalledWith(
            'saved-active-1'
          )
        })

        const activePath = savedOverlay.querySelector(
          '[data-saved-selection-id="saved-active-1"]'
        ) as SVGPathElement
        expect(activePath).toHaveClass(
          'hamster-reader__saved-selection-overlay-path--active'
        )

        // Task 4: 激活的已保存选择应渲染 start/end 两个端点手柄。
        const { start, end, all } = getSavedHandles(page)
        expect(all).toHaveLength(2)
        expect(start).toBeInTheDocument()
        expect(end).toBeInTheDocument()
      } finally {
        localElementFromPointSpy.mockRestore()
      }
    })

    it('clears live selection handles when activating a saved selection', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const savedSelection = makeSavedSelection({
        id: 'saved-exclusive-1',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 5,
        endCharIndex: 11
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const textNode = getRequiredTextNode(text)
      mockElementRect(page, { left: 0, top: 0, width: 100, height: 150 })
      mockElementRect(text, { left: 10, top: 20, width: 70, height: 12 })
      const localElementFromPointSpy = mockElementFromPoint(text)

      const liveRange = globalThis.document.createRange()
      liveRange.setStart(textNode, 0)
      liveRange.setEnd(textNode, 4)
      const liveSelection = makeMutableSelection(liveRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))

        await waitFor(() => {
          expect(
            page.querySelectorAll(
              '.hamster-reader__selection-handles .hamster-reader__selection-handle'
            )
          ).toHaveLength(2)
        })

        const savedOverlay = page.querySelector(
          '.hamster-reader__saved-selection-overlay'
        ) as HTMLElement
        await waitFor(() => {
          expect(
            savedOverlay.querySelector(
              '[data-saved-selection-id="saved-exclusive-1"]'
            )
          ).toBeInTheDocument()
        })
        const path = savedOverlay.querySelector(
          '[data-saved-selection-id="saved-exclusive-1"]'
        ) as SVGPathElement
        path.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 15, clientY: 25 })
        )

        await waitFor(() => {
          expect(getSavedHandles(page).all).toHaveLength(2)
        })
        expect(
          page.querySelectorAll('.hamster-reader__selection-handle')
        ).toHaveLength(2)
        expect(liveSelection.selection.removeAllRanges).toHaveBeenCalledTimes(1)
      } finally {
        getSelectionSpy.mockRestore()
        localElementFromPointSpy.mockRestore()
      }
    })

    it('only allows one saved selection to be active at a time', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })

      const first = makeSavedSelection({
        id: 'saved-first',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 0,
        endCharIndex: 4
      })
      const second = makeSavedSelection({
        id: 'saved-second',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 5,
        endCharIndex: 8
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[first, second]}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const localElementFromPointSpy = mockElementFromPoint(page)
      const savedOverlay = page.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement

      try {
        await waitFor(() => {
          const paths = savedOverlay.querySelectorAll(
            '.hamster-reader__saved-selection-overlay-path'
          )
          expect(paths).toHaveLength(2)
        })

        const paths = Array.from(
          savedOverlay.querySelectorAll(
            '.hamster-reader__saved-selection-overlay-path'
          )
        ) as SVGPathElement[]

        paths[0].dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 15, clientY: 25 })
        )

        await waitFor(() => {
          const firstPath = savedOverlay.querySelector(
            '[data-saved-selection-id="saved-first"]'
          )
          expect(firstPath).toHaveClass(
            'hamster-reader__saved-selection-overlay-path--active'
          )
        })

        // Task 4: 第一个选择激活后应渲染其 start/end 手柄。
        const firstHandles = getSavedHandles(page)
        expect(firstHandles.all).toHaveLength(2)
        expect(firstHandles.start).toBeInTheDocument()
        expect(firstHandles.end).toBeInTheDocument()

        const secondPathAfterFirstClick = savedOverlay.querySelector(
          '[data-saved-selection-id="saved-second"]'
        ) as SVGPathElement
        secondPathAfterFirstClick.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 35, clientY: 25 })
        )

        await waitFor(() => {
          const secondPath = savedOverlay.querySelector(
            '[data-saved-selection-id="saved-second"]'
          )
          expect(secondPath).toHaveClass(
            'hamster-reader__saved-selection-overlay-path--active'
          )
          const firstPath = savedOverlay.querySelector(
            '[data-saved-selection-id="saved-first"]'
          )
          expect(firstPath).not.toHaveClass(
            'hamster-reader__saved-selection-overlay-path--active'
          )
        })

        // Task 4: 切换到第二个选择后，第一个选择的手柄应被移除，第二个选择的手柄应出现。
        const secondHandles = getSavedHandles(page)
        expect(secondHandles.all).toHaveLength(2)
        expect(secondHandles.start).toBeInTheDocument()
        expect(secondHandles.end).toBeInTheDocument()
      } finally {
        localElementFromPointSpy.mockRestore()
      }
    })

    it('clears active saved selection when clicking blank viewer area', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onActiveSavedSelectionChange = vi.fn()
      const removeAllRanges = vi.fn()
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
        removeAllRanges
      } as unknown as Selection)

      const savedSelection = makeSavedSelection({
        id: 'saved-clear-1',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 0,
        endCharIndex: 6
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const localElementFromPointSpy = mockElementFromPoint(page)
      const savedOverlay = page.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement

      try {
        await waitFor(() => {
          const path = savedOverlay.querySelector(
            '.hamster-reader__saved-selection-overlay-path'
          )
          expect(path).toBeInTheDocument()
        })

        const path = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        ) as SVGPathElement
        path.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 15, clientY: 25 })
        )

        await waitFor(() => {
          const activePath = savedOverlay.querySelector(
            '[data-saved-selection-id="saved-clear-1"]'
          )
          expect(activePath).toHaveClass(
            'hamster-reader__saved-selection-overlay-path--active'
          )
        })

        // Task 4: 激活后应存在 start/end 两个已保存手柄。
        expect(getSavedHandles(page).all).toHaveLength(2)

        page.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })
        )

        await waitFor(() => {
          const inactivePath = savedOverlay.querySelector(
            '[data-saved-selection-id="saved-clear-1"]'
          )
          expect(inactivePath).not.toHaveClass(
            'hamster-reader__saved-selection-overlay-path--active'
          )
        })
        expect(onActiveSavedSelectionChange).toHaveBeenLastCalledWith(null)

        // Task 4: 取消激活后已保存手柄应被清空。
        expect(getSavedHandles(page).all).toHaveLength(0)
      } finally {
        localElementFromPointSpy.mockRestore()
        getSelectionSpy.mockRestore()
      }
    })

    it('activates visual-fallback saved selection on click and keeps it handle-free', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onActiveSavedSelectionChange = vi.fn()
      const onSavedSelectionEdit = vi.fn()

      const savedSelection = makeSavedSelection({
        id: 'saved-fallback-readonly',
        fallbackOnly: true,
        visualRects: [{ pageNumber: 1, x: 10, y: 20, width: 40, height: 12 }]
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
          onSavedSelectionEdit={onSavedSelectionEdit}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      // 使用局部 const 声明 spy，避免泄漏到共享作用域。
      const localElementFromPointSpy = mockElementFromPoint(page)
      try {
        const savedOverlay = page.querySelector(
          '.hamster-reader__saved-selection-overlay'
        ) as HTMLElement

        await waitFor(() => {
          const path = savedOverlay.querySelector(
            '.hamster-reader__saved-selection-overlay-path'
          )
          expect(path).toBeInTheDocument()
        })

        const path = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        ) as SVGPathElement
        expect(path).toHaveClass(
          'hamster-reader__saved-selection-overlay-path--fallback'
        )

        expect(getSavedHandles(page).all).toHaveLength(0)

        path.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            clientX: 15,
            clientY: 25
          })
        )

        await waitFor(() => {
          expect(onActiveSavedSelectionChange).toHaveBeenCalledWith(
            'saved-fallback-readonly'
          )
        })
        expect(onSavedSelectionEdit).not.toHaveBeenCalled()

        // 内部通过 innerHTML 重建 SVG，旧 path 引用已失效，需要重新查询。
        await waitFor(() => {
          const refreshedPath = savedOverlay.querySelector(
            '[data-saved-selection-id="saved-fallback-readonly"]'
          )
          expect(refreshedPath).toHaveClass(
            'hamster-reader__saved-selection-overlay-path--active'
          )
        })
        expect(getSavedHandles(page).all).toHaveLength(0)
      } finally {
        localElementFromPointSpy.mockRestore()
      }
    })

    it('activates visual-fallback saved selection in html-parser mode without rendering handles', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(
        '<div class="hamster-note-page">Parsed page text</div>'
      )
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue(
        '<div class="hamster-note-page">Parsed page text</div>'
      )

      const onActiveSavedSelectionChange = vi.fn()
      const savedSelection = makeSavedSelection({
        id: 'saved-fallback-html-parser',
        fallbackOnly: true,
        visualRects: [{ pageNumber: 1, x: 10, y: 20, width: 40, height: 12 }]
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          savedSelections={[savedSelection]}
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
        />
      )

      const viewerRoot = await screen.findByTestId(
        'intermediate-document-viewer'
      )
      const savedOverlay = Array.from(
        viewerRoot.querySelectorAll('.hamster-reader__saved-selection-overlay')
      ).find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          !element.closest('.hamster-reader__intermediate-page')
      )
      if (!savedOverlay) {
        throw new Error('Expected root saved selection overlay')
      }

      await waitFor(() => {
        const path = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        )
        expect(path).toBeInTheDocument()
      })

      const path = savedOverlay.querySelector(
        '.hamster-reader__saved-selection-overlay-path'
      ) as SVGPathElement
      expect(path).toHaveClass(
        'hamster-reader__saved-selection-overlay-path--fallback'
      )

      expect(getSavedHandles(viewerRoot).all).toHaveLength(0)

      path.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 15, clientY: 25 })
      )

      await waitFor(() => {
        expect(onActiveSavedSelectionChange).toHaveBeenCalledWith(
          'saved-fallback-html-parser'
        )
      })

      expect(getSavedHandles(viewerRoot).all).toHaveLength(0)
    })

    it('keeps unresolved saved selection inert in html-parser mode', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(
        '<div class="hamster-note-page">Parsed page text</div>'
      )

      const onActiveSavedSelectionChange = vi.fn()
      const savedSelection = makeSavedSelection({
        id: 'saved-unresolved-html-parser',
        textId: 'nonexistent-text-id',
        content: 'Nonexistent content',
        startCharIndex: 0,
        endCharIndex: 19
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          selectionOverlay
          savedSelections={[savedSelection]}
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
        />
      )

      expect(onActiveSavedSelectionChange).not.toHaveBeenCalled()
    })

    it('renders edit handles for resolved saved selection in html-parser mode when active', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(
        '<div class="hamster-note-page">Parsed page text</div>'
      )

      const onActiveSavedSelectionChange = vi.fn()
      const savedSelection = makeSavedSelection({
        id: 'saved-resolved-html-parser',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 0,
        endCharIndex: 6
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          activeSavedSelectionId='saved-resolved-html-parser'
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
          selectionHandleElement={<button type='button' />}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const localElementFromPointSpy = mockElementFromPoint(page)

      try {
        await waitFor(() => {
          expect(getSavedHandles(page).all).toHaveLength(2)
        })
        const { start, end } = getSavedHandles(page)
        expect(start).toBeInTheDocument()
        expect(end).toBeInTheDocument()
      } finally {
        localElementFromPointSpy.mockRestore()
      }
    })

    it('edits an active saved selection from its start handle once on commit', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onSavedSelectionEdit = vi.fn()
      const savedSelection = makeSavedSelection({
        id: 'saved-edit-start',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 5,
        endCharIndex: 11
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          activeSavedSelectionId='saved-edit-start'
          onSavedSelectionEdit={onSavedSelectionEdit}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const textNode = getRequiredTextNode(text)
      mockElementRect(page, { left: 0, top: 0, width: 100, height: 150 })
      mockElementRect(text, { left: 10, top: 20, width: 70, height: 12 })
      const localElementFromPointSpy = mockElementFromPoint(text)

      await waitFor(() => {
        expect(getSavedHandles(page).all).toHaveLength(2)
      })
      await act(async () => {
        await Promise.resolve()
      })

      const initialRange = globalThis.document.createRange()
      initialRange.setStart(textNode, 0)
      initialRange.collapse(true)
      const liveSelection = makeMutableSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaret = installSavedSelectionCaret(textNode, 0)

      try {
        const startHandle = getSavedHandles(page).start
        if (!(startHandle instanceof HTMLElement)) {
          throw new Error('Expected saved start handle')
        }

        startHandle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: false,
            cancelable: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )
        startHandle.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: false,
            cancelable: true,
            button: 0,
            clientX: 12,
            clientY: 24
          })
        )
        expect(onSavedSelectionEdit).not.toHaveBeenCalled()
        startHandle.dispatchEvent(
          new MouseEvent('pointerup', {
            bubbles: false,
            cancelable: true,
            button: 0,
            clientX: 12,
            clientY: 24
          })
        )

        expect(onSavedSelectionEdit).toHaveBeenCalledTimes(1)
        const [id, nextSelection, detail] = onSavedSelectionEdit.mock.calls[0]
        expect(id).toBe('saved-edit-start')
        expect(nextSelection.id).toBe('saved-edit-start')
        expect(nextSelection.version).toBe(1)
        expect(nextSelection.start.charIndex).toBe(0)
        expect(nextSelection.end.charIndex).toBe(11)
        expect(nextSelection.text).toBe('Page 1 text')
        expect(nextSelection.segments[0]).toMatchObject({
          startCharIndex: 0,
          endCharIndex: 11,
          selectedText: 'Page 1 text'
        })
        expect(nextSelection.visual[0].rects.length).toBeGreaterThan(0)
        expect(detail).toMatchObject({
          id: 'saved-edit-start',
          selection: nextSelection,
          previousSelection: savedSelection,
          status: 'resolved',
          extractedText: 'Page 1 text'
        })
      } finally {
        restoreCaret()
        getSelectionSpy.mockRestore()
        localElementFromPointSpy.mockRestore()
      }
    })

    it('keeps saved handle drag active across internal selectionchange refreshes', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onSavedSelectionEdit = vi.fn()
      const onActiveSavedSelectionChange = vi.fn()
      const savedSelection = makeSavedSelection({
        id: 'saved-edit-selectionchange',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 5,
        endCharIndex: 11
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
          onSavedSelectionEdit={onSavedSelectionEdit}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const textNode = getRequiredTextNode(text)
      mockElementRect(page, { left: 0, top: 0, width: 100, height: 150 })
      mockElementRect(text, { left: 10, top: 20, width: 70, height: 12 })
      const localElementFromPointSpy = mockElementFromPoint(text)

      const savedOverlay = page.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement
      await waitFor(() => {
        expect(
          savedOverlay.querySelector(
            '[data-saved-selection-id="saved-edit-selectionchange"]'
          )
        ).toBeInTheDocument()
      })

      const path = savedOverlay.querySelector(
        '[data-saved-selection-id="saved-edit-selectionchange"]'
      ) as SVGPathElement
      path.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 15, clientY: 25 })
      )

      await waitFor(() => {
        expect(getSavedHandles(page).all).toHaveLength(2)
      })

      const initialRange = globalThis.document.createRange()
      initialRange.setStart(textNode, 0)
      initialRange.collapse(true)
      const liveSelection = makeMutableSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaret = installSavedSelectionCaret(textNode, 0)

      try {
        const startHandle = getSavedHandles(page).start
        if (!(startHandle instanceof HTMLElement)) {
          throw new Error('Expected saved start handle')
        }

        startHandle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: false,
            cancelable: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )
        globalThis.document.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 12,
            clientY: 24
          })
        )
        globalThis.document.dispatchEvent(new Event('selectionchange'))
        await act(async () => {
          await Promise.resolve()
        })
        globalThis.document.dispatchEvent(
          new MouseEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 12,
            clientY: 24
          })
        )

        expect(onActiveSavedSelectionChange).not.toHaveBeenCalledWith(null)
        expect(onSavedSelectionEdit).toHaveBeenCalledTimes(1)
        const [, nextSelection] = onSavedSelectionEdit.mock.calls[0]
        expect(nextSelection.start.charIndex).toBe(0)
        expect(nextSelection.end.charIndex).toBe(11)
        expect(
          savedOverlay.querySelector(
            '[data-saved-selection-id="saved-edit-selectionchange"]'
          )
        ).toHaveClass('hamster-reader__saved-selection-overlay-path--active')
      } finally {
        restoreCaret()
        getSelectionSpy.mockRestore()
        localElementFromPointSpy.mockRestore()
      }
    })

    it('edits an active saved selection from its end handle independently', async () => {
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onSavedSelectionEdit = vi.fn()
      const savedSelection = makeSavedSelection({
        id: 'saved-edit-end',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 0,
        endCharIndex: 4
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          activeSavedSelectionId='saved-edit-end'
          onSavedSelectionEdit={onSavedSelectionEdit}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const textNode = getRequiredTextNode(text)
      mockElementRect(page, { left: 0, top: 0, width: 100, height: 150 })
      mockElementRect(text, { left: 10, top: 20, width: 70, height: 12 })
      const localElementFromPointSpy = mockElementFromPoint(text)

      await waitFor(() => {
        expect(getSavedHandles(page).all).toHaveLength(2)
      })
      await act(async () => {
        await Promise.resolve()
      })

      const initialRange = globalThis.document.createRange()
      initialRange.setStart(textNode, 0)
      initialRange.collapse(true)
      const liveSelection = makeMutableSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaret = installSavedSelectionCaret(textNode, 6)

      try {
        const endHandle = getSavedHandles(page).end
        if (!(endHandle instanceof HTMLElement)) {
          throw new Error('Expected saved end handle')
        }

        dragSavedHandle(endHandle, { clientX: 48, clientY: 24 })

        expect(onSavedSelectionEdit).toHaveBeenCalledTimes(1)
        const [id, nextSelection, detail] = onSavedSelectionEdit.mock.calls[0]
        expect(id).toBe('saved-edit-end')
        expect(nextSelection.id).toBe('saved-edit-end')
        expect(nextSelection.start.charIndex).toBe(0)
        expect(nextSelection.end.charIndex).toBe(6)
        expect(nextSelection.text).toBe('Page 1')
        expect(nextSelection.segments[0]).toMatchObject({
          startCharIndex: 0,
          endCharIndex: 6,
          selectedText: 'Page 1'
        })
        expect(detail.segments[0]).toMatchObject({
          startCharIndex: 0,
          endCharIndex: 6,
          selectedText: 'Page 1'
        })
      } finally {
        restoreCaret()
        getSelectionSpy.mockRestore()
        localElementFromPointSpy.mockRestore()
      }
    })

    // Task 5: pan/zoom transform 后 saved overlay/handle 刷新验证
    describe('saved selection overlay transform refresh', () => {
      it('rebuilds html-parser saved overlay SVG on pan-only transform', async () => {
        const { document: mockDoc } = makeDocument({ pageCount: 1 })
        vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(
          '<div class="hamster-note-page">Parsed page text</div>'
        )
        vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue(
          '<div class="hamster-note-page">Parsed page text</div>'
        )

        const savedSelection = makeSavedSelection({
          id: 'saved-pan-html',
          fallbackOnly: true,
          visualRects: [{ pageNumber: 1, x: 10, y: 20, width: 40, height: 12 }]
        })

        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            selectionOverlay
            savedSelections={[savedSelection]}
          />
        )

        const viewerRoot = await screen.findByTestId(
          'intermediate-document-viewer'
        )
        const savedOverlay = Array.from(
          viewerRoot.querySelectorAll(
            '.hamster-reader__saved-selection-overlay'
          )
        ).find(
          (el): el is HTMLElement =>
            el instanceof HTMLElement &&
            !el.closest('.hamster-reader__intermediate-page')
        )
        if (!savedOverlay) throw new Error('Expected root saved overlay')

        await waitFor(() => {
          expect(
            savedOverlay.querySelector(
              '.hamster-reader__saved-selection-overlay-path'
            )
          ).toBeInTheDocument()
        })

        const initialPath = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        ) as SVGPathElement

        await act(async () => {
          VirtualPaper.__triggerTransform(
            screen.getByTestId('virtual-paper-container'),
            { x: 50, y: 60, scale: 1 }
          )
        })

        // render-only refresh 重建 SVG（innerHTML 替换），旧 path 节点应脱离文档
        await waitFor(() => {
          expect(savedOverlay.contains(initialPath)).toBe(false)
        })

        const refreshedPath = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        ) as SVGPathElement
        expect(refreshedPath).toHaveAttribute(
          'data-saved-selection-id',
          'saved-pan-html'
        )
      })

      it('rebuilds html-parser saved overlay SVG on zoom-only transform', async () => {
        const { document: mockDoc } = makeDocument({ pageCount: 1 })
        vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(
          '<div class="hamster-note-page">Parsed page text</div>'
        )
        vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue(
          '<div class="hamster-note-page">Parsed page text</div>'
        )

        const savedSelection = makeSavedSelection({
          id: 'saved-zoom-html',
          fallbackOnly: true,
          visualRects: [{ pageNumber: 1, x: 10, y: 20, width: 40, height: 12 }]
        })

        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            selectionOverlay
            savedSelections={[savedSelection]}
          />
        )

        const viewerRoot = await screen.findByTestId(
          'intermediate-document-viewer'
        )
        const savedOverlay = Array.from(
          viewerRoot.querySelectorAll(
            '.hamster-reader__saved-selection-overlay'
          )
        ).find(
          (el): el is HTMLElement =>
            el instanceof HTMLElement &&
            !el.closest('.hamster-reader__intermediate-page')
        )
        if (!savedOverlay) throw new Error('Expected root saved overlay')

        await waitFor(() => {
          expect(
            savedOverlay.querySelector(
              '.hamster-reader__saved-selection-overlay-path'
            )
          ).toBeInTheDocument()
        })

        const initialPath = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        ) as SVGPathElement

        await act(async () => {
          VirtualPaper.__triggerTransform(
            screen.getByTestId('virtual-paper-container'),
            { x: 0, y: 0, scale: 2 }
          )
        })

        await waitFor(() => {
          expect(savedOverlay.contains(initialPath)).toBe(false)
        })
      })

      it('rebuilds html-parser saved overlay SVG on zoom+pan transform', async () => {
        const { document: mockDoc } = makeDocument({ pageCount: 1 })
        vi.mocked(HtmlParser.decodeToHtml).mockResolvedValue(
          '<div class="hamster-note-page">Parsed page text</div>'
        )
        vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValue(
          '<div class="hamster-note-page">Parsed page text</div>'
        )

        const savedSelection = makeSavedSelection({
          id: 'saved-zoompan-html',
          fallbackOnly: true,
          visualRects: [{ pageNumber: 1, x: 10, y: 20, width: 40, height: 12 }]
        })

        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            selectionOverlay
            savedSelections={[savedSelection]}
          />
        )

        const viewerRoot = await screen.findByTestId(
          'intermediate-document-viewer'
        )
        const savedOverlay = Array.from(
          viewerRoot.querySelectorAll(
            '.hamster-reader__saved-selection-overlay'
          )
        ).find(
          (el): el is HTMLElement =>
            el instanceof HTMLElement &&
            !el.closest('.hamster-reader__intermediate-page')
        )
        if (!savedOverlay) throw new Error('Expected root saved overlay')

        await waitFor(() => {
          expect(
            savedOverlay.querySelector(
              '.hamster-reader__saved-selection-overlay-path'
            )
          ).toBeInTheDocument()
        })

        const initialPath = savedOverlay.querySelector(
          '.hamster-reader__saved-selection-overlay-path'
        ) as SVGPathElement

        await act(async () => {
          VirtualPaper.__triggerTransform(
            screen.getByTestId('virtual-paper-container'),
            { x: 30, y: 40, scale: 1.5 }
          )
        })

        await waitFor(() => {
          expect(savedOverlay.contains(initialPath)).toBe(false)
        })
      })

      it('keeps direct-render saved overlay path stable on pan-only transform', async () => {
        const { document: mockDoc } = makeDocument({ pageCount: 1 })

        const savedSelection = makeSavedSelection({
          id: 'saved-pan-direct',
          fallbackOnly: true,
          visualRects: [{ pageNumber: 1, x: 10, y: 20, width: 40, height: 12 }]
        })

        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            renderMode='direct'
            selectionOverlay
            savedSelections={[savedSelection]}
          />
        )

        await waitFor(() => {
          expect(screen.getByText('Page 1 text')).toBeInTheDocument()
        })

        const page = screen.getByTestId('intermediate-page-1')
        const savedOverlay = page.querySelector(
          '.hamster-reader__saved-selection-overlay'
        ) as HTMLElement

        await waitFor(() => {
          expect(
            savedOverlay.querySelector(
              '.hamster-reader__saved-selection-overlay-path'
            )
          ).toBeInTheDocument()
        })

        const getPathD = () =>
          (
            savedOverlay.querySelector(
              '.hamster-reader__saved-selection-overlay-path'
            ) as SVGPathElement
          ).getAttribute('d') || ''

        const initialD = getPathD()
        expect(initialD).toBeTruthy()

        await act(async () => {
          VirtualPaper.__triggerTransform(
            screen.getByTestId('virtual-paper-container'),
            { x: 50, y: 60, scale: 1 }
          )
        })

        // direct-render: page-relative 坐标不随 pan 变化（CSS transform 自动带动覆盖层）
        await waitFor(() => {
          expect(getPathD()).toBe(initialD)
        })
      })

      it('refreshes saved handles on pan-only transform', async () => {
        const { document: mockDoc } = makeDocument({ pageCount: 1 })

        const savedSelection = makeSavedSelection({
          id: 'saved-handle-pan',
          textId: 'text-1',
          content: 'Page 1 text',
          startCharIndex: 0,
          endCharIndex: 6
        })

        render(
          <IntermediateDocumentViewer
            document={mockDoc}
            renderMode='direct'
            selectionOverlay
            savedSelections={[savedSelection]}
            activeSavedSelectionId='saved-handle-pan'
          />
        )

        const viewerRoot = await screen.findByTestId(
          'intermediate-document-viewer'
        )
        const page = screen.getByTestId('intermediate-page-1')
        const localElementFromPointSpy = mockElementFromPoint(page)

        try {
          // 初始 mock：page 在原点
          mockElementRect(page, {
            left: 0,
            top: 0,
            width: 100,
            height: 150
          })

          await waitFor(() => {
            expect(getSavedHandles(viewerRoot).all).toHaveLength(2)
          })

          const getStartHandleLeft = () => {
            const handles = getSavedHandles(viewerRoot)
            const start = handles.start as HTMLElement | null
            return start?.style.left ?? ''
          }

          const initialLeft = getStartHandleLeft()

          // 模拟 pan 后 page 位置变化
          mockElementRect(page, {
            left: 100,
            top: 100,
            width: 100,
            height: 150
          })

          await act(async () => {
            VirtualPaper.__triggerTransform(
              screen.getByTestId('virtual-paper-container'),
              { x: 100, y: 100, scale: 1 }
            )
          })

          // pan 后 refreshSavedSelectionHandles 重算手柄位置，pageRect 变化导致
          // page-relative 坐标变化，handle left 应改变
          await waitFor(() => {
            expect(getStartHandleLeft()).not.toBe(initialLeft)
          })

          const { start, end } = getSavedHandles(viewerRoot)
          expect(start).toBeInTheDocument()
          expect(end).toBeInTheDocument()
        } finally {
          localElementFromPointSpy.mockRestore()
        }
      })
    })

    // Task 6 — saved handle drag preview before commit
    it('updates saved overlay preview path during drag before onSavedSelectionEdit commit', async () => {
      // 验证 renderSavedSelectionEditPreview 在 commit（pointerup）前
      // 实时更新 saved overlay 预览 — 通过 DOM 节点替换检测和 path data 变化
      const { document: mockDoc } = makeDocument({ pageCount: 1 })
      const onSavedSelectionEdit = vi.fn()
      const savedSelection = makeSavedSelection({
        id: 'saved-preview-drag',
        textId: 'text-1',
        content: 'Page 1 text',
        startCharIndex: 5,
        endCharIndex: 11
      })

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
          savedSelections={[savedSelection]}
          activeSavedSelectionId='saved-preview-drag'
          onSavedSelectionEdit={onSavedSelectionEdit}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Page 1 text')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const text = screen.getByText('Page 1 text')
      const textNode = getRequiredTextNode(text)
      mockElementRect(page, { left: 0, top: 0, width: 100, height: 150 })
      mockElementRect(text, { left: 10, top: 20, width: 70, height: 12 })
      const localElementFromPointSpy = mockElementFromPoint(text)

      const savedOverlay = page.querySelector(
        '.hamster-reader__saved-selection-overlay'
      ) as HTMLElement

      await waitFor(() => {
        expect(
          savedOverlay.querySelector(
            '[data-saved-selection-id="saved-preview-drag"]'
          )
        ).toBeInTheDocument()
      })

      // 记录初始 path DOM 节点引用 — renderSavedSelectionEditPreview 通过
      // innerHTML 重建 SVG，旧 path 节点会脱离文档
      const getSavedPath = () =>
        savedOverlay.querySelector(
          '[data-saved-selection-id="saved-preview-drag"]'
        ) as SVGPathElement | null

      const initialPath = getSavedPath()
      expect(initialPath).toBeTruthy()
      const initialPathD = initialPath?.getAttribute('d') || ''
      expect(initialPathD).toBeTruthy()

      await waitFor(() => {
        expect(getSavedHandles(page).all).toHaveLength(2)
      })
      await act(async () => {
        await Promise.resolve()
      })

      // 重写 Range.getClientRects 使拖拽后的 rect 与初始不同
      // beforeEach 设置的 mock 固定返回 {10,20,30,8}
      // 拖拽后将选区扩展到从 charIndex 0 开始，rect 扩大
      const overrideGetClientRects = vi.fn(() => [
        makeDomRect({ left: 10, top: 20, width: 70, height: 12 })
      ])
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: overrideGetClientRects
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(() =>
          makeDomRect({ left: 10, top: 20, width: 70, height: 12 })
        )
      })

      const initialRange = globalThis.document.createRange()
      initialRange.setStart(textNode, 0)
      initialRange.collapse(true)
      const liveSelection = makeMutableSelection(initialRange)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(liveSelection.selection)
      const restoreCaret = installSavedSelectionCaret(textNode, 0)

      try {
        const startHandle = getSavedHandles(page).start
        if (!(startHandle instanceof HTMLElement)) {
          throw new Error('Expected saved start handle')
        }

        // pointerdown — 开始拖拽
        startHandle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: false,
            cancelable: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )

        // pointermove — 拖拽中，尚未 commit
        // renderSavedSelectionEditPreview 应在此刻重建 saved overlay 预览
        startHandle.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: false,
            cancelable: true,
            button: 0,
            clientX: 12,
            clientY: 24
          })
        )

        // 关键断言 1：commit 前 saved overlay 预览已重建
        // renderSavedSelectionEditPreview 通过 innerHTML 重建，
        // 旧 path 节点应脱离文档（与新 T5 测试相同的检测方式）
        await waitFor(() => {
          expect(savedOverlay.contains(initialPath)).toBe(false)
        })

        // 关键断言 2：新 path 的 d 应与初始不同（rect 从 {10,20,30,8} 扩大为 {10,20,70,12}）
        const previewPath = getSavedPath()
        expect(previewPath).toBeTruthy()
        const previewPathD = previewPath?.getAttribute('d') || ''
        expect(previewPathD).not.toBe(initialPathD)

        // commit 前不应调用 onSavedSelectionEdit
        expect(onSavedSelectionEdit).not.toHaveBeenCalled()

        // pointerup — commit
        startHandle.dispatchEvent(
          new MouseEvent('pointerup', {
            bubbles: false,
            cancelable: true,
            button: 0,
            clientX: 12,
            clientY: 24
          })
        )

        expect(onSavedSelectionEdit).toHaveBeenCalledTimes(1)
        const [, nextSelection] = onSavedSelectionEdit.mock.calls[0]
        expect(nextSelection.start.charIndex).toBe(0)
      } finally {
        restoreCaret()
        getSelectionSpy.mockRestore()
        localElementFromPointSpy.mockRestore()
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

      render(
        <IntermediateDocumentViewer
          document={mockDoc}
          renderMode='direct'
          selectionOverlay
        />
      )

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

      const parserHtml =
        '<div class="hamster-note-page"><p>Selectable HTML text</p></div>'
      vi.mocked(HtmlParser.decodeToHtml).mockResolvedValueOnce(parserHtml)
      vi.mocked(HtmlParser.decodePageToHtml).mockResolvedValueOnce(parserHtml)
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

    it('selection under scale renders handle anchors in page-relative CSS pixels', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      render(
        <IntermediateDocumentViewer
          document={document}
          scale={2}
          selectionOverlay
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
      })

      const page = screen.getByTestId('intermediate-page-1')
      const pageRectSpy = mockElementRect(page, {
        left: 5,
        top: 5,
        width: 200,
        height: 300
      })
      const elementFromPointSpy = mockElementFromPoint(page)
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(
          makeSelectionWithRects(() => [
            makeDomRect({ left: 25, top: 25, width: 30, height: 8 })
          ])
        )

      globalThis.document.dispatchEvent(new Event('selectionchange'))

      await waitFor(() => {
        expect(
          page.querySelectorAll('.hamster-reader__selection-handle')
        ).toHaveLength(2)
      })

      const startHandle = page.querySelector(
        '[data-handle-type="start"]'
      ) as HTMLElement
      const endHandle = page.querySelector(
        '[data-handle-type="end"]'
      ) as HTMLElement

      expect(startHandle).toHaveStyle({ left: '10px', top: '14px' })
      expect(endHandle).toHaveStyle({ left: '25px', top: '14px' })

      getSelectionSpy.mockRestore()
      elementFromPointSpy.mockRestore()
      pageRectSpy.mockRestore()
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

// Task 2 — Regression tests for the line+circle default selection handle
// visual. These tests pin the contract that the renderer must keep emitting:
//   • the wrapper class `hamster-reader__selection-handle--default` (so the
//     pseudo-element CSS in reader.scss still applies),
//   • the base class with the `--start`/`--end` modifier (so the CSS variant
//     selector `.hamster-reader__selection-handle--default.hamster-reader__selection-handle--start`
//     still matches and the wrapper still positions the line/circle correctly),
//   • the `data-handle-type` attribute (so the drag adapter lookup via
//     `[data-handle-type]` keeps working).
// They also pin the endpoint-centered circle offsets in reader.scss so the
// 8px circle center, not its edge, lands on the 2px line endpoint.
describe('default selection handle (line+circle visual)', () => {
  // Always-present rect mock so both start- and end-collapsed clones of the
  // mocked Range return a non-empty geometry for handle position lookup.
  const handleRects = [makeDomRect({ left: 15, top: 25, width: 30, height: 8 })]

  // Render the viewer with the default (undefined selectionHandleElement)
  // handle, install a mocked Selection that produces a non-collapsed range,
  // and wait until both start and end handles have been appended to the
  // first page. Returns the page element + a cleanup hook.
  const renderDefaultHandleFixture = async () => {
    const { document } = makeDocument({ pageCount: 1 })
    render(<IntermediateDocumentViewer document={document} selectionOverlay />)
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
      .mockReturnValue(makeSelectionWithRects(() => handleRects))

    globalThis.document.dispatchEvent(new Event('selectionchange'))
    await waitFor(() => {
      expect(
        page.querySelectorAll('.hamster-reader__selection-handle')
      ).toHaveLength(2)
    })

    return {
      page,
      cleanup: () => {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
        pageRectSpy.mockRestore()
      }
    }
  }

  it('emits stable default-handle class names with --default and --{type} modifiers', async () => {
    const { page, cleanup } = await renderDefaultHandleFixture()
    try {
      const [startHandle, endHandle] = Array.from(
        page.querySelectorAll('.hamster-reader__selection-handle')
      ) as HTMLElement[]

      // Default wrapper marker that pseudo-element CSS hooks into.
      expect(startHandle).toHaveClass(
        'hamster-reader__selection-handle--default'
      )
      expect(endHandle).toHaveClass('hamster-reader__selection-handle--default')

      // Side modifiers used by the compound CSS selector for line/circle
      // positioning. Both classes must be present on the same element.
      expect(startHandle).toHaveClass('hamster-reader__selection-handle--start')
      expect(endHandle).toHaveClass('hamster-reader__selection-handle--end')

      // Legacy per-side default class — historically attached and asserted on
      // by adapter probes; keep stable to avoid silent contract drift.
      expect(startHandle).toHaveClass(
        'hamster-reader__selection-handle--default-start'
      )
      expect(endHandle).toHaveClass(
        'hamster-reader__selection-handle--default-end'
      )
    } finally {
      cleanup()
    }
  })

  it('exposes data-handle-type on default handles so adapter lookup still works', async () => {
    const { page, cleanup } = await renderDefaultHandleFixture()
    try {
      const startHandle = page.querySelector('[data-handle-type="start"]')
      const endHandle = page.querySelector('[data-handle-type="end"]')
      expect(startHandle).toBeInstanceOf(HTMLElement)
      expect(endHandle).toBeInstanceOf(HTMLElement)
      // The default wrapper is a plain <div>, not a cloned custom element.
      expect(startHandle?.tagName).toBe('DIV')
      expect(endHandle?.tagName).toBe('DIV')
    } finally {
      cleanup()
    }
  })

  it('positions default handles using the boundary anchor coordinates', async () => {
    const { page, cleanup } = await renderDefaultHandleFixture()
    try {
      // Anchor formula: x = boundary.{left|right} - page.left,
      //                  y = boundary.bottom - page.top.
      // boundary rect = {left:15, top:25, width:30, height:8}; page offset
      // = (5, 5). So start anchor = (15-5, 33-5) = (10, 28) and end anchor
      // = ((15+30)-5, 33-5) = (40, 28).
      const startHandle = page.querySelector(
        '[data-handle-type="start"]'
      ) as HTMLElement
      const endHandle = page.querySelector(
        '[data-handle-type="end"]'
      ) as HTMLElement
      expect(startHandle).toHaveStyle({ left: '10px', top: '28px' })
      expect(endHandle).toHaveStyle({ left: '40px', top: '28px' })
    } finally {
      cleanup()
    }
  })

  it('centers default handle circles on the line endpoints in SCSS', () => {
    const scssSource = fs.readFileSync(
      path.resolve(__dirname, '../src/styles/reader.scss'),
      'utf-8'
    )

    // Start circle center sits on the line's upper endpoint: 8px diameter
    // means radius 4px, so the circle top must be 4px above endpoint y=0.
    expect(scssSource).toMatch(
      /&\.hamster-reader__selection-handle--start[\s\S]*?right:\s*-3px;[\s\S]*?top:\s*-4px;/
    )

    // End circle center sits on the line's lower endpoint: mirror the same
    // 4px radius below the wrapper/line bottom.
    expect(scssSource).toMatch(
      /&\.hamster-reader__selection-handle--end[\s\S]*?left:\s*-3px;[\s\S]*?bottom:\s*-4px;/
    )
  })

  it('moves start handle wrapper above-left of anchor (translate -100%, -100%) while end handle stays right-above (translate 0, -100%)', () => {
    const scssSource = fs.readFileSync(
      path.resolve(__dirname, '../src/styles/reader.scss'),
      'utf-8'
    )

    // Start handle uses translate(-100%, -100%) in both the base
    // `.hamster-reader__selection-handle--start` and the default compound
    // override so the wrapper sits above-left of the anchor.
    const startBaseMatches = scssSource.match(
      /&--start\s*\{\s*transform:\s*translate\(-100%,\s*-100%\);/g
    )
    expect(startBaseMatches).toHaveLength(1)

    const startDefaultMatches = scssSource.match(
      /&\.hamster-reader__selection-handle--start\s*\{\s*transform:\s*translate\(-100%,\s*-100%\);/g
    )
    expect(startDefaultMatches).toHaveLength(1)

    // End handle must remain unchanged: translate(0, -100%) in both base
    // and default compound override.
    const endBaseMatches = scssSource.match(
      /&--end\s*\{\s*transform:\s*translate\(0,\s*-100%\);/g
    )
    expect(endBaseMatches).toHaveLength(1)

    const endDefaultMatches = scssSource.match(
      /&\.hamster-reader__selection-handle--end\s*\{\s*transform:\s*translate\(0,\s*-100%\);/g
    )
    expect(endDefaultMatches).toHaveLength(1)
  })

  it('keeps default handle wrapper hit-target attributes intact for the drag adapter', async () => {
    const { page, cleanup } = await renderDefaultHandleFixture()
    try {
      const startHandle = page.querySelector(
        '[data-handle-type="start"]'
      ) as HTMLElement
      const endHandle = page.querySelector(
        '[data-handle-type="end"]'
      ) as HTMLElement

      // The wrapper must stay pointer-events:auto so the drag adapter's
      // pointerdown listener (attached at viewer root and filtered via
      // `[data-handle-type]` closest()) actually captures touches on the
      // default visual. The pseudo-element ::before/::after children draw
      // the line+circle but inherit pointer-events:none in the new CSS.
      expect(startHandle.style.pointerEvents).toBe('auto')
      expect(endHandle.style.pointerEvents).toBe('auto')

      // Adapter relies on closest('[data-handle-type]') from the pointer
      // target; the wrapper itself owns that attribute (not a child node),
      // so a pointerdown anywhere inside the 18×24px hit area finds it.
      expect(startHandle.closest('[data-handle-type]')).toBe(startHandle)
      expect(endHandle.closest('[data-handle-type]')).toBe(endHandle)
    } finally {
      cleanup()
    }
  })

  // —— T4: 4px circular endpoint handles with preserved hit targets ——
  // These tests lock the contract that:
  //   • the default handle element carries `data-selection-handle-scope` so the
  //     drag adapter can distinguish live vs saved handle scopes,
  //   • the renderer sets `--hamster-reader-selection-handle-width` /
  //     `--hamster-reader-selection-handle-height` CSS custom properties on the
  //     default wrapper, driving the transparent hit-target size from SCSS,
  //   • the SCSS `::before` pseudo-element is an 8px diameter circle
  //     (`width: 8px; height: 8px; border-radius: 50%`, i.e. r=4px),
  //   • the SCSS wrapper hit target dimensions are driven by those CSS
  //     variables (with px fallbacks),
  //   • a custom `selectionHandleElement` does NOT receive the default visual
  //     wrapper internals (`--default` class, CSS custom properties).

  it('exposes data-selection-handle-scope on default handles for live scope', async () => {
    const { page, cleanup } = await renderDefaultHandleFixture()
    try {
      // 默认手柄渲染时 scope='live'，data-selection-handle-scope 必须存在
      // 以便拖拽适配器区分实时选区与已保存选区的手柄。
      const startHandle = page.querySelector(
        '[data-handle-type="start"]'
      ) as HTMLElement
      const endHandle = page.querySelector(
        '[data-handle-type="end"]'
      ) as HTMLElement
      expect(startHandle).toHaveAttribute('data-selection-handle-scope', 'live')
      expect(endHandle).toHaveAttribute('data-selection-handle-scope', 'live')
    } finally {
      cleanup()
    }
  })

  it('sets --hamster-reader-selection-handle-width/height CSS custom properties on default handles', async () => {
    const { page, cleanup } = await renderDefaultHandleFixture()
    try {
      // 默认手柄的触控区域尺寸由 CSS 自定义属性驱动；
      // 渲染器必须将 hitAreaWidth / hitAreaHeight 写入 inline style。
      // handleRects 的 height=8 → hitAreaWidth=4, hitAreaHeight=8
      const startHandle = page.querySelector(
        '[data-handle-type="start"]'
      ) as HTMLElement
      const endHandle = page.querySelector(
        '[data-handle-type="end"]'
      ) as HTMLElement

      expect(
        startHandle.style.getPropertyValue(
          '--hamster-reader-selection-handle-width'
        )
      ).not.toBe('')
      expect(
        startHandle.style.getPropertyValue(
          '--hamster-reader-selection-handle-height'
        )
      ).not.toBe('')

      expect(
        endHandle.style.getPropertyValue(
          '--hamster-reader-selection-handle-width'
        )
      ).not.toBe('')
      expect(
        endHandle.style.getPropertyValue(
          '--hamster-reader-selection-handle-height'
        )
      ).not.toBe('')
    } finally {
      cleanup()
    }
  })

  it('SCSS ::before pseudo-element is an 8px diameter circle (r=4px, border-radius 50%)', () => {
    const scssSource = fs.readFileSync(
      path.resolve(__dirname, '../src/styles/reader.scss'),
      'utf-8'
    )

    // --default 块内的 ::before 定义了圆形视觉元素：
    // width: 8px; height: 8px; border-radius: 50% → 直径 8px，半径 4px
    // 全文件仅此一处 ::before 包含 width/height/border-radius
    expect(scssSource).toMatch(
      /&__selection-handle--default\s*\{[\s\S]*?&::before\s*\{[\s\S]*?width:\s*8px;[\s\S]*?height:\s*8px;[\s\S]*?border-radius:\s*50%;/
    )
  })

  it('SCSS default handle wrapper hit-target is driven by CSS custom properties', () => {
    const scssSource = fs.readFileSync(
      path.resolve(__dirname, '../src/styles/reader.scss'),
      'utf-8'
    )

    // 默认手柄 wrapper 的宽高必须引用 CSS 变量，带 px 回退值
    // --hamster-reader-selection-handle-width / --hamster-reader-selection-handle-height
    expect(scssSource).toMatch(
      /&__selection-handle--default\s*\{[\s\S]*?width:\s*var\(--hamster-reader-selection-handle-width,\s*18px\)/
    )
    expect(scssSource).toMatch(
      /&__selection-handle--default\s*\{[\s\S]*?height:\s*var\(--hamster-reader-selection-handle-height,\s*24px\)/
    )
  })

  it('custom selectionHandleElement does not receive default visual wrapper internals', async () => {
    // 自定义手柄不应获得 --default 类名或 CSS 自定义属性；
    // 这些是默认视觉 wrapper 的内部实现细节。
    const { document } = makeDocument({ pageCount: 1 })
    const handleRects = [
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
      .mockReturnValue(makeSelectionWithRects(() => handleRects))

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

      // 自定义手柄不应有 --default 类（那是默认视觉 wrapper 的标记）
      expect(startHandle).not.toHaveClass(
        'hamster-reader__selection-handle--default'
      )
      expect(endHandle).not.toHaveClass(
        'hamster-reader__selection-handle--default'
      )

      // 自定义手柄不应有 --default-start / --default-end 类
      expect(startHandle).not.toHaveClass(
        'hamster-reader__selection-handle--default-start'
      )
      expect(endHandle).not.toHaveClass(
        'hamster-reader__selection-handle--default-end'
      )

      // 自定义手柄不应接收默认 wrapper 的 CSS 自定义属性
      expect(
        startHandle.style.getPropertyValue(
          '--hamster-reader-selection-handle-width'
        )
      ).toBe('')
      expect(
        startHandle.style.getPropertyValue(
          '--hamster-reader-selection-handle-height'
        )
      ).toBe('')
      expect(
        endHandle.style.getPropertyValue(
          '--hamster-reader-selection-handle-width'
        )
      ).toBe('')
      expect(
        endHandle.style.getPropertyValue(
          '--hamster-reader-selection-handle-height'
        )
      ).toBe('')

      // 自定义手柄仍应保留拖拽适配器所需的数据属性
      expect(startHandle).toHaveAttribute('data-handle-type', 'start')
      expect(endHandle).toHaveAttribute('data-handle-type', 'end')
      expect(startHandle).toHaveAttribute('data-selection-handle-scope', 'live')
      expect(endHandle).toHaveAttribute('data-selection-handle-scope', 'live')
    } finally {
      getSelectionSpy.mockRestore()
      elementFromPointSpy.mockRestore()
      pageRectSpy.mockRestore()
    }
  })
})
