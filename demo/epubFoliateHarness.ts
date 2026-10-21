// HAM-88 浏览器验证 harness（dev-only，不进入库构建/公共路由）。
// 用真实 foliate 渲染样本 EPUB，验证：章节顺序与目录跳转、封面、字体调整
// 与位置保持、v2/v3/v4 高亮恢复与新建、竞态切书、损坏文件错误。

import {
  createEpubEngine,
  type EpubEngine,
  type EpubEngineBookInfo,
  type EpubEngineRange
} from '../src/epub/foliateEpubEngine'
import type { SerializedSelection } from '../src/epub/epubCompatIndex'

import duplicateTextUrl from '../test/compat/fixtures/epub/duplicate-text.epub?url'
import coverOrderUrl from '../test/compat/fixtures/epub/cover-and-image-order.epub?url'
import spineOmitsCoverUrl from '../test/compat/fixtures/epub/spine-omits-cover.epub?url'
import v4JsonUrl from '../test/compat/fixtures/highlights/epub-duplicate-text.v4.json?url'

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ['duplicate-text', duplicateTextUrl],
  ['cover-and-image-order', coverOrderUrl],
  ['spine-omits-cover', spineOmitsCoverUrl]
]

type HarnessState = {
  engine: EpubEngine | null
  info: EpubEngineBookInfo | null
  fontScale: number
  flow: 'paginated' | 'scrolled'
  currentPage: number | null
  ranges: EpubEngineRange[]
  lastSelection: SerializedSelection | null
  /** 打开代际：只有最新一代的 ready/事件允许更新界面（宿主侧竞态契约）。 */
  epoch: number
}

const state: HarnessState = {
  engine: null,
  info: null,
  fontScale: 1,
  flow: 'scrolled',
  currentPage: null,
  ranges: [],
  lastSelection: null,
  epoch: 0
}

const $ = (id: string) => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el
}

const log = (message: string) => {
  const el = $('log')
  el.textContent += `${message}\n`
  el.scrollTop = el.scrollHeight
}

const renderToc = (info: EpubEngineBookInfo) => {
  const toc = $('toc')
  toc.textContent = ''
  if (info.toc.length === 0) {
    toc.textContent = '（无目录）'
    return
  }
  for (const entry of info.toc) {
    const button = document.createElement('button')
    button.textContent = `${entry.label} → page-${entry.pageNumber ?? '?'}`
    button.dataset.tocHref = entry.href ?? ''
    button.addEventListener('click', () => {
      if (entry.href) {
        state.engine
          ?.goToTocHref(entry.href)
          .catch((error: unknown) => log(`toc nav failed: ${String(error)}`))
      }
    })
    toc.append(button)
  }
}

const renderHighlights = () => {
  const box = $('highlights')
  box.textContent = ''
  for (const range of state.ranges) {
    const item = document.createElement('div')
    item.className = 'hl-item'
    item.dataset.highlightId = range.id
    const jump = document.createElement('button')
    jump.textContent = `跳转 ${range.id}`
    jump.addEventListener('click', () => {
      state.engine
        ?.goToRange(range.id)
        .catch((error: unknown) => log(`jump failed: ${String(error)}`))
    })
    const del = document.createElement('button')
    del.textContent = '删除'
    del.addEventListener('click', () => {
      state.engine?.removeRange(range.id)
      state.ranges = state.ranges.filter((entry) => entry.id !== range.id)
      renderHighlights()
      log(`deleted ${range.id}`)
    })
    const label = document.createElement('span')
    label.textContent = ` ${range.text.slice(0, 12)}…`
    item.append(jump, del, label)
    box.append(item)
  }
}

const fetchBytes = async (url: string): Promise<Uint8Array> =>
  new Uint8Array(await (await fetch(url)).arrayBuffer())

