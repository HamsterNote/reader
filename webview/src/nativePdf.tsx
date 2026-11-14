import { CommentPanel } from '../../demo/CommentPanel'
import { createNativeCommentController } from '../../src/nativePdf/commentController'
import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PdfDocumentSession } from '../../src/pdf/pdfDocumentSession'
import { NativeCanonicalCache } from '../../src/nativePdf/textGeometry'
import {
  materializeNativeRange,
  endpointPage
} from '../../src/nativePdf/selection'
import {
  DefaultHighlightPopover,
  DefaultSelectionPopover
} from '../../src/components/DefaultPopover'
import { PopoverPortal } from '../../src/components/PopoverPortal'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../../src/types/selection'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot,
  type ReaderSnapshot
} from '../../src/host/readerSnapshot'
import { readPackagedAsset } from './packagedAsset'
import { createPdfWorkerFromAsset } from './pdfWorker'
import { packagedPdfOptions } from './pdfAssets'
import { GlobalWorkerOptions } from '../../src/pdf/pdfjsRuntime'
import type {
  PdfEvent,
  PdfIdentity,
  PdfCanonicalPage
} from '../../src/nativePdf/contracts'
import { listenHostMessages } from './hostMessageChannel'
import {
  indexPdfSourceLinks,
  resolvePdfSourceLink
} from '../../src/pdf/pdfSourceLinks'
import { visibleOriginalPages } from '../../src/nativePdf/geometry'
import { NativePdfSession } from '../../src/nativePdf/session'
import { shouldPreserveNativeWebMenu } from '../../src/nativePdf/menuOwnership'

