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

import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import type { RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReaderSelectionRange } from '../../src/types/selection'
import type {
  PdfDocumentViewerProps,
  PdfDocumentViewerRef
} from '../../src/pdf/PdfDocumentViewer'

type StubViewport = {
  scale: number
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
    currentPageNumber = 1
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

afterEach(() => {
  hoisted.viewerInstances.splice(0)
  hoisted.linkServiceInstances.splice(0)
})

const renderViewer = (
  props: Partial<PdfDocumentViewerProps>,
  ref: RefObject<PdfDocumentViewerRef | null>
) =>
  render(
    <PdfDocumentViewer
      source={{ data: readFixture('pdf/two-column.pdf') }}
      {...props}
      ref={ref}
    />
  )

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
      source: { div: textLayerDiv }
    })
  })
  return textLayerDiv
}

describe('PdfDocumentViewer 接线', () => {
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

    const spans = textLayer.querySelectorAll('span')
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

  it('受控页码与缩放写入 viewer；隐藏页 display:none', async () => {
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

    expect(latestViewer().currentPageNumber).toBe(2)
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
