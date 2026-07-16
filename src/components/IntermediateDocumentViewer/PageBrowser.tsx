import { useEffect, useRef } from 'react'

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
  /** 主题色（CSS color），用于选中项的 outline。默认 '#2563eb'。 */
  readonly themeColor?: string
  /** 主视图中当前可见的页码集合，这些页码在侧栏中标记为选中态。 */
  readonly visiblePageNumbers?: ReadonlySet<number>
  /** 侧栏列表顶部留白（px），与主视图 containMarginTop 对齐。 */
  readonly containMarginTop?: number
  /** 侧栏列表底部留白（px），与主视图 containMarginBottom 对齐。 */
  readonly containMarginBottom?: number
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
  containMarginBottom
}: PageBrowserProps) {
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

  // 主题色通过 CSS 变量传递，SCSS 中通过 var(--hamster-reader-theme-color) 消费
  const themeStyle = {
    '--hamster-reader-theme-color': themeColor ?? '#2563eb'
  } as React.CSSProperties

  // 侧栏列表的顶部/底部留白，与主视图 containMarginTop/Bottom 保持一致
  const listStyle: React.CSSProperties = {
    paddingTop:
      typeof containMarginTop === 'number'
        ? `${containMarginTop}px`
        : undefined,
    paddingBottom:
      typeof containMarginBottom === 'number'
        ? `${containMarginBottom}px`
        : undefined
  }

  return (
    <nav
      className={className}
      aria-label='Page browser'
      aria-hidden={!isOpen}
      data-testid='page-browser'
      style={themeStyle}
    >
      <div className='hamster-reader__page-browser-header'>Pages</div>
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
    </nav>
  )
}
