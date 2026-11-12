// HAM-89 / tasks.md 3.1/3.4/3.5：PdfDocumentViewer 接线契约（jsdom）。
// 官方 viewer 模块用可控 fake（jsdom 无 canvas，无法真实渲染页）；
// 文档解析走真实 pdfjs-dist（fake worker），验证：
// - PDFViewer/EventBus/PDFLinkService 构造参数（annotationEditorMode NONE，
//   内置标注不进存储通道）；
// - textlayerrendered → span 三件套注入；
// - confirmSelection → onHighlight 公开 range（page-N + canonical offset）；
// - 打开失败保留已渲染标注；切文件竞态只落地最后一份文档。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mockPaintingCanvas } from '../fixtures/painting'
import { act, fireEvent, render } from '@testing-library/react'
import { createRef, StrictMode } from 'react'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntermediatePage, TextDir } from '@hamster-note/types'
import { PDFDocument } from 'pdf-lib'
import { ImageParser } from '@hamster-note/image-parser'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { parseHighlights } from '../../demo/highlightStorage'

vi.mock('@hamster-note/image-parser', () => ({
  ImageParser: { encode: vi.fn() }
}))

import type { ReaderSelectionRange } from '../../src/types/selection'
import type {
  PdfDocumentViewerProps,
  PdfDocumentViewerRef
} from '../../src/pdf/PdfDocumentViewer'

type StubViewport = {
  scale: number
  transform: [number, number, number, number, number, number]
  width: number
  height: number
  convertToPdfPoint: (x: number, y: number) => number[]
  convertToViewportPoint: (x: number, y: number) => number[]
}

type FakePageView = {
  div: HTMLElement
  viewport: StubViewport
  pdfPage: { getViewport: (options: { scale: number }) => StubViewport }
}

type FakeViewerInstance = {
  options: Record<string, unknown>
  eventBus: {
    on: (name: string, listener: (payload: unknown) => void) => void
    off: (name: string, listener: (payload: unknown) => void) => void
    dispatch: (name: string, payload?: unknown) => void
  }
  document: unknown
  currentScale: number
  currentPageNumber: number
  pagesCount: number
  setDocument: (doc: { numPages: number } | null) => void
  scrollPageIntoView: (options: {
    pageNumber: number
    destArray?: unknown[]
  }) => void
  getPageView: (index: number) => FakePageView | undefined
}

const hoisted = vi.hoisted(() => {
  const viewerInstances: FakeViewerInstance[] = []
  const linkServiceInstances: unknown[] = []
  return { viewerInstances, linkServiceInstances }
})

vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => {
  const makeStubViewport = (
    scale: number,
    width = 400,
    height = 300
  ): StubViewport => ({
    scale,
    transform: [scale, 0, 0, -scale, 0, height * scale],
    width: width * scale,
    height: height * scale,
    convertToPdfPoint: (x: number, y: number) => [
      x / scale,
      height - y / scale
    ],
    convertToViewportPoint: (x: number, y: number) => [
      x * scale,
      (height - y) * scale
    ]
  })

  class FakeEventBus {
    private listeners = new Map<string, Set<(payload: unknown) => void>>()
    on(name: string, listener: (payload: unknown) => void) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set())
      this.listeners.get(name)!.add(listener)
    }
    off(name: string, listener: (payload: unknown) => void) {
      this.listeners.get(name)?.delete(listener)
    }
    dispatch(name: string, payload?: unknown) {
      for (const listener of this.listeners.get(name) ?? []) listener(payload)
    }
  }

  class FakePDFLinkService {
    setViewer() {}
    setDocument() {}
    constructor() {
      hoisted.linkServiceInstances.push(this)
    }
  }

  class FakePDFViewer implements FakeViewerInstance {
    readonly options: Record<string, unknown>
    readonly eventBus: FakeEventBus
    document: unknown = null
    currentScale = 1
    private pageNumber = 1
    get currentPageNumber() {
      return this.pageNumber
    }
    set currentPageNumber(value: number) {
      this.pageNumber = value
      const container = this.options.container as HTMLElement
      container.scrollTop = (value - 1) * 320
    }
    pagesCount = 0
    private pageViews: FakePageView[] = []

    constructor(options: Record<string, unknown>) {
      this.options = options
      this.eventBus = options.eventBus as FakeEventBus
      hoisted.viewerInstances.push(this)
    }

    setDocument(document: { numPages: number } | null) {
      this.document = document
      this.pageViews = []
      if (!document) {
        this.pagesCount = 0
        return
      }
      this.pagesCount = document.numPages
      const viewerElement = (this.options.viewer ?? null) as HTMLElement | null
      for (let index = 0; index < document.numPages; index++) {
        const pageDiv = globalThis.document.createElement('div')
        pageDiv.className = 'page'
        viewerElement?.appendChild(pageDiv)
        this.pageViews.push({
          div: pageDiv,
          viewport: makeStubViewport(this.currentScale),
          pdfPage: {
            getViewport: ({ scale }: { scale: number }) =>
              makeStubViewport(scale)
          }
        })
      }
      this.eventBus.dispatch('pagesinit')
      this.eventBus.dispatch('pagesloaded')
    }

    getPageView(index: number): FakePageView | undefined {
      return this.pageViews[index]
    }
    scrollPageIntoView({
      pageNumber,
      destArray
    }: {
      pageNumber: number
      destArray?: unknown[]
    }) {
      this.currentPageNumber = pageNumber
      const container = this.options.container as HTMLElement
      const point = destArray
        ? this.pageViews[pageNumber - 1]!.viewport.convertToViewportPoint(
            Number(destArray[2]),
            Number(destArray[3])
          )
        : [0, 0]
      container.scrollTop = (pageNumber - 1) * 320 + point[1]!
      container.scrollLeft = point[0]!
    }
    update() {}
  }

  return {
    EventBus: FakeEventBus,
    PDFLinkService: FakePDFLinkService,
    PDFViewer: FakePDFViewer
  }
})

import { PdfDocumentViewer } from '../../src/pdf/PdfDocumentViewer'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')
const readFixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXTURE_ROOT, name)))

// Measured page/character geometry; jsdom itself has no layout.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const container = this.closest(
        '.hamster-reader__pdf-viewer-container'
      ) as HTMLElement | null
      const scroll = container?.scrollTop ?? 0
      if (this.classList.contains('hamster-reader__pdf-viewer-container'))
        return new DOMRect(0, 0, 400, 200)
      const page = this.closest('.page')
      const pageIndex = page
        ? Array.from(page.parentElement!.children).indexOf(page)
        : 0
      if (page) return new DOMRect(0, pageIndex * 320 - scroll, 400, 300)
      return new DOMRect()
    }
  )
  if (!Range.prototype.getClientRects)
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      writable: true,
      value: () => []
    })
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (
    this: Range
  ) {
    const element = this.startContainer.parentElement
    const box = element?.getBoundingClientRect() ?? new DOMRect()
    return [
      new DOMRect(box.left + this.startOffset * 5, box.top + 20, 5, 12)
    ] as unknown as DOMRectList
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
})

afterEach(() => {
  vi.restoreAllMocks()
  hoisted.viewerInstances.splice(0)
  hoisted.linkServiceInstances.splice(0)
})

const renderViewer = (
  props: Partial<PdfDocumentViewerProps>,
  ref: RefObject<PdfDocumentViewerRef | null>
) => {
  const view = render(
    <PdfDocumentViewer
      source={{ data: readFixture('pdf/two-column.pdf') }}
      {...props}
      ref={ref}
    />
  )
  const container = view.container.querySelector(
    '.hamster-reader__pdf-viewer-container'
  ) as HTMLElement
  container.getBoundingClientRect = () => new DOMRect(0, 0, 400, 250)
  return view
}

const latestViewer = (): FakeViewerInstance => {
  const viewer = hoisted.viewerInstances[hoisted.viewerInstances.length - 1]
  expect(viewer).toBeDefined()
  return viewer
}

/** 模拟官方 viewer 完成某页 text layer 渲染。 */
const emitTextLayer = (pageNumber: number, texts: readonly string[]) => {
  const viewer = latestViewer()
  const pageView = viewer.getPageView(pageNumber - 1)!
  const textLayerDiv = document.createElement('div')
  textLayerDiv.className = 'textLayer'
  for (const text of texts) {
    const span = document.createElement('span')
    span.textContent = text
    textLayerDiv.appendChild(span)
  }
  pageView.div.appendChild(textLayerDiv)
  act(() => {
    viewer.eventBus.dispatch('textlayerrendered', {
      pageNumber,
      source: { div: pageView.div }
    })
  })
  return textLayerDiv
}

