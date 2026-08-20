import { describe, expect, it } from 'vitest'

import {
  getTextPagePreloadWindow,
  getTextPageWindow,
  getTextPageWindowSize,
  resolveTextPageFromProgress,
  resolveTextPageSegmentPosition
} from '../src/components/IntermediateDocumentViewer/textPageWindow'

describe('Text Mode page windows', () => {
  it('loads four runtime pages per PDF window', () => {
    // Given: a PDF converted into ten 1-based runtime pages.
    const pageNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    // When: navigation targets a page in the second fixed window.
    const window = getTextPageWindow(
      pageNumbers,
      6,
      getTextPageWindowSize(true)
    )

    // Then: the complete four-page PDF window is returned.
    expect(window).toEqual([5, 6, 7, 8])
  })

  it('loads one runtime page per reflowable document window', () => {
    // Given: an EPUB or future MOBI represented by runtime pages.
    const pageNumbers = [1, 2, 3]

    // When: navigation targets its second logical page.
    const window = getTextPageWindow(
      pageNumbers,
      2,
      getTextPageWindowSize(false)
    )

    // Then: only that logical page is mounted.
    expect(window).toEqual([2])
  })

  it('preloads three complete segments before and after the active segment', () => {
    // Given: a PDF has ten four-page segments and segment five is active.
    const pageNumbers = Array.from({ length: 40 }, (_, index) => index + 1)

    // When: the preload range expands by three segments in both directions.
    const preloadWindow = getTextPagePreloadWindow(pageNumbers, 18, 4, 3)

    // Then: complete segments two through eight are retained for immediate navigation.
    expect(preloadWindow).toEqual(
      Array.from({ length: 28 }, (_, index) => index + 5)
    )
  })

  it('treats a non-finite overscan count as zero segments', () => {
    // Given: a public preload radius receives a non-finite number.
    const pageNumbers = [1, 2, 3, 4, 5, 6, 7, 8]

    // When: the second PDF segment is resolved with an invalid overscan count.
    const preloadWindow = getTextPagePreloadWindow(
      pageNumbers,
      6,
      4,
      Number.NaN
    )

    // Then: the current segment still loads instead of returning an empty range.
    expect(preloadWindow).toEqual([5, 6, 7, 8])
  })

  it('maps native scrolling inside the current page segment', () => {
    // Given: page 2 owns the second quarter of a four-page rail.
    const pageNumbers = [1, 2, 3, 4]

    // When: the reader is halfway through page 2.
    const position = resolveTextPageSegmentPosition(pageNumbers, 2, 0.5)

    // Then: the indicator sits halfway through that page's equal rail segment.
    expect(position).toBe(37.5)
  })

  it('maps a rail coordinate to the page segment containing it', () => {
    // Given: four equal page segments and a pointer just inside segment three.
    const pageNumbers = [2, 4, 8, 16]

    // When: the rail reports 50.1% progress.
    const pageNumber = resolveTextPageFromProgress(pageNumbers, 0.501)

    // Then: navigation targets the third real document page number.
    expect(pageNumber).toBe(8)
  })
})
