// HAM-89 / tasks.md 3.2：旧 PDF 文本 offset ↔ pdfjs text layer 映射。
// 坐标系契约见 openspec/.../contracts/sample-manifest.md：
// 公开页 ID 为 `page-N`（N 为原 PDF 页号），端点 offset 为页内全部文本项
// 无分隔符拼接后的字符偏移。pdfjs-dist 5.4.530 的 getTextContent 已在核心层
// 完成连字等 Unicode 规范化（如 U+FB01 → "fi"），与旧 @hamster-note/pdf-parser
// 输出逐字一致；本模块仍按 item 做 NFKC 防御并在映射表中处理长度变化。

import type { TextItem } from './pdfjsRuntime'

/** 文本层 span 上注入的数据属性（与既有选区链路的三件套一致）。 */
export const TEXT_LAYER_TEXT_ID_ATTR = 'data-text-id'
export const TEXT_LAYER_PAGE_NUMBER_ATTR = 'data-page-number'
export const TEXT_LAYER_START_OFFSET_ATTR = 'data-selection-start-offset'

export type CanonicalTextSpan = {
  readonly itemIndex: number
  /** pdf.js 原始 item 文本（text layer DOM 中显示的内容）。 */
  readonly domText: string
  /** NFKC 规范化后的文本，参与页内拼接。 */
  readonly canonicalText: string
  readonly canonicalStart: number
  readonly canonicalEnd: number
  /**
   * canonical 偏移 → dom 偏移的端点映射表，长度 canonicalText.length + 1。
   * 恒等映射时等于 [0,1,2,...]；发生 NFKC 长度变化时簇内中间边界映射到
   * 簇末尾（保守取端点，保证 slice 出的文本不丢字符）。
   */
  readonly canonicalToDom: readonly number[]
}

export type CanonicalPageText = {
  readonly pageNumber: number
  /** 页内全部 canonical 文本的无分隔符拼接（公开 offset 坐标系）。 */
  readonly text: string
  readonly spans: readonly CanonicalTextSpan[]
}

type TextItemLike = Pick<TextItem, 'str'>

const buildSpanMap = (
  domText: string,
  canonicalText: string
): readonly number[] => {
  if (domText === canonicalText) {
    return Array.from({ length: canonicalText.length + 1 }, (_, i) => i)
  }

  // 按 code point 对齐：逐簇 NFKC，簇首边界已由上一簇末尾（或初始 0）
  // 覆盖，簇内其余边界一律映射到簇末（保守端点，slice 不丢字符）。
  const map: number[] = [0]
  let canonicalIndex = 0
  let domIndex = 0
  for (const char of domText) {
    const cluster = char.normalize('NFKC')
    domIndex += char.length
    for (let i = 0; i < cluster.length; i++) {
      canonicalIndex += 1
      map.push(domIndex)
    }
  }
  // 防御：长度不符时退回恒等截断，保证映射表长度契约不被破坏。
  if (canonicalIndex !== canonicalText.length) {
    return Array.from({ length: canonicalText.length + 1 }, (_, i) =>
      Math.min(i, domText.length)
    )
  }
  return map
}

export function buildCanonicalPageText(
  pageNumber: number,
  items: readonly TextItemLike[]
): CanonicalPageText {
  const spans: CanonicalTextSpan[] = []
  let offset = 0
  let itemIndex = 0

  for (const item of items) {
    const domText = item.str
    const canonicalText = domText.normalize('NFKC')
    spans.push({
      itemIndex,
      domText,
      canonicalText,
      canonicalStart: offset,
      canonicalEnd: offset + canonicalText.length,
      canonicalToDom: buildSpanMap(domText, canonicalText)
    })
    offset += canonicalText.length
    itemIndex += 1
  }

  return { pageNumber, text: spans.map((s) => s.canonicalText).join(''), spans }
}

export const canonicalTextId = (
  pageNumber: number,
  itemIndex: number
): string => `page-${pageNumber}-item-${itemIndex}`

/**
 * 把 canonical 端点表注入官方 text layer 的 DOM：逐元素与 canonical span
 * 顺序匹配（NFKC 后的 textContent 逐字相等），命中元素写入
 * data-text-id / data-page-number / data-selection-start-offset。
 * 返回 false 表示存在无法匹配的 span（调用方保持原样，不得静默近似）。
 */
export function enhanceTextLayer(
  textLayerDiv: HTMLElement,
  page: CanonicalPageText
): boolean {
  // 防御：属性只落在叶级 span 上；容器自身若被瞬态 DOM 污染则清理。
  for (const attr of [
    TEXT_LAYER_TEXT_ID_ATTR,
    TEXT_LAYER_PAGE_NUMBER_ATTR,
    TEXT_LAYER_START_OFFSET_ATTR
  ]) {
    textLayerDiv.removeAttribute(attr)
  }

  const elements = Array.from(textLayerDiv.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child.textContent !== '' &&
      // 已含增强后代的容器元素不参与匹配（pdf.js 重组瞬态）。
      !child.querySelector(`[${TEXT_LAYER_TEXT_ID_ATTR}]`)
  )

  let matched = true
  let spanPointer = 0
  for (const element of elements) {
    const elementText = (element.textContent ?? '').normalize('NFKC')
    let found: CanonicalTextSpan | null = null
    for (let i = spanPointer; i < page.spans.length; i++) {
      if (page.spans[i].canonicalText === '') continue
      if (page.spans[i].canonicalText === elementText) {
        found = page.spans[i]
        spanPointer = i + 1
        break
      }
    }
    if (!found) {
      matched = false
      continue
    }
    element.setAttribute(
      TEXT_LAYER_TEXT_ID_ATTR,
      canonicalTextId(page.pageNumber, found.itemIndex)
    )
    element.setAttribute(TEXT_LAYER_PAGE_NUMBER_ATTR, String(page.pageNumber))
    element.setAttribute(
      TEXT_LAYER_START_OFFSET_ATTR,
      String(found.canonicalStart)
    )
  }
  return matched
}

