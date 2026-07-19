import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReaderSelectionRange, ReaderSelectionRectangle } from '../../types/selection'
import { parsePublicPageId } from './rangeJumpHelpers'

/** 侧栏可切换的面板类型：页面缩略图列表 / 高亮列表 */
type PageBrowserTab = 'pages' | 'highlights'

type PageBrowserProps = {
  readonly isOpen: boolean
  readonly pageNumbers: readonly number[]
  readonly pageSizesByPageNumber: ReadonlyMap<
    number,
    { readonly width: number; readonly height: number }
  >
  readonly baseImagesByPageNumber: ReadonlyMap<number, string>
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

// ── Rect 选区截图（运行时现场计算，不存入持久化数据）─────────────────

/**
 * 从页面底图中裁剪 rect 选区对应的区域，返回 data URL。
 *
 * 坐标转换：
 * - 'percent': rect 坐标为 0-100 百分比，按图片自然尺寸换算
 * - 'px': rect 坐标为页面 CSS 像素，按底图/页面尺寸比换算
 */
async function cropRectFromBaseImage(
  baseImageSrc: string,
  rect: { x: number; y: number; width: number; height: number },
  overlayRectType: 'px' | 'percent',
  pageSize: { width: number; height: number }
): Promise<string> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('base image load failed'))
    img.src = baseImageSrc
  })

  const naturalWidth = img.naturalWidth
  const naturalHeight = img.naturalHeight

  let srcX: number, srcY: number, srcW: number, srcH: number
  if (overlayRectType === 'percent') {
    srcX = (rect.x / 100) * naturalWidth
    srcY = (rect.y / 100) * naturalHeight
    srcW = (rect.width / 100) * naturalWidth
    srcH = (rect.height / 100) * naturalHeight
  } else {
    const scaleX = naturalWidth / pageSize.width
    const scaleY = naturalHeight / pageSize.height
    srcX = rect.x * scaleX
    srcY = rect.y * scaleY
    srcW = rect.width * scaleX
    srcH = rect.height * scaleY
  }

  // 防御性 clamp：确保裁剪区域不越界
  const clampedX = Math.max(0, Math.min(srcX, naturalWidth))
  const clampedY = Math.max(0, Math.min(srcY, naturalHeight))
  const clampedW = Math.max(1, Math.min(srcW, naturalWidth - clampedX))
  const clampedH = Math.max(1, Math.min(srcH, naturalHeight - clampedY))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(clampedW)
  canvas.height = Math.round(clampedH)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.drawImage(
    img,
    clampedX, clampedY, clampedW, clampedH,
    0, 0, clampedW, clampedH
  )

  return canvas.toDataURL('image/png')
}

/**
 * 运行时为每个 rect 选区计算截图 data URL。
 * 仅在 enabled=true（高亮 tab 激活且侧栏打开）时计算，关闭时清空以释放内存。
 * 图片不存入持久化数据，每次需要时现场重算。
 */
function useRectScreenshots(
  rects: readonly ReaderSelectionRectangle[],
  baseImagesByPageNumber: ReadonlyMap<number, string>,
  pageSizesByPageNumber: ReadonlyMap<
    number,
    { readonly width: number; readonly height: number }
  >,
  enabled: boolean
): ReadonlyMap<string, string> {
  const [screenshots, setScreenshots] = useState<
    ReadonlyMap<string, string>
  >(new Map())

  // 用 ref 保存最新值，effect 依赖仅靠 inputsKey + enabled 控制
  const rectsRef = useRef(rects)
  rectsRef.current = rects
  const baseImagesRef = useRef(baseImagesByPageNumber)
  baseImagesRef.current = baseImagesByPageNumber
  const pageSizesRef = useRef(pageSizesByPageNumber)
  pageSizesRef.current = pageSizesByPageNumber

  // 用序列化 key 捕获实际输入变化，避免 Map 引用频繁变更触发重算
  const inputsKey = useMemo(
    () =>
      rects
        .map((r) => {
          const pageNumber = r.selectionId
            ? parsePublicPageId(r.selectionId)
            : null
          const baseImage =
            pageNumber !== null
              ? baseImagesByPageNumber.get(pageNumber)
              : undefined
          return `${r.id}:${r.selectionId ?? ''}:${r.rect.x},${r.rect.y},${r.rect.width},${r.rect.height}:${r.overlayRectType}:${baseImage ?? ''}`
        })
        .join('|'),
    [rects, baseImagesByPageNumber]
  )

  useEffect(() => {
    // inputsKey 为空串 => 无 rect，直接清空
    if (!enabled || !inputsKey) {
      setScreenshots((prev) => (prev.size > 0 ? new Map() : prev))
      return
    }

    let cancelled = false

    async function compute() {
      const results = new Map<string, string>()
      for (const rect of rectsRef.current) {
        if (cancelled) return
        const pageNumber = rect.selectionId
          ? parsePublicPageId(rect.selectionId)
          : null
        if (pageNumber === null) continue
        const baseImage = baseImagesRef.current.get(pageNumber)
        const pageSize = pageSizesRef.current.get(pageNumber)
        if (!baseImage || !pageSize) continue
        try {
          const dataUrl = await cropRectFromBaseImage(
            baseImage,
            rect.rect,
            rect.overlayRectType,
            pageSize
          )
          if (cancelled) return
          results.set(rect.id, dataUrl)
        } catch {
          // 图片加载失败或 canvas 不可用 -> 跳过，显示占位
        }
      }
      if (!cancelled) setScreenshots(results)
    }

    compute()
    return () => {
      cancelled = true
    }
  }, [inputsKey, enabled])

  return screenshots
}

