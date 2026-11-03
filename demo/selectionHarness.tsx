// Browser acceptance fixture; deliberately exercises Reader's public API.
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Reader } from '../src/components/Reader'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../src/types/selection'
import type { ReaderEngineSource } from '../src/types/engineSource'
import '@hamster-note/reader/style.css'

const documentModel = {
  id: 'selection-fixture',
  title: 'Selection',
  pages: [
    { id: 'page-1', number: 1, width: 600, height: 800, texts: [], images: [] }
  ]
}
function Harness() {
  const [source, setSource] = useState<ReaderEngineSource>()
  const [ranges, setRanges] = useState<ReaderSelectionRange[]>([])
  const [initialRanges, setInitialRanges] = useState<ReaderSelectionRange[]>([])
  const [fontScale, setFontScale] = useState<1 | 1.5>(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [events, setEvents] = useState<unknown[]>([])
  const selection = useRef<ReaderSelectionRef>(null)
  const controlled = !new URLSearchParams(location.search).has('uncontrolled')
  const record = (type: string, range: ReaderSelectionRange) => {
    setEvents((items) => [...items, { type, range }])
  }
  return (
    <>
      <input
        aria-label='Book'
        type='file'
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) return
          setSource({
            format: file.name.endsWith('.pdf') ? 'pdf' : 'epub',
            data: new Uint8Array(await file.arrayBuffer()),
            workerSrc: '/pdfjs-worker/pdf.worker.min.mjs'
          })
          const restored: ReaderSelectionRange[] = JSON.parse(
            sessionStorage.getItem('selection-harness:ranges') ?? '[]'
          )
          setRanges(restored)
          setInitialRanges(restored)
          setSelected(null)
          setEvents([])
        }}
      />
      <button onClick={() => setFontScale((value) => (value === 1 ? 1.5 : 1))}>
        Font
      </button>
      <button onClick={() => selection.current?.undo()}>Undo</button>
      <button onClick={() => selection.current?.redo()}>Redo</button>
      <output id='snapshot'>
        {JSON.stringify({ ranges, selected, events })}
      </output>
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 13,
          right: 13,
          bottom: 12
        }}
      >
        <Reader
          document={documentModel}
          engineSource={source}
          selectedTool='text-selection'
          selectionRef={selection}
          bottomBar={null}
          fontScale={fontScale}
          defaultRanges={initialRanges}
          ranges={controlled ? ranges : undefined}
          selectedRangeId={controlled ? selected : undefined}
          onSelectRange={setSelected}
          onSelect={(range) => record('add', range)}
          onUpdateRange={(range) => record('update', range)}
          onRemoveRange={(id) => {
            setEvents((items) => [...items, { type: 'delete', id }])
            setRanges((items) => items.filter((item) => item.id !== id))
            setSelected(null)
          }}
          annotationHistory={{
            enabled: true,
            resetKey: source?.data.byteLength
          }}
          onAnnotationHistoryChange={(value) => {
            setRanges(value.ranges)
            if (controlled) setSelected(value.selectedRangeId)
          }}
        />
      </div>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Harness />)
