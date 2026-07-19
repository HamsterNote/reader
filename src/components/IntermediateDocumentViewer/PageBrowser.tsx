import type { DrawingValue } from '@hamster-note/painting'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../../types/selection'
import { hasDrawingStrokes } from '../PageDrawingLayer'
import {
  PageBookmarkButton,
  PageBrowserBookmarksPanel
} from './PageBrowserBookmarks'
import { PageBrowserDrawingPreview } from './PageBrowserDrawingPreview'
import { parsePublicPageId } from './rangeJumpHelpers'
import { usePageBrowserDrag } from './usePageBrowserDrag'

type PageBrowserTab = 'pages' | 'highlights' | 'bookmarks'

type PageBrowserProps = {
  readonly isOpen: boolean
  readonly pageNumbers: readonly number[]
  readonly pageSizesByPageNumber: ReadonlyMap<
    number,
    { readonly width: number; readonly height: number }
  >
  readonly baseImagesByPageNumber: ReadonlyMap<number, string>
  readonly pagePaintings?: Readonly<Record<string, DrawingValue>>
  readonly onPageVisibilityChange: (
    pageNumber: number,
    isVisible: boolean
  ) => void
  readonly onNavigateToPage: (pageNumber: number) => void
  /** 主题色（CSS color），用于选中项的 outline 及 tab 配色。默认 '#2563eb'。 */
  readonly themeColor?: string
  /** 主视图中当前可见的页码集合，这些页码在侧栏中标记为选中态。 */
  readonly visiblePageNumbers?: ReadonlySet<number>
  /** 侧栏列表顶部留白（px），与主视图 containMarginTop 对齐。 */
  readonly containMarginTop?: number
  /** 侧栏列表底部留白（px），与主视图 containMarginBottom 对齐。 */
  readonly containMarginBottom?: number
  /** 高亮 range 列表，用于在高亮 tab 中展示。 */
  readonly ranges?: readonly ReaderSelectionRange[]
  /** 当前选中的高亮 range ID。 */
  readonly selectedRangeId?: string | null
  /** 点击高亮项时触发选中（不滚动）。 */
  readonly onSelectRange?: (id: string | null) => void
  /** 点击高亮项时触发滚动定位到该 range。 */
  readonly onNavigateToRange?: (id: string) => void
  /** 每个 rangeId 对应的评论数量，用于在高亮项上展示评论计数徽章。 */
  readonly commentCountByRangeId?: Readonly<Record<string, number>>
  /** 矩形框选列表，与 ranges 一起在高亮 tab 中展示。 */
  readonly rects?: readonly ReaderSelectionRectangle[]
  /** 当前选中的矩形框选 ID。 */
  readonly selectedRectId?: string | null
  /** 点击矩形框选项时触发选中（不滚动）。 */
  readonly onSelectRect?: (id: string | null) => void
  /** 点击矩形框选项时触发滚动定位到该 rect。 */
  readonly onNavigateToRect?: (id: string) => void
  /** 每个 rectId 对应的评论数量，用于在矩形框选项上展示评论计数徽章。 */
  readonly commentCountByRectId?: Readonly<Record<string, number>>
  readonly bookmarkedPageNumbers?: readonly number[]
  readonly onTogglePageBookmark?: (pageNumber: number) => void
  /** 侧栏被手势关闭时通知受控宿主同步开关状态。 */
  readonly onClose?: () => void
}

/** 聊天气泡 SVG 图标，用于评论计数徽章 */
function CommentBubbleIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      focusable='false'
    >
      <path d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' />
    </svg>
  )
}

type RectPreviewGeometry = {
  readonly aspectRatio: string
  readonly imageStyle: React.CSSProperties
}

/** PageBrowser 接收运行时 rect，其 selectionId 可能带 reader scope 前缀。 */
function parseRectPageNumber(selectionId: string | undefined): number | null {
  if (!selectionId) return null
  const publicPageId = selectionId.slice(selectionId.lastIndexOf(':') + 1)
  return parsePublicPageId(publicPageId)
}

/**
 * 把 rect 转成页面像素，再用一个 overflow:hidden 容器直接裁切整页缩略图。
 * 该方案不生成 Canvas/data URL，避免异步加载、跨域污染及额外内存占用。
 */
