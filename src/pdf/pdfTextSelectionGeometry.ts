import type { IntermediateText } from '@hamster-note/types'
import { TextLayer } from 'pdfjs-dist'
import { registerSourceTextGeometry } from '../components/IntermediateDocumentViewer/sourceTextGeometry'
import type { PageViewport, TextContent } from './pdfjsRuntime'
import type { CanonicalPageText } from './pdfTextMapping'
import { canonicalRangeToDomRange, enhanceTextLayer } from './pdfTextMapping'

/** Retain a detached official text layer with each loaded PDF text page.
 * Measuring it briefly in the DOM preserves PDF.js font metrics, bidi,
 * character advances and rotation, without retaining a visible Layout page.
 */
export async function registerPdfTextSelectionGeometry(
  texts: readonly IntermediateText[],
  canonical: CanonicalPageText,
  textContent: TextContent,
  viewport: PageViewport
): Promise<void> {
  if (
    typeof document === 'undefined' ||
    typeof Range.prototype.getClientRects !== 'function'
  )
    return

  // Measure above scale one to limit browser font-size rounding when the
  // saved geometry is later displayed at typical reader zoom levels.
  const scale = 4
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;width:${viewport.width * scale}px;height:${viewport.height * scale}px;--total-scale-factor:${scale};--scale-round-x:1px;--scale-round-y:1px;`
  host.setAttribute('aria-hidden', 'true')
  const container = document.createElement('div')
  container.className = 'textLayer'
  host.append(container)
  const layer = new TextLayer({
    container,
    textContentSource: textContent,
    viewport: viewport.clone({ scale })
  })
  await layer.render()

  if (!enhanceTextLayer(container, canonical)) return
  let offset = 0
  for (const text of texts) {
    const textStart = offset
    offset += text.content.length
    registerSourceTextGeometry(text, (start, end) => {
      document.body.append(host)
      try {
        const range = canonicalRangeToDomRange(
          canonical,
          textStart + start,
          textStart + end,
          container
        )
        if (!range) return []
        const origin = host.getBoundingClientRect()
        return Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({
            x: (rect.left - origin.left) / scale,
            y: (rect.top - origin.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale
          }))
      } finally {
        host.remove()
      }
    })
  }
}
