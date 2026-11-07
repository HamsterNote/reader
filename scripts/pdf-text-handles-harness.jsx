import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IntermediateDocumentTextViewer } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import '../src/styles/index.scss'

// PDF extraction order deliberately differs from reading order. The last
// visual line occurs before the highlighted lines in the source stream.
const lines = [
  ['prefix', '7、30个领域的入门书，每一个领域都有适合初学者阅读的经典作品', 0],
  ['after', '关注微信公众号，即可查看对应书单', 200],
  ['start', '8、这20本书，是各领域的巅峰之作', 50],
  ['middle', '9、这7本书，教你如何高效读书', 100],
  ['end', '10、80万书虫力荐的30本书', 150]
]
let offset = 0
const offsets = {}
const texts = lines.map(([id, content, y]) => {
  offsets[id] = offset
  offset += content.length
  return {
    id,
    content,
    fontSize: 16,
    fontFamily: 'sans-serif',
    fontWeight: 400,
    color: '#111',
    lineHeight: 24,
    ascent: 16,
    descent: 4,
    dir: 'ltr',
    skew: 0,
    isEOL: true,
    polygon: [
      [0, y],
      [content.length * 16, y],
      [content.length * 16, y + 24],
      [0, y + 24]
    ]
  }
})
const fixture = {
  id: 'pdf-text-handles',
  title: 'PDF reflow selection',
  pageCount: 1,
  pageNumbers: [1],
  getPageSizeByPageNumber: () => ({ x: 500, y: 700 }),
  getPageByPageNumber: async () => ({ getContent: async () => texts })
}
const saved = {
  id: 'saved',
  text: texts
    .slice(2)
    .map((text) => text.content)
    .join(''),
  start: { selectionId: 'page-1', offset: offsets.start },
  end: { selectionId: 'page-1', offset: offsets.end + texts[4].content.length },
  createdAt: 1,
  overlayRectType: 'percent',
  rectsBySelectionId: {},
  markerStyle: { backgroundColor: 'rgba(255,193,7,0.35)' }
}

function Harness() {
  const [fontScale, setFontScale] = useState(1.5)
  const [overlayRectType, setOverlayRectType] = useState('percent')
  const [ranges, setRanges] = useState([saved])
  const [selectedRangeId, setSelectedRangeId] = useState('saved')
  const [generation, setGeneration] = useState(0)
  const selection = useRef(null)
  window.pdfTextHandles = {
    ranges,
    selectedRangeId,
    fontScale,
    setFontScale,
    setOverlayRectType,
    setSelectedRangeId,
    selection: selection.current,
    reopen: () => {
      setSelectedRangeId('saved')
      setGeneration((value) => value + 1)
    },
    draft: () => {
      setRanges([])
      setSelectedRangeId(null)
    }
  }
  return (
    <div
      className='hamster-reader'
      style={{ position: 'absolute', inset: '30px 0' }}
    >
      <IntermediateDocumentTextViewer
        key={generation}
        document={fixture}
        isPdf
        fontScale={fontScale}
        ranges={ranges}
        selectedRangeId={selectedRangeId}
        onSelectRange={setSelectedRangeId}
        overlayRectType={overlayRectType}
        selectionRef={selection}
        showSelectionMagnifier
        onSelect={(range) => setRanges((current) => [...current, range])}
        onUpdateRange={(range) =>
          setRanges((current) =>
            current.map((item) => (item.id === range.id ? range : item))
          )
        }
      />
    </div>
  )
}
createRoot(document.getElementById('root')).render(<Harness />)
