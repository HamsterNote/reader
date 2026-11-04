import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { PDFViewer } from './pdfViewerLib'
import type { PDFDocumentProxy } from './pdfjsRuntime'
import type { PdfDocumentSource } from './pdfDocumentSession'
import type { ReaderPageEdgeCrop } from '../types/readerData'
import { readingViewport } from '../components/reading/readingViewport'
import {
  firstVisiblePdfCharacterGeometry,
  type PdfReadingPage,
  type ReadingRect
} from './pdfReadingPosition'
import {
  getPageCropGeometry,
  resolvePageEdgeCrop
} from '../components/IntermediateDocumentViewer/pageDisplay'

type Insets = { top: number; bottom: number; horizontal: number }
type LayoutAnchor = {
  pageNumber: number
  // Content position is PDF user space, independent of crop, zoom and rotation.
  pdfPoint: number[]
  viewportX: number
  // Screen placement only; the content coordinate itself is always PDF space.
  screenOffsetY: number
}
type Options = {
  source: PdfDocumentSource | null
  viewer: RefObject<PDFViewer | null>
  container: RefObject<HTMLDivElement | null>
  element: RefObject<HTMLDivElement | null>
  document: RefObject<PDFDocumentProxy | null>
  pages: RefObject<readonly number[]>
  text?: RefObject<ReadonlyMap<number, PdfReadingPage>>
  navigation: RefObject<unknown>
  crop: ReaderPageEdgeCrop | undefined
  insets: Insets | undefined
  onRestored: (pageNumber: number) => void
}

const safeViewport = (container: HTMLElement, insets: Insets | undefined) =>
  readingViewport(container.getBoundingClientRect(), {
    topInset: insets?.top,
    bottomInset: insets?.bottom,
    horizontalInset: insets?.horizontal
  })

function capture(options: Options): LayoutAnchor | null {
  const viewer = options.viewer.current
  const container = options.container.current
  const safe = container && safeViewport(container, options.insets)
  if (!viewer || !safe) return null
  const contexts: PdfReadingPage[] = []
  const clips = new Map<number, ReadingRect>()
  const atPoint = (pageNumber: number, x: number, y: number): LayoutAnchor => {
    const page = viewer.getPageView(pageNumber - 1)
    const rect = page.div.getBoundingClientRect()
    return {
      pageNumber,
      pdfPoint: page.viewport.convertToPdfPoint(
        ((x - rect.left) / rect.width) * page.viewport.width,
        ((y - rect.top) / rect.height) * page.viewport.height
      ),
      viewportX: (x - safe.left) / safe.width,
      screenOffsetY: y - safe.top
    }
  }
  let fallback: LayoutAnchor | null = null
  for (const pageNumber of options.pages.current) {
    const page = viewer.getPageView(pageNumber - 1)
    if (!page || page.div.style.display === 'none') continue
    const rect = page.div.getBoundingClientRect()
    const crop = getPageCropGeometry(
      rect,
      resolvePageEdgeCrop(options.crop, pageNumber)
    )
    const top = Math.max(safe.top, rect.top + crop.top)
    const bottom = Math.min(safe.bottom, rect.bottom - crop.bottom)
    const left = Math.max(safe.left, rect.left + crop.left)
    const right = Math.min(safe.right, rect.right - crop.right)
    if (top >= bottom || left >= right) continue
    fallback ??= atPoint(pageNumber, (left + right) / 2, top)
    clips.set(pageNumber, { top, bottom, left, right })
    const context = options.text?.current.get(pageNumber)
    if (context) contexts.push(context)
  }
  // A top-of-viewport whitespace point can be removed by the next crop even
  // when the visible text survives. Anchor the actual first visible character,
  // matching bookmark reading order, with geometry fallback for scanned pages.
  const first = firstVisiblePdfCharacterGeometry(
    contexts,
    safe,
    (context) => clips.get(context.pageNumber)!
  )
  if (!first) return fallback
  const clip = clips.get(first.anchor.pageNumber)!
  return atPoint(
    first.anchor.pageNumber,
    Math.max(clip.left, Math.min(clip.right, first.rect.left)),
    Math.max(clip.top, first.rect.top)
  )
}

