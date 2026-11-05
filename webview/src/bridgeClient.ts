// Web 阅读层桥接客户端。负责：启动 ready、等待 restore、按会话递增 revision
// 回写 change/progress、未确认消息定时重发（同一 requestId 幂等）、
// 处理 ack/error/dispose。协议定义见 src/bridge/protocol.ts。

import {
  BRIDGE_COMMAND_FLUSH,
  BRIDGE_COMMAND_RESUME,
  parseBridgeMessage,
  READER_BRIDGE_PROTOCOL_VERSION,
  type BridgeAckPayload,
  type BridgeCommandPayload,
  type BridgeErrorPayload,
  type BridgeMessage,
  type BridgeMessageType,
  type BridgeOpenPayload,
  type BridgeRestorePayload
} from '../../src/bridge/protocol'
import { READER_BRIDGE_SOURCE_TOKEN_FIELD } from '../../src/host/bridgeTransport'

export type WebBridgeTimers = {
  readonly setTimeout: (callback: () => void, ms: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

export type WebBridgeOptions = {
  readonly sessionId: string
  readonly sourceToken: string
  readonly post: (raw: string) => void
  /**
   * 当前 Web 上下文唯一的客户端标识，作为 requestId 前缀。
   * 页面重载会创建新客户端：没有它，新客户端会从 0 重新计数，
   * 与宿主幂等表里的旧 requestId 冲突，导致新写入被当成重复投递丢弃。
   * 默认随机生成；测试可注入固定值。
   */
  readonly clientId?: string
  readonly retryTimeoutMs?: number
  readonly timers?: WebBridgeTimers
  readonly onOpen?: (payload: BridgeOpenPayload) => void
  readonly onRestore?: (payload: BridgeRestorePayload) => void
  readonly onError?: (payload: BridgeErrorPayload) => void
  readonly onDispose?: () => void
  /**
   * 关闭冲刷开始/结束。UI 必须据此冻结输入；冻结期间产生的修改仍会入队，
   * 但不应再产生新的编辑手势。
   */
  readonly onDrainingChange?: (draining: boolean) => void
  /**
   * 关闭冲刷前的输入静默：UI 必须冻结输入，并等正在进行的手势完成提交
   * （提交产生的 change 会先入队）。未提供时视为已静默。
   */
  readonly onQuiesce?: () => Promise<void>
}

export type WebBridgeClient = {
  readonly start: () => void
  readonly handleMessage: (raw: unknown) => void
  readonly sendChange: (data: unknown) => void
  readonly sendProgress: (progress: unknown) => void
  /** 主动重新握手：用于协议错误或 WebView 恢复后的重同步。 */
  readonly resync: () => void
  readonly dispose: () => void
  readonly getRevision: () => number | null
  readonly getPendingCount: () => number
  /**
   * 等待未确认写入（pending + in-flight）全部收到 ack。
   * 超时或会话已关闭返回 false——调用方不得据此声称已保存。
   */
  readonly flushPending: (timeoutMs?: number) => Promise<boolean>
}

type PendingWrite = {
  readonly type: 'change' | 'progress'
  readonly payload: unknown
}

const DEFAULT_RETRY_TIMEOUT_MS = 3000
const DEFAULT_FLUSH_TIMEOUT_MS = 2000

let fallbackCounter = 0

function createClientId(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `c-${cryptoApi.randomUUID()}`
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    let hex = ''
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, '0')
    }
    return `c-${hex}`
  }
  // 无 crypto 的极端环境：计数 + 时间戳，保证同进程内两次加载不同。
  fallbackCounter += 1
  return `c-${Date.now().toString(36)}-${fallbackCounter}`
}

function defaultTimers(): WebBridgeTimers {
  return {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as number)
    }
  }
}

