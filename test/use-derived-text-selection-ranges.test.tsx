import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDerivedTextSelectionRanges } from '../src/components/IntermediateDocumentViewer/useDerivedTextSelectionRanges'
import type { ReaderSelectionRange } from '../src/types/selection'

const pageNumbers = [1]

const canonicalRange: ReaderSelectionRange = {
  id: 'controlled-text-highlight',
  text: '234567',
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

describe('useDerivedTextSelectionRanges', () => {
  it('does not expose stale empty ranges when controlled ranges change', async () => {
    // Given: Text mode 已挂载，受控 canonical ranges 初始为空。
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
    const renderedRanges: ReaderSelectionRange[][] = []

    function Probe({ ranges }: { readonly ranges: ReaderSelectionRange[] }) {
      const derivedRanges = useDerivedTextSelectionRanges({
        ranges,
        root,
        pageNumbers,
        overlayRectType: 'px',
        layoutKey: 'font-scale:1'
      })
      renderedRanges.push(derivedRanges)
      return null
    }

    const view = render(<Probe ranges={[]} />)
    renderedRanges.length = 0

    // When: 宿主提交一条新的受控 canonical range。
    await act(() => view.rerender(<Probe ranges={[canonicalRange]} />))

    // Then: 首次重渲染就派生新 range，不向 Selection 暴露旧的空快照。
    expect(renderedRanges[0]).toEqual([
      expect.objectContaining({
        id: canonicalRange.id,
        start: canonicalRange.start,
        end: canonicalRange.end,
        rectsBySelectionId: {
          'page-1': [{ x: 20, y: 24, width: 60, height: 18 }]
        }
      })
    ])
  })
})
