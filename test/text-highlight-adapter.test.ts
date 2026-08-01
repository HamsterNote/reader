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

function makeAnchoredViewerRoot(content: string): {
  readonly root: HTMLElement
  readonly selectedTexts: string[]
} {
  const root = document.createElement('div')
  root.innerHTML = `<div data-testid="intermediate-text-page-1"><div class="hsn-selection-container" data-selection-id="scope:page-1"><div class="hsn-selection-content">${content}</div></div></div>`
  document.body.append(root)
  const container = root.querySelector<HTMLElement>('.hsn-selection-container')
  if (!container) throw new Error('Expected selection container')
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 200, 100)
  )
  const selectedTexts: string[] = []
  const clientRects = Object.assign([new DOMRect(10, 10, 50, 18)], {
    item: (index: number) => clientRects[index] ?? null
  })
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: vi.fn(function (this: Range) {
      selectedTexts.push(this.toString())
      return clientRects
    })
  })
  return { root, selectedTexts }
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

  it('restores Layout offsets without counting inferred PDF spaces', () => {
    // Given: Layout 的 canonical stream 是 `Helloworld`，PDF Text 模式为阅读展示补了空格。
    const { root, selectedTexts } = makeAnchoredViewerRoot(
      '<span data-selection-start-offset="0">Hello</span> <span data-selection-start-offset="5">world</span>'
    )

    // When: Text 模式用 Layout 保存的 `[5, 10]` 字符锚点重建高亮。
    deriveTextSelectionRanges({
      ranges: [
        {
          ...storedRange,
          text: 'world',
          start: { selectionId: 'page-1', offset: 5 },
          end: { selectionId: 'page-1', offset: 10 }
        }
      ],
      root,
      pageNumbers: [1],
      overlayRectType: 'px'
    })

    // Then: 展示用空格不占 canonical offset，恢复出的文字仍是 `world`。
    expect(selectedTexts).toEqual(['world'])
  })

  it('restores canonical spans after PDF visual reordering', () => {
    // Given: PDF Text DOM 按视觉位置重排，但 marker 仍指向原始 canonical 顺序。
    const { root, selectedTexts } = makeAnchoredViewerRoot(
      '<span data-selection-start-offset="5">world</span> <span data-selection-start-offset="0">Hello</span>'
    )

    // When: 一个 Layout range 跨越两个在 DOM 中逆序的源 span。
    deriveTextSelectionRanges({
      ranges: [
        {
          ...storedRange,
          text: 'Helloworld',
          start: { selectionId: 'page-1', offset: 0 },
          end: { selectionId: 'page-1', offset: 10 }
        }
      ],
      root,
      pageNumbers: [1],
      overlayRectType: 'px'
    })

    // Then: 每个源 span 独立恢复，避免逆序 endpoint 折叠单个 DOM Range。
    expect(selectedTexts).toEqual(['world', 'Hello'])
  })

  it('ignores empty PDF anchors at a canonical boundary', () => {
    // Given: 一个零长度源项与前后非空 span 共享 canonical boundary。
    const { root, selectedTexts } = makeAnchoredViewerRoot(
      '<span data-selection-start-offset="0">Hello</span><span data-selection-start-offset="5"></span><span data-selection-start-offset="5">world</span>'
    )

    // When: Layout range 的结束位置恰好落在该共享边界。
    deriveTextSelectionRanges({
      ranges: [
        {
          ...storedRange,
          text: 'Hello',
          start: { selectionId: 'page-1', offset: 0 },
          end: { selectionId: 'page-1', offset: 5 }
        }
      ],
      root,
      pageNumbers: [1],
      overlayRectType: 'px'
    })

    // Then: 空 span 不抢占 endpoint，非空源文字仍能恢复。
    expect(selectedTexts).toEqual(['Hello'])
  })
})
