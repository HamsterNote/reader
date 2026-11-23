import { useEffect, useRef, useState } from 'react'
import { usePositionTransaction } from '../components/reading/usePositionTransaction'
import type { PDFDocumentProxy } from './pdfjsRuntime'

const PDF_OUTLINE_TIMEOUT_MS = 10_000

type PdfJsOutlineItem = NonNullable<
  Awaited<ReturnType<PDFDocumentProxy['getOutline']>>
>[number]

type PdfOutlineItem = {
  readonly id: string
  readonly title: string
  readonly destination: string | readonly unknown[] | null
  readonly external: boolean
  readonly items: readonly PdfOutlineItem[]
}

type OutlineState = {
  readonly document: PDFDocumentProxy
  readonly status: 'loading' | 'ready' | 'error'
  readonly items: readonly PdfOutlineItem[]
}

function normalizeOutline(
  items: readonly PdfJsOutlineItem[],
  parentId = ''
): readonly PdfOutlineItem[] {
  return items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const id = parentId ? `${parentId}.${index}` : String(index)
    const destination =
      typeof item.dest === 'string' || Array.isArray(item.dest)
        ? item.dest
        : null
    return [
      {
        id,
        title: typeof item.title === 'string' ? item.title : '未命名章节',
        destination,
        external: Boolean(
          item.url || item.unsafeUrl || ('action' in item && item.action)
        ),
        items: normalizeOutline(Array.isArray(item.items) ? item.items : [], id)
      }
    ]
  })
}

async function withinTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('PDF outline request timed out')),
          PDF_OUTLINE_TIMEOUT_MS
        )
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function resolveOutlinePage(
  document: PDFDocumentProxy,
  destination: string | readonly unknown[]
): Promise<number | null> {
  try {
    const explicit = await withinTimeout(
      typeof destination === 'string'
        ? document.getDestination(destination)
        : Promise.resolve(destination)
    )
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const target = explicit[0]
    let pageIndex: number
    if (Number.isInteger(target)) {
      pageIndex = target as number
    } else if (typeof target === 'object' && target !== null) {
      pageIndex = await withinTimeout(
        document.getPageIndex(
          target as Parameters<PDFDocumentProxy['getPageIndex']>[0]
        )
      )
    } else {
      return null
    }
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= document.numPages
    ) {
      return null
    }
    return pageIndex + 1
  } catch {
    return null
  }
}

function PdfOutlineItems({
  items,
  onNavigate
}: {
  readonly items: readonly PdfOutlineItem[]
  readonly onNavigate: (item: PdfOutlineItem) => void
}) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} data-outline-item={item.id}>
          <button
            type='button'
            disabled={!item.destination || item.external}
            onClick={() => onNavigate(item)}
          >
            {item.title}
          </button>
          {item.items.length > 0 && (
            <PdfOutlineItems items={item.items} onNavigate={onNavigate} />
          )}
        </li>
      ))}
    </ul>
  )
}

export function PdfOutline({
  document,
  isActive,
  pageNumbers,
  onNavigate
}: {
  readonly document: PDFDocumentProxy | null
  readonly isActive: boolean
  readonly pageNumbers: readonly number[]
  readonly onNavigate: (pageNumber: number) => void
}) {
  const successful = useRef(
    new WeakMap<PDFDocumentProxy, readonly PdfOutlineItem[]>()
  )
  const pending = useRef(
    new WeakMap<PDFDocumentProxy, Promise<readonly PdfOutlineItem[]>>()
  )
  const latest = useRef({ document, pageNumbers, onNavigate })
  latest.current = { document, pageNumbers, onNavigate }
  const { begin: beginNavigation, isCurrent: isNavigationCurrent } =
    usePositionTransaction(document)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<OutlineState | null>(null)

  useEffect(() => {
    if (!document || !isActive) return
    let current = true
    const cached = successful.current.get(document)
    if (cached) {
      setState({ document, status: 'ready', items: cached })
      return
    }

    setState({ document, status: 'loading', items: [] })
    let request = pending.current.get(document)
    if (!request) {
      request = withinTimeout(document.getOutline())
        .then((items) => normalizeOutline(items ?? []))
        .then((items) => {
          successful.current.set(document, items)
          return items
        })
        .finally(() => pending.current.delete(document))
      pending.current.set(document, request)
    }
    request
      .then((items) => {
        if (current) setState({ document, status: 'ready', items })
      })
      .catch(() => {
        if (current) setState({ document, status: 'error', items: [] })
      })
    return () => {
      current = false
    }
  }, [document, isActive, retry])

  const navigate = async (item: PdfOutlineItem) => {
    const owner = document
    if (!owner || !item.destination || item.external) return
    const transaction = beginNavigation()
    const pageNumber = await resolveOutlinePage(owner, item.destination)
    if (
      !isNavigationCurrent(transaction) ||
      pageNumber === null ||
      latest.current.document !== owner ||
      !latest.current.pageNumbers.includes(pageNumber)
    ) {
      return
    }
    latest.current.onNavigate(pageNumber)
  }

  if (!document) return <p role='status'>正在等待 PDF 文档…</p>
  if (!state || state.document !== document || state.status === 'loading') {
    return <p role='status'>正在读取章节目录…</p>
  }
  if (state.status === 'error') {
    return (
      <div role='alert'>
        <p>章节目录读取失败，请重试。</p>
        <button type='button' onClick={() => setRetry((value) => value + 1)}>
          重试
        </button>
      </div>
    )
  }
  if (state.items.length === 0) {
    return <p role='status'>此 PDF 没有内嵌章节目录，可使用页面导航。</p>
  }
  return (
    <PdfOutlineItems
      items={state.items}
      onNavigate={(item) => void navigate(item)}
    />
  )
}
