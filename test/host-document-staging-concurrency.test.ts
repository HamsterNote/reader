import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ReaderDataStore,
  type HostDocumentRecord
} from '../src/host/readerDataStore'

const fs = vi.hoisted(() => ({ copyAsync: vi.fn(), moveAsync: vi.fn() }))

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  EncodingType: { UTF8: 'utf8' },
  ...fs,
  getInfoAsync: async (uri: string) => {
    const info = statSync(localPath(uri), { throwIfNoEntry: false })
    if (!info) return { exists: false }
    return { exists: true, isDirectory: info.isDirectory(), size: info.size }
  },
  readDirectoryAsync: async (uri: string) => readdirSync(localPath(uri)),
  makeDirectoryAsync: async (uri: string) => {
    mkdirSync(localPath(uri), { recursive: true })
  },
  deleteAsync: async (uri: string) => {
    rmSync(localPath(uri), { recursive: true, force: true })
  },
  writeAsStringAsync: async (uri: string, value: string) => {
    writeFileSync(localPath(uri), value)
  },
  readAsStringAsync: async (uri: string) => readFileSync(localPath(uri), 'utf8')
}))
vi.mock('expo-asset', () => ({ Asset: {} }))
import { createFileSystemStorage } from '../app/src/native/storage'
import { stageReaderDocument } from '../app/src/native/webAssets'

type Relocation = { from: string; to: string }

const buildId = '0123456789abcdef'
const base = `file:///documents/webreader/${buildId}/`
const fileId = `f_${'a'.repeat(32)}`
const source = `file:///documents/reader-files/${fileId}.pdf`
const target = `file:///documents/reader-sessions/${fileId}/${buildId}/`
const publication = `${target}publication.pdf`
const pending = `${publication}.pending`
const readyMarker = `${target}session-ready`
const pdf = '%PDF-1.7\nHAM-290\n%%EOF'
const record: HostDocumentRecord = {
  fileId,
  fileName: 'book.pdf',
  format: 'pdf',
  size: pdf.length,
  modifiedAt: 1,
  cachedUri: `reader-files/${fileId}.pdf`,
  importedAt: 1,
  snapshot: { data: null, progress: null, revision: 0 }
}
const assetNames = [
  'index.html',
  'asset-manifest.json',
  'assets/webview.js',
  'assets/webview.css',
  'foliate/epub.js',
  'pdfjs/pdf.worker.min.mjs',
  'pdfjs/pdf_viewer.css',
  'pdfjs/standard_fonts/LiberationSans-Regular.ttf'
]
const staged = {
  baseUrl: target,
  entryUrl: `${target}index.html`,
  publicationUrl: publication
}

let root: string

function localPath(uri: string): string {
  return join(root, uri.replace('file:///documents/', ''))
}

