import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Reader } from '../src/components/Reader'
import { PdfDocumentSession } from '../src/pdf/pdfDocumentSession'
import { createPdfTextModeDocument } from '../src/pdf/pdfTextModeDocument'
import { configurePdfJsWorker } from '../src/pdf/pdfjsRuntime'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import '../src/styles/index.scss'

configurePdfJsWorker(workerSrc)
const bytes = new Uint8Array(await (await fetch('/crop.pdf')).arrayBuffer())
const session = await PdfDocumentSession.open({ data: bytes })
const text = await createPdfTextModeDocument(session.document, 'edge-crop')
const source = { format: 'pdf', data: bytes, workerSrc }

function Harness() {
  const [data, setData] = useState({})
  const [editing, setEditing] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const selection = useRef(null)
  window.pdfCropTest = { data, setData, setEditing, setBrowserOpen, selection }
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Reader
        document={text.document}
        engineSource={source}
        isPdf
        data={data}
        onDataChange={setData}
        showPageBrowser={browserOpen}
        onPageBrowserClose={() => setBrowserOpen(false)}
        onSelect={(range) =>
          setData((current) => ({
            ...current,
            ranges: [...(current.ranges ?? []), range]
          }))
        }
        edgeCropEditing={editing}
        onEdgeCropEditingChange={setEditing}
        onEdgeCropApply={(number, crop) => {
          setData((current) => ({
            ...current,
            edgeCrop:
              number === null
                ? { all: crop }
                : {
                    ...current.edgeCrop,
                    pages: {
                      ...current.edgeCrop?.pages,
                      [`page-${number}`]: crop
                    }
                  }
          }))
          setEditing(false)
        }}
        selectionRef={selection}
      />
    </div>
  )
}
createRoot(document.getElementById('root')).render(<Harness />)