function getRectPreviewGeometry(
  selectionRect: ReaderSelectionRectangle,
  pageSize: { readonly width: number; readonly height: number }
): RectPreviewGeometry | null {
  const { width: pageWidth, height: pageHeight } = pageSize
  const { x, y, width, height } = selectionRect.rect
  if (
    ![pageWidth, pageHeight, x, y, width, height].every(Number.isFinite) ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }

  const coordinateScale =
    selectionRect.overlayRectType === 'px'
      ? { x: 1, y: 1 }
      : { x: pageWidth / 100, y: pageHeight / 100 }
  const left = Math.max(0, Math.min(pageWidth, x * coordinateScale.x))
  const top = Math.max(0, Math.min(pageHeight, y * coordinateScale.y))
  const right = Math.max(
    left,
    Math.min(pageWidth, (x + width) * coordinateScale.x)
  )
  const bottom = Math.max(
    top,
    Math.min(pageHeight, (y + height) * coordinateScale.y)
  )
  const cropWidth = right - left
  const cropHeight = bottom - top
  if (cropWidth <= 0 || cropHeight <= 0) return null

  return {
    aspectRatio: `${cropWidth} / ${cropHeight}`,
    imageStyle: {
      width: `${(pageWidth / cropWidth) * 100}%`,
      height: `${(pageHeight / cropHeight) * 100}%`,
      left: `${(-left / cropWidth) * 100}%`,
      top: `${(-top / cropHeight) * 100}%`,
      maxWidth: 'none'
    }
  }
}

