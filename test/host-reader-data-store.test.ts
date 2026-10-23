import { describe, expect, it } from 'vitest'

import type {
  HostDocumentRecord,
  HostStorage
} from '../src/host/readerDataStore'
import {
  parseLegacyHighlightsJson,
  ReaderDataStore
} from '../src/host/readerDataStore'

class MemoryStorage implements HostStorage {
  readonly values = new Map<string, string>()

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async write(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }
}

const fileId = 'f_0123456789abcdef0123456789abcdef'

function record(
  overrides: Partial<HostDocumentRecord> = {}
): HostDocumentRecord {
  return {
    fileId,
    fileName: 'book.epub',
    format: 'epub',
    size: 1024,
    modifiedAt: 1,
    cachedUri: 'file:///cache/book.epub',
    importedAt: 100,
    snapshot: { data: null, progress: null, revision: 0 },
    ...overrides
  }
}

describe('ReaderDataStore', () => {
  it('persists a document and restores it in a new store instance', async () => {
    const storage = new MemoryStorage()
    const store = new ReaderDataStore(storage)
    await store.upsert(record())

    const reopened = new ReaderDataStore(storage)
    const loaded = await reopened.get(fileId)
    expect(loaded?.fileName).toBe('book.epub')
    expect(await reopened.list()).toHaveLength(1)
  })

  it('keeps snapshots isolated per file', async () => {
    const storage = new MemoryStorage()
    const store = new ReaderDataStore(storage)
    const otherId = 'f_ffffffffffffffffffffffffffffffff'
    await store.upsert(record())
    await store.upsert(
      record({
        fileId: otherId,
        fileName: 'paper.pdf',
        format: 'pdf',
        importedAt: 200
      })
    )

    await store.saveSnapshot(fileId, {
      data: { highlights: { ranges: [1] } },
      progress: { page: 3 },
      revision: 2
    })

    expect((await store.get(fileId))?.snapshot.revision).toBe(2)
    expect((await store.get(otherId))?.snapshot.revision).toBe(0)
    const list = await store.list()
    expect(list.map((item) => item.fileName)).toEqual([
      'paper.pdf',
      'book.epub'
    ])
  })

  it('rejects snapshots for unknown files', async () => {
    const store = new ReaderDataStore(new MemoryStorage())
    await expect(
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 1 })
    ).rejects.toThrow('文档不存在')
  })

  it('imports v2/v3/v4 legacy JSON into one file only', async () => {
    const store = new ReaderDataStore(new MemoryStorage())
    const otherId = 'f_ffffffffffffffffffffffffffffffff'
    await store.upsert(record())
    await store.upsert(record({ fileId: otherId, fileName: 'b.pdf' }))

    const updated = await store.importLegacyJson(
      fileId,
      JSON.stringify({ version: 3, ranges: [{ id: 'page-1' }], rects: [] }),
      'book-highlights.json',
      123
    )
    expect(updated.legacyImport?.version).toBe(3)
    expect(updated.snapshot.revision).toBe(0)
    expect(updated.snapshot.data).toEqual({
      highlights: { version: 3, ranges: [{ id: 'page-1' }], rects: [] }
    })
    expect((await store.get(otherId))?.snapshot.data).toBeNull()
  })

  it('rejects malformed legacy JSON without touching the record', async () => {
    const store = new ReaderDataStore(new MemoryStorage())
    await store.upsert(record())

    const invalid = [
      'not json',
      JSON.stringify({ version: 1, ranges: [] }),
      JSON.stringify({ version: 3, ranges: [] }),
      JSON.stringify({ version: 4, ranges: [], rects: [] })
    ]
    for (const raw of invalid) {
      await expect(
        store.importLegacyJson(fileId, raw, 'bad.json', 1)
      ).rejects.toThrow()
    }
    expect((await store.get(fileId))?.legacyImport).toBeUndefined()
  })

  it('removes a file record without touching others', async () => {
    const storage = new MemoryStorage()
    const store = new ReaderDataStore(storage)
    const otherId = 'f_ffffffffffffffffffffffffffffffff'
    await store.upsert(record())
    await store.upsert(record({ fileId: otherId, fileName: 'b.pdf' }))

    await store.remove(fileId)
    expect(await store.get(fileId)).toBeNull()
    expect(await store.get(otherId)).not.toBeNull()
    expect(
      (await new ReaderDataStore(storage).list()).map((item) => item.fileName)
    ).toEqual(['b.pdf'])
  })

  it('degrades to an empty list when the index is corrupt', async () => {
    const storage = new MemoryStorage()
    const store = new ReaderDataStore(storage)
    await store.upsert(record())
    storage.values.set('reader.host.v1.index', '{"broken":true}')
    expect(await new ReaderDataStore(storage).list()).toEqual([])
  })

  it('rejects path traversal file ids', async () => {
    const store = new ReaderDataStore(new MemoryStorage())
    await expect(store.get('../../secret')).rejects.toThrow('非法文件 ID')
  })
})

describe('parseLegacyHighlightsJson', () => {
  it('accepts v2, v3 and v4 top-level shapes', () => {
    expect(parseLegacyHighlightsJson('{"version":2,"ranges":[]}').version).toBe(
      2
    )
    expect(
      parseLegacyHighlightsJson('{"version":3,"ranges":[],"rects":[]}').version
    ).toBe(3)
    expect(
      parseLegacyHighlightsJson(
        '{"version":4,"ranges":[],"rects":[],"paintings":{}}'
      ).version
    ).toBe(4)
  })
})
