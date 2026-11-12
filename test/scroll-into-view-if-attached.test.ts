import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollIntoViewIfAttached } from '../src/components/scrollIntoViewIfAttached'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function node(display?: string) {
  const element = document.createElement('div')
  if (display) element.style.display = display
  const scroll = vi.fn()
  element.scrollIntoView = scroll
  return { element, scroll }
}

describe('scrollIntoViewIfAttached', () => {
  it('skips detached and display:none targets', () => {
    const detached = node()
    expect(scrollIntoViewIfAttached(detached.element)).toBe(false)
    expect(detached.scroll).not.toHaveBeenCalled()

    const hidden = node('none')
    document.body.append(hidden.element)
    expect(scrollIntoViewIfAttached(hidden.element)).toBe(false)
    expect(hidden.scroll).not.toHaveBeenCalled()

    const visible = node()
    document.body.append(visible.element)
    expect(scrollIntoViewIfAttached(visible.element, { block: 'start' })).toBe(
      true
    )
    expect(visible.scroll).toHaveBeenCalledWith({ block: 'start' })
  })

  it('never swallows a scroll failure into a page error', () => {
    const target = node()
    target.element.scrollIntoView = vi.fn(() => {
      throw new Error(
        "Failed to execute 'scrollIntoView': offsetParent is not set"
      )
    })
    document.body.append(target.element)
    expect(scrollIntoViewIfAttached(target.element)).toBe(false)
  })

  it('after a document switch only the still-mounted target is scrolled', () => {
    const previous = node()
    document.body.append(previous.element)
    previous.element.remove()
    const current = node()
    document.body.append(current.element)
    expect(scrollIntoViewIfAttached(previous.element, { block: 'start' })).toBe(
      false
    )
    expect(scrollIntoViewIfAttached(current.element, { block: 'start' })).toBe(
      true
    )
    expect(previous.scroll).not.toHaveBeenCalled()
    expect(current.scroll).toHaveBeenCalledOnce()
  })
})
