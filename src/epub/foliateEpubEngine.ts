// HAM-88 任务 2.2/2.4/2.5：EPUB 主展示引擎适配器（foliate-js）。
// 职责：foliate-view 装配（打开、目录、封面、字体、flow）、高亮叠加、
// 选区反向序列化、切书竞态隔离与资源释放。
// 数据契约：持久化端点只用旧 page-N/offset（经 EpubCompatIndex），
// foliate 的 CFI/DOM Range 只是可重建的内部缓存，不出本模块。
// 集成接线（Reader 路由、底栏、存储）属于 HAM-91，本模块不改动。

import { Overlayer } from '../../vendor/foliate-js/overlayer.js'
import '../../vendor/foliate-js/view.js'
import { getVisiblePageNumbers } from '../components/IntermediateDocumentViewer/pageDisplay'
import type { ReaderPageRange } from '../components/IntermediateDocumentViewer'
import type {
  FoliateBook,
  FoliateRelocateDetail,
  FoliateTocItem,
  View
} from '../../vendor/foliate-js/view.js'
import { EpubCompatIndex, type UnlocatableReason } from './epubCompatIndex'
import { openEpubPackage, type EpubPackage } from './epubPackage'
import { buildLegacyEpubModel, type LegacyEpubModel } from './legacyEpubModel'
import type { SerializedSelection } from './epubCompatIndex'
import { restrictPublicationResources } from './publicationSecurity'
import type { ReaderTextAnchor } from '../types/readerData'

export type EpubEngineTocEntry = {
  readonly label: string
  readonly href: string | null
  /** 对应旧逻辑页号；无法映射（外链、被过滤的导航页）为 null。 */
  readonly pageNumber: number | null
  readonly subitems: readonly EpubEngineTocEntry[]
}

export type EpubEngineBookInfo = {
  readonly title: string | null
  readonly pageCount: number
  readonly coverPrepended: boolean
  /** 补出的封面页（page-1）图片；object URL 由引擎持有，destroy 时释放。 */
  readonly cover: { readonly url: string; readonly alt: string | null } | null
  readonly toc: readonly EpubEngineTocEntry[]
}

export type EpubEngineLocation = {
  readonly chapterIndex: number
  readonly pageNumber: number | null
  /** 节内滚动/分页进度 0..1。 */
  readonly fraction: number
}

export type EpubEngineError = {
  readonly code: 'open-failed' | 'render-failed'
  readonly message: string
}

/** 持久化高亮的最小形状（ReaderSelectionRange 的端点+样式子集）。 */
export type EpubEngineRange = {
  readonly id: string
  readonly text: string
  readonly start: { readonly selectionId: string; readonly offset: number }
  readonly end: { readonly selectionId: string; readonly offset: number }
  readonly markerStyle?: { readonly backgroundColor?: string }
}

export type ShowRangesReport = {
  readonly located: readonly string[]
  readonly unlocatable: readonly {
    readonly id: string
    readonly reason: UnlocatableReason
  }[]
}

export type EpubEngineOptions = {
  readonly container: HTMLElement
  readonly source: Uint8Array | Blob
  readonly flow?: 'paginated' | 'scrolled'
  readonly fontScale?: number
  readonly selectionColor?: string
  readonly onReady?: (info: EpubEngineBookInfo) => void
  readonly onError?: (error: EpubEngineError) => void
  readonly onRelocate?: (location: EpubEngineLocation) => void
  readonly onSelection?: (payload: SerializedSelection | null) => void
  readonly onDocumentLoad?: (doc: Document, pageNumber: number) => void
  readonly onDocumentUnload?: (doc: Document) => void
  /** 点击已绘高亮（overlayer hitTest），携带文档坐标矩形。 */
  readonly onHighlightActivate?: (
    id: string,
    rect: { readonly x: number; readonly y: number }
  ) => void
}

