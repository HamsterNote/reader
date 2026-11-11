import type {
  ToolbarFile,
  ToolbarFileRequest,
  ToolbarRequestResult
} from '@hamster-note/painting/toolbar'
import type { ReaderProps } from '../components/Reader'
import type { ReaderData } from '../types/readerData'

export type ReaderFilePosition = Pick<
  ReaderData,
  'layoutReadingProgress' | 'textReadingProgress'
>
export type ReaderFileDocument = {
  /** The host supplies authorized bytes/metadata; the menu never reads storage. */
  readonly props: ReaderProps
  readonly dispose: () => Promise<void>
}
export type ReaderFileAdapter = {
  readonly format: string
  /** Per-pane controlled data/callbacks, applied outside shared resource leases. */
  readonly viewProps?: (file: ToolbarFile) => Promise<ReaderProps>
  readonly load: (file: ToolbarFile) => Promise<ReaderFileDocument>
}
export type ReaderFileTransaction = ToolbarFileRequest & {
  readonly file: ToolbarFile
  readonly sessionId: string
}
export type ReaderFileHost = {
  readonly supports: (format: string) => boolean
  /** Resolve only after the existing host save queue has received persistence ACKs. */
  readonly save: (
    request: ReaderFileTransaction & {
      readonly data: ReaderData | undefined
      readonly persistPosition: boolean
    }
  ) => Promise<void>
  readonly handover: (
    request: ReaderFileTransaction & { readonly release: () => Promise<void> }
  ) => Promise<ToolbarRequestResult>
  readonly commit: (request: ReaderFileTransaction) => Promise<void>
  /** Required failure fallback: reopen target from storage through the host. */
  readonly reload: (
    request: ReaderFileTransaction & { readonly error: unknown }
  ) => Promise<ToolbarRequestResult>
}
export type ReaderFileView = {
  readonly flush: () => Promise<ReaderData | undefined>
  /** Must unmount synchronously, then await all reported engine disposals. */
  readonly release: () => Promise<void>
}
export type ReaderFileState = {
  readonly phase:
    | 'idle'
    | 'saving'
    | 'loading'
    | 'restoring'
    | 'handover'
    | 'error'
  readonly currentFileKey?: string
  readonly file?: ToolbarFile
  readonly sessionId?: string
  readonly document?: ReaderFileDocument
  readonly data?: ReaderData
  readonly error?: string
}
const identity = (file: ToolbarFile) =>
  JSON.stringify([file.storageId, file.path])
let nextSession = 0
const sessionId = () => `reader-file-${++nextSession}`
const failed = (error: unknown): ToolbarRequestResult => ({
  status: 'failed',
  message: error instanceof Error ? error.message : String(error)
})

/** Share authorized sources, never pane engines or undo/selection controllers. */
export class ReaderFileResourcePool {
  private entries = new Map<
    string,
    {
      promise: Promise<ReaderFileDocument>
      references: number
      closing?: boolean
    }
  >()
  constructor(private readonly limit = 2) {
    if (limit !== 1 && limit !== 2)
      throw new Error('Only one or two active documents are supported')
  }
  async acquire(file: ToolbarFile, adapter: ReaderFileAdapter) {
    const key = identity(file)
    let entry = this.entries.get(key)
    if (!entry) {
      if (this.entries.size >= this.limit)
        throw new Error('Active document limit reached')
      entry = {
        promise: Promise.resolve().then(() => adapter.load(file)),
        references: 0
      }
      this.entries.set(key, entry)
    }
    if (entry.closing) throw new Error('Document resource is being released')
    const lease = entry
    lease.references++
    let document: ReaderFileDocument
    try {
      document = await lease.promise
    } catch (error) {
      if (--lease.references === 0) this.entries.delete(key)
      throw error
    }
    let released = false
    return {
      ...document,
      dispose: async () => {
        if (released) return
        released = true
        if (--lease.references === 0) {
          lease.closing = true
          // Count a resource as active until its asynchronous destruction finishes.
          try {
            await document.dispose()
          } finally {
            this.entries.delete(key)
          }
        }
      }
    }
  }
  get activeDocuments() {
    return this.entries.size
  }
}

