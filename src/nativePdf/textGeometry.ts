import html2canvas from 'html2canvas'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, TextItem } from '../pdf/pdfjsRuntime'
import {
  buildCanonicalPageText,
  canonicalTextId,
  canonicalRangeToDomRange,
  enhanceTextLayer
} from '../pdf/pdfTextMapping'
import type { PdfCanonicalPage, PdfRect } from './contracts'

/** Text only. No canvas, page.render, PDFKit character index or approximate advance. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Fail-closed checks at every canonical boundary are intentionally adjacent to measurement.
export async function extractNativeCanonicalPage(
  pdf: PDFDocumentProxy,
  pageNumber: number
): Promise<PdfCanonicalPage> {
  const page = await pdf.getPage(pageNumber)
  const [canonicalContent, rawContent] = await Promise.all([
    page.getTextContent(),
    page.getTextContent({ disableNormalization: true })
  ])
  const items = canonicalContent.items.filter((i): i is TextItem => 'str' in i)
  const canonical = buildCanonicalPageText(pageNumber, items)
  const viewport = page.getViewport({ scale: 1 })
  const scale = 4
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;width:${viewport.width * scale}px;height:${viewport.height * scale}px;--total-scale-factor:${scale};--scale-round-x:1px;--scale-round-y:1px;`
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('data-native-pdf-text', '')
  const container = document.createElement('div')
  container.className = 'textLayer'
  host.append(container)
  const layer = new TextLayer({
    container,
    textContentSource: rawContent,
    viewport: viewport.clone({ scale })
  })
  try {
    await layer.render()
    if (!enhanceTextLayer(container, canonical))
      throw new Error('MAPPING_NOT_READY')
    document.body.append(host)
    const origin = host.getBoundingClientRect()
    const rect = (box: DOMRect): PdfRect => ({
      x: (box.left - origin.left) / scale,
      y: (box.top - origin.top) / scale,
      width: box.width / scale,
      height: box.height / scale
    })
    const glyphs: PdfCanonicalPage['glyphs'][number][] = []
    const boundaries: PdfCanonicalPage['boundaries'][number][] = []
    for (let offset = 0; offset <= canonical.text.length; offset++) {
      const range = canonicalRangeToDomRange(
        canonical,
        offset,
        Math.min(offset + 1, canonical.text.length),
        container
      )
      let box =
        range && Array.from(range.getClientRects()).find((b) => b.height > 0)
      // At page end measure the preceding glyph's trailing edge.
      if (!box && offset === canonical.text.length && offset > 0) {
        const previous = canonicalRangeToDomRange(
          canonical,
          offset - 1,
          offset,
          container
        )
        box =
          previous &&
          Array.from(previous.getClientRects()).find((b) => b.height > 0)
        if (box) box = new DOMRect(box.right, box.top, 0, box.height)
      }
      const span =
        canonical.spans.find(
          (s) => offset >= s.canonicalStart && offset < s.canonicalEnd
        ) ?? canonical.spans.at(-1)
      if (!box) {
        if (canonical.text.length) throw new Error('MAPPING_NOT_READY')
        boundaries.push({
          offset: 0,
          textId: canonicalTextId(pageNumber, 0),
          rect: { x: 0, y: 0, width: 0, height: 0 }
        })
        continue
      }
      const r = rect(box)
      boundaries.push({
        offset,
        textId: canonicalTextId(pageNumber, span?.itemIndex ?? 0),
        rect: { ...r, width: 0 }
      })
      if (offset < canonical.text.length)
        glyphs.push({
          start: offset,
          end: offset + 1,
          text: canonical.text.slice(offset, offset + 1),
          rect: r
        })
    }
    // Capture the independent, already laid-out text layer once. Selection
    // overlays never enter this DOM, and drag previews do not recapture it.
    const canvas = await html2canvas(host, {
      backgroundColor: '#ffffff',
      scale: 0.5,
      logging: false,
      onclone: (cloned) => {
        const node = cloned.querySelector(
          '[data-native-pdf-text]'
        ) as HTMLElement | null
        if (node) {
          node.style.visibility = 'visible'
          for (const child of node.querySelectorAll<HTMLElement>('*')) {
            child.style.visibility = 'visible'
            child.style.color = '#000000'
          }
        }
      }
    })
    const textImage = canvas.toDataURL('image/png')
    canvas.width = 0
    canvas.height = 0
    return {
      textImage,
      pageNumber,
      text: canonical.text,
      width: viewport.width,
      height: viewport.height,
      boundaries,
      glyphs
    }
  } finally {
    host.remove()
    layer.cancel()
  }
}

/** Bounded to visible/target pages plus the active cross-page transaction. */
export class NativeCanonicalCache {
  readonly pages = new Map<number, PdfCanonicalPage>()
  private pending = new Map<number, Promise<PdfCanonicalPage>>()
  private retained = new Set<number>()
  private generation = 0
  constructor(private readonly pdf: PDFDocumentProxy) {}
  retain(numbers: readonly number[]): void {
    this.retained = new Set(numbers)
    for (const n of this.pages.keys())
      if (!this.retained.has(n)) this.pages.delete(n)
  }
  async get(n: number, texture = false): Promise<PdfCanonicalPage> {
    const cached = this.pages.get(n)
    if (cached && (!texture || cached.textImage || !cached.text.length))
      return cached
    const token = this.generation
    let pending = this.pending.get(n)
    if (!pending) {
      pending = extractNativeCanonicalPage(this.pdf, n)
        .then((p) => {
          if (token !== this.generation) throw new Error('CANCELLED')
          if (this.retained.has(n)) {
            this.pages.set(n, p)
            const textured = [...this.pages].filter(
              ([, page]) => page.textImage
            )
            for (const [old, page] of textured.slice(
              0,
              Math.max(0, textured.length - 5)
            )) {
              const mapping = { ...page }
              delete mapping.textImage
              this.pages.set(old, mapping)
            }
          }
          return p
        })
        .finally(() => this.pending.delete(n))
      this.pending.set(n, pending)
    }
    return pending
  }
  dispose(): void {
    this.generation++
    this.retained.clear()
    this.pages.clear()
  }
}