it.each(['pagerendered', 'textlayerrendered'] as const)(
  'review: ignores a late %s extraction failure from the previous PDF',
  async (event) => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({}, ref)
    await act(async () => {})
    const viewer = latestViewer()
    const oldDocument = viewer.document as PDFDocumentProxy
    const oldPages = Array.from(view.container.querySelectorAll('.page'))
    let rejectOld!: (error: Error) => void
    const extraction = new Promise<never>((_, reject) => {
      rejectOld = reject
    })
    const spy = vi.spyOn(oldDocument, 'getPage').mockReturnValueOnce(extraction)
    act(() => {
      if (event === 'pagerendered')
        viewer.eventBus.dispatch(event, { pageNumber: 1 })
      else emitTextLayer(1, ['First page'])
    })
    spy.mockRestore()
    view.rerender(
      <PdfDocumentViewer
        source={{ data: readFixture('pdf/two-column.pdf') }}
        ref={ref}
      />
    )
    await act(async () => {})
    expect(latestViewer()).toBe(viewer)
    expect(viewer.document).not.toBe(oldDocument)
    oldPages.forEach((page) => page.remove())
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {})
    expect(ref.current!.captureReadingPosition().status).toBe('ready')
    await act(async () => {
      rejectOld(new Error('old worker destroyed'))
    })
    expect(ref.current!.captureReadingPosition().status).toBe('ready')
  }
)

it('review merge: a text bookmark offscreen to the right becomes visible', async () => {
  const ref = createRef<PdfDocumentViewerRef>()
  const view = renderViewer({}, ref)
  await act(async () => {})
  emitTextLayer(1, ['Left column line one', 'Left column line two'])
  await act(async () => {})
  const container = view.container.querySelector(
    '.hamster-reader__pdf-viewer-container'
  ) as HTMLElement
  container.scrollLeft = 300
  const page = latestViewer().getPageView(0)!
  page.div.getBoundingClientRect = () =>
    new DOMRect(-container.scrollLeft, -container.scrollTop, 800, 300)
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (
    this: Range
  ) {
    return [
      new DOMRect(600 - container.scrollLeft, 120 - container.scrollTop, 5, 12)
    ] as unknown as DOMRectList
  })
  await act(async () => {
    await ref.current!.scrollToAnchor(
      { pageNumber: 1, textId: 'page-1-item-0', text: 'Left', offset: 0 },
      { preserveOnFailure: true }
    )
  })
  expect(600 - container.scrollLeft).toBeGreaterThanOrEqual(0)
  expect(600 - container.scrollLeft).toBeLessThan(400)
})

it.each(['bookmark', 'highlight', 'zoomed bookmark'] as const)(
  'horizontal text navigation: %s remains in the safe viewport after reopening',
  async (navigation) => {
    const ref = createRef<PdfDocumentViewerRef>()
    const props = {
      readingInsets: { top: 40, bottom: 20, horizontal: 24 },
      ranges: [
        {
          id: 'right-column',
          text: 'column',
          start: { selectionId: 'page-1', offset: 5 },
          end: { selectionId: 'page-1', offset: 11 },
          createdAt: 1735689701000,
          rectsBySelectionId: {}
        }
      ]
    }
    const scale = navigation === 'zoomed bookmark' ? 2 : 1
    // Measured geometry follows scrolling on both mounts; x=600 on an
    // 800px page is outside the 400px viewport before seeking.
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (
      this: Range
    ) {
      const box = this.startContainer
        .parentElement!.closest('.page')!
        .getBoundingClientRect()
      return [
        new DOMRect(
          box.left + (600 + (this.startOffset - 5) * 10) * scale,
          box.top + 120 * scale,
          5,
          12
        )
      ] as unknown as DOMRectList
    })
    const prepare = async () => {
      const view = renderViewer(props, ref)
      await act(async () => {})
      const container = view.container.querySelector(
        '.hamster-reader__pdf-viewer-container'
      ) as HTMLElement
      const page = latestViewer().getPageView(0)!
      act(() => ref.current!.setScale(scale))
      page.viewport = {
        ...page.viewport,
        scale,
        width: 800 * scale,
        height: 300 * scale,
        convertToPdfPoint: (x, y) => [x / scale, 300 - y / scale],
        convertToViewportPoint: (x, y) => [x * scale, (300 - y) * scale]
      }
      page.div.getBoundingClientRect = () =>
        new DOMRect(
          -container.scrollLeft,
          -container.scrollTop,
          800 * scale,
          300 * scale
        )
      emitTextLayer(1, ['Left column line one', 'Left column line two'])
      await act(async () => {})
      return { view, container }
    }
    const expectVisible = (container: HTMLElement) => {
      const left = 600 * scale - container.scrollLeft
      expect(left).toBeGreaterThanOrEqual(24)
      expect(left + 5).toBeLessThanOrEqual(400 - 24)
      expect(120 * scale - container.scrollTop).toBeCloseTo(40, 8)
    }
    const anchor = {
      pageNumber: 1,
      textId: navigation === 'highlight' ? '' : 'page-1-item-0',
      text: 'column',
      offset: 5
    }
    const initial = await prepare()
    await act(async () => {
      if (navigation === 'highlight') ref.current!.scrollToRange('right-column')
      else
        await ref.current!.scrollToAnchor(anchor, { preserveOnFailure: true })
    })
    expectVisible(initial.container)
    const saved = ref.current!.captureModeSwitchPosition!()
    expect(saved).toMatchObject({
      status: 'ready',
      position: { pageNumber: 1, offset: anchor.offset }
    })
    expect(ref.current!.captureTextAnchor()).toEqual(anchor)
    if (saved.status !== 'ready') throw new Error('Expected stable position')
    initial.view.unmount()
    const reopened = await prepare()
    await act(async () => {
      await ref.current!.scrollToAnchor(saved.position)
    })
    expectVisible(reopened.container)
    expect(ref.current!.captureModeSwitchPosition!()).toEqual(saved)
  }
)

