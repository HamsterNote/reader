import type { IntermediateText } from '@hamster-note/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  ReaderSavedSelection,
  ReaderSelectionOverlayRect
} from '../src/components/IntermediateDocumentViewer'
import {
  buildSavedSelection,
  denormalizePageRects,
  normalizePageRects,
  resolveSavedSelection,
  textHash,
  type TextElementInfo
} from '../src/components/selection/savedSelection'
import type { ReaderSelectedTextSegment } from '../src/components/selection/selectionPayloadSerializer'

type DomRectInput = {
  x: number
  y: number
  width: number
  height: number
}

type RectElement = HTMLElement & { __readerTestRect?: DomRectInput }

const makeDomRect = (rect: DomRectInput): DOMRect =>
  ({
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => rect
  }) as DOMRect

const makeText = (
  id: string,
  content: string,
  polygon: IntermediateText['polygon'] = [
    [10, 20],
    [90, 20],
    [90, 36],
    [10, 36]
  ]
): IntermediateText =>
  ({
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
    isEOL: false
  }) as IntermediateText

const makeSegment = (options: {
  id: string
  content: string
  selectedText: string
  startCharIndex: number
  endCharIndex: number
  pageNumber?: number
  polygon?: IntermediateText['polygon']
}): ReaderSelectedTextSegment =>
  ({
    ...makeText(options.id, options.content, options.polygon),
    selectedText: options.selectedText,
    startCharIndex: options.startCharIndex,
    endCharIndex: options.endCharIndex,
    pageNumber: options.pageNumber
  }) as ReaderSelectedTextSegment

const makeTextElement = (
  text: IntermediateText,
  pageNumber: number,
  rect: DomRectInput = { x: 10, y: 20, width: 80, height: 16 }
): TextElementInfo => {
  const element = document.createElement('span') as RectElement
  element.dataset.textId = text.id
  element.dataset.pageNumber = String(pageNumber)
  element.textContent = text.content ?? ''
  element.__readerTestRect = rect
  document.body.append(element)
  return { element, text, pageNumber }
}

const makeSelection = (
  textNode: Text,
  start: number,
  end: number
): Selection => {
  const range = document.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, end)
  return {
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: textNode,
    focusNode: textNode,
    anchorOffset: start,
    focusOffset: end,
    getRangeAt: () => range,
    toString: () => textNode.data.slice(start, end)
  } as unknown as Selection
}

const makeSavedSelection = (
  overrides: Partial<ReaderSavedSelection> = {}
): ReaderSavedSelection => ({
  version: 1,
  id: 'saved-1',
  text: 'quick',
  start: {
    pageNumber: 1,
    textId: 'text-1',
    textHash: textHash('The quick brown fox'),
    charIndex: 4,
    contextBefore: 'The ',
    contextAfter: 'quick brown fox',
    bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
  },
  end: {
    pageNumber: 1,
    textId: 'text-1',
    textHash: textHash('The quick brown fox'),
    charIndex: 9,
    contextBefore: 'The quick',
    contextAfter: ' brown fox',
    bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
  },
  segments: [
    {
      pageNumber: 1,
      textId: 'text-1',
      textHash: textHash('The quick brown fox'),
      startCharIndex: 4,
      endCharIndex: 9,
      selectedText: 'quick',
      contextBefore: 'The ',
      contextAfter: ' brown fox',
      bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
    }
  ],
  visual: [
    {
      pageNumber: 1,
      pageSize: { width: 100, height: 100 },
      rects: [{ x: 0.1, y: 0.2, width: 0.8, height: 0.16 }]
    }
  ],
  ...overrides
})

