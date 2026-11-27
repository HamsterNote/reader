import { useEffect, useMemo, useRef, useState } from 'react'
import type { OutlineTreeNode } from '../components/OutlineTree'
import { OutlineTree } from '../components/OutlineTree'
import { usePositionTransaction } from '../components/reading/usePositionTransaction'
import {
  findOutlineTitlePage,
  scanOutlineTitlePages
} from './pdfOutlineTitleCorrection'
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

export type PdfOutlineSessionState = {
  collapsed: Set<string>
  readonly corrections: Map<string, number>
  mismatchDetected: boolean
}

export function createPdfOutlineSessionState(): PdfOutlineSessionState {
  return {
    collapsed: new Set(),
    corrections: new Map(),
    mismatchDetected: false
  }
}

type PageCache = {
  readonly items: readonly PdfOutlineItem[]
  readonly annotatedById: Map<string, number>
  readonly correctedById: Map<string, number>
  mismatchDetected: boolean
  resolved?: Promise<void>
}

type PageSnapshot = {
  readonly document: PDFDocumentProxy
  readonly items: readonly PdfOutlineItem[]
  readonly annotatedById: ReadonlyMap<string, number>
  readonly correctedById: ReadonlyMap<string, number>
  readonly mismatchDetected: boolean
  readonly complete: boolean
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
  annotatedById: Map<string, number>
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
    if (pageNumber !== null) annotatedById.set(id, pageNumber)
  }
}

