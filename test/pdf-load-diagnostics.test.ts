import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachPdfLoadDiagnostics,
  createPdfLoadDiagnostics,
  getPdfLoadDiagnostics,
  pdfLoadDiagnosticMessage,
  readPdfLoadDiagnosticMessage
} from '../src/pdf/pdfLoadDiagnostics'

afterEach(() => vi.restoreAllMocks())

describe('Web PDF load diagnostics', () => {
  it('correlates wall/monotonic time and resets render counters per viewer without retaining pages', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const lines: string[] = []
    const diagnostic = createPdfLoadDiagnostics((line) => lines.push(line))
    diagnostic.event('file-read-complete', { byteLength: 42 })
    const first = diagnostic.viewer()
    first('pagerendered', { pageNumber: 20, scale: 2 })
    first('pagerendered', { pageNumber: 1, scale: 1 })
    diagnostic.viewer()('pagerendered', { pageNumber: 2, scale: 1 })
    const entries = lines.map((line) =>
      JSON.parse(line.slice('reader-pdf-load '.length))
    )
    expect(entries.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4])
    expect(new Set(entries.map((entry) => entry.runId)).size).toBe(1)
    expect(entries[1]).toMatchObject({
      viewerId: 1,
      renderCount: 1,
      pageNumber: 20
    })
    expect(entries[2]).toMatchObject({
      viewerId: 1,
      renderCount: 2,
      pageNumber: 1
    })
    expect(entries[3]).toMatchObject({
      viewerId: 2,
      renderCount: 1,
      pageNumber: 2
    })
    for (const entry of entries) {
      expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false)
      expect(entry.elapsedMs).toBeGreaterThanOrEqual(0)
    }
    expect(entries[3].elapsedMs).toBeGreaterThanOrEqual(entries[0].elapsedMs)
    const other: string[] = []
    createPdfLoadDiagnostics((line) => other.push(line)).event('display-start')
    expect(
      JSON.parse(other[0]!.slice('reader-pdf-load '.length)).runId
    ).not.toBe(entries[0].runId)
  })

  it('keeps sources opt-in and continues when either diagnostic sink fails', () => {
    const mirror = vi.fn(() => {
      throw new Error('native transport closed')
    })
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('console disconnected')
    })
    const source = { data: new Uint8Array([1, 2]) }
    expect(getPdfLoadDiagnostics(source)).toBeUndefined()
    const diagnostic = createPdfLoadDiagnostics(mirror)
    attachPdfLoadDiagnostics(source, diagnostic)
    expect(getPdfLoadDiagnostics(source)).toBe(diagnostic)
    expect(getPdfLoadDiagnostics({ data: source.data })).toBeUndefined()
    expect(() =>
      diagnostic.event('pdf-open-complete', { pageCount: 2 })
    ).not.toThrow()
    expect(mirror).toHaveBeenCalledOnce()
  })

  it('only accepts bounded diagnostic messages belonging to the current host identity', () => {
    const line = 'reader-pdf-load {"stage":"file-read-complete"}'
    const raw = pdfLoadDiagnosticMessage(line, 'session', 'secret')
    expect(readPdfLoadDiagnosticMessage(raw, 'session', 'secret')).toBe(line)
    expect(readPdfLoadDiagnosticMessage(raw, 'other', 'secret')).toBeNull()
    expect(readPdfLoadDiagnosticMessage(raw, 'session', 'wrong')).toBeNull()
    expect(readPdfLoadDiagnosticMessage('{', 'session', 'secret')).toBeNull()
    expect(
      readPdfLoadDiagnosticMessage(
        pdfLoadDiagnosticMessage('not diagnostic', 'session', 'secret'),
        'session',
        'secret'
      )
    ).toBeNull()
    expect(
      readPdfLoadDiagnosticMessage(
        pdfLoadDiagnosticMessage(line.repeat(100), 'session', 'secret'),
        'session',
        'secret'
      )
    ).toBeNull()
  })
})
