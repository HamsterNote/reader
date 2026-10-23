// HAM-89 / tasks.md 3.2/3.4：原生选区 → 公开 range 契约序列化。
// 覆盖：单页/跨页端点与拼接文本、px/percent 矩形捕获、折叠选区与未增强
// 元素排除（页外文本不被误选）。getClientRects 在 jsdom 中为空，矩形用
// 确定性 mock 几何验证。

import { afterEach, describe, expect, it } from 'vitest'

import type { PdfPageSelectionContext } from '../../src/pdf/pdfSelectionSerializer'
import {
  deriveRectsForCanonicalRange,
  serializePdfTextSelection
} from '../../src/pdf/pdfSelectionSerializer'
import {
  buildCanonicalPageText,
  enhanceTextLayer
} from '../../src/pdf/pdfTextMapping'

// 几何 stub：scale=1、无旋转。identity 投影足够验证矩形归一逻辑；
// 旋转/缩放投影由 pdf-overlay-geometry.test.ts 覆盖。
const makeStubViewport = (pageWidth: number, pageHeight: number) =>
  ({
    scale: 1,
    width: pageWidth,
    height: pageHeight,
    convertToPdfPoint: (x: number, y: number) => [x, pageHeight - y],
    convertToViewportPoint: (x: number, y: number) => [x, pageHeight - y]
  }) as unknown as PdfPageSelectionContext['viewport']

type FakePage = {
  readonly pageNumber: number
  readonly itemTexts: readonly string[]
  readonly width: number
  readonly height: number
  /** 每个 span 的 client rect（相对 page div 左上角）。 */
  readonly spanRects: readonly {
    x: number
    y: number
    width: number
    height: number
  }[]
}

const builtPages: HTMLElement[] = []
const registeredSpans: { span: HTMLElement; rect: DOMRect }[] = []
let rangePatched = false

const patchCreateRangeOnce = (doc: Document) => {
  if (rangePatched) return
  rangePatched = true
  const originalCreateRange = doc.createRange.bind(doc)
  doc.createRange = () => {
    const range = originalCreateRange()
    // Range.getClientRects 在 jsdom 为空：按与 range 相交的已注册 span 合成。
    range.getClientRects = () =>
      registeredSpans
        .filter(({ span }) => {
          try {
            return range.intersectsNode(span)
          } catch {
            return false
          }
        })
        .map(({ rect }) => rect) as unknown as DOMRectList
    return range
  }
}

const toDomRect = (rect: {
  x: number
  y: number
  width: number
  height: number
}): DOMRect =>
  ({
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect
  }) as DOMRect

function makePageContext(fake: FakePage): PdfPageSelectionContext {
  const pageDiv = document.createElement('div')
  pageDiv.className = 'page'
  const textLayerDiv = document.createElement('div')
  textLayerDiv.className = 'textLayer'
  pageDiv.appendChild(textLayerDiv)
  document.body.appendChild(pageDiv)
  builtPages.push(pageDiv)

  fake.itemTexts.forEach((text, index) => {
    const span = document.createElement('span')
    span.textContent = text
    const rect = toDomRect(fake.spanRects[index])
    span.getClientRects = () => [rect] as unknown as DOMRectList
    span.getBoundingClientRect = () => rect
    textLayerDiv.appendChild(span)
    registeredSpans.push({ span, rect })
  })
  pageDiv.getBoundingClientRect = () =>
    toDomRect({ x: 0, y: 0, width: fake.width, height: fake.height })
  patchCreateRangeOnce(document)

  const canonical = buildCanonicalPageText(
    fake.pageNumber,
    fake.itemTexts.map((str) => ({ str }))
  )
  expect(enhanceTextLayer(textLayerDiv, canonical)).toBe(true)

  const viewport = makeStubViewport(fake.width, fake.height)
  return {
    pageNumber: fake.pageNumber,
    textLayerDiv,
    pageDiv,
    canonical,
    viewport,
    scaleOneViewport: viewport,
    visual: { width: fake.width, height: fake.height }
  }
}

afterEach(() => {
  for (const element of builtPages.splice(0)) element.remove()
  registeredSpans.splice(0)
  document.getSelection()?.removeAllRanges()
})

const TWO_COLUMN_TEXTS = [
  'Left column line one',
  'Left column line two',
  'Right column line one',
  'Right column line two'
]

