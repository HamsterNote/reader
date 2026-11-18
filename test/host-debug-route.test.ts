import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../src/host/readerDataStore'
import {
  clearPaneRecord,
  EMPTY_PANES,
  hasAnyPane,
  mirrorActivePane,
  otherPane,
  resolveActivePane,
  setPaneRecord
} from '../app/src/debug/panes'
import {
  debugRouteFromEnv,
  debugRouteLog,
  parseDebugUrl
} from '../app/src/debug/route'
import { resolveDebugTarget } from '../app/src/debug/resolveTarget'

const native = vi.hoisted(() => ({ importPath: vi.fn() }))
vi.mock('../app/src/native/documents', () => ({
  importDocumentFromPath: native.importPath
}))

function makeRecord(
  fileId = 'f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
): HostDocumentRecord {
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    format: 'pdf',
    size: 1024,
    modifiedAt: 1,
    importedAt: 2,
    cachedUri: `reader-files/${fileId}.pdf`,
    snapshot: { data: null, progress: null, revision: 0 }
  }
}

describe('debug route parsing (HAM-290 device entrance)', () => {
  it('parses a fileId deep link and defaults to a single pane', () => {
    const raw =
      'hamsterreader://debug/open?fileId=f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    expect(parseDebugUrl(raw)).toEqual({
      source: 'deeplink',
      target: {
        kind: 'fileId',
        value: 'f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      layout: 'single',
      raw
    })
  })

  it('parses an encoded file path and split layout', () => {
    const path = 'file:///var/mobile/Containers/Data/book sample.pdf'
    const route = parseDebugUrl(
      `hamsterreader://open?path=${encodeURIComponent(path)}&layout=split`
    )
    expect(route?.target).toEqual({ kind: 'path', value: path })
    expect(route?.layout).toBe('split')
  })

  it('prefers fileId when both targets are present and ignores unknown layouts', () => {
    const route = parseDebugUrl(
      'hamsterreader://open?fileId=f_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&path=/var/mobile/reader/a.pdf&layout=grid'
    )
    expect(route?.target).toEqual({
      kind: 'fileId',
      value: 'f_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    })
    expect(route?.layout).toBe('single')
  })

  it.each([
    'hamsterreader://debug/open',
    'hamsterreader://other/open?fileId=x',
    'https://example.org/open?fileId=x',
    'hamsterreader://debug/open?fileId=%20%20',
    ''
  ])('rejects unusable input: %s', (raw) => {
    expect(parseDebugUrl(raw)).toBeNull()
  })

  it('reads the launch environment with documented precedence', () => {
    expect(
      debugRouteFromEnv({
        EXPO_PUBLIC_HAM278_ROUTE:
          'hamsterreader://debug/open?fileId=f_cccccccccccccccccccccccccccccccc&layout=split',
        EXPO_PUBLIC_HAM278_OPEN_FILE_ID: 'f_dddddddddddddddddddddddddddddddd',
        EXPO_PUBLIC_HAM278_OPEN_PDF: '/var/mobile/reader/ignored.pdf'
      })
    ).toMatchObject({
      source: 'env',
      target: { kind: 'fileId', value: 'f_cccccccccccccccccccccccccccccccc' },
      layout: 'split'
    })
    expect(
      debugRouteFromEnv({
        EXPO_PUBLIC_HAM278_OPEN_FILE_ID: 'f_dddddddddddddddddddddddddddddddd',
        EXPO_PUBLIC_HAM278_OPEN_PDF: '/var/mobile/reader/ignored.pdf'
      })?.target
    ).toEqual({ kind: 'fileId', value: 'f_dddddddddddddddddddddddddddddddd' })
    expect(
      debugRouteFromEnv({
        EXPO_PUBLIC_HAM278_OPEN_PDF: '/var/mobile/reader/book.pdf',
        EXPO_PUBLIC_HAM278_LAYOUT: 'SPLIT'
      })
    ).toMatchObject({
      target: { kind: 'path', value: '/var/mobile/reader/book.pdf' },
      layout: 'split'
    })
    expect(debugRouteFromEnv({})).toBeNull()
  })

  it('logs only identity, layout and target fields', () => {
    const path = '/var/mobile/reader/book.pdf'
    const route = parseDebugUrl(
      `hamsterreader://open?path=${encodeURIComponent(path)}&layout=split`
    )!
    expect(debugRouteLog(route)).toEqual({
      source: 'deeplink',
      layout: 'split',
      target: 'path',
      path
    })
  })
})

describe('debug pane state', () => {
  const a = makeRecord('f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  const b = makeRecord('f_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

  it('defaults to a single pane and mirrors the active document on split', () => {
    const opened = setPaneRecord(EMPTY_PANES, 'left', a)
    expect(hasAnyPane(opened)).toBe(true)
    expect(mirrorActivePane(opened, 'left')).toEqual({ left: a, right: a })
    expect(mirrorActivePane({ left: a, right: b }, 'left')).toEqual({
      left: a,
      right: b
    })
  })

  it('keeps focus on a pane that shows a document', () => {
    expect(resolveActivePane({ left: a, right: a }, 'left')).toBe('left')
    expect(resolveActivePane({ left: null, right: a }, 'left')).toBe('right')
    expect(resolveActivePane({ left: a, right: null }, 'right')).toBe('left')
    expect(resolveActivePane(EMPTY_PANES, 'right')).toBe('right')
    expect(otherPane('left')).toBe('right')
  })

  it('clears one pane without touching the other', () => {
    expect(clearPaneRecord({ left: a, right: b }, 'left')).toEqual({
      left: null,
      right: b
    })
    expect(hasAnyPane(clearPaneRecord({ left: a, right: null }, 'left'))).toBe(
      false
    )
  })
})

describe('debug target resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens an existing library record by fileId', async () => {
    const record = makeRecord()
    const get = vi.fn(async () => record)
    const outcome = await resolveDebugTarget(
      { get } as unknown as ReaderDataStore,
      { kind: 'fileId', value: record.fileId }
    )
    expect(outcome).toEqual({ status: 'opened', record })
    expect(get).toHaveBeenCalledWith(record.fileId)
  })

  it('reports a missing fileId instead of falling back', async () => {
    const outcome = await resolveDebugTarget(
      { get: vi.fn(async () => null) } as unknown as ReaderDataStore,
      { kind: 'fileId', value: 'f_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }
    )
    expect(outcome).toEqual({
      status: 'failed',
      reason: '书库中没有 fileId=f_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee 的记录'
    })
    expect(native.importPath).not.toHaveBeenCalled()
  })

  it('imports a device path and surfaces the import error', async () => {
    const record = makeRecord()
    native.importPath.mockResolvedValueOnce(record)
    const store = {} as ReaderDataStore
    expect(
      await resolveDebugTarget(store, {
        kind: 'path',
        value: '/var/mobile/reader/book.pdf'
      })
    ).toEqual({ status: 'opened', record })
    expect(native.importPath).toHaveBeenCalledWith(
      store,
      '/var/mobile/reader/book.pdf'
    )

    native.importPath.mockRejectedValueOnce(new Error('文件不存在'))
    expect(
      await resolveDebugTarget(store, {
        kind: 'path',
        value: '/var/mobile/reader/none.pdf'
      })
    ).toEqual({ status: 'failed', reason: '文件不存在' })
  })
})
