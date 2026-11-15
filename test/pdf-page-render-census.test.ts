import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  pageRenderCensus,
  recordPageCanvasRender,
  resetPageRenderCensus
} from '../src/pdf/pageRenderCensus'
import { restrictPdfRenderingQueue } from '../src/pdf/pdfRenderingQueue'

describe('PDF.js page canvas render census (HAM-278 group 1)', () => {
  beforeEach(() => {
    resetPageRenderCensus()
  })

  it('counts submitted page renders and keeps distinct page numbers', () => {
    recordPageCanvasRender(2)
    recordPageCanvasRender(1)
    recordPageCanvasRender(2)
    expect(pageRenderCensus()).toEqual({
      pageCanvasRenders: 3,
      pages: [1, 2],
      lastRenderAt: expect.any(Number)
    })
  })

  it('stays at zero until a page render is submitted', () => {
    expect(pageRenderCensus()).toEqual({
      pageCanvasRenders: 0,
      pages: [],
      lastRenderAt: null
    })
  })

  it('counts only the rendering queue submissions that actually render', () => {
    const rendered: number[] = []
    const forceRendering = vi.fn()
    const queue = {
      getHighestPriority: vi.fn(),
      forceRendering,
      pdfViewer: { forceRendering },
      renderView: vi.fn((view: { id: number }) => {
        rendered.push(view.id)
        return true
      })
    }
    restrictPdfRenderingQueue(
      queue as unknown as Parameters<typeof restrictPdfRenderingQueue>[0],
      () => [1, 2]
    )
    expect(queue.renderView({ id: 1 } as never)).toBe(true)
    expect(pageRenderCensus().pageCanvasRenders).toBe(1)
    // 不可读页面被跳过，不计数。
    expect(queue.renderView({ id: 9 } as never)).toBe(false)
    expect(pageRenderCensus().pageCanvasRenders).toBe(1)
    expect(pageRenderCensus().pages).toEqual([1])
    expect(rendered).toEqual([1])
    expect(forceRendering).toHaveBeenCalledWith(null)
  })
})

afterEach(() => {
  resetPageRenderCensus()
})
