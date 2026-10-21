import { describe, expect, it } from 'vitest'

import type { BridgeHostSnapshot } from '../src/bridge/hostSession'
import type { BridgeMessage } from '../src/bridge/protocol'
import {
  createReaderHostSession,
  type ReaderHostSession
} from '../src/host/readerHostSession'
import {
  createWebBridgeClient,
  type WebBridgeClient,
  type WebBridgeTimers
} from '../webview/src/bridgeClient'

// 两类 WebView 重载的回归测试（评审 HAM-90 问题 2、3）：
// - 手动“重载 WebView”：宿主会话保留，restore 必须取最新确认快照，
//   而不是打开文档时的旧 prop 快照。
// - 页面自动重载：新 Web 客户端的 requestId 带独立随机标识，不会撞上
//   宿主幂等表；在途持久化完成后新客户端才能拿到 restore。

const sessionId = 'session-1'
const sourceToken = 'source-token'

type Timers = {
  readonly api: WebBridgeTimers
  readonly fireAll: () => void
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
    }
  }
}

async function settle(): Promise<void> {
  // 宿主持久化队列与客户端应答全部经微任务传递；重试计时器是注入的假
  // 计时器，不在这里推进。多刷几轮覆盖 then 链。
  for (let i = 0; i < 30; i += 1) await Promise.resolve()
}

type Harness = {
  readonly session: ReaderHostSession
  readonly persisted: BridgeHostSnapshot[]
  /** 每次“页面加载”创建一个客户端；重载 = 同一宿主 + 新客户端。 */
  readonly loadPage: () => WebBridgeClient
  readonly restoresOf: (client: WebBridgeClient) => {
    data: unknown
    revision: number
  }[]
  readonly postedRawsOf: (client: WebBridgeClient) => string[]
}

function createHarness(
  options: {
    readonly snapshot?: BridgeHostSnapshot | null
    readonly persist?: (snapshot: BridgeHostSnapshot) => Promise<void>
  } = {}
): Harness {
  const persisted: BridgeHostSnapshot[] = []
  const restores = new Map<
    WebBridgeClient,
    { data: unknown; revision: number }[]
  >()
  const postedRaws = new Map<WebBridgeClient, string[]>()
  let current: WebBridgeClient | null = null

  const session = createReaderHostSession({
    sessionId,
    sourceToken,
    descriptor: {
      fileId: 'f_0123456789abcdef0123456789abcdef',
      format: 'pdf',
      fileUrl: 'file:///cache/book.pdf'
    },
    confirmedSnapshot: options.snapshot ?? null,
    persist: async (snapshot) => {
      await options.persist?.(snapshot)
      persisted.push(snapshot)
    },
    sendToWeb: (message: BridgeMessage) => {
      // 只投递给当前存活的页面；重载后旧 JS 上下文已销毁。
      current?.handleMessage(JSON.stringify(message))
    }
  })

  const loadPage = (): WebBridgeClient => {
    const timers = createTimers()
    const client = createWebBridgeClient({
      sessionId,
      sourceToken,
      post: (raw) => {
        postedRaws.get(client)?.push(raw)
        session.handleRawMessage(raw).catch(() => undefined)
      },
      timers: timers.api,
      retryTimeoutMs: 1000,
      onRestore: (payload) => {
        restores
          .get(client)
          ?.push({ data: payload.data, revision: payload.revision })
      }
    })
    restores.set(client, [])
    postedRaws.set(client, [])
    current = client
    return client
  }

  return {
    session,
    persisted,
    loadPage,
    restoresOf: (client) => restores.get(client) ?? [],
    postedRawsOf: (client) => postedRaws.get(client) ?? []
  }
}

