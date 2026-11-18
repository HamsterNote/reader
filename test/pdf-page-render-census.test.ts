import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  pageRenderCensus,
  pageRenderCensusReply,
  pageRenderCensusRequest,
  parsePageRenderCensusMessage,
  recordPageCanvasRender,
  resetPageRenderCensus
} from '../src/pdf/pageRenderCensus'
import {
  instrumentPdfRenderCensus,
  restrictPdfRenderingQueue
} from '../src/pdf/pdfRenderingQueue'

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

  it('counts the rendering queue only when renderView actually renders', () => {
    const queue = {
      renderView: vi.fn((view: { id: number }) => view.id !== 9)
    }
    instrumentPdfRenderCensus(
      queue as unknown as Parameters<typeof instrumentPdfRenderCensus>[0]
    )
    expect(queue.renderView({ id: 1 } as never)).toBe(true)
    expect(pageRenderCensus().pageCanvasRenders).toBe(1)
    expect(queue.renderView({ id: 9 } as never)).toBe(false)
    expect(pageRenderCensus().pageCanvasRenders).toBe(1)
    expect(pageRenderCensus().pages).toEqual([1])
  })

  it('still skips unreadable pages under the crop filter', () => {
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
    instrumentPdfRenderCensus(
      queue as unknown as Parameters<typeof instrumentPdfRenderCensus>[0]
    )
    expect(queue.renderView({ id: 1 } as never)).toBe(true)
    expect(pageRenderCensus().pageCanvasRenders).toBe(1)
    expect(queue.renderView({ id: 9 } as never)).toBe(false)
    expect(pageRenderCensus().pageCanvasRenders).toBe(1)
    expect(pageRenderCensus().pages).toEqual([1])
    expect(rendered).toEqual([1])
    expect(forceRendering).toHaveBeenCalledWith(null)
  })

  it('round-trips the request/reply envelope without touching the bridge protocol', () => {
    expect(JSON.parse(pageRenderCensusRequest())).toEqual({
      type: 'page-render-census-request'
    })
    recordPageCanvasRender(3)
    const reply = JSON.parse(pageRenderCensusReply('req-1')) as Record<
      string,
      unknown
    >
    expect(reply).toMatchObject({
      type: 'page-render-census',
      requestId: 'req-1',
      pageCanvasRenders: 1,
      pages: [3]
    })
    expect(parsePageRenderCensusMessage(JSON.stringify(reply))).toMatchObject({
      requestId: 'req-1',
      pageCanvasRenders: 1,
      pages: [3]
    })
    // 普通桥消息与坏 JSON 都不能被当成 census 回包。
    expect(
      parsePageRenderCensusMessage(JSON.stringify({ type: 'ready' }))
    ).toBeNull()
    expect(parsePageRenderCensusMessage('{not json')).toBeNull()
    expect(
      parsePageRenderCensusMessage(
        JSON.stringify({ type: 'page-render-census' })
      )
    ).toBeNull()
  })
})

afterEach(() => {
  resetPageRenderCensus()
})
