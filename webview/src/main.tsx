import { startNativePdfSurface } from './nativePdf'
import { parseReaderSessionReplacement } from '../../src/bridge/sessionReplacement'
import { createRef } from 'react'
import type { ReaderProgressHandle } from '../../src/components/Reader'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ReaderSurface } from './ReaderSurface'
import { ReaderRootErrorBoundary } from './ReaderRootErrorBoundary'
import { createWebBridgeClient } from './bridgeClient'
import { listenHostMessages } from './hostMessageChannel'
import { readPackagedAsset } from './packagedAsset'
import { createPdfWorkerFromAsset } from './pdfWorker'
import { packagedPdfOptions } from './pdfAssets'
import { createPdfMetadataExperiment } from './pdfMetadataExperiment'
import type { PdfMetadataExperimentConfig } from './pdfMetadataExperimentConfig'
import { GlobalWorkerOptions } from '../../src/pdf/pdfjsRuntime'
import { openReaderDocument } from '../../src/host/openReaderDocument'
import {
  attachPdfLoadDiagnostics,
  createPdfLoadDiagnostics,
  pdfLoadDiagnosticMessage,
  type PdfLoadDiagnostics
} from '../../src/pdf/pdfLoadDiagnostics'
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

declare const __READER_PDF_METADATA_EXPERIMENT__: PdfMetadataExperimentConfig
declare const __READER_PDF_METADATA_EXPERIMENT_ENABLED__: boolean

