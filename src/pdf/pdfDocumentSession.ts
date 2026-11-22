// HAM-89 / tasks.md 3.5：PDF 打开/取消/销毁生命周期与切文件竞态守卫。
// 契约依据 contracts/bridge-protocol.md §5：open 失败上报 ENGINE_FAILURE
// 且不得清空既有数据；dispose 释放全部资源且之后不再产生事件。

import {
  PDFWorker,
  type PDFDataRangeTransport,
  type PDFDocumentLoadingTask
} from 'pdfjs-dist'

import { getDocument } from './pdfjsRuntime'
import { stopPdfRange, trackRangePages } from './pdfRangeCleanup'
import type { PDFDocumentProxy } from './pdfjsRuntime'

/** A fallible range source uses a dedicated worker from PDF.js workerSrc so it can terminate blocked reads. */
export type PdfRangeTransport = PDFDataRangeTransport & {
  readonly failure?: Promise<never>
}

export type PdfDocumentSource =
  | { readonly data: ArrayBuffer | Uint8Array }
  | { readonly url: string }
  | { readonly createRange: () => PdfRangeTransport }

function pdfDocumentInput(source: PdfDocumentSource) {
  if ('data' in source) {
    const bytes = source.data
    return {
      data:
        bytes instanceof Uint8Array
          ? bytes.slice()
          : new Uint8Array(bytes.slice(0))
    }
  }
  if ('url' in source) return { url: source.url }
  return { range: source.createRange() }
}

export type PdfOpenErrorKind =
  | 'corrupt'
  | 'password-required'
  | 'cancelled'
  | 'network'
  | 'unknown'

export type PdfOpenError = {
  readonly kind: PdfOpenErrorKind
  readonly message: string
  readonly cause: unknown
}

export class PdfDocumentOpenError extends Error implements PdfOpenError {
  readonly kind: PdfOpenErrorKind
  readonly cause: unknown

  constructor(kind: PdfOpenErrorKind, message: string, cause: unknown) {
    super(message)
    this.name = 'PdfDocumentOpenError'
    this.kind = kind
    this.cause = cause
  }
}

export function classifyPdfOpenError(cause: unknown): PdfOpenErrorKind {
  if (cause instanceof PdfDocumentOpenError) return cause.kind

  const name =
    typeof cause === 'object' && cause !== null
      ? String(Reflect.get(cause, 'name') ?? '')
      : ''
  const message = cause instanceof Error ? cause.message : ''

  // 取消加载/切文件的正常路径：pdf.js 内部以普通 Error 拒绝
  // （'Worker was destroyed' / 'Loading aborted'），归类 cancelled。
  if (
    message.includes('Worker was destroyed') ||
    message.includes('Loading aborted')
  ) {
    return 'cancelled'
  }

  switch (name) {
    case 'InvalidPDFException':
      return 'corrupt'
    case 'PasswordException':
      return 'password-required'
    case 'AbortException':
      return 'cancelled'
    case 'MissingPDFException':
    case 'UnexpectedResponseException':
      return 'network'
    default:
      return 'unknown'
  }
}

export type OpenPdfDocumentOptions = {
  /** 外部取消信号（例如宿主 dispose / 切换文档）。 */
  readonly signal?: AbortSignal
  /** 加载进度回调（已加载/总字节）。 */
  readonly onProgress?: (loaded: number, total: number | undefined) => void
  /** 加密文档密码回调；返回 null/undefined 表示取消。 */
  readonly onPassword?: (
    updatePassword: (password: string) => void,
    reason: number
  ) => void
  /** 透传给 getDocument 的其余参数（cMapUrl、standardFontDataUrl 等）。 */
  readonly documentOptions?: Readonly<Record<string, unknown>>
}

function cancelled() {
  return new PdfDocumentOpenError('cancelled', 'PDF open cancelled', undefined)
}

class PdfSessionLifetime {
  task?: PDFDocumentLoadingTask
  worker?: PDFWorker
  stopPages?: (reason: unknown) => void
  closing?: Promise<void>
  private rejectOpen!: (reason: unknown) => void
  readonly interrupted = new Promise<never>((_, reject) => {
    this.rejectOpen = reject
  })

  constructor(
    private readonly range: PdfRangeTransport | undefined,
    private readonly signal?: AbortSignal
  ) {
    // getDocument may throw before open can race the two promises.
    this.interrupted.catch(() => {})
    range?.failure?.catch(this.onFailure)
    signal?.addEventListener('abort', this.onAbort, { once: true })
  }

  private readonly onAbort = () => this.onFailure(cancelled())
  private readonly onFailure = (reason: unknown) => {
    // Event-initiated cleanup is also observable by the next dispose().
    this.close(reason).catch(() => {})
  }

  close(reason: unknown): Promise<void> {
    if (!this.closing) {
      this.signal?.removeEventListener('abort', this.onAbort)
      this.rejectOpen(reason)
      this.closing = Promise.resolve().then(async () => {
        try {
          this.stopPages?.(reason)
          if (this.range)
            stopPdfRange(this.range, this.task, this.worker, reason)
        } finally {
          await this.task?.destroy()
        }
      })
    }
    return this.closing
  }
}

