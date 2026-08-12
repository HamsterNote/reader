import type {
  IntermediateDocument,
  IntermediateText
} from '@hamster-note/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntermediateDocumentTextViewer } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import type { ReaderSelectionRange } from '../src/types/selection'
import { clearSelectionProps, getAllSelectionProps } from './mocks/selection'
import { setScrollContainerSize } from './setup'

function makeText(): IntermediateText {
  return {
    id: 'text-1',
    content: 'Page 1 text',
    fontSize: 12,
    fontFamily: 'Arial',
    fontWeight: 400,
    italic: false,
    color: '#111111',
    polygon: [
      [10, 20],
      [50, 20],
      [50, 36],
      [10, 36]
    ],
    lineHeight: 16,
    ascent: 10,
    descent: 2,
    dir: 'ltr',
    skew: 0,
    isEOL: false
  } as IntermediateText
}

function makeDocument(): IntermediateDocument {
  const page = { getContent: vi.fn(async () => [makeText()]) }
  return {
    id: 'text-drag-document',
    title: 'Text drag document',
    pageCount: 1,
    pageNumbers: [1],
    getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
    getPageByPageNumber: vi.fn(async () => page)
  } as unknown as IntermediateDocument
}

function makeHighlight(): ReaderSelectionRange {
  return {
    id: 'text-drag-highlight',
    text: 'Page',
    start: { selectionId: 'page-1', offset: 0 },
    end: { selectionId: 'page-1', offset: 4 },
    createdAt: 1,
    overlayRectType: 'px',
    rectsBySelectionId: {
      'page-1': [{ x: 0, y: 0, width: 1, height: 1 }]
    }
  }
}

function mockTextRangeGeometry(): void {
  const clientRects = Object.assign([new DOMRect(180, 250, 80, 30)], {
    item: (index: number) => clientRects[index] ?? null
  })
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: vi.fn(() => clientRects)
  })
}

afterEach(() => {
  clearSelectionProps()
  vi.restoreAllMocks()
  Reflect.deleteProperty(Range.prototype, 'getClientRects')
})

