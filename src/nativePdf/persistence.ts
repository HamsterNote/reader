/**
 * Chain a snapshot write after the previous attempt, regardless of whether
 * that attempt rejected. A rejected promise must not poison the queue: the
 * next user retry still has to reach the storage adapter.
 */
export function enqueueRecoverableSave<T>(
  previous: Promise<unknown>,
  task: () => Promise<T>
): Promise<T> {
  return previous.catch(() => undefined).then(task)
}

export type NativeSaveOperation<T> = Readonly<{
  operationId: string
  execute: () => Promise<T>
  attempt: number
  status: 'pending' | 'saving' | 'failed' | 'confirmed'
  error?: unknown
}>

type OperationState<T> = {
  operationId: string
  execute: () => Promise<T>
  attempt: number
  status: 'pending' | 'saving' | 'failed' | 'confirmed'
  error?: unknown
  running?: Promise<void>
  queuedAt: number
}

/**
 * 写盘队列诊断事件（HAM-278 组 4）：证明关闭旧会话前确实等到了保存完成。
 * 只含操作 id、待写数量与耗时，不含快照内容。
 */
export type NativeSaveQueueDiagnostic = {
  readonly event:
    | 'queued'
    | 'started'
    | 'confirmed'
    | 'failed'
    | 'drain-start'
    | 'drain-end'
  readonly operationId: string
  readonly pending: number
  /** 从入队到真正开始写盘的等待毫秒数（started）。 */
  readonly waitMs?: number
  /** 本次写盘或整段 drain 的耗时（confirmed/failed/drain-end）。 */
  readonly elapsedMs?: number
  readonly attempt?: number
  readonly ok?: boolean
}

export class NativeOperationQueue<T> {
  private readonly operations: OperationState<T>[] = []
  private active: OperationState<T> | null = null

  constructor(
    private readonly callbacks: {
      readonly onConfirmed: (
        operation: NativeSaveOperation<T>,
        result: T
      ) => void
      readonly onFailed: (
        operation: NativeSaveOperation<T>,
        error: unknown
      ) => void
      readonly onDiagnostic?: (diagnostic: NativeSaveQueueDiagnostic) => void
    }
  ) {}

  private emit(diagnostic: NativeSaveQueueDiagnostic): void {
    this.callbacks.onDiagnostic?.(diagnostic)
  }

  add(operationId: string, execute: () => Promise<T>): NativeSaveOperation<T> {
    const operation: OperationState<T> = {
      operationId,
      execute,
      attempt: 0,
      status: 'pending',
      queuedAt: Date.now()
    }
    this.operations.push(operation)
    this.emit({
      event: 'queued',
      operationId,
      pending: this.operations.length
    })
    this.pump()
    return operation
  }

  get pending(): number {
    return this.operations.length
  }

  get head(): NativeSaveOperation<T> | null {
    return this.operations[0] ?? null
  }

  retry(): Promise<void> | null {
    const head = this.operations[0]
    if (!head) return Promise.resolve()
    if (head.status !== 'failed' && head.status !== 'saving') return null
    if (head.status === 'failed') head.status = 'pending'
    return this.pump()
  }

  async drain(): Promise<void> {
    const startedAt = Date.now()
    this.emit({
      event: 'drain-start',
      operationId: '',
      pending: this.operations.length
    })
    let ok = true
    try {
      while (this.operations.length > 0) {
        const head = this.operations[0]!
        if (head.status === 'failed') throw head.error
        await this.pump()
      }
    } catch (error) {
      ok = false
      throw error
    } finally {
      this.emit({
        event: 'drain-end',
        operationId: '',
        pending: this.operations.length,
        elapsedMs: Date.now() - startedAt,
        ok
      })
    }
  }

  private pump(): Promise<void> {
    const head = this.operations[0]
    if (!head) return Promise.resolve()
    if (head.running) return head.running
    if (this.active || head.status === 'failed') {
      return Promise.reject(head.error ?? new Error('另一项保存尚未确认'))
    }
    this.active = head
    head.attempt += 1
    head.status = 'saving'
    const startedAt = Date.now()
    this.emit({
      event: 'started',
      operationId: head.operationId,
      pending: this.operations.length,
      waitMs: startedAt - head.queuedAt,
      attempt: head.attempt
    })
    const running = head.execute().then(
      (result) => {
        head.status = 'confirmed'
        head.error = undefined
        this.operations.shift()
        this.active = null
        head.running = undefined
        this.emit({
          event: 'confirmed',
          operationId: head.operationId,
          pending: this.operations.length,
          elapsedMs: Date.now() - startedAt
        })
        this.callbacks.onConfirmed(head, result)
        if (this.operations.length > 0) this.pump()
      },
      (error: unknown) => {
        head.status = 'failed'
        head.error = error
        this.active = null
        head.running = undefined
        this.emit({
          event: 'failed',
          operationId: head.operationId,
          pending: this.operations.length,
          elapsedMs: Date.now() - startedAt
        })
        this.callbacks.onFailed(head, error)
        throw error
      }
    )
    head.running = running
    running.catch(() => undefined)
    return running
  }
}
