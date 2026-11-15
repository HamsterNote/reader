// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logNativePdfDiagnostic } from '../../src/nativePdf/diagnostics'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('native PDF diagnostics', () => {
  it('keeps verbose messages off in Release unless explicitly enabled', () => {
    vi.stubGlobal('__DEV__', false)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    logNativePdfDiagnostic('reader-pdf-message', { page: 1 })
    expect(info).not.toHaveBeenCalled()

    vi.stubGlobal('__READER_NATIVE_PDF_DIAGNOSTICS__', true)
    logNativePdfDiagnostic('reader-pdf-message', { page: 1 })
    expect(info).toHaveBeenCalledWith('reader-pdf-message', { page: 1 })
  })

  it('omits session credentials from top-level, nested and array payloads', () => {
    vi.stubGlobal('__DEV__', true)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    logNativePdfDiagnostic('reader-pdf-message', {
      sourceToken: 'not-for-log',
      nested: { authorization: 'not-for-log', page: 1 },
      items: [{ sessionToken: 'not-for-log', ok: true }],
      token: 3
    })
    expect(info).toHaveBeenCalledWith('reader-pdf-message', {
      nested: { page: 1 },
      items: [{ ok: true }],
      token: 3
    })
    expect(JSON.stringify(info.mock.calls[0])).not.toContain('not-for-log')
  })

  it('keeps complete file paths out of open and corrupt-document diagnostics', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../app/modules/reader-pdf/ios/ReaderPdfModule.swift'
      ),
      'utf8'
    )
    const open = source.slice(
      source.indexOf('if type == "open"'),
      source.indexOf('    } else {', source.indexOf('if type == "open"'))
    )
    expect(open).not.toContain('sessionDirectory=')
    expect(open).not.toContain('pdfPath=')
    expect(open).not.toContain('path=%@')
    expect(open).not.toContain('路径：\\(path)')
    expect(open).toContain('error=CORRUPT')
    expect(open).toContain('pageCount=')
    expect(open).toContain('documentOpened=false')
  })

  it('routes Swift logging through the default-off diagnostic switch', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../app/modules/reader-pdf/ios/ReaderPdfModule.swift'
      ),
      'utf8'
    )
    const helperEnd = source.indexOf('public class ReaderPdfModule')
    const helper = source.slice(0, helperEnd)
    const callers = source.slice(helperEnd)
    expect(helper).toContain('static var enabled = false')
    expect(helper).toContain('#if DEBUG')
    expect(helper.match(/NSLog\(/g)).toHaveLength(2)
    expect(callers).not.toContain('NSLog(')
    expect(callers).toContain('ReaderPdfDiagnostics.log(')
  })
})
