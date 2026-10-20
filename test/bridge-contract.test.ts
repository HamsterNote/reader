// @vitest-environment node
//
// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.3。
// 桥接协议契约测试，覆盖任务要求的四项：
// 1. 初始化不清空数据（restore 前拒绝写入）；
// 2. 旧会话拒绝（dispose / 切文档后 STALE_SESSION）；
// 3. 重复事件幂等（同 requestId 只持久化一次）；
// 4. 错误恢复（引擎错误后 ready 重新下发最后确认快照）。
// 另固定版本协商、revision 递增、消息结构校验。

import { describe, expect, it } from 'vitest'

import {
  createBridgeHostSession,
  type BridgeHostSnapshot
} from '../src/bridge/hostSession'
import {
  READER_BRIDGE_PROTOCOL_VERSION,
  type BridgeErrorPayload,
  type BridgeMessage
} from '../src/bridge/protocol'

let requestIdCounter = 0

function webMessage(
  sessionId: string,
  type: string,
  payload: unknown,
  requestId?: string
): BridgeMessage {
  requestIdCounter += 1
  return {
    version: READER_BRIDGE_PROTOCOL_VERSION,
    sessionId,
    requestId: requestId ?? `req-auto-${requestIdCounter}`,
    type: type as BridgeMessage['type'],
    payload
  }
}

function setup(options?: {
  confirmedSnapshot?: BridgeHostSnapshot | null
  sessionId?: string
}) {
  const persisted: BridgeHostSnapshot[] = []
  const session = createBridgeHostSession({
    sessionId: options?.sessionId ?? 'session-a',
    confirmedSnapshot: options?.confirmedSnapshot ?? null,
    persist: (snapshot) => persisted.push(snapshot)
  })
  return { session, persisted }
}

const EXISTING_SNAPSHOT: BridgeHostSnapshot = {
  data: {
    ranges: [{ id: 'range-1', text: '既有高亮' }],
    bookmarks: [{ pageNumber: 2, verticalPercentage: 41 }]
  },
  progress: { currentPageNumber: 2 },
  revision: 7
}

describe('bridge contract: ready / restore', () => {
  it('answers ready with the last confirmed snapshot and revision', () => {
    const { session } = setup({ confirmedSnapshot: EXISTING_SNAPSHOT })

    const replies = session.handleWebMessage(
      webMessage('session-a', 'ready', {}, 'req-ready')
    )

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      type: 'restore',
      payload: {
        data: EXISTING_SNAPSHOT.data,
        progress: EXISTING_SNAPSHOT.progress,
        revision: 7
      }
    })
  })

  it('restores an empty initial snapshot for a file without history', () => {
    const { session } = setup()

    const replies = session.handleWebMessage(
      webMessage('session-a', 'ready', {}, 'req-ready')
    )

    expect(replies[0]).toMatchObject({
      type: 'restore',
      payload: { data: null, progress: null, revision: 0 }
    })
  })
})

describe('bridge contract: 初始化不清空数据', () => {
  it('rejects change before restore and keeps the confirmed snapshot', () => {
    const persisted: BridgeHostSnapshot[] = []
    const session = createBridgeHostSession({
      sessionId: 'session-a',
      confirmedSnapshot: EXISTING_SNAPSHOT,
      persist: (snapshot) => persisted.push(snapshot)
    })

    // Web 层在 restore 之前回写空集合（典型的初始化竞态）。
    const replies = session.handleWebMessage(
      webMessage(
        'session-a',
        'change',
        { data: { ranges: [] }, revision: 8 },
        'req-early'
      )
    )

    expect(replies).toHaveLength(1)
    expect(replies[0]?.type).toBe('error')
    expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
      'RESTORE_PENDING'
    )
    // 不持久化、快照不变。
    expect(persisted).toHaveLength(0)
    expect(session.getSnapshot()).toEqual(EXISTING_SNAPSHOT)
  })

  it('still rejects a pre-restore change whose revision would be valid', () => {
    const { session, persisted } = setup({
      confirmedSnapshot: EXISTING_SNAPSHOT
    })

    const replies = session.handleWebMessage(
      webMessage(
        'session-a',
        'progress',
        { progress: { currentPageNumber: 1 }, revision: 8 },
        'req-early-progress'
      )
    )

    expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
      'RESTORE_PENDING'
    )
    expect(persisted).toHaveLength(0)
  })
})

