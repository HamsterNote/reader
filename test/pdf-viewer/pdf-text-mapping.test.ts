// HAM-89 / tasks.md 3.2：canonical 端点 ↔ text layer DOM 映射（jsdom）。
// 覆盖：属性注入、UTF-16 偏移正逆映射、兼容字符、跨页选区序列化。

import { describe, expect, it } from 'vitest'

import {
  buildCanonicalPageText,
  canonicalOffsetToDomPosition,
  canonicalRangeToDomRange,
  domPositionToCanonicalOffset,
  enhanceTextLayer
} from '../../src/pdf/pdfTextMapping'

const makeTextLayerDiv = (texts: readonly string[]): HTMLElement => {
  const div = document.createElement('div')
  div.className = 'textLayer'
  for (const text of texts) {
    const span = document.createElement('span')
    span.textContent = text
    div.appendChild(span)
  }
  document.body.appendChild(div)
  return div
}

describe('buildCanonicalPageText', () => {
  it('无分隔符拼接，span 端点累计正确', () => {
    const page = buildCanonicalPageText(1, [
      { str: 'Left column line one' },
      { str: 'Left column line two' }
    ])
    expect(page.text).toBe('Left column line oneLeft column line two')
    expect(page.spans[0].canonicalStart).toBe(0)
    expect(page.spans[0].canonicalEnd).toBe(20)
    expect(page.spans[1].canonicalStart).toBe(20)
  })

  it.each(['ﬁ x', '⑩ x', 'Ⅷ x', 'e\u0301 x'])(
    'preserves raw TextItem.str %s and UTF-16 boundaries',
    (str) => {
      const page = buildCanonicalPageText(1, [{ str }])
      expect(page.text).toBe(str)
      expect(page.spans[0].canonicalToDom).toEqual(
        Array.from({ length: str.length + 1 }, (_, i) => i)
      )
    }
  )
})

describe('enhanceTextLayer', () => {
  it('按序匹配 span 并注入三件套属性', () => {
    const page = buildCanonicalPageText(2, [
      { str: 'Hello ' },
      { str: 'world' }
    ])
    const div = makeTextLayerDiv(['Hello ', 'world'])

    expect(enhanceTextLayer(div, page)).toBe(true)
    const spans = div.querySelectorAll('span')
    expect(spans[0].getAttribute('data-text-id')).toBe('page-2-item-0')
    expect(spans[0].getAttribute('data-page-number')).toBe('2')
    expect(spans[0].getAttribute('data-selection-start-offset')).toBe('0')
    expect(spans[1].getAttribute('data-selection-start-offset')).toBe('6')
  })

  it('重复文本按顺序分配到不同 span（不误配首次出现）', () => {
    const page = buildCanonicalPageText(1, [
      { str: '重复的段落文本。' },
      { str: '间隔' },
      { str: '重复的段落文本。' }
    ])
    const div = makeTextLayerDiv([
      '重复的段落文本。',
      '间隔',
      '重复的段落文本。'
    ])

    expect(enhanceTextLayer(div, page)).toBe(true)
    const spans = div.querySelectorAll('span')
    expect(spans[0].getAttribute('data-text-id')).toBe('page-1-item-0')
    expect(spans[2].getAttribute('data-text-id')).toBe('page-1-item-2')
    expect(spans[2].getAttribute('data-selection-start-offset')).toBe('10')
  })

  it('存在无法匹配的 span 时返回 false 且不静默近似', () => {
    const page = buildCanonicalPageText(1, [{ str: 'abc' }])
    const div = makeTextLayerDiv(['abc', '多出的一段'])
    expect(enhanceTextLayer(div, page)).toBe(false)
    // 未命中的元素不带属性。
    expect(div.children[1].getAttribute('data-text-id')).toBeNull()
  })

  it('matches raw ligatures without changing public offsets', () => {
    const page = buildCanonicalPageText(1, [{ str: 'ﬁ x' }])
    const div = makeTextLayerDiv(['ﬁ x'])
    expect(enhanceTextLayer(div, page)).toBe(true)
    expect(div.children[0].getAttribute('data-text-id')).toBe('page-1-item-0')
  })
})

describe('domPositionToCanonicalOffset / canonicalOffsetToDomPosition', () => {
  it('恒等映射下正逆一致', () => {
    const page = buildCanonicalPageText(1, [
      { str: 'Hello ' },
      { str: 'world' }
    ])
    const div = makeTextLayerDiv(['Hello ', 'world'])
    enhanceTextLayer(div, page)

    const secondSpan = div.children[1] as HTMLElement
    const textNode = secondSpan.firstChild as Text
    // 'world' 的 'r' 之后：dom offset 2 → canonical 6 + 2 = 8
    expect(domPositionToCanonicalOffset(textNode, 2, page)).toBe(8)

    const position = canonicalOffsetToDomPosition(page, 8, div)
    expect(position?.node).toBe(textNode)
    expect(position?.offset).toBe(2)
  })

  it('restores and serializes offsets after an unexpanded compatibility character', () => {
    const page = buildCanonicalPageText(1, [{ str: 'ﬁ x' }])
    const div = makeTextLayerDiv(['ﬁ x'])
    enhanceTextLayer(div, page)

    const textNode = (div.children[0] as HTMLElement).firstChild as Text
    expect(domPositionToCanonicalOffset(textNode, 1, page)).toBe(1)
    expect(domPositionToCanonicalOffset(textNode, 2, page)).toBe(2)

    const midCluster = canonicalOffsetToDomPosition(page, 1, div)
    expect(midCluster?.offset).toBe(1)
  })

  it('未增强元素返回 null', () => {
    const page = buildCanonicalPageText(1, [{ str: 'abc' }])
    const stray = document.createElement('span')
    stray.textContent = 'abc'
    document.body.appendChild(stray)
    expect(
      domPositionToCanonicalOffset(stray.firstChild as Text, 1, page)
    ).toBeNull()
  })
})

describe('canonicalRangeToDomRange', () => {
  it('跨 span range 还原选中文字', () => {
    const page = buildCanonicalPageText(1, [
      { str: 'Hello ' },
      { str: 'world' }
    ])
    const div = makeTextLayerDiv(['Hello ', 'world'])
    enhanceTextLayer(div, page)

    const range = canonicalRangeToDomRange(page, 3, 9, div)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('lo wor')
  })
})
