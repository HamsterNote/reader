import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IntermediateDocumentTextViewer } from '../../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import type { ReaderLinkedSelectionData } from '../../src/types/selection'
import { crossPageDocument, crossPageRange } from '../fixtures/pdf-cross-page'
import '../../src/styles/index.scss'

const params = new URLSearchParams(location.search)
const spaced = params.has('spaced')
const controlled = params.has('controlled')
const source = crossPageDocument(spaced)
const saved = crossPageRange(spaced)
const progress = { currentPageNumber: 2 }
const snapshots: ReaderLinkedSelectionData[] = []
Object.assign(window, { crossPageSnapshots: snapshots })
function Host() {
  const [ranges, setRanges] = useState([saved])
  return (
    <div style={{ height: '100vh' }}>
      <IntermediateDocumentTextViewer
        document={source}
        isPdf
        textReadingProgress={progress}
        {...(controlled ? { ranges } : { defaultRanges: [saved] })}
        defaultSelectedRangeId={saved.id}
        onLinkedDataChange={(next) => {
          snapshots.push(next)
          if (controlled) setRanges(next.items)
        }}
      />
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Host />)
