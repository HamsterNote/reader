import { Icon } from '@hamster-note/components'
import { useEffect, useRef, useState } from 'react'

import type { PdfPageState, PdfSelection, PdfThumbnail } from '../pdf-contracts'
import { getPdfPopoverPosition } from '../pdf-contracts'
import type { ReaderSourceLoadState } from '../types/source'
import { createPdfDomSession, type PdfDomSession } from './pdfDom'
import './pdf.css'

export type PdfReaderProps = {
  source: Uint8Array
  className?: string
  assetBaseUrl?: string
  onStateChange?: (state: ReaderSourceLoadState) => void
  onPageChange?: (page: PdfPageState) => void
}

let nextGeneration = 0

function PageThumbnail({
  number,
  current,
  session,
  onNavigate
}: {
  number: number
  current: boolean
  session: PdfDomSession | null
  onNavigate: (page: number) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [image, setImage] = useState<PdfThumbnail | null>(null)
  useEffect(() => {
    let active = true
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        session
          ?.getThumbnail(number)
          .then((thumbnail) => {
            if (active) setImage(thumbnail)
          })
          .catch(() => undefined)
      },
      { root: ref.current?.closest('.hn-pdf-pages'), rootMargin: '160px' }
    )
    if (ref.current) observer.observe(ref.current)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [number, session])
  return (
    <button
      ref={ref}
      type='button'
      className='hn-pdf-page-button'
      aria-label={`Page ${number}`}
      aria-current={current ? 'page' : undefined}
      onClick={() => onNavigate(number)}
    >
      <span className='hn-pdf-thumbnail'>
        {image && <img src={image.uri} alt='' />}
      </span>
      <span>{number}</span>
    </button>
  )
}

export default function PdfReader(props: PdfReaderProps) {
  const root = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<PdfDomSession | null>(null)
  const [page, setPage] = useState<PdfPageState | null>(null)
  const [count, setCount] = useState(0)
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const [pagesOpen, setPagesOpen] = useState(true)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const callback = useRef(props)
  callback.current = props
  useEffect(() => {
    let active = true
    const identity = {
      sessionId: crypto.randomUUID(),
      generation: ++nextGeneration
    }
    setSelection(null)
    setError(null)
    setPage(null)
    setCount(0)
    setScale(1)
    let opened: PdfDomSession | undefined
    try {
      opened = createPdfDomSession({
        viewport: viewport.current!,
        coordinateRoot: root.current!,
        bytes: props.source,
        identity,
        assetBaseUrl:
          props.assetBaseUrl ?? new URL('/pdf-runtime/', document.baseURI).href,
        events: {
          onStateChange(state) {
            if (!active) return
            if (state.status === 'error') {
              setError(state.error.message)
              setSelection(null)
            }
            callback.current.onStateChange?.(
              state.status === 'error'
                ? { status: 'error', error: state.error }
                : { status: state.status }
            )
          },
          onMetadata(metadata) {
            if (active) setCount(metadata.pageCount)
          },
          onPageChange(value) {
            if (active) {
              setPage(value)
              callback.current.onPageChange?.(value)
            }
          },
          onSelectionChange(_identity, value) {
            if (active) setSelection(value)
          }
        }
      })
      setSession(opened)
    } catch {
      setSession(null)
      setError('The PDF runtime could not be started.')
      callback.current.onStateChange?.({
        status: 'error',
        error: {
          category: 'render',
          code: 'PDF_RUNTIME_UNAVAILABLE',
          message: 'The PDF runtime could not be started.'
        }
      })
    }
    return () => {
      active = false
      opened?.dispose()
    }
  }, [props.source, props.assetBaseUrl])
  const navigate = (number: number) => {
    session?.goToPage(number).catch(() => undefined)
    if (root.current && root.current.clientWidth < 640) setPagesOpen(false)
  }
  const position = getPdfPopoverPosition(
    selection,
    root.current?.clientWidth ?? 0,
    root.current?.clientHeight ?? 0
  )
  return (
    <div
      ref={root}
      className={`hn-pdf-reader ${props.className ?? ''}`}
      data-testid='pdf-reader'
    >
      <div className='hn-pdf-toolbar'>
        <button
          type='button'
          title='Pages'
          aria-label='Pages'
          aria-expanded={pagesOpen}
          onClick={() => {
            session?.clearSelection()
            setPagesOpen((open) => !open)
          }}
        >
          <Icon name='menu' />
        </button>
        <span className='hn-pdf-counter' aria-live='polite'>
          {page?.pageNumber ?? 0} / {count}
        </span>
        <button
          type='button'
          title='Previous page'
          aria-label='Previous page'
          disabled={!page || page.pageNumber <= 1}
          onClick={() => navigate((page?.pageNumber ?? 1) - 1)}
        >
          <Icon name='chevron-left' />
        </button>
        <button
          type='button'
          title='Next page'
          aria-label='Next page'
          disabled={!page || page.pageNumber >= count}
          onClick={() => navigate((page?.pageNumber ?? 1) + 1)}
        >
          <Icon name='chevron-right' />
        </button>
        <select
          aria-label='Zoom'
          value={scale}
          onChange={(event) => {
            const value = Number(event.target.value)
            setScale(value)
            session?.setScale(value)
          }}
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((value) => (
            <option key={value} value={value}>
              {Math.round(value * 100)}%
            </option>
          ))}
        </select>
        <button
          type='button'
          title='Rotate page'
          aria-label='Rotate page'
          onClick={() => session?.rotate()}
        >
          <Icon name='redo' />
        </button>
      </div>
      <div className='hn-pdf-workspace'>
        {pagesOpen && (
          <aside className='hn-pdf-pages' aria-label='Pages'>
            {Array.from({ length: count }, (_, index) => (
              <PageThumbnail
                key={`${session?.identity.sessionId}-${index}`}
                number={index + 1}
                current={page?.pageNumber === index + 1}
                session={session}
                onNavigate={navigate}
              />
            ))}
          </aside>
        )}
        <div
          ref={viewport}
          className='hn-pdf-viewport'
          role='region'
          aria-label='PDF document'
        />
      </div>
      {error && (
        <div className='hn-pdf-error' role='alert'>
          {error}
        </div>
      )}
      {position && (
        <div
          className='hn-pdf-popover'
          role='dialog'
          aria-label='Text selection'
          style={position}
        >
          <button
            type='button'
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            高亮
          </button>
        </div>
      )}
    </div>
  )
}
