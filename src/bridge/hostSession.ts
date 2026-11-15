// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.3。
// 桥接协议宿主侧参考实现：宿主持有唯一已确认快照，按协议状态机处理
// ready/change/progress/error/dispose。契约测试见 test/bridge-contract.test.ts。
// 本实现不依赖 WebView/DOM，Expo 宿主主线把它绑定到真实 postMessage 通道。
//
// HAM-90 扩展：持久化可以是异步的（Expo 文件系统）。`handleWebMessageAsync`
// 在持久化完成后才返回 ack；写入失败时回滚到上一个已确认快照并返回 error。
// 同步 `handleWebMessage` 保持 HAM-87 契约，只接受同步 persist。

import {
  BRIDGE_COMMAND_FLUSH,
  BRIDGE_COMMAND_RESUME,
  buildBridgeError,
  parseBridgeMessage,
  parseRevisionedPayload,
  READER_BRIDGE_PROTOCOL_VERSION,
  type BridgeAckPayload,
  type BridgeCommandPayload,
  type BridgeDrainStatus,
  type BridgeErrorCode,
  type BridgeMessage,
  type BridgeRestorePayload
} from './protocol'

/** 宿主持久化的已确认快照：文档数据 + 阅读进度 + 会话内递增 revision。 */
export type BridgeHostSnapshot = {
  readonly data: unknown
  readonly progress: unknown
  readonly revision: number
}

export type BridgeHostSessionOptions = {
  /** 当前文档会话 ID；切换文档必须换 sessionId 并销毁旧会话。 */
  readonly sessionId: string
  /** 打开会话时宿主已有的最后确认快照；无历史数据为 null。 */
  readonly confirmedSnapshot: BridgeHostSnapshot | null
  /**
   * 持久化写入；只在消息通过全部校验后调用，每次逻辑写入恰好一次。
   * 返回 Promise 时必须使用 `handleWebMessageAsync`，确保 ack 在落盘后发出。
   */
  readonly persist: (
    snapshot: BridgeHostSnapshot,
    previous?: BridgeHostSnapshot
  ) => unknown
  /** 主动消息出口（关闭握手的 command/dispose）；缺省时 close 直接返回失败。 */
  readonly send?: (message: BridgeMessage) => void
}

/** 关闭握手结果：closed 表示已落盘并通知 Web；unconfirmed 表示仍有未确认写入。 */
export type BridgeCloseResult =
  | { readonly status: 'closed' }
  | { readonly status: 'unconfirmed'; readonly reason: string }

export type BridgeFlushResult =
  | { readonly status: 'flushed' }
  | Extract<BridgeCloseResult, { status: 'unconfirmed' }>

export type BridgeCloseBehavior = {
  readonly freezeOnFailure?: boolean
  readonly fastIfNeverWritable?: boolean
}

export type BridgeHostSession = {
  /** Explicit user discard: seal input, finish accepted IO, preserve confirmed snapshot. */
  readonly discardUnconfirmed: () => Promise<void>
  readonly flush: (timeoutMs?: number) => Promise<BridgeFlushResult>
  /**
   * 处理一条来自 Web 层的原始消息，返回需要发回 Web 层的消息
   * （restore / ack / error），无任何输出时返回空数组。
   */
  readonly handleWebMessage: (raw: unknown) => BridgeMessage[]
  /**
   * 异步持久化版本：等 persist 完成后才返回 ack。并发消息按调用顺序串行处理。
   */
  readonly handleWebMessageAsync: (raw: unknown) => Promise<BridgeMessage[]>
  /** 当前已确认快照（只读视图）。 */
  readonly getSnapshot: () => BridgeHostSnapshot
  /**
   * 重新下发最后一次确认快照（WebView 重载或显式重试时使用）。
   * 不改变 revision，也不触发持久化。
   */
  readonly resendRestore: () => BridgeMessage[]
  /**
   * 关闭握手：请求 Web 冲刷未确认写入（command flush），等其确认与本地持久化
   * 队列都清空后才下发 dispose 并失效。超时/失败返回 unconfirmed 且会话保持可用。
   */
  readonly close: (
    timeoutMs?: number,
    destroy?: boolean,
    behavior?: BridgeCloseBehavior
  ) => Promise<BridgeCloseResult>
  /** 结束会话；之后所有该会话消息按 STALE_SESSION 拒绝。 */
  readonly dispose: () => void
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'then') === 'function'
  )
}