if (window.__READER_NATIVE_PDF__) {
  startNativePdfSurface(window.__READER_NATIVE_PDF__)
} else {
  const rootElement = document.getElementById('reader')
  if (!rootElement) throw new Error('Missing reader root')
  const root = createRoot(rootElement)
  const readerProgress = createRef<ReaderProgressHandle>()
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
  const engineDisposals: Promise<void>[] = []
  let metadataExperiment:
    | ReturnType<typeof createPdfMetadataExperiment>
    | undefined
  let metadataDiagnosticsDraining = false

  async function release() {
    metadataExperiment?.cancel()
    metadataExperiment = undefined
    flushSync(() => root.render(null))
    const previous = opened
    const previousWorker = worker
    opened = null
    worker = null
    try {
      const results = await Promise.allSettled([
        ...engineDisposals.splice(0),
        previous?.dispose()
      ])
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
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

  function startMetadataExperiment(
    diagnostics: PdfLoadDiagnostics | undefined
  ) {
    if (!__READER_PDF_METADATA_EXPERIMENT_ENABLED__ || !diagnostics)
      return undefined
    const experiment = createPdfMetadataExperiment(
      __READER_PDF_METADATA_EXPERIMENT__,
      diagnostics
    )
    metadataExperiment = experiment
    if (metadataDiagnosticsDraining) experiment.cancel()
    return experiment
  }

  async function finishMetadataOnly(
    diagnostics: PdfLoadDiagnostics | undefined,
    token: number
  ) {
    diagnostics?.event('metadata-only-releasing')
    await release()
    diagnostics?.event('metadata-only-released')
    if (token === generation)
      root.render(
        <div role='status'>
          元数据实验已结束，资源已释放；重新打开文档可开始下一轮。
        </div>
      )
  }

  async function reportDisplayFailure(
    error: unknown,
    experiment: typeof metadataExperiment,
    diagnostics: PdfLoadDiagnostics | undefined,
    token: number
  ) {
    if (experiment?.signal.aborted) {
      diagnostics?.event('metadata-experiment-cancelled')
      await release().catch(() => undefined)
      if (token === generation)
        root.render(<div role='status'>元数据实验已取消。</div>)
      return
    }
    diagnostics?.event('display-error')
    await release().catch(() => undefined)
    if (token !== generation) return
    bridge?.reportEngineFailure(
      error instanceof Error ? error : new Error(String(error))
    )
    root.render(
      <div role='alert'>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        <button type='button' onClick={scheduleDisplay}>
          重试
        </button>
      </div>
    )
  }

  async function display(
    token: number,
    document: BridgeOpenPayload['document'],
    restored: BridgeRestorePayload
  ) {
    const diagnosticSession = activeSessionId
    const diagnostics =
      document.format === 'pdf'
        ? createPdfLoadDiagnostics((line) => {
            if (post && host)
              post(
                pdfLoadDiagnosticMessage(
                  line,
                  diagnosticSession,
                  host.sourceToken
                )
              )
          })
        : undefined
    diagnostics?.event('display-start')
    let experiment: typeof metadataExperiment
    try {
      await release()
      if (token !== generation) return
      experiment = startMetadataExperiment(diagnostics)
      experiment?.signal.throwIfAborted()
      diagnostics?.event('file-read-start')
      // Native stages exactly this publication beside the packaged entry, within WKWebView's read root.
      const data = new Uint8Array(await readPackagedAsset(document.fileUrl))
      diagnostics?.event('file-read-complete', { byteLength: data.byteLength })
      if (token !== generation) return
      if (document.format === 'pdf') {
        diagnostics?.event('worker-start')
        const nextWorker = await createPdfWorkerFromAsset()
        diagnostics?.event('worker-ready')
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
      attachPdfLoadDiagnostics(source, diagnostics)
      const documentHandle = experiment
        ? await openReaderDocument(
            source,
            document.fileId,
            experiment.openOptions
          )
        : await openReaderDocument(source, document.fileId)
      opened = documentHandle
      if (token !== generation) {
        await release()
        return
      }
      if (experiment?.metadataOnly) {
        await finishMetadataOnly(diagnostics, token)
        return
      }
      const initial = restoreReaderSnapshot(restored.data, restored.progress)
      await commitMigratedAnnotations(initial)
      if (token !== generation) return
      root.render(
        <ReaderRootErrorBoundary key={`${document.fileId}:${token}`}>
          <ReaderSurface
            onEngineReady={() => {
              if (token === generation && activeSessionId !== host?.sessionId)
                bridge?.reportDocumentReady()
            }}
            onEngineError={(error) => {
              if (token === generation) bridge?.reportEngineFailure(error)
            }}
            onEngineDisposal={(completion) => engineDisposals.push(completion)}
            progressRef={readerProgress}
            source={source}
            document={documentHandle.document}
            initial={initial}
            onChange={(data) => {
              if (token === generation) bridge?.sendChange(data)
            }}
          />
        </ReaderRootErrorBoundary>
      )
    } catch (error) {
      await reportDisplayFailure(error, experiment, diagnostics, token)
    }
  }

  function scheduleDisplay() {
    if (!descriptor || !snapshot) return
    metadataExperiment?.cancel()
    const token = ++generation
    const document = descriptor.document
    const restored = snapshot
    // Serialize open/dispose: pdf.js workers must outlive every session using them.
    work = work.then(() => display(token, document, restored))
  }

  function makeBridge(sessionId: string) {
    metadataDiagnosticsDraining = false
    return host && post
      ? createWebBridgeClient({
          sessionId,
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
            metadataExperiment?.cancel()
            generation++
            setClosingShield(false)
            // 宿主已确认未确认写入全部落盘（见 command flush 握手），直接释放引擎。
            work = work.then(release).catch(() => undefined)
          },
          onDrainingChange: (draining) => {
            metadataDiagnosticsDraining = draining
            if (draining) metadataExperiment?.cancel()
            // 关闭冲刷期间冻结输入；恢复（resume）时解除。
            setClosingShield(draining)
          },
          onQuiesce: async (report) => {
            metadataDiagnosticsDraining = true
            metadataExperiment?.cancel()
            await waitForInputQuiesce()
            report('document-work')
            await work
            report('stable-progress')
            await readerProgress.current?.flush()
          },
          onError: (error) => {
            if (error.code === 'REVISION_MISMATCH') return
            let notice = document.getElementById('reader-save-error')
            if (!notice) {
              notice = document.createElement('div')
              notice.id = 'reader-save-error'
              notice.setAttribute('role', 'alert')
              document.body.appendChild(notice)
            }
            notice.textContent = error.message
          }
        })
      : null
  }
  let activeSessionId = host?.sessionId ?? ''
  let bridge = makeBridge(activeSessionId)
  const replacedSessions = new Set([activeSessionId])
  if (bridge) {
    listenHostMessages((message) => {
      const replacement =
        host &&
        parseReaderSessionReplacement(message, {
          sessionId: activeSessionId,
          sourceToken: host.sourceToken
        })
      if (replacement && !replacedSessions.has(replacement.sessionId)) {
        metadataExperiment?.cancel()
        // Host only sends this after the old close/ACK barrier. Old messages are
        // rejected by the fresh client; document rendering remains serialized.
        generation++
        descriptor = null
        snapshot = null
        bridge?.dispose()
        work = work.then(release)
        activeSessionId = replacement.sessionId
        replacedSessions.add(activeSessionId)
        bridge = makeBridge(activeSessionId)
        bridge?.start()
        return
      }
      bridge?.handleMessage(message)
    })
    bridge.start()
  } else root.render(<div role='alert'>未连接阅读宿主</div>)

  // Hidden-page work is best effort; only bridge acknowledgements confirm persistence.
  let backgroundWork: Promise<unknown> = Promise.resolve()
  const flushBackground = () => {
    const token = generation
    backgroundWork = backgroundWork
      .catch(() => undefined)
      .then(async () => {
        if (token !== generation || !bridge) return
        await readerProgress.current?.flush()
        if (token === generation)
          await bridge.flushPending(FLUSH_PENDING_TIMEOUT_MS)
      })
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBackground()
  })
  window.addEventListener('pagehide', flushBackground)
}
