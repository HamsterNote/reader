import { describe, expect, it } from 'vitest'

import { createWebBridgeClient } from '../webview/src/bridgeClient'
import type { WebBridgeTimers } from '../webview/src/bridgeClient'

const sessionId = 'session-1'
const sourceToken = 'source-token'

type Timers = {
  readonly api: WebBridgeTimers
  readonly fireAll: () => void
  readonly pending: () => number
}

function createTimers(): Timers {
  let nextHandle = 1
  const callbacks = new Map<number, () => void>()
  return {
    api: {
      setTimeout: (callback) => {
        const handle = nextHandle
        nextHandle += 1
        callbacks.set(handle, callback)
        return handle
      },
      clearTimeout: (handle) => {
        callbacks.delete(Number(handle))
      }
    },
    fireAll: () => {
      const current = [...callbacks.values()]
      callbacks.clear()
      for (const callback of current) callback()
    },
    pending: () => callbacks.size
  }
}

function hostMessage(
  type: string,
  payload: unknown,
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    version: 1,
    sessionId,
    requestId: `host-${type}`,
    type,
    payload,
    ...overrides
  })
}

function createHarness() {
  const sent: Record<string, unknown>[] = []
  const timers = createTimers()
  const bridge = createWebBridgeClient({
    sessionId,
    sourceToken,
    post: (raw) => sent.push(JSON.parse(raw)),
    timers: timers.api,
    retryTimeoutMs: 1000
  })
  return { bridge, sent, timers }
}

describe('createWebBridgeClient', () => {
  it('starts with a ready envelope carrying the host token', () => {
    const { bridge, sent } = createHarness()
    bridge.start()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      version: 1,
      sessionId,
      type: 'ready',
      sourceToken
    })
    expect(typeof sent[0]?.requestId).toBe('string')
    expect(sent[0]?.requestId).not.toBe('')
  })

  it('does not write before restore and continues from the restored revision', () => {
    const { bridge, sent } = createHarness()
    bridge.start()
    bridge.sendChange({ ranges: [] })
    expect(sent).toHaveLength(1)

    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 4 })
    )
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({
      type: 'change',
      payload: { data: { ranges: [] }, revision: 5 }
    })
  })

  it('advances to the next revision only after ack', () => {
    const { bridge, sent } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ ranges: [1] })
    expect(sent.at(-1)).toMatchObject({
      type: 'change',
      payload: { revision: 1 }
    })

    bridge.sendProgress({ page: 2 })
    expect(sent).toHaveLength(2)

    const change = sent[1] as { requestId: string }
    bridge.handleMessage(
      hostMessage('ack', { requestId: change.requestId, revision: 1 })
    )
    expect(sent.at(-1)).toMatchObject({
      type: 'progress',
      payload: { progress: { page: 2 }, revision: 2 }
    })
    expect(bridge.getRevision()).toBe(1)
  })

  it('coalesces pending writes to the latest payload', () => {
    const { bridge, sent } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ ranges: [1] })
    bridge.sendChange({ ranges: [2] })
    bridge.sendChange({ ranges: [3] })
    expect(sent).toHaveLength(2)

    const change = sent[1] as { requestId: string }
    bridge.handleMessage(
      hostMessage('ack', { requestId: change.requestId, revision: 1 })
    )
    expect(sent.at(-1)).toMatchObject({
      payload: { data: { ranges: [3] }, revision: 2 }
    })
  })

  it('retries the exact same request until acked', () => {
    const { bridge, sent, timers } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ ranges: [1] })
    const first = sent[1]
    expect(timers.pending()).toBe(1)

    timers.fireAll()
    expect(sent[2]).toEqual(first)
    expect(timers.pending()).toBe(1)

    bridge.handleMessage(
      hostMessage('ack', {
        requestId: first?.requestId,
        revision: 1
      })
    )
    expect(timers.pending()).toBe(0)
  })

  it('ignores duplicate acks and stale-session messages', () => {
    const { bridge, sent } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 2 })
    )
    bridge.sendChange({ ranges: [] })
    const change = sent[1] as { requestId: string }
    bridge.handleMessage(
      hostMessage('ack', { requestId: change.requestId, revision: 3 })
    )
    bridge.handleMessage(
      hostMessage('ack', { requestId: change.requestId, revision: 3 })
    )
    bridge.handleMessage(
      hostMessage(
        'restore',
        { data: null, progress: null, revision: 100 },
        { sessionId: 'old-session' }
      )
    )
    expect(bridge.getRevision()).toBe(3)
  })

  it('re-handshakes on revision mismatch', () => {
    const { bridge, sent } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.handleMessage(
      hostMessage('error', {
        code: 'REVISION_MISMATCH',
        message: 'expected 1',
        requestId: 'x'
      })
    )
    expect(sent.at(-1)).toMatchObject({ type: 'ready' })
    expect(bridge.getRevision()).toBeNull()
  })

  it('stops writing after dispose', () => {
    const { bridge, sent } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.handleMessage(hostMessage('dispose', {}))
    bridge.sendChange({ ranges: [1] })
    expect(sent).toHaveLength(1)
  })

  it('namespaces requestIds per client instance so a reloaded page never collides', () => {
    // 回归：页面重载后新客户端曾从 0 重新计数，requestId 与宿主幂等表
    // 冲突，新修改被当成重复投递静默丢弃（HAM-90 评审问题 3）。
    const first = createHarness()
    first.bridge.start()
    first.bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    first.bridge.sendChange({ ranges: [1] })

    const reloaded = createHarness()
    reloaded.bridge.start()
    reloaded.bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 1 })
    )
    reloaded.bridge.sendChange({ ranges: [2] })

    const firstIds = first.sent.map((message) => message['requestId'])
    for (const message of reloaded.sent) {
      expect(firstIds).not.toContain(message['requestId'])
    }
  })
})

