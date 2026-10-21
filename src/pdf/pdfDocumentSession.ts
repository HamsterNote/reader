// HAM-89 / tasks.md 3.5：PDF 打开/取消/销毁生命周期与切文件竞态守卫。
// 契约依据 contracts/bridge-protocol.md §5：open 失败上报 ENGINE_FAILURE
// 且不得清空既有数据；dispose 释放全部资源且之后不再产生事件。

import type { PDFDocumentLoadingTask } from 'pdfjs-dist'

import { getDocument } from './pdfjsRuntime'
import type { PDFDocumentProxy } from './pdfjsRuntime'

export type PdfDocumentSource =
  | { readonly data: ArrayBuffer | Uint8Array }
  | { readonly url: string }

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

/**
 * 单次 PDF 打开会话。dispose 后 document 不再可用；重复 dispose 幂等。
 */
export class PdfDocumentSession {
  private disposed = false

  private constructor(
    readonly document: PDFDocumentProxy,
    private readonly loadingTask: PDFDocumentLoadingTask
  ) {}

  static async open(
    source: PdfDocumentSource,
    options: OpenPdfDocumentOptions = {}
  ): Promise<PdfDocumentSession> {
    const { signal, onProgress, onPassword, documentOptions } = options

    if (signal?.aborted) {
      throw new PdfDocumentOpenError(
        'cancelled',
        'PDF open cancelled',
        undefined
      )
    }

    const loadingTask = getDocument({
      ...('data' in source
        ? {
            data:
              source.data instanceof Uint8Array
                ? source.data
                : new Uint8Array(source.data)
          }
        : { url: source.url }),
      isEvalSupported: false,
      ...documentOptions,
      ...(onPassword ? { onPassword } : {}),
      ...(onProgress
        ? {
            onProgress: (progress: { loaded: number; total?: number }) =>
              onProgress(progress.loaded, progress.total)
          }
        : {})
    })

    const abortListener = () => {
      // eslint-disable-next-line sonarjs/void-use -- abort 监听器同步返回，销毁在后台完成
      void loadingTask.destroy()
    }
    signal?.addEventListener('abort', abortListener, { once: true })

    try {
      const document = await loadingTask.promise
      if (signal?.aborted) {
        // 竞态：加载完成时外部已取消，立即销毁，不把文档交给调用方。
        await loadingTask.destroy()
        throw new PdfDocumentOpenError(
          'cancelled',
          'PDF open cancelled',
          undefined
        )
      }
      return new PdfDocumentSession(document, loadingTask)
    } catch (cause) {
      const kind = classifyPdfOpenError(cause)
      const message =
        cause instanceof Error ? cause.message : 'Failed to open PDF document'
      throw new PdfDocumentOpenError(kind, message, cause)
    } finally {
      signal?.removeEventListener('abort', abortListener)
    }
  }

  /** 取消进行中的渲染并销毁 worker/文档。幂等。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.loadingTask.destroy()
  }

  get isDisposed(): boolean {
    return this.disposed
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

  get currentGeneration(): number {
    return this.generation
  }

  get currentSession(): PdfDocumentSession | null {
    return this.current
  }

  async open(
    source: PdfDocumentSource,
    options: OpenPdfDocumentOptions = {}
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
      // eslint-disable-next-line sonarjs/void-use -- 竞态丢弃的会话后台释放
      void session.dispose()
      throw new PdfDocumentOpenError(
        'cancelled',
        'Superseded by a newer open',
        undefined
      )
    }

    const previous = this.current
    this.current = session
    // eslint-disable-next-line sonarjs/void-use -- 旧会话后台释放，不阻塞新会话交付
    if (previous) void previous.dispose()
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
    if (this.disposed) return
    this.disposed = true
    const session = this.current
    this.current = null
    if (session) await session.dispose()
  }
}
