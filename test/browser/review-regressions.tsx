import { createRef, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { IntermediatePage, TextDir } from '@hamster-note/types'
import { Reader } from '../../src/components/Reader'
import { openReaderDocument } from '../../src/host/openReaderDocument'
import { configurePdfJsWorker } from '../../src/pdf/pdfjsRuntime'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../../src/types/selection'
import '../../src/styles/index.scss'

configurePdfJsWorker(`${location.origin}/pdfjs-worker/pdf.worker.min.mjs`)
const root = createRoot(document.getElementById('root')!)
const selection = createRef<ReaderSelectionRef>()
type Props = ComponentProps<typeof Reader>
let props: Props
let dispose = async () => {}
const state = {
  ranges: [] as ReaderSelectionRange[],
  ocrPages: [] as number[],
  images: [] as string[],
  segments: [] as string[],
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
  async open(format: 'pdf' | 'epub', bytes: number[], initial: Props = {}) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    flushSync(() => root.render(null))
    await dispose()
    state.ranges = []
    state.ocrPages = []
    state.images = []
    state.segments = []
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
      onSelectText: (_selection, segments) => {
        state.segments = segments.map((segment) => segment.selectedText)
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