/** One controller per pane, optionally sharing a two-document resource pool. */
export class ReaderFileSession {
  private state: ReaderFileState = { phase: 'idle' }
  private listeners = new Set<() => void>()
  private adapters: Map<string, ReaderFileAdapter>
  private view: ReaderFileView | undefined
  private ready:
    | { id: string; resolve: () => void; reject: (error: unknown) => void }
    | undefined
  private positions = new Map<string, ReaderFilePosition>()
  private pending = false
  private disposed = false
  private request = 0
  private lastFile: ToolbarFile | undefined
  private data: ReaderData | undefined
  constructor(
    private readonly options: {
      readonly paneId: string
      readonly files: () => readonly ToolbarFile[]
      readonly adapters: readonly ReaderFileAdapter[]
      readonly host: ReaderFileHost
      readonly pool?: ReaderFileResourcePool
      readonly readyTimeoutMs?: number
      readonly isActivePane?: () => boolean
    }
  ) {
    this.adapters = new Map(
      options.adapters.map((adapter) => [adapter.format, adapter])
    )
  }
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly getSnapshot = () => this.state
  readonly getFiles = () => this.options.files()
  get paneId() {
    return this.options.paneId
  }
  get capabilities() {
    return [...this.adapters.keys()]
  }
  private publish(patch: Partial<ReaderFileState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  private positionKey(file: ToolbarFile) {
    return JSON.stringify([identity(file), this.paneId])
  }
  /** Ignores old document events and responses after a switch. */
  update(id: string, data: ReaderData) {
    if (
      id !== this.state.sessionId ||
      !['idle', 'saving'].includes(this.state.phase)
    )
      return false
    this.data = data
    this.publish({ data })
    return true
  }
  attach(id: string, view: ReaderFileView) {
    if (id === this.state.sessionId) this.view = view
  }
  restored(id: string) {
    if (this.ready?.id === id) this.ready.resolve()
  }
  loadFailed(id: string, error: unknown) {
    if (this.ready?.id === id) this.ready.reject(error)
  }
  private async release() {
    const document = this.state.document
    const view = this.view
    this.view = undefined
    try {
      await view?.release()
    } finally {
      this.publish({
        document: undefined,
        sessionId: undefined,
        data: undefined
      })
      await document?.dispose()
    }
  }
  private async load(file: ToolbarFile, id: string) {
    const adapter = this.adapters.get(file.resolvedFormat)
    if (!adapter)
      throw new Error(`Reader does not support ${file.resolvedFormat}`)
    const document = this.options.pool
      ? await this.options.pool.acquire(file, adapter)
      : await adapter.load(file)
    let props: ReaderProps
    try {
      props = { ...document.props, ...(await adapter.viewProps?.(file)) }
    } catch (error) {
      await document.dispose()
      throw error
    }
    const instance = { ...document, props }
    const data = {
      ...props.data,
      ...this.positions.get(this.positionKey(file))
    }
    this.data = data
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        this.ready = { id, resolve, reject }
        timer = setTimeout(
          () => reject(new Error('Reader restoration timed out')),
          this.options.readyTimeoutMs ?? 30000
        )
        this.publish({
          phase: 'restoring',
          file,
          document: instance,
          sessionId: id,
          data
        })
      })
    } finally {
      clearTimeout(timer)
      this.ready = undefined
    }
  }
  /** Initial mount uses the same restoration barrier, without saving an empty view. */
  async open(fileKey: string) {
    return this.select({
      fileKey,
      paneId: this.paneId,
      requestId: `open-${++this.request}`
    })
  }
  private async saveCurrent(request: ToolbarFileRequest) {
    const file = this.state.file
    if (!file || !this.state.document) return
    if (!this.view) throw new Error('Reader view is not attached')
    const data = (await this.view.flush()) ?? this.data
    await this.options.host.save({
      ...request,
      fileKey: file.key,
      file,
      sessionId: this.state.sessionId!,
      data,
      persistPosition: this.options.isActivePane?.() ?? true
    })
    this.positions.set(this.positionKey(file), {
      layoutReadingProgress: data?.layoutReadingProgress,
      textReadingProgress: data?.textReadingProgress
    })
    this.lastFile = file
  }
  private async handover(
    transaction: ReaderFileTransaction,
    progress: { released: boolean }
  ) {
    this.publish({ phase: 'handover' })
    const result = await this.options.host.handover({
      ...transaction,
      release: async () => {
        progress.released = true
        await this.release()
      }
    })
    if (result.status !== 'success') {
      if (progress.released)
        throw new Error('Host handover failed after release')
      this.publish({ phase: 'idle' })
      return result
    }
    if (!progress.released)
      throw new Error(
        'Host must release the reader before opening another editor'
      )
    return result
  }
  private async fallback(transaction: ReaderFileTransaction, error: unknown) {
    let recoveryError = error
    try {
      await this.release()
    } catch (cleanupError) {
      recoveryError = cleanupError
    }
    try {
      const result = await this.options.host.reload({
        ...transaction,
        error: recoveryError
      })
      this.publish({ phase: 'error', error: String(error) })
      if (result.status !== 'success') return failed(error)
      await this.options.host.commit(transaction)
      this.publish({
        phase: 'idle',
        file: transaction.file,
        currentFileKey: transaction.file.key,
        error: undefined
      })
      return result
    } catch (reloadError) {
      this.publish({ phase: 'error', error: String(reloadError) })
      return failed(reloadError)
    }
  }
  readonly select = async (
    request: ToolbarFileRequest
  ): Promise<ToolbarRequestResult> => {
    if (this.disposed || this.pending) return failed('Reader is busy')
    if (request.paneId !== this.paneId) return failed('Wrong target pane')
    if (request.fileKey === this.state.currentFileKey && this.state.document)
      return { status: 'success' }
    const file = this.options
      .files()
      .find((item) => item.key === request.fileKey)
    if (!file) return failed('File is no longer in this session')
    const inPlace = this.adapters.has(file.resolvedFormat)
    if (!inPlace && !this.options.host.supports(file.resolvedFormat))
      return failed(`Unsupported format: ${file.resolvedFormat}`)
    this.pending = true
    const transaction = { ...request, file, sessionId: sessionId() }
    const progress = { released: false }
    try {
      this.publish({ phase: 'saving', error: undefined })
      await this.saveCurrent(request)
      if (!inPlace) {
        const result = await this.handover(transaction, progress)
        if (result.status !== 'success') return result
      } else {
        progress.released = true
        await this.release()
        this.publish({ phase: 'loading', file })
        await this.load(file, transaction.sessionId)
      }
      await this.options.host.commit(transaction)
      this.publish({ phase: 'idle', currentFileKey: file.key, file })
      return { status: 'success' }
    } catch (error) {
      if (!progress.released) {
        this.publish({ phase: 'idle', error: String(error) })
        return failed(error)
      }
      return await this.fallback(transaction, error)
    } finally {
      this.pending = false
    }
  }
  retry() {
    return this.state.file
      ? this.open(this.state.file.key)
      : Promise.resolve(failed('No target file'))
  }
  reopenPrevious() {
    return this.lastFile
      ? this.open(this.lastFile.key)
      : Promise.resolve(failed('No previous file'))
  }
  async dispose() {
    if (this.pending)
      throw new Error('Cannot dispose during a file transaction')
    this.disposed = true
    await this.release()
    this.listeners.clear()
  }
}