describe('Text Mode highlight drag', () => {
  it('emits the public highlight after primary mouse movement passes four pixels', async () => {
    // Given: Text Mode 已经根据字符锚点重建出一个持久高亮。
    const highlight = makeHighlight()
    const onDragHighlight = vi.fn()
    mockTextRangeGeometry()
    const defaultGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('hsn-selection-container')) {
          Object.defineProperties(this, {
            clientWidth: { configurable: true, value: 400 },
            clientHeight: { configurable: true, value: 600 }
          })
          return DOMRect.fromRect({ x: 100, y: 100, width: 400, height: 600 })
        }
        if (this.dataset.testid === 'intermediate-text-page-1') {
          Object.defineProperties(this, {
            clientWidth: { configurable: true, value: 800 },
            clientHeight: { configurable: true, value: 600 }
          })
          return DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 600 })
        }
        return defaultGetBoundingClientRect.call(this)
      }
    )
    const props = {
      document: makeDocument(),
      ranges: [highlight],
      overlayRectType: 'px' as const,
      onDragHighlight
    }
    render(<IntermediateDocumentTextViewer {...props} />)
    const viewer = screen.getByTestId('intermediate-document-text-viewer')
    setScrollContainerSize(viewer, { width: 800, height: 600 })
    await screen.findByTestId('intermediate-text-page-1')
    await waitFor(() => {
      expect(getAllSelectionProps()[0]?.linkedData?.items[0]).toBeDefined()
    })
    const selectionContent = viewer.querySelector<HTMLElement>(
      '.hsn-selection-content'
    )
    if (!selectionContent) {
      throw new Error('Expected rendered Text Mode selection content')
    }
    selectionContent.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    // When: 主鼠标从高亮内部移动超过与 Layout Mode 相同的 4px 阈值。
    await act(async () => {
      fireEvent.pointerDown(selectionContent, {
        pointerType: 'mouse',
        pointerId: 71,
        isPrimary: true,
        button: 0,
        clientX: 200,
        clientY: 250
      })
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.pointerMove(selectionContent, {
        pointerType: 'mouse',
        pointerId: 71,
        isPrimary: true,
        buttons: 1,
        clientX: 205,
        clientY: 250
      })
      await Promise.resolve()
    })

    // Then: Text Mode 与 Layout Mode 一样，只上报原始 public range。
    expect(onDragHighlight).toHaveBeenCalledTimes(1)
    expect(onDragHighlight).toHaveBeenCalledWith(highlight)
    expect(viewer).toHaveClass(
      'hamster-reader__intermediate-document-viewer--highlight-dragging'
    )
  })

  it('keeps tracking when the drag callback changes during the gesture', async () => {
    // Given: pointerdown 后父组件以新的 callback 重渲染。
    const highlight = makeHighlight()
    const firstCallback = vi.fn()
    const latestCallback = vi.fn()
    const document = makeDocument()
    mockTextRangeGeometry()
    const defaultGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('hsn-selection-container')) {
          return DOMRect.fromRect({ x: 100, y: 100, width: 400, height: 600 })
        }
        return defaultGetBoundingClientRect.call(this)
      }
    )
    const { rerender } = render(
      <IntermediateDocumentTextViewer
        document={document}
        ranges={[highlight]}
        overlayRectType='px'
        onDragHighlight={firstCallback}
      />
    )
    const viewer = screen.getByTestId('intermediate-document-text-viewer')
    setScrollContainerSize(viewer, { width: 800, height: 600 })
    await screen.findByTestId('intermediate-text-page-1')
    await waitFor(() => {
      expect(getAllSelectionProps()[0]?.linkedData?.items[0]).toBeDefined()
    })
    const selectionContent = viewer.querySelector<HTMLElement>(
      '.hsn-selection-content'
    )
    if (!selectionContent) throw new Error('Expected selection content')
    fireEvent.pointerDown(selectionContent, {
      pointerType: 'mouse',
      pointerId: 72,
      isPrimary: true,
      button: 0,
      clientX: 200,
      clientY: 250
    })

    // When: callback identity 改变后，同一 pointer 继续移动越过阈值。
    rerender(
      <IntermediateDocumentTextViewer
        document={document}
        ranges={[highlight]}
        overlayRectType='px'
        onDragHighlight={latestCallback}
      />
    )
    fireEvent.pointerMove(selectionContent, {
      pointerType: 'mouse',
      pointerId: 72,
      isPrimary: true,
      buttons: 1,
      clientX: 205,
      clientY: 250
    })

    // Then: 手势不被 effect cleanup 中断，并调用最新 callback。
    expect(firstCallback).not.toHaveBeenCalled()
    expect(latestCallback).toHaveBeenCalledWith(highlight)
  })

  it('cancels a pending touch long press when a second pointer joins', async () => {
    // Given: 首指在已有高亮上进入 500ms 长按候选期。
    const onDragHighlight = vi.fn()
    const highlight = makeHighlight()
    mockTextRangeGeometry()
    const defaultGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('hsn-selection-container')
          ? DOMRect.fromRect({ x: 100, y: 100, width: 400, height: 600 })
          : defaultGetBoundingClientRect.call(this)
      }
    )
    render(
      <IntermediateDocumentTextViewer
        document={makeDocument()}
        ranges={[highlight]}
        overlayRectType='px'
        onDragHighlight={onDragHighlight}
      />
    )
    const viewer = screen.getByTestId('intermediate-document-text-viewer')
    setScrollContainerSize(viewer, { width: 800, height: 600 })
    const page = await screen.findByTestId('intermediate-text-page-1')
    await waitFor(() => {
      expect(getAllSelectionProps()[0]?.linkedData?.items[0]).toBeDefined()
    })
    const selectionContent = page.querySelector<HTMLElement>(
      '.hsn-selection-content'
    )
    if (!selectionContent) throw new Error('Expected selection content')

    vi.useFakeTimers()
    try {
      await act(async () => {
        fireEvent.pointerDown(selectionContent, {
          pointerType: 'touch',
          pointerId: 73,
          isPrimary: true,
          clientX: 200,
          clientY: 250
        })
      })
      expect(viewer).toHaveClass(
        'hamster-reader__intermediate-document-viewer--suppress-native-selection'
      )

      // When: 第二指加入后，时间越过原长按阈值。
      await act(async () => {
        fireEvent.pointerDown(selectionContent, {
          pointerType: 'touch',
          pointerId: 74,
          isPrimary: false,
          clientX: 200,
          clientY: 270
        })
      })
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      // Then: 双指手势不能误触发 highlight drag。
      expect(onDragHighlight).not.toHaveBeenCalled()
      expect(viewer).not.toHaveClass(
        'hamster-reader__intermediate-document-viewer--suppress-native-selection'
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
