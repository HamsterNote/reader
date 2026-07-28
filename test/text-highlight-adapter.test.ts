import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveTextSelectionRanges } from '../src/components/IntermediateDocumentViewer/textHighlightAdapter'
import type { ReaderSelectionRange } from '../src/types/selection'

const storedRange: ReaderSelectionRange = {
  id: 'text-highlight-1',
  text: 'highlighted',
  start: { selectionId: 'page-1', offset: 2 },
  end: { selectionId: 'page-1', offset: 8 },
  createdAt: 123,
  overlayRectType: 'percent',
  rectsBySelectionId: {
    'page-1': [{ x: 1, y: 2, width: 3, height: 4 }]
  }
}

function makeViewerRoot(): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = `
    <div data-testid="intermediate-text-page-1">
      <div class="hsn-selection-container" data-selection-id="scope:page-1">
        <div class="hsn-selection-content">0123456789</div>
      </div>
    </div>
  `
  document.body.append(root)
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(Range.prototype, 'getClientRects')
  document.body.replaceChildren()
})

describe('Text highlight adapter', () => {
  it('derives current rectangles from canonical range anchors', () => {
    // Given: 持久化 range 的旧矩形与当前文本排版不同。
    const root = makeViewerRoot()
    const container = root.querySelector<HTMLElement>(
      '.hsn-selection-container'
    )
    if (!container) throw new Error('Expected selection container')
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(10, 20, 200, 100)
    )
    const clientRects = Object.assign([new DOMRect(30, 44, 60, 18)], {
      item: (index: number) => clientRects[index] ?? null
    })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: vi.fn(() => clientRects)
    })

    // When: Text 模式从 canonical range 的字符锚点派生运行时 range。
    const [range] = deriveTextSelectionRanges({
      ranges: [storedRange],
      root,
      pageNumbers: [1],
      overlayRectType: 'px'
    })

    // Then: endpoint 与持久数据不变，但运行时矩形使用当前容器几何。
    expect(range).toMatchObject({
      start: storedRange.start,
      end: storedRange.end,
      overlayRectType: 'px',
      rectsBySelectionId: {
        'page-1': [{ x: 20, y: 24, width: 60, height: 18 }]
      }
    })
    expect(storedRange.rectsBySelectionId['page-1']).toEqual([
      { x: 1, y: 2, width: 3, height: 4 }
    ])
  })

  it('recomputes rectangles from unchanged anchors after text reflow', () => {
    // Given: 同一字符锚点在两次排版中返回不同的浏览器矩形。
    const root = makeViewerRoot()
    const container = root.querySelector<HTMLElement>(
      '.hsn-selection-container'
    )
    if (!container) throw new Error('Expected selection container')
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(10, 20, 200, 100)
    )
    const firstRects = Object.assign([new DOMRect(20, 30, 80, 18)], {
      item: (index: number) => firstRects[index] ?? null
    })
    const reflowedRects = Object.assign([new DOMRect(18, 52, 44, 36)], {
      item: (index: number) => reflowedRects[index] ?? null
    })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: vi
        .fn()
        .mockReturnValueOnce(firstRects)
        .mockReturnValueOnce(reflowedRects)
    })

    // When: 字号或容器宽度变化后，用原 range 再次派生。
    const [beforeReflow] = deriveTextSelectionRanges({
      ranges: [storedRange],
      root,
      pageNumbers: [1],
      overlayRectType: 'px'
    })
    const [afterReflow] = deriveTextSelectionRanges({
      ranges: [storedRange],
      root,
      pageNumbers: [1],
      overlayRectType: 'px'
    })

    // Then: canonical anchors 不变，运行时矩形反映最新排版。
    expect(afterReflow?.start).toEqual(beforeReflow?.start)
    expect(afterReflow?.end).toEqual(beforeReflow?.end)
    expect(beforeReflow?.rectsBySelectionId['page-1']).toEqual([
      { x: 10, y: 10, width: 80, height: 18 }
    ])
    expect(afterReflow?.rectsBySelectionId['page-1']).toEqual([
      { x: 8, y: 32, width: 44, height: 36 }
    ])
  })
})