function restore(options: Options, anchor: LayoutAnchor) {
  const container = options.container.current
  const safe = container && safeViewport(container, options.insets)
  const page = options.viewer.current?.getPageView(anchor.pageNumber - 1)
  if (
    !container ||
    !safe ||
    !page ||
    !options.pages.current.includes(anchor.pageNumber)
  )
    return
  const point = page.viewport.convertToViewportPoint(
    anchor.pdfPoint[0]!,
    anchor.pdfPoint[1]!
  )
  const crop = getPageCropGeometry(
    page.viewport,
    resolvePageEdgeCrop(options.crop, anchor.pageNumber)
  )
  // If the old point has itself been cropped away, use the nearest visible edge.
  const x = Math.max(crop.left, Math.min(crop.left + crop.width, point[0]!))
  const y = Math.max(crop.top, Math.min(crop.top + crop.height, point[1]!))
  const rect = page.div.getBoundingClientRect()
  container.scrollTop +=
    rect.top +
    (y / page.viewport.height) * rect.height -
    (safe.top + anchor.screenOffsetY)
  container.scrollLeft +=
    rect.left +
    (x / page.viewport.width) * rect.width -
    (safe.left + safe.width * anchor.viewportX)
}

/** One transaction for crop/edit/inset changes. Capture from the old committed
 * layout, restore after PDF.js scale/layout updates, then settle its scroll RAF. */
export function usePdfLayoutAnchor(options: Options) {
  const latest = useRef(options)
  latest.current = options
  const pending = useRef<{
    source: PdfDocumentSource | null
    document: PDFDocumentProxy | null
    anchor: LayoutAnchor
    settled: boolean
  } | null>(null)
  const ownScroll = useRef({ top: 0, left: 0 })
  const frame = useRef(0)
  const cancelRestore = useCallback(() => {
    cancelAnimationFrame(frame.current)
    pending.current = null
  }, [])
  const isRestoring = useCallback(
    () => !!pending.current && !pending.current.settled,
    []
  )
  const cropKey = JSON.stringify(options.crop)
  const top = options.insets?.top ?? 0
  const bottom = options.insets?.bottom ?? 0
  const horizontal = options.insets?.horizontal ?? 0

  useLayoutEffect(() => {
    if (pending.current?.source !== options.source) cancelRestore()
    return () => {
      cancelAnimationFrame(frame.current)
      if (
        (pending.current && !pending.current.settled) ||
        options.navigation.current
      )
        return
      const anchor = capture(options)
      pending.current = null
      if (anchor)
        pending.current = {
          source: options.source,
          document: options.document.current,
          anchor,
          settled: false
        }
    }
    // Semantic keys avoid restarting on each controlled progress update.
  }, [options.source, cropKey, top, bottom, horizontal, cancelRestore])

  const restoreAfterLayout = useCallback(() => {
    const saved = pending.current
    const current = latest.current
    if (!saved) return
    if (
      saved.source !== current.source ||
      saved.document !== current.document.current ||
      current.navigation.current ||
      !current.pages.current.includes(saved.anchor.pageNumber)
    ) {
      cancelRestore()
      return
    }
    saved.settled = false
    const restoreAndTrack = () => {
      restore(latest.current, saved.anchor)
      ownScroll.current = {
        top: latest.current.container.current?.scrollTop ?? 0,
        left: latest.current.container.current?.scrollLeft ?? 0
      }
    }
    restoreAndTrack()
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      if (pending.current !== saved) return
      restoreAndTrack()
      frame.current = requestAnimationFrame(() => {
        if (pending.current !== saved) return
        restoreAndTrack()
        // Keep the anchor until user navigation: PDF.js may round page sizes
        // after an asynchronous canvas render, moving all subsequent pages.
        saved.settled = true
        latest.current.onRestored(saved.anchor.pageNumber)
      })
    })
  }, [cancelRestore])

  useEffect(() => {
    const container = options.container.current
    if (!container) return
    const events = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const
    for (const event of events)
      container.addEventListener(event, cancelRestore, { passive: true })
    const onScroll = () => {
      if (
        pending.current?.settled &&
        (Math.abs(container.scrollTop - ownScroll.current.top) > 1 ||
          Math.abs(container.scrollLeft - ownScroll.current.left) > 1)
      )
        cancelRestore()
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    const resize = new ResizeObserver(restoreAfterLayout)
    if (options.element.current) resize.observe(options.element.current)
    return () => {
      cancelRestore()
      resize.disconnect()
      container.removeEventListener('scroll', onScroll)
      for (const event of events)
        container.removeEventListener(event, cancelRestore)
    }
  }, [options.container, options.element, cancelRestore, restoreAfterLayout])

  return { restoreAfterLayout, cancelRestore, isRestoring }
}
