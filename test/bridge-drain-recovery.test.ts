import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDrainPair } from './helpers/bridge-drain'

const pairs: ReturnType<typeof createDrainPair>[] = []
function pair(options: Parameters<typeof createDrainPair>[0] = {}) {
  const value = createDrainPair(options)
  pairs.push(value)
  return value
}
afterEach(() => {
  pairs.splice(0).forEach((p) => p.dispose())
  vi.restoreAllMocks()
})
async function connect(p: ReturnType<typeof pair>) {
  p.web.start()
  await vi.waitFor(() => expect(p.web.getRevision()).not.toBeNull())
}

describe('Web handoff drain recovery', () => {
  it('accepts an ACKed frozen checkpoint when only the legacy ready event is lost', async () => {
    let draining = false
    const p = pair({ drop: (m) => draining && m.type === 'ready' })
    await connect(p)
    draining = true
    expect(await p.host.close(100, { handoff: true })).toEqual({
      status: 'closed'
    })
  })

  it('rejects completion checkpoints and ready from a previous close attempt', async () => {
    let dropCompletion = false
    const p = pair({
      drop: (m) =>
        dropCompletion &&
        (m.type === 'ready' ||
          (m.payload as { stage?: string })?.stage === 'complete')
    })
    await connect(p)
    dropCompletion = true
    expect((await p.host.close(30, { handoff: true })).status).toBe(
      'unconfirmed'
    )
    const staleMessages = p.webMessages.filter(
      (m) =>
        (m.type === 'ready' &&
          (m.payload as { flushRequestId?: string })?.flushRequestId) ||
        (m.payload as { stage?: string })?.stage === 'complete'
    )
    expect(staleMessages).toHaveLength(2)
    const retry = p.host.close(30, { handoff: true })
    for (const message of staleMessages) {
      await p.host.handleRawMessage(JSON.stringify(message))
    }
    expect((await retry).status).toBe('unconfirmed')
    expect(p.hostMessages.some((m) => m.type === 'dispose')).toBe(false)
  })

  it('resumes writes after a non-destructive flush without reopening the document', async () => {
    const p = pair()
    await connect(p)
    expect(await p.host.flush(100)).toEqual({ status: 'flushed' })
    p.web.sendChange({ ranges: [{ id: 'after-flush' }] })
    await vi.waitFor(() => expect(p.host.getSnapshot().revision).toBe(1))
    expect(p.hostMessages.filter((m) => m.type === 'open')).toHaveLength(1)
    expect(p.hostMessages.filter((m) => m.type === 'restore')).toHaveLength(1)
  })

  it('retries once after all writes are ACKed but the completion event was lost', async () => {
    let dropCompletion = false
    const quiesce = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => new Promise<void>(() => {}))
    const p = pair({
      quiesce,
      drop: (m) =>
        dropCompletion &&
        (m.type === 'ready' ||
          (m.payload as { stage?: string })?.stage === 'complete')
    })
    await connect(p)
    p.web.sendChange({ ranges: [{ id: 'saved' }] })
    await vi.waitFor(() => expect(p.web.getPendingCount()).toBe(0))
    dropCompletion = true
    expect((await p.host.close(30, { handoff: true })).status).toBe(
      'unconfirmed'
    )
    dropCompletion = false
    expect(await p.host.close(30, { handoff: true })).toEqual({
      status: 'closed'
    })
    expect(quiesce).toHaveBeenCalledTimes(1)
    expect(p.host.getSnapshot().data).toEqual({ ranges: [{ id: 'saved' }] })
  })

  it('keeps a failed write unconfirmed and retries the same request immediately', async () => {
    let fail = true
    const persist = vi.fn(async () => {
      if (fail) throw new Error('disk full')
    })
    const p = pair({ persist })
    await connect(p)
    p.web.sendChange({ ranges: [{ id: 'must-save' }] })
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
    expect((await p.host.close(30, { handoff: true })).status).toBe(
      'unconfirmed'
    )
    expect(p.web.getPendingCount()).toBe(1)
    expect(p.hostMessages.some((m) => m.type === 'dispose')).toBe(false)
    fail = false
    expect(await p.host.close(100, { handoff: true })).toEqual({
      status: 'closed'
    })
    expect(p.web.getPendingCount()).toBe(0)
    expect(p.host.getSnapshot().data).toEqual({ ranges: [{ id: 'must-save' }] })
  })

  it('reports stable-progress as the missing barrier rather than claiming unsaved writes', async () => {
    const p = pair({
      quiesce: async (report) => {
        report('stable-progress')
        await new Promise<void>(() => {})
      }
    })
    await connect(p)
    const result = await p.host.close(30, { handoff: true })
    expect(result).toMatchObject({
      status: 'unconfirmed',
      reason: expect.stringContaining('stable-progress')
    })
  })

  it('explicit discard waits for accepted writes, seals late input, and preserves confirmed data', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const p = pair({ persist: () => gate })
    await connect(p)
    p.web.sendChange({ ranges: [{ id: 'already-accepted' }] })
    const discard = Reflect.get(p.host, 'discardUnconfirmed') as
      | (() => Promise<void>)
      | undefined
    expect(discard).toBeTypeOf('function')
    let finished = false
    const completion = discard!().then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    release()
    await completion
    expect(p.host.getSnapshot().data).toEqual({
      ranges: [{ id: 'already-accepted' }]
    })
    expect(
      (
        await p.host.handleRawMessage(
          JSON.stringify({
            version: 1,
            sessionId: 'drain-test',
            sourceToken: 'token',
            requestId: 'late',
            type: 'change',
            payload: { data: {}, revision: 2 }
          })
        )
      ).accepted
    ).toBe(false)
  })
})
