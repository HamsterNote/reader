import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ReaderSurface } from './ReaderSurface'
import { createWebBridgeClient } from './bridgeClient'
import { listenHostMessages } from './hostMessageChannel'
import { readPackagedAsset } from './packagedAsset'
import { createPdfWorkerFromAsset } from './pdfWorker'
import { packagedPdfOptions } from './pdfAssets'
import { GlobalWorkerOptions } from '../../src/pdf/pdfjsRuntime'
import { openReaderDocument } from '../../src/host/openReaderDocument'
import { restoreReaderSnapshot } from '../../src/host/readerSnapshot'
import type {
  BridgeOpenPayload,
  BridgeRestorePayload
} from '../../src/bridge/protocol'
import type { ReaderEngineSource } from '../../src/types/engineSource'
import '../../src/styles/index.scss'
import './reader.css'

const rootElement = document.getElementById('reader')
if (!rootElement) throw new Error('Missing reader root')
const root = createRoot(rootElement)
const host = window.__READER_HOST__
const post = window.ReactNativeWebView?.postMessage
let generation = 0
let descriptor: BridgeOpenPayload | null = null
let snapshot: BridgeRestorePayload | null = null
let opened: Awaited<ReturnType<typeof openReaderDocument>> | null = null
let worker: Worker | null = null
let work: Promise<void> = Promise.resolve()

async function release() {
  flushSync(() => root.render(null))
  const previous = opened
  const previousWorker = worker
  opened = null
  worker = null
  try {
    await previous?.dispose()
  } finally {
    previousWorker?.terminate()
    if (GlobalWorkerOptions.workerPort === previousWorker)
      GlobalWorkerOptions.workerPort = null
  }
}

async function display(
  token: number,
  document: BridgeOpenPayload['document'],
  restored: BridgeRestorePayload
) {
  try {
    await release()
    if (token !== generation) return
    // Native stages exactly this publication beside the packaged entry, within WKWebView's read root.
    const data = new Uint8Array(await readPackagedAsset(document.fileUrl))
    if (token !== generation) return
    if (document.format === 'pdf') {
      const nextWorker = await createPdfWorkerFromAsset()
      if (token !== generation) {
        nextWorker.terminate()
        return
      }
      worker = nextWorker
      GlobalWorkerOptions.workerPort = nextWorker
    }
    const source: ReaderEngineSource = {
      format: document.format,
      data,
      documentOptions: packagedPdfOptions
    }
    const documentHandle = await openReaderDocument(source, document.fileId)
    opened = documentHandle
    if (token !== generation) {
      await release()
      return
    }
    root.render(
      <ReaderSurface
        key={`${document.fileId}:${token}`}
        source={source}
        document={documentHandle.document}
        initial={restoreReaderSnapshot(restored.data, restored.progress)}
        onChange={(data) => {
          if (token === generation) bridge?.sendChange(data)
        }}
      />
    )
  } catch (error) {
    await release().catch(() => undefined)
    if (token !== generation) return
    root.render(
      <div role='alert'>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        <button type='button' onClick={scheduleDisplay}>
          重试
        </button>
      </div>
    )
  }
}

function scheduleDisplay() {
  if (!descriptor || !snapshot) return
  const token = ++generation
  const document = descriptor.document
  const restored = snapshot
  // Serialize open/dispose: pdf.js workers must outlive every session using them.
  work = work.then(() => display(token, document, restored))
}

const bridge =
  host && post
    ? createWebBridgeClient({
        sessionId: host.sessionId,
        sourceToken: host.sourceToken,
        post: (raw) => post(raw),
        onOpen: (payload) => {
          descriptor = payload
          snapshot = null
        },
        onRestore: (payload) => {
          snapshot = payload
          scheduleDisplay()
        },
        onDispose: () => {
          generation++
          work = work.then(release).catch(() => undefined)
        },
        onError: (error) => {
          if (error.code !== 'REVISION_MISMATCH')
            root.render(<div role='alert'>{error.message}</div>)
        }
      })
    : null
if (bridge) {
  listenHostMessages((message) => bridge.handleMessage(message))
  bridge.start()
} else root.render(<div role='alert'>未连接阅读宿主</div>)
