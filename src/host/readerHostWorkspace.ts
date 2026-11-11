import {
  createReaderHostSession,
  type ReaderHostSessionOptions
} from './readerHostSession'
import { parseHostBridgeTransport } from './bridgeTransport'
import type { ReaderSessionReplacement } from '../bridge/sessionReplacement'

/** One persistent transport/WebView; each document has an isolated v1 session. */
export function createReaderHostWorkspace(
  options: ReaderHostSessionOptions & {
    readonly reload: (
      document: ReaderHostSessionOptions['descriptor'],
      error: string
    ) => Promise<void>
    readonly sendReplacement: (message: ReaderSessionReplacement) => void
    readonly readyTimeoutMs?: number
  }
) {
  let activeOptions = options
  let active = createReaderHostSession(options)
  let pending = false
  let ready:
    | { sessionId: string; resolve: () => void; reject: (error: Error) => void }
    | undefined
  const reloaded = new Set<string>()
  const usedSessions = new Set([options.sessionId])
  async function reloadOnce(config: ReaderHostSessionOptions, error: string) {
    if (reloaded.has(config.sessionId)) return
    reloaded.add(config.sessionId)
    await options.reload(config.descriptor, error)
  }
  async function documentFailure(
    config: ReaderHostSessionOptions,
    payload: unknown
  ) {
    const failure = payload as {
      code?: unknown
      stage?: unknown
      message?: unknown
    } | null
    if (
      failure?.code !== 'ENGINE_FAILURE' ||
      failure.stage !== 'document' ||
      typeof failure.message !== 'string'
    )
      return
    if (ready?.sessionId === config.sessionId)
      ready.reject(new Error(failure.message))
    else await reloadOnce(config, failure.message)
  }
  return {
    handleRawMessage: async (raw: unknown) => {
      const session = active
      const config = activeOptions
      const parsed = parseHostBridgeTransport(raw, {
        sourceToken: options.sourceToken
      })
      if (
        parsed.ok &&
        parsed.message.sessionId === config.sessionId &&
        parsed.message.version === 1 &&
        parsed.message.type === 'document-ready'
      ) {
        if (ready?.sessionId === config.sessionId) ready.resolve()
        return { accepted: true }
      }
      const result = await session.handleRawMessage(raw)
      if (
        result.accepted &&
        session === active &&
        parsed.ok &&
        parsed.message.type === 'error'
      )
        await documentFailure(config, parsed.message.payload)
      return result
    },
    getSession: () => active,
    async replaceDocument(
      next: Omit<ReaderHostSessionOptions, 'sourceToken' | 'sendToWeb'>,
      timeoutMs?: number
    ) {
      if (pending) throw new Error('A document handoff is already pending')
      if (usedSessions.has(next.sessionId))
        throw new Error('A new document requires a fresh sessionId')
      pending = true
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await active.close(timeoutMs)
        if (result.status !== 'closed') return result
        const previousSessionId = activeOptions.sessionId
        activeOptions = { ...options, ...next }
        active = createReaderHostSession(activeOptions)
        usedSessions.add(next.sessionId)
        try {
          await new Promise<void>((resolve, reject) => {
            ready = { sessionId: next.sessionId, resolve, reject }
            timer = setTimeout(
              () => reject(new Error('Reader restoration timed out')),
              options.readyTimeoutMs ?? 30000
            )
            options.sendReplacement({
              type: 'reader:replace-session',
              version: 1,
              sourceToken: options.sourceToken,
              previousSessionId,
              sessionId: next.sessionId,
              requestId: `replace-${next.sessionId}`
            })
          })
          return { status: 'replaced' as const }
        } catch (error) {
          await reloadOnce(activeOptions, String(error))
          return { status: 'reloaded' as const }
        }
      } finally {
        clearTimeout(timer)
        ready = undefined
        pending = false
      }
    }
  }
}
