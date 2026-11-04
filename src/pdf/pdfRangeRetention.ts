/** DOM Ranges relocate when their ancestor is removed; keep independent endpoints. */
export function snapshotPdfRange(range: Range): () => boolean {
  const start = range.startContainer,
    end = range.endContainer
  const startOffset = range.startOffset,
    endOffset = range.endOffset
  return () => {
    if (!start.isConnected || !end.isConnected) return false
    const length = (node: Node) =>
      node.nodeType === Node.TEXT_NODE
        ? (node.textContent?.length ?? 0)
        : node.childNodes.length
    if (startOffset > length(start) || endOffset > length(end)) return false
    range.setStart(start, startOffset)
    range.setEnd(end, endOffset)
    return true
  }
}

interface RetainedLayer {
  readonly page: HTMLElement
  readonly layer: HTMLElement
  readonly width: number
  readonly height: number
  restored: boolean
  readonly suppressed: Map<HTMLElement, string>
}

/**
 * PDF.js may recycle canvases while a selection spans many pages. Retain only
 * the selected text DOM, never canvases or PDF.js page views/private buffers.
 * Reattach a recycled text layer in the same page before validating Ranges.
 */
export class PdfRangeRetention {
  private readonly pages = new Map<HTMLElement, RetainedLayer>()

  track(root: HTMLElement, range: Range): void {
    for (const page of root.querySelectorAll<HTMLElement>(
      '.pdfViewer > .page'
    )) {
      if (this.pages.has(page) || !range.intersectsNode(page)) continue
      const layer = page.querySelector<HTMLElement>('.textLayer')
      if (!layer) continue
      const { width, height } = page.getBoundingClientRect()
      this.pages.set(page, {
        page,
        layer,
        width,
        height,
        restored: false,
        suppressed: new Map()
      })
    }
  }

  restrictTo(range: Range): void {
    for (const [page, entry] of this.pages) {
      if (range.intersectsNode(page)) continue
      this.release(entry)
      this.pages.delete(page)
    }
  }

  restore(root: HTMLElement): boolean {
    for (const entry of this.pages.values()) {
      const { page, layer, width, height } = entry
      const box = page.getBoundingClientRect()
      // A different page tree/zoom/tool session must still invalidate safely.
      if (!root.contains(page) || box.width !== width || box.height !== height)
        return false
      if (!page.contains(layer)) {
        page.prepend(layer)
        entry.restored = true
        layer.dataset.pdfRetainedText = 'true'
      }
      if (entry.restored) this.suppressDuplicates(entry)
    }
    return true
  }

  private suppressDuplicates(entry: RetainedLayer): void {
    // Returning to a recycled page may create a new PDF.js text layer. Keep
    // its builder intact but avoid duplicate glyph hits until selection ends.
    for (const other of entry.page.querySelectorAll<HTMLElement>(
      '.textLayer'
    )) {
      if (other === entry.layer || entry.suppressed.has(other)) continue
      entry.suppressed.set(other, other.style.display)
      other.style.display = 'none'
    }
  }

  clear(): void {
    for (const entry of this.pages.values()) this.release(entry)
    this.pages.clear()
  }

  private release({ layer, restored, suppressed }: RetainedLayer): void {
    if (restored) layer.remove()
    for (const [other, display] of suppressed) other.style.display = display
  }
}
