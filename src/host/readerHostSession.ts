// 单文档的宿主桥接会话：把 WebView 的原始消息接到 HAM-87 契约状态机，
// 负责 open/restore 下发、ack/error 回传、reload 后重发快照与 dispose。
// WebView 组件只负责通道；状态与持久化都在这里，避免 UI 重渲染丢数据。

import {
  createBridgeHostSession,
  type BridgeCloseResult,
  type BridgeFlushResult,
  type BridgeHostSession,
  type BridgeHostSnapshot
} from '../bridge/hostSession'
import {
  READER_BRIDGE_PROTOCOL_VERSION,
  type BridgeMessage
} from '../bridge/protocol'
import { parseHostBridgeTransport } from './bridgeTransport'
import type { HostDocumentFormat } from './fileIdentity'

export type HostDocumentDescriptor = {
  readonly fileId: string
  readonly format: HostDocumentFormat
  readonly fileUrl: string
}

export type HostBridgeRejection = {
  readonly code: string
  readonly message: string
}

export type ReaderHostSessionOptions = {
  readonly sessionId: string
  readonly sourceToken: string
  readonly descriptor: HostDocumentDescriptor
  readonly confirmedSnapshot: BridgeHostSnapshot | null
  readonly persist: (snapshot: BridgeHostSnapshot) => Promise<void>
  readonly sendToWeb: (message: BridgeMessage) => void
}

export type ReaderHostSession = {
  readonly flush: (timeoutMs?: number) => Promise<BridgeFlushResult>
  /** 处理 WebView postMessage 原始字符串；返回是否通过来源/结构校验。 */
  readonly handleRawMessage: (raw: unknown) => Promise<{
    readonly accepted: boolean
    readonly rejection?: HostBridgeRejection
  }>
  readonly getSnapshot: () => BridgeHostSnapshot
  /** 文档切换/关闭：先通知 Web 释放资源，再使会话失效。 */
  readonly dispose: () => void
  /**
   * 关闭握手：请求 Web 冲刷未确认写入，等其确认与本地落盘完成后下发 dispose。
   * 返回 `unconfirmed` 时会话仍可用，调用方必须阻止关闭并提示用户重试。
   */
  readonly close: (timeoutMs?: number) => Promise<BridgeCloseResult>
}

export function createReaderHostSession(
  options: ReaderHostSessionOptions
): ReaderHostSession {
  const session: BridgeHostSession = createBridgeHostSession({
    sessionId: options.sessionId,
    confirmedSnapshot: options.confirmedSnapshot,
    persist: options.persist,
    send: options.sendToWeb
  })
  let disposed = false
  let closing = false
  let outboundCounter = 0

  const nextRequestId = (prefix: string): string => {
    outboundCounter += 1
    return `host-${prefix}-${outboundCounter}`
  }

  const buildOpenMessage = (): BridgeMessage => ({
    version: READER_BRIDGE_PROTOCOL_VERSION,
    sessionId: options.sessionId,
    requestId: nextRequestId('open'),
    type: 'open',
    payload: {
      document: {
        fileId: options.descriptor.fileId,
        format: options.descriptor.format,
        fileUrl: options.descriptor.fileUrl
      }
    }
  })

  const sendOpen = (): void => {
    // 每次 ready（含 WebView 重载）都重新下发文档描述，页面重新加载后
    // 不能依赖上一次 JS 上下文里的 descriptor。
    options.sendToWeb(buildOpenMessage())
  }

  const sendAll = (messages: readonly BridgeMessage[]): void => {
    for (const message of messages) options.sendToWeb(message)
  }

  return {
    handleRawMessage: async (raw) => {
      if (disposed) {
        return {
          accepted: false,
          rejection: { code: 'STALE_SESSION', message: '会话已关闭' }
        }
      }
      const transport = parseHostBridgeTransport(raw, {
        sourceToken: options.sourceToken
      })
      if (!transport.ok) {
        return {
          accepted: false,
          rejection: { code: transport.code, message: transport.message }
        }
      }
      if (transport.message.sessionId !== options.sessionId) {
        return {
          accepted: false,
          rejection: { code: 'STALE_SESSION', message: '消息来自旧会话' }
        }
      }
      // Web 第一次 ready（或重载后的 ready）之前先补发文档描述，
      // 随后状态机返回最后确认快照，顺序固定为 open → restore。
      if (transport.message.type === 'ready' && !closing) sendOpen()
      const messages = await session.handleWebMessageAsync(transport.message)
      sendAll(messages)
      return { accepted: true }
    },
    getSnapshot: () => session.getSnapshot(),
    flush: (timeoutMs) => session.flush(timeoutMs),
    close: async (timeoutMs) => {
      if (disposed) return { status: 'closed' }
      closing = true
      const result = await session.close(timeoutMs)
      if (result.status === 'closed') {
        disposed = true
      } else {
        closing = false
      }
      return result
    },
    dispose: () => {
      session.dispose()
      disposed = true
    }
  }
}
