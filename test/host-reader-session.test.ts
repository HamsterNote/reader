import { describe, expect, it } from 'vitest'

import type { BridgeHostSnapshot } from '../src/bridge/hostSession'
import type { BridgeMessage } from '../src/bridge/protocol'
import {
  createReaderHostSession,
  type ReaderHostSession
} from '../src/host/readerHostSession'

const sessionId = 'session-1'
const sourceToken = 'source-token'

function raw(
  type: BridgeMessage['type'],
  payload: unknown,
  overrides: {
    readonly sessionId?: string
    readonly requestId?: string
    readonly version?: number
    readonly sourceToken?: string
  } = {}
): string {
  return JSON.stringify({
    version: overrides.version ?? 1,
    sessionId: overrides.sessionId ?? sessionId,
    requestId: overrides.requestId ?? `web-${type}`,
    type,
    payload,
    sourceToken: overrides.sourceToken ?? sourceToken
  })
}

type Harness = {
  readonly session: ReaderHostSession
  readonly sent: BridgeMessage[]
  readonly persisted: BridgeHostSnapshot[]
  readonly raw: typeof raw
}

function createHarness(
  options: {
    readonly snapshot?: BridgeHostSnapshot | null
    readonly persist?: (snapshot: BridgeHostSnapshot) => Promise<void>
  } = {}
): Harness {
  const sent: BridgeMessage[] = []
  const persisted: BridgeHostSnapshot[] = []
  const session = createReaderHostSession({
    sessionId,
    sourceToken,
    descriptor: {
      fileId: 'f_0123456789abcdef0123456789abcdef',
      format: 'epub',
      fileUrl: 'file:///cache/book.epub'
    },
    confirmedSnapshot: options.snapshot ?? null,
    persist: async (snapshot) => {
      persisted.push(snapshot)
      await options.persist?.(snapshot)
    },
    sendToWeb: (message) => sent.push(message)
  })
  return { session, sent, persisted, raw }
}

async function ready(harness: Harness): Promise<void> {
  await harness.session.handleRawMessage(
    raw('ready', {}, { requestId: 'web-ready-1' })
  )
}

