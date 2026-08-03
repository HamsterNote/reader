import type { CSSProperties, RefObject } from 'react'
import { useCallback } from 'react'
import { confirm } from '@hamster-note/components'
import type { ReaderBookmark, ReaderTextAnchor } from '../../types/readerData'
import { getTextAnchorKey } from './textAnchor'

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

function TrashIcon() {
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
      <polyline points='3 6 5 6 21 6' />
      <path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
      <line x1='10' y1='11' x2='10' y2='17' />
      <line x1='14' y1='11' x2='14' y2='17' />
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
  readonly bookmarks?: readonly ReaderBookmark[]
  readonly currentAnchor?: ReaderTextAnchor
  readonly activeBookmarkKey?: string
  readonly bookmarkedPageNumbers: readonly number[]
  readonly currentPageNumber?: number
  readonly isOpen: boolean
  readonly isTextBookmarkEnabled: boolean
  readonly isPageBookmarkEnabled: boolean
  readonly scrollRootRef: RefObject<HTMLDivElement | null>
  readonly listStyle: CSSProperties
  readonly onNavigateToPage: (pageNumber: number) => void
  readonly onNavigateToBookmark?: (bookmark: ReaderBookmark) => void
  readonly onToggleBookmark?: (bookmark: ReaderBookmark) => void
  readonly onTogglePageBookmark?: (pageNumber: number) => void
}

type TextBookmarksListProps = {
  readonly bookmarks: readonly ReaderBookmark[]
  readonly isOpen: boolean
  readonly isEnabled: boolean
  readonly activeBookmarkKey?: string
  readonly onNavigate?: (bookmark: ReaderBookmark) => void
  readonly onToggle?: (bookmark: ReaderBookmark) => void
}

function TextBookmarksList({
  bookmarks,
  isOpen,
  isEnabled,
  activeBookmarkKey,
  onNavigate,
  onToggle
}: TextBookmarksListProps) {
  const handleDelete = useCallback(
    async (bookmark: ReaderBookmark) => {
      const shouldDelete = await confirm({
        title: '删除书签？',
        description: `删除“${bookmark.text}”书签后无法恢复。`,
        confirmText: '删除',
        cancelText: '取消',
        tone: 'danger'
      })
      if (shouldDelete) {
        onToggle?.(bookmark)
      }
    },
    [onToggle]
  )

  if (bookmarks.length === 0) {
    return <p className='hamster-reader__highlight-empty'>暂无书签</p>
  }

  return bookmarks.map((bookmark) => {
    const bookmarkKey = getTextAnchorKey(bookmark)
    const isActive = bookmarkKey === activeBookmarkKey
    return (
      <div key={bookmarkKey} className='hamster-reader__bookmark-item'>
        <button
          type='button'
          className={
            isActive
              ? 'hamster-reader__bookmark-link hamster-reader__bookmark-link--active'
              : 'hamster-reader__bookmark-link'
          }
          aria-label={`跳转到书签：${bookmark.text}`}
          aria-current={isActive ? 'location' : undefined}
          tabIndex={isOpen ? 0 : -1}
          data-page-number={bookmark.pageNumber}
          onClick={() => onNavigate?.(bookmark)}
        >
          <span className='hamster-reader__highlight-text'>
            {bookmark.text}
          </span>
          <span>第 {bookmark.pageNumber} 页</span>
        </button>
        <button
          type='button'
          className='hamster-reader__bookmark-delete'
          aria-label={`删除书签：${bookmark.text}`}
          disabled={!isEnabled}
          tabIndex={isOpen && isEnabled ? 0 : -1}
          onClick={() => void handleDelete(bookmark)}
        >
          <TrashIcon />
        </button>
      </div>
    )
  })
}

type LegacyBookmarksListProps = {
  readonly pageNumbers: readonly number[]
  readonly isOpen: boolean
  readonly isEnabled: boolean
  readonly onNavigate: (pageNumber: number) => void
  readonly onToggle?: (pageNumber: number) => void
}

