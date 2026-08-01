import { IntermediateText, TextDir } from '@hamster-note/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveLayoutSelectionRange } from '../src/components/IntermediateDocumentViewer/layoutHighlightAdapter'
import { getTextBbox } from '../src/components/IntermediateDocumentViewer/pageContentGeometry'
import { buildTextSpanStyle } from '../src/components/IntermediateDocumentViewer/textSpanStyle'
import type { ReaderSelectionRange } from '../src/types/selection'

const originalGetContext = HTMLCanvasElement.prototype.getContext

const makeMultilineText = (content = 'iiii\nWWWW\n') =>
  new IntermediateText({
    id: 'multiline-text',
    content,
    fontSize: 20,
    fontFamily: 'sans-serif',
    fontWeight: 400,
    italic: false,
    color: '#000000',
    polygon: [
      [100, 200],
      [260, 200],
      [260, 240],
      [100, 240]
    ],
    lineHeight: 20,
    ascent: 16,
    descent: 4,
    dir: TextDir.LTR,
    skew: 0,
    isEOL: false
  })

const makeRange = (
  startOffset: number,
  endOffset: number
): ReaderSelectionRange => ({
  id: 'multiline-range',
  text: '',
  start: { selectionId: 'page-1', offset: startOffset },
  end: { selectionId: 'page-1', offset: endOffset },
  createdAt: 123,
  overlayRectType: 'px',
  rectsBySelectionId: {}
})

const deriveRects = (
  text: IntermediateText,
  startOffset: number,
  endOffset: number
) =>
  deriveLayoutSelectionRange({
    range: makeRange(startOffset, endOffset),
    textsByPageNumber: new Map([[1, [text]]]),
    pageSizesByPageNumber: new Map([[1, { width: 400, height: 500 }]]),
    overlayRectType: 'px'
  }).rectsBySelectionId['page-1']

describe('multiline absolute text highlight geometry', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => {
        const context = {
          font: '',
          measureText: (content: string) => {
            const fontSize = Number.parseFloat(
              context.font
                .split(' ')
                .find((fontPart) => fontPart.endsWith('px')) ?? '20px'
            )
            const width = [...content].reduce((totalWidth, character) => {
              if (character === '\n' || character === '\r') return totalWidth
              return totalWidth + (character === 'i' ? 5 : 20)
            }, 0)
            return { width: width * (fontSize / 20) }
          }
        }
        return context
      })
    })
  })

  afterEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: originalGetContext
    })
  })

  it('uses the widest logical line to scale a multiline span', () => {
    // Given: 第二行比第一行宽，末尾换行不产生额外可见行。
    const text = makeMultilineText()

    // When: Layout 根据 parser bbox 构建绝对定位文本样式。
    const style = buildTextSpanStyle(text, getTextBbox(text), true)

    // Then: 160px bbox 对齐 80px 的最宽行，而不是测量换行拼接后的全文。
    expect(style.transform).toBe('scaleX(2)')
  })

  it('measures width scaling at the rendered font scale', () => {
    // Given: 2× 字体档位让最宽行的自然宽度从 80px 墒至 160px。
    const text = makeMultilineText()

    // When: Layout 构建带用户字体档位的绝对定位文本样式。
    const style = buildTextSpanStyle(text, getTextBbox(text), true, 2)

    // Then: 自然宽度已经等于 bbox，不应再叠加水平缩放。
    expect(style.transform).toBe('')
  })

  it('maps a first-line selection into only the first line slot', () => {
    // Given: 两条可见逻辑行共同占据 40px 高的 parser bbox。
    const text = makeMultilineText()

    // When: 只选中首行的四个窄字形。
    const rects = deriveRects(text, 0, 4)

    // Then: 选框使用首行的 20px 高度，并按最宽行的 advance 缩放宽度。
    expect(rects).toEqual([{ x: 100, y: 200, width: 40, height: 20 }])
  })

  it('maps a second-line selection into the second line slot', () => {
    // Given: 第二行从换行符后的 UTF-16 offset 5 开始。
    const text = makeMultilineText()

    // When: 选中第二行的四个宽字形。
    const rects = deriveRects(text, 5, 9)

    // Then: 选框下移一行，末尾换行不会把 bbox 错分成三行。
    expect(rects).toEqual([{ x: 100, y: 220, width: 160, height: 20 }])
  })

  it('splits a CRLF-spanning selection without highlighting the line break', () => {
    // Given: CRLF 占两个 UTF-16 offset，第二行从 offset 6 开始。
    const text = makeMultilineText('iiii\r\nWWWW')

    // When: 选区覆盖首行末两个 i、CRLF 和第二行前两个 W。
    const rects = deriveRects(text, 2, 8)

    // Then: 换行符不生成矩形，两条可见行各得到一个准确选框。
    expect(rects).toEqual([
      { x: 120, y: 200, width: 20, height: 20 },
      { x: 100, y: 220, width: 80, height: 20 }
    ])
  })
})
