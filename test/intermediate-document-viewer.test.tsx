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
  getSelectionOverlayRects,
  mergeSelectionRects
} from '../src/components/IntermediateDocumentViewer'
import { IntermediateDocumentViewer } from '../src/index'
import { intersectionObserverMock } from './setup'

Reflect.set(globalThis, 'vi', vi)

vi.mock('@hamster-note/html-parser', () => ({
  HtmlParser: {
    decodeToHtml: vi.fn()
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

const makeSelectionWithRects = (getRects: () => DOMRect[]) => {
  const range = {
    getClientRects: vi.fn(() => getRects())
  } as unknown as Range

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
  beforeEach(() => {
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
      focusNode?: Node | null
      toString?: () => string
      containsNode?: (node: Node, partly?: boolean) => boolean
    }) => {
      return {
        isCollapsed: partial.isCollapsed ?? false,
        anchorNode: partial.anchorNode ?? null,
        focusNode: partial.focusNode ?? null,
        toString: partial.toString ?? (() => ''),
        containsNode: partial.containsNode ?? (() => false)
      } as unknown as Selection
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

    it('normalizes blank-space drag endpoint to nearest text', async () => {
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

      expect(onTextSelectionChange).toHaveBeenCalled()
      const [, detail] = onTextSelectionChange.mock.calls[0]
      expect(detail.texts.map((t: IntermediateText) => t.id)).toEqual([
        'text-b',
        'text-c',
        'text-d'
      ])
      expect(detail.selectedText).toBe('BCD')

      viewerRoot.removeChild(blankNode)
    })

    it('fires onTextSelectionEnd with normalized range on blank-space mouseup', async () => {
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

      expect(onTextSelectionEnd).toHaveBeenCalled()
      const [, detail] = onTextSelectionEnd.mock.calls[0]
      expect(detail.texts.map((t: IntermediateText) => t.id)).toEqual([
        'text-b',
        'text-c',
        'text-d'
      ])

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

    it('chooses first text when pointer is in blank space above all text', async () => {
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

      expect(onTextSelectionChange).toHaveBeenCalled()
      const [, detail] = onTextSelectionChange.mock.calls[0]
      expect(detail.texts.map((t: IntermediateText) => t.id)).toEqual([
        'text-a',
        'text-b'
      ])

      viewerRoot.removeChild(blankNode)
    })

    it('chooses last text when pointer is in blank space below all text', async () => {
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

      expect(onTextSelectionChange).toHaveBeenCalled()
      const [, detail] = onTextSelectionChange.mock.calls[0]
      expect(detail.texts.map((t: IntermediateText) => t.id)).toEqual([
        'text-b',
        'text-c',
        'text-d'
      ])

      viewerRoot.removeChild(blankNode)
    })

    it('tie-breaks equal distances by choosing earlier DOM order', async () => {
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

      expect(onTextSelectionChange).toHaveBeenCalled()
      const [, detail] = onTextSelectionChange.mock.calls[0]
      expect(detail.texts.map((t: IntermediateText) => t.id)).toEqual([
        'text-b'
      ])

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
    const installRangeRectMocks = () => {
      const originalGetClientRects = Range.prototype.getClientRects
      const originalGetBoundingClientRect =
        Range.prototype.getBoundingClientRect

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

    const appendHandle = (viewerRoot: HTMLElement, type: 'start' | 'end') => {
      const handle = globalThis.document.createElement('button')
      handle.dataset.handleType = type
      viewerRoot.appendChild(handle)
      return handle
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
        const startHandle = appendHandle(viewerRoot, 'start')
        startHandle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            clientX: 20,
            clientY: 24
          })
        )
        viewerRoot.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
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
        const endHandle = appendHandle(viewerRoot, 'end')
        endHandle.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            clientX: 20,
            clientY: 24
          })
        )
        viewerRoot.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
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
  })

  describe('selection overlay live drag refresh', () => {
    it('updates overlay blocks during primary-button mousemove before mouseup', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      let currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
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
        viewerRoot.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )

        viewerRoot.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
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
          new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
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
        pageRectSpy.mockRestore()
      }
    })

    it('stops refreshing overlay blocks after primary button is lost', async () => {
      const { document } = makeDocument({ pageCount: 1 })
      let currentRects = [
        makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
      ]

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
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
        viewerRoot.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )

        viewerRoot.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
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

        currentRects = [
          makeDomRect({ left: 45, top: 75, width: 20, height: 12 })
        ]

        viewerRoot.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 0,
            clientX: 65,
            clientY: 87
          })
        )

        viewerRoot.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
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
        pageRectSpy.mockRestore()
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

      render(
        <IntermediateDocumentViewer document={document} selectionOverlay />
      )

      const viewerRoot = screen.getByTestId('intermediate-document-viewer')
      const page = screen.getByTestId('intermediate-page-1')
      const pageRectSpy = vi
        .spyOn(page, 'getBoundingClientRect')
        .mockReturnValue(
          makeDomRect({ left: 5, top: 5, width: 100, height: 150 })
        )
      const elementFromPointSpy = mockElementFromPoint(page)
      const selection = {
        ...makeSelectionWithRects(() => [
          makeDomRect({ left: 15, top: 25, width: 30, height: 8 })
        ]),
        removeAllRanges
      } as unknown as Selection
      const getSelectionSpy = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(selection)

      try {
        globalThis.document.dispatchEvent(new Event('selectionchange'))
        expect(getOverlayBlocks(page)).toHaveLength(1)

        viewerRoot.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
            clientX: 15,
            clientY: 25
          })
        )
        viewerRoot.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            button: 0,
            clientX: 45,
            clientY: 33
          })
        )
        viewerRoot.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(removeAllRanges).not.toHaveBeenCalled()
        expect(getOverlayBlocks(page)).toHaveLength(1)
      } finally {
        getSelectionSpy.mockRestore()
        elementFromPointSpy.mockRestore()
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
})
