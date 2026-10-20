// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.3。
// 桥接协议宿主侧参考实现：宿主持有唯一已确认快照，按协议状态机处理
// ready/change/progress/error/dispose。契约测试见 test/bridge-contract.test.ts。
// 本实现不依赖 WebView/DOM，Expo 宿主主线把它绑定到真实 postMessage 通道。

import {
  buildBridgeError,
  parseBridgeMessage,
  parseRevisionedPayload,
  READER_BRIDGE_PROTOCOL_VERSION,
  type BridgeAckPayload,
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
  /** 持久化写入；只在消息通过全部校验后调用，每次逻辑写入恰好一次。 */
  readonly persist: (snapshot: BridgeHostSnapshot) => void
}

export type BridgeHostSession = {
  /**
   * 处理一条来自 Web 层的原始消息，返回需要发回 Web 层的消息
   * （restore / ack / error），无任何输出时返回空数组。
   */
  readonly handleWebMessage: (raw: unknown) => BridgeMessage[]
  /** 当前已确认快照（只读视图）。 */
  readonly getSnapshot: () => BridgeHostSnapshot
  /** 结束会话；之后所有该会话消息按 STALE_SESSION 拒绝。 */
  readonly dispose: () => void
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
  // 已持久化的 requestId → ack payload，用于重复投递幂等应答。
  const persistedRequestIds = new Map<string, BridgeAckPayload>()
  let outboundCounter = 0

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
    code: Parameters<typeof buildBridgeError>[2],
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

  // change/progress 共享写入路径：restore 前置校验、requestId 幂等、
  // revision 递增校验，全部通过后恰好持久化一次并应答 ack。
  const handleRevisionedWrite = (
    message: BridgeMessage,
    dataKey: 'data' | 'progress'
  ): BridgeMessage[] => {
    const parsedPayload = parseRevisionedPayload(message.payload, dataKey)
    if (!parsedPayload) {
      return [
        buildError(
          'INVALID_MESSAGE',
          'payload 缺少数据或 revision',
          message.requestId
        )
      ]
    }
    if (!restoreSent) {
      // 初始化不清空数据：restore 未下发前的写入一律拒绝且不持久化。
      return [
        buildError(
          'RESTORE_PENDING',
          'restore 完成前不得回写',
          message.requestId
        )
      ]
    }
    const existingAck = persistedRequestIds.get(message.requestId)
    if (existingAck) {
      // 重复投递幂等：重新应答 ack，不重复写入。
      return [buildOutbound('ack', existingAck)]
    }
    if (parsedPayload.revision !== snapshot.revision + 1) {
      return [
        buildError(
          'REVISION_MISMATCH',
          `期望 revision ${snapshot.revision + 1}`,
          message.requestId
        )
      ]
    }
    const payloadRecord = message.payload as Record<string, unknown>
    snapshot = {
      data: message.type === 'change' ? payloadRecord['data'] : snapshot.data,
      progress:
        message.type === 'progress'
          ? payloadRecord['progress']
          : snapshot.progress,
      revision: parsedPayload.revision
    }
    options.persist(snapshot)
    const ack: BridgeAckPayload = {
      requestId: message.requestId,
      revision: snapshot.revision
    }
    persistedRequestIds.set(message.requestId, ack)
    return [buildOutbound('ack', ack)]
  }

  const handleWebMessage = (raw: unknown): BridgeMessage[] => {
    const message = parseBridgeMessage(raw)
    if (!message) {
      return [buildError('INVALID_MESSAGE', '消息不是合法桥接包络')]
    }
    if (message.version !== READER_BRIDGE_PROTOCOL_VERSION) {
      return [
        buildError(
          'UNSUPPORTED_VERSION',
          `协议版本 ${message.version} 不受支持`,
          message.requestId
        )
      ]
    }
    if (disposed || message.sessionId !== options.sessionId) {
      return [buildError('STALE_SESSION', '会话已失效', message.requestId)]
    }

    switch (message.type) {
      // WebView 首次启动或异常重载都会发 ready；宿主重新下发最后确认快照，
      // restore 完成前 Web 层不得发送 change/progress。
      case 'ready': {
        restoreSent = true
        return [buildRestore()]
      }
      case 'change':
      case 'progress': {
        return handleRevisionedWrite(
          message,
          message.type === 'change' ? 'data' : 'progress'
        )
      }
      // Web 层上报引擎错误：宿主不改快照，等下一次 ready 重发 restore。
      case 'error': {
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

  return {
    handleWebMessage,
    getSnapshot: () => snapshot,
    dispose: () => {
      disposed = true
    }
  }
}