export function PageBrowser({
  isOpen,
  pageNumbers,
  pageSizesByPageNumber,
  baseImagesByPageNumber,
  pagePaintings,
  onPageVisibilityChange,
  onNavigateToPage,
  themeColor,
  visiblePageNumbers,
  containMarginTop,
  containMarginBottom,
  ranges,
  selectedRangeId,
  onSelectRange,
  onNavigateToRange,
  commentCountByRangeId,
  rects,
  selectedRectId,
  onSelectRect,
  onNavigateToRect,
  commentCountByRectId,
  bookmarkedPageNumbers,
  onTogglePageBookmark,
  onClose
}: PageBrowserProps) {
  // 默认展示页面 tab，保证 page-browser-page-N 按钮处于 a11y 树中
  // （测试依赖 getAllByRole('button', { name: /Go to page/ }) 能查到全部页面按钮）。
  const [activeTab, setActiveTab] = useState<PageBrowserTab>('pages')
  const highlightRanges = ranges ?? []
  const highlightRects = rects ?? []
  const bookmarkedPages = useMemo(() => {
    const bookmarkSet = new Set(bookmarkedPageNumbers ?? [])
    return pageNumbers.filter((pageNumber) => bookmarkSet.has(pageNumber))
  }, [bookmarkedPageNumbers, pageNumbers])
  const bookmarkSet = useMemo(() => new Set(bookmarkedPages), [bookmarkedPages])
  const observableItemsKey = (() => {
    switch (activeTab) {
      case 'pages':
        return pageNumbers.join(',')
      case 'highlights':
        return highlightRects
          .map((rect) => `${rect.id}:${rect.selectionId ?? ''}`)
          .join(',')
      case 'bookmarks':
        return bookmarkedPages.join(',')
    }
  })()

  const navRef = useRef<HTMLElement>(null)
  const pagesScrollRootRef = useRef<HTMLDivElement>(null)
  const highlightsScrollRootRef = useRef<HTMLDivElement>(null)
  const bookmarksScrollRootRef = useRef<HTMLDivElement>(null)
  const [dismissedByGesture, setDismissedByGesture] = useState(false)
  const effectiveOpen = isOpen && !dismissedByGesture

  useEffect(() => {
    if (!isOpen) setDismissedByGesture(false)
  }, [isOpen])

  const handleDismiss = useCallback(() => {
    setDismissedByGesture(true)
    onClose?.()
  }, [onClose])
  const isDragging = usePageBrowserDrag({
    elementRef: navRef,
    isOpen: effectiveOpen,
    onDismiss: handleDismiss
  })

  useEffect(() => {
    const scrollRoot = (() => {
      switch (activeTab) {
        case 'pages':
          return pagesScrollRootRef.current
        case 'highlights':
          return highlightsScrollRootRef.current
        case 'bookmarks':
          return bookmarksScrollRootRef.current
      }
    })()
    if (
      !effectiveOpen ||
      !scrollRoot ||
      observableItemsKey.length === 0 ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }

    const elementVisibility = new Map<Element, boolean>()
    let reportedPages = new Set<number>()

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          elementVisibility.set(entry.target, entry.isIntersecting)
        })

        // 同一页面可能有多个矩形。只要其中任意一个仍在视口，就继续保护该页。
        const nextPages = new Set<number>()
        elementVisibility.forEach((visible, element) => {
          const pageNumber = Number((element as HTMLElement).dataset.pageNumber)
          if (visible && Number.isFinite(pageNumber)) nextPages.add(pageNumber)
        })
        nextPages.forEach((pageNumber) => {
          if (!reportedPages.has(pageNumber)) {
            onPageVisibilityChange(pageNumber, true)
          }
        })
        reportedPages.forEach((pageNumber) => {
          if (!nextPages.has(pageNumber)) {
            onPageVisibilityChange(pageNumber, false)
          }
        })
        reportedPages = nextPages
      },
      { root: scrollRoot }
    )

    const pageButtons =
      scrollRoot.querySelectorAll<HTMLElement>('[data-page-number]')
    pageButtons.forEach((button) => {
      observer.observe(button)
    })

    return () => {
      observer.disconnect()
      reportedPages.forEach((pageNumber) => {
        onPageVisibilityChange(pageNumber, false)
      })
    }
  }, [activeTab, effectiveOpen, onPageVisibilityChange, observableItemsKey])

  // 主视图滚动到新页面时，侧栏自动滚动到第一个可见页面
  useEffect(() => {
    if (
      !effectiveOpen ||
      activeTab !== 'pages' ||
      !pagesScrollRootRef.current ||
      !visiblePageNumbers ||
      visiblePageNumbers.size === 0
    ) {
      return
    }

    const firstVisiblePage = Math.min(...visiblePageNumbers)
    const targetButton = pagesScrollRootRef.current.querySelector<HTMLElement>(
      `[data-page-number="${firstVisiblePage}"]`
    )
    if (targetButton) {
      targetButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeTab, effectiveOpen, visiblePageNumbers])

  const className = [
    'hamster-reader__page-browser',
    effectiveOpen ? 'hamster-reader__page-browser--open' : '',
    isDragging ? 'hamster-reader__page-browser--dragging' : ''
  ]
    .filter(Boolean)
    .join(' ')

  // 主题色通过 CSS 变量传递，SCSS 中通过 var(--hamster-reader-theme-color) 消费。
  // 顶部留白作用在侧栏容器上，使 tab 与 list 一起下移。
  const containerStyle = {
    '--hamster-reader-theme-color': themeColor ?? '#2563eb',
    paddingTop:
      typeof containMarginTop === 'number' ? `${containMarginTop}px` : undefined
  } as React.CSSProperties

  const listStyle: React.CSSProperties = {
    paddingBottom:
      typeof containMarginBottom === 'number'
        ? `${containMarginBottom}px`
        : undefined
  }

  // 点击高亮项：先选中再滚动定位
  const handleHighlightClick = (rangeId: string) => {
    onSelectRange?.(rangeId)
    onNavigateToRange?.(rangeId)
  }

  // 点击矩形框选项：先选中再滚动定位
  const handleRectClick = (rectId: string) => {
    onSelectRect?.(rectId)
    onNavigateToRect?.(rectId)
  }

  return (
    <nav
      ref={navRef}
      className={className}
      aria-label='Page browser'
      aria-hidden={!effectiveOpen}
      data-testid='page-browser'
      style={containerStyle}
    >
      {/* 跑道型 tab 切换器：外层 shell padding=4px + border-radius=18px，
          内层 tab border-radius=14px，形成同心圆弧 (R_outer = R_inner + padding) */}
      <div className='hamster-reader__page-browser-tabs' role='tablist'>
        <button
          type='button'
          role='tab'
          aria-selected={activeTab === 'pages'}
          className={[
            'hamster-reader__page-browser-tab',
            activeTab === 'pages'
              ? 'hamster-reader__page-browser-tab--active'
              : ''
          ]
            .filter(Boolean)
            .join(' ')}
          tabIndex={effectiveOpen ? 0 : -1}
          onClick={() => setActiveTab('pages')}
        >
          页面
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={activeTab === 'highlights'}
          className={[
            'hamster-reader__page-browser-tab',
            activeTab === 'highlights'
              ? 'hamster-reader__page-browser-tab--active'
              : ''
          ]
            .filter(Boolean)
            .join(' ')}
          tabIndex={effectiveOpen ? 0 : -1}
          onClick={() => setActiveTab('highlights')}
        >
          高亮
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={activeTab === 'bookmarks'}
          className={[
            'hamster-reader__page-browser-tab',
            activeTab === 'bookmarks'
              ? 'hamster-reader__page-browser-tab--active'
              : ''
          ]
            .filter(Boolean)
            .join(' ')}
          tabIndex={effectiveOpen ? 0 : -1}
          onClick={() => setActiveTab('bookmarks')}
        >
          书签
        </button>
      </div>

      {/* 页面缩略图面板 */}
      <div
        className='hamster-reader__page-browser-panel'
        role='tabpanel'
        hidden={activeTab !== 'pages'}
      >
        <div
          ref={pagesScrollRootRef}
          className='hamster-reader__page-browser-list'
          style={listStyle}
        >
          {pageNumbers.map((pageNumber) => {
            const pageSize = pageSizesByPageNumber.get(pageNumber)
            const baseImage = baseImagesByPageNumber.get(pageNumber)
            const aspectRatio = pageSize
              ? `${pageSize.width} / ${pageSize.height}`
              : undefined
            const isSelected = visiblePageNumbers?.has(pageNumber) ?? false

            const itemClassName = [
              'hamster-reader__page-browser-item',
              isSelected ? 'hamster-reader__page-browser-item--selected' : ''
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <div
                key={pageNumber}
                className='hamster-reader__page-browser-page'
              >
                <button
                  type='button'
                  className={itemClassName}
                  aria-label={`Go to page ${pageNumber}`}
                  aria-current={isSelected ? 'page' : undefined}
                  tabIndex={effectiveOpen ? 0 : -1}
                  data-page-number={pageNumber}
                  data-testid={`page-browser-page-${pageNumber}`}
                  onClick={() => onNavigateToPage(pageNumber)}
                >
                  <span
                    className='hamster-reader__page-browser-preview'
                    style={{ aspectRatio }}
                  >
                    {baseImage ? (
                      <img
                        src={baseImage}
                        alt=''
                        className='hamster-reader__page-browser-image'
                        draggable={false}
                      />
                    ) : (
                      <span
                        className='hamster-reader__page-browser-placeholder'
                        aria-hidden='true'
                      />
                    )}
                  </span>
                  <span className='hamster-reader__page-browser-page-number'>
                    {pageNumber}
                  </span>
                </button>
                <PageBookmarkButton
                  pageNumber={pageNumber}
                  isBookmarked={bookmarkSet.has(pageNumber)}
                  isOpen={effectiveOpen}
                  isEnabled={onTogglePageBookmark !== undefined}
                  onToggle={onTogglePageBookmark}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* 高亮列表面板 */}
      <div
        className='hamster-reader__page-browser-panel'
        role='tabpanel'
        hidden={activeTab !== 'highlights'}
      >
        <div
          ref={highlightsScrollRootRef}
          className='hamster-reader__highlight-list'
          style={listStyle}
        >
          {highlightRanges.length === 0 && highlightRects.length === 0 ? (
            <p className='hamster-reader__highlight-empty'>暂无高亮</p>
          ) : (
            <>
              {highlightRanges.map((range) => {
                const isSelected = selectedRangeId === range.id
                // 评论计数：从外部传入的映射中读取，缺省为 0
                const commentCount = commentCountByRangeId?.[range.id] ?? 0

                const itemClassName = [
                  'hamster-reader__highlight-item',
                  isSelected ? 'hamster-reader__highlight-item--selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <button
                    key={range.id}
                    type='button'
                    className={itemClassName}
                    aria-label={`跳转到高亮：${range.text || '(空选区)'}`}
                    aria-current={isSelected ? 'true' : undefined}
                    tabIndex={effectiveOpen ? 0 : -1}
                    data-range-id={range.id}
                    data-testid={`page-browser-highlight-${range.id}`}
                    onClick={() => handleHighlightClick(range.id)}
                  >
                    <span className='hamster-reader__highlight-text'>
                      {range.text || '(空选区)'}
                    </span>
                    {commentCount > 0 && (
                      <span
                        className='hamster-reader__highlight-comment-badge'
                        role='img'
                        aria-label={`${commentCount} 条评论`}
                      >
                        <CommentBubbleIcon />
                        <span className='hamster-reader__highlight-comment-count'>
                          {commentCount}
                        </span>
                      </span>
                    )}
                  </button>
                )
              })}
              {highlightRects.map((rect) => {
                const isSelected = selectedRectId === rect.id
                const commentCount = commentCountByRectId?.[rect.id] ?? 0
                const pageNumber = parseRectPageNumber(rect.selectionId)
                const baseImage =
                  pageNumber === null
                    ? undefined
                    : baseImagesByPageNumber.get(pageNumber)
                const pageSize =
                  pageNumber === null
                    ? undefined
                    : pageSizesByPageNumber.get(pageNumber)
                const previewGeometry = pageSize
                  ? getRectPreviewGeometry(rect, pageSize)
                  : null
                const publicPageId =
                  pageNumber === null ? null : `page-${pageNumber}`
                const drawingValue = publicPageId
                  ? pagePaintings?.[publicPageId]
                  : undefined
                const ariaLabel =
                  pageNumber !== null
                    ? `跳转到矩形选区：第${pageNumber}页`
                    : '跳转到矩形选区'

                const itemClassName = [
                  'hamster-reader__highlight-item',
                  'hamster-reader__highlight-item--rect',
                  isSelected ? 'hamster-reader__highlight-item--selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <button
                    key={rect.id}
                    type='button'
                    className={itemClassName}
                    aria-label={ariaLabel}
                    aria-current={isSelected ? 'true' : undefined}
                    tabIndex={effectiveOpen ? 0 : -1}
                    data-rect-id={rect.id}
                    data-page-number={pageNumber ?? undefined}
                    data-testid={`page-browser-rect-${rect.id}`}
                    onClick={() => handleRectClick(rect.id)}
                  >
                    {baseImage && previewGeometry ? (
                      <span
                        className='hamster-reader__highlight-rect-preview'
                        data-testid={`page-browser-rect-preview-${rect.id}`}
                        style={{ aspectRatio: previewGeometry.aspectRatio }}
                      >
                        <img
                          src={baseImage}
                          alt=''
                          className='hamster-reader__highlight-rect-screenshot'
                          draggable={false}
                          style={previewGeometry.imageStyle}
                        />
                        {publicPageId &&
                          pageSize &&
                          drawingValue &&
                          hasDrawingStrokes(drawingValue) && (
                            <PageBrowserDrawingPreview
                              pageId={`${publicPageId}-${rect.id}`}
                              pageSize={pageSize}
                              value={drawingValue}
                              style={previewGeometry.imageStyle}
                            />
                          )}
                      </span>
                    ) : (
                      <span
                        className='hamster-reader__highlight-rect-placeholder'
                        aria-hidden='true'
                      />
                    )}
                    {commentCount > 0 && (
                      <span
                        className='hamster-reader__highlight-comment-badge'
                        role='img'
                        aria-label={`${commentCount} 条评论`}
                      >
                        <CommentBubbleIcon />
                        <span className='hamster-reader__highlight-comment-count'>
                          {commentCount}
                        </span>
                      </span>
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>

      <div
        className='hamster-reader__page-browser-panel'
        role='tabpanel'
        hidden={activeTab !== 'bookmarks'}
      >
        <PageBrowserBookmarksPanel
          bookmarkedPageNumbers={bookmarkedPages}
          isOpen={effectiveOpen}
          isEnabled={onTogglePageBookmark !== undefined}
          scrollRootRef={bookmarksScrollRootRef}
          listStyle={listStyle}
          onNavigateToPage={onNavigateToPage}
          onTogglePageBookmark={onTogglePageBookmark}
        />
      </div>
    </nav>
  )
}
