import { describe, expect, it, vi } from 'vitest'
import {
  ReaderFileResourcePool,
  ReaderFileSession,
  type ReaderFileAdapter,
  type ReaderFileHost
} from '../src/workspace/readerFileSession'
import type { ToolbarFile } from '@hamster-note/painting/toolbar'
import type { ReaderData } from '../src/types/readerData'

const file = (
  key: string,
  resolvedFormat: string,
  storageId = 'local'
): ToolbarFile => ({
  key,
  resolvedFormat,
  storageId,
  path: `/${key}`,
  displayName: 'same-name'
})
const files = [
  file('a', 'pdf'),
  file('b', 'epub'),
  file('txt', 'txt'),
  file('hnn', 'hnn'),
  file('hpb', 'hpb'),
  file('bad', 'unknown'),
  { ...file('cloud-a', 'pdf', 'cloud'), path: '/a' }
]
function harness(
  options: {
    formats?: string[]
    pool?: ReaderFileResourcePool
    pane?: string
    active?: boolean
  } = {}
) {
  const events: string[] = []
  let position: ReaderData = {
    layoutReadingProgress: { pageNumber: 8, verticalPercentage: 50 }
  }
  let restore = true
  const restored: ReaderData[] = []
  const dispose = vi.fn(async () => {
    events.push('dispose')
  })
  const adapters: ReaderFileAdapter[] = (
    options.formats ?? ['pdf', 'epub']
  ).map((format) => ({
    format,
    load: vi.fn(async (f) => {
      events.push(`load:${f.key}`)
      return {
        props: {
          data: {
            layoutReadingProgress: { pageNumber: 2, verticalPercentage: 10 }
          }
        },
        dispose
      }
    })
  }))
  const host: ReaderFileHost = {
    supports: (f) => ['hnn', 'hpb', 'txt'].includes(f),
    save: vi.fn(async () => {
      events.push('save')
    }),
    handover: vi.fn(async (request) => {
      events.push('handover')
      await request.release()
      return { status: 'success' as const }
    }),
    commit: vi.fn(async (request) => {
      events.push(`commit:${request.file.key}`)
    }),
    reload: vi.fn(async () => ({
      status: 'failed' as const,
      message: 'reload failed'
    }))
  }
  const session = new ReaderFileSession({
    paneId: options.pane ?? 'left',
    files: () => files,
    adapters,
    host,
    pool: options.pool,
    isActivePane: () => options.active ?? true
  })
  let attached: string | undefined
  session.subscribe(() => {
    const state = session.getSnapshot()
    if (state.phase !== 'restoring' || state.sessionId === attached) return
    attached = state.sessionId
    restored.push(state.data!)
    session.attach(state.sessionId!, {
      flush: async () => {
        events.push('flush')
        return position
      },
      release: async () => {
        events.push('unmount')
      }
    })
    queueMicrotask(() => {
      if (restore) session.restored(state.sessionId!)
    })
  })
  return {
    session,
    host,
    adapters,
    events,
    dispose,
    restored,
    setPosition: (data: ReaderData) => {
      position = data
    },
    setRestore: (value: boolean) => {
      restore = value
    }
  }
}

