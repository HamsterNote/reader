import { createReaderHostSession } from '../../src/host/readerHostSession'
import { createWebBridgeClient } from '../../webview/src/bridgeClient'
import type { WebBridgeOptions } from '../../webview/src/bridgeClient'
import type { BridgeHostSnapshot } from '../../src/bridge/hostSession'
import type { BridgeMessage } from '../../src/bridge/protocol'

export function createDrainPair(
  options: {
    sessionId?: string
    snapshot?: BridgeHostSnapshot
    quiesce?: WebBridgeOptions['onQuiesce']
    persist?: (snapshot: BridgeHostSnapshot) => Promise<void>
    drop?: (message: BridgeMessage) => boolean
  } = {}
) {
  const sessionId = options.sessionId ?? 'drain-test'
  const webMessages: BridgeMessage[] = []
  const hostMessages: BridgeMessage[] = []
  const web = createWebBridgeClient({
    sessionId,
    sourceToken: 'token',
    onQuiesce: options.quiesce,
    post: (raw) => {
      const message = JSON.parse(raw) as BridgeMessage
      webMessages.push(message)
      if (!options.drop?.(message)) {
        host.handleRawMessage(raw)
      }
    }
  })
  const host = createReaderHostSession({
    sessionId,
    sourceToken: 'token',
    descriptor: {
      fileId: sessionId,
      format: 'pdf',
      fileUrl: 'file:///book.pdf'
    },
    confirmedSnapshot: options.snapshot ?? null,
    persist: options.persist ?? (async () => {}),
    sendToWeb: (message) => {
      hostMessages.push(message)
      web.handleMessage(message)
    }
  })
  return {
    host,
    web,
    webMessages,
    hostMessages,
    dispose: () => {
      web.dispose()
      host.dispose()
    }
  }
}