type EnhancedSpanContext = {
  readonly element: HTMLElement
  readonly span: CanonicalTextSpan
}

const findEnhancedSpan = (
  node: Node | null,
  page: CanonicalPageText
): EnhancedSpanContext | null => {
  const element = node instanceof Element ? node : node?.parentElement
  const host = element?.closest(`[${TEXT_LAYER_START_OFFSET_ATTR}]`)
  if (!(host instanceof HTMLElement)) return null

  const itemId = host.getAttribute(TEXT_LAYER_TEXT_ID_ATTR)
  const span =
    page.spans.find(
      (candidate) =>
        canonicalTextId(page.pageNumber, candidate.itemIndex) === itemId
    ) ?? null
  return span ? { element: host, span } : null
}

/** 元素内 text node 的字符偏移（与 selectionPayloadSerializer 同规则）。 */
const getTextOffsetWithin = (
  element: HTMLElement,
  container: Node,
  offset: number
): number => {
  if (container === element) {
    return Array.from(element.childNodes)
      .slice(0, offset)
      .reduce((total, node) => total + (node.textContent?.length ?? 0), 0)
  }

  let textOffset = 0
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT
  )
  let currentNode = walker.nextNode()
  while (currentNode) {
    if (currentNode === container) return textOffset + offset
    textOffset += currentNode.textContent?.length ?? 0
    currentNode = walker.nextNode()
  }
  return textOffset
}

/**
 * DOM 位置 → canonical 页内偏移。node/offset 语义同 Range.startContainer。
 * 无法定位（元素未增强或越界）返回 null。
 */
export function domPositionToCanonicalOffset(
  node: Node,
  offset: number,
  page: CanonicalPageText
): number | null {
  const context = findEnhancedSpan(node, page)
  if (!context) return null

  const domOffset = getTextOffsetWithin(context.element, node, offset)
  const { span } = context

  // dom → canonical 逆映射：取满足 canonicalToDom[o] <= domOffset 的最大 o，
  // 即“覆盖该 dom 位置的簇的结束边界”，保证连字簇整体归入已选范围。
  let result = span.canonicalStart
  for (let o = 0; o < span.canonicalToDom.length; o++) {
    if (span.canonicalToDom[o] <= domOffset) {
      result = span.canonicalStart + o
    } else {
      break
    }
  }
  return result
}

/**
 * canonical 页内偏移 → DOM 位置（text node + offset），用于恢复 Range。
 * canonicalToDom 本身即边界映射，start/end 端点同一规则。
 */
export function canonicalOffsetToDomPosition(
  page: CanonicalPageText,
  canonicalOffset: number,
  textLayerDiv: HTMLElement
): { node: Text; offset: number } | null {
  // 边界归属：span 交界处的偏移映射到下一段起点（start 语义），
  // 仅在页末落回最后一段末尾。
  const nonEmptySpans = page.spans.filter(
    (candidate) => candidate.canonicalText !== ''
  )
  const span =
    nonEmptySpans.find(
      (candidate) =>
        canonicalOffset >= candidate.canonicalStart &&
        canonicalOffset < candidate.canonicalEnd
    ) ??
    (nonEmptySpans.length > 0 &&
    canonicalOffset === nonEmptySpans[nonEmptySpans.length - 1].canonicalEnd
      ? nonEmptySpans[nonEmptySpans.length - 1]
      : null) ??
    null
  if (!span) return null

  const element = textLayerDiv.querySelector<HTMLElement>(
    `[${TEXT_LAYER_TEXT_ID_ATTR}="${canonicalTextId(page.pageNumber, span.itemIndex)}"]`
  )
  if (!element) return null

  const domOffset = span.canonicalToDom[canonicalOffset - span.canonicalStart]
  if (domOffset === undefined) return null

  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT
  )
  let currentNode = walker.nextNode() as Text | null
  let consumed = 0
  while (currentNode) {
    const length = currentNode.textContent?.length ?? 0
    if (consumed + length >= domOffset) {
      return { node: currentNode, offset: domOffset - consumed }
    }
    consumed += length
    currentNode = walker.nextNode() as Text | null
  }
  return null
}

/** 由 canonical 端点构造跨 span 的 DOM Range（限单页 text layer 内）。 */
export function canonicalRangeToDomRange(
  page: CanonicalPageText,
  startOffset: number,
  endOffset: number,
  textLayerDiv: HTMLElement
): Range | null {
  const start = canonicalOffsetToDomPosition(page, startOffset, textLayerDiv)
  const end = canonicalOffsetToDomPosition(page, endOffset, textLayerDiv)
  if (!start || !end) return null

  const range = textLayerDiv.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}
