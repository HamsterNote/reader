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
import type { BridgeMessage } from '../src/bridge/protocol'

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
  extra: {},
  migrated: false
}

/** Web → 宿主消息队列；push 唤醒等待者，避免测试轮询真实计时器。 */
type PostQueue = {
  readonly items: string[]
  readonly push: (raw: string) => void
  readonly shift: () => string | undefined
  readonly wait: () => Promise<void>
}

function createPostQueue(): PostQueue {
  const items: string[] = []
  const waiters: Array<() => void> = []
  return {
    items,
    push: (raw) => {
      items.push(raw)
      for (const wake of waiters.splice(0)) wake()
    },
    shift: () => items.shift(),
    wait: () => {
      if (items.length > 0) return Promise.resolve()
      // tsconfig lib 低 ES2024，这里用 executor 形式拿到 resolver。
      return new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    }
  }
}

async function createChain(
  store: ReaderDataStore,
  targetFileId: string,
  sessionId: string
): Promise<{
  readonly bridge: WebBridgeClient
  readonly host: ReaderHostSession
  readonly posted: string[]
  readonly queue: PostQueue
  readonly sent: BridgeMessage[]
}> {
  const queue = createPostQueue()
  const sent: BridgeMessage[] = []
  const existing = await store.get(targetFileId)
  const bridge = createWebBridgeClient({
    sessionId,
    sourceToken,
    clientId: 'client-1',
    post: (raw) => queue.push(raw)
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
    sendToWeb: (message) => {
      sent.push(message)
      bridge.handleMessage(JSON.stringify(message))
    }
  })
  return { bridge, host, posted: queue.items, queue, sent }
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

/** 投递 posted 队列直到 promise 结束（关闭握手会连续产生多轮消息）。 */
async function pumpUntilSettled<T>(
  host: ReaderHostSession,
  queue: PostQueue,
  promise: Promise<T>
): Promise<T> {
  let settled = false
  let signalSettled: () => void = () => undefined
  const settledSignal = new Promise<void>((resolve) => {
    signalSettled = resolve
  })
  const tracked = promise.then(
    (result) => {
      settled = true
      signalSettled()
      return result
    },
    (error: unknown) => {
      settled = true
      signalSettled()
      throw error
    }
  )
  while (!settled) {
    const raw = queue.shift()
    if (raw === undefined) {
      // 等新消息或关闭结束，不轮询真实计时器。
      await Promise.race([queue.wait(), settledSignal])
      continue
    }
    // 不 await：关闭超时用例里持久化可能永不完成，泵不能因此卡住。
    host.handleRawMessage(raw).catch(() => undefined)
    await Promise.resolve()
  }
  return tracked
}

describe('snapshot chain: close handshake', () => {
  it('persists the last pending write before closing', async () => {
    const { storage, chain } = await openChain('session-close')

    chain.bridge.sendChange(serializeReaderSnapshot(emptySnapshot))
    const closing = chain.host.close(2000)
    const result = await pumpUntilSettled(chain.host, chain.queue, closing)

    expect(result).toEqual({ status: 'closed' })
    const stored = JSON.parse(
      storage.values.get(`${SNAPSHOT_KEY}${fileId}`) ?? 'null'
    )
    expect(stored.revision).toBe(1)
    expect(stored.data.annotations).toBeDefined()
    // dispose 只能在 ack 之后发出。
    expect(chain.sent.at(-1)?.type).toBe('dispose')
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
  })

  it('reports an unconfirmed close instead of dropping a stuck write', async () => {
    const storage = new MemoryStorage()
    const store = new ReaderDataStore(storage)
    await store.upsert(record(fileId, 'book.pdf'))
    const chain = await createChain(store, fileId, 'session-stuck')
    // 持久化永不完成：关闭必须失败且不落半成品。
    store.saveSnapshot = () => new Promise<void>(() => undefined)
    chain.bridge.start()
    await deliver(chain.host, chain.posted)

    chain.bridge.sendChange(serializeReaderSnapshot(emptySnapshot))
    const closing = chain.host.close(0)
    const result = await pumpUntilSettled(chain.host, chain.queue, closing)

    expect(result.status).toBe('unconfirmed')
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}`)).toBe(false)
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
    // 撤回关闭后 Web 可以继续编辑。
    expect(chain.sent.at(-1)).toMatchObject({
      type: 'command',
      payload: { name: 'resume' }
    })
  })

  it('commits a migrated legacy snapshot once before opening the session', async () => {
    const storage = new MemoryStorage()
    const store = new ReaderDataStore(storage)
    await store.upsert({
      ...record(fileId, 'book.pdf'),
      snapshot: {
        data: {
          highlights: { version: 4, ranges: [], rects: [], paintings: {} },
          comments: { version: 2, comments: [] },
          readerData: { renderMode: 'layout' }
        },
        progress: null,
        revision: 3
      }
    })
    const chain = await createChain(store, fileId, 'session-migrate')
    chain.bridge.start()
    await deliver(chain.host, chain.posted)

    const restore = chain.sent.find((message) => message.type === 'restore')
    if (restore === undefined) throw new Error('缺少 restore')
    const payload = restore.payload as { data: unknown; progress: unknown }
    const initial = restoreReaderSnapshot(payload.data, payload.progress)
    expect(initial.migrated).toBe(true)

    // 首次迁移必须一次写入新键并 ack，而不是等用户编辑。
    chain.bridge.sendChange(serializeReaderSnapshot(initial))
    await deliver(chain.host, chain.posted)
    const stored = JSON.parse(
      storage.values.get(`${SNAPSHOT_KEY}${fileId}`) ?? 'null'
    )
    expect(stored.data.annotations).toEqual({
      version: 5,
      ranges: [],
      rects: [],
      paintings: {}
    })
    expect(stored.data.highlights).toBeUndefined()
    expect(stored.revision).toBe(4)

    // 重开只看到 annotations，不再触发迁移。
    const reopened = restoreReaderSnapshot(stored.data)
    expect(reopened.migrated).toBe(false)
    expect(reopened.data.pagePaintings).toEqual({})
  })
})

describe('snapshot chain: closing with an interleaved write', () => {
  it('persists both writes when the first persist is still in flight', async () => {
    const { storage, store, chain } = await openChain('session-interleave')
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const save = store.saveSnapshot.bind(store)
    store.saveSnapshot = (id, snapshot) =>
      snapshot.revision === 1
        ? gate.then(() => save(id, snapshot))
        : save(id, snapshot)

    chain.bridge.sendChange(serializeReaderSnapshot(emptySnapshot))
    const firstRaw = chain.queue.shift()
    if (firstRaw === undefined) throw new Error('缺少第一笔写入')
    const first = chain.host.handleRawMessage(firstRaw)
    // 第二笔进入 Web 端 pending：它在第一笔 ack 之前不会发出。
    chain.bridge.sendChange(
      serializeReaderSnapshot({
        ...emptySnapshot,
        data: { ...emptySnapshot.data, ranges: [] }
      })
    )
    const closing = chain.host.close(2000)

    release()
    await first
    const result = await pumpUntilSettled(chain.host, chain.queue, closing)

    expect(result).toEqual({ status: 'closed' })
    const stored = JSON.parse(
      storage.values.get(`${SNAPSHOT_KEY}${fileId}`) ?? 'null'
    )
    // 两笔都落盘，第二笔没有被关闭流程丢掉。
    expect(stored.revision).toBe(2)
    expect(stored.data.annotations).toBeDefined()
    expect(chain.sent.at(-1)?.type).toBe('dispose')
    expect(storage.values.has(`${SNAPSHOT_KEY}${fileId}.pending`)).toBe(false)
  })
})
