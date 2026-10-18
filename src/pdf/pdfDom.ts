import {
  getDocument,
  PDFWorker,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask
} from 'pdfjs-dist'

import {
  isPdfPageNumber,
  type PdfSession,
  type PdfSessionEvents,
  type PdfSessionIdentity,
  type PdfThumbnail
} from '../pdf-contracts'

export type PdfDomOptions = {
  viewport: HTMLElement
  coordinateRoot: HTMLElement
  bytes: Uint8Array
  identity: PdfSessionIdentity
  events: PdfSessionEvents
  /** Same-origin directory containing the pinned worker/cMaps/fonts/WASM. */
  assetBaseUrl: string
}

export type PdfDomSession = PdfSession & {
  setScale(scale: number): void
  rotate(): void
}

type PageSlot = {
  node: HTMLElement
  width: number
  height: number
  page?: PDFPageProxy
  task?: RenderTask
  text?: TextLayer
  canvas?: HTMLCanvasElement
  epoch?: number
  renderedEpoch?: number
  version: number
}

const MAX_PAGE_SURFACES = 5
const MAX_THUMBNAILS = 32
const MAX_CONCURRENT_THUMBNAILS = 2

export function createPdfDomSession(options: PdfDomOptions): PdfDomSession {
  const { viewport, coordinateRoot, identity, events } = options
  const assets = new URL(options.assetBaseUrl, window.location.href)
  if (
    assets.origin !== window.location.origin ||
    !/^https?:$/.test(assets.protocol) ||
    !assets.pathname.endsWith('/') ||
    assets.search ||
    assets.hash
  ) {
    throw new Error('PDF assets must use the local application origin')
  }
  const url = (path: string) => new URL(path, assets).href
  const nativeWorker = new Worker(url('pdf.worker.min.mjs'), { type: 'module' })
  const worker = PDFWorker.create({ port: nativeWorker })
  const loading = getDocument({
    data: options.bytes.slice(),
    worker,
    cMapUrl: url('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: url('standard_fonts/'),
    wasmUrl: url('wasm/'),
    iccUrl: url('iccs/'),
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true
  })
  let retired = false
  let failed = false
  let document: PDFDocumentProxy | undefined
  let currentPage = 1
  let ready = false
  let scale = 1
  let rotation = 0
  let epoch = 0
  let selectionSequence = 0
  let activeRenders = 0
  let frame = 0
  let thumbnailRenders = 0
  const slots: PageSlot[] = []
  const wanted = new Set<number>()
  const pendingThumbnails = new Map<number, Promise<PdfThumbnail | null>>()
  const thumbnailResolvers = new Set<(value: PdfThumbnail | null) => void>()
  const thumbnails = new Map<number, PdfThumbnail>()
  const thumbnailQueue: (() => void)[] = []
  const thumbnailTasks = new Set<RenderTask>()
  const current = () => !retired && !failed
  const state = () => ({
    ...identity,
    pageNumber: currentPage,
    pageCount: document!.numPages
  })
  const publishReady = () => {
    if (ready || !current() || slots[currentPage - 1]?.renderedEpoch !== epoch)
      return
    ready = true
    clearTimeout(loadTimeout)
    events.onStateChange({ ...state(), status: 'ready' })
    events.onPageChange(state())
  }
  const clearSelection = () => {
    const selection = window.getSelection()
    if (selection?.anchorNode && viewport.contains(selection.anchorNode))
      selection.removeAllRanges()
    if (current()) events.onSelectionChange(identity, null)
  }
  const fail = (error: unknown) => {
    if (!current()) return
    failed = true
    clearSelection()
    viewport.replaceChildren()
    const name = error instanceof Error ? error.name : ''
    events.onSelectionChange(identity, null)
    events.onStateChange({
      ...identity,
      status: 'error',
      error: {
        category: name === 'PasswordException' ? 'drm' : 'invalid',
        code:
          name === 'PasswordException'
            ? 'PDF_PASSWORD_REQUIRED'
            : 'PDF_RENDER_FAILED',
        message:
          name === 'PasswordException'
            ? 'Password-protected PDFs are not supported.'
            : 'The PDF could not be displayed.'
      }
    })
    dispose()
  }
  const workerError = () => fail(new Error('PDF worker unavailable'))
  nativeWorker.addEventListener('error', workerError)
  const loadTimeout = setTimeout(workerError, 15_000)
  const release = (slot: PageSlot) => {
    slot.version += 1
    slot.task?.cancel()
    slot.text?.cancel()
    if (slot.canvas) {
      slot.canvas.width = 0
      slot.canvas.height = 0
    }
    slot.node.replaceChildren()
    slot.page?.cleanup()
    slot.page = undefined
    slot.task = undefined
    slot.text = undefined
    slot.canvas = undefined
    slot.epoch = undefined
    slot.renderedEpoch = undefined
    delete slot.node.dataset.pdfRendered
  }
  const dimensions = (slot: PageSlot) => {
    const width =
      Math.max(120, Math.min(1100, viewport.clientWidth - 32)) * scale
    slot.node.style.width = `${width}px`
    slot.node.style.height = `${(width * slot.height) / slot.width}px`
  }
  const publishPage = (page: number) => {
    if (!current() || page === currentPage) return
    currentPage = page
    events.onPageChange(state())
  }
  const renderPage = async (
    pageNumber: number,
    renderEpoch: number,
    version: number
  ) => {
    const slot = slots[pageNumber - 1]
    const valid = () =>
      current() &&
      epoch === renderEpoch &&
      slot.version === version &&
      wanted.has(pageNumber)
    const page = await document!.getPage(pageNumber)
    if (!valid()) return
    slot.page = page
    const natural = page.getViewport({
      scale: 1,
      rotation: (page.rotate + rotation) % 360
    })
    slot.width = natural.width
    slot.height = natural.height
    dimensions(slot)
    const pageScale = Number.parseFloat(slot.node.style.width) / natural.width
    const view = page.getViewport({
      scale: pageScale,
      rotation: natural.rotation
    })
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(8_000_000 / (view.width * view.height))
    )
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(view.width * pixelRatio)
    canvas.height = Math.ceil(view.height * pixelRatio)
    canvas.style.width = `${view.width}px`
    canvas.style.height = `${view.height}px`
    canvas.setAttribute('aria-hidden', 'true')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    const text = window.document.createElement('div')
    text.className = 'hn-pdf-text-layer textLayer'
    text.style.setProperty('--scale-factor', String(pageScale))
    text.style.setProperty('--total-scale-factor', String(pageScale))
    slot.node.replaceChildren(canvas, text)
    slot.canvas = canvas
    slot.task = page.render({
      canvas,
      canvasContext: context,
      viewport: view,
      transform: [pixelRatio, 0, 0, pixelRatio, 0, 0]
    })
    const canvasTask = slot.task
    await canvasTask.promise
    if (!valid()) return
    const textContent = await page.getTextContent()
    if (!valid()) return
    slot.text = new TextLayer({
      textContentSource: textContent,
      container: text,
      viewport: view
    })
    await slot.text.render()
    if (!valid()) return
    slot.renderedEpoch = renderEpoch
    slot.node.dataset.pdfRendered = 'true'
    publishReady()
  }
  const schedule = () => {
    if (!current() || !document) return
    for (const pageNumber of wanted) {
      const slot = slots[pageNumber - 1]
      if (activeRenders >= 2) break
      if (slot.epoch === epoch) continue
      slot.epoch = epoch
      activeRenders += 1
      const renderEpoch = epoch
      const version = ++slot.version
      renderPage(pageNumber, renderEpoch, version)
        .catch((error: unknown) => {
          if (
            current() &&
            epoch === renderEpoch &&
            slot.version === version &&
            wanted.has(pageNumber)
          )
            fail(error)
        })
        .finally(() => {
          activeRenders -= 1
          schedule()
        })
    }
  }
  const refresh = () => {
    frame = 0
    if (!current() || !document) return
    const line =
      viewport.scrollTop + Math.min(viewport.clientHeight * 0.35, 160)
    const index = slots.findIndex(
      (slot) => slot.node.offsetTop + slot.node.offsetHeight > line
    )
    const atEnd =
      viewport.scrollTop > 0 &&
      viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2
    const page = atEnd || index < 0 ? document.numPages : index + 1
    publishPage(page)
    wanted.clear()
    const candidates = Array.from(
      { length: MAX_PAGE_SURFACES },
      (_, offset) => page + offset - 2
    )
      .filter((value) => isPdfPageNumber(value, document!.numPages))
      .sort((left, right) => Math.abs(left - page) - Math.abs(right - page))
    candidates.forEach((value) => wanted.add(value))
    slots.forEach((slot, offset) => {
      if (!wanted.has(offset + 1) && slot.epoch !== undefined) release(slot)
    })
    schedule()
    publishReady()
  }
  const scroll = () => {
    clearSelection()
    if (!frame && current()) frame = requestAnimationFrame(refresh)
  }
  const selectionChanged = () => {
    if (!current()) return
    const selection = window.getSelection()
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !viewport.contains(selection.anchorNode) ||
      !viewport.contains(selection.focusNode)
    ) {
      events.onSelectionChange(identity, null)
      return
    }
    const text = selection.toString().slice(0, 8192)
    const bounds = coordinateRoot.getBoundingClientRect()
    const visible = viewport.getBoundingClientRect()
    const rects = Array.from(selection.getRangeAt(0).getClientRects())
      .filter(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > visible.top &&
          rect.top < visible.bottom &&
          rect.right > visible.left &&
          rect.left < visible.right
      )
      .slice(0, 64)
      .map((rect) => ({
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height
      }))
    events.onSelectionChange(
      identity,
      text.trim() && rects.length
        ? {
            ...identity,
            selectionId: String(++selectionSequence),
            text,
            rects,
            coordinateSpace: 'reader'
          }
        : null
    )
  }
  const contextMenu = (event: Event) => event.preventDefault()
  const relayout = () => {
    if (!current() || !document) return
    clearSelection()
    epoch += 1
    slots.forEach((slot) => {
      release(slot)
      dimensions(slot)
    })
    slots[currentPage - 1]?.node.scrollIntoView({ block: 'start' })
    refresh()
  }
  const resize = new ResizeObserver(relayout)
  resize.observe(viewport)
  viewport.addEventListener('scroll', scroll, { passive: true })
  viewport.addEventListener('contextmenu', contextMenu)
  window.document.addEventListener('selectionchange', selectionChanged)
  events.onStateChange({ ...identity, status: 'loading' })
  loading.promise
    .then(async (pdf) => {
      if (!current()) {
        await pdf.destroy()
        return
      }
      document = pdf
      if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1)
        throw new Error('No PDF pages')
      const first = await pdf.getPage(1)
      if (!current()) return
      const natural = first.getViewport({ scale: 1 })
      const fragment = window.document.createDocumentFragment()
      for (let number = 1; number <= pdf.numPages; number += 1) {
        const node = window.document.createElement('section')
        node.className = 'hn-pdf-page'
        node.dataset.pdfPage = String(number)
        node.setAttribute('aria-label', `Page ${number}`)
        const slot = {
          node,
          width: natural.width,
          height: natural.height,
          version: 0
        }
        slots.push(slot)
        dimensions(slot)
        fragment.append(node)
      }
      viewport.replaceChildren(fragment)
      events.onMetadata({ ...identity, pageCount: pdf.numPages })
      refresh()
    })
    .catch(fail)

  const pumpThumbnails = () => {
    while (
      thumbnailRenders < MAX_CONCURRENT_THUMBNAILS &&
      thumbnailQueue.length
    )
      thumbnailQueue.shift()!()
  }
  const renderThumbnail = async (
    pageNumber: number
  ): Promise<PdfThumbnail | null> => {
    const page = await document!.getPage(pageNumber)
    if (!current()) return null
    const natural = page.getViewport({ scale: 1 })
    const view = page.getViewport({
      scale: Math.min(112 / natural.width, 150 / natural.height)
    })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(view.width)
    canvas.height = Math.ceil(view.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    const task = page.render({ canvas, canvasContext: context, viewport: view })
    thumbnailTasks.add(task)
    try {
      await task.promise
      if (!current()) return null
      const thumbnail = {
        ...identity,
        pageNumber,
        uri: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height
      }
      thumbnails.set(pageNumber, thumbnail)
      if (thumbnails.size > MAX_THUMBNAILS)
        thumbnails.delete(thumbnails.keys().next().value!)
      return thumbnail
    } finally {
      thumbnailTasks.delete(task)
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    }
  }
  const runThumbnail = (
    pageNumber: number,
    resolve: (value: PdfThumbnail | null) => void
  ) => {
    if (!current()) {
      resolve(null)
      return
    }
    thumbnailRenders += 1
    renderThumbnail(pageNumber)
      .then(resolve, () => resolve(null))
      .finally(() => {
        thumbnailRenders -= 1
        pendingThumbnails.delete(pageNumber)
        pumpThumbnails()
      })
  }
  const getThumbnail = async (
    pageNumber: number
  ): Promise<PdfThumbnail | null> => {
    if (
      !current() ||
      !document ||
      !isPdfPageNumber(pageNumber, document.numPages)
    )
      return null
    const cached = thumbnails.get(pageNumber)
    if (cached) {
      thumbnails.delete(pageNumber)
      thumbnails.set(pageNumber, cached)
      return cached
    }
    const pending = pendingThumbnails.get(pageNumber)
    if (pending) return pending
    if (pendingThumbnails.size >= 64) return null
    const result = new Promise<PdfThumbnail | null>((resolve) => {
      const finish = (value: PdfThumbnail | null) => {
        thumbnailResolvers.delete(finish)
        resolve(value)
      }
      thumbnailResolvers.add(finish)
      thumbnailQueue.push(() => runThumbnail(pageNumber, finish))
    })
    pendingThumbnails.set(pageNumber, result)
    pumpThumbnails()
    return result
  }

  function dispose() {
    if (retired) return
    clearSelection()
    retired = true
    clearTimeout(loadTimeout)
    epoch += 1
    if (frame) cancelAnimationFrame(frame)
    resize.disconnect()
    viewport.removeEventListener('scroll', scroll)
    viewport.removeEventListener('contextmenu', contextMenu)
    window.document.removeEventListener('selectionchange', selectionChanged)
    nativeWorker.removeEventListener('error', workerError)
    slots.forEach(release)
    thumbnailTasks.forEach((task) => task.cancel())
    thumbnails.clear()
    thumbnailResolvers.forEach((resolve) => resolve(null))
    thumbnailResolvers.clear()
    pendingThumbnails.clear()
    thumbnailQueue.splice(0)
    viewport.replaceChildren()
    // Allow PDF.js to acknowledge termination before closing its owned port.
    const stop = () => {
      worker.destroy()
      nativeWorker.terminate()
    }
    const deadline = setTimeout(stop, 1000)
    loading
      .destroy()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(deadline)
        stop()
      })
  }

  return {
    identity,
    clearSelection,
    getThumbnail,
    async goToPage(pageNumber) {
      if (
        !current() ||
        !document ||
        !isPdfPageNumber(pageNumber, document.numPages)
      )
        return false
      clearSelection()
      publishPage(pageNumber)
      slots[pageNumber - 1].node.scrollIntoView({ block: 'start' })
      refresh()
      return true
    },
    setScale(value) {
      if (
        Number.isFinite(value) &&
        value >= 0.5 &&
        value <= 3 &&
        value !== scale
      ) {
        scale = value
        relayout()
      }
    },
    rotate() {
      rotation = (rotation + 90) % 360
      slots.forEach((slot) => {
        const width = slot.width
        slot.width = slot.height
        slot.height = width
      })
      relayout()
    },
    dispose
  }
}
