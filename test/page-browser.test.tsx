import type { DrawingValue } from '@hamster-note/painting'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PageBrowser } from '../src/components/IntermediateDocumentViewer/PageBrowser'
import type { ReaderSelectionRectangle } from '../src/types/selection'
import { intersectionObserverMock, mockElementSize } from './setup'

const pageSizes = new Map([
  [1, { width: 100, height: 200 }],
  [2, { width: 100, height: 200 }]
])

function makeRect(id: string, pageNumber = 1): ReaderSelectionRectangle {
  return {
    id,
    createdAt: 10,
    selectionId: `page-${pageNumber}`,
    start: { x: 10, y: 20 },
    end: { x: 60, y: 45 },
    rect: { x: 10, y: 20, width: 50, height: 25 },
    overlayRectType: 'percent'
  }
}

function renderPageBrowser(
  overrides: Partial<React.ComponentProps<typeof PageBrowser>> = {}
) {
  const props: React.ComponentProps<typeof PageBrowser> = {
    isOpen: true,
    pageNumbers: [1, 2],
    pageSizesByPageNumber: pageSizes,
    baseImagesByPageNumber: new Map([
      [1, 'page-1-thumbnail'],
      [2, 'page-2-thumbnail']
    ]),
    onPageVisibilityChange: vi.fn(),
    onNavigateToPage: vi.fn(),
    ...overrides
  }
  render(<PageBrowser {...props} />)
  return props
}

describe('PageBrowser', () => {
  it('aggregates visible rectangle items by page before releasing page protection', () => {
    const onPageVisibilityChange = vi.fn()
    renderPageBrowser({
      rects: [makeRect('rect-a', 2), makeRect('rect-b', 2)],
      onPageVisibilityChange
    })
    fireEvent.click(screen.getByRole('tab', { name: '高亮' }))

    const firstRect = screen.getByTestId('page-browser-rect-rect-a')
    const secondRect = screen.getByTestId('page-browser-rect-rect-b')
    intersectionObserverMock.trigger(firstRect, true)
    intersectionObserverMock.trigger(secondRect, true)
    intersectionObserverMock.trigger(firstRect, false)

    expect(onPageVisibilityChange.mock.calls).toEqual([[2, true]])

    intersectionObserverMock.trigger(secondRect, false)
    expect(onPageVisibilityChange.mock.calls).toEqual([
      [2, true],
      [2, false]
    ])
  })

  it('overlays the page drawing in the same crop coordinate system', () => {
    const drawing: DrawingValue = {
      strokes: [
        {
          id: 'stroke-1',
          tool: 'pen',
          strokeColor: '#2563eb',
          strokeWidth: 3,
          points: [
            { x: 10, y: 40 },
            { x: 30, y: 60 }
          ]
        }
      ]
    }
    renderPageBrowser({
      rects: [makeRect('rect-1')],
      pagePaintings: { 'page-1': drawing }
    })
    fireEvent.click(screen.getByRole('tab', { name: '高亮' }))

    const drawingPreview = screen.getByTestId(
      'page-browser-rect-drawing-page-1-rect-1'
    )
    const svg = drawingPreview.querySelector('svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 100 200')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none')
    expect(drawingPreview).toHaveStyle({
      width: '200%',
      height: '400%',
      left: '-20%',
      top: '-80%'
    })
  })

  it('follows a left drag, rebounds below half width, and dismisses beyond it', () => {
    const onClose = vi.fn()
    renderPageBrowser({ onClose })
    const browser = screen.getByTestId('page-browser')
    mockElementSize(browser, { width: 300, height: 600 })

    fireEvent.pointerDown(browser, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 250,
      clientY: 100
    })
    fireEvent.pointerMove(document, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 150,
      clientY: 102
    })
    expect(browser).toHaveStyle({
      '--hamster-reader-page-browser-drag-x': '-100px'
    })
    fireEvent.pointerUp(document, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 150,
      clientY: 102
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(
      browser.style.getPropertyValue('--hamster-reader-page-browser-drag-x')
    ).toBe('')

    fireEvent.pointerDown(browser, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 250,
      clientY: 100
    })
    fireEvent.pointerMove(document, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 80,
      clientY: 102
    })
    fireEvent.pointerUp(document, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 80,
      clientY: 102
    })

    expect(onClose).toHaveBeenCalledOnce()
    expect(browser).toHaveAttribute('aria-hidden', 'true')
  })

  it('rebounds instead of dismissing when a long left drag is canceled', () => {
    // Given：侧栏已被向左拖动超过关闭阈值。
    const onClose = vi.fn()
    renderPageBrowser({ onClose })
    const browser = screen.getByTestId('page-browser')
    mockElementSize(browser, { width: 300, height: 600 })
    fireEvent.pointerDown(browser, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 250,
      clientY: 100
    })
    fireEvent.pointerMove(document, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 80,
      clientY: 102
    })

    // When：浏览器取消该指针手势，而非正常抬起。
    fireEvent.pointerCancel(document, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 80,
      clientY: 102
    })

    // Then：取消手势只复位拖动状态，不关闭侧栏。
    expect(onClose).not.toHaveBeenCalled()
    expect(browser).toHaveAttribute('aria-hidden', 'false')
    expect(
      browser.style.getPropertyValue('--hamster-reader-page-browser-drag-x')
    ).toBe('')
  })

  it('waits for the active pointer when another pointer is canceled', () => {
    // Given：主指针正在执行超过关闭阈值的左拖，第二个指针随后加入。
    const onClose = vi.fn()
    renderPageBrowser({ onClose })
    const browser = screen.getByTestId('page-browser')
    mockElementSize(browser, { width: 300, height: 600 })
    fireEvent.pointerDown(browser, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 250,
      clientY: 100
    })
    fireEvent.pointerDown(browser, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 240,
      clientY: 120
    })
    fireEvent.pointerMove(document, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 70,
      clientY: 102
    })

    // When：非活动的第二个指针被浏览器取消。
    fireEvent.pointerCancel(document, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 240,
      clientY: 120
    })

    // Then：主指针仍未结束，侧栏不能提前关闭。
    expect(onClose).not.toHaveBeenCalled()
    expect(browser).toHaveAttribute('aria-hidden', 'false')
  })
})