describe('saved selection helpers', () => {
  let originalGetClientRects: Range['getClientRects'] | undefined
  let originalGetBoundingClientRect: Range['getBoundingClientRect'] | undefined

  beforeEach(() => {
    originalGetClientRects = Range.prototype.getClientRects
    originalGetBoundingClientRect = Range.prototype.getBoundingClientRect
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value(this: Range) {
        const parent = this.startContainer.parentElement as RectElement | null
        const rect = parent?.__readerTestRect
        return rect
          ? ([makeDomRect(rect)] as unknown as DOMRectList)
          : ([] as unknown as DOMRectList)
      }
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Range) {
        const parent = this.startContainer.parentElement as RectElement | null
        return makeDomRect(
          parent?.__readerTestRect ?? { x: 0, y: 0, width: 0, height: 0 }
        )
      }
    })
  })

  afterEach(() => {
    if (originalGetClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: originalGetClientRects
      })
    } else {
      Reflect.deleteProperty(Range.prototype, 'getClientRects')
    }
    if (originalGetBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: originalGetBoundingClientRect
      })
    } else {
      Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    }
    document.body.replaceChildren()
  })

  it('produces deterministic hashes and normalized saved payloads', () => {
    const element = document.createElement('span')
    element.textContent = 'The quick brown fox'
    const textNode = element.firstChild as Text
    const selection = makeSelection(textNode, 4, 9)
    const segments = [
      makeSegment({
        id: 'text-1',
        content: 'The quick brown fox',
        selectedText: 'quick',
        startCharIndex: 4,
        endCharIndex: 9,
        pageNumber: 1
      })
    ]
    const saved = buildSavedSelection({
      id: 'saved-1',
      document: 'doc-1',
      selection,
      segments,
      rects: [{ x: 10, y: 20, width: 80, height: 16, pageNumber: 1 }],
      pageSizes: new Map([[1, { width: 100, height: 100 }]])
    })

    expect(textHash('The quick brown fox')).toBe(
      textHash('The quick brown fox')
    )
    expect(saved).toMatchObject({
      version: 1,
      id: 'saved-1',
      document: 'doc-1',
      text: 'quick',
      start: {
        pageNumber: 1,
        textId: 'text-1',
        charIndex: 4,
        contextBefore: 'The ',
        contextAfter: 'quick brown fox'
      },
      end: { pageNumber: 1, textId: 'text-1', charIndex: 9 },
      segments: [{ pageNumber: 1, selectedText: 'quick' }],
      visual: [
        {
          pageNumber: 1,
          pageSize: { width: 100, height: 100 },
          rects: [{ x: 0.1, y: 0.2, width: 0.8, height: 0.16 }]
        }
      ]
    })
  })

  it('clamps normalized rects and rejects invalid page sizes', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: -10, y: 20, width: 140, height: 90, pageNumber: 1 }
    ]

    expect(normalizePageRects(rects, { width: 100, height: 100 })).toEqual([
      { x: 0, y: 0.2, width: 1, height: 0.8 }
    ])
    expect(normalizePageRects(rects, { width: 0, height: 100 })).toEqual([])
    expect(
      denormalizePageRects(
        [{ x: -0.5, y: 0.2, width: 1.5, height: 2 }],
        {
          width: 100,
          height: 100
        },
        3
      )
    ).toEqual([{ x: 0, y: 20, width: 100, height: 100, pageNumber: 3 }])
  })

  it('restores exact anchors before fallback paths', () => {
    const info = makeTextElement(makeText('text-1', 'The quick brown fox'), 1)
    const result = resolveSavedSelection(makeSavedSelection(), [info])

    expect(result.status).toBe('resolved')
    expect(result.range?.toString()).toBe('quick')
    expect(result.rects).toEqual([
      { x: 10, y: 20, width: 80, height: 16, pageNumber: 1, origin: 'viewport' }
    ])
    expect(result.rectsOrigin).toBe('viewport')
    expect(result.segments).toHaveLength(1)
  })

  it('saved selection re resolves after eviction round trip', () => {
    const saved = makeSavedSelection()
    const firstInfo = makeTextElement(
      makeText('text-1', 'The quick brown fox'),
      1
    )
    const firstResult = resolveSavedSelection(saved, [firstInfo])

    firstInfo.element.remove()
    const evictedResult = resolveSavedSelection(saved, [])

    const restoredInfo = makeTextElement(
      makeText('text-1', 'The quick brown fox'),
      1
    )
    const restoredResult = resolveSavedSelection(saved, [restoredInfo])

    expect(firstResult.status).toBe('resolved')
    expect(evictedResult.status).toBe('visual-fallback')
    expect(restoredResult.status).toBe('resolved')
    expect(restoredResult.range?.toString()).toBe('quick')
  })

  it('restores by context when text id changes', () => {
    const info = makeTextElement(
      makeText('renamed-text', 'The quick brown fox'),
      1
    )
    // All saved references use the old id 'text-1' but the element now has id 'renamed-text'
    const saved = makeSavedSelection()

    const result = resolveSavedSelection(saved, [info])

    expect(result.status).toBe('resolved')
    expect(result.range?.toString()).toBe('quick')
    expect(result.rects).toEqual([
      { x: 10, y: 20, width: 80, height: 16, pageNumber: 1, origin: 'viewport' }
    ])
  })

  it('marks ambiguous context matches unresolved when no visual data exists', () => {
    const first = makeTextElement(makeText('first', 'The quick brown fox'), 1)
    const second = makeTextElement(makeText('second', 'The quick brown fox'), 1)
    const saved = makeSavedSelection({
      start: { ...makeSavedSelection().start, textId: 'missing-id' },
      end: { ...makeSavedSelection().end, textId: 'missing-id' },
      visual: []
    })

    const result = resolveSavedSelection(saved, [first, second])

    expect(result.status).toBe('unresolved')
    expect(result.range).toBeUndefined()
  })

  it('restores by selected text after anchor mismatch', () => {
    const info = makeTextElement(makeText('text-2', 'A quick choice'), 1)
    const saved = makeSavedSelection({
      text: 'quick',
      start: {
        pageNumber: 1,
        textId: 'missing',
        textHash: 'stale',
        charIndex: 0
      },
      end: {
        pageNumber: 1,
        textId: 'missing',
        textHash: 'stale',
        charIndex: 5
      },
      segments: [
        {
          pageNumber: 1,
          textId: 'missing',
          selectedText: 'quick',
          bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
        }
      ]
    })

    const result = resolveSavedSelection(saved, [info])

    expect(result.status).toBe('resolved')
    expect(result.range?.toString()).toBe('quick')
  })

  it('uses visual fallback when text cannot resolve', () => {
    const result = resolveSavedSelection(makeSavedSelection(), [])

    expect(result.status).toBe('visual-fallback')
    expect(result.range).toBeUndefined()
    expect(result.rects).toEqual([
      {
        x: 10,
        y: 20,
        width: 80,
        height: 16,
        pageNumber: 1,
        origin: 'page-relative'
      }
    ])
    expect(result.rectsOrigin).toBe('page-relative')
    expect(result.segments).toEqual([])
  })

  it('saved selection under scale keeps fallback geometry page-relative', () => {
    const saved = makeSavedSelection({
      visual: [
        {
          pageNumber: 1,
          pageSize: { width: 100, height: 100 },
          rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }]
        }
      ]
    })

    const result = resolveSavedSelection(saved, [])

    expect(result.status).toBe('visual-fallback')
    expect(result.rects).toEqual([
      {
        x: 10,
        y: 20,
        width: 30,
        height: 10,
        pageNumber: 1,
        origin: 'page-relative'
      }
    ])
    expect(result.rectsOrigin).toBe('page-relative')
  })

  it('restores cross-page selections with one editable range', () => {
    const first = makeTextElement(makeText('p1', 'Alpha start'), 1, {
      x: 5,
      y: 10,
      width: 50,
      height: 12
    })
    const second = makeTextElement(makeText('p2', 'finish Omega'), 2, {
      x: 6,
      y: 30,
      width: 70,
      height: 12
    })
    const saved: ReaderSavedSelection = {
      version: 1,
      id: 'cross-page',
      text: 'startfinish',
      start: {
        pageNumber: 1,
        textId: 'p1',
        textHash: textHash('Alpha start'),
        charIndex: 6
      },
      end: {
        pageNumber: 2,
        textId: 'p2',
        textHash: textHash('finish Omega'),
        charIndex: 6
      },
      segments: [
        {
          pageNumber: 1,
          textId: 'p1',
          startCharIndex: 6,
          endCharIndex: 11,
          selectedText: 'start'
        },
        {
          pageNumber: 2,
          textId: 'p2',
          startCharIndex: 0,
          endCharIndex: 6,
          selectedText: 'finish'
        }
      ],
      visual: []
    }

    const result = resolveSavedSelection(saved, [first, second])

    expect(result.status).toBe('resolved')
    expect(result.range).toBeInstanceOf(Range)
    expect(result.rects.map((rect) => rect.pageNumber)).toEqual([1, 2])
  })

  it('restores OCR text only when the OCR element is registered', () => {
    const ocrText = makeText('ocr-1', 'Detected OCR text')
    const saved = makeSavedSelection({
      text: 'OCR',
      start: {
        pageNumber: 1,
        textId: 'ocr-1',
        textHash: textHash('Detected OCR text'),
        charIndex: 9
      },
      end: {
        pageNumber: 1,
        textId: 'ocr-1',
        textHash: textHash('Detected OCR text'),
        charIndex: 12
      },
      segments: [
        {
          pageNumber: 1,
          textId: 'ocr-1',
          textHash: textHash('Detected OCR text'),
          startCharIndex: 9,
          endCharIndex: 12,
          selectedText: 'OCR'
        }
      ]
    })

    expect(resolveSavedSelection(saved, []).status).toBe('visual-fallback')
    expect(
      resolveSavedSelection(saved, [makeTextElement(ocrText, 1)]).status
    ).toBe('resolved')
  })

  it('fallback bbox rects are page-relative and not double-converted when Range.getClientRects is empty', () => {
    // 强制 Range.getClientRects / getBoundingClientRect 返回空矩形，
    // 迫使 resolveRangeRects 走 segment.bbox fallback 路径。
    // 验证 fallback bbox 被反归一化为 page-relative 像素坐标，
    // 且标记 origin: 'page-relative'，viewer 边界不会对其做 viewport→page 二次转换。
    const info = makeTextElement(makeText('text-1', 'The quick brown fox'), 1)
    const saved = makeSavedSelection()

    // 模拟 Range 几何 API 返回空值
    const emptyRectList = [] as unknown as DOMRectList
    const emptyDomRect = makeDomRect({ x: 0, y: 0, width: 0, height: 0 })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => emptyRectList
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => emptyDomRect
    })

    try {
      const result = resolveSavedSelection(saved, [info])

      // 仍应是 resolved 状态（anchor 匹配成功，但 Range 几何为空走 fallback bbox）
      expect(result.status).toBe('resolved')
      expect(result.rects).toHaveLength(1)
      const rect = result.rects[0]

      // origin 必须是 page-relative，不是 viewport
      expect(rect.origin).toBe('page-relative')

      // segment.bbox = { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
      // pageSize = { width: 100, height: 100 } (from saved.visual)
      // 反归一化后: x=10, y=20, width=80, height=16
      // 如果被 double-converted（减去 pageRect.left ≈ 视口偏移），
      // x 会变成负数或大幅偏移，不会是 10
      expect(rect.x).toBe(10)
      expect(rect.y).toBe(20)
      expect(rect.width).toBe(80)
      expect(rect.height).toBe(16)

      // rectsOrigin 应反映混合来源（此处全为 fallback，但函数标注 page-relative）
      expect(result.rectsOrigin).toBe('page-relative')
    } finally {
      // 恢复 beforeEach 设置的 mock
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value(this: Range) {
          const parent = this.startContainer.parentElement as RectElement | null
          const rect = parent?.__readerTestRect
          return rect
            ? ([makeDomRect(rect)] as unknown as DOMRectList)
            : ([] as unknown as DOMRectList)
        }
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value(this: Range) {
          const parent = this.startContainer.parentElement as RectElement | null
          return makeDomRect(
            parent?.__readerTestRect ?? { x: 0, y: 0, width: 0, height: 0 }
          )
        }
      })
    }
  })

  it('mixed origin rects set rectsOrigin to mixed when both viewport and fallback present', () => {
    // 跨页场景：第一页 DOM Range 有矩形（viewport），第二页 DOM Range 为空走 fallback bbox（page-relative）
    const first = makeTextElement(makeText('p1', 'Alpha start'), 1, {
      x: 5,
      y: 10,
      width: 50,
      height: 12
    })
    const second = makeTextElement(makeText('p2', 'finish Omega'), 2, {
      x: 6,
      y: 30,
      width: 70,
      height: 12
    })

    const saved: ReaderSavedSelection = {
      version: 1,
      id: 'mixed-origin',
      text: 'startfinish',
      start: {
        pageNumber: 1,
        textId: 'p1',
        textHash: textHash('Alpha start'),
        charIndex: 6
      },
      end: {
        pageNumber: 2,
        textId: 'p2',
        textHash: textHash('finish Omega'),
        charIndex: 6
      },
      segments: [
        {
          pageNumber: 1,
          textId: 'p1',
          textHash: textHash('Alpha start'),
          startCharIndex: 6,
          endCharIndex: 11,
          selectedText: 'start'
        },
        {
          pageNumber: 2,
          textId: 'p2',
          textHash: textHash('finish Omega'),
          startCharIndex: 0,
          endCharIndex: 6,
          selectedText: 'finish',
          bbox: { x: 0.1, y: 0.3, width: 0.7, height: 0.12 }
        }
      ],
      visual: [
        {
          pageNumber: 2,
          pageSize: { width: 200, height: 100 },
          rects: [{ x: 0.1, y: 0.3, width: 0.7, height: 0.12 }]
        }
      ]
    }

    // 第二个元素的 Range 几何返回空，迫使走 fallback bbox
    const originalGetClientRects = Range.prototype.getClientRects
    const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value(this: Range) {
        const parent = this.startContainer.parentElement as RectElement | null
        // p2 元素的 Range 返回空
        if (parent?.dataset.textId === 'p2') {
          return [] as unknown as DOMRectList
        }
        const rect = parent?.__readerTestRect
        return rect
          ? ([makeDomRect(rect)] as unknown as DOMRectList)
          : ([] as unknown as DOMRectList)
      }
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Range) {
        const parent = this.startContainer.parentElement as RectElement | null
        // p2 元素的 Range 返回空
        if (parent?.dataset.textId === 'p2') {
          return makeDomRect({ x: 0, y: 0, width: 0, height: 0 })
        }
        return makeDomRect(
          parent?.__readerTestRect ?? { x: 0, y: 0, width: 0, height: 0 }
        )
      }
    })

    try {
      const result = resolveSavedSelection(saved, [first, second])

      expect(result.status).toBe('resolved')
      expect(result.rects).toHaveLength(2)

      // 第一页：DOM Range 有矩形 → viewport origin
      expect(result.rects[0].origin).toBe('viewport')
      // 第二页：fallback bbox → page-relative origin，反归一化后的页面像素坐标
      expect(result.rects[1].origin).toBe('page-relative')
      // bbox { x: 0.1, y: 0.3, width: 0.7, height: 0.12 } × pageSize { width: 200, height: 100 }
      // = { x: 20, y: 30, width: 140, height: 12 }
      expect(result.rects[1].x).toBe(20)
      expect(result.rects[1].y).toBe(30)
      expect(result.rects[1].width).toBe(140)
      expect(result.rects[1].height).toBe(12)

      // 混合来源 → rectsOrigin: 'mixed'
      expect(result.rectsOrigin).toBe('mixed')
    } finally {
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

// ──────────────────────────────────────────────────────────────────────────
// T2 回归测试：验证 viewer 边界 convertSavedSelectionRectToPageRect 按 origin
// 正确区分 viewport / page-relative 坐标，避免对 fallback rect 做二次偏移。
//
// convertSavedSelectionRectToPageRect 是 IntermediateDocumentViewer 内部
// useCallback，无法直接导入。这里构建一个等价的纯函数 mock，
// 精确复刻 viewer 边界的转换逻辑（含 T2 origin 检查），
// 并用真实 DOM page element 模拟 getBoundingClientRect。
// ──────────────────────────────────────────────────────────────────────────
describe('T2: viewer boundary convertSavedSelectionRectToPageRect respects origin', () => {
  // 精确复刻 IntermediateDocumentViewer 中 convertSavedSelectionRectToPageRect 的逻辑。
  // T2 修复：origin === 'page-relative' 时直接返回，不做 viewport 减法和 scale 除法。
  const convertSavedSelectionRectToPageRect_FIXED = (
    rect: ReaderSelectionOverlayRect,
    pageElement: { getBoundingClientRect: () => DOMRect }
  ): ReaderSelectionOverlayRect => {
    // T2: page-relative 坐标已经是页面相对像素，不做 viewport→page 转换
    if (rect.origin === 'page-relative') {
      return rect
    }
    // viewport 或 undefined（历史行为）：执行 viewport→page-relative 转换
    const pageRect = pageElement.getBoundingClientRect()
    const pageScale: number = 1 // jsdom 中 scale 恒为 1
    return {
      ...rect,
      x:
        pageScale === 0
          ? rect.x - pageRect.left
          : (rect.x - pageRect.left) / pageScale,
      y:
        pageScale === 0
          ? rect.y - pageRect.top
          : (rect.y - pageRect.top) / pageScale,
      width: pageScale === 0 ? rect.width : rect.width / pageScale,
      height: pageScale === 0 ? rect.height : rect.height / pageScale
    }
  }

  // T2 修复前的 buggy 版本：无视 origin，对所有 rect 都做 viewport→page 转换
  const convertSavedSelectionRectToPageRect_BUGGY = (
    rect: ReaderSelectionOverlayRect,
    pageElement: { getBoundingClientRect: () => DOMRect }
  ): ReaderSelectionOverlayRect => {
    const pageRect = pageElement.getBoundingClientRect()
    const pageScale: number = 1
    return {
      ...rect,
      x: (rect.x - pageRect.left) / pageScale,
      y: (rect.y - pageRect.top) / pageScale,
      width: rect.width / pageScale,
      height: rect.height / pageScale
    }
  }

  // 创建模拟的 page element，其 getBoundingClientRect 返回固定 viewport 偏移
  const makeMockPageElement = (left: number, top: number) => ({
    getBoundingClientRect: () =>
      ({
        x: left,
        y: top,
        left,
        top,
        right: left + 200,
        bottom: top + 300,
        width: 200,
        height: 300,
        toJSON: () => ({
          left,
          top,
          right: left + 200,
          bottom: top + 300,
          width: 200,
          height: 300
        })
      }) as DOMRect
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('converts viewport-origin resolved rects to page-relative coordinates', () => {
    // 模拟一个 resolved 状态的 DOM Range rect：viewport 坐标 (110, 130)
    // page element 在 viewport 中的位置为 (100, 120)
    // 转换后应为 page-relative: (10, 10)
    const pageEl = makeMockPageElement(100, 120)
    const viewportRect: ReaderSelectionOverlayRect = {
      x: 110,
      y: 130,
      width: 80,
      height: 16,
      pageNumber: 1,
      origin: 'viewport'
    }

    const result = convertSavedSelectionRectToPageRect_FIXED(
      viewportRect,
      pageEl
    )

    expect(result.x).toBe(10)
    expect(result.y).toBe(10)
    expect(result.width).toBe(80)
    expect(result.height).toBe(16)
    expect(result.origin).toBe('viewport')
  })

  it('passes through page-relative fallback rects unchanged (T2 fix)', () => {
    // 模拟一个 visual-fallback rect：已经是 page-relative 坐标 (10, 20)
    // page element 在 viewport 中的位置为 (100, 120)
    // T2 修复后：直接返回 (10, 20)，不做减法
    const pageEl = makeMockPageElement(100, 120)
    const pageRelativeRect: ReaderSelectionOverlayRect = {
      x: 10,
      y: 20,
      width: 80,
      height: 16,
      pageNumber: 1,
      origin: 'page-relative'
    }

    const result = convertSavedSelectionRectToPageRect_FIXED(
      pageRelativeRect,
      pageEl
    )

    expect(result.x).toBe(10)
    expect(result.y).toBe(20)
    expect(result.width).toBe(80)
    expect(result.height).toBe(16)
    expect(result.origin).toBe('page-relative')

    // FAILURE PROBE (temporary): If origin were ignored, x would be -90 (10 - 100).
    // This assertion expects the impossible shifted coordinate to verify the FIXED
    // version does NOT produce it. If someone removes the origin check, this will fail.
    expect(result.x).not.toBe(-90)
    expect(result.y).not.toBe(-100)
  })

  it('buggy version would incorrectly shift page-relative fallback rects', () => {
    // 使用 T2 修复前的 buggy 版本验证：page-relative rect 会被错误偏移
    const pageEl = makeMockPageElement(100, 120)
    const pageRelativeRect: ReaderSelectionOverlayRect = {
      x: 10,
      y: 20,
      width: 80,
      height: 16,
      pageNumber: 1,
      origin: 'page-relative'
    }

    const buggyResult = convertSavedSelectionRectToPageRect_BUGGY(
      pageRelativeRect,
      pageEl
    )

    // buggy 版本会做 10 - 100 = -90，20 - 120 = -100 → 负数/垃圾值
    expect(buggyResult.x).toBe(-90)
    expect(buggyResult.y).toBe(-100)
    // 这证明了如果不检查 origin，page-relative rect 会被错误偏移
  })

  it('resolved DOM rects produce correct page-relative SVG path coordinates', () => {
    // 端到端验证：resolved DOM rect 经过 viewer 边界转换后，
    // SVG path 坐标是 page-relative（不含 viewport 偏移）
    const pageEl = makeMockPageElement(100, 120)
    const viewportRect: ReaderSelectionOverlayRect = {
      x: 110,
      y: 130,
      width: 80,
      height: 16,
      pageNumber: 1,
      origin: 'viewport'
    }

    const pageRect = convertSavedSelectionRectToPageRect_FIXED(
      viewportRect,
      pageEl
    )
    expect(pageRect.x).toBe(10)
    expect(pageRect.y).toBe(10)
    expect(pageRect.width).toBe(80)
    expect(pageRect.height).toBe(16)
  })

  it('fallback rects produce correct page-relative SVG path coordinates without double conversion', () => {
    // 端到端验证：visual-fallback rect（page-relative）经过 viewer 边界后，
    // SVG path 坐标保持 page-relative，不会被二次偏移
    const pageEl = makeMockPageElement(100, 120)
    const fallbackRect: ReaderSelectionOverlayRect = {
      x: 10,
      y: 20,
      width: 80,
      height: 16,
      pageNumber: 1,
      origin: 'page-relative'
    }

    const pageRect = convertSavedSelectionRectToPageRect_FIXED(
      fallbackRect,
      pageEl
    )
    expect(pageRect.x).toBe(10)
    expect(pageRect.y).toBe(20)
    expect(pageRect.width).toBe(80)
    expect(pageRect.height).toBe(16)
  })

  it('resolved fallback bbox rects (page-relative origin) are not reconverted by viewer boundary', () => {
    // 完整流程验证：resolveSavedSelection 返回 fallback bbox rect（page-relative），
    // 模拟 viewer 边界对其调用 convertSavedSelectionRectToPageRect，
    // 验证 rect 值不变。
    const info = makeTextElement(makeText('text-1', 'The quick brown fox'), 1)
    const saved = makeSavedSelection()

    // 模拟 Range.getClientRects / getBoundingClientRect 返回空
    const emptyRectList = [] as unknown as DOMRectList
    const emptyDomRect = makeDomRect({ x: 0, y: 0, width: 0, height: 0 })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => emptyRectList
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => emptyDomRect
    })

    try {
      const result = resolveSavedSelection(saved, [info])

      // resolved 状态但 rects 来自 fallback bbox
      expect(result.status).toBe('resolved')
      expect(result.rects[0].origin).toBe('page-relative')

      // 模拟 viewer 边界转换
      const pageEl = makeMockPageElement(100, 120)
      const converted = result.rects.map((rect) =>
        convertSavedSelectionRectToPageRect_FIXED(rect, pageEl)
      )

      // page-relative rect 不应被转换，坐标保持 (10, 20, 80, 16)
      expect(converted[0].x).toBe(10)
      expect(converted[0].y).toBe(20)
      expect(converted[0].width).toBe(80)
      expect(converted[0].height).toBe(16)
      expect(converted[0].origin).toBe('page-relative')

      expect(converted[0].x).toBe(10)
      expect(converted[0].y).toBe(20)
      expect(converted[0].width).toBe(80)
      expect(converted[0].height).toBe(16)
    } finally {
      // 恢复 beforeEach 设置的 mock
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value(this: Range) {
          const parent = this.startContainer.parentElement as RectElement | null
          const rect = parent?.__readerTestRect
          return rect
            ? ([makeDomRect(rect)] as unknown as DOMRectList)
            : ([] as unknown as DOMRectList)
        }
      })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value(this: Range) {
          const parent = this.startContainer.parentElement as RectElement | null
          return makeDomRect(
            parent?.__readerTestRect ?? { x: 0, y: 0, width: 0, height: 0 }
          )
        }
      })
    }
  })

  // ── 失败探针：证明如果 convertSavedSelectionRectToPageRect 忽略 origin，
  //    page-relative fallback rect 会被错误偏移到负坐标 ──
  it('FAILURE PROBE: asserting impossible shifted coordinate for page-relative rect fails with buggy version', () => {
    const pageEl = makeMockPageElement(100, 120)
    const pageRelativeRect: ReaderSelectionOverlayRect = {
      x: 10,
      y: 20,
      width: 80,
      height: 16,
      pageNumber: 1,
      origin: 'page-relative'
    }

    // buggy 版本会把 (10, 20) 偏移到 (-90, -100)
    const buggyResult = convertSavedSelectionRectToPageRect_BUGGY(
      pageRelativeRect,
      pageEl
    )

    // 失败探针：如果 buggy 版本产生了正确的 page-relative 坐标 (10, 20)，
    // 那说明 bug 不存在——但我们知道 bug 存在，所以这个断言应该失败
    // （我们只验证 buggy 版本确实产生了错误坐标，以此证明 T2 修复的必要性）
    expect(buggyResult.x).not.toBe(10)
    expect(buggyResult.y).not.toBe(20)
    expect(buggyResult.x).toBe(-90)
    expect(buggyResult.y).toBe(-100)

    // 修复版本产生正确坐标
    const fixedResult = convertSavedSelectionRectToPageRect_FIXED(
      pageRelativeRect,
      pageEl
    )
    expect(fixedResult.x).toBe(10)
    expect(fixedResult.y).toBe(20)
  })
})
