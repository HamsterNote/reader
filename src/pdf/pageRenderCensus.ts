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

/** 宿主 → Web：请求一次页面画布渲染计数（普通消息，不走桥协议）。 */
export const PAGE_RENDER_CENSUS_REQUEST = 'page-render-census-request'
/** Web → 宿主：回传计数结果。 */
export const PAGE_RENDER_CENSUS = 'page-render-census'

export function pageRenderCensusRequest(): string {
  return JSON.stringify({ type: PAGE_RENDER_CENSUS_REQUEST })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析 Web 侧回传的计数消息；不是该消息时返回 null，调用方继续走桥协议。
 * 字段做白名单拷贝：宿主日志只允许计数与页面号。
 */
export function parsePageRenderCensusMessage(
  raw: string
): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed['type'] !== PAGE_RENDER_CENSUS) return null
  const renders = parsed['pageCanvasRenders']
  if (typeof renders !== 'number' || !Number.isFinite(renders)) return null
  const pages = Array.isArray(parsed['pages'])
    ? parsed['pages'].filter(
        (page): page is number => typeof page === 'number' && page > 0
      )
    : []
  return {
    pageCanvasRenders: renders,
    pages,
    ...(typeof parsed['lastRenderAt'] === 'number'
      ? { lastRenderAt: parsed['lastRenderAt'] }
      : {}),
    pdfViewerMounted: parsed['pdfViewerMounted'] === true,
    pdfViewerCanvasNodes:
      typeof parsed['pdfViewerCanvasNodes'] === 'number'
        ? parsed['pdfViewerCanvasNodes']
        : 0,
    ...(typeof parsed['requestId'] === 'string'
      ? { requestId: parsed['requestId'] }
      : {})
  }
}

/** Web 侧构造回包：计数取自本页面内真实的 render 调用。 */
export function pageRenderCensusReply(requestId?: string): string {
  const census = pageRenderCensus()
  return JSON.stringify({
    type: PAGE_RENDER_CENSUS,
    ...(requestId ? { requestId } : {}),
    pageCanvasRenders: census.pageCanvasRenders,
    pages: census.pages,
    lastRenderAt: census.lastRenderAt,
    pdfViewerMounted: document.querySelector('.pdfViewer') !== null,
    pdfViewerCanvasNodes: document.querySelectorAll('.pdfViewer canvas').length
  })
}