describe('bridge contract: change / ack / revision', () => {
  it('persists a change once and acks with the applied revision', () => {
    const { session, persisted } = setup({
      confirmedSnapshot: EXISTING_SNAPSHOT
    })
    session.handleWebMessage(webMessage('session-a', 'ready', {}, 'req-ready'))

    const replies = session.handleWebMessage(
      webMessage(
        'session-a',
        'change',
        { data: { ranges: [{ id: 'range-2' }] }, revision: 8 },
        'req-change-1'
      )
    )

    expect(persisted).toHaveLength(1)
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      type: 'ack',
      payload: { requestId: 'req-change-1', revision: 8 }
    })
    expect(session.getSnapshot().data).toEqual({ ranges: [{ id: 'range-2' }] })
    expect(session.getSnapshot().revision).toBe(8)
  })

  it('rejects a change with a non-sequential revision without persisting', () => {
    const { session, persisted } = setup({
      confirmedSnapshot: EXISTING_SNAPSHOT
    })
    session.handleWebMessage(webMessage('session-a', 'ready', {}, 'req-ready'))

    const replies = session.handleWebMessage(
      webMessage(
        'session-a',
        'change',
        { data: { ranges: [] }, revision: 9 },
        'req-skip'
      )
    )

    expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
      'REVISION_MISMATCH'
    )
    expect(persisted).toHaveLength(0)
    expect(session.getSnapshot().revision).toBe(7)
  })

  it('tracks progress on the same revision counter without touching data', () => {
    const { session, persisted } = setup({
      confirmedSnapshot: EXISTING_SNAPSHOT
    })
    session.handleWebMessage(webMessage('session-a', 'ready', {}, 'req-ready'))

    const replies = session.handleWebMessage(
      webMessage(
        'session-a',
        'progress',
        { progress: { currentPageNumber: 5 }, revision: 8 },
        'req-progress-1'
      )
    )

    expect(replies[0]).toMatchObject({
      type: 'ack',
      payload: { requestId: 'req-progress-1', revision: 8 }
    })
    expect(persisted).toHaveLength(1)
    expect(session.getSnapshot()).toEqual({
      data: EXISTING_SNAPSHOT.data,
      progress: { currentPageNumber: 5 },
      revision: 8
    })
  })
})

describe('bridge contract: 重复事件幂等', () => {
  it('applies a duplicated change only once and re-acks identically', () => {
    const { session, persisted } = setup({
      confirmedSnapshot: EXISTING_SNAPSHOT
    })
    session.handleWebMessage(webMessage('session-a', 'ready', {}, 'req-ready'))
    const change = webMessage(
      'session-a',
      'change',
      { data: { ranges: [{ id: 'range-2' }] }, revision: 8 },
      'req-dup'
    )

    const first = session.handleWebMessage(change)
    const second = session.handleWebMessage(change)

    expect(persisted).toHaveLength(1)
    expect(first[0]).toMatchObject({
      type: 'ack',
      payload: { requestId: 'req-dup', revision: 8 }
    })
    // 重复投递重新应答相同 ack，不产生第二次写入。
    expect(second[0]).toMatchObject({
      type: 'ack',
      payload: { requestId: 'req-dup', revision: 8 }
    })
    expect(session.getSnapshot().revision).toBe(8)
  })
})

describe('bridge contract: 旧会话拒绝', () => {
  it('rejects messages from a disposed session', () => {
    const { session, persisted } = setup({
      confirmedSnapshot: EXISTING_SNAPSHOT
    })
    session.handleWebMessage(webMessage('session-a', 'ready', {}, 'req-ready'))
    session.dispose()

    const replies = session.handleWebMessage(
      webMessage(
        'session-a',
        'change',
        { data: { ranges: [] }, revision: 8 },
        'req-stale'
      )
    )

    expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
      'STALE_SESSION'
    )
    expect(persisted).toHaveLength(0)
    expect(session.getSnapshot()).toEqual(EXISTING_SNAPSHOT)
  })

  it('rejects messages addressed to a different session id', () => {
    // 用户从文档 A 切到 B 后，A 会话的迟到消息不得污染 B 的宿主状态。
    const { session, persisted } = setup({ sessionId: 'session-b' })
    session.handleWebMessage(webMessage('session-b', 'ready', {}, 'req-ready'))

    const replies = session.handleWebMessage(
      webMessage(
        'session-a',
        'change',
        { data: { ranges: [{ id: 'from-a' }] }, revision: 1 },
        'req-from-a'
      )
    )

    expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
      'STALE_SESSION'
    )
    expect(persisted).toHaveLength(0)
    expect(session.getSnapshot().data).toBeNull()
  })
})

