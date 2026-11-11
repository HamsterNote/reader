/** Optional authenticated rollover; protocol v1 document messages stay unchanged. */
export type ReaderSessionReplacement = {
  readonly type: 'reader:replace-session'
  readonly version: 1
  readonly sourceToken: string
  readonly previousSessionId: string
  readonly sessionId: string
  readonly requestId: string
}
export function parseReaderSessionReplacement(
  raw: unknown,
  current: { sessionId: string; sourceToken: string }
): ReaderSessionReplacement | null {
  let value: unknown = raw
  try {
    if (typeof value === 'string') value = JSON.parse(value)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    record.type !== 'reader:replace-session' ||
    record.version !== 1 ||
    record.sourceToken !== current.sourceToken ||
    record.previousSessionId !== current.sessionId ||
    typeof record.sessionId !== 'string' ||
    !record.sessionId ||
    record.sessionId === current.sessionId ||
    typeof record.requestId !== 'string' ||
    !record.requestId
  )
    return null
  return record as ReaderSessionReplacement
}
