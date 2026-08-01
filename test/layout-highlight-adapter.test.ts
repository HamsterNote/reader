import { IntermediateText, TextDir } from '@hamster-note/types'
import { describe, expect, it, vi } from 'vitest'

import { deriveLayoutSelectionRange } from '../src/components/IntermediateDocumentViewer/layoutHighlightAdapter'
import type { ReaderSelectionRange } from '../src/types/selection'

type TextFixture = {
  readonly id: string
  readonly content: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly dir?: TextDir
}

const makeText = ({
  id,
  content,
  x,
  y,
  width,
  height,
  dir = TextDir.LTR
}: TextFixture) =>
  new IntermediateText({
    id,
    content,
    fontSize: height,
    fontFamily: 'sans-serif',
    fontWeight: 400,
    italic: false,
    color: '#000000',
    polygon: [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height]
    ],
    lineHeight: height,
    ascent: height * 0.8,
    descent: height * 0.2,
    dir,
    skew: 0,
    isEOL: false
  })

const textRange: ReaderSelectionRange = {
  id: 'text-created-range',
  text: 'cdefgh',
  start: { selectionId: 'page-1', offset: 2 },
  end: { selectionId: 'page-1', offset: 8 },
  createdAt: 123,
  overlayRectType: 'percent',
  rectsBySelectionId: {
    'page-1': [{ x: 5, y: 10, width: 70, height: 20 }]
  }
}

describe('Layout highlight adapter', () => {
  it('maps a Text-created range to canonical Layout rectangles', () => {
    // Given: Text 模式创建的选区跨过同一页的两个绝对定位文本块。
    const textsByPageNumber = new Map([
      [
        1,
        [
          makeText({
            id: 'line-1',
            content: 'abcd',
            x: 100,
            y: 200,
            width: 80,
            height: 20
          }),
          makeText({
            id: 'line-2',
            content: 'efghij',
            x: 20,
            y: 240,
            width: 120,
            height: 20
          })
        ]
      ]
    ])
    const pageSizesByPageNumber = new Map([[1, { width: 400, height: 500 }]])

    // When: range 从 Text runtime 坐标转换到 Layout canonical 坐标。
    const range = deriveLayoutSelectionRange({
      range: textRange,
      textsByPageNumber,
      pageSizesByPageNumber,
      overlayRectType: 'percent'
    })

    // Then: 字符锚点保持不变，矩形按文本块几何裁切并转换为页面百分比。
    expect(range).toMatchObject({
      start: textRange.start,
      end: textRange.end,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-1': [
          { x: 35, y: 40, width: 10, height: 4 },
          { x: 5, y: 48, width: 20, height: 4 }
        ]
      }
    })
    expect(textRange.rectsBySelectionId['page-1']).toEqual([
      { x: 5, y: 10, width: 70, height: 20 }
    ])
  })

  it('slices an RTL text rectangle from its visual right edge', () => {
    // Given: 一个从右向左排版的四字符文本块。
    const textsByPageNumber = new Map([
      [
        1,
        [
          makeText({
            id: 'rtl-line',
            content: 'אבגד',
            x: 100,
            y: 200,
            width: 80,
            height: 20,
            dir: TextDir.RTL
          })
        ]
      ]
    ])

    // When: 选中中间两个字符并转换为 Layout 像素坐标。
    const range = deriveLayoutSelectionRange({
      range: {
        ...textRange,
        start: { selectionId: 'page-1', offset: 1 },
        end: { selectionId: 'page-1', offset: 3 }
      },
      textsByPageNumber,
      pageSizesByPageNumber: new Map([[1, { width: 400, height: 500 }]]),
      overlayRectType: 'px'
    })

    // Then: 选区从视觉右侧按字符比例裁切。
    expect(range.rectsBySelectionId['page-1']).toEqual([
      { x: 120, y: 200, width: 40, height: 20 }
    ])
  })

  it('slices a top-to-bottom text rectangle along its vertical axis', () => {
    // Given: 一个从上到下排版的四字符文本块。
    const textsByPageNumber = new Map([
      [
        1,
        [
          makeText({
            id: 'ttb-line',
            content: '天地玄黄',
            x: 50,
            y: 100,
            width: 20,
            height: 80,
            dir: TextDir.TTB
          })
        ]
      ]
    ])

    // When: 选中中间两个字符并转换为 Layout 像素坐标。
    const range = deriveLayoutSelectionRange({
      range: {
        ...textRange,
        start: { selectionId: 'page-1', offset: 1 },
        end: { selectionId: 'page-1', offset: 3 }
      },
      textsByPageNumber,
      pageSizesByPageNumber: new Map([[1, { width: 400, height: 500 }]]),
      overlayRectType: 'px'
    })

    // Then: 选区沿文本块纵轴按字符比例裁切。
    expect(range.rectsBySelectionId['page-1']).toEqual([
      { x: 50, y: 120, width: 20, height: 40 }
    ])
  })

  it('uses proportional glyph advances instead of dividing a text box by character count', () => {
    // Given: 前半段是窄字形、后半段是宽字形，整个文本框宽 160px。
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const measureText = vi.fn((content: string) => ({
      width: [...content].reduce(
        (width, character) => width + (character === 'i' ? 5 : 20),
        0
      )
    }))
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({ measureText }))
    })

    try {
      const text = makeText({
        id: 'proportional-line',
        content: 'iiiiWWWW',
        x: 100,
        y: 200,
        width: 160,
        height: 20
      })

      // When: 只选中前四个窄字形。
      const range = deriveLayoutSelectionRange({
        range: {
          ...textRange,
          text: 'iiii',
          start: { selectionId: 'page-1', offset: 0 },
          end: { selectionId: 'page-1', offset: 4 }
        },
        textsByPageNumber: new Map([[1, [text]]]),
        pageSizesByPageNumber: new Map([[1, { width: 400, height: 500 }]]),
        overlayRectType: 'px'
      })

      // Then: 选区按 20/100 的真实字形 advance 占比，而不是按 4/8 字符占比。
      expect(range.rectsBySelectionId['page-1']).toEqual([
        { x: 100, y: 200, width: 32, height: 20 }
      ])
    } finally {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext
      })
    }
  })
})