export type EpubEngine = {
  /** open 完成 resolve；失败 reject（同时走 onError）。 */
  readonly ready: Promise<EpubEngineBookInfo>
  readonly goToPage: (pageNumber: number) => Promise<boolean>
  readonly goToTocHref: (href: string) => Promise<boolean>
  /** 跳转并滚动到已加入的高亮。 */
  readonly goToRange: (id: string) => Promise<boolean>
  readonly setFontScale: (scale: number) => void
  readonly setFlow: (flow: 'paginated' | 'scrolled') => void
  /** 恢复/全量替换展示的高亮；无法唯一定位的项原样保留并上报。 */
  readonly showRanges: (ranges: readonly EpubEngineRange[]) => ShowRangesReport
  readonly removeRange: (id: string) => void
  readonly clearRanges: () => void
  /** 当前选区 → 旧端点结构；无选区或节降级时 null。 */
  readonly serializeCurrentSelection: () => SerializedSelection | null
  readonly getSelectionRange: () => Range | null
  readonly selectRange: (id: string) => Promise<Range | null>
  readonly serializeRange: (range: Range) => SerializedSelection | null
  readonly updateRangeEndpoint: (
    id: string,
    range: Range,
    end: boolean
  ) => SerializedSelection | null
  readonly getRangePart: (id: string) => Range | null
  readonly setHiddenPages: (
    pages: readonly (number | string)[],
    editing?: boolean,
    pageRange?: ReaderPageRange
  ) => Promise<void>
  readonly clearSelection: () => void
  readonly setActiveRange: (id: string | null) => void
  readonly rangeIdAtPoint: (
    doc: Document,
    x: number,
    y: number
  ) => string | null
  readonly captureTextAnchor: () => ReaderTextAnchor | undefined
  readonly goToAnchor: (anchor: ReaderTextAnchor) => Promise<void>
  /** 取消加载、释放 object URL / 视图 / 归档；之后不再产生任何事件。 */
  readonly destroy: () => Promise<void>
}

/** 视图工厂注入点：测试用假视图替换真实 foliate-view（jsdom 无布局）。 */
export type EpubEngineViewFactory = () => View

const DEFAULT_FONT_SCALE = 1
const BASE_FONT_SIZE_PX = 16