function LegacyBookmarksList({
  pageNumbers,
  isOpen,
  isEnabled,
  onNavigate,
  onToggle
}: LegacyBookmarksListProps) {
  const handleDelete = useCallback(
    async (pageNumber: number) => {
      const shouldDelete = await confirm({
        title: '删除书签？',
        description: `删除第 ${pageNumber} 页书签后无法恢复。`,
        confirmText: '删除',
        cancelText: '取消',
        tone: 'danger'
      })
      if (shouldDelete) {
        onToggle?.(pageNumber)
      }
    },
    [onToggle]
  )

  if (pageNumbers.length === 0) {
    return <p className='hamster-reader__highlight-empty'>暂无书签</p>
  }

  return pageNumbers.map((pageNumber) => {
    return (
      <div key={pageNumber} className='hamster-reader__bookmark-item'>
        <button
          type='button'
          className='hamster-reader__bookmark-link'
          aria-label={`跳转到书签：第 ${pageNumber} 页`}
          tabIndex={isOpen ? 0 : -1}
          data-page-number={pageNumber}
          onClick={() => onNavigate(pageNumber)}
        >
          <span>第 {pageNumber} 页</span>
        </button>
        <button
          type='button'
          className='hamster-reader__bookmark-delete'
          aria-label={`删除书签：第 ${pageNumber} 页`}
          disabled={!isEnabled}
          tabIndex={isOpen && isEnabled ? 0 : -1}
          onClick={() => void handleDelete(pageNumber)}
        >
          <TrashIcon />
        </button>
      </div>
    )
  })
}

export function PageBrowserBookmarksPanel({
  bookmarks,
  currentAnchor,
  activeBookmarkKey,
  bookmarkedPageNumbers,
  currentPageNumber,
  isOpen,
  isTextBookmarkEnabled,
  isPageBookmarkEnabled,
  scrollRootRef,
  listStyle,
  onNavigateToPage,
  onNavigateToBookmark,
  onToggleBookmark,
  onTogglePageBookmark
}: PageBrowserBookmarksPanelProps) {
  const usesTextBookmarks =
    bookmarks !== undefined || onToggleBookmark !== undefined
  const textBookmarks = bookmarks ?? []
  const currentAnchorKey = currentAnchor
    ? getTextAnchorKey(currentAnchor)
    : undefined
  const canAddCurrentAnchor =
    isTextBookmarkEnabled &&
    currentAnchor !== undefined &&
    !textBookmarks.some(
      (bookmark) => getTextAnchorKey(bookmark) === currentAnchorKey
    )
  const canAddCurrentPage =
    isPageBookmarkEnabled &&
    currentPageNumber !== undefined &&
    !bookmarkedPageNumbers.includes(currentPageNumber)

  return (
    <div
      ref={scrollRootRef}
      className='hamster-reader__bookmark-list'
      style={listStyle}
    >
      <button
        type='button'
        className='hamster-reader__bookmark-add'
        disabled={usesTextBookmarks ? !canAddCurrentAnchor : !canAddCurrentPage}
        tabIndex={isOpen ? 0 : -1}
        onClick={() => {
          if (usesTextBookmarks && canAddCurrentAnchor) {
            onToggleBookmark?.(currentAnchor)
          } else if (!usesTextBookmarks && canAddCurrentPage) {
            onTogglePageBookmark?.(currentPageNumber)
          }
        }}
      >
        新增书签
      </button>
      {usesTextBookmarks ? (
        <TextBookmarksList
          bookmarks={textBookmarks}
          isOpen={isOpen}
          isEnabled={isTextBookmarkEnabled}
          activeBookmarkKey={activeBookmarkKey}
          onNavigate={onNavigateToBookmark}
          onToggle={onToggleBookmark}
        />
      ) : (
        <LegacyBookmarksList
          pageNumbers={bookmarkedPageNumbers}
          isOpen={isOpen}
          isEnabled={isPageBookmarkEnabled}
          onNavigate={onNavigateToPage}
          onToggle={onTogglePageBookmark}
        />
      )}
    </div>
  )
}