describe('WebView 重载回归', () => {
  it('手动重载后 restore 取宿主最新确认快照，后续写入不被幂等表吞掉', async () => {
    const harness = createHarness()

    // 第一次打开：rev 0 起步，保存 A 并确认到 rev 1。
    const firstPage = harness.loadPage()
    firstPage.start()
    await settle()
    expect(harness.restoresOf(firstPage)).toEqual([{ data: null, revision: 0 }])

    firstPage.sendChange({ bookmarks: ['A'] })
    await settle()
    expect(firstPage.getRevision()).toBe(1)
    expect(harness.persisted).toHaveLength(1)

    // 手动“重载 WebView”：宿主会话保留（修复前组件会销毁会话并用打开时的
    // 旧 record.snapshot 重建，restore 回退到 rev 0），页面是新客户端。
    const reloadedPage = harness.loadPage()
    reloadedPage.start()
    await settle()

    expect(harness.restoresOf(reloadedPage)).toEqual([
      { data: { bookmarks: ['A'] }, revision: 1 }
    ])

    // 新客户端继续修改：requestId 带新客户端标识，不会撞上宿主幂等表
    // （修复前新客户端重新从 1 计数，宿主把 B 当成旧请求直接丢弃）。
    reloadedPage.sendChange({ bookmarks: ['A', 'B'] })
    await settle()

    expect(reloadedPage.getRevision()).toBe(2)
    expect(harness.persisted).toHaveLength(2)
    expect(harness.persisted[1]).toMatchObject({
      data: { bookmarks: ['A', 'B'] },
      revision: 2
    })
  })

  it('页面自动重载：在途持久化完成后新客户端才收到 restore，旧重发幂等', async () => {
    // tsconfig lib 低于 es2024，Promise.withResolvers 不可用，沿用执行器形式。
    let releasePersist: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releasePersist = resolve
    })
    const harness = createHarness({ persist: () => gate })

    const firstPage = harness.loadPage()
    firstPage.start()
    await settle()
    expect(harness.restoresOf(firstPage)).toEqual([{ data: null, revision: 0 }])

    // 保存 A：持久化未落盘，ack 未返回。
    firstPage.sendChange({ bookmarks: ['A'] })
    await settle()
    expect(firstPage.getRevision()).toBe(0)
    expect(harness.persisted).toHaveLength(0)

    // 页面自动重载（如 WebView 进程恢复）：新客户端 ready 排在在途持久化之后。
    const reloadedPage = harness.loadPage()
    reloadedPage.start()
    await settle()
    expect(harness.restoresOf(reloadedPage)).toEqual([])

    // 持久化落盘：A 先确认，随后 restore 必须带上 A（不是打开时的空快照）。
    releasePersist?.()
    await settle()
    expect(harness.persisted).toHaveLength(1)
    expect(harness.restoresOf(reloadedPage)).toEqual([
      { data: { bookmarks: ['A'] }, revision: 1 }
    ])

    // 旧页面的超时重发晚到：同一 requestId 幂等重答，不重复写入。
    const staleRaw = harness.postedRawsOf(firstPage).at(-1)
    expect(staleRaw).toBeDefined()
    await harness.session.handleRawMessage(staleRaw)
    await settle()
    expect(harness.persisted).toHaveLength(1)

    // 新客户端的后续修改正常确认。
    reloadedPage.sendChange({ bookmarks: ['A', 'B'] })
    await settle()
    expect(reloadedPage.getRevision()).toBe(2)
    expect(harness.persisted).toHaveLength(2)
    expect(harness.persisted[1]).toMatchObject({
      data: { bookmarks: ['A', 'B'] },
      revision: 2
    })
  })

  it('同一宿主下的两个客户端生成互不相同的 requestId', async () => {
    const harness = createHarness()
    const firstPage = harness.loadPage()
    firstPage.start()
    await settle()
    const reloadedPage = harness.loadPage()
    reloadedPage.start()
    await settle()

    const requestIdOf = (raw: string): string => {
      const parsed: unknown = JSON.parse(raw)
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'requestId' in parsed &&
        typeof parsed.requestId === 'string'
      ) {
        return parsed.requestId
      }
      throw new Error('客户端消息缺少 requestId')
    }
    const firstIds = harness.postedRawsOf(firstPage).map(requestIdOf)
    const reloadedIds = harness.postedRawsOf(reloadedPage).map(requestIdOf)
    expect(firstIds.length).toBeGreaterThan(0)
    for (const id of reloadedIds) {
      expect(firstIds).not.toContain(id)
    }
  })
})
