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
  /** 按 key 注入写入失败（模拟中断/磁盘错误）。 */
  failWrite?: (key: string) => boolean
  /** 按 key 注入半写（模拟非原子写入只落了一部分内容）。 */
  truncateWrite?: (key: string) => boolean

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async write(key: string, value: string): Promise<void> {
    if (this.failWrite?.(key) === true) {
      throw new Error(`写入失败：${key}`)
    }
    this.values.set(
      key,
      this.truncateWrite?.(key) === true ? value.slice(0, 8) : value
    )
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

const DOC_KEY = 'reader.host.v1.doc.'
const SNAPSHOT_KEY = 'reader.host.v2.snapshot.'

const legacyRecord = (): HostDocumentRecord => record()

async function storeWithLegacyRecord(storage = new MemoryStorage()) {
  const store = new ReaderDataStore(storage)
  await store.upsert(
    record({
      snapshot: {
        data: {
          highlights: { version: 4, ranges: [], rects: [], paintings: {} }
        },
        progress: { page: 2 },
        revision: 5
      }
    })
  )
  return { store, storage }
}

describe('ReaderDataStore v2 snapshot key', () => {
  it('writes the v2 key and leaves the legacy record byte-identical', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    const legacyBytes = storage.values.get(`${DOC_KEY}${fileId}`)

    await store.saveSnapshot(fileId, {
      data: {
        annotations: { version: 5, ranges: [], rects: [], paintings: {} }
      },
      progress: { page: 9 },
      revision: 6
    })

    expect(storage.values.get(`${DOC_KEY}${fileId}`)).toBe(legacyBytes)
    expect(
      JSON.parse(storage.values.get(`${SNAPSHOT_KEY}${fileId}`) ?? '')
    ).toEqual({
      data: {
        annotations: { version: 5, ranges: [], rects: [], paintings: {} }
      },
      progress: { page: 9 },
      revision: 6
    })

    const loaded = await new ReaderDataStore(storage).get(fileId)
    expect(loaded?.snapshotSource).toBe('v2')
    expect(loaded?.snapshot.revision).toBe(6)
  })

  it('prefers the v2 snapshot and falls back to the legacy record per file', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    const otherId = 'f_ffffffffffffffffffffffffffffffff'
    await store.upsert(
      record({ fileId: otherId, fileName: 'other.pdf', format: 'pdf' })
    )
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })

    expect((await store.get(fileId))?.snapshotSource).toBe('v2')
    expect((await store.get(otherId))?.snapshotSource).toBe('legacy')
    expect((await store.get(otherId))?.snapshot.revision).toBe(0)
    expect(storage.values.has(`${SNAPSHOT_KEY}${otherId}`)).toBe(false)
  })

  it('round-trips readerData, comments and extension fields without loss', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    const data = {
      annotations: {
        version: 5,
        ranges: [{ id: 'r1', text: 'x' }],
        rects: [],
        paintings: {}
      },
      comments: [{ id: 'c1', content: '批注' }],
      readerData: { renderMode: 'text', edgeCrop: { pages: {} } },
      viewport: { scale: 1.25, page: 3 },
      extension: { vendor: 'x', nested: [1, 2, 3] }
    }

    await store.saveSnapshot(fileId, {
      data,
      progress: { page: 3 },
      revision: 7
    })

    const reopened = new ReaderDataStore(storage)
    expect((await reopened.get(fileId))?.snapshot).toEqual({
      data,
      progress: { page: 3 },
      revision: 7
    })
  })

  it('keeps a corrupt v2 snapshot, never falls back to overwriting it', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    const legacyBytes = storage.values.get(`${DOC_KEY}${fileId}`)
    const corrupt = '{"revision":6,"data":'
    storage.values.set(`${SNAPSHOT_KEY}${fileId}`, corrupt)

    const loaded = await store.get(fileId)
    expect(loaded?.snapshotSource).toBe('corrupt')
    expect(loaded?.snapshotError).toContain('损坏')
    // 展示/删除仍可用的旧记录值，不会被当成“缺失”迁移。
    expect(loaded?.snapshot.revision).toBe(5)

    await expect(
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 8 })
    ).rejects.toThrow('损坏')
    await expect(
      store.importLegacyJson(
        fileId,
        '{"version":4,"ranges":[],"rects":[],"paintings":{}}',
        'x.json',
        1
      )
    ).rejects.toThrow()

    expect(storage.values.get(`${SNAPSHOT_KEY}${fileId}`)).toBe(corrupt)
    expect(storage.values.get(`${DOC_KEY}${fileId}`)).toBe(legacyBytes)
  })

  it('recovers a complete pending copy left by an interrupted commit', async () => {
    const { storage } = await storeWithLegacyRecord()
    const pending = JSON.stringify({
      data: { annotations: {} },
      progress: null,
      revision: 9
    })
    storage.values.set(`${SNAPSHOT_KEY}${fileId}.pending`, pending)

    const loaded = await new ReaderDataStore(storage).get(fileId)
    expect(loaded?.snapshot.revision).toBe(9)
    expect(storage.values.get(`${SNAPSHOT_KEY}${fileId}`)).toBe(pending)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
  })

  it('drops an incomplete pending copy and keeps the last complete state', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })
    storage.values.set(`${SNAPSHOT_KEY}${fileId}.pending`, '{"revis')

    const loaded = await new ReaderDataStore(storage).get(fileId)
    expect(loaded?.snapshot.revision).toBe(6)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
  })

  it('isolates a failed commit: previous snapshot stays visible, retry succeeds', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })

    storage.failWrite = (key) => key === `${SNAPSHOT_KEY}${fileId}`
    await expect(
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 7 })
    ).rejects.toThrow('写入失败')
    // 替换未确认前副本不删除：全部后端都可能已丢掉旧目标，副本是唯一完整状态。
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(true)
    expect((await store.get(fileId))?.snapshot.revision).toBe(6)

    storage.failWrite = undefined
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 7
    })
    expect((await store.get(fileId))?.snapshot.revision).toBe(7)
  })

  it('rejects a half-written pending copy without touching the committed snapshot', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })
    const committed = storage.values.get(`${SNAPSHOT_KEY}${fileId}`)

    storage.truncateWrite = (key) => key === `${SNAPSHOT_KEY}${fileId}.pending`
    await expect(
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 7 })
    ).rejects.toThrow('校验失败')

    storage.truncateWrite = undefined
    expect(storage.values.get(`${SNAPSHOT_KEY}${fileId}`)).toBe(committed)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
    expect((await store.get(fileId))?.snapshot.revision).toBe(6)
  })

  it('serializes concurrent saves for the same file', async () => {
    const { store, storage } = await storeWithLegacyRecord()

    await Promise.all([
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 6 }),
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 7 }),
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 8 })
    ])

    expect((await store.get(fileId))?.snapshot.revision).toBe(8)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
  })

  it('does not project the v2 snapshot back into the legacy record on upsert', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    const legacyBytes = storage.values.get(`${DOC_KEY}${fileId}`)
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })

    await store.upsert({ ...legacyRecord(), fileName: 'renamed.epub' })

    const raw = storage.values.get(`${DOC_KEY}${fileId}`) ?? ''
    expect(raw).not.toContain('"revision":6')
    expect(JSON.parse(raw).snapshot.revision).toBe(5)
    expect(JSON.parse(raw).fileName).toBe('renamed.epub')
    expect((await store.get(fileId))?.snapshot.revision).toBe(6)

    // 元数据未变时旧记录字节完全不变。
    await store.upsert(legacyRecord())
    expect(storage.values.get(`${DOC_KEY}${fileId}`)).toBe(legacyBytes)
  })

  it('removes the v2 key along with the legacy record', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })

    await store.remove(fileId)

    expect(storage.values.has(`${DOC_KEY}${fileId}`)).toBe(false)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}`)).toBe(false)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('refuses legacy import once the v2 snapshot exists', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })
    const snapshotBytes = storage.values.get(`${SNAPSHOT_KEY}${fileId}`)

    await expect(
      store.importLegacyJson(
        fileId,
        '{"version":4,"ranges":[],"rects":[],"paintings":{}}',
        'notes.json',
        1
      )
    ).rejects.toThrow('新格式')

    expect(storage.values.get(`${SNAPSHOT_KEY}${fileId}`)).toBe(snapshotBytes)
  })
})

class DropTargetStorage extends MemoryStorage {
  dropOnWrite?: string

  override async write(key: string, value: string): Promise<void> {
    if (this.dropOnWrite === key) {
      // 模拟真实原生后端：先删除旧目标，再移动失败。
      this.values.delete(key)
      throw new Error('move failed')
    }
    await super.write(key, value)
  }
}

class GatedStorage extends MemoryStorage {
  gate?: { readonly key: string; readonly wait: Promise<void> }

  override async write(key: string, value: string): Promise<void> {
    if (this.gate?.key === key) await this.gate.wait
    await super.write(key, value)
  }
}

describe('ReaderDataStore failure recovery and per-file queues', () => {
  it('recovers the complete state when the backend drops the target before failing', async () => {
    const storage = new DropTargetStorage()
    const { store } = await storeWithLegacyRecord(storage)
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })

    storage.dropOnWrite = `${SNAPSHOT_KEY}${fileId}`
    await expect(
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 7 })
    ).rejects.toThrow('move failed')

    // 目标已被后端删除，副本必须保留，不能被当成失败清理掉。
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(true)

    storage.dropOnWrite = undefined
    const reopened = new ReaderDataStore(storage)
    const loaded = await reopened.get(fileId)
    // 重开得到完整状态（不是 legacy/revision 0）。
    expect(loaded?.snapshotSource).toBe('v2')
    expect(loaded?.snapshot.revision).toBe(7)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
  })

  it('keeps the previous confirmed state when the target write reports failure but the old target survives', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })

    storage.failWrite = (key) => key === `${SNAPSHOT_KEY}${fileId}`
    await expect(
      store.saveSnapshot(fileId, { data: null, progress: null, revision: 7 })
    ).rejects.toThrow('写入失败')
    expect((await store.get(fileId))?.snapshot.revision).toBe(6)
    // 旧目标有效 → 副本被清理，读回仍是已确认的 6。
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
  })

  it('does not block other files while one file write is in flight', async () => {
    const storage = new GatedStorage()
    const store = new ReaderDataStore(storage)
    const otherId = 'f_ffffffffffffffffffffffffffffffff'
    await store.upsert(record())
    await store.upsert(
      record({ fileId: otherId, fileName: 'other.pdf', format: 'pdf' })
    )

    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    storage.gate = { key: `${SNAPSHOT_KEY}${fileId}.pending`, wait: gate }

    const blocked = store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 1
    })
    // B 文件的保存不等待 A 文件的挂起写入。
    await store.saveSnapshot(otherId, {
      data: null,
      progress: null,
      revision: 1
    })
    expect((await store.get(otherId))?.snapshot.revision).toBe(1)

    release()
    await blocked
    expect((await store.get(fileId))?.snapshot.revision).toBe(1)
  })
})

describe('ReaderDataStore delete vs in-flight and stale writes', () => {
  it('serializes remove behind an in-flight save of the same file', async () => {
    const storage = new GatedStorage()
    const { store } = await storeWithLegacyRecord(storage)
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })

    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    storage.gate = { key: `${SNAPSHOT_KEY}${fileId}.pending`, wait: gate }

    const saving = store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 7
    })
    const removing = store.remove(fileId)
    release()
    await Promise.all([saving, removing])

    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}`)).toBe(false)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
    expect(storage.values.has(`${DOC_KEY}${fileId}`)).toBe(false)
    expect(await store.get(fileId)).toBeNull()
  })

  it('does not revive deleted content when the file is re-added and imported', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })
    await store.remove(fileId)

    // 删除后未重新建立记录：导入必须拒绝，不能凭空复活。
    await expect(
      store.importLegacyJson(
        fileId,
        '{"version":4,"ranges":[],"rects":[],"paintings":{}}',
        'notes.json',
        1
      )
    ).rejects.toThrow('文档不存在')

    // 重新打开（选择文件）建立空记录后再导入：revision 0，只含导入内容。
    await store.upsert(record())
    const imported = await store.importLegacyJson(
      fileId,
      '{"version":4,"ranges":[],"rects":[],"paintings":{}}',
      'notes.json',
      1
    )

    expect(imported.snapshot.revision).toBe(0)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}`)).toBe(false)
    const loaded = await store.get(fileId)
    expect(loaded?.snapshotSource).toBe('legacy')
    expect(loaded?.snapshot.revision).toBe(0)
    expect(loaded?.snapshot.data).toEqual({
      highlights: { version: 4, ranges: [], rects: [], paintings: {} }
    })
  })

  it('does not rebuild the v2 key or revive its content from a stale record', async () => {
    const { store, storage } = await storeWithLegacyRecord()
    await store.saveSnapshot(fileId, {
      data: null,
      progress: null,
      revision: 6
    })
    const stale = await store.get(fileId)
    if (stale === null) throw new Error('stale record missing')
    expect(stale.snapshotSource).toBe('v2')

    await store.remove(fileId)
    // 模拟 pickAndCacheDocument 的交错：删除后才 upsert 它先前 get 到的记录。
    await store.upsert({ ...stale, cachedUri: 'reader-files/book.epub' })

    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}`)).toBe(false)
    const persisted: unknown = JSON.parse(
      storage.values.get(`${DOC_KEY}${fileId}`) ?? 'null'
    )
    expect(persisted).toMatchObject({
      snapshot: { data: null, progress: null, revision: 0 }
    })
    const loaded = await store.get(fileId)
    expect(loaded?.snapshotSource).toBe('legacy')
    expect(loaded?.snapshot.revision).toBe(0)
  })
})
