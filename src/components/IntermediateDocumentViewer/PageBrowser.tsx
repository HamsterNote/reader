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
}

export function PageBrowser({
  isOpen,
  pageNumbers,
  pageSizesByPageNumber,
  baseImagesByPageNumber,
  onPageVisibilityChange,
  onNavigateToPage
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

  return (
    <nav
      className={className}
      aria-label='Page browser'
      aria-hidden={!isOpen}
      data-testid='page-browser'
    >
      <div className='hamster-reader__page-browser-header'>Pages</div>
      <div ref={scrollRootRef} className='hamster-reader__page-browser-list'>
        {pageNumbers.map((pageNumber) => {
          const pageSize = pageSizesByPageNumber.get(pageNumber)
          const baseImage = baseImagesByPageNumber.get(pageNumber)
          const aspectRatio = pageSize
            ? `${pageSize.width} / ${pageSize.height}`
            : undefined

          return (
            <button
              key={pageNumber}
              type='button'
              className='hamster-reader__page-browser-item'
              aria-label={`Go to page ${pageNumber}`}
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
