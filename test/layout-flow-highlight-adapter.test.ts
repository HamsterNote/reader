import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveLayoutSelectionRange } from '../src/components/IntermediateDocumentViewer/layoutHighlightAdapter'
import type { ReaderSelectionRange } from '../src/types/selection'

const textRange: ReaderSelectionRange = {
  id: 'flow-range',
  text: '234567',
  start: { selectionId: 'page-1', offset: 2 },
  end: { selectionId: 'page-1', offset: 8 },
  createdAt: 123,
  overlayRectType: 'percent',
  rectsBySelectionId: {}
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(Range.prototype, 'getClientRects')
  document.body.replaceChildren()
})

describe('Layout flow highlight adapter', () => {
  it('uses rendered DOM geometry instead of model coordinates', () => {
    // Given: flow 页面中的实际文字位置与模型坐标无关。
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-testid="intermediate-page-1">
        <div class="hsn-selection-container">
          <div class="hsn-selection-content">0123456789</div>
        </div>
      </div>
    `
    document.body.append(root)
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

    // When: Layout 从 flow 页字符锚点派生矩形。
    const range = deriveLayoutSelectionRange({
      range: textRange,
      root,
      flowLayoutPages: new Set([1]),
      textsByPageNumber: new Map(),
      pageSizesByPageNumber: new Map(),
      overlayRectType: 'px'
    })

    // Then: 矩形使用 DOM Range 相对 selection container 的实际位置。
    expect(range.rectsBySelectionId['page-1']).toEqual([
      { x: 20, y: 24, width: 60, height: 18 }
    ])
  })
})