function seedFile(uri: string, content: string): void {
  const path = localPath(uri)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function moveFile({ from, to }: Relocation): void {
  // Expo legacy iOS removes the destination before attempting the move.
  rmSync(localPath(to), { force: true })
  renameSync(localPath(from), localPath(to))
}

describe('concurrent native document staging on disk', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'reader-stage-'))
    for (const name of assetNames) seedFile(`${base}${name}`, name)
    seedFile(source, pdf)
    fs.copyAsync.mockImplementation(async ({ from, to }: Relocation) => {
      copyFileSync(localPath(from), localPath(to))
    })
    fs.moveAsync.mockImplementation(async (request: Relocation) => {
      moveFile(request)
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('opens both panes on the first attempt for the same uncached PDF', async () => {
    const left = stageReaderDocument(base, record)
    const right = stageReaderDocument(base, { ...record })
    const expected = { status: 'fulfilled', value: staged }
    expect(await Promise.allSettled([left, right])).toEqual([
      expected,
      expected
    ])
    for (const name of assetNames) {
      expect(readFileSync(localPath(`${target}${name}`), 'utf8')).toBe(name)
    }
    expect(readFileSync(localPath(publication))).toEqual(
      readFileSync(localPath(source))
    )
    expect(readFileSync(localPath(readyMarker), 'utf8')).toBe(buildId)
    expect(existsSync(localPath(pending))).toBe(false)
    expect(fs.moveAsync).toHaveBeenCalledExactlyOnceWith({
      from: pending,
      to: publication
    })
  })

  it('repairs an existing truncated copy without rewriting persisted annotations or progress', async () => {
    const store = new ReaderDataStore(createFileSystemStorage())
    const snapshot = {
      data: { highlights: { ranges: [{ id: 'retained', color: '#ff0000' }] } },
      progress: { page: 2 },
      revision: 8
    }
    await store.upsert(record)
    await store.saveSnapshot(fileId, snapshot)
    for (const name of assetNames) seedFile(`${target}${name}`, name)
    seedFile(readyMarker, buildId)
    seedFile(publication, '%PDF')
    seedFile(pending, 'stale pending bytes')

    const persisted = (await store.get(fileId))!
    const snapshotPath = localPath(
      `file:///documents/reader-host/reader.host.v2.snapshot.${fileId}.json`
    )
    const storedBytes = readFileSync(snapshotPath)
    await expect(
      Promise.all([
        stageReaderDocument(base, persisted),
        stageReaderDocument(base, { ...persisted })
      ])
    ).resolves.toEqual([staged, staged])
    expect(readFileSync(localPath(publication), 'utf8')).toBe(pdf)
    expect(existsSync(localPath(pending))).toBe(false)
    expect(readFileSync(snapshotPath)).toEqual(storedBytes)
    const reopened = await new ReaderDataStore(createFileSystemStorage()).get(
      fileId
    )
    expect(reopened?.snapshot).toEqual(snapshot)
    expect(reopened?.snapshotSource).toBe('v2')
  })

  it('shares a failed move and replaces the incomplete session on retry', async () => {
    fs.moveAsync.mockRejectedValueOnce(new Error('move interrupted'))
    const failure = {
      status: 'rejected',
      reason: new Error('move interrupted')
    }
    await expect(
      Promise.allSettled([
        stageReaderDocument(base, record),
        stageReaderDocument(base, record)
      ])
    ).resolves.toEqual([failure, failure])
    expect(existsSync(localPath(readyMarker))).toBe(false)
    expect(readFileSync(localPath(pending), 'utf8')).toBe(pdf)
    expect(existsSync(localPath(publication))).toBe(false)

    await expect(
      Promise.all([
        stageReaderDocument(base, record),
        stageReaderDocument(base, record)
      ])
    ).resolves.toEqual([staged, staged])
    expect(readFileSync(localPath(publication), 'utf8')).toBe(pdf)
    expect(readFileSync(localPath(readyMarker), 'utf8')).toBe(buildId)
    expect(existsSync(localPath(pending))).toBe(false)
  })

  it('can stage another file while the first PDF copy is held', async () => {
    const otherId = `f_${'b'.repeat(32)}`
    const otherPdf = `${pdf}\nSecond document`
    seedFile(`file:///documents/reader-files/${otherId}.pdf`, otherPdf)
    let releaseCopy = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseCopy = resolve
    })
    fs.copyAsync.mockImplementation(async ({ from, to }: Relocation) => {
      if (to === pending) await gate
      copyFileSync(localPath(from), localPath(to))
    })

    const first = stageReaderDocument(base, record)
    const other = stageReaderDocument(base, {
      ...record,
      fileId: otherId,
      size: otherPdf.length
    })
    const outcome = Promise.allSettled([first, other])
    try {
      const result = await Promise.race([other, setImmediate('still staging')])
      const otherPublication = publication.replace(fileId, otherId)
      expect(result).toMatchObject({ publicationUrl: otherPublication })
      expect(readFileSync(localPath(otherPublication), 'utf8')).toBe(otherPdf)
      expect(existsSync(localPath(publication))).toBe(false)
    } finally {
      releaseCopy()
      await outcome
    }
    await expect(first).resolves.toEqual(staged)
  })
})
