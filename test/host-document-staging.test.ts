import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostDocumentRecord } from '../src/host/readerDataStore'

const fs = vi.hoisted(() => ({
  getInfoAsync: vi.fn(),
  readDirectoryAsync: vi.fn(),
  copyAsync: vi.fn(),
  deleteAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  moveAsync: vi.fn()
}))
vi.mock('expo-file-system/legacy', () => ({
  ...fs,
  documentDirectory: 'file:///documents/'
}))
vi.mock('expo-asset', () => ({ Asset: {} }))
import { stageReaderDocument } from '../app/src/native/webAssets'

const record: HostDocumentRecord = {
  fileId: `f_${'a'.repeat(32)}`,
  fileName: 'book.epub',
  format: 'epub',
  size: 1024,
  modifiedAt: 1,
  cachedUri: 'file:///documents/reader-files/book-a.epub',
  importedAt: 1,
  snapshot: { data: null, progress: null, revision: 0 }
}
const base = 'file:///documents/webreader/0123456789abcdef/'
const target = `file:///documents/reader-sessions/${record.fileId}/0123456789abcdef/`
let sessionReady = false
let publicationReady = false

describe('native document staging boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    sessionReady = false
    publicationReady = false
    fs.readDirectoryAsync.mockImplementation(async (dir: string) => {
      const suffix = dir.replace(base, '')
      const tree: Record<string, string[]> = {
        '': ['index.html', 'asset-manifest.json', 'assets', 'foliate', 'pdfjs'],
        assets: ['webview.js', 'webview.css'],
        foliate: ['epub.js'],
        pdfjs: ['pdf.worker.min.mjs', 'pdf_viewer.css', 'standard_fonts'],
        'pdfjs/standard_fonts': ['LiberationSans-Regular.ttf']
      }
      return tree[suffix.replace(/\/$/, '')] ?? []
    })
    fs.getInfoAsync.mockImplementation(async (uri: string) => {
      if (uri === `${target}session-ready`) return { exists: sessionReady }
      if (uri.startsWith(base)) {
        const name = uri.slice(base.length).replace(/\/$/, '')
        return {
          exists: true,
          isDirectory: [
            'assets',
            'foliate',
            'pdfjs',
            'pdfjs/standard_fonts'
          ].includes(name)
        }
      }
      if (uri.startsWith(target)) {
        if (uri.endsWith(`publication.${record.format}`))
          return { exists: publicationReady, size: record.size }
        if (uri.endsWith('session-ready')) return { exists: sessionReady }
        return { exists: true, isDirectory: false, size: 1 }
      }
      return { exists: false }
    })
    fs.copyAsync.mockImplementation(async () => undefined)
    fs.moveAsync.mockImplementation(async () => {
      publicationReady = true
    })
    fs.writeAsStringAsync.mockImplementation(async (uri: string) => {
      if (uri.endsWith('session-ready')) sessionReady = true
    })
  })
  it('stages one publication with an independent completion marker and atomic file rename', async () => {
    const result = await stageReaderDocument(base, record)
    expect(fs.copyAsync).toHaveBeenCalledWith({
      from: `${base}index.html`,
      to: `${target}index.html`
    })
    expect(fs.writeAsStringAsync).toHaveBeenCalledWith(
      `${target}session-ready`,
      '0123456789abcdef'
    )
    expect(fs.copyAsync).toHaveBeenCalledWith({
      from: `file:///documents/reader-files/${record.fileId}.epub`,
      to: `${target}publication.epub.pending`
    })
    expect(fs.moveAsync).toHaveBeenCalledWith({
      from: `${target}publication.epub.pending`,
      to: `${target}publication.epub`
    })
    expect(result).toEqual({
      baseUrl: target,
      entryUrl: `${target}index.html`,
      publicationUrl: `${target}publication.epub`
    })
    expect(result.baseUrl).not.toBe('file:///documents/')
  })
  it('does not recopy a completed session or original file on reopen', async () => {
    sessionReady = true
    publicationReady = true
    await stageReaderDocument(base, record)
    expect(fs.copyAsync).not.toHaveBeenCalled()
    expect(fs.deleteAsync).not.toHaveBeenCalled()
  })
  it('retries an interrupted asset copy without trusting its copied manifest', async () => {
    fs.copyAsync.mockRejectedValueOnce(new Error('interrupted'))
    await expect(stageReaderDocument(base, record)).rejects.toThrow(
      'interrupted'
    )
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled()
    await stageReaderDocument(base, record)
    expect(fs.deleteAsync).toHaveBeenCalledWith(target, { idempotent: true })
    expect(fs.writeAsStringAsync).toHaveBeenCalledOnce()
  })
  it('rejects unsafe file identities before touching native files', async () => {
    await expect(
      stageReaderDocument(base, { ...record, fileId: '../other' })
    ).rejects.toThrow()
    expect(fs.copyAsync).not.toHaveBeenCalled()
  })
  it.each(['epub', 'pdf'] as const)(
    'reopens a relocated %s cache without reimporting or trusting the old container',
    async (format) => {
      const relocated = {
        ...record,
        format,
        cachedUri: `file:///old-container/Documents/reader-files/${record.fileId}.${format}`,
        snapshot: {
          data: { highlights: { ranges: [{ id: 'retained' }] } },
          progress: { page: 2 },
          revision: 8
        }
      }
      await stageReaderDocument(base, relocated)
      expect(fs.copyAsync).toHaveBeenCalledWith({
        from: `file:///documents/reader-files/${record.fileId}.${format}`,
        to: `${target}publication.${format}.pending`
      })
      expect(fs.copyAsync).not.toHaveBeenCalledWith(
        expect.objectContaining({ from: relocated.cachedUri })
      )
      expect(relocated.snapshot.revision).toBe(8)
    }
  )
})