export const createEpubEngine = (
  options: EpubEngineOptions,
  createView: EpubEngineViewFactory = () =>
    document.createElement('foliate-view') as View
): EpubEngine => {
  let destroyed = false
  let pkg: EpubPackage | null = null
  let model: LegacyEpubModel | null = null
  let compat: EpubCompatIndex | null = null
  let view: View | null = null
  let book: FoliateBook | null = null
  let coverUrl: string | null = null
  let fontScale = options.fontScale ?? DEFAULT_FONT_SCALE
  let currentAnchor: ReaderTextAnchor | undefined
  let displayedPage: number | undefined
  let activeRangeId: string | null = null
  let hiddenPages = new Set<number>()
  let rangePages: ReadonlySet<number> | undefined
  let restrictionGeneration = 0
  let restrictionNavigation: Promise<void> | undefined
  const isPageVisible = (page: number) =>
    (!rangePages || rangePages.has(page)) &&
    (cropEditing || !hiddenPages.has(page))
  let cropEditing = false
  const originalLinear = new Map<number, string | undefined>()
  // foliate section 下标 ↔ 兼容索引章节下标（href 对应；导航项在 spine 时错位）。
  let chapterIndexBySection: readonly (number | null)[] = []
  let sectionIndexByChapter: readonly (number | null)[] = []
  // 已恢复高亮：id → 数据与契约校验结果；DOM Range 绘制时按活文档现算。
  const ranges = new Map<
    string,
    { data: EpubEngineRange; reason: UnlocatableReason | null }
  >()
  const liveDocs = new Map<number, Document>()
  // 已加载但尚未补画叠加的 foliate section（'load' 时 getContents 未就绪）。
  const pendingOverlayDraw = new Set<number>()
  const docListeners: [Document, string, EventListener][] = []
  let turning = false
  const turnAtBoundary = async (doc: Document, forward: boolean) => {
    if (destroyed || turning || cropEditing || !view?.renderer) return false
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
    const viewport = options.container.getBoundingClientRect()
    if (
      !frame ||
      (forward
        ? frame.bottom > viewport.bottom + 2
        : frame.top < viewport.top - 2)
    )
      return false
    turning = true
    try {
      if (forward) await view.renderer.next()
      else await view.renderer.prev()
    } catch (error) {
      if (!destroyed)
        options.onError?.({ code: 'render-failed', message: String(error) })
    } finally {
      turning = false
    }
    return true
  }

  let resolveReady!: (info: EpubEngineBookInfo) => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<EpubEngineBookInfo>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // 调用方不 catch 也不应有未处理拒绝。
  ready.catch(() => undefined)

  const fail = (code: EpubEngineError['code'], error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (!destroyed) options.onError?.({ code, message })
    rejectReady(new Error(message))
  }

  const applyStyles = () => {
    const renderer = view?.renderer
    if (!renderer) return
    const selection = options.selectionColor ?? 'rgba(0, 120, 215, 0.3)'
    renderer.setStyles(
      `html { font-size: ${Math.round(BASE_FONT_SIZE_PX * fontScale)}px !important; }\n` +
        `::selection { background: ${selection} !important; }`
    )
  }

  /** 全部已加载节重画；未就绪的节登记到 pendingOverlayDraw 由 relocate 补画。 */
  const drawAllLiveSections = () => {
    const renderer = view?.renderer
    if (!renderer) return
    for (const contents of renderer.getContents()) {
      if (!drawSectionAnnotations(contents.index)) {
        pendingOverlayDraw.add(contents.index)
      } else {
        pendingOverlayDraw.delete(contents.index)
      }
    }
  }

  const redrawLiveOverlays = () => {
    const renderer = view?.renderer
    if (!renderer) return
    drawAllLiveSections()
    for (const contents of renderer.getContents()) {
      contents.overlayer?.redraw()
    }
  }

  /** 绘制某 foliate section 上属于它的高亮部件（活文档现算 Range）。
   *  paginator 的 relocate 可能早到（getContents 仍是上一节的过期视图或
   *  overlayer 未挂），返回 false 由调用方留待下一次 relocate 重试。 */
  const drawSectionAnnotations = (sectionIndex: number): boolean => {
    const renderer = view?.renderer
    const chapterIndex = chapterIndexBySection[sectionIndex]
    if (!renderer || chapterIndex === null || chapterIndex === undefined) {
      return true
    }
    const contents = renderer
      .getContents()
      .find((entry) => entry.index === sectionIndex)
    // 过期视图判定：contents.doc 与本节活文档不一致即尚未切换完成。
    if (!contents?.overlayer || contents.doc !== liveDocs.get(chapterIndex)) {
      return false
    }
    const overlayer = contents.overlayer

    // 先清掉本节旧部件再重画（键前缀按节隔离）。
    for (const [id] of ranges) {
      overlayer.remove(`epub-range:${sectionIndex}:${id}`)
    }
    if (!compat) return true
    for (const [id, entry] of Array.from(ranges).filter(
      ([key]) => key !== activeRangeId
    )) {
      if (entry.reason !== null) continue
      const location = compat.locateRange(entry.data)
      if (location.status !== 'located') {
        entry.reason = location.reason
        continue
      }
      for (const part of location.parts) {
        if (part.chapterIndex !== chapterIndex) continue
        overlayer.add(`epub-range:${sectionIndex}:${id}`, part.range, (rects) =>
          Overlayer.highlight(rects, {
            color:
              entry.data.markerStyle?.backgroundColor ?? 'rgba(255, 213, 79, 1)'
          })
        )
      }
    }
    return true
  }

  const releaseLiveDocuments = (replacingChapter: number) => {
    // Foliate recycles its single reflowable iframe. Do not retain its Window/listeners.
    for (const [oldChapter, oldDoc] of liveDocs) {
      if (
        oldChapter !== replacingChapter &&
        oldDoc.defaultView?.frameElement?.isConnected
      )
        continue
      options.onDocumentUnload?.(oldDoc)
      for (let i = docListeners.length - 1; i >= 0; i--) {
        const [owner, type, listener] = docListeners[i]
        if (owner !== oldDoc) continue
        owner.removeEventListener(type, listener)
        docListeners.splice(i, 1)
      }
      compat?.detachSectionDocument(oldChapter)
      liveDocs.delete(oldChapter)
    }
  }

  const onSectionLoad = (doc: Document, sectionIndex: number) => {
    if (destroyed || !compat) return
    const chapterIndex = chapterIndexBySection[sectionIndex]
    if (chapterIndex === null || chapterIndex === undefined) return
    releaseLiveDocuments(chapterIndex)
    liveDocs.set(chapterIndex, doc)
    const pageNumber =
      model?.pages.find((page) => page.chapterIndex === chapterIndex)
        ?.pageNumber ?? 1
    options.onDocumentLoad?.(doc, pageNumber)
    const healthy = compat.attachSectionDocument(chapterIndex, doc)
    if (!healthy) {
      // 节降级：只把锚定到本节的已定位高亮重新标记为不可定位，
      // 其他节的项不受影响。
      for (const [, entry] of ranges) {
        if (entry.reason !== null) continue
        const location = compat.locateRange(entry.data)
        if (location.status === 'unlocatable') entry.reason = location.reason
      }
    }
    // paginator 在 'load' 之后才给 #view 赋值（getContents 才含本节），
    // 叠加绘制推迟到紧随的 relocate。
    pendingOverlayDraw.add(sectionIndex)

    const onSelectionChange = () => {
      if (destroyed) return
      options.onSelection?.(serializeCurrentSelection())
    }
    const onClick = (event: Event) => {
      if (destroyed) return
      const renderer = view?.renderer
      const contents = renderer
        ?.getContents()
        .find((entry) => entry.index === sectionIndex)
      if (!contents) return
      const mouse = event as MouseEvent
      const hit = contents.overlayer.hitTest({
        x: mouse.clientX,
        y: mouse.clientY
      })
      const [key] = hit
      if (!key) return
      const id = key.split(':').at(-1)
      if (id && ranges.has(id)) {
        options.onHighlightActivate?.(id, {
          x: mouse.clientX,
          y: mouse.clientY
        })
      }
    }
    const onWheel = (event: Event) => {
      const wheel = event as WheelEvent
      if (
        wheel.ctrlKey ||
        wheel.buttons ||
        !wheel.deltaY ||
        Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)
      )
        return
      void turnAtBoundary(doc, wheel.deltaY > 0)
    }
    let touchStart: { y: number; time: number } | null = null
    const onTouchStart = (event: Event) => {
      const touches = (event as TouchEvent).touches
      touchStart =
        touches.length === 1
          ? { y: touches[0].clientY, time: Date.now() }
          : null
    }
    const onTouchEnd = (event: Event) => {
      const start = touchStart
      touchStart = null
      const end = (event as TouchEvent).changedTouches[0]
      if (
        !start ||
        !end ||
        Date.now() - start.time > 450 ||
        Math.abs(end.clientY - start.y) < 50
      )
        return
      void turnAtBoundary(doc, end.clientY < start.y)
    }
    doc.addEventListener('selectionchange', onSelectionChange)
    doc.addEventListener('click', onClick)
    doc.addEventListener('wheel', onWheel, { passive: true })
    doc.addEventListener('touchstart', onTouchStart, { passive: true })
    doc.addEventListener('touchend', onTouchEnd, { passive: true })
    docListeners.push(
      [doc, 'selectionchange', onSelectionChange],
      [doc, 'click', onClick],
      [doc, 'wheel', onWheel],
      [doc, 'touchstart', onTouchStart],
      [doc, 'touchend', onTouchEnd]
    )
  }

  const onRelocate = (detail: FoliateRelocateDetail) => {
    if (destroyed || !model) return
    if (
      pendingOverlayDraw.has(detail.index) &&
      drawSectionAnnotations(detail.index)
    ) {
      pendingOverlayDraw.delete(detail.index)
    }
    const chapterIndex = chapterIndexBySection[detail.index]
    if (chapterIndex === null || chapterIndex === undefined) {
      currentAnchor = undefined
      displayedPage = undefined
      return
    }
    const page = model.pages.find(
      (entry) => entry.chapterIndex === chapterIndex
    )
    if (page && !isPageVisible(page.pageNumber)) return
    const position =
      detail.range && compat?.serializeRange(chapterIndex, detail.range)
    currentAnchor = page
      ? {
          pageNumber: page.pageNumber,
          textId: `${page.pageId}-text`,
          text: position?.text ?? page.text.slice(0, 80),
          offset: position?.start.offset ?? 0
        }
      : undefined
    displayedPage = page?.pageNumber
    options.onRelocate?.({
      chapterIndex,
      pageNumber: page?.pageNumber ?? null,
      fraction: detail.fraction
    })
  }

  const serializeCurrentSelection = (): SerializedSelection | null => {
    if (destroyed || !compat) return null
    for (const [chapterIndex, doc] of liveDocs) {
      const selection = doc.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        continue
      }
      const payload = compat.serializeRange(
        chapterIndex,
        selection.getRangeAt(0)
      )
      if (payload) return payload
    }
    return null
  }

  const buildSectionMaps = (foliateBook: FoliateBook, pack: EpubPackage) => {
    const chapterIndexByHref = new Map(
      pack.chapters.map((chapter, index) => [chapter.href, index] as const)
    )
    const bySection: (number | null)[] = foliateBook.sections.map(
      (section) => chapterIndexByHref.get(section.id) ?? null
    )
    const byChapter: (number | null)[] = pack.chapters.map((chapter) => {
      const index = foliateBook.sections.findIndex(
        (section) => section.id === chapter.href
      )
      return index >= 0 ? index : null
    })
    chapterIndexBySection = bySection
    sectionIndexByChapter = byChapter
  }

  const mapToc = (
    items: readonly FoliateTocItem[] | undefined,
    foliateBook: FoliateBook,
    legacyModel: LegacyEpubModel
  ): readonly EpubEngineTocEntry[] =>
    (items ?? []).map((item) => {
      let pageNumber: number | null = null
      if (item.href) {
        const resolved = foliateBook.resolveHref(item.href)
        const chapterIndex =
          resolved !== null ? chapterIndexBySection[resolved.index] : undefined
        if (chapterIndex !== null && chapterIndex !== undefined) {
          pageNumber =
            legacyModel.pages.find(
              (entry) => entry.chapterIndex === chapterIndex
            )?.pageNumber ?? null
        }
      }
      return {
        label: item.label?.trim() ?? '',
        href: item.href ?? null,
        pageNumber,
        subitems: mapToc(item.subitems, foliateBook, legacyModel)
      }
    })

  /** 打开归档并构建旧页模型与兼容索引。 */
  const bootBuildIndex = async () => {
    pkg = await openEpubPackage(options.source)
    model = await buildLegacyEpubModel(pkg)
    compat = await EpubCompatIndex.create(pkg, model)
  }

  /** 创建 foliate 视图、打开图书并接线渲染器事件。 */
  const bootOpenView = async (pack: EpubPackage) => {
    view = createView()
    // new Uint8Array(source) 复制出 Uint8Array<ArrayBuffer>，满足 BlobPart
    // 的 TS 5.7 泛型约束；Blob 本身也会拷贝字节，无额外常驻成本。
    const bookFile = new File(
      [
        options.source instanceof Blob
          ? options.source
          : new Uint8Array(options.source)
      ],
      'book.epub',
      { type: 'application/epub+zip' }
    )
    await view.open(bookFile)
    if (destroyed) return false
    book = view.book ?? null
    if (!book || !view.renderer) {
      throw new Error('foliate view did not provide book/renderer')
    }
    if (book.transformTarget) restrictPublicationResources(book.transformTarget)
    view.addEventListener('external-link', (event) => event.preventDefault())
    view.addEventListener('link', (event) => {
      if (!rangePages) return
      event.preventDefault()
      const { href } = (event as CustomEvent<{ href: string }>).detail
      goToTocHref(href).catch((error: unknown) => fail('render-failed', error))
    })
    buildSectionMaps(book, pack)

    const renderer = view.renderer
    renderer.addEventListener('load', (event) =>
      onSectionLoad(event.detail.doc, event.detail.index)
    )
    renderer.addEventListener('relocate', (event) => onRelocate(event.detail))
    renderer.setAttribute('flow', options.flow ?? 'scrolled')
    applyStyles()
    options.container.append(view)
    return true
  }

  /** 封面、初始定位与就绪通知。 */
  const bootFinish = async () => {
    if (!book || !model || !view) throw new Error('boot state incomplete')
    if (model.coverPrepended && typeof URL.createObjectURL === 'function') {
      const coverBlob = await book.getCover()
      if (coverBlob) coverUrl = URL.createObjectURL(coverBlob)
    }
    if (destroyed) return

    const firstLinear = book.sections.findIndex(
      (section) => section.linear !== 'no'
    )
    if (firstLinear >= 0 && view.renderer) {
      // view.goTo 只接受 number/fraction/CFI/href；{index, anchor} 形状
      // 直接走 renderer.goTo（foliate reader.js 同款用法）。
      await view.renderer.goTo({ index: firstLinear })
    }
    if (destroyed) return

    const info: EpubEngineBookInfo = {
      title: model.title,
      pageCount: model.pages.length,
      coverPrepended: model.coverPrepended,
      cover:
        model.coverPrepended && coverUrl
          ? { url: coverUrl, alt: model.cover?.alt ?? null }
          : null,
      toc: mapToc(book.toc, book, model)
    }
    resolveReady(info)
    options.onReady?.(info)
  }

  /** 打开失败：释放已建资源并上报；既有数据不动（契约）。 */
  const bootCleanupAfterFailure = async (error: unknown) => {
    try {
      view?.close()
    } catch {
      // renderer 可能未就绪。
    }
    view?.remove()
    view = null
    book?.destroy()
    book = null
    if (pkg) {
      await pkg.destroy().catch(() => undefined)
      pkg = null
    }
    if (!destroyed) fail('open-failed', error)
    else rejectReady(error instanceof Error ? error : new Error(String(error)))
  }

  const boot = async () => {
    try {
      await bootBuildIndex()
      if (destroyed || !pkg) return
      if (!(await bootOpenView(pkg))) return
      await bootFinish()
    } catch (error) {
      await bootCleanupAfterFailure(error)
    }
  }

  const goToPage = async (pageNumber: number): Promise<boolean> => {
    if (destroyed || !model || !view?.renderer) return false
    if (!model.pages.some((entry) => entry.pageNumber === pageNumber))
      return false
    const visible = model.pages.filter((entry) =>
      isPageVisible(entry.pageNumber)
    )
    const page =
      visible.find((entry) => entry.pageNumber === pageNumber) ??
      visible.find((entry) => entry.pageNumber > pageNumber) ??
      visible.at(-1)
    if (!page) return false
    if (page.chapterIndex === null) {
      currentAnchor = undefined
      displayedPage = page.pageNumber
      options.onRelocate?.({
        chapterIndex: -1,
        pageNumber: page.pageNumber,
        fraction: 0
      })
      return true
    }
    const sectionIndex = sectionIndexByChapter[page.chapterIndex]
    if (sectionIndex === null || sectionIndex === undefined) return false
    await view.renderer.goTo({ index: sectionIndex })
    return true
  }

  const reconcilePageVisibility = async (generation: number) => {
    if (
      destroyed ||
      generation !== restrictionGeneration ||
      !model ||
      !view?.renderer
    )
      return
    const firstVisible = model.pages.find((page) =>
      isPageVisible(page.pageNumber)
    )
    const wasEmpty = view.style.visibility === 'hidden'
    if (!firstVisible) {
      view.style.visibility = 'hidden'
      currentAnchor = undefined
      displayedPage = undefined
      options.onRelocate?.({
        chapterIndex: -1,
        pageNumber: null,
        fraction: 0
      })
      return
    }
    const displayed = model.pages.find(
      (page) => page.pageNumber === displayedPage
    )
    const contents = view.renderer.getContents()[0]
    const chapter = contents && chapterIndexBySection[contents.index]
    const rendererPage =
      chapter !== null && chapter !== undefined
        ? model.pages.find((page) => page.chapterIndex === chapter)
        : undefined
    // Only a virtual cover is independent of the renderer's actual section.
    const current =
      displayed?.chapterIndex === null || !contents ? displayed : rendererPage
    if (
      (current && !isPageVisible(current.pageNumber)) ||
      (!current && rangePages) ||
      wasEmpty
    ) {
      view.style.visibility = 'hidden'
      await goToPage(current?.pageNumber ?? firstVisible.pageNumber)
    }
    if (!destroyed && generation === restrictionGeneration && view)
      view.style.visibility = ''
  }

  const goToTocHref = async (href: string): Promise<boolean> => {
    if (destroyed || !book || !view?.renderer) return false
    const resolved = book.resolveHref(href)
    if (!resolved) return false
    const chapter = chapterIndexBySection[resolved.index]
    const page = model?.pages.find((entry) => entry.chapterIndex === chapter)
    if (rangePages && !page) return false
    if (page && !isPageVisible(page.pageNumber))
      return goToPage(page.pageNumber)
    await view.renderer.goTo({ index: resolved.index, anchor: resolved.anchor })
    return true
  }

  const goToRange = async (id: string): Promise<boolean> => {
    if (destroyed || !view?.renderer || !compat) return false
    const entry = ranges.get(id)
    if (!entry || entry.reason !== null) return false
    if (!isPageVisible(Number(entry.data.start.selectionId.slice(5))))
      return false
    const firstPart = compat.locateRange(entry.data)
    if (firstPart.status !== 'located' || firstPart.parts.length === 0) {
      return false
    }
    const sectionIndex = sectionIndexByChapter[firstPart.parts[0].chapterIndex]
    if (sectionIndex === null || sectionIndex === undefined) return false
    // 两阶段：先切节（此间 load/relocate 把活文档接入兼容索引），
    // 再用活文档重建 Range 做精确滚动——静态文档的 Range 不能跨文档锚定。
    await view.renderer.goTo({ index: sectionIndex })
    if (destroyed) return false
    const livePart = compat.locateRange(entry.data)
    if (livePart.status !== 'located' || livePart.parts.length === 0) {
      return true
    }
    await view.renderer.scrollToAnchor(livePart.parts[0].range)
    return true
  }

  const destroy = async () => {
    if (destroyed) return
    destroyed = true
    for (const [doc, type, listener] of docListeners) {
      doc.removeEventListener(type, listener)
    }
    docListeners.length = 0
    for (const doc of liveDocs.values()) options.onDocumentUnload?.(doc)
    liveDocs.clear()
    ranges.clear()
    try {
      view?.close()
    } catch {
      // close 内部 renderer 可能未就绪；释放继续。
    }
    view?.remove()
    view = null
    book?.destroy()
    book = null
    if (pkg) {
      await pkg.destroy().catch(() => undefined)
      pkg = null
    }
    if (coverUrl) {
      URL.revokeObjectURL(coverUrl)
      coverUrl = null
    }
    compat = null
    model = null
  }

  void boot()

  const getRangePart = (id: string): Range | null => {
    const entry = ranges.get(id)
    if (!entry || !compat) return null
    const located = compat.locateRange(entry.data)
    if (located.status !== 'located') return null
    const visibleDocs =
      view?.renderer?.getContents().map((item) => item.doc) ?? []
    return (
      located.parts.find((part) =>
        visibleDocs.includes(part.range.startContainer.ownerDocument!)
      )?.range ?? null
    )
  }

  return {
    ready,
    goToPage,
    goToTocHref,
    goToRange,
    setFontScale: (scale: number) => {
      if (destroyed || scale <= 0) return
      fontScale = scale
      applyStyles()
      // 字体变化只重算显示坐标；持久化端点不动（ranges 存的是旧端点）。
      redrawLiveOverlays()
    },
    setFlow: (flow) => {
      if (destroyed) return
      view?.renderer?.setAttribute('flow', flow)
    },
    showRanges: (rangeList) => {
      const located: string[] = []
      const unlocatable: { id: string; reason: UnlocatableReason }[] = []
      for (const id of ranges.keys()) {
        view?.renderer?.getContents().forEach((contents) => {
          contents.overlayer?.remove(`epub-range:${contents.index}:${id}`)
        })
      }
      ranges.clear()
      if (compat) {
        for (const data of rangeList) {
          const location = compat.locateRange(data)
          if (location.status === 'located') {
            ranges.set(data.id, { data, reason: null })
            located.push(data.id)
          } else {
            ranges.set(data.id, { data, reason: location.reason })
            unlocatable.push({ id: data.id, reason: location.reason })
          }
        }
        // 重画所有已加载节；未就绪的由 relocate 补画。
        drawAllLiveSections()
      } else {
        for (const data of rangeList) {
          unlocatable.push({ id: data.id, reason: 'degraded-section' })
        }
      }
      return { located, unlocatable }
    },
    removeRange: (id) => {
      ranges.delete(id)
      view?.renderer?.getContents().forEach((contents) => {
        contents.overlayer?.remove(`epub-range:${contents.index}:${id}`)
      })
    },
    clearRanges: () => {
      ranges.clear()
      drawAllLiveSections()
    },
    serializeCurrentSelection,
    getRangePart,
    updateRangeEndpoint: (id, range, end) => {
      const entry = ranges.get(id)
      if (!entry || !compat) return null
      for (const [chapter, doc] of liveDocs) {
        if (range.startContainer.ownerDocument === doc)
          return compat.updateEndpoint(entry.data, range, chapter, end)
      }
      return null
    },
    setHiddenPages: async (pages, editing = false, pageRange) => {
      if (destroyed) return
      hiddenPages = new Set(
        pages.map((page) =>
          typeof page === 'number' ? page : Number(page.slice(5))
        )
      )
      cropEditing = editing
      rangePages = pageRange
        ? new Set(
            getVisiblePageNumbers(
              model?.pages.map((page) => page.pageNumber) ?? [],
              pageRange
            )
          )
        : undefined
      book?.sections.forEach((section, index) => {
        if (!originalLinear.has(index))
          originalLinear.set(index, section.linear)
        const chapter = chapterIndexBySection[index]
        const page =
          chapter !== null && chapter !== undefined
            ? model?.pages.find((entry) => entry.chapterIndex === chapter)
            : undefined
        const visible = page ? isPageVisible(page.pageNumber) : !rangePages
        section.linear = visible ? originalLinear.get(index) : 'no'
      })
      if (!model || !view?.renderer) return
      const generation = ++restrictionGeneration
      // Foliate loads cannot be cancelled. Drain the in-flight navigation before
      // reconciling the latest restrictions, keeping obsolete content hidden.
      if (restrictionNavigation) view.style.visibility = 'hidden'
      const reconcile = () => reconcilePageVisibility(generation)
      const navigation = restrictionNavigation
        ? restrictionNavigation.catch(() => undefined).then(reconcile)
        : reconcile()
      restrictionNavigation = navigation
      try {
        await navigation
      } finally {
        if (restrictionNavigation === navigation)
          restrictionNavigation = undefined
      }
    },
    rangeIdAtPoint: (doc, x, y) => {
      if (!compat) return null
      for (const [id, entry] of ranges) {
        const located = compat.locateRange(entry.data)
        if (located.status !== 'located') continue
        const hit = located.parts.some(
          (part) =>
            part.range.startContainer.ownerDocument === doc &&
            Array.from(part.range.getClientRects()).some(
              (rect) =>
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.top &&
                y <= rect.bottom
            )
        )
        if (hit) return id
      }
      return null
    },
    clearSelection: () => {
      for (const doc of liveDocs.values()) doc.getSelection()?.removeAllRanges()
    },
    setActiveRange: (id) => {
      activeRangeId = id
      drawAllLiveSections()
    },
    getSelectionRange: () => {
      for (const doc of liveDocs.values()) {
        const selection = doc.getSelection()
        if (selection && !selection.isCollapsed && selection.rangeCount) {
          return selection.getRangeAt(0)
        }
      }
      return null
    },
    serializeRange: (range) => {
      for (const [chapter, doc] of liveDocs) {
        if (range.startContainer.ownerDocument === doc)
          return compat?.serializeRange(chapter, range) ?? null
      }
      return null
    },
    selectRange: async (id) => {
      if (!(await goToRange(id)) || !compat) return null
      const entry = ranges.get(id)
      if (!entry) return null
      const range = getRangePart(id)
      if (!range) return null
      const selection = range.startContainer.ownerDocument?.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return range
    },
    captureTextAnchor: () => currentAnchor,
    goToAnchor: async (anchor) => {
      await goToPage(anchor.pageNumber)
      if (!compat || !view?.renderer) return
      const text = compat.pageText(anchor.pageNumber) ?? ''
      const offset = Math.min(anchor.offset, Math.max(0, text.length - 1))
      const endpoint = { selectionId: `page-${anchor.pageNumber}`, offset }
      const located = compat.locateRange({
        start: endpoint,
        end: { ...endpoint, offset: offset + 1 },
        text: text.slice(offset, offset + 1)
      })
      if (located.status === 'located' && located.parts[0])
        await view.renderer.scrollToAnchor(located.parts[0].range)
    },
    destroy
  }
}
