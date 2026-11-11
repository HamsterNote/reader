// Exercise the built public artifact, rather than private component imports.
import {
  ReaderFileSession,
  ReaderFileResourcePool,
  ReaderFileWorkspace,
  createReaderByteFileAdapter,
  type ReaderData,
  type ToolbarFile,
  type PaneToolbarLayout
} from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'

const files: ToolbarFile[] = [
  {
    key: 'a',
    storageId: 'local',
    path: '/A.pdf',
    displayName: 'A.pdf',
    resolvedFormat: 'pdf'
  },
  {
    key: 'b',
    storageId: 'local',
    path: '/B.epub',
    displayName: 'B.epub',
    resolvedFormat: 'epub'
  },
  {
    key: 'hnn',
    storageId: 'local',
    path: '/C.hnn',
    displayName: 'C.hnn',
    resolvedFormat: 'hnn'
  },
  {
    key: 'hpb',
    storageId: 'local',
    path: '/D.hpb',
    displayName: 'D.hpb',
    resolvedFormat: 'hpb'
  },
  {
    key: 'broken',
    storageId: 'local',
    path: '/bad.pdf',
    displayName: 'bad.pdf',
    resolvedFormat: 'pdf'
  }
]
const persisted = new Map<string, ReaderData>([
  ['a', { layoutReadingProgress: { pageNumber: 8, verticalPercentage: 45 } }],
  [
    'b',
    {
      layoutReadingProgress: {
        pageNumber: 3,
        textId: 'page-3-text',
        text: '第二章开头完全不同。',
        offset: 3
      }
    }
  ]
])
if (new URLSearchParams(location.search).has('text')) {
  persisted.set('a', {
    renderMode: 'text',
    textReadingProgress: { currentPageNumber: 8, verticalPercentage: 60 }
  })
}
const log: unknown[] = []
const config = { failSave: false, failLoad: false }
let engineMounts = 0,
  engineDisposals = 0
const pool = new ReaderFileResourcePool(2)
const countDisposal = () => {
  engineDisposals++
}
const makeSession = (paneId: string) =>
  new ReaderFileSession({
    paneId,
    pool,
    isActivePane: () => paneId === 'left',
    files: () => files,
    adapters: (['pdf', 'epub'] as const).map((format) =>
      createReaderByteFileAdapter({
        format,
        workerSrc: '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
        read: async (file) => {
          log.push(['load', file.key])
          if (file.key === 'broken' || config.failLoad)
            throw new Error('Injected load failure')
          return new Uint8Array(
            await (
              await fetch(
                format === 'pdf'
                  ? '/test/browser/eight-pages.pdf'
                  : '/test/compat/fixtures/epub/duplicate-text.epub'
              )
            ).arrayBuffer()
          )
        },
        props: async (file) => ({
          data:
            paneId === 'right' && file.key === 'a'
              ? {
                  layoutReadingProgress: {
                    pageNumber: 3,
                    verticalPercentage: 15
                  }
                }
              : persisted.get(file.key),
          fontScale: 1.5,
          onDataChange: (data) => {
            log.push(['change', file.key, data.layoutReadingProgress])
          },
          onEngineReady: () => {
            engineMounts++
            log.push(['ready', file.key])
          },
          onEngineDisposal: (completion) => {
            completion.then(countDisposal)
          }
        })
      })
    ),
    host: {
      supports: (format) => ['hnn', 'hpb'].includes(format),
      save: async (request) => {
        log.push(['save', request.file.key])
        if (config.failSave) throw new Error('Injected save NACK')
        if (request.data && request.persistPosition)
          persisted.set(request.file.key, request.data)
      },
      handover: async (request) => {
        log.push(['handover', request.file.key, request.paneId])
        await request.release()
        return { status: 'success' }
      },
      commit: async (request) => {
        log.push(['commit', request.file.key])
      },
      reload: async (request) => {
        log.push(['reload', request.file.key])
        return {
          status: 'failed',
          message: 'Host reload injected failure; retry available'
        }
      }
    }
  })
const session = makeSession('left')
const second = makeSession('right')
const zero = { top: 0, bottom: 0, left: 0, right: 0 }
function Fixture() {
  const [dual, setDual] = useState(false)
  const [layout, setLayout] = useState<PaneToolbarLayout>({
    edge: 'bottom',
    insets: zero,
    headerContentInset: 0
  })
  Object.assign(window, {
    workspaceTest: {
      session,
      second,
      openSecond: async () => {
        setDual(true)
        return second.open('a')
      },
      activeDocuments: () => pool.activeDocuments,
      log,
      config,
      setLayout,
      persisted,
      stats: () => ({ engineMounts, engineDisposals }),
      select: (key: string) => session.open(key),
      snapshot: () => session.getSnapshot()
    }
  })
  return (
    <>
      <div
        id='pane'
        style={{
          position: 'relative',
          height: '100vh',
          width: dual ? '50vw' : '100vw',
          maxWidth: 800
        }}
      >
        <ReaderFileWorkspace session={session} layout={layout} />
      </div>
      {dual && (
        <div
          id='second-pane'
          style={{
            position: 'absolute',
            left: '50vw',
            top: 0,
            height: '100vh',
            width: '50vw'
          }}
        >
          <ReaderFileWorkspace
            session={second}
            layout={{
              edge: 'bottom',
              insets: { ...zero, bottom: 34 },
              headerContentInset: 0
            }}
          />
        </div>
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
setTimeout(() => {
  session.open('a').catch(() => undefined)
}, 0)