describe('ReaderHostSession', () => {
  it('sends open then restore on ready', async () => {
    const harness = createHarness()
    await ready(harness)
    expect(harness.sent.map((message) => message.type)).toEqual([
      'open',
      'restore'
    ])
    expect(harness.sent[0]?.payload).toEqual({
      document: {
        fileId: 'f_0123456789abcdef0123456789abcdef',
        format: 'epub',
        fileUrl: 'file:///cache/book.epub'
      }
    })
    expect(harness.sent[1]?.payload).toMatchObject({
      data: null,
      progress: null,
      revision: 0
    })
  })

  it('does not acknowledge before the asynchronous persist resolves', async () => {
    let release: (() => void) | undefined
    const persisting = new Promise<void>((resolve) => {
      release = resolve
    })
    const harness = createHarness({ persist: () => persisting })
    await ready(harness)
    harness.sent.length = 0

    const pending = harness.session.handleRawMessage(
      raw('change', { data: { ranges: [1] }, revision: 1 })
    )
    await Promise.resolve()
    expect(harness.sent).toHaveLength(0)

    release?.()
    await pending
    expect(harness.sent).toHaveLength(1)
    expect(harness.sent[0]).toMatchObject({
      type: 'ack',
      payload: { revision: 1 }
    })
  })

  it('applies duplicate requestIds once and re-acks', async () => {
    const harness = createHarness()
    await ready(harness)
    harness.sent.length = 0
    const message = raw(
      'change',
      { data: { ranges: [1] }, revision: 1 },
      { requestId: 'dup-1' }
    )

    await harness.session.handleRawMessage(message)
    await harness.session.handleRawMessage(message)

    expect(harness.persisted).toHaveLength(1)
    expect(harness.sent.map((entry) => entry.type)).toEqual(['ack', 'ack'])
    expect(harness.sent[0]?.payload).toMatchObject({
      requestId: 'dup-1',
      revision: 1
    })
    expect(harness.sent[1]?.payload).toEqual(harness.sent[0]?.payload)
  })

  it('rejects writes before restore without persisting', async () => {
    const harness = createHarness()
    await harness.session.handleRawMessage(
      raw('change', { data: { ranges: [] }, revision: 1 })
    )
    expect(harness.persisted).toHaveLength(0)
    expect(harness.sent[0]).toMatchObject({ type: 'error' })
    expect(harness.sent[0]?.payload).toMatchObject({ code: 'RESTORE_PENDING' })
  })

  it('rejects stale sessions and forged tokens', async () => {
    const harness = createHarness()
    await ready(harness)

    const stale = await harness.session.handleRawMessage(
      raw('change', { data: {}, revision: 1 }, { sessionId: 'old-session' })
    )
    expect(stale.accepted).toBe(false)
    expect(stale.rejection?.code).toBe('STALE_SESSION')

    const forged = await harness.session.handleRawMessage(
      raw('change', { data: {}, revision: 1 }, { sourceToken: 'forged' })
    )
    expect(forged.accepted).toBe(false)
    expect(forged.rejection?.code).toBe('INVALID_MESSAGE')
    expect(harness.persisted).toHaveLength(0)
  })

  it('accepts messages only for the current version', async () => {
    const harness = createHarness()
    const result = await harness.session.handleRawMessage(
      raw('ready', {}, { version: 2 })
    )
    expect(result.accepted).toBe(true)
    expect(harness.sent.map((message) => message.type)).toEqual([
      'open',
      'error'
    ])
    expect(harness.sent[1]?.payload).toMatchObject({
      code: 'UNSUPPORTED_VERSION'
    })
  })

  it('re-enforces strictly increasing revisions', async () => {
    const harness = createHarness()
    await ready(harness)
    harness.sent.length = 0
    await harness.session.handleRawMessage(
      raw('change', { data: { ranges: [] }, revision: 2 })
    )
    expect(harness.sent[0]?.payload).toMatchObject({
      code: 'REVISION_MISMATCH'
    })
    expect(harness.persisted).toHaveLength(0)
  })

  it('keeps the previous snapshot and allows retry after persist failure', async () => {
    let fail = true
    const harness = createHarness({
      persist: async () => {
        if (fail) throw new Error('disk full')
      }
    })
    await ready(harness)
    harness.sent.length = 0

    await harness.session.handleRawMessage(
      raw(
        'change',
        { data: { ranges: [1] }, revision: 1 },
        { requestId: 'write-1' }
      )
    )
    expect(harness.sent[0]).toMatchObject({ type: 'error' })
    expect(harness.sent[0]?.payload).toMatchObject({ code: 'ENGINE_FAILURE' })
    expect(harness.session.getSnapshot().revision).toBe(0)

    fail = false
    await harness.session.handleRawMessage(
      raw(
        'change',
        { data: { ranges: [1] }, revision: 1 },
        { requestId: 'write-2' }
      )
    )
    expect(harness.sent[1]).toMatchObject({
      type: 'ack',
      payload: { revision: 1 }
    })
    expect(harness.session.getSnapshot().revision).toBe(1)
  })

  it('restores the last confirmed snapshot after a WebView reload', async () => {
    const harness = createHarness()
    await ready(harness)
    await harness.session.handleRawMessage(
      raw('change', { data: { ranges: [1] }, revision: 1 })
    )
    harness.sent.length = 0

    await harness.session.handleRawMessage(
      raw('ready', {}, { requestId: 'web-ready-2' })
    )
    expect(harness.sent.map((message) => message.type)).toEqual([
      'open',
      'restore'
    ])
    expect(harness.sent[1]?.payload).toMatchObject({
      data: { ranges: [1] },
      revision: 1
    })
  })

  it('ignores the unacknowledged write after a reload', async () => {
    let fail = true
    const harness = createHarness({
      persist: async () => {
        if (fail) throw new Error('disk full')
      }
    })
    await ready(harness)
    await harness.session.handleRawMessage(
      raw('change', { data: { ranges: [9] }, revision: 1 })
    )
    harness.sent.length = 0
    fail = false

    await harness.session.handleRawMessage(
      raw('ready', {}, { requestId: 'web-ready-2' })
    )
    const restore = harness.sent.find((message) => message.type === 'restore')
    expect(restore?.payload).toMatchObject({ data: null, revision: 0 })
  })

  it('stops accepting messages after dispose', async () => {
    const harness = createHarness()
    await ready(harness)
    harness.session.sendDispose()
    expect(harness.sent.at(-1)?.type).toBe('dispose')

    const result = await harness.session.handleRawMessage(
      raw('change', { data: {}, revision: 1 })
    )
    expect(result.accepted).toBe(false)
    expect(result.rejection?.code).toBe('STALE_SESSION')
  })

  it('serializes concurrent async writes', async () => {
    const harness = createHarness()
    await ready(harness)
    harness.sent.length = 0

    await Promise.all([
      harness.session.handleRawMessage(
        raw(
          'change',
          { data: { ranges: [1] }, revision: 1 },
          { requestId: 'c1' }
        )
      ),
      harness.session.handleRawMessage(
        raw(
          'progress',
          { progress: { page: 2 }, revision: 2 },
          { requestId: 'p2' }
        )
      )
    ])

    expect(harness.persisted.map((entry) => entry.revision)).toEqual([1, 2])
    expect(harness.sent.map((message) => message.type)).toEqual(['ack', 'ack'])
    expect(harness.session.getSnapshot()).toMatchObject({
      revision: 2,
      data: { ranges: [1] },
      progress: { page: 2 }
    })
  })
})
