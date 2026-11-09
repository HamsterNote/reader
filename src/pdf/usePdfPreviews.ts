import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

function resumeWhenIdle(
  resume: () => void,
  busy: () => boolean,
  cancelled: () => boolean,
  schedule: (callback: () => void) => void
) {
  if (cancelled()) return
  if (busy()) schedule(() => resumeWhenIdle(resume, busy, cancelled, schedule))
  else resume()
}

type Preview = { image: string; width: number; height: number }

function trimPreviews(
  cache: Map<number, Preview>,
  visible: ReadonlySet<number>
) {
  while (cache.size > Math.max(24, visible.size)) {
    const oldest = [...cache.keys()].find((key) => !visible.has(key))
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** One small render at a time, sharing the viewer's document and worker. */
export function usePdfPreviews(
  document: PDFDocumentProxy | null,
  open: boolean,
  bodyBusy: () => boolean,
  releasePage: (document: PDFDocumentProxy, page: PDFPageProxy) => void
) {
  const active = useRef<{
    page: number
    cancel: () => void
    owner: object
  } | null>(null)
  const [owner, setOwner] = useState<PDFDocumentProxy | null>(null)
  const [previews, setPreviews] = useState(new Map<number, Preview>())
  const [errors, setErrors] = useState(new Set<number>())
  const [retry, setRetry] = useState(0)
  const visible = useRef(new Set<number>())
  const failedPages = useRef(new Set<number>())
  const pump = useRef(() => {})
  const busy = useRef(bodyBusy)
  busy.current = bodyBusy
  const release = useRef(releasePage)
  release.current = releasePage
  useEffect(() => {
    setOwner(document)
    setPreviews(new Map())
    setErrors(new Set())
    if (!document || !open) return
    let cancelled = false
    let running = false
    let timer: ReturnType<typeof setTimeout>
    let task: RenderTask | undefined
    let canvas: HTMLCanvasElement | undefined
    const owner = {}
    const cache = new Map<number, Preview>()
    const failed = new Set<number>()
    failedPages.current = failed
    const isCancelled = () => cancelled
    const bodyRendering = () => busy.current()
    const scheduleContinuation = (callback: () => void) => {
      timer = setTimeout(callback, 50)
    }
    const continueRender = (resume: () => void) =>
      resumeWhenIdle(resume, bodyRendering, isCancelled, scheduleContinuation)
    const run = async () => {
      if (cancelled || running) return
      const pageNumber = [...visible.current].find(
        (page) =>
          page <= document.numPages && !cache.has(page) && !failed.has(page)
      )
      if (!pageNumber) return
      if (busy.current()) {
        timer = setTimeout(() => void run(), 50)
        return
      }
      running = true
      let page: PDFPageProxy | undefined
      try {
        page = await document.getPage(pageNumber)
        if (cancelled || !visible.current.has(pageNumber)) return
        const original = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({
          scale: Math.min(1, 320 / Math.max(original.width, original.height))
        })
        canvas = globalThis.document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        task = page.render({ canvas, viewport, annotationMode: 0 })
        // Core rendering exposes a continuation hook; yield to the main viewer.
        active.current = {
          page: pageNumber,
          cancel: () => task?.cancel(),
          owner
        }
        task.onContinue = continueRender
        await task.promise
        if (cancelled) return
        const image = canvas.toDataURL('image/png')
        cache.set(pageNumber, {
          image,
          width: original.width,
          height: original.height
        })
        trimPreviews(cache, visible.current)
        setPreviews(new Map(cache))
      } catch {
        if (!cancelled && visible.current.has(pageNumber)) {
          failed.add(pageNumber)
          setErrors(new Set(failed))
        }
      } finally {
        if (canvas) canvas.width = canvas.height = 0
        canvas = undefined
        task = undefined
        // The PNG does not need PDF render resources. The viewer's official
        // thumbnailrendered handler protects its buffered body pages; do not
        // call cleanup directly on this shared proxy. Also release cancelled
        // and failed renders, once their task has settled.
        if (page) release.current(document, page)
        if (active.current?.owner === owner) active.current = null
        running = false
        if (!cancelled) timer = setTimeout(() => void run(), 0)
      }
    }
    pump.current = () => void run()
    pump.current()
    return () => {
      cancelled = true
      clearTimeout(timer)
      task?.cancel()
      if (canvas) canvas.width = canvas.height = 0
      cache.clear()
      failed.clear()
      pump.current = () => {}
    }
  }, [document, open, retry])
  const onVisibility = useCallback((page: number, isVisible: boolean) => {
    if (isVisible) visible.current.add(page)
    else {
      visible.current.delete(page)
      if (active.current?.page === page) active.current.cancel()
    }
    pump.current()
  }, [])
  const retryPreview = useCallback(() => setRetry((value) => value + 1), [])
  const retryPage = useCallback((pageNumber: number) => {
    if (!failedPages.current.delete(pageNumber)) return
    setErrors((current) => {
      const next = new Set(current)
      next.delete(pageNumber)
      return next
    })
    pump.current()
  }, [])
  const current =
    owner === document && open ? previews : new Map<number, Preview>()
  return {
    sizes: new Map([...current].map(([page, item]) => [page, item])),
    images: new Map([...current].map(([page, item]) => [page, item.image])),
    errors: owner === document && open ? errors : new Set<number>(),
    onVisibility,
    retryPreview,
    retryPage
  }
}
