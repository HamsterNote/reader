// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.3。
// WebView 桥接协议的规范性定义：消息包络、类型、错误码与结构校验。
// 语义与状态机见同目录 hostSession.ts 与
// openspec/changes/migrate-reader-to-expo-webview/contracts/bridge-protocol.md。
// EPUB/PDF/Expo 三条主线 MUST 使用这里固定的字段名与枚举值。

/** 当前协议版本。宿主与 Web 层不一致时以 UNSUPPORTED_VERSION 拒绝。 */
export const READER_BRIDGE_PROTOCOL_VERSION = 1

/**
 * 桥接消息类型。
 * - Web→Host：ready / change / progress / error
 * - Host→Web：open / restore / command / ack / error / dispose
 */
export type BridgeMessageType =
  | 'ready'
  | 'open'
  | 'restore'
  | 'command'
  | 'change'
  | 'progress'
  | 'ack'
  | 'error'
  | 'dispose'

export type BridgeErrorCode =
  /** version 与宿主支持的协议版本不一致。 */
  | 'UNSUPPORTED_VERSION'
  /** sessionId 不是当前活动会话（文档已切换或会话已 dispose）。 */
  | 'STALE_SESSION'
  /** restore 尚未下发时收到 change/progress；宿主不得持久化该消息。 */
  | 'RESTORE_PENDING'
  /** payload.revision 不是宿主期望的下一个递增序号。 */
  | 'REVISION_MISMATCH'
  /** 消息不是合法包络或 payload 形状不符合类型要求。 */
  | 'INVALID_MESSAGE'
  /** Web 层上报的引擎错误（加载/渲染失败）；宿主保留最后确认快照。 */
  | 'ENGINE_FAILURE'

export type BridgeMessage<TPayload = unknown> = {
  readonly version: number
  readonly sessionId: string
  /** 同一逻辑操作的唯一标识；重复投递用 requestId 去重。 */
  readonly requestId: string
  readonly type: BridgeMessageType
  readonly payload: TPayload
}

/** change 的 payload：全量文档数据快照 + 递增 revision（会话内从 1 开始）。 */
export type BridgeChangePayload = {
  readonly data: unknown
  readonly revision: number
}

/** progress 的 payload：阅读进度切片 + 与 change 共享的递增 revision。 */
export type BridgeProgressPayload = {
  readonly progress: unknown
  readonly revision: number
}

/** restore 的 payload：宿主最后确认快照；无历史数据时 data/progress 为 null。 */
export type BridgeRestorePayload = {
  readonly data: unknown
  readonly progress: unknown
  readonly revision: number
}

/** ack 的 payload：确认对应 requestId 已按 revision 持久化。 */
export type BridgeAckPayload = {
  readonly requestId: string
  readonly revision: number
}

export type BridgeErrorPayload = {
  readonly code: BridgeErrorCode
  readonly message: string
  /** 触发错误的原始消息 requestId；无法解析时缺省。 */
  readonly requestId?: string
}

/** open 的 payload：文档描述。文件内容经宿主受控 URL/描述符交付，不走消息体。 */
export type BridgeOpenPayload = {
  readonly document: {
    readonly fileId: string
    readonly format: 'epub' | 'pdf'
    readonly fileUrl: string
  }
}

const MESSAGE_TYPES: readonly BridgeMessageType[] = [
  'ready',
  'open',
  'restore',
  'command',
  'change',
  'progress',
  'ack',
  'error',
  'dispose'
]

/** 结构校验：只认完整包络；不合法返回 null，由接收方按 INVALID_MESSAGE 处理。 */
export function parseBridgeMessage(value: unknown): BridgeMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const { version, sessionId, requestId, type } = record
  if (
    typeof version !== 'number' ||
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    typeof requestId !== 'string' ||
    requestId.length === 0 ||
    typeof type !== 'string' ||
    !MESSAGE_TYPES.includes(type as BridgeMessageType)
  ) {
    return null
  }
  return {
    version,
    sessionId,
    requestId,
    type: type as BridgeMessageType,
    payload: record['payload']
  }
}

/** change/progress payload 校验：revision 必须是整数，数据字段必须存在。 */
export function parseRevisionedPayload(
  payload: unknown,
  dataKey: 'data' | 'progress'
): { revision: number } | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null
  }
  const record = payload as Record<string, unknown>
  if (!(dataKey in record)) return null
  const revision = record['revision']
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
    return null
  }
  return { revision }
}

export function buildBridgeError(
  sessionId: string,
  requestId: string,
  code: BridgeErrorCode,
  message: string,
  causeRequestId?: string
): BridgeMessage<BridgeErrorPayload> {
  return {
    version: READER_BRIDGE_PROTOCOL_VERSION,
    sessionId,
    requestId,
    type: 'error',
    payload: {
      code,
      message,
      ...(causeRequestId === undefined ? {} : { requestId: causeRequestId })
    }
  }
}