export function PageBrowser({
  isOpen,
  pageNumbers,
  pageSizesByPageNumber,
  baseImagesByPageNumber,
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
  commentCountByRectId
}: PageBrowserProps) {
  // 默认展示页面 tab，保证 page-browser-page-N 按钮处于 a11y 树中
  // （测试依赖 getAllByRole('button', { name: /Go to page/ }) 能查到全部页面按钮）。
  const [activeTab, setActiveTab] = useState<PageBrowserTab>('pages')

  const scrollRootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scrollRoot = scrollRootRef.current
    if (!isOpen || !scrollRoot || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pageNumber = Number(
            (entry.target as HTMLElement).dataset.pageNumber
          )
          if (Number.isFinite(pageNumber)) {
            onPageVisibilityChange(pageNumber, entry.isIntersecting)
          }
        })
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
      pageNumbers.forEach((pageNumber) => {
        onPageVisibilityChange(pageNumber, false)
      })
    }
  }, [isOpen, onPageVisibilityChange, pageNumbers])

  const className = [
    'hamster-reader__page-browser',
    isOpen ? 'hamster-reader__page-browser--open' : ''
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

  // 高亮列表数据：从 props 读取，无数据时为空数组
  const highlightRanges = ranges ?? []
  const highlightRects = rects ?? []

  // 运行时计算 rect 选区截图（仅在高亮 tab 激活且侧栏打开时）
  const rectScreenshots = useRectScreenshots(
    highlightRects,
    baseImagesByPageNumber,
    pageSizesByPageNumber,
    isOpen && activeTab === 'highlights'
  )

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
      className={className}
      aria-label='Page browser'
      aria-hidden={!isOpen}
      data-testid='page-browser'
      style={containerStyle}
    >
      {/* 跑道型 tab 切换器：外层 shell padding=4px + border-radius=18px，
          内层 tab border-radius=14px，形成同心圆弧 (R_outer = R_inner + padding) */}
      <div
        className='hamster-reader__page-browser-tabs'
        role='tablist'
      >
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
          tabIndex={isOpen ? 0 : -1}
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
          tabIndex={isOpen ? 0 : -1}
          onClick={() => setActiveTab('highlights')}
        >
          高亮
        </button>
      </div>

      {/* 页面缩略图面板 */}
      <div
        className='hamster-reader__page-browser-panel'
        role='tabpanel'
        hidden={activeTab !== 'pages'}
      >
        <div
          ref={scrollRootRef}
          className='hamster-reader__page-browser-list'
          style={listStyle}
        >
          {pageNumbers.map((pageNumber) => {
            const pageSize = pageSizesByPageNumber.get(pageNumber)
            const baseImage = baseImagesByPageNumber.get(pageNumber)
            const aspectRatio = pageSize
              ? `${pageSize.width} / ${pageSize.height}`
              : undefined
            const isSelected =
              visiblePageNumbers !== undefined &&
              visiblePageNumbers.has(pageNumber)

            const itemClassName = [
              'hamster-reader__page-browser-item',
              isSelected ? 'hamster-reader__page-browser-item--selected' : ''
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <button
                key={pageNumber}
                type='button'
                className={itemClassName}
                aria-label={`Go to page ${pageNumber}`}
                aria-current={isSelected ? 'page' : undefined}
                tabIndex={isOpen ? 0 : -1}
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
          className='hamster-reader__highlight-list'
          style={listStyle}
        >
          {highlightRanges.length === 0 && highlightRects.length === 0 ? (
            <p className='hamster-reader__highlight-empty'>
              暂无高亮
            </p>
          ) : (
            <>
              {highlightRanges.map((range) => {
                const isSelected = selectedRangeId === range.id
                // 评论计数：从外部传入的映射中读取，缺省为 0
                const commentCount =
                  commentCountByRangeId?.[range.id] ?? 0

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
                    tabIndex={isOpen ? 0 : -1}
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
                const commentCount =
                  commentCountByRectId?.[rect.id] ?? 0
                const screenshot = rectScreenshots.get(rect.id)
                const pageNumber = rect.selectionId
                  ? parsePublicPageId(rect.selectionId)
                  : null
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
                    tabIndex={isOpen ? 0 : -1}
                    data-rect-id={rect.id}
                    data-testid={`page-browser-rect-${rect.id}`}
                    onClick={() => handleRectClick(rect.id)}
                  >
                    {screenshot ? (
                      <img
                        src={screenshot}
                        alt=''
                        className='hamster-reader__highlight-rect-screenshot'
                        draggable={false}
                      />
                    ) : (
                      <span
                        className='hamster-reader__highlight-rect-placeholder'
                        aria-hidden='true'
                      />
                    )}
                    <span className='hamster-reader__highlight-text'>
                      {pageNumber !== null
                        ? `矩形选区 · 第${pageNumber}页`
                        : '矩形选区'}
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
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
