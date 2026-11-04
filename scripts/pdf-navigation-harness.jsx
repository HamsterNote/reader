import { useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Reader } from '../src/components/Reader'
import { PdfDocumentSession } from '../src/pdf/pdfDocumentSession'
import { createPdfTextModeDocument } from '../src/pdf/pdfTextModeDocument'
import { configurePdfJsWorker } from '../src/pdf/pdfjsRuntime'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import '../src/styles/index.scss'

configurePdfJsWorker(workerSrc)
const bytes = new Uint8Array(
  await (
    await fetch(
      new URL(location.href).searchParams.get('fixture') ?? '/navigation.pdf'
    )
  ).arrayBuffer()
)
const session = await PdfDocumentSession.open({ data: bytes })
const text = await createPdfTextModeDocument(session.document, 'navigation')
const source = { format: 'pdf', data: bytes, workerSrc }

function Harness() {
  const [data, setData] = useState({ bookmarks: [], ranges: [] })
  const [open, setOpen] = useState(false)
  const [inset, setInset] = useState(36)
  const selection = useRef(null)
  window.pdfNavigationTest = {
    data,
    setData,
    setInset,
    selection: selection.current
  }
  return (
    <>
      <div style={{ height: 40, display: 'flex', gap: 12 }}>
        <button type='button' onClick={() => setOpen(!open)}>
          页面浏览
        </button>
        <button type='button' onClick={() => setInset(inset ? 0 : 36)}>
          安全区
        </button>
        <button
          type='button'
          onClick={() =>
            setData((current) => ({
              ...current,
              renderMode: current.renderMode === 'text' ? 'layout' : 'text'
            }))
          }
        >
          外部模式切换
        </button>
      </div>
      <div style={{ position: 'absolute', inset: '40px 0 0' }}>
        <Reader
          document={text.document}
          engineSource={source}
          isPdf
          data={data}
          onDataChange={setData}
          showPageBrowser={open}
          onPageBrowserClose={() => setOpen(false)}
          selectionRef={selection}
          containMarginTop={inset}
          containMarginBottom={20}
          onSelect={(range) =>
            setData((current) => ({
              ...current,
              ranges: [...current.ranges, range]
            }))
          }
        />
      </div>
    </>
  )
}
createRoot(document.getElementById('root')).render(<Harness />)
