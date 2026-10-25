// Web 阅读层桥接客户端。负责：启动 ready、等待 restore、按会话递增 revision
// 回写 change/progress、未确认消息定时重发（同一 requestId 幂等）、
// 处理 ack/error/dispose。协议定义见 src/bridge/protocol.ts。

import {
  parseBridgeMessage,
  READER_BRIDGE_PROTOCOL_VERSION,
  type BridgeAckPayload,
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
}

type PendingWrite = {
  readonly type: 'change' | 'progress'
  readonly payload: unknown
}

const DEFAULT_RETRY_TIMEOUT_MS = 3000

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
  let requestCounter = 0
  let inFlight: {
    readonly message: BridgeMessage
    readonly raw: string
  } | null = null
  let retryHandle: unknown
  let pendingChange: PendingWrite | null = null
  let pendingProgress: PendingWrite | null = null

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
      case 'dispose': {
        closed = true
        clearRetry()
        pendingChange = null
        pendingProgress = null
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
    },
    getRevision: () => revision,
    getPendingCount: () => {
      const pending =
        (pendingChange ? 1 : 0) + (pendingProgress ? 1 : 0) + (inFlight ? 1 : 0)
      return pending
    }
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
