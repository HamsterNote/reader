/**
 * PDF.js 页面画布渲染计数（HAM-278 设备取证）。
 *
 * 原生 PDFKit 路径下，页面由 PDFKit 绘制；同一进程里仍有一个 WKWebView
 * 承担 canonical 文字与自绘 Popover（pdfjs 只做文字提取）。本计数只统计
 * pdfjs 真正提交页面画布渲染的次数，用 0 证明「页面没有走 Web 渲染」，
 * 而不是「没有采集」。__DEV__ 之外不输出，计数本身无副作用。
 */

export type PageRenderCensus = {
  /** 提交给 PDF.js 页面画布的渲染次数（= renderView 调用且允许渲染）。 */
  readonly pageCanvasRenders: number
  /** 去重后的页面号，升序；只保留最近 32 个便于日志阅读。 */
  readonly pages: readonly number[]
  readonly lastRenderAt: number | null
}

const MAX_TRACKED_PAGES = 32

let pageCanvasRenders = 0
let lastRenderAt: number | null = null
let pages = new Set<number>()

/** 由 PDF.js 渲染队列在真正提交页面渲染时调用。 */
export function recordPageCanvasRender(pageNumber: number): void {
  pageCanvasRenders += 1
  lastRenderAt = Date.now()
  pages.add(pageNumber)
  if (pages.size > MAX_TRACKED_PAGES) {
    pages = new Set([...pages].slice(-MAX_TRACKED_PAGES))
  }
}

export function pageRenderCensus(): PageRenderCensus {
  return {
    pageCanvasRenders,
    pages: [...pages].sort((left, right) => left - right),
    lastRenderAt
  }
}

export function resetPageRenderCensus(): void {
  pageCanvasRenders = 0
  lastRenderAt = null
  pages = new Set()
}
