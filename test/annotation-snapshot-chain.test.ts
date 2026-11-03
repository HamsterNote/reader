import { describe, expect, it } from 'vitest'

import type {
  HostDocumentRecord,
  HostStorage
} from '../src/host/readerDataStore'
import { ReaderDataStore } from '../src/host/readerDataStore'
import {
  createReaderHostSession,
  type ReaderHostSession
} from '../src/host/readerHostSession'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot,
  type ReaderSnapshot
} from '../src/host/readerSnapshot'
import { createWebBridgeClient } from '../webview/src/bridgeClient'
import type { WebBridgeClient } from '../webview/src/bridgeClient'

const fileId = 'f_0123456789abcdef0123456789abcdef'
const otherFileId = 'f_ffffffffffffffffffffffffffffffff'
const sourceToken = 'source-token'
const SNAPSHOT_KEY = 'reader.host.v2.snapshot.'

class MemoryStorage implements HostStorage {
  readonly values = new Map<string, string>()
  readonly writes: string[] = []

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async write(key: string, value: string): Promise<void> {
    this.writes.push(key)
    this.values.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }
}

function record(id: string, fileName: string): HostDocumentRecord {
  return {
    fileId: id,
    fileName,
    format: 'pdf',
    size: 1,
    modifiedAt: 1,
    cachedUri: `reader-files/${id}.pdf`,
    importedAt: 1,
    snapshot: { data: null, progress: null, revision: 0 }
  }
}

const emptySnapshot: ReaderSnapshot = {
  data: { ranges: [], rects: [], pagePaintings: {} },
  comments: [],
  extra: {}
}

async function createChain(
  store: ReaderDataStore,
  targetFileId: string,
  sessionId: string
): Promise<{
  readonly bridge: WebBridgeClient
  readonly host: ReaderHostSession
  readonly posted: string[]
}> {
  const posted: string[] = []
  const existing = await store.get(targetFileId)
  const bridge = createWebBridgeClient({
    sessionId,
    sourceToken,
    clientId: 'client-1',
    post: (raw) => posted.push(raw)
  })
  const host = createReaderHostSession({
    sessionId,
    sourceToken,
    descriptor: {
      fileId: targetFileId,
      format: 'pdf',
      fileUrl: 'file:///cache/book.pdf'
    },
    confirmedSnapshot: existing?.snapshot ?? null,
    persist: (snapshot) => store.saveSnapshot(targetFileId, snapshot),
    sendToWeb: (message) => bridge.handleMessage(JSON.stringify(message))
  })
  return { bridge, host, posted }
}

async function deliver(
  host: ReaderHostSession,
  posted: string[]
): Promise<void> {
  const raw = posted.shift()
  if (raw === undefined) throw new Error('没有待投递的 Web 消息')
  await host.handleRawMessage(raw)
}

async function openChain(sessionId: string) {
  const storage = new MemoryStorage()
  const store = new ReaderDataStore(storage)
  await store.upsert(record(fileId, 'book.pdf'))
  await store.upsert(record(otherFileId, 'other.pdf'))
  const chain = await createChain(store, fileId, sessionId)
  const other = await createChain(store, otherFileId, sessionId)
  chain.bridge.start()
  await deliver(chain.host, chain.posted)
  other.bridge.start()
  await deliver(other.host, other.posted)
  return { storage, store, chain, other }
}