type NativeBootstrap = PdfIdentity & {
  publicationUrl: string
  snapshot: unknown
  progress: unknown
}
declare global {
  interface Window {
    __READER_NATIVE_PDF__?: NativeBootstrap
  }
}
/** Development harness only. Default ReaderSurface/bridge v1 stays untouched. */
export function startNativePdfSurface(
  bootstrap: NativeBootstrap,
  options: {
    selectionPopover?: ReactNode
    highlightPopover?: ReactNode | ((range: ReaderSelectionRange) => ReactNode)
    onCommentHighlight?: (
      range: ReaderSelectionRange
    ) => Promise<ReaderSelectionRange>
  } = {}
): void {
  const root = createRoot(document.getElementById('reader')!)
  let session: PdfDocumentSession | null = null,
    cache: NativeCanonicalCache | null = null,
    worker: Worker | null = null
  const guard = new NativePdfSession(bootstrap)
  let snapshot: ReaderSnapshot = restoreReaderSnapshot(
    bootstrap.snapshot,
    bootstrap.progress
  )
  const commentController = createNativeCommentController(snapshot.comments)
  let allowed: number[] = [],
    request = 0,
    range: ReaderSelectionRange | null = null
  let draftFinished = false
  let draftId = `native-${crypto.randomUUID()}`
  let pendingSelection = 0,
    disposed = false,
    geometryRevision = -1,
    menuOwner: 'native' | 'web' | null = null
  let retained: number[] = []
  const send = (payload: Record<string, unknown>) =>
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({
        ...bootstrap,
        snapshot: undefined,
        progress: undefined,
        publicationUrl: undefined,
        ...payload
      })
    )
  const command = (body: Record<string, unknown>) =>
    send({
      type: 'command',
      command: {
        ...bootstrap,
        snapshot: undefined,
        progress: undefined,
        publicationUrl: undefined,
        ...body,
        requestId: `web-${++request}`
      }
    })
  const fail = (code: string) => send({ type: 'failure', code })
  type MenuValue = {
    range: ReaderSelectionRange | null
    activeId?: string
    anchor?: DOMRect
  } | null
  let menuListener: ((value: MenuValue) => void) | null = null
  const show = (value: MenuValue): void => {
    if (import.meta.env.DEV)
      console.info('web-popover-value', {
        owner: menuOwner,
        value: value
          ? { activeId: value.activeId, start: value.range?.start, end: value.range?.end }
          : null
      })
    menuListener?.(value)
  }

  function commit(next: ReaderSelectionRange | null, removeId?: string) {
    const commitId = `${bootstrap.sessionId}-${++request}`
    if (!guard.commit(commitId)) return
    const current = snapshot.data.ranges ?? []
    const id = next?.id ?? removeId
    const ranges = current.filter((r) => r.id !== id)
    if (next) ranges.push(next)
    const nextComments = removeId
      ? commentController.removeHighlight(commitId, removeId)
      : {
          status: 'changed' as const,
          comments: commentController.getComments()
        }
    if (nextComments.status === 'duplicate') return
    snapshot = {
      ...snapshot,
      data: { ...snapshot.data, ranges },
      comments: nextComments.comments
    }
    send({
      type: 'ranges',
      items: ranges.map((r) => ({ id: r.id, text: r.text }))
    })
    command({ type: 'annotations', ranges })
    send({
      type: 'snapshot',
      commitId,
      data: serializeReaderSnapshot(snapshot)
    })
    range = next
    send({ type: 'nativeSelectionConsumed' })
    menuOwner = null
    command({ type: 'selection', range: next })
    show(null)
  }
  function Menu() {
    const [value, setValue] = useState<{
      range: ReaderSelectionRange | null
      activeId?: string
      anchor?: DOMRect
    } | null>(null)
    const [color, setColor] = useState('#ffc107')
    const [commentId, setCommentId] = useState<string | null>(null)
    const [, refresh] = useState(0)
    const container = useRef<HTMLDivElement>(null)
    useEffect(() => {
      menuListener = setValue
      return () => {
        menuListener = null
      }
    }, [])
    const selectionRef = {
      current: {
        confirm: () => {
          if (range) commit(range)
        }
      } as ReaderSelectionRef
    }
    const context = {
      selectionRef,
      highlightColor: color,
      selectedRangeId: value?.activeId,
      ranges: snapshot.data.ranges,
      onHighlightColorChange: (c: string) => {
        setColor(c)
        if (range) {
          range = {
            ...range,
            markerStyle: { ...range.markerStyle, backgroundColor: c }
          }
          command({ type: 'selection', range })
        }
      },
      onCommentHighlight:
        options.onCommentHighlight ??
        (async (r: ReaderSelectionRange) => {
          setCommentId(r.id)
          send({ type: 'panel' })
          return r
        }),
      onUpdateRange: (r: ReaderSelectionRange) => commit(r),
      onRemoveRange: (id: string) => commit(null, id)
    }
    // The WebView itself is positioned around this safe menu rectangle by RN.
    const custom = (
      window as Window & {
        __NATIVE_PDF_POPOVER__?: {
          selection?: ReactNode
          highlight?: (r: ReaderSelectionRange) => ReactNode
        }
      }
    ).__NATIVE_PDF_POPOVER__
    let popover: ReactNode = options.selectionPopover ?? custom?.selection ?? (
      <DefaultSelectionPopover {...context} />
    )
    if (value?.activeId && value.range) {
      const configured =
        typeof options.highlightPopover === 'function'
          ? options.highlightPopover(value.range)
          : options.highlightPopover
      popover = configured ?? custom?.highlight?.(value.range) ?? (
        <DefaultHighlightPopover {...context} />
      )
    }
    return (
      <div ref={container} style={{ position: 'fixed', inset: 0 }}>
        {commentId ? (
          <CommentPanel
            comments={snapshot.comments}
            ranges={snapshot.data.ranges ?? []}
            activeHighlightId={commentId}
            onCommentsChange={(comments) => {
              const commitId = `${bootstrap.sessionId}-${++request}`
              const result = commentController.commit(commitId, comments)
              if (result.status === 'changed' && guard.commit(commitId)) {
                snapshot = { ...snapshot, comments: result.comments }
                refresh((n) => n + 1)
                send({
                  type: 'snapshot',
                  commitId,
                  data: serializeReaderSnapshot(snapshot)
                })
              }
            }}
            onJumpToHighlight={(id) =>
              send({ type: 'navigateRange', rangeId: id })
            }
            onClose={() => {
              setCommentId(null)
              show(null)
              send({ type: 'hideMenu' })
            }}
          />
        ) : null}
        <PopoverPortal
          containerRef={container}
          selectionKind={value?.activeId ? 'selected' : 'active'}
          visible={!!value && !commentId}
          selectionBounds={value?.anchor ?? null}
        >
          {popover}
        </PopoverPortal>
      </div>
    )
  }
  root.render(<Menu />)
  async function ensure(
    numbers: number[],
    texture = false
  ): Promise<PdfCanonicalPage[]> {
    if (!cache) throw new Error('MAPPING_NOT_READY')
    cache.retain(Array.from(new Set([...retained, ...numbers])))
    // Sequential text layout avoids simultaneous measurement DOM work.
    const result: PdfCanonicalPage[] = []
    for (const n of numbers) {
      if (disposed) throw new Error('CANCELLED')
      result.push(await cache.get(n, texture))
    }
    return result
  }
  const selection = async (event: Extract<PdfEvent, { type: 'selection' }>) => {
    if (!event.rangeId && draftFinished && event.phase === 'preview') {
      draftFinished = false
      draftId = `native-${crypto.randomUUID()}`
    }
    const token = ++pendingSelection
    const first = Math.min(endpointPage(event.start), endpointPage(event.end)),
      last = Math.max(endpointPage(event.start), endpointPage(event.end))
    const numbers = allowed.filter((n) => n >= first && n <= last)
    await ensure(numbers)
    if (
      disposed ||
      token !== pendingSelection ||
      event.geometryRevision < geometryRevision ||
      !cache
    )
      return
    const existing = event.rangeId
      ? snapshot.data.ranges?.find((r) => r.id === event.rangeId)
      : undefined
    range = materializeNativeRange(
      event.start,
      event.end,
      cache.pages,
      allowed,
      {
        id: existing?.id ?? draftId,
        createdAt: Date.now(),
        color:
          existing?.markerStyle?.backgroundColor ??
          range?.markerStyle?.backgroundColor ??
          '#ffc107'
      },
      existing
    )
    if (event.phase === 'end') {
      if (
        existing &&
        (existing.start.offset !== range.start.offset ||
          existing.end.offset !== range.end.offset ||
          existing.start.selectionId !== range.start.selectionId ||
          existing.end.selectionId !== range.end.selectionId)
      )
        commit(range)
      if (!existing) draftFinished = true
      const activeId = snapshot.data.ranges?.some((r) => r.id === range!.id)
        ? range.id
        : undefined
      send({ type: 'menu', anchor: event.anchor })
      show({ range, activeId, anchor: new DOMRect(140, 75, 1, 1) })
    }
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Exhaustive independent native event cases, with stale-session checks before dispatch.
  listenHostMessages((raw) => {
    let message: {
      identity?: PdfIdentity
      type?: string
      event?: PdfEvent
      rangeId?: string
      pages?: number[]
      url?: string
    }
    try {
      message =
        typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof message)
    } catch {
      return
    }
    if (disposed || !message.identity || !guard.accepts(message.identity))
      return
    if (message.type === 'dispose') {
      disposed = true
      pendingSelection++
      guard.close()
      cache?.dispose()
      root.unmount()
      session
        ?.dispose()
        .finally(() => worker?.terminate())
        .catch(() => undefined)
      return
    }
    if (message.type === 'dismiss') {
      pendingSelection++
      menuOwner = null
      show(null)
      return
    }
    if (message.type === 'nativeSelection') {
      const nativeEvent = message.event
      if (!nativeEvent || nativeEvent.type !== 'selection') return
      menuOwner = 'native'
      if (!guard.receive(nativeEvent)) return
      selection(nativeEvent).catch(() => fail('MAPPING_NOT_READY'))
      return
    }
    if (message.event?.type === 'activate') {
      message.type = 'activate'
      message.rangeId = message.event.rangeId
    }
    if (message.type === 'activate' || message.type === 'navigateRange') {
      const existing = snapshot.data.ranges?.find(
        (r) => r.id === message.rangeId
      )
      if (!existing) {
        fail('INVALID_TARGET')
        return
      }
      const first = endpointPage(existing.start),
        last = endpointPage(existing.end)
      ensure(allowed.filter((n) => n >= first && n <= last))
        .then(() => {
          if (disposed) return
          // Validate canonical endpoints without altering the saved object.
          materializeNativeRange(
            existing.start,
            existing.end,
            cache!.pages,
            allowed,
            {
              id: existing.id,
              createdAt: existing.createdAt,
              color: existing.markerStyle?.backgroundColor ?? '#ffc107'
            },
            existing
          )
          command({
            type: 'text',
            pages: Array.from(cache!.pages.values()),
            retain: Array.from(cache!.pages.keys()),
            source: 'geometry-cache'
          })
          range = existing
          command({
            type: 'navigate',
            pageNumber: first,
            offset: existing.start.offset
          })
          command({ type: 'selection', range, showMenu: true })
        })
        .catch(() => fail('MAPPING_NOT_READY'))
      return
    }
    const event = message.event
    if (!event || !guard.receive(event)) return
    if ('geometryRevision' in event) geometryRevision = event.geometryRevision
    if (event.type === 'geometry') {
      if (!shouldPreserveNativeWebMenu(menuOwner, 'geometry')) {
        show(null)
        send({ type: 'hideMenu' })
      }
    }
    if (event.type === 'cancelled') {
      pendingSelection++
      if (!shouldPreserveNativeWebMenu(menuOwner, 'cancelled')) {
        show(null)
        send({ type: 'hideMenu' })
      }
    }
    if (event.type === 'loaded') {
      allowed = visibleOriginalPages(event.pageCount, snapshot.data.hiddenPages)
      send({ type: 'metadata', pageCount: event.pageCount })
    }
    if (event.type === 'textNeeded') {
      retained = [...event.retain]
      ensure([...event.pages], true)
        .then((pages) => {
          if (!disposed && pages.length)
            command({
              type: 'text',
              pages,
              retain: retained,
              source: 'geometry-cache'
            })
        })
        .catch(() => fail('MAPPING_NOT_READY'))
    }
    if (event.type === 'selection')
      selection(event).catch(() => fail('MAPPING_NOT_READY'))
    if (event.type === 'link') {
      ;(async () => {
        if (!session) return
        if (new URL(event.url).hostname !== 'undefined') {
          send({ type: 'external', url: event.url })
          return
        }
        const index = await indexPdfSourceLinks(
          session.document,
          () => disposed
        )
        const destination = resolvePdfSourceLink(index, event.url)
        if (disposed) return
        if (destination && allowed.includes(destination[0] + 1))
          command({ type: 'navigate', pageNumber: destination[0] + 1 })
        else if (new URL(event.url).hostname !== 'undefined')
          send({ type: 'external', url: event.url })
      })().catch(() => fail('INVALID_TARGET'))
    }
  })
  ;(async () => {
    worker = await createPdfWorkerFromAsset()
    GlobalWorkerOptions.workerPort = worker
    session = await PdfDocumentSession.open(
      { data: await readPackagedAsset(bootstrap.publicationUrl) },
      { documentOptions: packagedPdfOptions }
    )
    if (disposed) {
      await session.dispose()
      worker.terminate()
      return
    }
    cache = new NativeCanonicalCache(session.document)
    allowed = visibleOriginalPages(
      session.document.numPages,
      snapshot.data.hiddenPages
    )
    const outline = await session.document.getOutline()
    const entries: { title: string; pageNumber: number }[] = []
    const walk = async (items: NonNullable<typeof outline>) => {
      for (const item of items) {
        const dest =
          typeof item.dest === 'string'
            ? await session!.document.getDestination(item.dest)
            : item.dest
        if (Array.isArray(dest) && dest[0] !== undefined) {
          const n =
            typeof dest[0] === 'number'
              ? dest[0] + 1
              : (await session!.document.getPageIndex(dest[0])) + 1
          if (allowed.includes(n))
            entries.push({ title: item.title, pageNumber: n })
        }
        if (item.items?.length) await walk(item.items)
      }
    }
    if (outline) await walk(outline)
    if (disposed) return
    send({ type: 'outline', items: entries })
    send({
      type: 'ranges',
      items: (snapshot.data.ranges ?? []).map((r) => ({
        id: r.id,
        text: r.text
      }))
    })
    send({ type: 'serviceReady' })
    command({ type: 'annotations', ranges: snapshot.data.ranges ?? [] })
  })().catch(() => fail('CORRUPT'))
}
