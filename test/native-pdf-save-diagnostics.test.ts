import { describe, expect, it, vi } from 'vitest'

import { NativeOperationQueue } from '../src/nativePdf/persistence'
import type { NativeSaveQueueDiagnostic } from '../src/nativePdf/persistence'
import { ReaderDataStore } from '../src/host/readerDataStore'
import type { HostDocumentRecord } from '../src/host/readerDataStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('native save queue diagnostics (HAM-278 group 4)', () => {
  it('reports queued/started/confirmed with pending counts and the drain window', async () => {
    const events: NativeSaveQueueDiagnostic[] = []
    const gate = deferred<void>()
    const queue = new NativeOperationQueue<string>({
      onConfirmed: vi.fn(),
      onFailed: vi.fn(),
      onDiagnostic: (diagnostic) => events.push(diagnostic)
    })
    queue.add('save-1', async () => {
      await gate.promise
      return 'one'
    })
    queue.add('save-2', async () => 'two')
    expect(events.map((event) => event.event)).toEqual([
      'queued',
      'started',
      'queued'
    ])

    const drain = queue.drain()
    gate.resolve()
    await drain
    expect(events.map((event) => event.event)).toEqual([
      'queued',
      'started',
      'queued',
      'drain-start',
      'confirmed',
      'started',
      'confirmed',
      'drain-end'
    ])
    const confirmed = events.filter((event) => event.event === 'confirmed')
    expect(confirmed.map((event) => event.operationId)).toEqual([
      'save-1',
      'save-2'
    ])
    // 第二项入队时队列里有 2 个待写；开始写盘前等了第一项，事件里要有等待耗时。
    const queuedSecond = events.filter((event) => event.event === 'queued')[1]!
    expect(queuedSecond.operationId).toBe('save-2')
    expect(queuedSecond.pending).toBe(2)
    const second = events.filter((event) => event.event === 'started')[1]!
    expect(second.operationId).toBe('save-2')
    expect(second.waitMs).toBeGreaterThanOrEqual(0)
    const end = events.at(-1)!
    expect(end.event).toBe('drain-end')
    expect(end.pending).toBe(0)
    expect(end.ok).toBe(true)
    expect(end.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('reports a failed write and closes the drain window with ok=false', async () => {
    const events: NativeSaveQueueDiagnostic[] = []
    const queue = new NativeOperationQueue<string>({
      onConfirmed: vi.fn(),
      onFailed: vi.fn(),
      onDiagnostic: (diagnostic) => events.push(diagnostic)
    })
    queue.add('save-fail', async () => {
      throw new Error('disk full')
    })
    await expect(queue.drain()).rejects.toThrow('disk full')
    expect(events.map((event) => event.event)).toContain('failed')
    const end = events.at(-1)!
    expect(end).toMatchObject({ event: 'drain-end', ok: false, pending: 1 })
  })
})

describe('store write queue diagnostics (HAM-278 group 4)', () => {
  it('logs the queued write behind an in-flight write for the same file', async () => {
    vi.stubGlobal('__DEV__', true)
    const values = new Map<string, string>()
    const storage = {
      read: async (key: string) => values.get(key) ?? null,
      write: async (key: string, value: string) => {
        values.set(key, value)
      },
      remove: async (key: string) => {
        values.delete(key)
      }
    }
    const store = new ReaderDataStore(storage)
    const record: HostDocumentRecord = {
      fileId: 'f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fileName: 'a.pdf',
      format: 'pdf',
      size: 1,
      modifiedAt: 1,
      importedAt: 1,
      cachedUri: `reader-files/f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf`,
      snapshot: { data: null, progress: null, revision: 0 }
    }
    await store.upsert(record)

    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const first = store.updateSnapshot(record.fileId, (snapshot) => ({
        ...snapshot,
        revision: snapshot.revision + 1
      }))
      const second = store.updateSnapshot(record.fileId, (snapshot) => ({
        ...snapshot,
        revision: snapshot.revision + 1
      }))
      await Promise.all([first, second])
      const queued = info.mock.calls.filter(
        ([message]) => message === 'reader-store-write-queue'
      )
      expect(queued.length).toBeGreaterThan(0)
      expect(queued[0]?.[1]).toMatchObject({
        fileId: record.fileId,
        event: 'queued',
        queueDepth: 1
      })
      expect(queued.at(-1)?.[1]).toMatchObject({
        fileId: record.fileId,
        event: 'started',
        queueDepth: 1
      })
    } finally {
      info.mockRestore()
    }
  })
})
