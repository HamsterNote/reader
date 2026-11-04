import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PdfDocumentViewer } from '../src/pdf/PdfDocumentViewer'
import { usePdfPreviews } from '../src/pdf/usePdfPreviews'
import { configurePdfJsWorker, getDocument } from '../src/pdf/pdfjsRuntime'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import '../src/styles/index.scss'

configurePdfJsWorker(workerSrc)
const source = {
  data: new Uint8Array(await (await fetch('/resources.pdf')).arrayBuffer())
}

// Test-only observation of pdfjs's private cache, matching the review experiment.
// Production cleanup uses the official viewer event and no private cache fields.
function cacheStats(page) {
  return {
    retained: page._intentStates.size > 0 ? 1 : 0,
    operators: [...page._intentStates.values()].reduce(
      (count, state) => count + state.operatorList.fnArray.length,
      0
    )
  }
}
async function snapshot(document) {
  const pages = []
  for (let number = 1; number <= document.numPages; number++) {
    pages.push({
      pageNumber: number,
      ...cacheStats(await document.getPage(number))
    })
  }
  return {
    retained: pages.reduce((sum, page) => sum + page.retained, 0),
    operators: pages.reduce((sum, page) => sum + page.operators, 0),
    pages
  }
}

function Harness() {
  const pdf = useRef(null)
  const events = useRef([])
  const visible = useRef(0)
  const [document, setDocument] = useState(null)
  const [open, setOpen] = useState(true)
  const previews = usePdfPreviews(
    document,
    open,
    () => pdf.current?.isRendering() ?? true,
    (owner, page) => {
      const before = cacheStats(page)
      pdf.current.releasePreviewPage(owner, page)
      events.current.push({
        pageNumber: page.pageNumber,
        before,
        after: cacheStats(page)
      })
    }
  )
  window.pdfResourceTest = {
    document,
    events: events.current,
    images: [...previews.images.keys()],
    show: (page) => {
      if (visible.current) previews.onVisibility(visible.current, false)
      visible.current = page
      previews.onVisibility(page, true)
    },
    close: () => setOpen(false),
    snapshot: () => snapshot(document),
    baseline: async () => {
      const baseline = await getDocument({ data: source.data.slice() }).promise
      try {
        for (let number = 1; number <= baseline.numPages; number++) {
          const page = await baseline.getPage(number)
          const viewport = page.getViewport({ scale: 0.4 })
          const canvas = globalThis.document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ canvas, viewport, annotationMode: 0 }).promise
          canvas.width = canvas.height = 0
        }
        return await snapshot(baseline)
      } finally {
        await baseline.destroy()
      }
    }
  }
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PdfDocumentViewer
        ref={pdf}
        source={source}
        onDocumentReady={setDocument}
      />
    </div>
  )
}
createRoot(document.getElementById('root')).render(<Harness />)
