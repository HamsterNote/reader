import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activatePageIfReady,
  canTargetPdfPage,
  hasHiddenAncestor,
  isPageViewActivatable
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
})