export class PdfDocumentSession {
  private constructor(
    readonly document: PDFDocumentProxy,
    private readonly lifetime: PdfSessionLifetime
  ) {}

  static async open(
    source: PdfDocumentSource,
    options: OpenPdfDocumentOptions = {}
  ): Promise<PdfDocumentSession> {
    const { signal, onProgress, onPassword, documentOptions } = options
    if (signal?.aborted) throw cancelled()
    const input = pdfDocumentInput(source)
    const lifetime = new PdfSessionLifetime(input.range, signal)
    try {
      // A host factory can cancel synchronously while creating its transport.
      if (signal?.aborted) throw cancelled()
      if (input.range?.failure) lifetime.worker = new PDFWorker()
      const task = getDocument({
        ...input,
        isEvalSupported: false,
        ...documentOptions,
        ...(lifetime.worker ? { worker: lifetime.worker } : {}),
        ...(onPassword ? { onPassword } : {}),
        ...(onProgress
          ? {
              onProgress: (progress: { loaded: number; total?: number }) =>
                onProgress(progress.loaded, progress.total)
            }
          : {})
      })
      lifetime.task = task
      const document = await Promise.race([task.promise, lifetime.interrupted])
      if (lifetime.closing) await lifetime.interrupted
      if (lifetime.worker) lifetime.stopPages = trackRangePages(document)
      return new PdfDocumentSession(document, lifetime)
    } catch (cause) {
      await lifetime.close(cause)
      const kind = classifyPdfOpenError(cause)
      const message =
        cause instanceof Error ? cause.message : 'Failed to open PDF document'
      throw new PdfDocumentOpenError(kind, message, cause)
    }
  }

  get isDisposed(): boolean {
    return !!this.lifetime.closing
  }

  dispose(): Promise<void> {
    return this.lifetime.close(cancelled())
  }
}

export type PdfSessionManagerOpenResult = {
  /** 会话代际；仅最新代际的 open 会 resolve 出会话。 */
  readonly generation: number
  readonly session: PdfDocumentSession
}

/**
 * 切文件竞态守卫（tasks.md 3.5）：加载 A 后切 B，旧结果不得更新后续文档。
 * - 每次 open 递增代际；旧代际的加载若仍完成，立即销毁且不交付。
 * - 旧代际会话在 dispose 时统一释放。
 */
export class PdfSessionManager {
  private generation = 0
  private current: PdfDocumentSession | null = null
  private disposed = false
  private pending = new Set<Promise<PdfSessionManagerOpenResult>>()
  private disposal: Promise<void> | undefined
  private cleanups = new Set<Promise<void>>()
  private cleanupFailure: unknown

  get currentGeneration(): number {
    return this.generation
  }

  get currentSession(): PdfDocumentSession | null {
    return this.current
  }

  open(
    source: PdfDocumentSource,
    options: OpenPdfDocumentOptions = {}
  ): Promise<PdfSessionManagerOpenResult> {
    const operation = this.openDocument(source, options)
    this.pending.add(operation)
    const settled = () => {
      this.pending.delete(operation)
    }
    operation.then(settled, settled)
    return operation
  }

  private async openDocument(
    source: PdfDocumentSource,
    options: OpenPdfDocumentOptions
  ): Promise<PdfSessionManagerOpenResult> {
    if (this.disposed) {
      throw new PdfDocumentOpenError('cancelled', 'Manager disposed', undefined)
    }

    const generation = ++this.generation
    // 新会话打开成功前保留旧会话：加载期间旧文档仍可展示，open 失败
    // 不清空既有内容（契约：open 失败不得清空既有数据）。
    const session = await PdfDocumentSession.open(source, options)

    if (this.disposed || generation !== this.generation) {
      // 旧加载结果不进入后续文档（契约：STALE_SESSION / 竞态隔离）。
      await session.dispose()
      throw new PdfDocumentOpenError(
        'cancelled',
        'Superseded by a newer open',
        undefined
      )
    }

    const previous = this.current
    this.current = session
    if (previous) {
      const cleanup = previous.dispose()
      this.cleanups.add(cleanup)
      cleanup.then(
        () => this.cleanups.delete(cleanup),
        (error) => {
          this.cleanups.delete(cleanup)
          this.cleanupFailure = error
        }
      )
    }
    return { generation, session }
  }

  /** 释放当前会话但保持 manager 可用（宿主关闭文档但组件未卸载）。 */
  async close(): Promise<void> {
    this.generation += 1
    const session = this.current
    this.current = null
    if (session) await session.dispose()
  }

  /** 关闭当前会话；之后不再产生该会话的任何事件。幂等。 */
  async dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    const session = this.current
    this.current = null
    this.disposal = (async () => {
      try {
        await session?.dispose()
      } finally {
        await Promise.allSettled([...this.pending, ...this.cleanups])
      }
      if (this.cleanupFailure) throw this.cleanupFailure
    })()
    return this.disposal
  }
}
