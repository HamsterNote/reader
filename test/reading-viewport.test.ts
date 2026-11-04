import { describe, expect, it } from 'vitest'
import { readingViewport } from '../src/components/reading/readingViewport'

describe('PDF shared safe viewport', () => {
  it('merges overlapping toolbar and host insets once, with an 8px gap', () => {
    const box = new DOMRect(0, 44, 400, 800)
    const controls = new DOMRect(0, 774, 400, 50)
    const safe = readingViewport(
      box,
      { topInset: 30, bottomInset: 70 },
      controls
    )
    expect(safe).toMatchObject({ top: 74, bottom: 766, bottomInset: 78 })
    expect(
      readingViewport(box, { bottomInset: 20 }, controls)?.bottomInset
    ).toBe(78)
  })
  it('does not subtract a safe area already reserved outside the root', () => {
    expect(readingViewport(new DOMRect(0, 44, 400, 700), {})?.top).toBe(44)
    expect(readingViewport(new DOMRect(0, 0, 0, 700), {})).toBeNull()
    expect(
      readingViewport(new DOMRect(0, 0, 400, 50), { bottomInset: 70 })
    ).toBeNull()
  })
})
