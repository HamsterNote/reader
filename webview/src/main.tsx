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
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot,
  type ReaderSnapshot
} from '../../src/host/readerSnapshot'
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
// 关闭前等待未确认写入的时间上限；超时仍释放，但不声称已保存。
const FLUSH_PENDING_TIMEOUT_MS = 2000
const CLOSING_SHIELD_ID = 'reader-closing-shield'

/**
 * 关闭冲刷期间冻结输入：盖一层透明遮罩，阻止新的手势/点击。
 * 冻结前已经开始的手势仍会提交，其写入继续入队并被 ack 屏障覆盖。
 */
function setClosingShield(active: boolean): void {
  const existing = document.getElementById(CLOSING_SHIELD_ID)
  if (!active) {
    existing?.remove()
    return
  }
  if (existing !== null) return
  const shield = document.createElement('div')
  shield.id = CLOSING_SHIELD_ID
  shield.setAttribute('aria-busy', 'true')
  shield.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;background:rgba(255,255,255,0.01);cursor:progress;touch-action:none;'
  document.body.appendChild(shield)
}

// 进行中的指针手势计数与提交后的稳定点。关闭前必须等它归零，否则 ready
// 会早于手势提交，change 排到 dispose 之后被丢掉。
let activePointers = 0
let pointerSettled: Promise<void> = Promise.resolve()
const pointerIdleWaiters: Array<() => void> = []

window.addEventListener(
  'pointerdown',
  () => {
    activePointers += 1
  },
  true
)

const endPointer = (): void => {
  activePointers = Math.max(0, activePointers - 1)
  if (activePointers > 0) return
  // 同一次事件派发里的提交（pointerup → onChange → sendChange）会在本任务
  // 内完成；这里只等一个任务边界确认，不猜测手势时长。
  pointerSettled = pointerSettled.then(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
  )
  for (const wake of pointerIdleWaiters.splice(0)) wake()
}
window.addEventListener('pointerup', endPointer, true)
window.addEventListener('pointercancel', endPointer, true)

/** 关闭前静默：等现有手势结束并把提交写入入队，之后才允许 flush/ready。 */
async function waitForInputQuiesce(): Promise<void> {
  if (activePointers > 0) {
    await new Promise<void>((resolve) => {
      pointerIdleWaiters.push(resolve)
    })
  }
  await pointerSettled
}

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

/**
 * 旧 v4 快照一次性迁移：完整结果先写新键并等 ack，确认后才进入正常会话。
 * 未确认即抛错，保留旧原件由错误页重试，不会半写。
 */
async function commitMigratedAnnotations(
  initial: ReaderSnapshot
): Promise<void> {
  if (!initial.migrated || bridge === null) return
  bridge.sendChange(serializeReaderSnapshot(initial))
  const saved = await bridge.flushPending(FLUSH_PENDING_TIMEOUT_MS)
  if (!saved) throw new Error('标注迁移未确认，已保留旧数据，请重试')
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
    const initial = restoreReaderSnapshot(restored.data, restored.progress)
    await commitMigratedAnnotations(initial)
    if (token !== generation) return
    root.render(
      <ReaderSurface
        key={`${document.fileId}:${token}`}
        source={source}
        document={documentHandle.document}
        initial={initial}
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
          setClosingShield(false)
          // 宿主已确认未确认写入全部落盘（见 command flush 握手），直接释放引擎。
          work = work.then(release).catch(() => undefined)
        },
        onDrainingChange: (draining) => {
          // 关闭冲刷期间冻结输入；恢复（resume）时解除。
          setClosingShield(draining)
        },
        onQuiesce: waitForInputQuiesce,
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