function toOutlineNodes(
  items: readonly PdfOutlineItem[],
  snapshot: PageSnapshot | null
): readonly OutlineTreeNode[] {
  return items.map((item) => {
    const disabled = !item.destination || item.external
    let targetPage: number | null = null
    if (!disabled && snapshot) {
      const corrected = snapshot.correctedById.get(item.id)
      const annotated = snapshot.annotatedById.get(item.id)
      // 文档已出现标注页与真实页不符的证据后，未经验证的候选不参与高亮；
      // 点击仍会即时使用标注页，避免把用户带到错误页还高亮成另一章。
      targetPage =
        corrected ?? (snapshot.mismatchDetected ? null : (annotated ?? null))
    }
    return {
      id: item.id,
      label: item.title,
      targetPage,
      disabled,
      children: toOutlineNodes(item.items, snapshot)
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
  annotatedById: ReadonlyMap<string, number>,
  out: { id: string; title: string; pageNumber: number }[] = []
) {
  for (const item of items) {
    const pageNumber = annotatedById.get(item.id)
    if (
      pageNumber !== undefined &&
      item.destination &&
      !item.external &&
      item.title
    ) {
      out.push({ id: item.id, title: item.title, pageNumber })
    }
    collectTitleTargets(item.items, annotatedById, out)
  }
  return out
}

type ClickTargetResolution = {
  readonly pageNumber: number
  readonly correctedPage?: number
}

type ClickAnnotation = {
  readonly pageNumber: number
  readonly fromDestination: boolean
}

async function resolveClickAnnotation(
  document: PDFDocumentProxy,
  item: PdfOutlineItem & {
    readonly destination: NonNullable<PdfOutlineItem['destination']>
  },
  cache: PageCache | undefined
): Promise<ClickAnnotation | undefined> {
  const annotatedPage = cache?.annotatedById.get(item.id)
  if (annotatedPage !== undefined) {
    return { pageNumber: annotatedPage, fromDestination: false }
  }
  const resolved = await resolveOutlinePage(document, item.destination)
  if (resolved === null) return undefined
  return { pageNumber: resolved, fromDestination: true }
}

function isStaleClick(
  navigationCurrent: boolean,
  controller: AbortController,
  owner: PDFDocumentProxy,
  currentDocument: PDFDocumentProxy | null
): boolean {
  return (
    !navigationCurrent || controller.signal.aborted || currentDocument !== owner
  )
}

function isNavigableItem(
  item: PdfOutlineItem | undefined
): item is PdfOutlineItem & {
  readonly destination: NonNullable<PdfOutlineItem['destination']>
} {
  return Boolean(item && item.destination && !item.external)
}

function readyOutlineState(
  state: OutlineState | null,
  document: PDFDocumentProxy
): OutlineState | null {
  return state?.status === 'ready' && state.document === document ? state : null
}

async function resolveClickTarget(
  document: PDFDocumentProxy,
  item: PdfOutlineItem,
  annotatedPage: number,
  controller: AbortController
): Promise<ClickTargetResolution | undefined> {
  const matched = await findOutlineTitlePage(
    document,
    { id: item.id, title: item.title, pageNumber: annotatedPage },
    { signal: controller.signal }
  )
  if (controller.signal.aborted) return undefined
  const correctedPage =
    matched !== null && matched !== annotatedPage ? matched : undefined
  return { pageNumber: matched ?? annotatedPage, correctedPage }
}

function updateClickCache(
  cache: PageCache,
  session: PdfOutlineSessionState,
  item: PdfOutlineItem,
  resolution: ClickTargetResolution,
  resolvedFromDestination: boolean
): boolean {
  let changed = false
  if (resolvedFromDestination) {
    cache.annotatedById.set(item.id, resolution.pageNumber)
    changed = true
  }
  if (resolution.correctedPage !== undefined) {
    cache.correctedById.set(item.id, resolution.correctedPage)
    session.corrections.set(item.id, resolution.correctedPage)
    cache.mismatchDetected = true
    session.mismatchDetected = true
    changed = true
  }
  return changed
}

function pageCacheFor(
  caches: WeakMap<PDFDocumentProxy, PageCache>,
  document: PDFDocumentProxy,
  items: readonly PdfOutlineItem[],
  session: PdfOutlineSessionState
): PageCache {
  let cache = caches.get(document)
  if (!cache || cache.items !== items) {
    cache = {
      items,
      annotatedById: new Map(),
      correctedById: new Map(session.corrections),
      mismatchDetected: session.mismatchDetected
    }
    caches.set(document, cache)
  }
  return cache
}

function snapshotFromCache(
  document: PDFDocumentProxy,
  items: readonly PdfOutlineItem[],
  cache: PageCache,
  complete: boolean
): PageSnapshot {
  return {
    document,
    items,
    annotatedById: cache.annotatedById,
    correctedById: new Map(cache.correctedById),
    mismatchDetected: cache.mismatchDetected,
    complete
  }
}

function snapshotMatches(
  snapshot: PageSnapshot | null,
  document: PDFDocumentProxy | null,
  items: readonly PdfOutlineItem[] | null
): boolean {
  return Boolean(
    snapshot &&
    document &&
    items &&
    snapshot.document === document &&
    snapshot.items === items
  )
}

export function PdfOutline({
  document,
  isActive,
  currentPageNumber,
  pageNumbers,
  onNavigate,
  sessionState
}: {
  readonly document: PDFDocumentProxy | null
  readonly isActive: boolean
  readonly currentPageNumber?: number | null
  readonly pageNumbers: readonly number[]
  readonly onNavigate: (pageNumber: number) => void
  readonly sessionState?: PdfOutlineSessionState
}) {
  const successful = useRef(
    new WeakMap<PDFDocumentProxy, readonly PdfOutlineItem[]>()
  )
  const pending = useRef(
    new WeakMap<PDFDocumentProxy, Promise<readonly PdfOutlineItem[]>>()
  )
  const pageCaches = useRef(new WeakMap<PDFDocumentProxy, PageCache>())
  const clickScan = useRef<AbortController | null>(null)
  const internalSessions = useRef(
    new WeakMap<PDFDocumentProxy, PdfOutlineSessionState>()
  )
  const session = useMemo(() => {
    if (sessionState) return sessionState
    if (!document) return createPdfOutlineSessionState()
    let internal = internalSessions.current.get(document)
    if (!internal) {
      internal = createPdfOutlineSessionState()
      internalSessions.current.set(document, internal)
    }
    return internal
  }, [document, sessionState])
  const latest = useRef({ document, pageNumbers, onNavigate })
  latest.current = { document, pageNumbers, onNavigate }
  useEffect(() => () => clickScan.current?.abort(), [])
  const { begin: beginNavigation, isCurrent: isNavigationCurrent } =
    usePositionTransaction(document)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<OutlineState | null>(null)
  const [pageSnapshot, setPageSnapshot] = useState<PageSnapshot | null>(null)
  const hasCurrentPage =
    currentPageNumber !== null && currentPageNumber !== undefined
  const pageIsVisible =
    hasCurrentPage && pageNumbers.includes(currentPageNumber as number)

  useEffect(() => {
    if (!document || !isActive) return
    let current = true
    const cached = successful.current.get(document)
    if (cached) {
      // 重新打开目录时沿用同一个 ready state，避免仅仅切换可见性就
      // 触发一次新的页首读取 effect。
      setState((currentState) =>
        currentState?.document === document &&
        currentState.status === 'ready' &&
        currentState.items === cached
          ? currentState
          : { document, status: 'ready', items: cached }
      )
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
    const entry = pageCacheFor(
      pageCaches.current,
      document,
      state.items,
      session
    )
    if (!entry.resolved) {
      entry.resolved = resolveOutlinePages(
        document,
        state.items,
        entry.annotatedById
      ).catch(() => undefined)
    }
    entry.resolved.then(() => {
      if (!current) return
      setPageSnapshot(snapshotFromCache(document, state.items, entry, true))
    })
    return () => {
      current = false
    }
  }, [document, hasCurrentPage, session, state])

  const annotationSnapshot = snapshotMatches(
    pageSnapshot,
    document,
    state?.items ?? null
  )
    ? pageSnapshot
    : null
  const annotationsReady = annotationSnapshot?.complete === true

  // 按页序校正到当前页：每项只认标注页之后第一处页首标题，因此跳页、
  // 正偏移目录和正文中重复出现的标题都能落到真实章节起点。只读到当前页，
  // 关闭目录即中止；页面文字缓存让后续滚动只读新增页。
  useEffect(() => {
    if (
      !document ||
      !isActive ||
      !annotationsReady ||
      !state ||
      state.document !== document ||
      state.status !== 'ready' ||
      currentPageNumber === null ||
      currentPageNumber === undefined ||
      !pageIsVisible ||
      typeof document.getPage !== 'function'
    ) {
      return
    }
    const pageNumber = currentPageNumber
    const controller = new AbortController()
    let current = true
    const cache = pageCacheFor(
      pageCaches.current,
      document,
      state.items,
      session
    )
    scanOutlineTitlePages(
      document,
      collectTitleTargets(state.items, cache.annotatedById),
      pageNumber,
      { signal: controller.signal }
    )
      .then((corrections) => {
        if (!current || controller.signal.aborted || !corrections.size) return
        let changed = false
        let mismatched = false
        for (const [id, correctedPage] of corrections) {
          const annotatedPage = cache.annotatedById.get(id)
          if (annotatedPage === undefined || correctedPage < annotatedPage) {
            continue
          }
          if (correctedPage !== annotatedPage) mismatched = true
          if (cache.correctedById.get(id) === correctedPage) continue
          cache.correctedById.set(id, correctedPage)
          session.corrections.set(id, correctedPage)
          changed = true
        }
        const newMismatch = mismatched && !cache.mismatchDetected
        if (!changed && !newMismatch) return
        if (mismatched) {
          cache.mismatchDetected = true
          session.mismatchDetected = true
        }
        setPageSnapshot(snapshotFromCache(document, state.items, cache, true))
      })
      .catch(() => undefined)
    return () => {
      current = false
      controller.abort()
    }
  }, [
    annotationsReady,
    currentPageNumber,
    document,
    isActive,
    pageIsVisible,
    session,
    state
  ])

  const itemById = useMemo(
    () => (state?.status === 'ready' ? indexOutlineItems(state.items) : null),
    [state]
  )

  const nodes = useMemo(() => {
    if (!state || state.status !== 'ready' || state.document !== document) {
      return [] as readonly OutlineTreeNode[]
    }
    return toOutlineNodes(
      state.items,
      snapshotMatches(pageSnapshot, document, state.items) ? pageSnapshot : null
    )
  }, [document, pageSnapshot, state])

  const navigate = async (item: PdfOutlineItem | undefined) => {
    const owner = document
    if (!owner || !isNavigableItem(item)) return
    clickScan.current?.abort()
    const controller = new AbortController()
    clickScan.current = controller
    const transaction = beginNavigation()
    const readyState = readyOutlineState(state, owner)
    let cache: PageCache | undefined
    if (readyState) {
      cache = pageCacheFor(pageCaches.current, owner, readyState.items, session)
    }
    const annotation = await resolveClickAnnotation(owner, item, cache)
    if (
      !annotation ||
      isStaleClick(
        isNavigationCurrent(transaction),
        controller,
        owner,
        latest.current.document
      )
    ) {
      return
    }
    // 未校正的目录项先向前找真实标题页；找不到才回退到标注页。
    const corrected = cache?.correctedById.get(item.id)
    let resolution: ClickTargetResolution | undefined =
      corrected === undefined ? undefined : { pageNumber: corrected }
    if (!resolution) {
      resolution = await resolveClickTarget(
        owner,
        item,
        annotation.pageNumber,
        controller
      )
      if (
        !resolution ||
        isStaleClick(
          isNavigationCurrent(transaction),
          controller,
          owner,
          latest.current.document
        )
      ) {
        return
      }
    }
    const effectivePage = resolution.pageNumber
    if (!latest.current.pageNumbers.includes(effectivePage)) return
    if (readyState && cache) {
      const changed = updateClickCache(
        cache,
        session,
        item,
        resolution,
        annotation.fromDestination
      )
      if (changed) {
        const complete = snapshotMatches(pageSnapshot, owner, readyState.items)
          ? Boolean(pageSnapshot?.complete)
          : false
        setPageSnapshot(
          snapshotFromCache(owner, readyState.items, cache, complete)
        )
      }
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
      initialCollapsed={sessionState ? session.collapsed : undefined}
      onCollapsedChange={
        sessionState
          ? (next) => {
              session.collapsed = new Set(next)
            }
          : undefined
      }
      onNavigate={(node) => void navigate(itemById?.get(node.id))}
    />
  )
}
