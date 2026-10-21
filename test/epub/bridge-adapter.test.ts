// HAM-88 任务 2.2：桥接适配器（ReaderEngineAdapter EPUB 实现）契约测试。
// open/restore/dispose 语义对接 HAM-87 契约：open 失败不动既有数据、
// restore 应用快照并上报不可定位项、dispose 后不再产生事件。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import type { EngineAdapterEventSink } from '../../src/bridge/engineAdapter'
import { createEpubBridgeAdapter } from '../../src/epub/epubBridgeAdapter'
import { makeFakeView } from './fakeView'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')

const readFixture = (relativePath: string): Uint8Array =>
  readFileSync(join(FIXTURE_ROOT, relativePath))

const makeSink = (): EngineAdapterEventSink & {
  changes: unknown[]
  progresses: unknown[]
  errors: string[]
} => {
  const changes: unknown[] = []
  const progresses: unknown[] = []
  const errors: string[] = []
  return {
    changes,
    progresses,
    errors,
    emitChange: (data) => changes.push(data),
    emitProgress: (progress) => progresses.push(progress),
    emitError: (message) => errors.push(message)
  }
}

describe('epub bridge adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('opens an epub document from the controlled URL and restores a snapshot', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const sink = makeSink()
    const fake = makeFakeView()
    const adapter = createEpubBridgeAdapter({
      container,
      sink,
      fetchBytes: (fileUrl) => {
        expect(fileUrl).toBe('safe://cache/book.epub')
        return Promise.resolve(readFixture('epub/duplicate-text.epub'))
      },
      viewFactory: fake.factory
    })

    await adapter.open({
      fileId: 'file-1',
      format: 'epub',
      fileUrl: 'safe://cache/book.epub'
    })
    expect(sink.errors).toEqual([])

    const raw = readFileSync(
      join(FIXTURE_ROOT, 'highlights/epub-duplicate-text.v4.json'),
      'utf8'
    )
    const snapshot = JSON.parse(raw) as { ranges: unknown[] }
    await adapter.restore({
      data: { ranges: snapshot.ranges },
      progress: { pageNumber: 3 }
    })
    // 两条高亮都定位成功：不报不可定位错误；进度跳转到 page-3（节下标 2）。
    expect(sink.errors).toEqual([])
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 2 })

    await adapter.dispose()
    expect(fake.handle.viewClose).toHaveBeenCalled()
  })

  it('reports unlocatable snapshot ranges without dropping them silently', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const sink = makeSink()
    const fake = makeFakeView()
    const adapter = createEpubBridgeAdapter({
      container,
      sink,
      fetchBytes: () =>
        Promise.resolve(readFixture('epub/duplicate-text.epub')),
      viewFactory: fake.factory
    })
    await adapter.open({
      fileId: 'file-1',
      format: 'epub',
      fileUrl: 'safe://cache/book.epub'
    })

    await adapter.restore({
      data: {
        ranges: [
          {
            id: 'tampered',
            text: '与端点不符的文本',
            start: { selectionId: 'page-2', offset: 12 },
            end: { selectionId: 'page-2', offset: 20 }
          }
        ]
      },
      progress: null
    })
    expect(sink.errors).toHaveLength(1)
    expect(sink.errors[0]).toContain('tampered')
    await adapter.dispose()
  })

  it('rejects non-epub descriptors and reports open failures without touching data', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const sink = makeSink()
    const adapter = createEpubBridgeAdapter({ container, sink })

    await adapter.open({
      fileId: 'file-1',
      format: 'pdf',
      fileUrl: 'safe://cache/book.pdf'
    })
    expect(sink.errors[0]).toContain('pdf')

    const failingSink = makeSink()
    const failing = createEpubBridgeAdapter({
      container,
      sink: failingSink,
      fetchBytes: () => Promise.reject(new Error('cache miss')),
      viewFactory: makeFakeView().factory
    })
    await failing.open({
      fileId: 'file-2',
      format: 'epub',
      fileUrl: 'safe://cache/missing.epub'
    })
    expect(failingSink.errors[0]).toContain('cache miss')
    // open 失败后 restore/dispose 安全无操作。
    await failing.restore({ data: { ranges: [] }, progress: null })
    await failing.dispose()
    await adapter.dispose()
  })

  it('drops every event after dispose', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const sink = makeSink()
    const fake = makeFakeView()
    const adapter = createEpubBridgeAdapter({
      container,
      sink,
      fetchBytes: () =>
        Promise.resolve(readFixture('epub/duplicate-text.epub')),
      viewFactory: fake.factory
    })
    await adapter.open({
      fileId: 'file-1',
      format: 'epub',
      fileUrl: 'safe://cache/book.epub'
    })
    await adapter.dispose()

    fake.handle.emit('relocate', { index: 1, fraction: 0.5 })
    expect(sink.progresses).toEqual([])
    expect(sink.changes).toEqual([])
  })
})
