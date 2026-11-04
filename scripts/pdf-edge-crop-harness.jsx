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
  const [insets, setInsets] = useState({ top: 0, bottom: 0 })
  const selection = useRef(null)
  window.pdfCropTest = {
    data,
    setData,
    setEditing,
    setBrowserOpen,
    selection,
    insets,
    setInsets
  }
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <label style={{ position: 'fixed', top: 4, right: 4, zIndex: 100 }}>
        <input
          type='checkbox'
          data-testid='global-edge-crop-toggle'
          checked={!!data.edgeCrop?.all}
          onChange={(event) => {
            const all = event.currentTarget.checked
              ? { top: 0.1, right: 0.2, bottom: 0.15, left: 0.05 }
              : undefined
            setData((current) => ({
              ...current,
              edgeCrop: { ...current.edgeCrop, all }
            }))
          }}
        />
        全局裁边
      </label>
      {['top', 'bottom'].map((edge, index) => (
        <input
          key={edge}
          type='number'
          aria-label={`${edge} inset`}
          data-testid={`crop-margin-${edge}`}
          value={insets[edge]}
          onChange={(event) =>
            setInsets((current) => ({
              ...current,
              [edge]: Number(event.target.value)
            }))
          }
          style={{
            position: 'fixed',
            top: 28 + index * 24,
            right: 4,
            width: 64,
            zIndex: 100
          }}
        />
      ))}
      <Reader
        document={text.document}
        engineSource={source}
        isPdf
        data={data}
        onDataChange={setData}
        containMarginTop={insets.top}
        containMarginBottom={insets.bottom}
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
