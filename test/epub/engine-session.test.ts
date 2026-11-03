// HAM-88 任务 2.5（及 2.4 端点不变量）：引擎会话生命周期测试。
// jsdom 无布局，foliate-view 以假视图注入（fakeView.ts），
// zip/兼容索引走真实实现。覆盖：A→B 切书竞态隔离、损坏文件错误、
// 关闭重开标注不丢、资源释放、字体变化不改持久化端点。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'

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
  it.each([
    { range: { start: 3, end: 3 }, expectedIndex: 3, visible: true },
    { range: { start: 9, end: 10 }, expectedIndex: 1, visible: false },
    { range: undefined, expectedIndex: 1, visible: true }
  ])(
    'keeps the latest range $range after an older section load completes',
    async ({ range, expectedIndex, visible }) => {
      const fake = makeFakeView({
        sectionHrefs: [
          'OPS/cover.xhtml',
          'OPS/chapter1.xhtml',
          'OPS/nav.xhtml',
          'OPS/chapter2.xhtml',
          'OPS/chapter3.xhtml'
        ]
      })
      const onRelocate = vi.fn()
      const engine = createEpubEngine(
        {
          container: document.createElement('div'),
          source: readFixture('epub/duplicate-text.epub'),
          onRelocate
        },
        fake.factory
      )
      await engine.ready
      let currentIndex = 2
      let release!: () => void
      const pendingLoad = new Promise<void>((resolve) => {
        release = resolve
      })
      vi.spyOn(fake.handle.renderer, 'getContents').mockImplementation(() => [
        { index: currentIndex }
      ])
      const goTo = vi
        .spyOn(fake.handle.renderer, 'goTo')
        .mockImplementation(async (target) => {
          const { index } = target as { index: number }
          if (index === 1) await pendingLoad
          currentIndex = index
          fake.handle.emit('relocate', { index, fraction: 0 })
        })
      const older = engine.setHiddenPages([], false, { start: 2, end: 2 })
      expect(goTo).toHaveBeenCalledWith({ index: 1 })
      const latest = engine.setHiddenPages([], false, range)
      await Promise.resolve()
      release()
      await Promise.all([older, latest])
      expect(currentIndex).toBe(expectedIndex)
      expect(fake.handle.view.style.visibility).toBe(visible ? '' : 'hidden')
      if (visible) {
        expect(engine.captureTextAnchor()?.pageNumber).toBe(
          expectedIndex === 3 ? 3 : 2
        )
        expect(onRelocate.mock.calls.at(-1)?.[0].pageNumber).toBe(
          expectedIndex === 3 ? 3 : 2
        )
      } else {
        expect(engine.captureTextAnchor()).toBeUndefined()
        expect(onRelocate.mock.calls.at(-1)?.[0].pageNumber).toBeNull()
      }
      await engine.destroy()
    }
  )

  it('skips superseded queued ranges and recovers after an older navigation rejects', async () => {
    const fake = makeFakeView()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub')
      },
      fake.factory
    )
    await engine.ready
    let currentIndex = 0
    let reject!: (error: Error) => void
    const pendingLoad = new Promise<void>((_resolve, rejectLoad) => {
      reject = rejectLoad
    })
    vi.spyOn(fake.handle.renderer, 'getContents').mockImplementation(() => [
      { index: currentIndex }
    ])
    const goTo = vi.spyOn(fake.handle.renderer, 'goTo')
    goTo.mockImplementationOnce(() => pendingLoad)
    goTo.mockImplementation(async (target) => {
      currentIndex = (target as { index: number }).index
      fake.handle.emit('relocate', { index: currentIndex, fraction: 0 })
    })
    const older = engine.setHiddenPages([], false, { start: 2, end: 2 })
    const rejected = expect(older).rejects.toThrow('load failed')
    const skipped = engine.setHiddenPages([], false, { start: 4, end: 4 })
    const latest = engine.setHiddenPages([], false, { start: 3, end: 3 })
    expect(fake.handle.view.style.visibility).toBe('hidden')
    reject(new Error('load failed'))
    await Promise.all([rejected, skipped, latest])
    expect(goTo.mock.calls).toEqual([[{ index: 1 }], [{ index: 2 }]])
    expect(currentIndex).toBe(2)
    expect(engine.captureTextAnchor()?.pageNumber).toBe(3)
    expect(fake.handle.view.style.visibility).toBe('')
    await engine.destroy()
  })

  it('does not start queued range navigation after the engine is destroyed', async () => {
    const fake = makeFakeView()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub')
      },
      fake.factory
    )
    await engine.ready
    vi.spyOn(fake.handle.renderer, 'getContents').mockReturnValue([
      { index: 0 }
    ])
    let release!: () => void
    const pendingLoad = new Promise<void>((resolve) => {
      release = resolve
    })
    const goTo = vi
      .spyOn(fake.handle.renderer, 'goTo')
      .mockReturnValue(pendingLoad)
    const older = engine.setHiddenPages([], false, { start: 2, end: 2 })
    const latest = engine.setHiddenPages([], false, { start: 3, end: 3 })
    await engine.destroy()
    release()
    await Promise.all([older, latest])
    expect(goTo).toHaveBeenCalledTimes(1)
    expect(fake.handle.view.style.visibility).toBe('hidden')
  })

  it.each([2, 4])(
    'reconciles actual section %i instead of a stale in-range page when restoring a range',
    async (index) => {
      const fake = makeFakeView({
        sectionHrefs: [
          'OPS/cover.xhtml',
          'OPS/chapter1.xhtml',
          'OPS/nav.xhtml',
          'OPS/chapter2.xhtml',
          'OPS/chapter3.xhtml'
        ]
      })
      const engine = createEpubEngine(
        {
          container: document.createElement('div'),
          source: readFixture('epub/duplicate-text.epub')
        },
        fake.factory
      )
      await engine.ready
      fake.handle.emit('relocate', { index: 1, fraction: 0 })
      vi.spyOn(fake.handle.renderer, 'getContents').mockReturnValue([{ index }])
      const calls = fake.handle.renderer.goToCalls.length
      await engine.setHiddenPages([], false, { start: 2, end: 2 })
      expect(fake.handle.renderer.goToCalls).toHaveLength(calls + 1)
      expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 1 })
      await engine.destroy()
    }
  )

  it('clears stale location when no readable page remains and recovers when the range is restored', async () => {
    const fake = makeFakeView()
    const onRelocate = vi.fn()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub'),
        onRelocate
      },
      fake.factory
    )
    await engine.ready
    fake.handle.emit('relocate', { index: 1, fraction: 0 })
    vi.spyOn(fake.handle.renderer, 'getContents').mockReturnValue([
      { index: 1 }
    ])
    expect(engine.captureTextAnchor()?.pageNumber).toBe(2)
    const calls = fake.handle.renderer.goToCalls.length
    await engine.setHiddenPages([2], false, { start: 2, end: 2 })
    expect(fake.handle.renderer.goToCalls).toHaveLength(calls)
    expect(engine.captureTextAnchor()).toBeUndefined()
    expect(fake.handle.view.style.visibility).toBe('hidden')
    expect(onRelocate).toHaveBeenLastCalledWith({
      chapterIndex: -1,
      pageNumber: null,
      fraction: 0
    })
    fake.handle.emit('relocate', { index: 1, fraction: 0.5 })
    expect(engine.captureTextAnchor()).toBeUndefined()
    expect(onRelocate.mock.calls.at(-1)?.[0].pageNumber).toBeNull()
    await engine.setHiddenPages([], false, { start: 3, end: 3 })
    expect(fake.handle.view.style.visibility).toBe('')
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 2 })
    await engine.destroy()
  })

  it('excludes unmapped spine navigation documents from sequential reading and restricts explicit links while a range is active', async () => {
    const fake = makeFakeView({
      sectionHrefs: [
        'OPS/cover.xhtml',
        'OPS/chapter1.xhtml',
        'OPS/nav.xhtml',
        'OPS/chapter2.xhtml',
        'OPS/chapter3.xhtml'
      ]
    })
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub')
      },
      fake.factory
    )
    await engine.ready
    await engine.setHiddenPages([], false, { start: 2, end: 3 })
    expect(
      fake.handle.view.book?.sections.map((section) => section.linear)
    ).toEqual(['no', 'yes', 'no', 'yes', 'no'])
    const calls = fake.handle.renderer.goToCalls.length
    expect(await engine.goToTocHref('nav.xhtml')).toBe(false)
    const link = new CustomEvent('link', {
      cancelable: true,
      detail: { href: 'nav.xhtml' }
    })
    fake.handle.view.dispatchEvent(link)
    await Promise.resolve()
    expect(link.defaultPrevented).toBe(true)
    expect(fake.handle.renderer.goToCalls).toHaveLength(calls)
    await engine.setHiddenPages([], true, { start: 2, end: 3 })
    expect(fake.handle.view.book?.sections[2].linear).toBe('no')
    await engine.setHiddenPages([])
    expect(fake.handle.view.book?.sections[2].linear).toBe('no')
    expect(await engine.goToTocHref('nav.xhtml')).toBe(true)
    await engine.destroy()
  })

  it('limits chapters to original page numbers even while crop editing', async () => {
    const fake = makeFakeView()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub')
      },
      fake.factory
    )
    await engine.ready
    await engine.setHiddenPages([], false, { start: 2, end: 2 })
    expect(
      fake.handle.view.book?.sections.map((section) => section.linear)
    ).toEqual(['no', 'yes', 'no', 'no'])
    await engine.goToPage(1)
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 1 })
    await engine.goToPage(4)
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 1 })
    const link = new CustomEvent('link', {
      cancelable: true,
      detail: { href: 'chapter3.xhtml' }
    })
    fake.handle.view.dispatchEvent(link)
    await Promise.resolve()
    expect(link.defaultPrevented).toBe(true)
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 1 })
    await engine.setHiddenPages([2], true, { start: 2, end: 2 })
    expect(
      fake.handle.view.book?.sections.map((section) => section.linear)
    ).toEqual(['no', 'yes', 'no', 'no'])
    await engine.setHiddenPages([], false, { start: 3, end: 2 })
    expect(await engine.goToPage(2)).toBe(false)
    await engine.setHiddenPages([])
    expect(
      fake.handle.view.book?.sections.every(
        (section) => section.linear === 'yes'
      )
    ).toBe(true)
    await engine.destroy()
  })
  it('skips a hidden prepended cover even though it has no text anchor', async () => {
    const fake = makeFakeView({
      sectionHrefs: ['OPS/chapter1.xhtml', 'OPS/chapter2.xhtml']
    })
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/spine-omits-cover.epub')
      },
      fake.factory
    )
    await engine.ready
    expect(await engine.goToPage(1)).toBe(true)
    expect(engine.captureTextAnchor()).toBeUndefined()
    const calls = fake.handle.renderer.goToCalls.length
    engine.setHiddenPages([1])
    expect(fake.handle.renderer.goToCalls.length).toBe(calls + 1)
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 0 })
    await engine.destroy()
  })

  it('skips hidden chapters in natural navigation and restores them for crop editing', async () => {
    const fake = makeFakeView()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub')
      },
      fake.factory
    )
    await engine.ready
    engine.setHiddenPages(['page-3'])
    expect(fake.handle.view.book?.sections[2].linear).toBe('no')
    await engine.goToPage(3)
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 3 })
    engine.setHiddenPages([3], true)
    expect(fake.handle.view.book?.sections[2].linear).toBe('yes')
    await engine.goToPage(3)
    expect(fake.handle.renderer.goToCalls.at(-1)).toEqual({ index: 2 })
    engine.setHiddenPages([])
    expect(fake.handle.view.book?.sections[2].linear).toBe('yes')
    await engine.destroy()
  })

  it('unhooks recycled chapter documents before binding the next chapter', async () => {
    const fake = makeFakeView()
    const onSelection = vi.fn()
    const onDocumentUnload = vi.fn()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub'),
        onSelection,
        onDocumentUnload
      },
      fake.factory
    )
    await engine.ready
    const first = document.implementation.createHTMLDocument()
    const second = document.implementation.createHTMLDocument()
    fake.handle.emit('load', { doc: first, index: 1 })
    first.dispatchEvent(new Event('selectionchange'))
    expect(onSelection).toHaveBeenCalledTimes(1)
    fake.handle.emit('load', { doc: second, index: 2 })
    expect(onDocumentUnload).toHaveBeenCalledWith(first)
    first.dispatchEvent(new Event('selectionchange'))
    expect(onSelection).toHaveBeenCalledTimes(1)
    second.dispatchEvent(new Event('selectionchange'))
    expect(onSelection).toHaveBeenCalledTimes(2)
    await engine.destroy()
    expect(onDocumentUnload).toHaveBeenCalledWith(second)
  })

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