describe('snapshot chain: reader surface payload → bridge → host ack', () => {
  it('persists the annotations envelope and advances revision only after ack', async () => {
    const { storage, chain } = await openChain('session-chain')
    expect(chain.bridge.getRevision()).toBe(0)

    chain.bridge.sendChange(serializeReaderSnapshot(emptySnapshot))
    await deliver(chain.host, chain.posted)

    expect(chain.bridge.getRevision()).toBe(1)
    const stored = JSON.parse(
      storage.values.get(`${SNAPSHOT_KEY}${fileId}`) ?? 'null'
    )
    expect(stored.revision).toBe(1)
    expect(stored.data.annotations).toEqual({
      version: 5,
      ranges: [],
      rects: [],
      paintings: {}
    })
    // 单一写入格式：宿主快照里没有 v4 highlights。
    expect(stored.data.highlights).toBeUndefined()
    expect(restoreReaderSnapshot(stored.data).data.pagePaintings).toEqual({})
  })

  it('re-acks a resent requestId without writing twice', async () => {
    const { storage, chain } = await openChain('session-chain')
    chain.bridge.sendChange(serializeReaderSnapshot(emptySnapshot))
    const raw = chain.posted.shift()
    if (raw === undefined) throw new Error('missing change message')

    await chain.host.handleRawMessage(raw)
    const writesAfterFirst = storage.writes.filter((key) =>
      key.startsWith(SNAPSHOT_KEY)
    ).length
    expect(writesAfterFirst).toBeGreaterThan(0)

    // 模拟 ack 丢失后的重发：同一 requestId，宿主只重新应答不重复落盘。
    await chain.host.handleRawMessage(raw)
    expect(
      storage.writes.filter((key) => key.startsWith(SNAPSHOT_KEY)).length
    ).toBe(writesAfterFirst)
    expect(chain.bridge.getRevision()).toBe(1)
  })

  it('does not advance the confirmed snapshot when the host reports an error', async () => {
    const { storage, chain } = await openChain('session-chain')
    chain.bridge.sendChange(serializeReaderSnapshot(emptySnapshot))
    await deliver(chain.host, chain.posted)
    expect(chain.bridge.getRevision()).toBe(1)

    // revision 跳号：宿主拒绝，已确认快照与存储都停在 1。
    chain.bridge.sendChange({ annotations: { version: 5, ranges: [] } })
    const raw = chain.posted.shift()
    if (raw === undefined) throw new Error('missing change message')
    const forged = JSON.parse(raw) as Record<string, unknown>
    forged['payload'] = { data: { annotations: {} }, revision: 5 }
    await chain.host.handleRawMessage(JSON.stringify(forged))

    // 宿主拒绝：确认快照与存储都停在 1。
    expect(chain.host.getSnapshot().revision).toBe(1)
    const stored = JSON.parse(
      storage.values.get(`${SNAPSHOT_KEY}${fileId}`) ?? 'null'
    )
    expect(stored.revision).toBe(1)

    // Web 端收到 REVISION_MISMATCH 后重新握手，拿回的仍是已确认的 1。
    expect(chain.bridge.getRevision()).toBeNull()
    await deliver(chain.host, chain.posted)
    expect(chain.bridge.getRevision()).toBe(1)
  })

  it('keeps files isolated when two sessions write concurrently', async () => {
    const { storage, chain, other } = await openChain('session-chain')

    chain.bridge.sendChange(serializeReaderSnapshot(emptySnapshot))
    other.bridge.sendChange(
      serializeReaderSnapshot({
        ...emptySnapshot,
        data: { ...emptySnapshot.data, ranges: [] }
      })
    )
    await Promise.all([
      deliver(chain.host, chain.posted),
      deliver(other.host, other.posted)
    ])

    const first = JSON.parse(
      storage.values.get(`${SNAPSHOT_KEY}${fileId}`) ?? 'null'
    )
    const second = JSON.parse(
      storage.values.get(`${SNAPSHOT_KEY}${otherFileId}`) ?? 'null'
    )
    expect(first.revision).toBe(1)
    expect(second.revision).toBe(1)
    expect(first.data.annotations).toEqual(second.data.annotations)

    // 每个文件只有自己的目标键与索引记录，没有交叉写入。
    const snapshotKeys = [...storage.values.keys()].filter((key) =>
      key.startsWith(SNAPSHOT_KEY)
    )
    expect(snapshotKeys.sort()).toEqual(
      [`${SNAPSHOT_KEY}${fileId}`, `${SNAPSHOT_KEY}${otherFileId}`].sort()
    )
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
    expect(storage.values.has(`${SNAPSHOT_KEY}${otherFileId}.pending`)).toBe(
      false
    )
  })
})
