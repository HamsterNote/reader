import type { DrawingValue } from '@hamster-note/painting'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

const confirmMock = vi.hoisted(() => vi.fn())

beforeEach(() => {
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
})

vi.mock('@hamster-note/components', async () => {
  const actual = await vi.importActual<
    typeof import('@hamster-note/components')
  >('@hamster-note/components')
  return { ...actual, confirm: confirmMock }
})

import { PageBrowser } from '../src/components/IntermediateDocumentViewer/PageBrowser'
import type { ReaderTextAnchor } from '../src/types/readerData'
import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../src/types/selection'
import { intersectionObserverMock, mockElementSize } from './setup'

const pageSizes = new Map([
  [1, { width: 100, height: 200 }],
  [2, { width: 100, height: 200 }]
])
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
)

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  })
})

afterAll(() => {
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      scrollIntoViewDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

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

function makeRange(id: string, text: string): ReaderSelectionRange {
  return {
    id,
    text,
    createdAt: 10,
    start: { selectionId: 'page-1', offset: 0 },
    end: { selectionId: 'page-1', offset: text.length },
    overlayRectType: 'percent',
    rectsBySelectionId: {
      'page-1': [{ x: 10, y: 20, width: 50, height: 25 }]
    }
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
  it('omits the page tab and page panel when page previews are unavailable', () => {
    // Given: Text Mode cannot provide usable page previews.
    renderPageBrowser({ showPagesTab: false })

    // Then: the sidebar starts on highlights and never exposes the page surface.
    expect(screen.queryByRole('tab', { name: '页面' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '高亮' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.queryByTestId('page-browser-page-1')).not.toBeInTheDocument()
  })

  it('adds a bookmark for the current visible page', () => {
    // Given: 第 2 页在主视图中可见，且尚未收藏。
    const onTogglePageBookmark = vi.fn()
    renderPageBrowser({
      visiblePageNumbers: new Set([2]),
      bookmarkedPageNumbers: [1],
      onTogglePageBookmark
    })
    fireEvent.click(screen.getByRole('tab', { name: '书签' }))

    // When: 用户点击书签列表顶部的新增操作。
    fireEvent.click(screen.getByRole('button', { name: '新增书签' }))

    // Then: 只添加当前可见的第 2 页。
    expect(onTogglePageBookmark).toHaveBeenCalledWith(2)
  })

  it('disables adding a bookmark when the current page is already bookmarked', () => {
    // Given: 当前可见的第 1 页已经收藏。
    const onTogglePageBookmark = vi.fn()
    renderPageBrowser({
      visiblePageNumbers: new Set([1]),
      bookmarkedPageNumbers: [1],
      onTogglePageBookmark
    })
    fireEvent.click(screen.getByRole('tab', { name: '书签' }))

    // Then: 新增操作不可用，避免把现有书签切换为删除。
    expect(screen.getByRole('button', { name: '新增书签' })).toBeDisabled()
    expect(onTogglePageBookmark).not.toHaveBeenCalled()
  })

  it('adds, opens, and removes bookmarks by their text anchor', async () => {
    // Given: 当前容器顶部文字与一个已保存的精确文字书签。
    const currentAnchor: ReaderTextAnchor = {
      pageNumber: 2,
      textId: 'paragraph-2',
      text: '当前阅读到的文字',
      offset: 18
    }
    const savedBookmark: ReaderTextAnchor = {
      pageNumber: 1,
      textId: 'paragraph-1',
      text: '已保存的文字',
      offset: 5
    }
    const onToggleBookmark = vi.fn()
    const onNavigateToBookmark = vi.fn()
    renderPageBrowser({
      bookmarks: [savedBookmark],
      currentBookmark: currentAnchor,
      onToggleBookmark,
      onNavigateToBookmark
    })
    fireEvent.click(screen.getByRole('tab', { name: '书签' }))

    // When: 用户新增当前位置书签，再打开并删除已有书签。
    fireEvent.click(screen.getByRole('button', { name: '新增书签' }))
    fireEvent.click(
      screen.getByRole('button', { name: '跳转到书签：已保存的文字' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: '删除书签：已保存的文字' })
    )
    await waitFor(() => expect(onToggleBookmark).toHaveBeenCalledTimes(2))

    // Then: 所有操作都携带完整文字锚点，而不是退化为页码。
    expect(onToggleBookmark).toHaveBeenNthCalledWith(1, currentAnchor)
    expect(onNavigateToBookmark).toHaveBeenCalledWith(savedBookmark)
    expect(onToggleBookmark).toHaveBeenNthCalledWith(2, savedBookmark)
    expect(confirmMock).toHaveBeenCalledWith({
      title: '删除书签？',
      description: '删除“已保存的文字”书签后无法恢复。',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger'
    })
  })

  it('disables adding the same text anchor twice', () => {
    // Given: 当前顶部文字已经存在于书签列表。
    const currentAnchor: ReaderTextAnchor = {
      pageNumber: 2,
      textId: 'paragraph-2',
      text: '当前阅读到的文字',
      offset: 18
    }
    renderPageBrowser({
      bookmarks: [currentAnchor],
      currentBookmark: currentAnchor,
      onToggleBookmark: vi.fn(),
      onNavigateToBookmark: vi.fn()
    })
    fireEvent.click(screen.getByRole('tab', { name: '书签' }))

    // Then: 新增按钮禁用，避免同一文字锚点被重复保存。
    expect(screen.getByRole('button', { name: '新增书签' })).toBeDisabled()
  })

  it('adds a page-position bookmark when the current page has no text', () => {
    // Given: the current layout position is 8% down page 2 without a text anchor.
    const currentBookmark = { pageNumber: 2, verticalPercentage: 8 } as const
    const onToggleBookmark = vi.fn()
    renderPageBrowser({
      bookmarks: [],
      currentBookmark,
      onToggleBookmark,
      onNavigateToBookmark: vi.fn()
    })
    fireEvent.click(screen.getByRole('tab', { name: '书签' }))

    // When: the user adds the current position.
    fireEvent.click(screen.getByRole('button', { name: '新增书签' }))

    // Then: the precise page and vertical percentage are saved.
    expect(onToggleBookmark).toHaveBeenCalledWith(currentBookmark)
  })

  it('keeps legacy page bookmarks when only the legacy toggle is available', () => {
    // Given: the host only supplies the deprecated page bookmark contract.
    const onTogglePageBookmark = vi.fn()
    const currentAnchor: ReaderTextAnchor = {
      pageNumber: 2,
      textId: 'paragraph-2',
      text: '当前阅读到的文字',
      offset: 18
    }
    renderPageBrowser({
      currentBookmark: currentAnchor,
      bookmarkedPageNumbers: [1],
      visiblePageNumbers: new Set([2]),
      onTogglePageBookmark
    })
    fireEvent.click(screen.getByRole('tab', { name: '书签' }))

    // When: the user adds the current page through the legacy surface.
    fireEvent.click(screen.getByRole('button', { name: '新增书签' }))

    // Then: the existing page bookmark remains visible and the page callback runs.
    expect(
      screen.getByRole('button', { name: '跳转到书签：第 1 页' })
    ).toBeInTheDocument()
    expect(onTogglePageBookmark).toHaveBeenCalledWith(2)
  })

  it('does not enable precise bookmark deletion with only a legacy callback', () => {
    // Given: precise bookmark data is present without a precise toggle capability.
    const bookmark: ReaderTextAnchor = {
      pageNumber: 1,
      textId: 'paragraph-1',
      text: '已保存的文字',
      offset: 5
    }
    const onTogglePageBookmark = vi.fn()
    renderPageBrowser({
      bookmarks: [bookmark],
      onTogglePageBookmark
    })
    fireEvent.click(screen.getByRole('tab', { name: '书签' }))

    // Then: the precise action is disabled instead of calling the wrong API.
    expect(
      screen.getByRole('button', { name: '删除书签：已保存的文字' })
    ).toBeDisabled()
    expect(onTogglePageBookmark).not.toHaveBeenCalled()
  })

  it('cancels bookmark deletion when the components confirm is cancelled', async () => {
    // Given: a bookmark exists with a precise toggle capability.
    const bookmark: ReaderTextAnchor = {
      pageNumber: 1,
      textId: 'paragraph-1',
      text: '已保存的文字',
      offset: 5
    }
    const onToggleBookmark = vi.fn()
    confirmMock.mockResolvedValueOnce(false)
    renderPageBrowser({
      bookmarks: [bookmark],
      onToggleBookmark
    })
    fireEvent.click(screen.getByRole('tab', { name: '书签' }))

    // When: user clicks delete and the components confirm is cancelled.
    fireEvent.click(
      screen.getByRole('button', { name: '删除书签：已保存的文字' })
    )
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))

    // Then: the delete is not called and the delete button reappears.
    expect(onToggleBookmark).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: '删除书签：已保存的文字' })
    ).toBeInTheDocument()
  })

  it('confirms range deletion and preserves marker color without navigating', async () => {
    // Given: a text highlight with a marker color and a sidebar delete capability.
    const onDeleteRange = vi.fn()
    const onNavigateToRange = vi.fn()
    renderPageBrowser({
      ranges: [
        {
          ...makeRange('range-1', '这是一个带颜色的高亮文本'),
          markerStyle: { backgroundColor: '#facc15' }
        }
      ],
      onDeleteRange,
      onNavigateToRange
    })
    fireEvent.click(screen.getByRole('tab', { name: '高亮' }))

    // When: the user clicks the trash icon instead of the highlight content.
    const deleteButton = screen.getByTestId(
      'page-browser-delete-highlight-range-1'
    )
    fireEvent.click(deleteButton)
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))

    // Then: the host receives only the range ID after confirmation and the item keeps its marker color.
    expect(confirmMock).toHaveBeenCalledWith({
      title: '删除高亮？',
      description: '删除“这是一个带颜色的高亮文本”高亮后无法恢复。',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger'
    })
    expect(onDeleteRange).toHaveBeenCalledWith('range-1')
    expect(onNavigateToRange).not.toHaveBeenCalled()
    expect(deleteButton.closest('.hamster-reader__highlight-item')).toHaveStyle(
      {
        backgroundColor: 'color-mix(in srgb, #facc15 15%, white)',
        borderColor: 'color-mix(in srgb, #facc15 30%, white)'
      }
    )
  })

  it('confirms rectangle deletion and preserves marker color without navigating', async () => {
    // Given: a colored rectangle highlight and a sidebar delete capability.
    const onDeleteRect = vi.fn()
    const onNavigateToRect = vi.fn()
    renderPageBrowser({
      rects: [
        {
          ...makeRect('rect-colored'),
          markerStyle: { backgroundColor: '#22c55e' }
        }
      ],
      onDeleteRect,
      onNavigateToRect
    })
    fireEvent.click(screen.getByRole('tab', { name: '高亮' }))

    // When: the user clicks the rectangle delete icon.
    const deleteButton = screen.getByTestId(
      'page-browser-delete-rect-rect-colored'
    )
    fireEvent.click(deleteButton)
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))

    // Then: only the rectangle delete callback runs after confirmation and its colored item remains styled.
    expect(confirmMock).toHaveBeenCalledWith({
      title: '删除矩形选区？',
      description: '删除第1页矩形选区后无法恢复。',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger'
    })
    expect(onDeleteRect).toHaveBeenCalledWith('rect-colored')
    expect(onNavigateToRect).not.toHaveBeenCalled()
    expect(deleteButton.closest('.hamster-reader__highlight-item')).toHaveStyle(
      {
        backgroundColor: 'color-mix(in srgb, #22c55e 15%, white)',
        borderColor: 'color-mix(in srgb, #22c55e 30%, white)'
      }
    )
  })

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
