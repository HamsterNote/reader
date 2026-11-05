import { createRef, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { IntermediatePage, TextDir } from '@hamster-note/types'
import { Reader } from '../../src/components/Reader'
import { openReaderDocument } from '../../src/host/openReaderDocument'
import { configurePdfJsWorker } from '../../src/pdf/pdfjsRuntime'
import { pdfCaretAtPoint } from '../../src/pdf/pdfTouchSelection'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../../src/types/selection'
import type { ReaderSelectedTextSegment } from '../../src/components/selection/selectionPayloadSerializer'
import '../../src/styles/index.scss'

configurePdfJsWorker(`${location.origin}/pdfjs-worker/pdf.worker.min.mjs`)
const root = createRoot(document.getElementById('root')!)
const selection = createRef<ReaderSelectionRef>()
type Props = ComponentProps<typeof Reader>
let props: Props
let dispose = async () => {}
const state = {
  ranges: [] as ReaderSelectionRange[],
  selectionTexts: [] as string[],
  updates: 0,
  ocrPages: [] as number[],
  images: [] as string[],
  segments: [] as string[],
  sourceSegments: [] as ReaderSelectedTextSegment[],
  positions: [] as number[],
  errors: [] as string[]
}
function render() {
  flushSync(() =>
    root.render(
      <div style={{ height: '100vh' }}>
        <Reader {...props} />
      </div>
    )
  )
}
const api = {
  state,
  selection,
  get document() {
    return props.document
  },
  async open(format: 'pdf' | 'epub', bytes: number[], initial: Props = {}) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    flushSync(() => root.render(null))
    await dispose()
    state.ranges = []
    state.selectionTexts = []
    state.updates = 0
    state.ocrPages = []
    state.images = []
    state.segments = []
    state.sourceSegments = []
    state.positions = []
    state.errors = []
    const source = { format, data: new Uint8Array(bytes) }
    const opened = await openReaderDocument(source, `review-${format}`)
    dispose = opened.dispose
    props = {
      document: opened.document,
      engineSource: source,
      renderMode: 'layout',
      useVirtualPaper: false,
      selectionRef: selection,
      onHighlight: (range) => state.ranges.push(range),
      onTextSelectionChange: (_text, detail) =>
        state.selectionTexts.push(detail.selectedText),
      onUpdateRange: (range) => {
        state.updates++
        state.ranges = state.ranges.map((item) =>
          item.id === range.id ? range : item
        )
      },
      onDataChange: (data) => {
        if (data.layoutReadingProgress)
          state.positions.push(data.layoutReadingProgress.pageNumber)
      },
      onSelectText: (_selection, segments) => {
        state.segments = segments.map((segment) => segment.selectedText)
        state.sourceSegments = segments
      },
      onOcrTextsChange: (page) => state.ocrPages.push(page),
      onOcrError: (error) => state.errors.push(String(error)),
      extraOCR: async (image) => {
        state.images.push(image)
        return IntermediatePage.parse({
          id: 'scan',
          number: 1,
          width: 400,
          height: 300,
          texts: [
            {
              id: 'word',
              content: 'Scanned text',
              fontSize: 20,
              fontFamily: 'sans-serif',
              fontWeight: 400,
              italic: false,
              color: '#000000',
              polygon: [
                [20, 20],
                [140, 20],
                [140, 40],
                [20, 40]
              ],
              lineHeight: 20,
              ascent: 16,
              descent: 4,
              dir: TextDir.LTR,
              skew: 0,
              isEOL: false
            }
          ]
        })
      },
      ...initial
    }
    render()
  },
  pdfCaretTextAtPoint(x: number, y: number, nearest = false) {
    const viewer = document.querySelector<HTMLElement>(
      '.hamster-reader__pdf-viewer-container'
    )
    if (!viewer) return null
    return (
      pdfCaretAtPoint(viewer, x, y, nearest)?.startContainer.textContent ?? null
    )
  },
  update(next: Props) {
    props = { ...props, ...next }
    render()
  }
}
declare global {
  interface Window {
    readerRegression: typeof api
  }
}
window.readerRegression = api
