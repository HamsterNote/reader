// HAM-88 任务 2.5（及 2.4 端点不变量）：引擎会话生命周期测试。
// jsdom 无布局，foliate-view 以假视图注入（fakeView.ts），
// zip/兼容索引走真实实现。覆盖：A→B 切书竞态隔离、损坏文件错误、
// 关闭重开标注不丢、资源释放、字体变化不改持久化端点。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { parseHighlights } from '../../demo/highlightStorage'
import {
  createEpubEngine,
  type EpubEngineRange
} from '../../src/epub/foliateEpubEngine'
import { makeFakeView } from './fakeView'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')

const readFixture = (relativePath: string): Uint8Array =>
  readFileSync(join(FIXTURE_ROOT, relativePath))

/** 名称即契约的引擎事件记录。 */
type EngineEventSpies = {
  ready: Mock
  error: Mock
  relocate: Mock
  selection: Mock
}

const loadV4Ranges = (): readonly EpubEngineRange[] => {
  const raw = readFileSync(
    join(FIXTURE_ROOT, 'highlights/epub-duplicate-text.v4.json'),
    'utf8'
  )
  return parseHighlights(raw).ranges
}

describe('epub engine session: lifecycle and race isolation', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('opening B while A is still loading isolates A completely', async () => {
    const container = document.createElement('div')
    document.body.append(container)

    const fakeA = makeFakeView({ holdOpen: true })
    const eventsA: EngineEventSpies = {
      ready: vi.fn(),
      error: vi.fn(),
      relocate: vi.fn(),
      selection: vi.fn()
    }
    const engineA = createEpubEngine(
      {
        container,
        source: readFixture('epub/duplicate-text.epub'),
        onReady: eventsA.ready,
        onError: eventsA.error,
        onRelocate: eventsA.relocate,
        onSelection: eventsA.selection
      },
      fakeA.factory
    )
    await fakeA.handle.openStarted

    // 切书：宿主销毁 A 并以同一容器打开 B。
    await engineA.destroy()
    const fakeB = makeFakeView()
    const engineB = createEpubEngine(
      { container, source: readFixture('epub/duplicate-text.epub') },
      fakeB.factory
    )

    // A 的 open 在销毁后才返回。等待 B 完全就绪：B 的启动包含多轮真实异步
    // （zip/索引），A 的销毁后续点（一个微任务）必然在此之前跑完。
    fakeA.handle.resolveOpen()
    // A 销毁后注入的事件也必须被忽略（同步触发，无需等待）。
    fakeA.handle.emit('relocate', { index: 1, fraction: 0.5 })
    fakeA.handle.emit('load', {
      doc: document.implementation.createHTMLDocument(),
      index: 1
    })

    const info = await engineB.ready
    expect(eventsA.ready).not.toHaveBeenCalled()
    expect(eventsA.error).not.toHaveBeenCalled()
    expect(eventsA.relocate).not.toHaveBeenCalled()
    expect(eventsA.selection).not.toHaveBeenCalled()
    expect(container.contains(fakeA.handle.view)).toBe(false)

    expect(info.title).toBe('Fixture Duplicate Text')
    expect(info.pageCount).toBe(4)
    expect(container.contains(fakeB.handle.view)).toBe(true)
    expect(container.children).toHaveLength(1)
    await engineB.destroy()
  })

  it('reports corrupt input through onError and rejects ready', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onError = vi.fn()
    const onReady = vi.fn()
    const engine = createEpubEngine({
      container,
      source: new TextEncoder().encode('definitely not an epub'),
      onError,
      onReady
    })
    await expect(engine.ready).rejects.toThrow()
    // fail() 先于 ready 拒绝同步调用 onError，无需额外等待。
    expect(onReady).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0].code).toBe('open-failed')
    expect(container.children).toHaveLength(0)
    await engine.destroy()
  })

  it('keeps restored annotations across destroy and reopen', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const bytes = readFixture('epub/duplicate-text.epub')
    const ranges = loadV4Ranges()

    const fake1 = makeFakeView()
    const engine1 = createEpubEngine(
      { container, source: bytes },
      fake1.factory
    )
    await engine1.ready
    const report1 = engine1.showRanges(ranges)
    expect(report1.located).toHaveLength(2)
    expect(report1.unlocatable).toHaveLength(0)
    await engine1.destroy()

    // 重开：同样的数据再次恢复，结果一致（标注不被清空、不错位）。
    const fake2 = makeFakeView()
    const engine2 = createEpubEngine(
      { container, source: bytes },
      fake2.factory
    )
    await engine2.ready
    const report2 = engine2.showRanges(ranges)
    expect(report2.located).toEqual(report1.located)
    expect(report2.unlocatable).toEqual([])
    await engine2.destroy()
  })

  it('releases view, book and listeners on destroy; later events are dropped', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onSelection = vi.fn()
    const onRelocate = vi.fn()
    const fake = makeFakeView()
    const engine = createEpubEngine(
      {
        container,
        source: readFixture('epub/duplicate-text.epub'),
        onSelection,
        onRelocate
      },
      fake.factory
    )
    await engine.ready
    expect(container.contains(fake.handle.view)).toBe(true)

    await engine.destroy()
    expect(fake.handle.viewClose).toHaveBeenCalled()
    expect(fake.handle.bookDestroy).toHaveBeenCalled()
    expect(container.contains(fake.handle.view)).toBe(false)

    // destroy 后：渲染器事件被忽略，API 调用安全无操作。
    fake.handle.emit('relocate', { index: 1, fraction: 0.1 })
    expect(onRelocate).not.toHaveBeenCalled()
    expect(onSelection).not.toHaveBeenCalled()
    engine.setFontScale(2)
    expect(fake.handle.renderer.styles).toHaveLength(1) // 仅初始一次
    expect(engine.serializeCurrentSelection()).toBeNull()
    expect(await engine.goToPage(2)).toBe(false)
    // 幂等：重复 destroy 不报错。
    await engine.destroy()
  })

  it('navigates by legacy page number and maps TOC hrefs to page-N', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const fake = makeFakeView({
      toc: [
        { label: 'Chapter 1', href: 'chapter1.xhtml' },
        { label: 'Chapter 3', href: 'chapter3.xhtml' }
      ]
    })
    const engine = createEpubEngine(
      { container, source: readFixture('epub/duplicate-text.epub') },
      fake.factory
    )
    const info = await engine.ready

    expect(info.toc.map((entry) => [entry.label, entry.pageNumber])).toEqual([
      ['Chapter 1', 2],
      ['Chapter 3', 4]
    ])

    // 初始跳转到首个 linear 节（封面，下标 0）。
    expect(fake.handle.renderer.goToCalls[0]).toEqual({ index: 0 })
    await engine.goToPage(3)
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 2 })
    // 补封面书没有 page-5；非法页号返回 false。
    expect(await engine.goToPage(5)).toBe(false)
    await engine.destroy()
  })

  it('font scale changes only display styles, never persisted endpoints', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const ranges = loadV4Ranges()
    const before = structuredClone(ranges)

    const fake = makeFakeView()
    const engine = createEpubEngine(
      { container, source: readFixture('epub/duplicate-text.epub') },
      fake.factory
    )
    await engine.ready
    const reportBefore = engine.showRanges(ranges)

    engine.setFontScale(2)
    expect(fake.handle.renderer.styles.at(-1)).toContain('font-size: 32px')
    engine.setFontScale(0.75)
    expect(fake.handle.renderer.styles.at(-1)).toContain('font-size: 12px')

    // 持久化端点对象未被触碰；重新恢复结果一致。
    expect(ranges).toEqual(before)
    const reportAfter = engine.showRanges(ranges)
    expect(reportAfter.located).toEqual(reportBefore.located)
    expect(reportAfter.unlocatable).toEqual(reportBefore.unlocatable)
    await engine.destroy()
  })
})
