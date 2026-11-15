const diagnosticsGlobals = globalThis as typeof globalThis & {
  __DEV__?: boolean
  __READER_NATIVE_PDF_DIAGNOSTICS__?: boolean
}

const SENSITIVE_KEYS = new Set([
  'sourcetoken',
  'sessiontoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'password',
  'secret',
  'apikey',
  'credential',
  'credentials'
])

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen))
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.replace(/[-_]/g, '').toLowerCase())) continue
    result[key] = sanitize(item, seen)
  }
  return result
}

export function logNativePdfDiagnostic(
  message: string,
  payload?: unknown
): void {
  if (
    diagnosticsGlobals.__DEV__ !== true &&
    diagnosticsGlobals.__READER_NATIVE_PDF_DIAGNOSTICS__ !== true
  )
    return
  console.info(message, sanitize(payload, new WeakSet()))
}
