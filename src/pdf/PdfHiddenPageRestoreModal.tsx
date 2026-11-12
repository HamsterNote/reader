import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HiddenPageGroup } from './hiddenPages'
import type { PDFDocumentProxy, PDFPageProxy } from './pdfjsRuntime'
import { usePdfPreviews } from './usePdfPreviews'

type Props = {
  readonly groups: readonly HiddenPageGroup[]
  readonly initialGroupStart: number
  readonly document: PDFDocumentProxy | null
  readonly bodyBusy: () => boolean
  readonly releasePage: (document: PDFDocumentProxy, page: PDFPageProxy) => void
  readonly onClose: () => void
  readonly onConfirm: (pageNumbers: readonly number[]) => void
}

export function PdfHiddenPageRestoreModal({
  groups,
  initialGroupStart,
  document,
  bodyBusy,
  releasePage,
  onClose,
  onConfirm
}: Props) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previews = usePdfPreviews(document, true, bodyBusy, releasePage)
  const pages = groups.flatMap((group) => group.pages)
  const allSelected = pages.length > 0 && selected.size === pages.length

  useEffect(() => {
    closeRef.current?.focus()
    listRef.current
      ?.querySelector(`[data-hidden-group-start="${initialGroupStart}"]`)
      ?.scrollIntoView?.({ block: 'start' })
  }, [initialGroupStart])

  useEffect(() => {
    setSelected((current) => {
      const available = new Set(pages)
      const next = new Set([...current].filter((page) => available.has(page)))
      return next.size === current.size ? current : next
    })
  }, [groups])

  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const items = [
      ...root.querySelectorAll<HTMLElement>('[data-hidden-preview-page]')
    ]
    if (typeof IntersectionObserver === 'undefined') {
      for (const item of items.slice(0, 12)) {
        previews.onVisibility(Number(item.dataset.hiddenPreviewPage), true)
      }
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number(
            (entry.target as HTMLElement).dataset.hiddenPreviewPage
          )
          previews.onVisibility(pageNumber, entry.isIntersecting)
        }
      },
      { root, rootMargin: '160px' }
    )
    for (const item of items) observer.observe(item)
    return () => observer.disconnect()
  }, [groups, previews.onVisibility])

  const toggle = (pageNumber: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(pageNumber)) next.delete(pageNumber)
      else next.add(pageNumber)
      return next
    })
  }
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex="0"]'
        )
      ]
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div className='hamster-reader__pdf-hidden-modal-backdrop'>
      <div
        ref={dialogRef}
        role='dialog'
        tabIndex={-1}
        aria-modal='true'
        aria-labelledby='pdf-hidden-pages-title'
        className='hamster-reader__pdf-hidden-modal'
      >
        <div className='hamster-reader__pdf-hidden-modal-header'>
          <h2 id='pdf-hidden-pages-title'>恢复隐藏页</h2>
          <button
            ref={closeRef}
            type='button'
            className='hamster-reader__pdf-hidden-modal-close'
            aria-label='关闭隐藏页恢复'
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div ref={listRef} className='hamster-reader__pdf-hidden-modal-list'>
          {groups.map((group) => (
            <section key={group.start} data-hidden-group-start={group.start}>
              <h3>
                {group.start === group.end
                  ? `第 ${group.start} 页`
                  : `第 ${group.start}–${group.end} 页（${group.pages.length} 页）`}
              </h3>
              <div className='hamster-reader__pdf-hidden-page-grid'>
                {group.pages.map((pageNumber) => {
                  const image = previews.images.get(pageNumber)
                  const size = previews.sizes.get(pageNumber)
                  const checked = selected.has(pageNumber)
                  return (
                    <div key={pageNumber}>
                      <button
                        type='button'
                        role='checkbox'
                        aria-checked={checked}
                        aria-label={`${checked ? '取消选择' : '选择'}第 ${pageNumber} 页`}
                        className='hamster-reader__pdf-hidden-page'
                        data-hidden-preview-page={pageNumber}
                        data-testid={`pdf-hidden-restore-page-${pageNumber}`}
                        onClick={() => toggle(pageNumber)}
                      >
                        <span
                          className='hamster-reader__pdf-hidden-preview'
                          style={{
                            aspectRatio: size
                              ? `${size.width} / ${size.height}`
                              : '3 / 4'
                          }}
                        >
                          {image ? (
                            <img src={image} alt='' draggable={false} />
                          ) : null}
                        </span>
                        <span>第 {pageNumber} 页</span>
                        {checked && (
                          <span
                            className='hamster-reader__pdf-hidden-check'
                            aria-hidden='true'
                          >
                            ✓
                          </span>
                        )}
                      </button>
                      {previews.errors.has(pageNumber) && (
                        <button
                          type='button'
                          className='hamster-reader__pdf-hidden-preview-retry'
                          onClick={() => previews.retryPage(pageNumber)}
                        >
                          第 {pageNumber} 页预览失败，重试
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
        <div className='hamster-reader__pdf-hidden-modal-footer'>
          <button
            type='button'
            className='hamster-reader__pdf-hidden-modal-select-all'
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(pages))
            }
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
          <button type='button' onClick={onClose}>
            取消
          </button>
          <button
            type='button'
            className='hamster-reader__pdf-hidden-modal-confirm'
            disabled={selected.size === 0}
            onClick={() =>
              onConfirm([...selected].sort((left, right) => left - right))
            }
          >
            恢复 {selected.size} 页
          </button>
        </div>
      </div>
    </div>,
    window.document.body
  )
}
