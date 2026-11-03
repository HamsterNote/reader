import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { EditorDocument } from '@hamster-note/painting/core'
import {
  PdfDocumentViewer,
  type PdfDocumentViewerRef
} from '../../src/pdf/PdfDocumentViewer'
import '../../src/styles/index.scss'

const source = { url: '/test/compat/fixtures/pdf/two-column.pdf' }

function PaintingFixture() {
  const ref = useRef<PdfDocumentViewerRef>(null)
  const [paintings, setPaintings] = useState<Record<string, EditorDocument>>({})
  const [scale, setScale] = useState(1)
  const [drawing, setDrawing] = useState(true)
  const [mount, setMount] = useState(0)
  return (
    <>
      <nav style={{ height: 40 }}>
        {[0.5, 1, 2].map((value) => (
          <button key={value} onClick={() => setScale(value)}>
            scale {value}
          </button>
        ))}
        <button onClick={() => setDrawing((value) => !value)}>
          toggle input
        </button>
        <button onClick={() => setMount((value) => value + 1)}>remount</button>
        <button onClick={() => ref.current?.scrollToPage(2)}>page 2</button>
      </nav>
      <div style={{ position: 'relative', height: 500, width: 900 }}>
        <PdfDocumentViewer
          key={mount}
          ref={ref}
          source={source}
          workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'
          scale={scale}
          tool={drawing ? 'drawing' : 'text-selection'}
          drawingStrokeColor='#d02080'
          pagePaintings={paintings}
          onPagePaintingsChange={setPaintings}
        />
      </div>
      <output id='paintings' style={{ display: 'none' }}>
        {JSON.stringify(paintings)}
      </output>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<PaintingFixture />)