const openBook = async (name: string, url: string) => {
  const epoch = ++state.epoch
  const previous = state.engine
  state.engine = null
  if (previous) await previous.destroy()
  state.ranges = []
  renderHighlights()
  log(`opening ${name}… (#${epoch})`)
  const engine = createEpubEngine({
    container: $('book'),
    source: await fetchBytes(url),
    flow: state.flow,
    fontScale: state.fontScale,
    onError: (error) => {
      if (epoch === state.epoch) log(`ERROR(${error.code}): ${error.message}`)
    },
    onRelocate: (location) => {
      if (epoch !== state.epoch) return
      state.currentPage = location.pageNumber
      $('location').textContent =
        `page-${location.pageNumber ?? '?'} fraction=${location.fraction.toFixed(3)}`
    },
    onSelection: (payload) => {
      if (epoch !== state.epoch) return
      state.lastSelection = payload
      log(
        payload
          ? `selection: ${payload.start.selectionId}:${payload.start.offset}-${payload.end.offset} "${payload.text.slice(0, 16)}"`
          : 'selection: cleared'
      )
    },
    onHighlightActivate: (id) => {
      if (epoch === state.epoch) log(`highlight activated: ${id}`)
    }
  })
  if (epoch !== state.epoch) {
    // 已经不是最新一代：立即回收，不得更新界面。
    await engine.destroy()
    return
  }
  state.engine = engine
  try {
    const info = await engine.ready
    if (epoch !== state.epoch) {
      await engine.destroy()
      return
    }
    state.info = info
    log(
      `ready: "${info.title}" pages=${info.pageCount} coverPrepended=${info.coverPrepended} toc=${info.toc.length}`
    )
    renderToc(info)
    const cover = $('cover')
    if (info.cover) {
      const img = document.createElement('img')
      img.src = info.cover.url
      img.alt = info.cover.alt ?? 'cover'
      cover.replaceChildren(img)
      cover.hidden = false
    } else {
      cover.hidden = true
    }
  } catch (error) {
    if (epoch === state.epoch) {
      log(`open failed: ${error instanceof Error ? error.message : error}`)
    }
  }
}

const restoreV4 = async () => {
  if (!state.engine) return
  const json = (await (await fetch(v4JsonUrl)).json()) as {
    ranges: readonly EpubEngineRange[]
  }
  const report = state.engine.showRanges(json.ranges)
  state.ranges = [...json.ranges]
  renderHighlights()
  log(
    `restored: located=[${report.located.join(',')}] unlocatable=[${report.unlocatable
      .map((entry) => `${entry.id}:${entry.reason}`)
      .join(',')}]`
  )
}

const highlightSelection = () => {
  if (!state.engine) return
  const payload = state.engine.serializeCurrentSelection()
  if (!payload) {
    log('no serializable selection')
    return
  }
  const range: EpubEngineRange = {
    id: `local-${Date.now().toString(36)}`,
    text: payload.text,
    start: payload.start,
    end: payload.end,
    markerStyle: { backgroundColor: 'rgba(100, 200, 120, 0.9)' }
  }
  state.ranges = [...state.ranges, range]
  state.engine.showRanges(state.ranges)
  renderHighlights()
  log(
    `created ${range.id}: ${payload.start.selectionId}:${payload.start.offset}-${payload.end.offset}`
  )
}

const raceAB = async () => {
  log('race: opening A then immediately B…')
  const openingA = openBook('duplicate-text(A)', duplicateTextUrl)
  // 不等待 A：立刻切 B（模拟加载中切书）。
  await Promise.all([
    openingA,
    openBook('cover-and-image-order(B)', coverOrderUrl)
  ])
  log(`race done: current title should be B, got "${state.info?.title}"`)
}

const openCorrupt = async () => {
  if (state.engine) await state.engine.destroy()
  const engine = createEpubEngine({
    container: $('book'),
    source: new TextEncoder().encode('corrupted bytes not an epub'),
    onError: (error) => log(`ERROR(${error.code}): ${error.message}`)
  })
  state.engine = engine
  try {
    await engine.ready
  } catch {
    log('corrupt file rejected as expected')
  }
}

const setup = () => {
  const fixtures = $('fixtures')
  for (const [name, url] of FIXTURES) {
    const button = document.createElement('button')
    button.textContent = name
    button.dataset.fixture = name
    button.addEventListener('click', () => void openBook(name, url))
    fixtures.append(button)
  }
  $('font-minus').addEventListener('click', () => {
    state.fontScale = Math.max(0.5, state.fontScale - 0.25)
    $('font-scale').textContent = `${Math.round(state.fontScale * 100)}%`
    state.engine?.setFontScale(state.fontScale)
  })
  $('font-plus').addEventListener('click', () => {
    state.fontScale = Math.min(3, state.fontScale + 0.25)
    $('font-scale').textContent = `${Math.round(state.fontScale * 100)}%`
    state.engine?.setFontScale(state.fontScale)
  })
  $('flow-toggle').addEventListener('click', () => {
    state.flow = state.flow === 'scrolled' ? 'paginated' : 'scrolled'
    state.engine?.setFlow(state.flow)
    log(`flow → ${state.flow}`)
  })
  $('restore-v4').addEventListener('click', () => void restoreV4())
  $('highlight-selection').addEventListener('click', highlightSelection)
  $('race-ab').addEventListener('click', () => void raceAB())
  $('open-corrupt').addEventListener('click', () => void openCorrupt())
}

setup()

// 浏览器自动化驱动面。
declare global {
  interface Window {
    __harness: typeof state & {
      openBook: typeof openBook
      restoreV4: typeof restoreV4
      highlightSelection: typeof highlightSelection
    }
  }
}
window.__harness = Object.assign(state, {
  openBook,
  restoreV4,
  highlightSelection
})
