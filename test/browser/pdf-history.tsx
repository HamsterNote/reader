import { createRoot } from 'react-dom/client'
import { ReaderSurface } from '../../webview/src/ReaderSurface'
import { prepareReaderDocument } from '../../src/host/openReaderDocument'
import { configurePdfJsWorker } from '../../src/pdf/pdfjsRuntime'
import '../../src/styles/index.scss'

configurePdfJsWorker(`${location.origin}/pdfjs-worker/pdf.worker.min.mjs`)

const fixture = (await (
  await fetch('/test/compat/fixtures/highlights/pdf-two-column.v4.json')
).json()) as {
  ranges: Record<string, unknown>[]
  rects: Record<string, unknown>[]
}

const bytes = new Uint8Array(
  await (await fetch('/test/compat/fixtures/pdf/two-column.pdf')).arrayBuffer()
)
const source = { format: 'pdf' as const, data: bytes }
const prepared = await prepareReaderDocument(source, 'pdf-history')

const probe = {
  changes: [] as unknown[],
  last: {
    annotations: {
      version: 5,
      ranges: fixture.ranges,
      rects: fixture.rects,
      paintings: {}
    }
  } as unknown,
  errors: [] as string[]
}
Object.defineProperty(window, '__pdfHistory', { value: probe })

createRoot(document.getElementById('root')!).render(
  <div style={{ position: 'fixed', inset: 0, height: '100%' }}>
    <ReaderSurface
      source={prepared.source}
      document={prepared.document}
      initial={{
        data: {
          ranges: fixture.ranges as never,
          rects: fixture.rects as never,
          pagePaintings: {},
          ...(new URLSearchParams(location.search).get('mode') === 'text'
            ? { renderMode: 'text' as const }
            : {})
        },
        comments: [],
        extra: {},
        migrated: false
      }}
      onChange={(data) => {
        probe.last = data
        probe.changes.push(data)
      }}
    />
  </div>
)

window.addEventListener('error', (event) => {
  probe.errors.push(String(event.message))
})
window.addEventListener('unhandledrejection', (event) => {
  probe.errors.push(String(event.reason))
})
