import { getDocument, GlobalWorkerOptions } from '../../src/pdf/pdfjsRuntime'
import { extractNativeCanonicalPage } from '../../src/nativePdf/textGeometry'
import { materializeNativeRange } from '../../src/nativePdf/selection'
import { buildCanonicalPageText } from '../../src/pdf/pdfTextMapping'
import type { TextItem } from '../../src/pdf/pdfjsRuntime'
import worker from 'pdfjs-dist/build/pdf.worker.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
GlobalWorkerOptions.workerSrc = worker
async function verify() {
  const results = []
  for (const path of [
    'test/fixtures/pdf/positioned-runs.pdf',
    'test/compat/fixtures/pdf/two-column.pdf',
    'test/compat/fixtures/pdf/ligature.pdf',
    'test/compat/fixtures/pdf/rotated.pdf',
    'test/fixtures/native-pdf/scan.pdf'
  ]) {
    const task = getDocument({
      data: new Uint8Array(await (await fetch('/' + path)).arrayBuffer()),
      isEvalSupported: false
    })
    try {
      const pdf = await task.promise
      const page = await pdf.getPage(1)
      let renders = 0
      page.render = () => {
        renders++
        throw new Error('native Layout must not render PDF.js pages')
      }
      const canonical = buildCanonicalPageText(
        1,
        (await page.getTextContent()).items.filter(
          (i): i is TextItem => 'str' in i
        )
      )
      const geometry = await extractNativeCanonicalPage(pdf, 1)
      if (geometry.text !== canonical.text)
        throw new Error('canonical text changed: ' + path)
      if (geometry.boundaries.length !== canonical.text.length + 1)
        throw new Error('missing boundary ' + path)
      for (let i = 0; i < geometry.boundaries.length; i++) {
        const b = geometry.boundaries[i]!
        if (
          b.offset !== i ||
          ![b.rect.x, b.rect.y, b.rect.height].every(Number.isFinite)
        )
          throw new Error('invalid boundary ' + path + ' ' + i)
        if (canonical.text.length && b.rect.height <= 0)
          throw new Error('unmeasured boundary ' + path + ' ' + i)
      }
      if (!geometry.textImage?.startsWith('data:image/png;base64,'))
        throw new Error('text texture missing')
      const image = new Image()
      image.src = geometry.textImage
      await image.decode()
      const probe = document.createElement('canvas')
      probe.width = image.width
      probe.height = image.height
      const ctx = probe.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, probe.width, probe.height).data
      let ink = 0
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i]! < 200 && pixels[i + 3]! > 0) ink++
      if (canonical.text.length && !ink)
        throw new Error('blank text-only lens ' + path)
      if (path.includes('positioned-runs')) {
        const range = materializeNativeRange(
          { selectionId: 'page-1', offset: 38 },
          { selectionId: 'page-1', offset: 51 },
          new Map([[1, geometry]]),
          [1],
          { id: 'probe', createdAt: 1, color: '#ffc107' }
        )
        if (range.text !== 'mno pqr stu v') throw new Error('wrong [38,51)')
      }
      if (renders !== 0) throw new Error('PDF.js render was called')
      results.push({
        path,
        boundaries: geometry.boundaries.length,
        inkPixels: ink,
        renders
      })
    } finally {
      await task.destroy()
    }
  }
  return results
}
;(window as Window & { nativeProbe?: ReturnType<typeof verify> }).nativeProbe =
  verify()
