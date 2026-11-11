import {
  Reader,
  type ReaderData,
  type ReaderProgressHandle
} from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import { TextDir } from '@hamster-note/types'
import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'

const root = createRoot(document.getElementById('root')!)
const progress = createRef<ReaderProgressHandle>()
const state = {
  ready: [] as string[],
  errors: [] as string[],
  data: undefined as ReaderData | undefined
}
function open(kind: 'txt' | 'epub', long = false, layout?: 'native' | 'paper') {
  flushSync(() => root.render(null))
  state.data = undefined
  const document = {
    id: kind,
    title: kind,
    pages: [1, 2].map((number) => ({
      id: `page-${number}`,
      number,
      width: 400,
      height: layout ? 1200 : 600,
      texts: [
        {
          id: `text-${number}`,
          content:
            `${kind} restored page ${number}` +
            (long
              ? '. Long content for a scrollable target. '.repeat(120)
              : ''),
          fontSize: 18,
          fontFamily: 'sans-serif',
          fontWeight: 400,
          italic: false,
          color: '#111111',
          polygon: [
            [0, 0],
            [350, 0],
            [350, 30],
            [0, 30]
          ] as [
            [number, number],
            [number, number],
            [number, number],
            [number, number]
          ],
          lineHeight: 22,
          ascent: 18,
          descent: 4,
          dir: TextDir.LTR,
          skew: 0,
          isEOL: true
        }
      ]
    }))
  }
  let data: ReaderData = { textReadingProgress: { currentPageNumber: 2 } }
  if (layout === 'paper') {
    data = {
      virtualPaper: {
        x: 0,
        y: -980,
        scale: 0.8,
        anchor: {
          pageNumber: 2,
          textId: 'text-2',
          text: 'txt restored page 2',
          offset: 0
        }
      }
    }
  } else if (layout) {
    data = { layoutReadingProgress: { pageNumber: 2, verticalPercentage: 0 } }
  }
  flushSync(() =>
    root.render(
      <div style={{ height: '100vh' }}>
        <Reader
          document={document}
          renderMode={layout ? 'layout' : 'text'}
          useVirtualPaper={layout === 'paper'}
          isEpub={kind === 'epub'}
          isPdf={!!layout}
          data={data}
          progressRef={progress}
          onEngineReady={() => state.ready.push(kind)}
          onEngineError={(error) => state.errors.push(error.message)}
          onDataChange={(data) => {
            state.data = data
          }}
        />
      </div>
    )
  )
}
Object.assign(window, {
  flowTextTest: {
    state,
    open,
    flush: async () => {
      await progress.current!.flush()
      state.data = progress.current!.getData()
    }
  }
})
