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
    }
  ) {}

  add(operationId: string, execute: () => Promise<T>): NativeSaveOperation<T> {
    const operation: OperationState<T> = {
      operationId,
      execute,
      attempt: 0,
      status: 'pending'
    }
    this.operations.push(operation)
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
    while (this.operations.length > 0) {
      const head = this.operations[0]!
      if (head.status === 'failed') throw head.error
      await this.pump()
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
    const running = head.execute().then(
      (result) => {
        head.status = 'confirmed'
        head.error = undefined
        this.operations.shift()
        this.active = null
        head.running = undefined
        this.callbacks.onConfirmed(head, result)
        if (this.operations.length > 0) this.pump()
      },
      (error: unknown) => {
        head.status = 'failed'
        head.error = error
        this.active = null
        head.running = undefined
        this.callbacks.onFailed(head, error)
        throw error
      }
    )
    head.running = running
    running.catch(() => undefined)
    return running
  }
}
