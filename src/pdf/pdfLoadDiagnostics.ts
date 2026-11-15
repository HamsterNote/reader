/** Opt-in per Web PDF open. No document bytes, paths, text or annotation data. */
const contexts = new WeakMap<object, PdfLoadDiagnostics>()
const PREFIX = 'reader-pdf-load'
const MESSAGE_TYPE = 'reader-pdf-load-diagnostic'
let opens = 0

type Details = Readonly<Record<string, number | boolean>>

export type PdfLoadDiagnostics = {
  readonly event: (stage: string, details?: Details) => void
  readonly viewer: () => (stage: string, details?: Details) => void
}

export function createPdfLoadDiagnostics(
  mirror?: (line: string) => void
): PdfLoadDiagnostics {
  const runId = `${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}-${++opens}`
  const started = performance.now()
  let sequence = 0
  let viewers = 0
  const event = (stage: string, details: Details = {}): void => {
    const line = `${PREFIX} ${JSON.stringify({
      runId,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      stage,
      ...details
    })}`
    // Diagnostics must never turn a successful load/render into an error.
    try {
      console.info(line)
    } catch {
      /* Console may be disconnected during process teardown. */
    }
    try {
      mirror?.(line)
    } catch {
      /* A closed native transport must not affect the reader. */
    }
  }
  return {
    event,
    viewer: () => {
      const viewerId = ++viewers
      let renderCount = 0
      return (stage, details) => {
        if (stage === 'pagerendered') renderCount++
        event(stage, { ...details, viewerId, renderCount })
      }
    }
  }
}

export function attachPdfLoadDiagnostics(
  source: object,
  diagnostics: PdfLoadDiagnostics | undefined
): void {
  if (diagnostics) contexts.set(source, diagnostics)
}

export function getPdfLoadDiagnostics(
  source: object
): PdfLoadDiagnostics | undefined {
  return contexts.get(source)
}

/** Dedicated diagnostic envelope; never passed to the persistence bridge. */
export function pdfLoadDiagnosticMessage(
  line: string,
  sessionId: string,
  sourceToken: string
): string {
  return JSON.stringify({ type: MESSAGE_TYPE, sessionId, sourceToken, line })
}

export function readPdfLoadDiagnosticMessage(
  raw: string,
  sessionId: string,
  sourceToken: string
): string | null {
  if (raw.length > 4096) return null
  try {
    const value = JSON.parse(raw)
    return value?.type === MESSAGE_TYPE &&
      value.sessionId === sessionId &&
      value.sourceToken === sourceToken &&
      typeof value.line === 'string' &&
      value.line.startsWith(`${PREFIX} `)
      ? value.line
      : null
  } catch {
    return null
  }
}
