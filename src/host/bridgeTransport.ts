// Expo 宿主侧的 WebView 传输层校验。协议包络由 src/bridge/protocol.ts 定义；
// 这一层额外要求消息携带宿主注入的 sourceToken，用来拒绝非受控页面/伪造
// postMessage。token 只存在于当前 WebView 与宿主之间，不写入持久化数据。

import {
  parseBridgeMessage,
  type BridgeErrorCode,
  type BridgeMessage
} from '../bridge/protocol'

export type BridgeTransportFailure = {
  readonly ok: false
  readonly code: BridgeErrorCode
  readonly message: string
}

export type BridgeTransportResult =
  | { readonly ok: true; readonly message: BridgeMessage }
  | BridgeTransportFailure

export const READER_BRIDGE_SOURCE_TOKEN_FIELD = 'sourceToken'

/** 单条桥接消息上限。文档内容不得走消息体，因此超过 1 MiB 视为异常。 */
export const READER_BRIDGE_MAX_MESSAGE_BYTES = 1024 * 1024

/**
 * 校验原始 postMessage 字符串：大小、JSON、sourceToken、协议包络。
 * 会话匹配和方向校验由 createBridgeHostSession 继续负责。
 */
export function parseHostBridgeTransport(
  raw: unknown,
  options: {
    readonly sourceToken: string
    readonly maxBytes?: number
  }
): BridgeTransportResult {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'INVALID_MESSAGE', message: '消息必须是字符串' }
  }
  if (raw.length > (options.maxBytes ?? READER_BRIDGE_MAX_MESSAGE_BYTES)) {
    return { ok: false, code: 'INVALID_MESSAGE', message: '消息超过大小上限' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      message: '消息不是合法 JSON'
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      message: '消息不是合法桥接对象'
    }
  }
  if (
    Reflect.get(parsed, READER_BRIDGE_SOURCE_TOKEN_FIELD) !==
    options.sourceToken
  ) {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      message: '消息来源 token 不匹配'
    }
  }

  const message = parseBridgeMessage(parsed)
  if (!message) {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      message: '消息不是合法桥接包络'
    }
  }
  return { ok: true, message }
}