type RevisionedWriteResult =
  | { readonly kind: 'messages'; readonly messages: BridgeMessage[] }
  | {
      readonly kind: 'write'
      readonly previous: BridgeHostSnapshot
      readonly next: BridgeHostSnapshot
      readonly ack: BridgeAckPayload
    }

export function createBridgeHostSession(
  options: BridgeHostSessionOptions
): BridgeHostSession {
  let snapshot: BridgeHostSnapshot = options.confirmedSnapshot ?? {
    data: null,
    progress: null,
    revision: 0
  }
  let restoreSent = false
  let disposed = false
  // 关闭握手：closing 期间仍接收 Web 写入；webDrained 表示 Web 已冲干净。
  let drainGeneration = 0
  let closing = false
  let disposeAfterDrain = true
  let webDrained = false
  let closePromise: Promise<BridgeCloseResult> | null = null
  let settleClose: ((result: BridgeCloseResult) => void) | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  let fastClosePromise: Promise<BridgeCloseResult> | null = null
  let closeBehavior: BridgeCloseBehavior = {}
  let accepting = true
  let discarding = false
  let inputFrozen = false
  // 已持久化的 requestId → ack payload，用于重复投递幂等应答。
  const persistedRequestIds = new Map<string, BridgeAckPayload>()
  let outboundCounter = 0
  let asyncQueue: Promise<unknown> = Promise.resolve()
  let queuedMessages = 0
  let flushRequestId: string | null = null
  let drainStage = 'final-flush'
  let webPending: number | null = null

  const diagnoseDrain = (event: string): void => {
    console.info('reader-bridge-drain', {
      sessionId: options.sessionId,
      flushRequestId,
      event,
      barrier: drainStage,
      webPending,
      queuedMessages,
      revision: snapshot.revision,
      webDrained,
      inputFrozen
    })
  }

  const drainReason = (reason: string): string =>
    `${reason} [barrier=${drainStage}; webPending=${webPending ?? 'unknown'}; hostQueue=${queuedMessages}; revision=${snapshot.revision}]`

  const buildOutbound = <TPayload>(
    type: BridgeMessage['type'],
    payload: TPayload
  ): BridgeMessage<TPayload> => {
    outboundCounter += 1
    return {
      version: READER_BRIDGE_PROTOCOL_VERSION,
      sessionId: options.sessionId,
      requestId: `host-${outboundCounter}`,
      type,
      payload
    }
  }

  const buildError = (
    code: BridgeErrorCode,
    message: string,
    causeRequestId?: string
  ): BridgeMessage => {
    outboundCounter += 1
    return buildBridgeError(
      options.sessionId,
      `host-${outboundCounter}`,
      code,
      message,
      causeRequestId
    )
  }

  const buildRestore = (): BridgeMessage<BridgeRestorePayload> =>
    buildOutbound('restore', {
      data: snapshot.data,
      progress: snapshot.progress,
      revision: snapshot.revision
    })

  const clearCloseTimer = (): void => {
    if (closeTimer !== null) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  /** 普通关闭失败会恢复编辑；交接失败保持输入冻结，只允许继续排空。 */
  const abortClose = (reason: string): void => {
    if (!closing) return
    diagnoseDrain('unconfirmed')
    const detailedReason = drainReason(reason)
    closing = false
    drainGeneration++
    webDrained = false
    inputFrozen = closeBehavior.freezeOnFailure === true
    clearCloseTimer()
    if (!inputFrozen) {
      options.send?.(
        buildOutbound<BridgeCommandPayload>('command', {
          name: BRIDGE_COMMAND_RESUME
        })
      )
    }
    const resolve = settleClose
    settleClose = null
    closePromise = null
    resolve?.({ status: 'unconfirmed', reason: detailedReason })
  }

  const waitForStableQueue = async (): Promise<void> => {
    let observed: Promise<unknown> = asyncQueue
    let stable = false
    while (!stable) {
      await observed
      stable = observed === asyncQueue
      observed = asyncQueue
    }
  }

  /**
   * Web 已冲干净且本地持久化队列为空 → 下发 dispose 并失效。
   * 顺序保证：所有 ack 先于 dispose，Web 不会因为关闭丢掉已接收的写入。
   */
  const completeClose = async (): Promise<void> => {
    if (!closing || !webDrained) return
    drainStage = 'host-queue'
    diagnoseDrain('waiting')
    const generation = drainGeneration
    // ready 之后仍可能有排在后面的 change（同批投递）：队列直到稳定才 dispose。
    await waitForStableQueue()
    if (!closing || generation !== drainGeneration) return
    diagnoseDrain('confirmed')
    closing = false
    disposed = disposeAfterDrain
    inputFrozen = disposeAfterDrain
    clearCloseTimer()
    options.send?.(
      disposeAfterDrain
        ? buildOutbound('dispose', {})
        : buildOutbound<BridgeCommandPayload>('command', {
            name: BRIDGE_COMMAND_RESUME
          })
    )
    const resolve = settleClose
    settleClose = null
    closePromise = null
    resolve?.({ status: 'closed' })
  }

  // change/progress 共享写入路径：restore 前置校验、requestId 幂等、
  // revision 递增校验，全部通过后恰好持久化一次并应答 ack。
  const prepareRevisionedWrite = (
    message: BridgeMessage,
    dataKey: 'data' | 'progress'
  ): RevisionedWriteResult => {
    const parsedPayload = parseRevisionedPayload(message.payload, dataKey)
    if (!parsedPayload) {
      return {
        kind: 'messages',
        messages: [
          buildError(
            'INVALID_MESSAGE',
            'payload 缺少数据或 revision',
            message.requestId
          )
        ]
      }
    }
    if (!restoreSent) {
      // 初始化不清空数据：restore 未下发前的写入一律拒绝且不持久化。
      return {
        kind: 'messages',
        messages: [
          buildError(
            'RESTORE_PENDING',
            'restore 完成前不得回写',
            message.requestId
          )
        ]
      }
    }
    const existingAck = persistedRequestIds.get(message.requestId)
    if (existingAck) {
      // 重复投递幂等：重新应答 ack，不重复写入。
      return {
        kind: 'messages',
        messages: [buildOutbound('ack', existingAck)]
      }
    }
    if (inputFrozen && !closing && !discarding) {
      return {
        kind: 'messages',
        messages: [
          buildError(
            'STALE_SESSION',
            'handoff not-ready：旧会话仅允许重试未确认写入',
            message.requestId
          )
        ]
      }
    }
    if (parsedPayload.revision !== snapshot.revision + 1) {
      return {
        kind: 'messages',
        messages: [
          buildError(
            'REVISION_MISMATCH',
            `期望 revision ${snapshot.revision + 1}`,
            message.requestId
          )
        ]
      }
    }
    const payloadRecord = message.payload as Record<string, unknown>
    const next: BridgeHostSnapshot = {
      data: message.type === 'change' ? payloadRecord['data'] : snapshot.data,
      progress:
        message.type === 'progress'
          ? payloadRecord['progress']
          : snapshot.progress,
      revision: parsedPayload.revision
    }
    return {
      kind: 'write',
      previous: snapshot,
      next,
      ack: { requestId: message.requestId, revision: next.revision }
    }
  }

  const commitPersistedWriteSync = (
    write: Exclude<RevisionedWriteResult, { messages: BridgeMessage[] }>
  ): BridgeMessage[] => {
    let result: unknown
    try {
      result = options.persist(write.next, write.previous)
    } catch (error) {
      return [
        buildError(
          'ENGINE_FAILURE',
          `持久化失败：${error instanceof Error ? error.message : String(error)}`,
          write.ack.requestId
        )
      ]
    }
    if (isThenable(result)) {
      throw new Error(
        'persist 返回 Promise；请使用 handleWebMessageAsync 以保证 ack 在落盘后发出'
      )
    }
    snapshot = write.next
    persistedRequestIds.set(write.ack.requestId, write.ack)
    return [buildOutbound('ack', write.ack)]
  }

  const commitPersistedWriteAsync = async (
    write: Exclude<RevisionedWriteResult, { messages: BridgeMessage[] }>
  ): Promise<BridgeMessage[]> => {
    try {
      await options.persist(write.next, write.previous)
    } catch (error) {
      // 持久化失败：不确认这次写入，快照保持上一个已确认值。
      snapshot = write.previous
      return [
        buildError(
          'ENGINE_FAILURE',
          `持久化失败：${error instanceof Error ? error.message : String(error)}`,
          write.ack.requestId
        )
      ]
    }
    snapshot = write.next
    persistedRequestIds.set(write.ack.requestId, write.ack)
    return [buildOutbound('ack', write.ack)]
  }

  const validateEnvelope = (
    raw: unknown,
    acceptedBeforeSeal = false
  ):
    | { readonly message: BridgeMessage }
    | { readonly messages: BridgeMessage[] } => {
    const message = parseBridgeMessage(raw)
    if (!message) {
      return {
        messages: [buildError('INVALID_MESSAGE', '消息不是合法桥接包络')]
      }
    }
    if (message.version !== READER_BRIDGE_PROTOCOL_VERSION) {
      return {
        messages: [
          buildError(
            'UNSUPPORTED_VERSION',
            `协议版本 ${message.version} 不受支持`,
            message.requestId
          )
        ]
      }
    }
    if (
      disposed ||
      (!accepting && !acceptedBeforeSeal) ||
      message.sessionId !== options.sessionId
    ) {
      return {
        messages: [buildError('STALE_SESSION', '会话已失效', message.requestId)]
      }
    }
    return { message }
  }

  const handleDrainStatus = (message: BridgeMessage): void => {
    const status = message.payload as Partial<BridgeDrainStatus> | null
    if (!closing || !status || status.flushRequestId !== flushRequestId) return
    if (
      ![
        'input-quiescence',
        'document-work',
        'stable-progress',
        'host-ack',
        'complete'
      ].includes(status.stage ?? '')
    )
      return
    drainStage = status.stage!
    webPending = typeof status.pending === 'number' ? status.pending : null
    inputFrozen = status.inputFrozen === true
    diagnoseDrain('checkpoint')
    // Connection and an empty host queue alone prove nothing about Web
    // gestures/progress. Only this attempt's fully ACKed frozen checkpoint
    // can replace a lost legacy ready notification.
    if (
      status.stage === 'complete' &&
      status.inputFrozen === true &&
      status.pending === 0 &&
      status.revision === snapshot.revision
    ) {
      webDrained = true
      void completeClose()
    }
  }

  const handleValidatedMessage = (
    message: BridgeMessage
  ): BridgeMessage[] | RevisionedWriteResult => {
    switch (message.type) {
      case 'drain-status':
        handleDrainStatus(message)
        return []
      // WebView 首次启动或异常重载都会发 ready；宿主重新下发最后确认快照，
      // restore 完成前 Web 层不得发送 change/progress。
      case 'ready': {
        const checkpoint = message.payload as {
          flushRequestId?: unknown
        } | null
        if (
          checkpoint?.flushRequestId !== undefined &&
          (!closing || checkpoint.flushRequestId !== flushRequestId)
        )
          return []
        // 关闭握手中 Web 用 ready 表示“未确认写入已冲干净”，不回 restore。
        if (closing) {
          webDrained = true
          void completeClose()
          return []
        }
        restoreSent = true
        return [buildRestore()]
      }
      case 'change':
      case 'progress': {
        return prepareRevisionedWrite(
          message,
          message.type === 'change' ? 'data' : 'progress'
        )
      }
      // Web 层上报引擎错误：宿主不改快照，等下一次 ready 重发 restore。
      // 关闭握手期间则视为冲刷失败，撤回关闭。
      case 'error': {
        if (closing) {
          const payload = message.payload as { message?: unknown }
          abortClose(
            typeof payload.message === 'string'
              ? payload.message
              : '关闭前仍有未确认写入'
          )
        }
        return []
      }
      default: {
        // open/restore/command/ack/dispose 是宿主→Web 方向，宿主侧不接收。
        return [
          buildError(
            'INVALID_MESSAGE',
            `宿主不接收 ${message.type} 消息`,
            message.requestId
          )
        ]
      }
    }
  }

  const handleWebMessage = (raw: unknown): BridgeMessage[] => {
    const validated = validateEnvelope(raw)
    if ('messages' in validated) return validated.messages
    try {
      const result = handleValidatedMessage(validated.message)
      if (Array.isArray(result)) return result
      if (result.kind === 'messages') return result.messages
      return commitPersistedWriteSync(result)
    } catch (error) {
      return [
        buildError(
          'ENGINE_FAILURE',
          error instanceof Error ? error.message : String(error),
          validated.message.requestId
        )
      ]
    }
  }

  const handleWebMessageAsync = (raw: unknown): Promise<BridgeMessage[]> => {
    const acceptedBeforeSeal = accepting
    queuedMessages++
    const run = async () => {
      try {
        const validated = validateEnvelope(raw, acceptedBeforeSeal)
        if ('messages' in validated) return validated.messages
        const result = handleValidatedMessage(validated.message)
        if (Array.isArray(result)) return result
        if (result.kind === 'messages') return result.messages
        return await commitPersistedWriteAsync(result)
      } finally {
        queuedMessages--
      }
    }
    const result = asyncQueue.then(run, run)
    // 队列失败不应阻断后续消息；每条消息自身已捕获持久化错误。
    asyncQueue = result.catch(() => undefined)
    return result
  }

  const close = (
    timeoutMs = 5000,
    destroy = true,
    behavior: BridgeCloseBehavior = {}
  ): Promise<BridgeCloseResult> => {
    if (disposed) return Promise.resolve({ status: 'closed' })
    if (fastClosePromise !== null) return fastClosePromise
    if (closePromise !== null) {
      if (destroy && !disposeAfterDrain) {
        return closePromise.then((result) =>
          result.status === 'closed'
            ? close(timeoutMs, destroy, behavior)
            : result
        )
      }
      return closePromise
    }
    if (
      behavior.fastIfNeverWritable &&
      !restoreSent &&
      persistedRequestIds.size === 0
    ) {
      accepting = false
      const pending = (async () => {
        await waitForStableQueue()
        if (!restoreSent && persistedRequestIds.size === 0) {
          disposed = true
          inputFrozen = true
          options.send?.(buildOutbound('dispose', {}))
          return { status: 'closed' as const }
        }
        accepting = true
        fastClosePromise = null
        return close(timeoutMs, destroy, {
          ...behavior,
          fastIfNeverWritable: false
        })
      })()
      fastClosePromise = pending
      return pending
    }
    if (options.send === undefined) {
      return Promise.resolve({
        status: 'unconfirmed',
        reason: '宿主未提供关闭握手通道'
      })
    }
    closeBehavior = behavior
    drainGeneration++
    closing = true
    disposeAfterDrain = destroy
    webDrained = false
    webPending = null
    drainStage = 'final-flush'
    const promise = new Promise<BridgeCloseResult>((resolve) => {
      settleClose = resolve
    })
    closePromise = promise
    closeTimer = setTimeout(() => {
      abortClose('关闭超时：保存屏障尚未确认')
    }, timeoutMs)
    const command = buildOutbound<BridgeCommandPayload>('command', {
      name: BRIDGE_COMMAND_FLUSH,
      drainStatus: true
    })
    flushRequestId = command.requestId
    diagnoseDrain('requested')
    options.send(command)
    return promise
  }

  return {
    discardUnconfirmed: async () => {
      accepting = false
      discarding = true
      if (closing) abortClose('用户选择放弃未确认内容')
      inputFrozen = true
      // Accepted writes retain their original ordering. Never restore an old
      // record over the successful disk result, even on explicit discard.
      await waitForStableQueue()
      disposed = true
      options.send?.(buildOutbound('dispose', {}))
      diagnoseDrain('discarded-unconfirmed')
    },
    handleWebMessage,
    handleWebMessageAsync,
    getSnapshot: () => snapshot,
    resendRestore: () => {
      restoreSent = true
      return [buildRestore()]
    },
    close,
    flush: async (timeoutMs) => {
      const result = await close(timeoutMs, false)
      return result.status === 'closed' ? { status: 'flushed' } : result
    },
    dispose: () => {
      if (settleClose !== null) abortClose('会话已关闭')
      disposed = true
    }
  }
}