describe('createWebBridgeClient flushPending', () => {
  it('resolves only after the pending write is acknowledged', async () => {
    const { bridge, sent, timers } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ annotations: { version: 5 } })
    const flushed = bridge.flushPending(1000)
    expect(bridge.getPendingCount()).toBe(1)

    const change = sent.at(-1) ?? {}
    bridge.handleMessage(
      hostMessage('ack', {
        requestId: change['requestId'],
        revision: 1
      })
    )

    await expect(flushed).resolves.toBe(true)
    expect(bridge.getPendingCount()).toBe(0)
    expect(timers.pending()).toBe(0)
  })

  it('reports an unconfirmed flush on timeout without clearing the write', async () => {
    const { bridge, timers } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ annotations: { version: 5 } })

    const flushed = bridge.flushPending(1000)
    timers.fireAll()

    await expect(flushed).resolves.toBe(false)
    // 超时只说明“未确认”，写入仍会重发，不能被当成已保存。
    expect(bridge.getPendingCount()).toBeGreaterThan(0)
  })

  it('reports an unconfirmed flush when the session is disposed', async () => {
    const { bridge } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ annotations: { version: 5 } })

    const flushed = bridge.flushPending(1000)
    bridge.handleMessage(hostMessage('dispose', {}))

    await expect(flushed).resolves.toBe(false)
  })
})

describe('createWebBridgeClient close handshake', () => {
  it('queues edits made during the drain and answers ready only after all acks', async () => {
    const { bridge, sent } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ annotations: { version: 5 } })
    const first = sent.at(-1) ?? {}

    bridge.handleMessage(hostMessage('command', { name: 'flush' }))
    // 冻结前/冻结瞬间产生的编辑继续入队，纳入 ack 屏障而不是被丢弃。
    bridge.sendChange({ annotations: { version: 5, ranges: [1] } })
    expect(bridge.getPendingCount()).toBe(2)

    bridge.handleMessage(
      hostMessage('ack', { requestId: first['requestId'], revision: 1 })
    )
    await Promise.resolve()
    // 第一笔 ack 后第二笔发出，但还不能报告 ready。
    const second = sent.at(-1) ?? {}
    expect(second['type']).toBe('change')
    expect(bridge.getPendingCount()).toBe(1)

    bridge.handleMessage(
      hostMessage('ack', { requestId: second['requestId'], revision: 2 })
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(sent.at(-1)).toMatchObject({ type: 'ready' })
    expect(bridge.getPendingCount()).toBe(0)
  })

  it('answers error instead of ready when flushing times out', async () => {
    const { bridge, sent, timers } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ annotations: { version: 5 } })

    bridge.handleMessage(hostMessage('command', { name: 'flush' }))
    timers.fireAll()
    await Promise.resolve()
    await Promise.resolve()

    expect(sent.at(-1)).toMatchObject({
      type: 'error',
      payload: { code: 'ENGINE_FAILURE' }
    })
  })

  it('resumes editing when the host cancels the close', () => {
    const { bridge } = createHarness()
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )
    bridge.sendChange({ annotations: { version: 5 } })
    bridge.handleMessage(hostMessage('command', { name: 'flush' }))
    bridge.handleMessage(hostMessage('command', { name: 'resume' }))

    const before = bridge.getPendingCount()
    bridge.sendChange({ annotations: { version: 5, ranges: [1] } })
    // 恢复编辑后新写入会进入 pending（排在在途那一笔之后），不再被丢弃。
    expect(bridge.getPendingCount()).toBe(before + 1)
  })
})

describe('createWebBridgeClient drain signal', () => {
  it('announces drain start, resume and dispose to the UI', () => {
    const states: boolean[] = []
    const bridge = createWebBridgeClient({
      sessionId,
      sourceToken,
      post: () => undefined,
      timers: createTimers().api,
      onDrainingChange: (draining) => states.push(draining)
    })
    bridge.start()
    bridge.handleMessage(
      hostMessage('restore', { data: null, progress: null, revision: 0 })
    )

    bridge.handleMessage(hostMessage('command', { name: 'flush' }))
    expect(states).toEqual([true])

    bridge.handleMessage(hostMessage('command', { name: 'resume' }))
    expect(states).toEqual([true, false])

    bridge.handleMessage(hostMessage('command', { name: 'flush' }))
    bridge.handleMessage(hostMessage('dispose', {}))
    expect(states).toEqual([true, false, true, false])
  })
})
