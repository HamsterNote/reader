import type { CSSProperties, RefObject } from 'react'

type PageBookmarkButtonProps = {
  readonly pageNumber: number
  readonly isBookmarked: boolean
  readonly isOpen: boolean
  readonly isEnabled: boolean
  readonly variant?: 'overlay' | 'inline'
  readonly onToggle?: (pageNumber: number) => void
}

function BookmarkIcon({ isBookmarked }: { readonly isBookmarked: boolean }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill={isBookmarked ? 'currentColor' : 'none'}
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      focusable='false'
    >
      <path d='M6 3h12v18l-6-4-6 4V3z' />
    </svg>
  )
}

export function PageBookmarkButton({
  pageNumber,
  isBookmarked,
  isOpen,
  isEnabled,
  variant = 'overlay',
  onToggle
}: PageBookmarkButtonProps) {
  return (
    <button
      type='button'
      className={`hamster-reader__bookmark-toggle hamster-reader__bookmark-toggle--${variant}`}
      aria-label={`${isBookmarked ? '删除' : '添加'}第 ${pageNumber} 页书签`}
      aria-pressed={isBookmarked}
      disabled={!isEnabled}
      tabIndex={isOpen && isEnabled ? 0 : -1}
      onClick={() => onToggle?.(pageNumber)}
    >
      <BookmarkIcon isBookmarked={isBookmarked} />
    </button>
  )
}

type PageBrowserBookmarksPanelProps = {
  readonly bookmarkedPageNumbers: readonly number[]
  readonly isOpen: boolean
  readonly isEnabled: boolean
  readonly scrollRootRef: RefObject<HTMLDivElement | null>
  readonly listStyle: CSSProperties
  readonly onNavigateToPage: (pageNumber: number) => void
  readonly onTogglePageBookmark?: (pageNumber: number) => void
}

export function PageBrowserBookmarksPanel({
  bookmarkedPageNumbers,
  isOpen,
  isEnabled,
  scrollRootRef,
  listStyle,
  onNavigateToPage,
  onTogglePageBookmark
}: PageBrowserBookmarksPanelProps) {
  return (
    <div
      ref={scrollRootRef}
      className='hamster-reader__bookmark-list'
      style={listStyle}
    >
      {bookmarkedPageNumbers.length === 0 ? (
        <p className='hamster-reader__highlight-empty'>暂无书签</p>
      ) : (
        bookmarkedPageNumbers.map((pageNumber) => (
          <div key={pageNumber} className='hamster-reader__bookmark-item'>
            <button
              type='button'
              className='hamster-reader__bookmark-link'
              aria-label={`跳转到书签：第 ${pageNumber} 页`}
              tabIndex={isOpen ? 0 : -1}
              data-page-number={pageNumber}
              onClick={() => onNavigateToPage(pageNumber)}
            >
              <span>第 {pageNumber} 页</span>
            </button>
            <PageBookmarkButton
              pageNumber={pageNumber}
              isBookmarked={true}
              isOpen={isOpen}
              isEnabled={isEnabled}
              variant='inline'
              onToggle={onTogglePageBookmark}
            />
          </div>
        ))
      )}
    </div>
  )
}