describe('serializePdfTextSelection', () => {
  it('单页选区：端点为 page-N + 拼接偏移，文本逐字一致', () => {
    const context = makePageContext({
      pageNumber: 1,
      itemTexts: TWO_COLUMN_TEXTS,
      width: 400,
      height: 300,
      spanRects: [
        { x: 20, y: 32.9, width: 97.8, height: 12 },
        { x: 20, y: 50, width: 97.8, height: 12 },
        { x: 220, y: 33, width: 100, height: 12 },
        { x: 220, y: 51, width: 100, height: 12 }
      ]
    })
    const contexts = new Map([[1, context]])

    // 选中 'Left column line one' 全部（canonical 0..20）。
    const firstSpan = context.textLayerDiv.children[0] as HTMLElement
    const selection = document.getSelection()!
    selection.setBaseAndExtent(
      firstSpan.firstChild!,
      0,
      firstSpan.firstChild!,
      20
    )

    const detail = serializePdfTextSelection(selection, contexts, 'px')
    expect(detail).not.toBeNull()
    expect(detail!.start).toEqual({ selectionId: 'page-1', offset: 0 })
    expect(detail!.end).toEqual({ selectionId: 'page-1', offset: 20 })
    expect(detail!.text).toBe('Left column line one')
    // px 矩形捕获（契约样本值；y 翻转双转换有浮点尾差）。
    const rect = detail!.rectsBySelectionId['page-1'][0]
    expect(rect.x).toBeCloseTo(20, 6)
    expect(rect.y).toBeCloseTo(32.9, 6)
    expect(rect.width).toBeCloseTo(97.8, 6)
    expect(rect.height).toBeCloseTo(12, 6)
  })

  it('跨页选区：文本为起点页后缀 + 终点页前缀的直接拼接', () => {
    const page1 = makePageContext({
      pageNumber: 1,
      itemTexts: TWO_COLUMN_TEXTS,
      width: 400,
      height: 300,
      spanRects: [
        { x: 20, y: 32.9, width: 97.8, height: 12 },
        { x: 20, y: 50, width: 97.8, height: 12 },
        { x: 220, y: 33, width: 100, height: 12 },
        { x: 220, y: 51, width: 100, height: 12 }
      ]
    })
    const page2 = makePageContext({
      pageNumber: 2,
      itemTexts: ['Second page continues the article'],
      width: 400,
      height: 300,
      spanRects: [{ x: 20, y: 40, width: 182, height: 12 }]
    })
    const contexts = new Map([
      [1, page1],
      [2, page2]
    ])

    // 契约样本跨页 range：page-1 offset 61（= 20+20+21，第四段首字符）
    // → page-2 offset 11。
    const startSpan = page1.textLayerDiv.children[3] as HTMLElement
    const endSpan = page2.textLayerDiv.children[0] as HTMLElement
    const selection = document.getSelection()!
    selection.setBaseAndExtent(
      startSpan.firstChild!,
      0,
      endSpan.firstChild!,
      11
    )

    const detail = serializePdfTextSelection(selection, contexts, 'percent')
    expect(detail).not.toBeNull()
    expect(detail!.start).toEqual({ selectionId: 'page-1', offset: 61 })
    expect(detail!.end).toEqual({ selectionId: 'page-2', offset: 11 })
    expect(detail!.text).toBe('Right column line twoSecond page')
    expect(Object.keys(detail!.rectsBySelectionId)).toEqual([
      'page-1',
      'page-2'
    ])
    // percent 矩形：page-1 第 4 span 占 220/400=55, 51/300=17 ...
    const page1Rect = detail!.rectsBySelectionId['page-1'][0]
    expect(page1Rect.x).toBeCloseTo(55, 6)
    expect(page1Rect.y).toBeCloseTo(17, 6)
  })

  it('反向拖选（从下往上）端点仍按文档顺序输出', () => {
    const context = makePageContext({
      pageNumber: 1,
      itemTexts: TWO_COLUMN_TEXTS,
      width: 400,
      height: 300,
      spanRects: [
        { x: 20, y: 32.9, width: 97.8, height: 12 },
        { x: 20, y: 50, width: 97.8, height: 12 },
        { x: 220, y: 33, width: 100, height: 12 },
        { x: 220, y: 51, width: 100, height: 12 }
      ]
    })
    const contexts = new Map([[1, context]])
    const first = context.textLayerDiv.children[0] as HTMLElement
    const second = context.textLayerDiv.children[1] as HTMLElement

    const selection = document.getSelection()!
    selection.setBaseAndExtent(second.firstChild!, 5, first.firstChild!, 0)

    const detail = serializePdfTextSelection(selection, contexts, 'px')
    expect(detail!.start).toEqual({ selectionId: 'page-1', offset: 0 })
    expect(detail!.end).toEqual({ selectionId: 'page-1', offset: 25 })
  })

  it('折叠选区与页外文本不产出结果', () => {
    const context = makePageContext({
      pageNumber: 1,
      itemTexts: ['abc'],
      width: 400,
      height: 300,
      spanRects: [{ x: 0, y: 0, width: 30, height: 10 }]
    })
    const contexts = new Map([[1, context]])

    const selection = document.getSelection()!
    expect(serializePdfTextSelection(selection, contexts, 'px')).toBeNull()

    const outside = document.createElement('span')
    outside.textContent = '页外文本'
    document.body.appendChild(outside)
    selection.setBaseAndExtent(outside.firstChild!, 0, outside.firstChild!, 4)
    expect(serializePdfTextSelection(selection, contexts, 'px')).toBeNull()
    outside.remove()
  })
})

describe('deriveRectsForCanonicalRange', () => {
  it('rectsBySelectionId 缺失时按字符锚点重算（回页恢复）', () => {
    const context = makePageContext({
      pageNumber: 1,
      itemTexts: TWO_COLUMN_TEXTS,
      width: 400,
      height: 300,
      spanRects: [
        { x: 20, y: 32.9, width: 97.8, height: 12 },
        { x: 20, y: 50, width: 97.8, height: 12 },
        { x: 220, y: 33, width: 100, height: 12 },
        { x: 220, y: 51, width: 100, height: 12 }
      ]
    })
    const contexts = new Map([[1, context]])

    const derived = deriveRectsForCanonicalRange(
      { selectionId: 'page-1', offset: 0 },
      { selectionId: 'page-1', offset: 20 },
      contexts,
      'px'
    )
    const derivedRect = derived['page-1'][0]
    expect(derivedRect.x).toBeCloseTo(20, 6)
    expect(derivedRect.y).toBeCloseTo(32.9, 6)
    expect(derivedRect.width).toBeCloseTo(97.8, 6)
    expect(derivedRect.height).toBeCloseTo(12, 6)
  })

  it('页码非法或页面未加载时返回空（保持原样，不静默近似）', () => {
    const contexts = new Map<number, PdfPageSelectionContext>()
    expect(
      deriveRectsForCanonicalRange(
        { selectionId: 'bogus', offset: 0 },
        { selectionId: 'page-1', offset: 5 },
        contexts,
        'px'
      )
    ).toEqual({})
  })
})