describe('pane file transactions', () => {
  it('restores after layout, saves before release, and keeps only lightweight per-pane positions', async () => {
    const h = harness()
    await h.session.open('a')
    const oldSession = h.session.getSnapshot().sessionId!
    h.events.length = 0
    await h.session.open('b')
    expect(h.host.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fileKey: 'a',
        file: files[0],
        sessionId: oldSession
      })
    )
    expect(h.events).toEqual([
      'flush',
      'save',
      'unmount',
      'dispose',
      'load:b',
      'commit:b'
    ])
    expect(
      h.session.update(oldSession, {
        layoutReadingProgress: { pageNumber: 1, verticalPercentage: 0 }
      })
    ).toBe(false)
    await h.session.open('a')
    expect(h.restored.at(-1)?.layoutReadingProgress).toEqual({
      pageNumber: 8,
      verticalPercentage: 50
    })
    await h.session.open('cloud-a')
    expect(h.restored.at(-1)?.layoutReadingProgress).toEqual({
      pageNumber: 2,
      verticalPercentage: 10
    })
    await h.session.dispose()
  })
  it('current file, wrong pane, and unsupported format never save or unload', async () => {
    const h = harness()
    await h.session.open('a')
    h.events.length = 0
    expect(await h.session.open('a')).toEqual({ status: 'success' })
    expect(
      await h.session.select({
        paneId: 'right',
        fileKey: 'b',
        requestId: 'wrong'
      })
    ).toMatchObject({ status: 'failed' })
    expect(await h.session.open('bad')).toMatchObject({ status: 'failed' })
    expect(h.events).toEqual([])
    await h.session.dispose()
  })
  it.each(['hnn', 'hpb', 'txt'])(
    'unregistered %s makes exactly one asynchronous host handover',
    async (key) => {
      const h = harness()
      await h.session.open('a')
      await h.session.open(key)
      expect(h.host.handover).toHaveBeenCalledTimes(1)
      expect(h.host.handover).toHaveBeenCalledWith(
        expect.objectContaining({ paneId: 'left', fileKey: key })
      )
      expect(h.events.indexOf('save')).toBeLessThan(
        h.events.indexOf('handover')
      )
      expect(h.session.getSnapshot().currentFileKey).toBe(key)
      await h.session.dispose()
    }
  )
  it('registered TXT uses the in-place adapter, regardless of filename', async () => {
    const h = harness({ formats: ['pdf', 'txt'] })
    await h.session.open('a')
    await h.session.open('txt')
    expect(h.events).toContain('load:txt')
    expect(h.host.handover).not.toHaveBeenCalled()
    await h.session.dispose()
  })
  it('save NACK preserves the live document and menu item', async () => {
    const h = harness()
    await h.session.open('a')
    h.events.length = 0
    vi.mocked(h.host.save).mockRejectedValueOnce(new Error('conflict'))
    expect(await h.session.open('b')).toMatchObject({
      status: 'failed' as const,
      message: 'conflict'
    })
    expect(h.session.getSnapshot()).toMatchObject({
      currentFileKey: 'a',
      phase: 'idle'
    })
    expect(h.dispose).not.toHaveBeenCalled()
    expect(h.events).toEqual(['flush'])
    expect(h.host.reload).not.toHaveBeenCalled()
    await h.session.dispose()
  })
  it('delayed ACK prevents parallel switches and engine disposal', async () => {
    const h = harness()
    await h.session.open('a')
    let ack!: () => void
    vi.mocked(h.host.save).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ack = resolve
        })
    )
    const first = h.session.open('b')
    await vi.waitFor(() => expect(ack).toBeTypeOf('function'))
    expect(await h.session.open('cloud-a')).toMatchObject({ status: 'failed' })
    expect(h.dispose).not.toHaveBeenCalled()
    ack()
    await first
    expect(h.session.getSnapshot().currentFileKey).toBe('b')
    await h.session.dispose()
  })
  it('cancelled host handover keeps reader and does not commit', async () => {
    const h = harness()
    await h.session.open('a')
    vi.mocked(h.host.commit).mockClear()
    vi.mocked(h.host.handover).mockResolvedValueOnce({ status: 'cancelled' })
    expect(await h.session.open('hnn')).toEqual({ status: 'cancelled' })
    expect(h.dispose).not.toHaveBeenCalled()
    expect(h.host.commit).not.toHaveBeenCalled()
    expect(h.session.getSnapshot().currentFileKey).toBe('a')
    await h.session.dispose()
  })
  it('load failure invokes host reload once; retry and reopening original use storage', async () => {
    const h = harness()
    await h.session.open('a')
    vi.mocked(h.adapters[1].load).mockRejectedValueOnce(new Error('corrupt'))
    expect(await h.session.open('b')).toMatchObject({ status: 'failed' })
    expect(h.host.reload).toHaveBeenCalledTimes(1)
    expect(h.session.getSnapshot()).toMatchObject({
      phase: 'error',
      currentFileKey: 'a'
    })
    expect(await h.session.retry()).toMatchObject({ status: 'success' })
    expect(await h.session.reopenPrevious()).toMatchObject({
      status: 'success'
    })
    expect(h.events.filter((event) => event === 'load:a')).toHaveLength(2)
    await h.session.dispose()
  })
  it('cleanup failure still falls back to host reload exactly once', async () => {
    const h = harness()
    await h.session.open('a')
    h.dispose.mockRejectedValueOnce(new Error('worker destruction failed'))
    expect(await h.session.open('b')).toMatchObject({ status: 'failed' })
    expect(h.host.reload).toHaveBeenCalledTimes(1)
    expect(h.session.getSnapshot().document).toBeUndefined()
    await h.session.dispose()
  })
  it('restoration rejects initialization writes and stale ready receipts', async () => {
    const h = harness()
    await h.session.open('a')
    h.setRestore(false)
    const oldId = h.session.getSnapshot().sessionId!
    const next = h.session.open('b')
    await vi.waitFor(() =>
      expect(h.session.getSnapshot().phase).toBe('restoring')
    )
    const id = h.session.getSnapshot().sessionId!
    expect(
      h.session.update(id, {
        layoutReadingProgress: { pageNumber: 1, verticalPercentage: 0 }
      })
    ).toBe(false)
    h.session.restored(oldId)
    expect(h.session.getSnapshot().currentFileKey).toBe('a')
    h.session.loadFailed(id, new Error('layout failed'))
    expect(await next).toMatchObject({ status: 'failed' })
    expect(h.host.reload).toHaveBeenCalledTimes(1)
    await h.session.dispose()
  })
  it('shares only live resource references and isolates pane positions', async () => {
    const pool = new ReaderFileResourcePool(2)
    const a = harness({ pool, pane: 'left' }),
      b = harness({ pool, pane: 'right', active: false })
    await a.session.open('a')
    await b.session.open('a')
    b.setPosition({
      layoutReadingProgress: { pageNumber: 3, verticalPercentage: 12 }
    })
    expect(pool.activeDocuments).toBe(1)
    await a.session.open('b')
    expect(a.dispose).not.toHaveBeenCalled()
    expect(pool.activeDocuments).toBe(2)
    await a.session.dispose()
    expect(pool.activeDocuments).toBe(1)
    await b.session.open('b')
    expect(a.dispose).toHaveBeenCalled()
    expect(b.host.save).toHaveBeenCalledWith(
      expect.objectContaining({ persistPosition: false })
    )
    await b.session.open('a')
    expect(b.restored.at(-1)?.layoutReadingProgress).toEqual({
      pageNumber: 3,
      verticalPercentage: 12
    })
    await b.session.dispose()
    expect(pool.activeDocuments).toBe(0)
  })
  it('shared sources keep per-pane controlled callbacks and persisted data separate', async () => {
    const pool = new ReaderFileResourcePool(2),
      left = harness({ pool }),
      right = harness({ pool, pane: 'right' })
    Object.assign(left.adapters[0], {
      viewProps: async () => ({
        data: {
          layoutReadingProgress: { pageNumber: 4, verticalPercentage: 10 }
        }
      })
    })
    Object.assign(right.adapters[0], {
      viewProps: async () => ({
        data: {
          layoutReadingProgress: { pageNumber: 7, verticalPercentage: 20 }
        }
      })
    })
    await left.session.open('a')
    await right.session.open('a')
    expect(left.restored[0].layoutReadingProgress?.pageNumber).toBe(4)
    expect(right.restored[0].layoutReadingProgress?.pageNumber).toBe(7)
    expect(right.adapters[0].load).not.toHaveBeenCalled()
    await left.session.dispose()
    await right.session.dispose()
  })
  it('holds the resource slot until asynchronous destruction finishes', async () => {
    const pool = new ReaderFileResourcePool(1),
      h = harness()
    let complete!: () => void
    h.dispose.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const document = await pool.acquire(files[0], h.adapters[0])
    const releasing = document.dispose()
    expect(pool.activeDocuments).toBe(1)
    await expect(pool.acquire(files[0], h.adapters[0])).rejects.toThrow(
      'being released'
    )
    complete()
    await releasing
    expect(pool.activeDocuments).toBe(0)
  })
  it('pool prevents a third distinct active document', async () => {
    const pool = new ReaderFileResourcePool(2),
      h = harness()
    const first = await pool.acquire(files[0], h.adapters[0]),
      second = await pool.acquire(files[1], h.adapters[1])
    await expect(pool.acquire(files[6], h.adapters[0])).rejects.toThrow('limit')
    await first.dispose()
    await second.dispose()
    expect(pool.activeDocuments).toBe(0)
  })
})