describe('PdfDocumentViewer 接线', () => {
  it('explicit touch updates and copy keep native Selection empty after reactivation', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({}, ref)
    await act(async () => {})
    const layer = emitTextLayer(1, [
      'Left column line one',
      'Left column line two'
    ])
    await act(async () => {})
    const range = document.createRange()
    range.setStart(layer.children[0].firstChild!, 0)
    range.setEnd(layer.children[0].firstChild!, 4)
    act(() => ref.current!.setSelectionRange(range, true))
    const native = document.getSelection()!
    native.addRange(range.cloneRange())
    fireEvent(document, new Event('selectionchange'))
    expect(native.rangeCount).toBe(0)
    expect(ref.current!.serializeSelection()?.text).toBe('Left')
    // Even a lost DOM flag cannot send an explicit touch preview through addRange.
    delete view.container.querySelector<HTMLElement>(
      '[data-pdf-touch-selection]'
    )!.dataset.pdfTouchSelection
    range.setEnd(layer.children[0].firstChild!, 11)
    act(() => ref.current!.setSelectionRange(range, true))
    const copy = new Event('copy', { bubbles: true, cancelable: true })
    const setData = vi.fn()
    Object.defineProperty(copy, 'clipboardData', { value: { setData } })
    fireEvent(document, copy)
    expect(setData).toHaveBeenCalledWith('text/plain', 'Left column')
    expect(copy.defaultPrevented).toBe(true)
    expect(native.rangeCount).toBe(0)
    const previousCommand = Object.getOwnPropertyDescriptor(
      document,
      'execCommand'
    )
    const command = vi.fn(() => {
      const clipboard = new Event('copy', { bubbles: true, cancelable: true })
      Object.defineProperty(clipboard, 'clipboardData', { value: { setData } })
      fireEvent(document, clipboard)
      return true
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: command
    })
    try {
      fireEvent.keyDown(document, { key: 'c', ctrlKey: true })
      expect(command).toHaveBeenCalledWith('copy')
      expect(setData).toHaveBeenLastCalledWith('text/plain', 'Left column')
      expect(native.rangeCount).toBe(0)
    } finally {
      if (previousCommand)
        Object.defineProperty(document, 'execCommand', previousCommand)
      else Reflect.deleteProperty(document, 'execCommand')
    }
  })

  it.each([
    'select',
    'pan',
    'multitouch',
    'blank',
    'drawing',
    'cancel'
  ] as const)(
    'owns touch long press without native Selection (%s)',
    async (action) => {
      mockPaintingCanvas()
      const ref = createRef<PdfDocumentViewerRef>()
      const onChange = vi.fn(),
        onHighlight = vi.fn()
      const view = renderViewer(
        {
          tool: action === 'drawing' ? 'drawing' : 'text-selection',
          onTextSelectionChange: onChange,
          onHighlight
        },
        ref
      )
      await act(async () => {})
      const layer = emitTextLayer(1, [
        'Left column line one',
        'Left column line two'
      ])
      await act(async () => {})
      const span = layer.querySelector('span')!
      // Give the hit span its own box, rather than the default full-page mock.
      span.getBoundingClientRect = () => new DOMRect(20, 30, 200, 20)
      const caret = document.createRange()
      caret.setStart(span.firstChild!, 7)
      caret.collapse(true)
      const previousElements = Object.getOwnPropertyDescriptor(
        document,
        'elementsFromPoint'
      )
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: () => (action === 'blank' ? [] : [span])
      })
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: () => caret
      })
      vi.useFakeTimers()
      try {
        const down = {
          pointerType: 'touch',
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX: 45,
          clientY: 40
        }
        fireEvent.pointerDown(span, down)
        if (action === 'pan')
          fireEvent.pointerMove(span, { ...down, clientX: 100 })
        if (action === 'multitouch')
          fireEvent.pointerDown(span, { ...down, pointerId: 2 })
        if (action === 'cancel') fireEvent.pointerCancel(span, down)
        act(() => vi.advanceTimersByTime(510))
        if (action === 'select') {
          expect(ref.current!.serializeSelection()).toMatchObject({
            text: 'column',
            start: { selectionId: 'page-1', offset: 5 },
            end: { selectionId: 'page-1', offset: 11 }
          })
          expect(ref.current!.getSelectionRange()?.toString()).toBe('column')
          expect(document.getSelection()!.rangeCount).toBe(0)
          act(() => ref.current!.confirmSelection())
          expect(onHighlight).toHaveBeenCalledOnce()
          expect(onHighlight.mock.calls[0][0].text).toBe('column')
          act(() => ref.current!.clearSelection())
          expect(ref.current!.serializeSelection()).toBeNull()
        } else expect(ref.current!.serializeSelection()).toBeNull()
      } finally {
        view.unmount()
        vi.useRealTimers()
        if (previousElements)
          Object.defineProperty(document, 'elementsFromPoint', previousElements)
        else Reflect.deleteProperty(document, 'elementsFromPoint')
        Reflect.deleteProperty(document, 'caretRangeFromPoint')
      }
    }
  )

  it('keeps disjoint touch groups exact and updates only the dragged source member', async () => {
    const source = { data: readFixture('pdf/two-column.pdf') }
    const ref = createRef<PdfDocumentViewerRef>()
    const ranges: ReaderSelectionRange[] = [
      {
        id: 'first',
        text: 'Left',
        createdAt: 123,
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 4 },
        rectsBySelectionId: {},
        selectionGroup: { id: 'G', index: 0 },
        markerStyle: { backgroundColor: '#c03080' }
      },
      {
        id: 'second',
        text: 'column',
        createdAt: 123,
        start: { selectionId: 'page-1', offset: 25 },
        end: { selectionId: 'page-1', offset: 31 },
        rectsBySelectionId: {},
        selectionGroup: { id: 'G', index: 1 },
        markerStyle: { backgroundColor: '#c03080' }
      }
    ]
    const view = renderViewer({ source, ranges }, ref)
    await act(async () => {})
    const layer = emitTextLayer(1, [
      'Left column line one',
      'Left column line two',
      'Right column line one',
      'Right column line two'
    ])
    await act(async () => {})
    const container = view.container.querySelector<HTMLElement>(
      '.hamster-reader__pdf-viewer-container'
    )!
    container.dataset.pdfTouchSelection = 'true'
    let range!: Range
    act(() => {
      range = ref.current!.selectRange('first')!
    })
    const before = ref.current!.serializeSelection()!
    expect(range, ref.current!.getCanonicalPageText(1)).not.toBeNull()
    expect(before.text).toBe('Leftcolumn')
    expect(before.sourceRanges).toHaveLength(2)
    const edited = range.cloneRange()
    edited.setEnd(layer.children[1].firstChild!, 16)
    act(() => ref.current!.setSelectionRange(edited))
    expect(ref.current!.serializeSelection()!.text).toBe('Leftcolumn line')
    expect(
      ref.current!.serializeRangeEndpoint('second', edited, true)
    ).toMatchObject({
      start: ranges[1].start,
      end: { selectionId: 'page-1', offset: 36 },
      text: 'column line'
    })
    act(() => ref.current!.setSelectionRange(range))
    expect(ref.current!.serializeSelection()!.text).toBe('Leftcolumn')
    expect(ranges[0].markerStyle?.backgroundColor).toBe('#c03080')
    expect(document.getSelection()!.rangeCount).toBe(0)
  })

  it('uses the official XYZ destination with safe insets while retaining the precise restored character', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer(
      {
        readingInsets: { top: 40, bottom: 20, horizontal: 10 },
        viewportTopInset: 40
      },
      ref
    )
    await act(async () => {})
    const viewer = latestViewer()
    const destination = vi.spyOn(viewer, 'scrollPageIntoView')
    // Put the line below the page top so legal scroll clamping permits alignment.
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (
      this: Range
    ) {
      const box = this.startContainer.parentElement!.getBoundingClientRect()
      return [
        new DOMRect(box.left + 20 + this.startOffset * 5, box.top + 120, 5, 12)
      ] as unknown as DOMRectList
    })
    const anchor = {
      pageNumber: 1,
      textId: 'page-1-item-0',
      text: 'column',
      offset: 5
    }
    let restored!: Promise<void>
    act(() => {
      restored = ref.current!.scrollToAnchor(anchor)
    })
    expect(ref.current!.captureReadingPosition()).toEqual({ status: 'pending' })
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {
      await restored
    })
    expect(destination).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pageNumber: 1,
        destArray: expect.arrayContaining([{ name: 'XYZ' }]),
        ignoreDestinationZoom: true,
        allowNegativeOffset: true
      })
    )
    const layer = viewer
      .getPageView(0)!
      .div.querySelector('[data-selection-start-offset]')!
    const character = document.createRange()
    character.setStart(layer.firstChild!, anchor.offset)
    character.setEnd(layer.firstChild!, anchor.offset + 1)
    expect(character.getClientRects()[0]!.top).toBeCloseTo(40, 8) // Insets applied once.
    expect(ref.current!.captureTextAnchor()).toEqual(anchor)
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    container.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    container.scrollTop += 10
    expect(ref.current!.captureTextAnchor()).toMatchObject({ offset: 0 })
  })

  it('preserves the previous position when an explicit bookmark fails, while stored restore can still fall back', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({}, ref)
    await act(async () => {})
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {})
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    container.scrollTop = 80
    await act(async () => {
      await expect(
        ref.current!.scrollToAnchor(
          { pageNumber: 1, textId: 'missing', text: 'missing', offset: 99999 },
          { preserveOnFailure: true }
        )
      ).rejects.toThrow('文字位置无法定位')
    })
    expect(container.scrollTop).toBe(80)
    const capture = ref.current!.captureReadingPosition()
    act(() =>
      latestViewer().eventBus.dispatch('pagerendered', { pageNumber: 1 })
    )
    await act(async () => {})
    expect(ref.current!.captureReadingPosition()).toEqual(capture)
  })

  it('waits for textlayerrendered when an existing context has a temporary zero character rectangle', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({}, ref)
    await act(async () => {})
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {})
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    let measurable = false
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(
      () =>
        [
          new DOMRect(
            20 - container.scrollLeft,
            120 - container.scrollTop,
            measurable ? 5 : 0,
            measurable ? 12 : 0
          )
        ] as unknown as DOMRectList
    )
    const anchor = {
      pageNumber: 1,
      textId: 'page-1-item-0',
      text: 'column',
      offset: 5
    }
    let navigation!: Promise<unknown>
    act(() => {
      navigation = ref
        .current!.scrollToAnchor(anchor, {
          preserveOnFailure: true
        })
        .then(
          () => null,
          (error: unknown) => error
        )
    })
    expect(ref.current!.captureReadingPosition()).toEqual({ status: 'pending' })
    measurable = true
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {
      expect(await navigation).toBeNull()
    })
    expect(container.scrollTop).toBe(120)
    expect(ref.current!.captureTextAnchor()).toEqual(anchor)
  })

  it('times out when a character rectangle never becomes measurable', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({}, ref)
    await act(async () => {})
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {})
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(20, 120, 0, 0)
    ] as unknown as DOMRectList)
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    container.scrollTop = 80
    vi.useFakeTimers()
    try {
      let navigation!: Promise<unknown>
      act(() => {
        navigation = ref
          .current!.scrollToAnchor(
            {
              pageNumber: 1,
              textId: 'page-1-item-0',
              text: 'column',
              offset: 5
            },
            { preserveOnFailure: true }
          )
          .then(
            () => null,
            (error: unknown) => error
          )
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })
      expect(await navigation).toMatchObject({
        message: 'PDF 定位超时，请重试'
      })
      expect(container.scrollTop).toBe(80)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases only the current document preview through PDF.js without changing stable progress', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    renderViewer({}, ref)
    await act(async () => {})
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {})
    const viewer = latestViewer()
    const document = viewer.document as PDFDocumentProxy
    const page = await document.getPage(1)
    const dispatch = vi.spyOn(viewer.eventBus, 'dispatch')
    await act(async () => {
      await ref.current!.scrollToAnchor({
        pageNumber: 1,
        verticalPercentage: 20
      })
    })
    const before = ref.current!.captureReadingPosition()
    expect(before.status).toBe('ready')
    act(() => ref.current!.releasePreviewPage(document, page))
    expect(dispatch).toHaveBeenLastCalledWith('thumbnailrendered', {
      source: viewer,
      pageNumber: 1,
      pdfPage: page
    })
    expect(ref.current!.captureReadingPosition()).toEqual(before)
    dispatch.mockClear()
    act(() => ref.current!.releasePreviewPage({} as PDFDocumentProxy, page))
    expect(dispatch).not.toHaveBeenCalled()
    expect(ref.current!.captureReadingPosition()).toEqual(before)
  })

  it.each([
    'immediate reopen',
    'rotation after crop',
    'close-time recapture'
  ] as const)(
    'preserves the pre-crop page ratio through %s after user scrolling',
    async (operation) => {
      const pdf = await PDFDocument.create()
      pdf.addPage([400, 300])
      pdf.addPage([400, 300])
      const source = { data: await pdf.save() }
      const crop = { pages: { 'page-2': { bottom: 0.05124378204345703 } } }
      const percentage = 42.83582089552239
      const ref = createRef<PdfDocumentViewerRef>()
      const view = renderViewer({ source, edgeCropEditing: true }, ref)
      await act(async () => {})
      let height = 1340.339111328125
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(
        10000
      )
      const measure = () => {
        const container = view.container.querySelector(
          '.hamster-reader__pdf-viewer-container'
        ) as HTMLElement
        container.getBoundingClientRect = () => new DOMRect(0, 114, 400, 200)
        latestViewer().getPageView(1)!.div.getBoundingClientRect = () =>
          new DOMRect(0, 1500 - container.scrollTop, 400, height)
        return container
      }
      let container = measure()
      // Real navigation releases restore protection before entering crop editing.
      act(() =>
        container.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
      )
      container.scrollTop = 1500 + (height * percentage) / 100 - 114
      act(() =>
        latestViewer().eventBus.dispatch('pagerendered', { pageNumber: 2 })
      )
      await act(async () => {})
      expect(ref.current!.captureReadingPosition()).toMatchObject({
        status: 'ready',
        position: { pageNumber: 2, verticalPercentage: percentage }
      })
      // Applying the draft and leaving editing can be separate controlled commits.
      view.rerender(
        <PdfDocumentViewer
          source={source}
          edgeCrop={crop}
          edgeCropEditing
          ref={ref}
        />
      )
      view.rerender(
        <PdfDocumentViewer source={source} edgeCrop={crop} ref={ref} />
      )
      const captured = ref.current!.captureReadingPosition()
      expect(captured.status).toBe('ready')
      if (captured.status !== 'ready')
        throw new Error('Expected stable crop capture')
      if (operation === 'immediate reopen') {
        view.rerender(
          <PdfDocumentViewer
            key='reopen'
            source={source}
            edgeCrop={crop}
            ref={ref}
          />
        )
        await act(async () => {})
        container = measure()
        await act(async () => {
          await ref.current!.scrollToAnchor(captured.position)
          latestViewer().eventBus.dispatch('pagerendered', { pageNumber: 2 })
        })
      } else if (operation === 'rotation after crop') {
        height = 2501.499
        act(() => latestViewer().eventBus.dispatch('rotationchanging'))
        act(() =>
          latestViewer().eventBus.dispatch('pagerendered', { pageNumber: 2 })
        )
        await act(async () => {})
      }
      // This is also the synchronous capture used by the close barrier.
      const final = ref.current!.captureReadingPosition()
      expect(final).toMatchObject({
        status: 'ready',
        position: {
          pageNumber: 2,
          verticalPercentage: expect.closeTo(percentage, 8)
        }
      })
      const rect = latestViewer().getPageView(1)!.div.getBoundingClientRect()
      expect(
        Math.abs(
          rect.top +
            (rect.height * (1 - crop.pages['page-2'].bottom) * percentage) /
              100 -
            114
        )
      ).toBeLessThan(0.000001)
    }
  )

  it('uses the next allowed page at 0% when the safe line crosses a gap', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const source = { data: readFixture('pdf/two-column.pdf') }
    const view = renderViewer(
      { source, readingInsets: { top: 80, bottom: 0, horizontal: 0 } },
      ref
    )
    await act(async () => {})
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    container.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300)
    latestViewer().getPageView(0)!.div.getBoundingClientRect = () =>
      new DOMRect(0, -240, 400, 300)
    latestViewer().getPageView(1)!.div.getBoundingClientRect = () =>
      new DOMRect(0, 100, 400, 300)
    expect(ref.current!.captureReadingPosition()).toEqual({
      status: 'ready',
      position: { pageNumber: 2, verticalPercentage: 0 }
    })
    view.rerender(
      <PdfDocumentViewer
        source={source}
        hiddenPages={[2]}
        readingInsets={{ top: 80, bottom: 0, horizontal: 0 }}
        ref={ref}
      />
    )
    await act(async () => {})
    expect(ref.current!.captureReadingPosition()).toEqual({ status: 'pending' })
  })

  it('keeps geometry usable when current text extraction fails, but refuses a no-text handoff', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({}, ref)
    await act(async () => {})
    const viewer = latestViewer()
    const doc = viewer.document as PDFDocumentProxy
    vi.spyOn(doc, 'getPage').mockRejectedValue(
      new Error('text extraction failed')
    )
    act(() => viewer.eventBus.dispatch('pagerendered', { pageNumber: 1 }))
    await act(async () => {})
    expect(ref.current!.captureReadingPosition()).toMatchObject({
      status: 'ready',
      position: { pageNumber: 1, verticalPercentage: 0 }
    })
    expect(ref.current!.captureModeSwitchPosition!()).toEqual({
      status: 'failed'
    })
    view.unmount()
  })

  it('persists geometry at 35% and 65% before text arrives, without changing when text arrives', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer(
      { readingInsets: { top: 80, bottom: 0, horizontal: 0 } },
      ref
    )
    await act(async () => {})
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    container.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300)
    const page = latestViewer().getPageView(0)!.div
    page.getBoundingClientRect = () =>
      new DOMRect(0, -container.scrollTop, 400, 1000)
    for (const percentage of [35, 65]) {
      container.scrollTop = percentage * 10 - 80
      expect(ref.current!.captureReadingPosition()).toEqual({
        status: 'ready',
        position: { pageNumber: 1, verticalPercentage: percentage }
      })
      expect(ref.current!.captureModeSwitchPosition!()).toEqual({
        status: 'pending'
      })
    }
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {})
    expect(ref.current!.captureReadingPosition()).toEqual({
      status: 'ready',
      position: { pageNumber: 1, verticalPercentage: 65 }
    })
    container.getBoundingClientRect = () => new DOMRect(0, 0, 0, 300)
    expect(ref.current!.captureReadingPosition()).toEqual({ status: 'pending' })
  })

  it('captures and restores distinct visible source characters inside one wrapped span', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({}, ref)
    await act(async () => {})
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    container.getBoundingClientRect = () => new DOMRect(0, 0, 100, 25)
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {})
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (
      this: Range
    ) {
      const start = Number(
        this.startContainer.parentElement?.dataset.selectionStartOffset ?? 0
      )
      const offset = start + this.startOffset
      return [
        new DOMRect(
          (offset % 5) * 10,
          Math.floor(offset / 5) * 20 - container.scrollTop,
          8,
          15
        )
      ] as unknown as DOMRectList
    })
    expect(ref.current!.captureModeSwitchPosition!()).toMatchObject({
      status: 'ready',
      position: { offset: 0 }
    })
    container.scrollTop = 43 // first row is partly visible
    const b = ref.current!.captureModeSwitchPosition!()
    expect(b).toMatchObject({
      status: 'ready',
      position: { pageNumber: 1, offset: 10 }
    })
    if (b.status !== 'ready') throw new Error('Expected stable position')
    container.scrollTop = 0
    await act(async () => {
      await ref.current!.scrollToAnchor(b.position)
    })
    expect(container.scrollTop).toBe(40) // full source line, not original clipping
    expect(ref.current!.captureModeSwitchPosition!()).toMatchObject({
      position: { offset: 10 }
    })
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(500, 0, 10, 15)
    ] as unknown as DOMRectList)
    expect(ref.current!.captureReadingPosition()).toMatchObject({
      status: 'ready',
      position: { verticalPercentage: 40 / 3 }
    })
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 1000, 10, 15)
    ] as unknown as DOMRectList)
    expect(ref.current!.captureTextAnchor()).toEqual(b.position) // legacy interface retains the precise restore
    expect(ref.current!.captureReadingPosition()).toMatchObject({
      status: 'ready',
      position: { verticalPercentage: 40 / 3 }
    })
  })

  it('selects the first visible line across pages and waits only for layers that can precede it', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([400, 300]).drawText('Upper')
    pdf.addPage([400, 300]).drawText('Lower')
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({ source: { data: await pdf.save() } }, ref)
    await act(async () => {})
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    container.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600)
    emitTextLayer(1, ['Upper'])
    await act(async () => {})
    expect(ref.current!.captureModeSwitchPosition!()).toMatchObject({
      status: 'ready',
      position: { pageNumber: 1, offset: 0 }
    })
    container.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200)
    container.scrollTop = 250
    expect(ref.current!.captureModeSwitchPosition!()).toEqual({
      status: 'pending'
    })
    emitTextLayer(2, ['Lower'])
    await act(async () => {})
    expect(ref.current!.captureModeSwitchPosition!()).toMatchObject({
      status: 'ready',
      position: { pageNumber: 2, offset: 0, text: 'Lower' }
    })
  })

  it('keeps pending layers distinct from blank geometry and reports stale anchors without publishing fallback', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const notice = vi.fn()
    const view = renderViewer({ onRestoreError: notice }, ref)
    await act(async () => {})
    expect(ref.current!.captureModeSwitchPosition!()).toEqual({
      status: 'pending'
    })
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    await act(async () => {
      await ref.current!.scrollToAnchor({
        pageNumber: 1,
        verticalPercentage: 40
      })
    })
    expect(container.scrollTop).toBe(120)
    let restored!: Promise<void>
    act(() => {
      restored = ref.current!.scrollToAnchor({
        pageNumber: 1,
        offset: 99999,
        text: 'duplicate',
        textId: 'missing'
      })
    })
    expect(ref.current!.captureModeSwitchPosition!()).toEqual({
      status: 'pending'
    })
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {
      await restored
    })
    expect(notice).toHaveBeenCalledOnce()
    expect(container.scrollTop).toBe(0)
  })

  it('cancels a pending Text character restore when an explicit page seek replaces it', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    renderViewer({}, ref)
    await act(async () => {})
    let pending!: Promise<void>
    act(() => {
      pending = ref.current!.scrollToAnchor({
        pageNumber: 1,
        textId: 'page-1-item-0',
        text: 'column',
        offset: 5
      })
      ref.current!.scrollToPage(2)
    })
    await act(async () => {
      await pending
    })
    expect(latestViewer().currentPageNumber).toBe(2)
    expect(ref.current!.captureTextAnchor()).toBeNull()
    emitTextLayer(1, ['Left column line one', 'Left column line two'])
    await act(async () => {})
    expect(latestViewer().currentPageNumber).toBe(2)
    expect(ref.current!.captureTextAnchor()).toBeNull()
  })

  it('keeps the restored Text character through an unchanged Layout viewport, then captures actual navigation', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({}, ref)
    await act(async () => {})
    const anchor = {
      pageNumber: 1,
      textId: 'page-1-item-0',
      text: 'column line one',
      offset: 5
    }
    let restored!: Promise<void>
    act(() => {
      restored = ref.current!.scrollToAnchor(anchor)
    })
    // An immediate mode switch must not discard the pending precise anchor.
    expect(ref.current!.captureTextAnchor()).toEqual(anchor)
    const layer = emitTextLayer(1, [
      'Left column line one',
      'Left column line two'
    ])
    for (const span of layer.querySelectorAll('span'))
      span.scrollIntoView = vi.fn()
    await act(async () => {
      await restored
    })
    expect(ref.current!.captureTextAnchor()).toEqual(anchor)
    const container = view.container.querySelector(
      '.hamster-reader__pdf-viewer-container'
    ) as HTMLElement
    expect(container).not.toBeNull()
    container.scrollTop += 10
    expect(ref.current!.captureTextAnchor()).toMatchObject({
      pageNumber: 1,
      offset: 0
    })
    // Returning to the old scroll coordinates must not revive an invalidated anchor.
    container.scrollTop -= 10
    expect(ref.current!.captureTextAnchor()).toMatchObject({ offset: 0 })
    await act(async () => {
      await ref.current!.scrollToAnchor(anchor)
    })
    expect(ref.current!.captureTextAnchor()).toEqual(anchor)
    act(() => ref.current!.scrollToPage(1))
    expect(ref.current!.captureTextAnchor()).toMatchObject({ offset: 0 })
  })

  it('uses non-hidden in-range pages for navigation, bookmarks, callbacks and crop-mode fallback', async () => {
    const source = { data: readFixture('pdf/two-column.pdf') }
    const ref = createRef<PdfDocumentViewerRef>()
    const onPageChange = vi.fn()
    const props = {
      source,
      hiddenPages: [1],
      pageRange: { start: 1, end: 2 },
      onPageChange,
      onHiddenPagesRestore: vi.fn()
    }
    const view = renderViewer(props, ref)
    await act(async () => {})
    expect(latestViewer().currentPageNumber).toBe(2)
    act(() => {
      ref.current!.scrollToPage(2)
      ref.current!.scrollToPage(1)
    })
    expect(latestViewer().currentPageNumber).toBe(2)
    await act(async () => {
      await expect(
        ref.current!.scrollToAnchor({
          pageNumber: 1,
          verticalPercentage: 50
        })
      ).rejects.toThrow('目标页面不可用')
    })
    expect(latestViewer().currentPageNumber).toBe(2)
    act(() => {
      latestViewer().currentPageNumber = 1
      latestViewer().eventBus.dispatch('pagechanging', { pageNumber: 1 })
    })
    expect(latestViewer().currentPageNumber).toBe(2)
    expect(onPageChange).not.toHaveBeenCalledWith(1)
    act(() =>
      latestViewer().eventBus.dispatch('pagechanging', { pageNumber: 2 })
    )
    expect(onPageChange).toHaveBeenLastCalledWith(2)
    view.rerender(<PdfDocumentViewer {...props} edgeCropEditing ref={ref} />)
    act(() => ref.current!.scrollToPage(1))
    expect(latestViewer().currentPageNumber).toBe(2)
    expect(latestViewer().getPageView(0)!.div.style.display).toBe('none')
    expect(
      view.container.querySelector('.hamster-reader__engine-hidden-page')
    ).toBeNull()
    expect(view.getByTestId('pdf-hidden-page-group-1-1')).toBeTruthy()
    act(() =>
      latestViewer().eventBus.dispatch('pagechanging', { pageNumber: 1 })
    )
    expect(onPageChange).not.toHaveBeenCalledWith(1)
    onPageChange.mockClear()
    view.rerender(
      <PdfDocumentViewer {...props} currentPageNumber={1} ref={ref} />
    )
    expect(latestViewer().currentPageNumber).toBe(2)
    expect(latestViewer().getPageView(0)!.div.style.display).toBe('none')
    expect(onPageChange).not.toHaveBeenCalledWith(1)
    view.rerender(
      <PdfDocumentViewer {...props} hiddenPages={[1, 2]} ref={ref} />
    )
    act(() =>
      latestViewer().eventBus.dispatch('pagechanging', { pageNumber: 1 })
    )
    expect(onPageChange).not.toHaveBeenCalledWith(1)
  })

  it('filters hidden pages before restoration in the pagesloaded callback', async () => {
    const source = { data: readFixture('pdf/two-column.pdf') }
    const ref = createRef<PdfDocumentViewerRef>()
    let restoredPage: number | undefined
    renderViewer(
      {
        source,
        hiddenPages: ['page-1'],
        onPagesLoaded: () => {
          ref.current!.scrollToPage(2)
          ref.current!.scrollToPage(1)
          restoredPage = latestViewer().currentPageNumber
        }
      },
      ref
    )
    await act(async () => {})
    expect(restoredPage).toBe(2)
  })

  it('restores a page proportion without waiting for any text layer', async () => {
    const source = { data: readFixture('pdf/two-column.pdf') }
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({ source }, ref)
    await act(async () => {})
    let settled = false
    act(() => {
      ref
        .current!.scrollToAnchor({ pageNumber: 2, verticalPercentage: 50 })
        .then(() => {
          settled = true
        })
    })
    // Page geometry restores independently of the text layer.
    await Promise.resolve()
    expect(settled).toBe(true)
    view.rerender(
      <PdfDocumentViewer source={source} hiddenPages={[2]} ref={ref} />
    )
    await act(async () => {})
    expect(settled).toBe(true)
    expect(latestViewer().currentPageNumber).toBe(1)
  })

  it('keeps a public navigation when an older restore was still waiting', async () => {
    const source = { data: readFixture('pdf/two-column.pdf') }
    const ref = createRef<PdfDocumentViewerRef>()
    let loaded!: () => void
    const pagesReady = new Promise<void>((resolve) => {
      loaded = resolve
    })
    const view = renderViewer(
      { source, hiddenPages: [1], onPagesLoaded: () => loaded() },
      ref
    )
    await act(async () => {
      await pagesReady
    })
    let restoreError: unknown
    ref
      .current!.scrollToAnchorForRestore({
        pageNumber: 1,
        verticalPercentage: 50
      })
      .catch((error) => {
        restoreError = error
      })
    await act(async () => {})
    act(() => {
      ref.current!.scrollToAnchor({ pageNumber: 2, verticalPercentage: 0 })
    })
    await act(async () => {})
    expect((restoreError as DOMException).name).toBe('AbortError')
    expect(latestViewer().currentPageNumber).toBe(2)
    // The restore's page becomes visible afterwards; it must not replay.
    view.rerender(<PdfDocumentViewer source={source} ref={ref} />)
    await act(async () => {})
    expect(latestViewer().currentPageNumber).toBe(2)
  })

  it('aborts a pending restore wait as soon as the source changes', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    let loaded!: () => void
    const pagesReady = new Promise<void>((resolve) => {
      loaded = resolve
    })
    const view = renderViewer(
      { hiddenPages: [2], onPagesLoaded: () => loaded() },
      ref
    )
    await act(async () => {
      await pagesReady
    })
    let restoreError: unknown
    ref
      .current!.scrollToAnchorForRestore({
        pageNumber: 2,
        verticalPercentage: 50
      })
      .catch((error) => {
        restoreError = error
      })
    await act(async () => {})
    view.rerender(
      <PdfDocumentViewer
        source={{ data: readFixture('pdf/two-column.pdf') }}
        hiddenPages={[2]}
        ref={ref}
      />
    )
    await act(async () => {})
    expect((restoreError as DOMException).name).toBe('AbortError')
  })

  it('allows in-range restoration immediately in the pagesloaded callback', async () => {
    const source = { data: readFixture('pdf/two-column.pdf') }
    const ref = createRef<PdfDocumentViewerRef>()
    let restoredPage: number | undefined
    renderViewer(
      {
        source,
        pageRange: { start: 1, end: 2 },
        onPagesLoaded: () => {
          ref.current!.scrollToPage(2)
          restoredPage = latestViewer().currentPageNumber
        }
      },
      ref
    )
    await act(async () => {})
    expect(restoredPage).toBe(2)
  })

  it('applies pageRange to display, crop editing and imperative navigation without renumbering', async () => {
    const source = { data: readFixture('pdf/two-column.pdf') }
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({ source, pageRange: { start: 2, end: 2 } }, ref)
    await act(async () => {})
    expect(latestViewer().getPageView(0)!.div.style.display).toBe('none')
    expect(latestViewer().getPageView(1)!.div.style.display).toBe('')
    expect(latestViewer().currentPageNumber).toBe(2)
    act(() => ref.current!.scrollToPage(1))
    expect(latestViewer().currentPageNumber).toBe(2)
    view.rerender(
      <PdfDocumentViewer
        source={source}
        pageRange={{ start: 2, end: 2 }}
        hiddenPages={[2]}
        edgeCropEditing
        onHiddenPagesRestore={vi.fn()}
        ref={ref}
      />
    )
    expect(latestViewer().getPageView(0)!.div.style.display).toBe('none')
    expect(latestViewer().getPageView(1)!.div.style.display).toBe('none')
    expect(view.getByTestId('pdf-hidden-page-group')).toBeTruthy()
    view.rerender(
      <PdfDocumentViewer
        source={source}
        pageRange={{ start: 3, end: 2 }}
        ref={ref}
      />
    )
    expect(latestViewer().getPageView(1)!.div.style.display).toBe('none')
    view.rerender(<PdfDocumentViewer source={source} ref={ref} />)
    expect(latestViewer().getPageView(0)!.div.style.display).toBe('')
  })

  it('renders one independent control per hidden group without revealing hidden pages', async () => {
    const pdf = await PDFDocument.create()
    for (let page = 0; page < 11; page++) pdf.addPage([400, 300])
    const source = { data: await pdf.save() }
    const ref = createRef<PdfDocumentViewerRef>()
    const onHiddenPagesRestore = vi.fn()
    const view = renderViewer(
      {
        source,
        edgeCropEditing: true,
        hiddenPages: [2, 4, 5, 9, 'page-10'],
        onHiddenPagesRestore
      },
      ref
    )
    await act(async () => {})
    expect(
      view
        .getAllByRole('button', { name: /个隐藏页/ })
        .map((button) => button.getAttribute('data-hidden-page-group'))
    ).toEqual(['2-2', '4-5', '9-10'])
    for (const pageNumber of [2, 4, 5, 9, 10]) {
      expect(
        latestViewer().getPageView(pageNumber - 1)!.div.style.display
      ).toBe('none')
      expect(
        latestViewer()
          .getPageView(pageNumber - 1)!
          .div.querySelector('.hamster-reader__engine-hidden-page')
      ).toBeNull()
    }
    const trigger = view.getByTestId('pdf-hidden-page-group-2-2')
    fireEvent.click(trigger)
    fireEvent.click(view.getByTestId('pdf-hidden-restore-page-2'))
    fireEvent.click(view.getByTestId('pdf-hidden-restore-page-4'))
    fireEvent.click(view.getByRole('button', { name: '恢复 2 页' }))
    expect(onHiddenPagesRestore).toHaveBeenCalledTimes(1)
    expect(onHiddenPagesRestore).toHaveBeenCalledWith([2, 4])
    fireEvent.click(trigger)
    fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    view.rerender(
      <PdfDocumentViewer
        source={source}
        edgeCropEditing
        hiddenPages={Array.from({ length: 11 }, (_, index) => index + 1)}
        onHiddenPagesRestore={onHiddenPagesRestore}
        ref={ref}
      />
    )
    expect(view.getByTestId('pdf-hidden-page-group').textContent).toContain(
      '11'
    )
    view.rerender(
      <PdfDocumentViewer
        source={source}
        edgeCropEditing
        hiddenPages={[]}
        onHiddenPagesRestore={onHiddenPagesRestore}
        ref={ref}
      />
    )
    expect(view.queryAllByTestId(/pdf-hidden-page-group/)).toHaveLength(0)
  })

  async function scannedSource() {
    const document = await PDFDocument.create()
    document.addPage([400, 300])
    document.addPage([400, 300])
    return { data: new Uint8Array(await document.save()) }
  }
  const ocrPage = () =>
    IntermediatePage.parse({
      id: 'ocr-result',
      number: 1,
      width: 400,
      height: 300,
      texts: [
        {
          id: 'word',
          content: 'Scanned text',
          fontSize: 20,
          fontFamily: '',
          fontWeight: 400,
          italic: false,
          color: '#000000',
          polygon: [
            [20, 20],
            [140, 20],
            [140, 40],
            [20, 40]
          ],
          lineHeight: 20,
          ascent: 16,
          descent: 4,
          dir: TextDir.LTR,
          skew: 0,
          isEOL: false
        }
      ]
    })
  async function prepareOcrImage() {
    const document = latestViewer().document as PDFDocumentProxy
    const render = vi.fn((_options: { viewport: { scale: number } }) => ({
      promise: Promise.resolve()
    }))
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      vi.spyOn(page, 'render').mockImplementation(
        render as unknown as typeof page.render
      )
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AA=='
    )
    return render
  }

  it('manually OCRs a scanned page, emits transparent texts, selects/highlights and restores old-readable ranges', async () => {
    const source = await scannedSource()
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({ source }, ref)
    await act(async () => {})
    const rasterize = await prepareOcrImage()
    const extraOCR = vi.fn(async () => ocrPage())
    const onOcrTextsChange = vi.fn()
    const onHighlight = vi.fn()
    const props = {
      source,
      ocr: { enabled: true, pages: [2] },
      extraOCR,
      onOcrTextsChange,
      onHighlight
    }
    view.rerender(<PdfDocumentViewer {...props} ref={ref} />)
    await vi.waitFor(() => expect(onOcrTextsChange).toHaveBeenCalledTimes(1))
    expect(extraOCR).toHaveBeenCalledWith('data:image/png;base64,AA==')
    expect(rasterize.mock.calls[0][0].viewport.scale).toBe(1)
    const [page, texts] = onOcrTextsChange.mock.calls[0]
    expect(page).toBe(2)
    expect(texts[0]).toMatchObject({
      id: 'ocr-2-word',
      content: 'Scanned text',
      color: 'transparent'
    })
    const span = view.container.querySelector<HTMLElement>('[data-ocr=true]')!
    expect(span.dataset.pageNumber).toBe('2')
    expect(span.style.color).toBe('transparent')
    await vi.waitFor(() =>
      expect(ref.current!.getCanonicalPageText(2)).toBe('Scanned text')
    )
    document
      .getSelection()!
      .setBaseAndExtent(span.firstChild!, 0, span.firstChild!, 7)
    act(() => ref.current!.confirmSelection())
    expect(onHighlight).toHaveBeenCalledTimes(1)
    const range = onHighlight.mock.calls[0][0] as ReaderSelectionRange
    expect(range).toMatchObject({
      text: 'Scanned',
      start: { selectionId: 'page-2', offset: 0 },
      end: { selectionId: 'page-2', offset: 7 }
    })
    const persisted = parseHighlights(
      JSON.stringify({ version: 4, ranges: [range], rects: [], paintings: {} })
    )
    view.rerender(
      <PdfDocumentViewer
        {...props}
        ranges={persisted.ranges}
        ocrTexts={{ 2: texts }}
        ref={ref}
      />
    )
    await vi.waitFor(() =>
      expect(ref.current!.selectRange(range.id)?.toString()).toBe('Scanned')
    )
    expect(onOcrTextsChange).toHaveBeenCalledTimes(1)
    expect(
      view.container.querySelector('[data-testid=pdf-ocr-page-1]')
    ).toBeNull()
  })

  it('restores controlled OCR without a provider, and hides it when disabled', async () => {
    const source = await scannedSource()
    const texts =
      (await ocrPage().getContent()) as import('@hamster-note/types').IntermediateText[]
    const extraOCR = vi.fn()
    const ref = createRef<PdfDocumentViewerRef>()
    const props = { source, ocr: true, ocrTexts: { 1: texts, 2: [] }, extraOCR }
    const view = renderViewer(props, ref)
    await vi.waitFor(() =>
      expect(view.container.querySelector('[data-ocr=true]')).not.toBeNull()
    )
    expect(extraOCR).not.toHaveBeenCalled()
    view.rerender(<PdfDocumentViewer {...props} ocr={false} ref={ref} />)
    expect(view.container.querySelector('[data-ocr=true]')).toBeNull()
  })

  it('uses built-in image-parser only for rendered pages', async () => {
    const source = await scannedSource()
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({ source }, ref)
    await act(async () => {})
    await prepareOcrImage()
    const { IntermediateDocument } = await import('@hamster-note/types')
    vi.mocked(ImageParser.encode).mockResolvedValue(
      IntermediateDocument.parse({
        id: 'builtin',
        title: '',
        pages: [await IntermediatePage.serialize(ocrPage())]
      })
    )
    view.rerender(<PdfDocumentViewer source={source} ocr ref={ref} />)
    act(() =>
      latestViewer().eventBus.dispatch('pagerendered', { pageNumber: 1 })
    )
    await vi.waitFor(() =>
      expect(view.container.querySelector('[data-ocr=true]')).not.toBeNull()
    )
    expect(ImageParser.encode).toHaveBeenCalledTimes(1)
    expect(
      view.container.querySelector('[data-testid=pdf-ocr-page-2]')
    ).toBeNull()
  })

  it('reports OCR failures once and retries after toggling the page', async () => {
    const source = await scannedSource()
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({ source }, ref)
    await act(async () => {})
    await prepareOcrImage()
    const failure = new Error('provider unavailable')
    const extraOCR = vi.fn().mockRejectedValue(failure)
    const onOcrError = vi.fn()
    const props = {
      source,
      extraOCR,
      onOcrError,
      ocr: { enabled: true, pages: [1] }
    }
    view.rerender(<PdfDocumentViewer {...props} ref={ref} />)
    await vi.waitFor(() =>
      expect(onOcrError).toHaveBeenCalledWith(failure, { pageNumber: 1 })
    )
    expect(extraOCR).toHaveBeenCalledTimes(1)
    view.rerender(<PdfDocumentViewer {...props} ocr={false} ref={ref} />)
    view.rerender(<PdfDocumentViewer {...props} ref={ref} />)
    await vi.waitFor(() => expect(extraOCR).toHaveBeenCalledTimes(2))
  })

  it('drops OCR results after page closure and does not overlap the next request', async () => {
    const source = await scannedSource()
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({ source }, ref)
    await act(async () => {})
    await prepareOcrImage()
    let finish: (page: IntermediatePage) => void = () => {}
    const pending = new Promise<IntermediatePage>((resolve) => {
      finish = resolve
    })
    const extraOCR = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockImplementation(async () => ocrPage())
    const onOcrTextsChange = vi.fn()
    const props = { source, extraOCR, onOcrTextsChange }
    view.rerender(
      <PdfDocumentViewer
        {...props}
        ocr={{ enabled: true, pages: [1] }}
        ref={ref}
      />
    )
    await vi.waitFor(() => expect(extraOCR).toHaveBeenCalledTimes(1))
    view.rerender(
      <PdfDocumentViewer
        {...props}
        ocr={{ enabled: true, pages: [2] }}
        ref={ref}
      />
    )
    expect(extraOCR).toHaveBeenCalledTimes(1)
    await act(async () => finish(ocrPage()))
    await vi.waitFor(() => expect(onOcrTextsChange).toHaveBeenCalledTimes(1))
    expect(onOcrTextsChange.mock.calls[0][0]).toBe(2)
    expect(extraOCR).toHaveBeenCalledTimes(2)
  })

  it('ignores an OCR result after switching documents', async () => {
    const source = await scannedSource()
    const ref = createRef<PdfDocumentViewerRef>()
    const view = renderViewer({ source }, ref)
    await act(async () => {})
    await prepareOcrImage()
    let finish: (page: IntermediatePage) => void = () => {}
    const extraOCR = vi.fn(
      () =>
        new Promise<IntermediatePage>((resolve) => {
          finish = resolve
        })
    )
    const onOcrTextsChange = vi.fn()
    view.rerender(
      <PdfDocumentViewer
        source={source}
        ocr={{ enabled: true, pages: [1] }}
        extraOCR={extraOCR}
        onOcrTextsChange={onOcrTextsChange}
        ref={ref}
      />
    )
    await vi.waitFor(() => expect(extraOCR).toHaveBeenCalledTimes(1))
    view.rerender(
      <PdfDocumentViewer
        source={{ data: readFixture('pdf/two-column.pdf') }}
        ref={ref}
      />
    )
    await act(async () => finish(ocrPage()))
    expect(onOcrTextsChange).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-ocr=true]')).toBeNull()
  })
  it('StrictMode 重放后仍可打开同一份字节，保留调用方数据', async () => {
    const data = readFixture('pdf/two-column.pdf')
    const length = data.byteLength
    const onError = vi.fn()
    const view = render(
      <StrictMode>
        <PdfDocumentViewer source={{ data }} onError={onError} />
      </StrictMode>
    )
    await vi.waitFor(() => {
      expect(view.getByTestId('pdf-document-viewer').dataset.status).toBe(
        'ready'
      )
      expect(latestViewer().pagesCount).toBe(2)
    })
    expect(onError).not.toHaveBeenCalled()
    expect(data.byteLength).toBe(length)
    expect(hoisted.viewerInstances[0].document).toBeNull()
  })

  it('以官方 PDFViewer 展示：链接组件接入，内置标注编辑器关闭', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    renderViewer({}, ref)

    const options = latestViewer().options
    expect(options.linkService).toBeDefined()
    expect(options.textLayerMode).toBe(1)
    expect(options.annotationMode).toBe(1)
    // annotationEditorMode NONE：PDF 内置标注不可编辑/不进入存储通道。
    expect(options.annotationEditorMode).toBe(0)

    await act(async () => {})
    expect(latestViewer().pagesCount).toBe(2)
    expect(hoisted.linkServiceInstances.length).toBe(1)
  })

  it('textlayerrendered 后 span 注入 page-N 三件套；confirmSelection 产出公开 range', async () => {
    const onHighlight = vi.fn()
    const ref = createRef<PdfDocumentViewerRef>()
    renderViewer({ onHighlight }, ref)
    await act(async () => {})

    const textLayer = emitTextLayer(1, [
      'Left column line one',
      'Left column line two'
    ])
    await act(async () => {})

    // Real PDFPageView events include canvas/annotation siblings, while tagged
    // PDFs nest their text spans. Re-rendering must retain a usable context.
    const wrapper = document.createElement('span')
    wrapper.className = 'markedContent'
    wrapper.append(...Array.from(textLayer.children))
    textLayer.append(wrapper)
    const pageDiv = textLayer.parentElement!
    const annotation = document.createElement('div')
    annotation.innerHTML = '<span>Not canonical PDF text</span>'
    pageDiv.append(annotation)
    act(() =>
      latestViewer().eventBus.dispatch('textlayerrendered', {
        pageNumber: 1,
        source: { div: pageDiv }
      })
    )
    await act(async () => {})

    const spans = textLayer.querySelectorAll('span[data-text-id]')
    expect(spans[0].getAttribute('data-text-id')).toBe('page-1-item-0')
    expect(spans[1].getAttribute('data-selection-start-offset')).toBe('20')

    const selection = document.getSelection()!
    selection.setBaseAndExtent(
      spans[0].firstChild!,
      0,
      spans[0].firstChild!,
      20
    )
    act(() => {
      ref.current!.confirmSelection()
    })

    expect(onHighlight).toHaveBeenCalledTimes(1)
    const range = onHighlight.mock.calls[0][0] as ReaderSelectionRange
    expect(range.start).toEqual({ selectionId: 'page-1', offset: 0 })
    expect(range.end).toEqual({ selectionId: 'page-1', offset: 20 })
    expect(range.text).toBe('Left column line one')
    expect(/^pdf-range-/.test(range.id)).toBe(true)
  })

  it('叠加层渲染持久化高亮矩形（px 单位投影到 page div 内）', async () => {
    const ranges: ReaderSelectionRange[] = [
      {
        id: 'pdf-range-left-column',
        text: 'Left column line one',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 20 },
        createdAt: 1735689701000,
        overlayRectType: 'px',
        rectsBySelectionId: {
          'page-1': [{ x: 20, y: 32.9, width: 97.8, height: 12 }]
        }
      }
    ]
    const ref = createRef<PdfDocumentViewerRef>()
    const { container } = renderViewer({ ranges }, ref)
    await act(async () => {})

    const highlight = container.querySelector<HTMLElement>(
      '[data-range-id="pdf-range-left-column"]'
    )
    expect(highlight).not.toBeNull()
    expect(parseFloat(highlight!.style.left)).toBeCloseTo(20, 6)
    expect(parseFloat(highlight!.style.top)).toBeCloseTo(32.9, 6)
    expect(parseFloat(highlight!.style.width)).toBeCloseTo(97.8, 6)
    // 叠加容器 pointer-events:none：原生选区不被拦截。
    const overlay = container.querySelector<HTMLElement>(
      '[data-testid="pdf-overlay-page-1"]'
    )
    expect(overlay!.style.pointerEvents).toBe('none')
  })

  it('损坏文件：onError 上报 corrupt，已渲染标注不清空', async () => {
    const onError = vi.fn()
    const ranges: ReaderSelectionRange[] = [
      {
        id: 'kept-range',
        text: 'Rotated page text',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 17 },
        createdAt: 1,
        overlayRectType: 'px',
        rectsBySelectionId: {
          'page-1': [{ x: 10, y: 10, width: 50, height: 10 }]
        }
      }
    ]
    const ref = createRef<PdfDocumentViewerRef>()
    const { container, rerender } = renderViewer(
      {
        source: { data: readFixture('pdf/rotated.pdf') },
        ranges,
        onError
      },
      ref
    )
    await act(async () => {})
    expect(
      container.querySelector('[data-range-id="kept-range"]')
    ).not.toBeNull()

    rerender(
      <PdfDocumentViewer
        source={{ data: new TextEncoder().encode('corrupted pdf') }}
        ranges={ranges}
        onError={onError}
        ref={ref}
      />
    )
    await act(async () => {})

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe('corrupt')
    // 旧文档与标注保持（open 失败不得清空既有数据）。
    expect(
      container.querySelector('[data-range-id="kept-range"]')
    ).not.toBeNull()
  })

  it('切文件竞态：快速切换 source，最终只展示最后一份文档', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const { rerender } = renderViewer({}, ref)
    await act(async () => {})
    expect(latestViewer().pagesCount).toBe(2)

    rerender(
      <PdfDocumentViewer
        source={{ data: readFixture('pdf/rotated.pdf') }}
        ref={ref}
      />
    )
    rerender(
      <PdfDocumentViewer
        source={{ data: readFixture('pdf/ligature.pdf') }}
        ref={ref}
      />
    )
    await act(async () => {})

    expect(latestViewer().pagesCount).toBe(1)
    expect(latestViewer().document).not.toBeNull()
  })

  it('受控页码不会进入隐藏页；缩放与隐藏展示生效', async () => {
    const onPageChange = vi.fn()
    const ref = createRef<PdfDocumentViewerRef>()
    const { rerender } = renderViewer({ onPageChange }, ref)
    await act(async () => {})

    rerender(
      <PdfDocumentViewer
        source={{ data: readFixture('pdf/two-column.pdf') }}
        currentPageNumber={2}
        scale={2}
        hiddenPages={[2]}
        onPageChange={onPageChange}
        ref={ref}
      />
    )
    await act(async () => {})

    expect(latestViewer().currentPageNumber).toBe(1)
    expect(latestViewer().currentScale).toBe(2)
    expect(latestViewer().getPageView(1)!.div.style.display).toBe('none')
    expect(latestViewer().getPageView(0)!.div.style.display).toBe('')
  })

  it('source 置空：清空文档并释放会话', async () => {
    const ref = createRef<PdfDocumentViewerRef>()
    const { rerender } = renderViewer({}, ref)
    await act(async () => {})
    expect(latestViewer().pagesCount).toBe(2)

    rerender(<PdfDocumentViewer source={null} ref={ref} />)
    await act(async () => {})

    expect(latestViewer().document).toBeNull()
    expect(latestViewer().pagesCount).toBe(0)
  })
})
