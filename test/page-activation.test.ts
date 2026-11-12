import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activatePageIfReady,
  canTargetPdfPage,
  hasHiddenAncestor,
  isPageViewActivatable,
  waitForPageActivation
} from '../src/pdf/pageActivation'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function viewerFor(div: HTMLElement) {
  const set = vi.fn()
  const viewer = {
    _page: 1,
    get currentPageNumber() {
      return this._page
    },
    set currentPageNumber(value: number) {
      set(value)
      this._page = value
    },
    getPageView: () => ({ div })
  }
  return { viewer, set }
}

describe('PDF page activation guard', () => {
  it('detects hidden ancestors and detached nodes before touching the setter', () => {
    const root = document.createElement('div')
    const page = document.createElement('div')
    root.append(page)
    document.body.append(root)
    root.style.display = 'none'
    expect(hasHiddenAncestor(page)).toBe(true)
    expect(isPageViewActivatable({ div: page })).toBe(false)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { viewer, set } = viewerFor(page)
    expect(activatePageIfReady(viewer, 2)).toBe(false)
    expect(set).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()

    page.remove()
    expect(isPageViewActivatable({ div: page })).toBe(false)
    expect(activatePageIfReady(viewer, 2)).toBe(false)
    expect(set).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('rejects public navigation targets on hidden ancestors and detached nodes', () => {
    const root = document.createElement('div')
    const page = document.createElement('div')
    root.append(page)
    document.body.append(root)
    root.style.display = 'none'
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const scroll = vi.fn()
    const viewer = {
      currentPageNumber: 1,
      getPageView: () => ({ div: page }),
      scrollPageIntoView: scroll
    }
    expect(canTargetPdfPage(viewer, [2], 2)).toBe(false)
    expect(scroll).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    root.style.display = ''
    expect(canTargetPdfPage(viewer, [2], 2)).toBe(true)
    page.remove()
    expect(canTargetPdfPage(viewer, [2], 2)).toBe(false)
  })

  it('activates once the same page becomes visible again', () => {
    const root = document.createElement('div')
    const page = document.createElement('div')
    root.append(page)
    document.body.append(root)
    root.style.display = 'none'
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { viewer, set } = viewerFor(page)
    expect(activatePageIfReady(viewer, 2)).toBe(false)
    root.style.display = ''
    expect(activatePageIfReady(viewer, 2)).toBe(true)
    expect(set).toHaveBeenCalledWith(2)
    expect(error).not.toHaveBeenCalled()
  })

  it('waits for a page that only becomes activatable after layout settles', async () => {
    let ready = false
    const ticks: Array<() => void> = []
    const waiting = waitForPageActivation(() => ready, {
      timeoutMs: 1000,
      now: () => 0,
      schedule: (callback) => ticks.push(callback)
    })
    expect(ticks).toHaveLength(1)
    ticks.shift()!()
    ready = true
    expect(ticks).toHaveLength(1)
    ticks.shift()!()
    await expect(waiting).resolves.toBeUndefined()
  })

  it('rejects with the unavailable message when the page never activates', async () => {
    let clock = 0
    const ticks: Array<() => void> = []
    const waiting = waitForPageActivation(() => false, {
      timeoutMs: 100,
      now: () => clock,
      schedule: (callback) => ticks.push(callback)
    })
    const assertion = expect(waiting).rejects.toThrow('目标页面不可用')
    clock = 50
    ticks.shift()!()
    clock = 100
    ticks.shift()!()
    await assertion
  })

  it('aborts a pending wait immediately when its navigation is superseded', async () => {
    const controller = new AbortController()
    const ticks: Array<() => void> = []
    const waiting = waitForPageActivation(() => false, {
      timeoutMs: 10000,
      now: () => 0,
      schedule: (callback) => ticks.push(callback),
      signal: controller.signal
    })
    controller.abort(
      new DOMException('PDF navigation superseded', 'AbortError')
    )
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    // Draining any queued tick must not schedule another poll or replay.
    for (const tick of ticks.splice(0)) tick()
    expect(ticks).toHaveLength(0)
  })
})
