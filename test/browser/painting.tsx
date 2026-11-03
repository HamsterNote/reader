import { Reader } from '../../src/components/Reader'
import type { ReaderData } from '../../src/types/readerData'
import type { ReaderSelectionRef } from '../../src/types/selection'
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

const historyFormat = new URLSearchParams(location.search).get('history')
const fixtureUrl =
  historyFormat === 'pdf'
    ? '/test/compat/fixtures/pdf/two-column.pdf'
    : '/test/compat/fixtures/epub/duplicate-text.epub'
const engineData =
  historyFormat === 'pdf' || historyFormat === 'epub'
    ? new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer())
    : null
const historyDocument = {
  id: 'history-fixture',
  title: 'History fixture',
  pages: [1, 2].map((number) => ({
    id: `page-${number}`,
    number,
    width: 600,
    height: 800,
    texts: []
  }))
}
const historySource = engineData
  ? {
      format: historyFormat as 'pdf' | 'epub',
      data: engineData,
      workerSrc: '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'
    }
  : undefined
function ReaderHistoryFixture() {
  const selection = useRef<ReaderSelectionRef>(null)
  const [data, setData] = useState<ReaderData>({
    ranges: [],
    rects: [
      {
        id: 'navigation',
        createdAt: 0,
        selectionId: 'page-1',
        overlayRectType: 'percent',
        start: { x: 1, y: 1 },
        end: { x: 1, y: 1 },
        rect: { x: 1, y: 1, width: 0, height: 0 }
      }
    ],
    pagePaintings: {}
  })
  const [hidden, setHidden] = useState(false)
  const [commits, setCommits] = useState(0)
  return (
    <>
      <style>{`.history-reader { width: 100%; height: 100%; }`}</style>
      <nav>
        <button onClick={() => setHidden((value) => !value)}>
          hide first page
        </button>
        <button onClick={() => selection.current?.undo()}>ref undo</button>
        <button onClick={() => selection.current?.scrollToRect('navigation')}>
          page one
        </button>
      </nav>
      <div style={{ position: 'relative', width: 900, height: 650 }}>
        <Reader
          className='history-reader'
          document={historyDocument}
          engineSource={historySource}
          data={{ ...data, hiddenPages: hidden ? [1] : [] }}
          selectionRef={selection}
          annotationHistory
          selectedTool='drawing'
          useVirtualPaper={false}
          onPagePaintingsChange={(pagePaintings) => {
            setData((current) => ({ ...current, pagePaintings }))
            setCommits((n) => n + 1)
          }}
          onAnnotationHistoryChange={(next, detail) => {
            if (detail.source === 'drawing' || detail.source === 'reset') return
            setData((current) => ({
              ...current,
              ranges: next.ranges,
              rects: next.rects,
              pagePaintings: next.pagePaintings ?? current.pagePaintings
            }))
          }}
        />
      </div>
      <output id='history-paintings' style={{ display: 'none' }}>
        {JSON.stringify(data.pagePaintings)}
      </output>
      <output id='history-saves' style={{ display: 'none' }}>
        {commits}
      </output>
    </>
  )
}
createRoot(document.getElementById('root')!).render(
  historyFormat ? <ReaderHistoryFixture /> : <PaintingFixture />
)