describe('bridge contract: 错误恢复', () => {
  it('keeps the last confirmed snapshot on engine error and re-restores after reload', () => {
    const { session, persisted } = setup({
      confirmedSnapshot: EXISTING_SNAPSHOT
    })
    session.handleWebMessage(webMessage('session-a', 'ready', {}, 'req-ready'))

    // 引擎渲染失败：Web 层上报 error，宿主不改快照。
    const errorReplies = session.handleWebMessage(
      webMessage(
        'session-a',
        'error',
        { code: 'ENGINE_FAILURE', message: 'render crashed' },
        'req-engine-error'
      )
    )
    expect(errorReplies).toHaveLength(0)
    expect(session.getSnapshot()).toEqual(EXISTING_SNAPSHOT)

    // WebView 异常重载后重新 ready：宿主重发最后确认快照。
    const restoreReplies = session.handleWebMessage(
      webMessage('session-a', 'ready', {}, 'req-ready-2')
    )
    expect(restoreReplies[0]).toMatchObject({
      type: 'restore',
      payload: {
        data: EXISTING_SNAPSHOT.data,
        progress: EXISTING_SNAPSHOT.progress,
        revision: 7
      }
    })
    expect(persisted).toHaveLength(0)
  })

  it('does not include unacked changes in the restored snapshot', () => {
    const { session } = setup({ confirmedSnapshot: EXISTING_SNAPSHOT })
    session.handleWebMessage(webMessage('session-a', 'ready', {}, 'req-ready'))

    //  revision 不合法 → 未确认；随后重载只能恢复 revision 7 的快照。
    session.handleWebMessage(
      webMessage(
        'session-a',
        'change',
        { data: { ranges: [{ id: 'unconfirmed' }] }, revision: 99 },
        'req-unconfirmed'
      )
    )
    const restoreReplies = session.handleWebMessage(
      webMessage('session-a', 'ready', {}, 'req-ready-2')
    )

    expect(restoreReplies[0]).toMatchObject({
      type: 'restore',
      payload: { data: EXISTING_SNAPSHOT.data, revision: 7 }
    })
  })
})

describe('bridge contract: envelope validation', () => {
  it('rejects an unsupported protocol version', () => {
    const { session } = setup({ confirmedSnapshot: EXISTING_SNAPSHOT })

    const replies = session.handleWebMessage({
      version: 99,
      sessionId: 'session-a',
      requestId: 'req-version',
      type: 'ready',
      payload: {}
    })

    expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
      'UNSUPPORTED_VERSION'
    )
  })

  it('rejects malformed messages as INVALID_MESSAGE', () => {
    const { session } = setup()

    for (const raw of [
      null,
      'ready',
      { version: 1 },
      { version: 1, sessionId: 'session-a', requestId: 'r', type: 'nope' },
      { version: 1, sessionId: '', requestId: 'r', type: 'ready' }
    ]) {
      const replies = session.handleWebMessage(raw)
      expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
        'INVALID_MESSAGE'
      )
    }
  })

  it('rejects host-direction message types sent to the host', () => {
    const { session } = setup()

    const replies = session.handleWebMessage(
      webMessage('session-a', 'open', {}, 'req-open')
    )

    expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
      'INVALID_MESSAGE'
    )
  })

  it('rejects change payloads without a data field or integer revision', () => {
    const { session, persisted } = setup()
    session.handleWebMessage(webMessage('session-a', 'ready', {}, 'req-ready'))

    for (const payload of [
      { revision: 1 },
      { data: {}, revision: 1.5 },
      { data: {}, revision: 'one' }
    ]) {
      const replies = session.handleWebMessage(
        webMessage('session-a', 'change', payload)
      )
      expect((replies[0]?.payload as BridgeErrorPayload).code).toBe(
        'INVALID_MESSAGE'
      )
    }
    expect(persisted).toHaveLength(0)
  })
})
