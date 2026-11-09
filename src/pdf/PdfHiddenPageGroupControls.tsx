import { useLayoutEffect, useRef } from 'react'
import type { HiddenPageGroup } from './hiddenPages'

type PageView = { readonly div: HTMLElement }

type Props = {
  readonly groups: readonly HiddenPageGroup[]
  readonly readablePages: readonly number[]
  readonly container: HTMLDivElement | null
  readonly viewer: HTMLDivElement | null
  readonly getPageView: (pageNumber: number) => PageView | undefined
  readonly onOpen: (groupStart: number, trigger: HTMLButtonElement) => void
}

const BUTTON_HALF_HEIGHT = 16

export function PdfHiddenPageGroupControls({
  groups,
  readablePages,
  container,
  viewer,
  getPageView,
  onOpen
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const hasAnchors = groups.length > 0 && readablePages.length > 0
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    if (!container || !viewer || !overlay || !hasAnchors) return
    // Both coordinates live in document space. X tracks the viewport centre;
    // the clipping layer follows the viewer's width, never scrollLeft, so it
    // cannot keep an obsolete horizontal overflow alive after zooming out.
    const alignViewport = () => {
      overlay.style.setProperty(
        '--pdf-hidden-anchor-x',
        `${container.scrollLeft + container.clientWidth / 2}px`
      )
    }
    const resize = () => {
      overlay.style.width = `${Math.max(container.clientWidth, viewer.scrollWidth)}px`
      alignViewport()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    observer.observe(viewer)
    container.addEventListener('scroll', alignViewport, { passive: true })
    return () => {
      observer.disconnect()
      container.removeEventListener('scroll', alignViewport)
    }
  }, [container, viewer, hasAnchors])

  if (groups.length === 0) return null
  if (readablePages.length === 0) {
    const count = groups.reduce((total, group) => total + group.pages.length, 0)
    return (
      <div className='hamster-reader__pdf-hidden-empty'>
        <button
          type='button'
          aria-label={`查看 ${count} 个隐藏页`}
          data-hidden-page-group={`${groups[0]!.start}-${groups.at(-1)!.end}`}
          data-testid='pdf-hidden-page-group'
          onClick={(event) => onOpen(groups[0]!.start, event.currentTarget)}
        >
          查看隐藏页
          <span className='hamster-reader__pdf-hidden-count'>{count}</span>
        </button>
      </div>
    )
  }
  if (!container || !viewer) return null

  const containerRect = container.getBoundingClientRect()
  const contentTop = (rect: DOMRect) =>
    rect.top - containerRect.top + container.scrollTop
  const contentBottom = (rect: DOMRect) =>
    rect.bottom - containerRect.top + container.scrollTop
  const contentHeight = viewer.scrollHeight
  const clampAnchor = (top: number) =>
    Math.max(
      BUTTON_HALF_HEIGHT,
      Math.min(contentHeight - BUTTON_HALF_HEIGHT, top)
    )

  return (
    <div
      ref={overlayRef}
      className='hamster-reader__pdf-hidden-groups'
      style={{ height: contentHeight }}
      aria-label='隐藏页恢复入口'
    >
      {groups.map((group) => {
        const previousPage = readablePages
          .filter((page) => page < group.start)
          .at(-1)
        const nextPage = readablePages.find((page) => page > group.end)
        const previous = previousPage
          ? getPageView(previousPage)?.div.getBoundingClientRect()
          : undefined
        const next = nextPage
          ? getPageView(nextPage)?.div.getBoundingClientRect()
          : undefined
        let top = BUTTON_HALF_HEIGHT
        if (previous && next) {
          top = (contentBottom(previous) + contentTop(next)) / 2
        } else if (previous) {
          top = contentBottom(previous)
        } else if (next) {
          top = contentTop(next)
        }
        const count = group.pages.length
        return (
          <button
            key={group.start}
            type='button'
            className='hamster-reader__pdf-hidden-group'
            style={{ top: clampAnchor(top) }}
            data-hidden-page-group={`${group.start}-${group.end}`}
            data-testid={`pdf-hidden-page-group-${group.start}-${group.end}`}
            aria-label={`查看第 ${group.start} 至 ${group.end} 页，共 ${count} 个隐藏页`}
            onClick={(event) => onOpen(group.start, event.currentTarget)}
          >
            隐藏
            <span className='hamster-reader__pdf-hidden-count'>{count}</span>页
          </button>
        )
      })}
    </div>
  )
}
