import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Reader } from '../../src/index'
import '../../src/styles/index.scss'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

function pdfBytes() {
  const stream = 'BT /F1 12 Tf 10 780 Td (Inset probe page) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let result = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(result.length)
    result += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = result.length
  result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      ''
    )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(result)
}

const bytes = pdfBytes()

function Harness() {
  const [top, setTop] = useState(44)
  return (
    <div style={{ width: 480, height: 800, position: 'relative' }}>
      <button id='zero' type='button' onClick={() => setTop(0)}>
        zero
      </button>
      <button id='forty-four' type='button' onClick={() => setTop(44)}>
        44
      </button>
      <div style={{ position: 'absolute', inset: '40px 0 0', display: 'flex' }}>
        <Reader
          engineSource={{ format: 'pdf', data: bytes, workerSrc: workerUrl }}
          renderMode='layout'
          isPdf
          containMarginTop={top}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