describe('EPUB visual page navigation', () => {
  it('uses single-column pagination and serializes turns, recovering from failure', async () => {
    const fake = makeFakeView()
    const error = vi.fn()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub'),
        onError: error
      },
      fake.factory
    )
    expect(engine.navigationState().busy).toBe(true)
    await engine.ready
    expect(fake.handle.renderer.attrs).toMatchObject({
      flow: 'paginated',
      'max-column-count': '1',
      'manual-navigation': ''
    })
    fake.handle.emit('relocate', { index: 1, fraction: 0.25, size: 0.25 })
    let release!: () => void
    fake.handle.renderer.next.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const turn = engine.nextPage()
    expect(engine.navigationState().busy).toBe(true)
    expect(await engine.nextPage()).toBe(false)
    expect(fake.handle.renderer.next).toHaveBeenCalledTimes(1)
    release()
    expect(await turn).toBe(true)
    fake.handle.renderer.prev.mockRejectedValueOnce(new Error('page failed'))
    expect(await engine.previousPage()).toBe(false)
    expect(error).toHaveBeenCalledWith({
      code: 'render-failed',
      message: 'Error: page failed'
    })
    expect(engine.navigationState().busy).toBe(false)
    expect(await engine.previousPage()).toBe(true)
    await engine.destroy()
  })

  it('clamps book boundaries and recomputes them after hidden-page restrictions', async () => {
    const fake = makeFakeView()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub')
      },
      fake.factory
    )
    await engine.ready
    fake.handle.emit('relocate', { index: 0, fraction: 0, size: 1 })
    expect(engine.navigationState().canPrevious).toBe(false)
    expect(await engine.previousPage()).toBe(false)
    fake.handle.emit('relocate', { index: 3, fraction: 0.75, size: 0.25 })
    expect(engine.navigationState().canNext).toBe(false)
    expect(await engine.nextPage()).toBe(false)
    await engine.setHiddenPages([1, 4], false, { start: 2, end: 3 })
    expect(
      fake.handle.view.book?.sections.map((section) => section.linear)
    ).toEqual(['no', 'yes', 'yes', 'no'])
    fake.handle.emit('relocate', { index: 1, fraction: 0, size: 0.5 })
    expect(engine.navigationState()).toEqual({
      canPrevious: false,
      canNext: true,
      busy: false
    })
    fake.handle.emit('relocate', { index: 2, fraction: 0.5, size: 0.5 })
    expect(engine.navigationState().canNext).toBe(false)
    await engine.destroy()
  })

  it('blocks wheel, touch pan and scroll keys in a live document and cleans up on destroy', async () => {
    const fake = makeFakeView()
    const engine = createEpubEngine(
      {
        container: document.createElement('div'),
        source: readFixture('epub/duplicate-text.epub')
      },
      fake.factory
    )
    await engine.ready
    const doc = new DOMParser().parseFromString(
      '<html><body><p>Cover</p></body></html>',
      'text/html'
    )
    fake.handle.emit('load', { index: 0, doc })
    for (const type of ['wheel', 'touchmove', 'keydown']) {
      const event =
        type === 'keydown'
          ? new KeyboardEvent(type, { key: 'PageDown', cancelable: true })
          : new Event(type, { cancelable: true })
      doc.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(fake.handle.renderer.next).not.toHaveBeenCalled()
    await engine.destroy()
    const event = new Event('wheel', { cancelable: true })
    doc.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

it('visits a prepended cover exactly once and returns to the first readable chapter', async () => {
  const fake = makeFakeView({
    sectionHrefs: ['OPS/chapter1.xhtml', 'OPS/chapter2.xhtml']
  })
  const onRelocate = vi.fn()
  const engine = createEpubEngine(
    {
      container: document.createElement('div'),
      source: readFixture('epub/spine-omits-cover.epub'),
      onRelocate
    },
    fake.factory
  )
  await engine.ready
  vi.spyOn(fake.handle.renderer, 'goTo').mockImplementation(async (target) => {
    fake.handle.emit('relocate', {
      index: (target as { index: number }).index,
      fraction: 0,
      size: 0.5
    })
  })
  await engine.goToPage(1)
  expect(engine.navigationState()).toEqual({
    canPrevious: false,
    canNext: true,
    busy: false
  })
  expect(engine.captureTextAnchor()).toBeUndefined()
  // A late renderer relocate under the synthetic cover must not dismiss it.
  fake.handle.emit('relocate', { index: 0, fraction: 0, size: 0.5 })
  expect(onRelocate.mock.calls.at(-1)?.[0].pageNumber).toBe(1)
  expect(await engine.nextPage()).toBe(true)
  expect(onRelocate.mock.calls.at(-1)?.[0].pageNumber).toBe(2)
  expect(await engine.previousPage()).toBe(true)
  expect(onRelocate.mock.calls.at(-1)?.[0].pageNumber).toBe(1)
  expect(await engine.previousPage()).toBe(false)
  expect(fake.handle.renderer.prev).not.toHaveBeenCalled()
  await engine.destroy()
})

it('never sequentially visits navigation-only spine entries without a compatibility page', async () => {
  const fake = makeFakeView({
    sectionHrefs: [
      'OPS/cover.xhtml',
      'OPS/chapter1.xhtml',
      'OPS/nav.xhtml',
      'OPS/chapter2.xhtml',
      'OPS/chapter3.xhtml'
    ]
  })
  const engine = createEpubEngine(
    {
      container: document.createElement('div'),
      source: readFixture('epub/duplicate-text.epub')
    },
    fake.factory
  )
  await engine.ready
  expect(fake.handle.view.book?.sections[2].linear).toBe('no')
  await engine.setHiddenPages([])
  expect(fake.handle.view.book?.sections[2].linear).toBe('no')
  await engine.destroy()
})

it('discards transient relocations from a failed turn instead of publishing false progress', async () => {
  const fake = makeFakeView()
  const onRelocate = vi.fn()
  const engine = createEpubEngine(
    {
      container: document.createElement('div'),
      source: readFixture('epub/duplicate-text.epub'),
      onRelocate
    },
    fake.factory
  )
  await engine.ready
  fake.handle.emit('relocate', { index: 1, fraction: 0.25, size: 0.25 })
  const anchor = engine.captureTextAnchor()
  onRelocate.mockClear()
  fake.handle.renderer.next.mockImplementationOnce(async () => {
    fake.handle.emit('relocate', { index: 1, fraction: 1, size: 0.25 })
    throw new Error('next chapter unavailable')
  })
  expect(await engine.nextPage()).toBe(false)
  expect(engine.captureTextAnchor()).toEqual(anchor)
  expect(onRelocate).not.toHaveBeenCalled()
  expect(engine.navigationState().busy).toBe(false)
  await engine.destroy()
})

it('keeps the requested restored character through reflow when it is inside a visual page', async () => {
  const bytes = readFixture('epub/duplicate-text.epub')
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('OPS/chapter1.xhtml')!.async('string')
  const doc = new DOMParser().parseFromString(xml, 'text/html')
  const fake = makeFakeView()
  const onRelocate = vi.fn()
  const engine = createEpubEngine(
    { container: document.createElement('div'), source: bytes, onRelocate },
    fake.factory
  )
  await engine.ready
  fake.handle.emit('load', { index: 1, doc })
  vi.spyOn(fake.handle.renderer, 'getContents').mockReturnValue([
    { index: 1, doc }
  ])
  const range = doc.createRange()
  const node = doc.querySelector('h1')!.firstChild!
  range.setStart(node, 0)
  range.setEnd(node, 1)
  const relocate = () =>
    fake.handle.emit('relocate', { index: 1, fraction: 0, size: 0.5, range })
  vi.spyOn(fake.handle.renderer, 'goTo').mockImplementation(async () => {
    relocate()
  })
  vi.spyOn(fake.handle.renderer, 'scrollToAnchor').mockImplementation(
    async () => {
      relocate()
    }
  )
  await engine.goToAnchor({
    pageNumber: 2,
    textId: 'page-2-text',
    text: '正文',
    offset: 10
  })
  expect(engine.captureTextAnchor()?.offset).toBe(10)
  onRelocate.mockClear()
  fake.handle.emit('before-reflow', {})
  expect(engine.navigationState().busy).toBe(true)
  await vi.waitFor(() => expect(engine.navigationState().busy).toBe(false))
  expect(engine.captureTextAnchor()?.offset).toBe(10)
  expect(onRelocate).not.toHaveBeenCalled()
  await engine.destroy()
})
