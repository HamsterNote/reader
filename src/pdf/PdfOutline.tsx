import { useEffect, useMemo, useRef, useState } from 'react'
import type { OutlineTreeNode } from '../components/OutlineTree'
import { OutlineTree } from '../components/OutlineTree'
import { usePositionTransaction } from '../components/reading/usePositionTransaction'
import { correctOutlineTitlePages } from './pdfOutlineTitleCorrection'
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

type PageCache = {
  readonly items: readonly PdfOutlineItem[]
  readonly pageById: Map<string, number>
  bulk?: Promise<void>
  corrected?: Promise<ReadonlyMap<string, number>>
}

type PageSnapshot = {
  readonly document: PDFDocumentProxy
  readonly items: readonly PdfOutlineItem[]
  readonly pageById: ReadonlyMap<string, number>
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

type PdfOutlineTarget = {
  readonly id: string
  readonly destination: string | readonly unknown[]
}

function collectTargets(
  items: readonly PdfOutlineItem[],
  out: PdfOutlineTarget[]
) {
  for (const item of items) {
    if (item.destination && !item.external) {
      out.push({ id: item.id, destination: item.destination })
    }
    collectTargets(item.items, out)
  }
}

async function resolveOutlinePages(
  document: PDFDocumentProxy,
  items: readonly PdfOutlineItem[],
  pageById: Map<string, number>
): Promise<void> {
  const targets: PdfOutlineTarget[] = []
  collectTargets(items, targets)
  const entries = await Promise.all(
    targets.map(
      async (target) =>
        [
          target.id,
          await resolveOutlinePage(document, target.destination)
        ] as const
    )
  )
  for (const [id, pageNumber] of entries) {
    if (pageNumber !== null) pageById.set(id, pageNumber)
  }
}

function toOutlineNodes(
  items: readonly PdfOutlineItem[],
  pageById: ReadonlyMap<string, number> | null
): readonly OutlineTreeNode[] {
  return items.map((item) => {
    const disabled = !item.destination || item.external
    return {
      id: item.id,
      label: item.title,
      targetPage: disabled ? null : (pageById?.get(item.id) ?? null),
      disabled,
      children: toOutlineNodes(item.items, pageById)
    }
  })
}

function indexOutlineItems(
  items: readonly PdfOutlineItem[],
  out = new Map<string, PdfOutlineItem>()
) {
  for (const item of items) {
    out.set(item.id, item)
    indexOutlineItems(item.items, out)
  }
  return out
}

function collectTitleTargets(
  items: readonly PdfOutlineItem[],
  pageById: ReadonlyMap<string, number>,
  out: { id: string; title: string; pageNumber: number }[] = []
) {
  for (const item of items) {
    const pageNumber = pageById.get(item.id)
    if (
      pageNumber !== undefined &&
      item.destination &&
      !item.external &&
      item.title
    ) {
      out.push({ id: item.id, title: item.title, pageNumber })
    }
    collectTitleTargets(item.items, pageById, out)
  }
  return out
}

export function PdfOutline({
  document,
  isActive,
  currentPageNumber,
  pageNumbers,
  onNavigate
}: {
  readonly document: PDFDocumentProxy | null
  readonly isActive: boolean
  readonly currentPageNumber?: number | null
  readonly pageNumbers: readonly number[]
  readonly onNavigate: (pageNumber: number) => void
}) {
  const successful = useRef(
    new WeakMap<PDFDocumentProxy, readonly PdfOutlineItem[]>()
  )
  const pending = useRef(
    new WeakMap<PDFDocumentProxy, Promise<readonly PdfOutlineItem[]>>()
  )
  const pageCaches = useRef(new WeakMap<PDFDocumentProxy, PageCache>())
  const latest = useRef({ document, pageNumbers, onNavigate })
  latest.current = { document, pageNumbers, onNavigate }
  const { begin: beginNavigation, isCurrent: isNavigationCurrent } =
    usePositionTransaction(document)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<OutlineState | null>(null)
  const [pageSnapshot, setPageSnapshot] = useState<PageSnapshot | null>(null)
  const hasCurrentPage =
    currentPageNumber !== null && currentPageNumber !== undefined

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

  useEffect(() => {
    if (
      !document ||
      !hasCurrentPage ||
      !state ||
      state.document !== document ||
      state.status !== 'ready'
    ) {
      return
    }
    let current = true
    let cache = pageCaches.current.get(document)
    if (!cache || cache.items !== state.items) {
      cache = { items: state.items, pageById: new Map() }
      pageCaches.current.set(document, cache)
    }
    const entry = cache
    if (!entry.bulk) {
      entry.bulk = resolveOutlinePages(
        document,
        state.items,
        entry.pageById
      ).catch(() => undefined)
    }
    entry.bulk
      .then(() => {
        if (!current) return undefined
        setPageSnapshot({
          document,
          items: state.items,
          pageById: new Map(entry.pageById)
        })
        if (!entry.corrected) {
          entry.corrected = correctOutlineTitlePages(
            document,
            collectTitleTargets(state.items, entry.pageById)
          ).catch(() => new Map())
        }
        return entry.corrected
      })
      .then((corrected) => {
        if (!current || !corrected) return
        for (const [id, pageNumber] of corrected) {
          if (pageNumber >= 1 && pageNumber <= document.numPages) {
            entry.pageById.set(id, pageNumber)
          }
        }
        setPageSnapshot({
          document,
          items: state.items,
          pageById: new Map(entry.pageById)
        })
      })
    return () => {
      current = false
    }
  }, [document, hasCurrentPage, state])

  const itemById = useMemo(
    () => (state?.status === 'ready' ? indexOutlineItems(state.items) : null),
    [state]
  )

  const nodes = useMemo(() => {
    if (!state || state.status !== 'ready' || state.document !== document) {
      return [] as readonly OutlineTreeNode[]
    }
    const pageById =
      pageSnapshot &&
      pageSnapshot.document === document &&
      pageSnapshot.items === state.items
        ? pageSnapshot.pageById
        : null
    return toOutlineNodes(state.items, pageById)
  }, [document, pageSnapshot, state])

  const navigate = async (item: PdfOutlineItem | undefined) => {
    const owner = document
    if (!owner || !item || !item.destination || item.external) return
    const transaction = beginNavigation()
    const pageNumber = await resolveOutlinePage(owner, item.destination)
    if (pageNumber === null) return
    const currentState = state
    const readyState =
      currentState?.status === 'ready' && currentState.document === owner
        ? currentState
        : null
    let cache: PageCache | undefined
    let effectivePage = pageNumber
    if (readyState) {
      cache = pageCaches.current.get(owner)
      if (!cache || cache.items !== readyState.items) {
        cache = { items: readyState.items, pageById: new Map() }
        pageCaches.current.set(owner, cache)
      }
      const entry = cache
      const correction =
        entry.corrected ??
        (entry.corrected = (entry.bulk ?? Promise.resolve())
          .then(() =>
            correctOutlineTitlePages(
              owner,
              collectTitleTargets(readyState.items, entry.pageById)
            )
          )
          .catch(() => new Map()))
      const corrected = await withinTimeout(correction).catch(() => null)
      const correctedPage = corrected?.get(item.id)
      if (correctedPage !== undefined) {
        effectivePage = correctedPage
      } else {
        const searched = await withinTimeout(
          correctOutlineTitlePages(owner, [
            { id: item.id, title: item.title, pageNumber }
          ])
        ).catch(() => null)
        effectivePage = searched?.get(item.id) ?? pageNumber
      }
    }
    if (
      !isNavigationCurrent(transaction) ||
      latest.current.document !== owner ||
      !latest.current.pageNumbers.includes(effectivePage)
    ) {
      return
    }
    if (readyState && cache) {
      cache.pageById.set(item.id, effectivePage)
      setPageSnapshot({
        document: owner,
        items: readyState.items,
        pageById: new Map(cache.pageById)
      })
    }
    latest.current.onNavigate(effectivePage)
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
    <OutlineTree
      items={nodes}
      currentPage={currentPageNumber ?? null}
      pageNumbers={pageNumbers}
      documentKey={document}
      onNavigate={(node) => void navigate(itemById?.get(node.id))}
    />
  )
}