export function createWebBridgeClient(
  options: WebBridgeOptions
): WebBridgeClient {
  const timers = options.timers ?? defaultTimers()
  const retryTimeoutMs = options.retryTimeoutMs ?? DEFAULT_RETRY_TIMEOUT_MS
  const clientId = options.clientId ?? createClientId()
  let revision: number | null = null
  let started = false
  let closed = false
  let draining = false
  let drainGeneration = 0

  const setDraining = (value: boolean): void => {
    if (draining === value) return
    draining = value
    options.onDrainingChange?.(value)
  }
  let requestCounter = 0
  let inFlight: {
    readonly message: BridgeMessage
    readonly raw: string
  } | null = null
  let retryHandle: unknown
  let pendingChange: PendingWrite | null = null
  let pendingProgress: PendingWrite | null = null
  let idleWaiters: Array<(saved: boolean) => void> = []

  /** 未确认写入全部 ack（或会话关闭）。 */
  const isIdle = (): boolean =>
    inFlight === null && pendingChange === null && pendingProgress === null

  const settleIdle = (saved: boolean): void => {
    if (!isIdle()) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve(saved)
  }

  /**
   * 等待 pending + in-flight 全部 ack。超时/会话关闭返回 false——
   * 调用方不得据此声称已保存。
   */
  const flushPendingNow = (timeoutMs?: number): Promise<boolean> => {
    if (closed) return Promise.resolve(false)
    if (isIdle()) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let settled = false
      const timeout: { handle?: unknown } = {}
      const finish = (saved: boolean): void => {
        if (settled) return
        settled = true
        if (timeout.handle !== undefined) timers.clearTimeout(timeout.handle)
        resolve(saved)
      }
      timeout.handle = timers.setTimeout(
        () => finish(false),
        timeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS
      )
      idleWaiters.push(finish)
    })
  }

  /**
   * 关闭前的输入静默等待：等 UI 冻结输入并结束（提交）当前手势。
   * 超时视为未静默，由调用方发 error 取消关闭，不猜测手势是否结束。
   */
  const waitForQuiesce = (): Promise<boolean> => {
    const quiesce = options.onQuiesce
    if (quiesce === undefined) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let settled = false
      const timeout: { handle?: unknown } = {}
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        if (timeout.handle !== undefined) timers.clearTimeout(timeout.handle)
        resolve(ok)
      }
      timeout.handle = timers.setTimeout(
        () => finish(false),
        DEFAULT_FLUSH_TIMEOUT_MS
      )
      quiesce().then(
        () => finish(true),
        () => finish(false)
      )
    })
  }

  const post = (message: BridgeMessage): void => {
    options.post(
      JSON.stringify({
        ...message,
        [READER_BRIDGE_SOURCE_TOKEN_FIELD]: options.sourceToken
      })
    )
  }

  const buildMessage = (
    type: BridgeMessageType,
    payload: unknown
  ): BridgeMessage => {
    requestCounter += 1
    return {
      version: READER_BRIDGE_PROTOCOL_VERSION,
      sessionId: options.sessionId,
      // requestId 以客户端标识为前缀：只有同一客户端重发同一消息才复用
      // requestId（见 armRetry），重载后的新客户端不会撞上宿主的幂等表。
      requestId: `${clientId}-${requestCounter}`,
      type,
      payload
    }
  }

  const clearRetry = (): void => {
    if (retryHandle !== undefined) {
      timers.clearTimeout(retryHandle)
      retryHandle = undefined
    }
  }

  const armRetry = (): void => {
    clearRetry()
    if (!inFlight) return
    retryHandle = timers.setTimeout(() => {
      // 同一 requestId/同一 revision 重发；宿主按 requestId 幂等。
      if (inFlight && !closed) options.post(inFlight.raw)
      armRetry()
    }, retryTimeoutMs)
  }

  const flush = (): void => {
    if (closed || inFlight || revision === null) return
    const pending = pendingChange ?? pendingProgress
    if (!pending) return
    if (pending === pendingChange) pendingChange = null
    else pendingProgress = null
    const nextRevision = revision + 1
    const message = buildMessage(pending.type, {
      [pending.type === 'change' ? 'data' : 'progress']: pending.payload,
      revision: nextRevision
    })
    const raw = JSON.stringify({
      ...message,
      [READER_BRIDGE_SOURCE_TOKEN_FIELD]: options.sourceToken
    })
    inFlight = { message, raw }
    options.post(raw)
    armRetry()
  }

  const enqueue = (write: PendingWrite): void => {
    // 关闭冲刷期间的修改继续入队并纳入 ack 屏障，不能静默丢弃；
    // 真正阻止新输入的是 UI 侧的冻结遮罩（onDrainingChange）。
    if (closed) return
    if (write.type === 'change') pendingChange = write
    else pendingProgress = write
    flush()
  }

  const handleAck = (payload: BridgeAckPayload): void => {
    if (!inFlight || inFlight.message.requestId !== payload.requestId) return
    clearRetry()
    revision = payload.revision
    inFlight = null
    flush()
    settleIdle(true)
  }

  const start = (): void => {
    if (started || closed) return
    started = true
    post(buildMessage('ready', {}))
  }

  const resync = (): void => {
    if (closed) return
    clearRetry()
    inFlight = null
    revision = null
    started = true
    post(buildMessage('ready', {}))
  }

  const handleMessage = (raw: unknown): void => {
    if (closed) return
    const parsed = typeof raw === 'string' ? safeParse(raw) : raw
    const message = parseBridgeMessage(parsed)
    if (!message || message.sessionId !== options.sessionId) return
    if (message.version !== READER_BRIDGE_PROTOCOL_VERSION) return

    switch (message.type) {
      case 'open': {
        options.onOpen?.(message.payload as BridgeOpenPayload)
        break
      }
      case 'restore': {
        const payload = message.payload as BridgeRestorePayload
        revision = payload.revision
        options.onRestore?.(payload)
        flush()
        break
      }
      case 'ack': {
        handleAck(message.payload as BridgeAckPayload)
        break
      }
      case 'error': {
        const payload = message.payload as BridgeErrorPayload
        options.onError?.(payload)
        if (payload.code === 'REVISION_MISMATCH') {
          // 宿主与 Web 的 revision 失步：重新握手拿最后确认快照。
          resync()
        }
        break
      }
      case 'command': {
        const command = message.payload as BridgeCommandPayload
        if (command?.name === BRIDGE_COMMAND_FLUSH) {
          // 宿主准备关闭：先冻结输入并等当前手势提交（onQuiesce），再冲刷
          // 全部未确认写入；全部 ack 后回 ready，才允许宿主 dispose。
          const token = ++drainGeneration
          setDraining(true)
          waitForQuiesce().then((quiesced) => {
            if (closed || token !== drainGeneration) return
            if (!quiesced) {
              post(
                buildMessage('error', {
                  code: 'ENGINE_FAILURE',
                  message: '关闭前输入未静默，已取消关闭'
                })
              )
              return
            }
            return flushPendingNow(DEFAULT_FLUSH_TIMEOUT_MS).then((saved) => {
              if (closed || token !== drainGeneration) return
              if (saved) {
                post(buildMessage('ready', {}))
              } else {
                post(
                  buildMessage('error', {
                    code: 'ENGINE_FAILURE',
                    message: '关闭前仍有未确认写入，已取消关闭'
                  })
                )
              }
            })
          })
        } else if (command?.name === BRIDGE_COMMAND_RESUME) {
          drainGeneration++
          setDraining(false)
        }
        break
      }
      case 'dispose': {
        closed = true
        clearRetry()
        pendingChange = null
        pendingProgress = null
        inFlight = null
        settleIdle(false)
        setDraining(false)
        options.onDispose?.()
        break
      }
      default:
        break
    }
  }

  return {
    start,
    handleMessage,
    sendChange: (data) => {
      enqueue({ type: 'change', payload: data })
    },
    sendProgress: (progress) => {
      enqueue({ type: 'progress', payload: progress })
    },
    resync,
    dispose: () => {
      closed = true
      clearRetry()
      pendingChange = null
      pendingProgress = null
      inFlight = null
      setDraining(false)
    },
    getRevision: () => revision,
    getPendingCount: () => {
      const pending =
        (pendingChange ? 1 : 0) + (pendingProgress ? 1 : 0) + (inFlight ? 1 : 0)
      return pending
    },
    flushPending: flushPendingNow
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
