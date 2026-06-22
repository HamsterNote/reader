import { HtmlParser, type DecodeOptions } from '@hamster-note/html-parser'
import {
  IntermediateDocument,
  type IntermediateContent,
  type IntermediateDocumentSerialized,
  type IntermediateText
} from '@hamster-note/types'
import {
  VirtualPaper,
  VirtualPaperInteractionMode,
  VirtualPaperRenderMode,
  type VirtualPaperTransform,
  type VirtualPaperTransformMeta
} from '@hamster-note/virtual-paper'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  shouldArmLongPress,
  shouldForceBlockSelection,
  shouldStartSelectionOnPointerDown,
  toReaderPointerType
} from '../gestureRouting'
import {
  getNearestTextElementForPoint,
  getPageElementByPageNumber,
  getPageElementForPoint,
  isHtmlParserSelectionTarget,
  isSelectionBackgroundTarget,
  resolveCaret
} from '../selection/caretResolver'
import {
  armDragPreview,
  cancelDragPreview,
  createDragPreviewSession,
  finalizeDragPreview,
  geometryToOverlayRects,
  shouldShowSelectionHandles,
  updateDragPreview,
  type DragPreviewRect,
  type DragPreviewSession,
  type DragPreviewState
} from '../selection/dragPreviewModel'
import {
  createDragSelectionAdapter,
  type DragSelectionAdapter
} from '../selection/dragSelectionAdapter'
import {
  rebuildSavedSelectionFromEdit,
  resolveSavedSelection,
  type TextElementInfo
} from '../selection/savedSelection'
import {
  composeSelection,
  createOrderedRange
} from '../selection/selectionComposer'
import {
  buildSelectionPayload,
  buildSelectionPayloadFromTexts,
  getClosestTextElement,
  textElementRecords,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload
} from '../selection/selectionPayloadSerializer'
import { createWordRangeFromCaret } from '../selection/wordRange'
import { polygonsToSvgPath, rectsToUnionPolygons } from '../selectionGeometry'

export {
  getNearestTextElementForPoint,
  getPageElementByPageNumber,
  getPageElementForPoint,
  resolveCaret
} from '../selection/caretResolver'
export {
  composeSelection,
  createOrderedRange
} from '../selection/selectionComposer'
export {
  buildSelectionPayload,
  getClosestTextElement,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload,
  textElementRecords
} from '../selection/selectionPayloadSerializer'
export {
  buildSavedSelection,
  denormalizePageRects,
  normalizePageRects,
  resolveSavedSelection,
  textHash,
  type NormalizedRect,
  type TextElementInfo
} from '../selection/savedSelection'

type SupportedTextHitCaret = {
  element: HTMLElement
  node: Node
  offset: number
  range: Range
  pageNumber: number
}

type MouseSelectionCaret = {
  readonly node: Node
  readonly offset: number
  readonly clientX: number
  readonly clientY: number
}

type TextSelectionSnapshot = {
  readonly startNode: Text
  readonly startOffset: number
  readonly endNode: Text
  readonly endOffset: number
}

type ActiveTextSelectionSnapshot = {
  readonly startNode: Node
  readonly startOffset: number
  readonly endNode: Node
  readonly endOffset: number
}

type ActiveMouseSelectionState = {
  active: boolean
  startClientX: number
  startClientY: number
  clientX: number
  clientY: number
  startPagePercentX: number
  startPagePercentY: number
  pageNumber: number | null
  pageElement: HTMLDivElement | null
  startNode: Node | null
  startOffset: number
  startCaret: MouseSelectionCaret | null
  endNode: Node | null
  endOffset: number
  lastTextElement: HTMLElement | null
  lastCaret: MouseSelectionCaret | null
  finalized: boolean
}

type CaretPointDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

type SupportedHitDirection = 'forward' | 'backward' | 'nearest'

const SUPPORTED_TEXT_HIT_SELECTOR =
  'span.hamster-note-text, [data-text-id], .hamster-reader__intermediate-text'

const SELECTION_CHROME_HIT_SELECTOR = [
  '.hamster-reader__selection-overlay',
  '.hamster-reader__selection-overlay-path',
  '.hamster-reader__saved-selection-handles',
  '.hamster-reader__selection-handle'
].join(', ')

const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, value))

const getPagePercentPoint = (
  clientX: number,
  clientY: number,
  pageRect: DOMRect
): { x: number; y: number } | null => {
  if (pageRect.width <= 0 || pageRect.height <= 0) return null

  return {
    x: clampPercent(((clientX - pageRect.left) / pageRect.width) * 100),
    y: clampPercent(((clientY - pageRect.top) / pageRect.height) * 100)
  }
}

const isNodeInsideElement = (node: Node, element: HTMLElement): boolean =>
  node === element || element.contains(node)

const isRangeInsideElement = (range: Range, element: HTMLElement): boolean =>
  isNodeInsideElement(range.startContainer, element) &&
  isNodeInsideElement(range.endContainer, element)

const getFallbackTextNode = (element: HTMLElement): Text => {
  const existingNode = Array.from(element.childNodes).find(
    (node): node is Text => node.nodeType === Node.TEXT_NODE
  )
  if (existingNode) return existingNode

  const textNode = element.ownerDocument.createTextNode(
    element.textContent ?? ''
  )
  element.appendChild(textNode)
  return textNode
}

const getDescendantTextNodes = (element: HTMLElement): readonly Text[] => {
  const ownerDocument = element.ownerDocument
  const textNodes: Text[] = []
  const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let currentNode = walker.nextNode()
  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      textNodes.push(currentNode as Text)
    }
    currentNode = walker.nextNode()
  }

  return textNodes
}

const getNearestTextNode = (
  clientX: number,
  textNodes: readonly Text[]
): Text | null => {
  let nearestNode: Text | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  textNodes.forEach((textNode) => {
    const range = textNode.ownerDocument.createRange()
    range.selectNodeContents(textNode)
    const rect =
      typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : textNode.parentElement?.getBoundingClientRect()
    range.detach()
    if (!rect) return
    const centerX = rect.left + rect.width / 2
    const distance = rect.width > 0 ? Math.abs(clientX - centerX) : 0
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestNode = textNode
    }
  })

  return nearestNode ?? textNodes[0] ?? null
}

const getDirectionalTextPoint = (
  clientX: number,
  element: HTMLElement,
  direction: SupportedHitDirection
): { node: Text; offset: number } => {
  const textNodes = getDescendantTextNodes(element)
  if (textNodes.length === 0) {
    const textNode = getFallbackTextNode(element)
    return { node: textNode, offset: 0 }
  }

  if (direction === 'forward') {
    const node = textNodes[textNodes.length - 1]
    if (!node) {
      const textNode = getFallbackTextNode(element)
      return { node: textNode, offset: 0 }
    }
    return { node, offset: node.data.length }
  }

  if (direction === 'backward') {
    const node = textNodes[0]
    if (!node) {
      const textNode = getFallbackTextNode(element)
      return { node: textNode, offset: 0 }
    }
    return { node, offset: 0 }
  }

  const nearestNode = getNearestTextNode(clientX, textNodes)
  if (!nearestNode) {
    const textNode = getFallbackTextNode(element)
    return { node: textNode, offset: 0 }
  }
  return {
    node: nearestNode,
    offset: getFallbackCaretOffset(clientX, element, nearestNode)
  }
}

const getFallbackCaretOffset = (
  clientX: number,
  element: HTMLElement,
  textNode: Text
): number => {
  const textLength = textNode.data.length
  if (textLength === 0) return 0

  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || clientX >= rect.right) return textLength
  if (clientX <= rect.left) return 0

  const ratio = (clientX - rect.left) / rect.width
  return Math.max(0, Math.min(textLength, Math.floor(ratio * textLength)))
}

const createSupportedHitFallbackRange = (
  clientX: number,
  element: HTMLElement,
  direction: SupportedHitDirection = 'nearest'
): { range: Range; node: Node; offset: number } => {
  const { node: textNode, offset } = getDirectionalTextPoint(
    clientX,
    element,
    direction
  )
  const range = element.ownerDocument.createRange()
  range.setStart(textNode, offset)
  range.collapse(true)
  return { range, node: textNode, offset }
}

const getSupportedTextElementAtPoint = (
  viewerRoot: HTMLElement,
  clientX: number,
  clientY: number
): HTMLElement | null => {
  const textElements = Array.from(
    viewerRoot.querySelectorAll(SUPPORTED_TEXT_HIT_SELECTOR)
  )

  for (const element of textElements) {
    if (!(element instanceof HTMLElement)) continue
    if (isSelectionBackgroundTarget(element)) continue
    if (element.closest(SELECTION_CHROME_HIT_SELECTOR)) continue

    const rect = element.getBoundingClientRect()
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return element
    }
  }

  return null
}

const normalizeSupportedHitRange = (
  clientX: number,
  element: HTMLElement,
  range: Range,
  direction: SupportedHitDirection = 'nearest'
): { range: Range; node: Node; offset: number } => {
  if (
    range.startContainer.nodeType === Node.TEXT_NODE &&
    isNodeInsideElement(range.startContainer, element)
  ) {
    return {
      range,
      node: range.startContainer,
      offset: range.startOffset
    }
  }

  range.detach()
  return createSupportedHitFallbackRange(clientX, element, direction)
}

const getSelectionForRoot = (
  viewerRoot: HTMLElement | null
): Selection | null => {
  return viewerRoot?.ownerDocument.defaultView?.getSelection?.() ?? null
}

const getNodeElement = (node: Node | null): Element | null => {
  if (!node) return null
  return node instanceof Element ? node : node.parentElement
}

const isNodePairInsideRoot = (
  viewerRoot: HTMLElement,
  startNode: Node | null,
  endNode: Node | null
): boolean => {
  const startElement = getNodeElement(startNode)
  const endElement = getNodeElement(endNode)
  if (!startElement || !endElement) return false

  return viewerRoot.contains(startElement) && viewerRoot.contains(endElement)
}

const canWriteSelection = (
  selection: Selection | null
): selection is Selection & {
  removeAllRanges: () => void
  addRange: (range: Range) => void
} => {
  if (!selection) return false

  return (
    typeof selection.removeAllRanges === 'function' &&
    typeof selection.addRange === 'function'
  )
}

const restoreSelectionRange = (selection: Selection, range: Range): void => {
  selection.removeAllRanges()
  selection.addRange(range)
}

const restoreTextSelectionSnapshot = (
  snapshot: TextSelectionSnapshot,
  viewerRoot: HTMLElement,
  selection: Selection
): Range | null => {
  if (
    snapshot.startNode === snapshot.endNode &&
    snapshot.startOffset === snapshot.endOffset
  ) {
    return null
  }

  if (!isNodePairInsideRoot(viewerRoot, snapshot.startNode, snapshot.endNode)) {
    return null
  }

  const restoredRange = createOrderedRange(
    snapshot.startNode,
    snapshot.startOffset,
    snapshot.endNode,
    snapshot.endOffset
  )
  restoreSelectionRange(selection, restoredRange)
  return restoredRange
}

const restoreStoredTextRange = (
  storedRange: Range | null,
  viewerRoot: HTMLElement,
  selection: Selection
): boolean => {
  if (
    !storedRange ||
    storedRange.startContainer.nodeType !== Node.TEXT_NODE ||
    storedRange.endContainer.nodeType !== Node.TEXT_NODE ||
    !isNodePairInsideRoot(
      viewerRoot,
      storedRange.startContainer,
      storedRange.endContainer
    )
  ) {
    return false
  }

  restoreSelectionRange(selection, storedRange.cloneRange())
  return true
}

const restoreActiveTextSelection = (
  snapshot: ActiveTextSelectionSnapshot,
  viewerRoot: HTMLElement,
  selection: Selection
): Range | null => {
  if (!isNodePairInsideRoot(viewerRoot, snapshot.startNode, snapshot.endNode)) {
    return null
  }

  const activeRange = createOrderedRange(
    snapshot.startNode,
    snapshot.startOffset,
    snapshot.endNode,
    snapshot.endOffset
  )
  restoreSelectionRange(selection, activeRange)
  return activeRange
}

const getNativeSupportedHitRange = (
  clientX: number,
  clientY: number,
  element: HTMLElement,
  ownerDocument: Document,
  direction: SupportedHitDirection = 'nearest'
): { range: Range; node: Node; offset: number } | null => {
  const caretDocument = ownerDocument as CaretPointDocument
  const caretPosition = caretDocument.caretPositionFromPoint?.(clientX, clientY)
  if (
    caretPosition &&
    (isNodeInsideElement(caretPosition.offsetNode, element) ||
      (caretPosition.offsetNode instanceof Element &&
        caretPosition.offsetNode.contains(element)))
  ) {
    const range = ownerDocument.createRange()
    range.setStart(caretPosition.offsetNode, caretPosition.offset)
    range.collapse(true)
    return normalizeSupportedHitRange(clientX, element, range, direction)
  }

  const caretRange = caretDocument.caretRangeFromPoint?.(clientX, clientY)
  if (caretRange) {
    const rangeContainsElement =
      caretRange.startContainer instanceof Element &&
      caretRange.startContainer.contains(element)
    if (isRangeInsideElement(caretRange, element) || rangeContainsElement) {
      return normalizeSupportedHitRange(clientX, element, caretRange, direction)
    }
    caretRange.detach()
  }

  return null
}

const getSupportedHitPageNumber = (element: HTMLElement): number | null => {
  const pageElement = element.closest('[data-page-number]')
  if (pageElement instanceof HTMLElement) {
    const pageNumber = Number(pageElement.dataset.pageNumber)
    return Number.isFinite(pageNumber) ? pageNumber : null
  }

  const htmlPageElement = element.closest('.hamster-note-page')
  if (!(htmlPageElement instanceof HTMLElement)) return null

  const explicitPageNumber = Number(htmlPageElement.dataset.pageNumber)
  if (Number.isFinite(explicitPageNumber)) return explicitPageNumber

  const htmlDocument = htmlPageElement.closest('.hamster-note-document')
  const pageElements = Array.from(
    htmlDocument?.querySelectorAll('.hamster-note-page') ?? []
  )
  const pageIndex = pageElements.indexOf(htmlPageElement)
  return pageIndex === -1 ? null : pageIndex + 1
}

export type ReaderTextSelectionDetail = {
  text: IntermediateText
  texts: IntermediateText[]
  selectedText: string
  pageNumber: number
  selection: Selection
}

export type ReaderSelectedTextDragCallback = (
  selection: Selection,
  segments: ReaderSelectedTextSegment[],
  extractedText: string
) => void

export type ReaderPageRange = {
  start: number
  end: number
}

export type ReaderRenderMode = 'html-parser' | 'direct'

/** 背景质量级别：low（低）、medium（中）、high（高） */
export type BackgroundQuality = 'low' | 'medium' | 'high'

/** 选择覆盖层矩形区域（页面坐标系） */
export type ReaderSelectionOverlayRect = {
  x: number
  y: number
  width: number
  height: number
  pageNumber: number
}

/**
 * 已保存选择的文本锚点信息。
 * 用于精确定位选择在文档中的起始/结束位置。
 * bbox 使用归一化坐标（0-1），相对于页面尺寸。
 */
export type ReaderSavedSelectionAnchor = {
  /** 锚点所在页码 */
  pageNumber: number
  /** 文本元素的唯一标识符（可选，用于精确匹配） */
  textId?: string
  /** 文本内容的哈希值（可选，用于文本变化后的模糊匹配） */
  textHash?: string
  /** 锚点在文本元素中的字符索引（可选） */
  charIndex?: number
  /** 锚点前的上下文文本（可选，用于上下文匹配回退） */
  contextBefore?: string
  /** 锚点后的上下文文本（可选，用于上下文匹配回退） */
  contextAfter?: string
  /** 归一化的边界框坐标（可选，0-1 范围，相对于页面尺寸） */
  bbox?: { x: number; y: number; width: number; height: number }
}

/**
 * 已保存选择中的一个文本段落。
 * 描述选择在单页内的一段连续文本及其位置信息。
 */
export type ReaderSavedSelectionSegment = {
  /** 段落所在页码 */
  pageNumber: number
  /** 文本元素的唯一标识符（可选） */
  textId?: string
  /** 文本内容的哈希值（可选） */
  textHash?: string
  /** 段落起始字符索引（可选） */
  startCharIndex?: number
  /** 段落结束字符索引（可选） */
  endCharIndex?: number
  /** 段落中的已选文本内容（可选） */
  selectedText?: string
  /** 段落前的上下文文本（可选） */
  contextBefore?: string
  /** 段落后的上下文文本（可选） */
  contextAfter?: string
  /** 归一化的边界框坐标（可选，0-1 范围，相对于页面尺寸） */
  bbox?: { x: number; y: number; width: number; height: number }
}

/**
 * 已保存选择的视觉回退数据（单页）。
 * 当文本锚点无法解析时，使用归一化矩形区域进行视觉渲染。
 */
export type ReaderSavedSelectionVisualPage = {
  /** 页码 */
  pageNumber: number
  /** 页面尺寸（像素） */
  pageSize: { width: number; height: number }
  /** 归一化的矩形区域列表（0-1 范围，相对于页面尺寸） */
  rects: Array<{ x: number; y: number; width: number; height: number }>
}

/** 已保存选择的恢复状态 */
export type ReaderSavedSelectionRestoreStatus =
  | 'resolved'
  | 'visual-fallback'
  | 'unresolved'

/**
 * 已保存选择的恢复结果。
 * 包含恢复状态、覆盖层矩形、段落信息和提取的文本。
 */
export type ReaderSavedSelectionRestoreResult = {
  /** 已保存选择的唯一标识符 */
  id: string
  /** 原始的已保存选择数据 */
  selection: ReaderSavedSelection
  /** 恢复状态 */
  status: ReaderSavedSelectionRestoreStatus
  /** 可编辑的恢复 Range；视觉回退和未解析状态为空 */
  range?: Range
  /** 恢复后的覆盖层矩形（页面坐标系），可能来自文本解析或视觉回退 */
  rects: ReaderSelectionOverlayRect[]
  /** 恢复后的段落信息，未解析时为空数组 */
  segments: ReaderSavedSelectionSegment[]
  /** 提取的文本内容，未解析时为空字符串 */
  extractedText: string
  /** 未完全解析的原因说明（可选） */
  reason?: string
}

/**
 * 已保存选择编辑事件的详细信息。
 * 当用户通过拖动手柄编辑已保存选择时触发。
 */
export type ReaderSavedSelectionEditDetail = {
  /** 已保存选择的唯一标识符 */
  id: string
  /** 编辑后的选择数据 */
  selection: ReaderSavedSelection
  /** 编辑前的选择数据 */
  previousSelection: ReaderSavedSelection
  /** 恢复状态 */
  status: ReaderSavedSelectionRestoreStatus
  /** 编辑后的段落信息 */
  segments: ReaderSavedSelectionSegment[]
  /** 编辑后提取的文本内容 */
  extractedText: string
  /** 状态说明（可选） */
  reason?: string
}

/**
 * 已保存选择的公共数据模型（v1 版本）。
 *
 * 设计原则：
 * - **版本化**：`version` 字段为字面量 `1`，未来 schema 变更时递增。
 * - **归一化坐标**：所有 bbox 和 visual rects 使用 0-1 归一化坐标，
 *   相对于页面尺寸，确保跨分辨率一致性。
 * - **调用方持久化**：Reader 和 IntermediateDocumentViewer 不实现持久化逻辑；
 *   调用方负责保存/加载 savedSelections 数据。
 * - **只读回退**：当文本锚点无法解析时，使用 visual 数据渲染只读覆盖层；
 *   回退选择不可编辑，不显示拖动手柄。
 */
/**
 * 已保存选择上的评论。评论数据由调用方维护，库本身只负责透传与
 * 在编辑选区时保留这些数据，不会主动渲染或修改评论内容。
 */
export type ReaderSavedSelectionComment = {
  /** 评论唯一标识符（由调用方生成） */
  id: string
  /** 评论文本内容 */
  text: string
  /** 评论创建时间戳（毫秒） */
  createdAt: number
  /** 评论作者（可选） */
  author?: string
}

export type ReaderSavedSelection = {
  /** 数据格式版本，当前固定为 1 */
  version: 1
  /** 已保存选择的唯一标识符（由调用方生成和管理） */
  id: string
  /** 文档标识符（可选，用于区分不同文档的选择） */
  document?: string
  /** 选择的完整文本内容 */
  text: string
  /** 选择起始锚点 */
  start: ReaderSavedSelectionAnchor
  /** 选择结束锚点 */
  end: ReaderSavedSelectionAnchor
  /** 选择包含的文本段落列表（支持跨页选择） */
  segments: ReaderSavedSelectionSegment[]
  /** 视觉回退数据（按页分组，用于无法解析文本时的只读渲染） */
  visual: ReaderSavedSelectionVisualPage[]
  /**
   * 选区上的评论（可选）。库不解释这些数据，仅在 rebuildSavedSelectionFromEdit
   * 等内部流程中保留它们，避免编辑手柄拖动时评论被意外丢弃。
   */
  comments?: ReaderSavedSelectionComment[]
}

const NON_SPACE_BLANK_TEXT_RE = /^[\s\u200B-\u200D\uFEFF]+$/u

export const isNonSpaceBlankText = (content: string): boolean =>
  content.length > 0 &&
  NON_SPACE_BLANK_TEXT_RE.test(content) &&
  content.replace(/ /g, '').length > 0

/** 选择覆盖层配置选项 */
export type ReaderSelectionOverlayOptions = {
  /** 覆盖层颜色，默认 '#ec4899' */
  color?: string
  /** 覆盖层透明度，默认 0.3 */
  opacity?: number
  /** 是否启用覆盖层，默认 true */
  enabled?: boolean
}

/** 选择手柄位置信息 */
export type ReaderSelectionHandlePosition = {
  x: number
  y: number
  pageNumber: number
  rootX?: number
  rootY?: number
  /** 边界文字高度（像素），用于自定义手柄按文字大小调整触控区域 */
  textHeight?: number
  /** 触控区域宽度（像素），通常为 textHeight 的一半 */
  hitAreaWidth?: number
  /** 触控区域高度（像素），通常等于 textHeight */
  hitAreaHeight?: number
}

/** 选择手柄渲染属性 */
export type ReaderSelectionHandleRenderProps = {
  /** 手柄类型：start 或 end */
  type: 'start' | 'end'
  /** 手柄位置 */
  position: ReaderSelectionHandlePosition
  /** 是否正在拖动 */
  isDragging: boolean
  /** 边界文字高度（像素），可选以保持向后兼容 */
  textHeight?: number
  /** 触控区域宽度（像素），可选以保持向后兼容 */
  hitAreaWidth?: number
  /** 触控区域高度（像素），可选以保持向后兼容 */
  hitAreaHeight?: number
}

/** 将背景质量级别映射为 html-parser 的 backgroundQuality 数值（0-1） */
const BACKGROUND_QUALITY_MAP: Record<BackgroundQuality, number> = {
  low: 0.1,
  medium: 0.3,
  high: 0.8
}

type HtmlPageStatus = 'loading' | 'decoded' | 'fallback'

function buildHtmlParserDecodeOptions(
  backgroundQuality: BackgroundQuality | undefined
): DecodeOptions | undefined {
  return backgroundQuality
    ? {
        background: {
          backgroundQuality: BACKGROUND_QUALITY_MAP[backgroundQuality]
        }
      }
    : undefined
}

/** 交互模式：'default' 为默认触摸/鼠标模式，'stylus' 为手写笔优化模式 */
export type ReaderInteractionMode = 'default' | 'stylus'

type LongPressSession = {
  pointerId: number
  timerId: ReturnType<typeof setTimeout>
  startX: number
  startY: number
  anchorRange: Range | null
}

export type IntermediateDocumentViewerProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  serializedDocument?: IntermediateDocumentSerialized | null
  className?: string
  overscan?: number
  pageRange?: ReaderPageRange
  renderMode?: ReaderRenderMode
  backgroundQuality?: BackgroundQuality
  ocr?: boolean | { enabled?: boolean }
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  onTextSelectionChange?: (
    text: IntermediateText,
    detail: ReaderTextSelectionDetail
  ) => void
  onTextSelectionEnd?: (
    text: IntermediateText,
    detail: ReaderTextSelectionDetail
  ) => void
  onSelectText?: (
    selection: Selection,
    segments: ReaderSelectedTextSegment[],
    extractedText: string
  ) => void
  onDragSelectedTextStart?: ReaderSelectedTextDragCallback
  onDragSelectedTextMove?: ReaderSelectedTextDragCallback
  onDragSelectedTextEnd?: ReaderSelectedTextDragCallback
  selectionOverlay?: boolean | ReaderSelectionOverlayOptions
  // 允许传入 null 显式禁用手柄渲染（运行时已支持，类型在此对齐）
  selectionHandleElement?: React.ReactElement<ReaderSelectionHandleRenderProps> | null
  /** 已保存的选择列表（可选），由调用方管理和持久化 */
  savedSelections?: ReaderSavedSelection[]
  /** 编辑已保存选择时的回调（可选），仅在拖动手柄提交时触发一次 */
  onSavedSelectionEdit?: (
    id: string,
    selection: ReaderSavedSelection,
    detail: ReaderSavedSelectionEditDetail
  ) => void
  /** 当前激活的已保存选择 ID（可选），null 表示无激活选择 */
  activeSavedSelectionId?: string | null
  /** 激活选择变化时的回调（可选） */
  onActiveSavedSelectionChange?: (id: string | null) => void
  /** 已保存选择恢复完成时的回调（可选），用于诊断恢复状态 */
  onSavedSelectionRestore?: (
    results: ReaderSavedSelectionRestoreResult[]
  ) => void
  // ---- Zoom props ----
  /**
   * Controlled zoom scale. When provided, internal wheel/pinch gestures do not
   * mutate scale state; they call `onScaleChange` with the next clamped value
   * and wait for the caller to pass that value back. Invalid/non-positive values
   * are treated as the safe default scale of `1`, then clamped to the active
   * bounds.
   */
  scale?: number
  /**
   * Initial zoom scale for uncontrolled mode. Defaults to `1`, is clamped to the
   * effective `minScale`/`maxScale` range, and is read only during initial state
   * creation so later `defaultScale` prop changes do not reset user zoom.
   */
  defaultScale?: number
  /**
   * Fires only when a wheel or pinch gesture produces a changed, clamped scale.
   * The detail object reports `source: 'wheel' | 'pinch'` and may include the
   * viewport focal point used to preserve scroll anchoring.
   */
  onScaleChange?: (
    scale: number,
    detail: { source: 'wheel' | 'pinch'; focalPoint?: { x: number; y: number } }
  ) => void
  /**
   * Lower zoom bound. Defaults to `0.25`; invalid or non-positive values fall
   * back to the default. If the normalized minimum is greater than the maximum,
   * the maximum is raised to the minimum to keep clamping deterministic.
   */
  minScale?: number
  /**
   * Upper zoom bound. Defaults to `4`; invalid or non-positive values fall back
   * to the default before the final range is normalized.
   */
  maxScale?: number
  // ---- Lazy-release prop ----
  /**
   * Maximum number of concurrently loaded pages before lazy eviction. Defaults
   * to `max(5, overscan * 2 + 5)`. Only `Infinity` disables eviction entirely;
   * `0`, negative, `NaN`, or other invalid values fall back to the default cap.
   * Finite values are floored by protected pages (visible pages, overscan,
   * in-flight work, active selection/drag/pinch state, and saved-selection
   * anchors), so more pages may remain loaded than the raw value. With
   * html-parser output, eviction releases per-page decoded html state so an
   * evicted page can be decoded again when it re-enters the loadable window.
   */
  maxLoadedPages?: number
  /** 交互模式，影响手势处理行为 */
  interactionMode?: ReaderInteractionMode
}

type PageSize = {
  width: number
  height: number
}

type RenderableIntermediateText = IntermediateText &
  Partial<{
    x: number
    y: number
    width: number
    height: number
    polygon: [number, number][]
    rotate: number
    skew: number
  }>

type PageLoadStatus = 'loaded' | 'error'
type HtmlParserPageInput = Parameters<typeof HtmlParser.decodePageToHtml>[0]

const DEFAULT_PAGE_SIZE: PageSize = {
  width: 595,
  height: 842
}

const getVisiblePageNumbers = (
  allPageNumbers: number[],
  pageRange: ReaderPageRange | undefined
) => {
  if (!pageRange) {
    return allPageNumbers
  }

  const start = Math.trunc(pageRange.start)
  const end = Math.trunc(pageRange.end)

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return []
  }

  return allPageNumbers.filter(
    (pageNumber) => pageNumber >= start && pageNumber <= end
  )
}

function normalizeScaleValue(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return value
}

function getEffectiveScaleRange(
  minScale: number | undefined,
  maxScale: number | undefined
): { min: number; max: number } {
  const min = normalizeScaleValue(minScale, 0.25)
  const max = normalizeScaleValue(maxScale, 4)

  if (min > max) {
    return { min, max: min }
  }

  return { min, max }
}

function clampScale(
  value: number,
  range: { min: number; max: number }
): number {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 1

  return Math.max(range.min, Math.min(range.max, safeValue))
}

function getScaleChangeSource(
  source: VirtualPaperTransformMeta['source']
): 'wheel' | 'pinch' {
  return source === VirtualPaperInteractionMode.MouseWheelCtrlZoom ||
    source === VirtualPaperInteractionMode.MouseWheelZoom
    ? 'wheel'
    : 'pinch'
}

function getEffectiveMaxLoadedPages(
  maxLoadedPages: number | undefined,
  overscan: number,
  floorCount: number
): number {
  const defaultCap = Math.max(5, overscan * 2 + 5)
  let configured = defaultCap

  // Only Infinity disables eviction entirely; 0, negative, NaN, and other
  // invalid values fall back to the default cap (same as omitting the prop).
  if (maxLoadedPages === Infinity) return Infinity
  if (
    typeof maxLoadedPages === 'number' &&
    Number.isFinite(maxLoadedPages) &&
    maxLoadedPages > 0
  ) {
    configured = maxLoadedPages
  }

  return Math.max(configured, floorCount, 5)
}

const isRuntimeDocument = (
  document: IntermediateDocument | IntermediateDocumentSerialized
): document is IntermediateDocument =>
  typeof (document as IntermediateDocument).getPageByPageNumber === 'function'

const getRuntimeDocument = (
  inputDocument:
    | IntermediateDocument
    | IntermediateDocumentSerialized
    | null
    | undefined
) => {
  if (!inputDocument) return null
  return isRuntimeDocument(inputDocument)
    ? inputDocument
    : IntermediateDocument.parse(inputDocument)
}

const getSelectionOverlayOptions = (
  selectionOverlay: IntermediateDocumentViewerProps['selectionOverlay']
) => {
  if (!selectionOverlay) return null
  if (selectionOverlay === true) {
    return { color: '#ec4899', opacity: 0.3, enabled: true }
  }
  return {
    color: selectionOverlay.color ?? '#ec4899',
    opacity: selectionOverlay.opacity ?? 0.3,
    enabled: selectionOverlay.enabled ?? true
  }
}

const isIntermediateText = (
  content: IntermediateContent
): content is IntermediateText => 'content' in content && 'fontSize' in content

const normalizePageSize = (size: { x?: number; y?: number } | undefined) => {
  const pageSizeUnavailable =
    !(typeof size?.x === 'number' && size.x > 0) ||
    !(typeof size?.y === 'number' && size.y > 0)
  const width =
    typeof size?.x === 'number' && size.x > 0 ? size.x : DEFAULT_PAGE_SIZE.width
  const height =
    typeof size?.y === 'number' && size.y > 0
      ? size.y
      : DEFAULT_PAGE_SIZE.height

  return { width, height, pageSizeUnavailable }
}

const getTextBoundingBox = (polygon: [number, number][]) => {
  if (!polygon || polygon.length < 4) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const xs = polygon.map((point) => point?.[0]).filter(Number.isFinite)
  const ys = polygon.map((point) => point?.[1]).filter(Number.isFinite)
  if (xs.length === 0 || ys.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const getPolygonTextGeometry = (
  polygon: [number, number][] | undefined
): {
  x: number
  y: number
  width: number
  height: number
  rotation: number
} | null => {
  if (
    !polygon ||
    polygon.length !== 4 ||
    !polygon.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === 'number' &&
        typeof p[1] === 'number' &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1])
    )
  ) {
    return null
  }

  const p0 = polygon[0]
  const p1 = polygon[1]
  const p2 = polygon[2]

  const width = Math.sqrt((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2)
  const height = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)

  if (width === 0 || height === 0) {
    return null
  }

  const rotation = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI

  return {
    x: p0[0],
    y: p0[1],
    width,
    height,
    rotation
  }
}

/**
 * Merge overlapping or adjacent rectangles on the same line.
 * Uses a tolerance of 2px to handle minor gaps between text spans.
 */
export const mergeSelectionRects = (
  rects: Array<{ x: number; y: number; width: number; height: number }>
): Array<{ x: number; y: number; width: number; height: number }> => {
  if (rects.length === 0) return []

  // Sort by Y then X
  const sorted = [...rects].sort((a, b) => {
    const yDiff = a.y - b.y
    return Math.abs(yDiff) < 2 ? a.x - b.x : yDiff
  })

  const merged: Array<{ x: number; y: number; width: number; height: number }> =
    []
  let current = { ...sorted[0] }

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    const sameLine =
      Math.abs(current.y - next.y) < 2 &&
      Math.abs(current.height - next.height) < 2
    const overlapsOrAdjacent =
      sameLine && next.x <= current.x + current.width + 2

    if (overlapsOrAdjacent) {
      // Merge: extend current rect to cover next
      const right = Math.max(current.x + current.width, next.x + next.width)
      current.x = Math.min(current.x, next.x)
      current.width = right - current.x
    } else {
      merged.push(current)
      current = { ...next }
    }
  }
  merged.push(current)

  return merged
}

/**
 * Extract selection overlay rectangles from a Selection object.
 * Coordinate contract: selection APIs (`getSelectionOverlayRects`,
 * `buildSelectionPayload`, handle positions, caret previews, and saved
 * selection geometry) store page-relative CSS pixels. DOM hit-testing and
 * `getBoundingClientRect()` values are viewport CSS pixels after the scale
 * surface transform, so viewport boundaries must be converted back before
 * comparing or persisting page-relative geometry.
 */
const toScaledViewport = (value: number, effectiveScale: number): number =>
  value * effectiveScale

const toPageRelative = (value: number, effectiveScale: number): number =>
  effectiveScale === 0 ? value : value / effectiveScale

const getElementViewportScale = (element: HTMLElement): number => {
  const scaleSurface = element.closest(
    '[data-testid="virtual-paper-container"]'
  )
  const transform =
    scaleSurface instanceof HTMLElement
      ? scaleSurface.style.transform || getComputedStyle(scaleSurface).transform
      : ''
  const scaleMatch = /scale\(([^)]+)\)/.exec(transform)
  if (scaleMatch) {
    const scale = Number.parseFloat(scaleMatch[1])
    return Number.isFinite(scale) && scale > 0 ? scale : 1
  }

  const matrix3dMatch = /matrix3d\(([^)]+)\)/.exec(transform)
  if (matrix3dMatch) {
    const values = matrix3dMatch[1]
      .split(',')
      .map((value) => Number(value.trim()))
    const scale = Math.hypot(values[0] ?? 1, values[1] ?? 0, values[2] ?? 0)
    return Number.isFinite(scale) && scale > 0 ? scale : 1
  }

  const matrixMatch = /matrix\(([^)]+)\)/.exec(transform)
  if (matrixMatch) {
    const values = matrixMatch[1]
      .split(',')
      .map((value) => Number(value.trim()))
    const scale = Math.hypot(values[0] ?? 1, values[1] ?? 0)
    return Number.isFinite(scale) && scale > 0 ? scale : 1
  }

  const scale = 1
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

const getPageViewportPoint = (
  pageElement: HTMLElement,
  point: { x: number; y: number }
): { x: number; y: number } => {
  const pageRect = pageElement.getBoundingClientRect()
  const pageScale = getElementViewportScale(pageElement)
  return {
    x: pageRect.left + toScaledViewport(point.x, pageScale),
    y: pageRect.top + toScaledViewport(point.y, pageScale)
  }
}

export const getSelectionOverlayRects = (
  selection: Selection,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>,
  textElements?: Map<string, { text: IntermediateText; pageNumber: number }>
): ReaderSelectionOverlayRect[] => {
  if (selection.isCollapsed) return []

  const range = selection.getRangeAt(0)
  const clientRects = collectSelectionOverlayClientRects(
    range,
    viewerRoot,
    textElements
  )

  if (clientRects.length === 0) return []

  // Filter out zero-size rects
  const validRects = clientRects.filter(
    (rect) => rect.width > 0 && rect.height > 0
  )

  if (validRects.length === 0) return []

  // Group rects by page
  const rectsByPage = new Map<
    number,
    Array<{ x: number; y: number; width: number; height: number }>
  >()

  for (const rect of validRects) {
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    // Find which page this rect belongs to
    const pageInfo = getPageElementForPoint(
      centerX,
      centerY,
      viewerRoot,
      pageRefs
    )
    if (!pageInfo) continue

    const pageRect = pageInfo.pageElement.getBoundingClientRect()
    const pageNumber = pageInfo.pageNumber
    const pageScale = getElementViewportScale(pageInfo.pageElement)

    // Convert scaled viewport coords to page-relative CSS pixels.
    if (!rectsByPage.has(pageNumber)) {
      rectsByPage.set(pageNumber, [])
    }
    const pageRects = rectsByPage.get(pageNumber)
    if (!pageRects) continue

    pageRects.push({
      x: toPageRelative(rect.left - pageRect.left, pageScale),
      y: toPageRelative(rect.top - pageRect.top, pageScale),
      width: toPageRelative(rect.width, pageScale),
      height: toPageRelative(rect.height, pageScale)
    })
  }

  // Build final result from raw rects (no pre-merge; only clipper union merges)
  const result: ReaderSelectionOverlayRect[] = []

  for (const [pageNumber, rects] of rectsByPage) {
    for (const rect of rects) {
      result.push({ ...rect, pageNumber })
    }
  }

  return result
}

const collectSelectionOverlayClientRects = (
  range: Range,
  viewerRoot: HTMLElement,
  textElements?: Map<string, { text: IntermediateText; pageNumber: number }>
): DOMRect[] => {
  if (!textElements) return Array.from(range.getClientRects())

  const rects: DOMRect[] = []
  let handledDirectText = false

  const textIdElements = Array.from(
    viewerRoot.querySelectorAll('[data-text-id]')
  )

  textIdElements.forEach((element) => {
    if (!(element instanceof HTMLElement)) return

    const textId = element.getAttribute('data-text-id')
    const record = textId ? textElements.get(textId) : undefined
    if (!record) return

    try {
      if (!range.intersectsNode(element)) return
    } catch {
      return
    }

    handledDirectText = true
    if (isNonSpaceBlankText(record.text.content)) return

    const elementRange = element.ownerDocument.createRange()
    const clippedRange = element.ownerDocument.createRange()
    try {
      elementRange.selectNodeContents(element)
      if (element.contains(range.startContainer)) {
        clippedRange.setStart(range.startContainer, range.startOffset)
      } else {
        clippedRange.setStart(
          elementRange.startContainer,
          elementRange.startOffset
        )
      }

      if (element.contains(range.endContainer)) {
        clippedRange.setEnd(range.endContainer, range.endOffset)
      } else {
        clippedRange.setEnd(elementRange.endContainer, elementRange.endOffset)
      }

      const clippedRects =
        typeof clippedRange.getClientRects === 'function'
          ? Array.from(clippedRange.getClientRects())
          : []
      if (clippedRects.length > 0) {
        rects.push(...clippedRects)
        return
      }

      // jsdom 未实现 Range.getClientRects；先尝试原始 Range，再回退到元素边界框。
      const rangeRects =
        typeof range.getClientRects === 'function'
          ? Array.from(range.getClientRects())
          : []
      if (rangeRects.length > 0) {
        rects.push(...rangeRects)
        return
      }

      rects.push(element.getBoundingClientRect())
    } finally {
      elementRange.detach()
      clippedRange.detach()
    }
  })

  // direct-render 文本命中但无有效矩形时（常见于测试环境），使用原始 Range 矩形回退。
  if (handledDirectText && rects.length === 0) {
    return typeof range.getClientRects === 'function'
      ? Array.from(range.getClientRects())
      : rects
  }

  return handledDirectText ? rects : Array.from(range.getClientRects())
}

const getRootOverlayRect = (
  rect: ReaderSelectionOverlayRect,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): ReaderSelectionOverlayRect => {
  const pageElement = getPageElementByPageNumber(
    rect.pageNumber,
    viewerRoot,
    pageRefs
  )
  if (!pageElement) return rect

  const pageRect = pageElement.getBoundingClientRect()
  const rootRect = viewerRoot.getBoundingClientRect()
  const rootScale = getElementViewportScale(viewerRoot)

  return {
    ...rect,
    x:
      toPageRelative(
        pageRect.left - rootRect.left + viewerRoot.scrollLeft,
        rootScale
      ) + rect.x,
    y:
      toPageRelative(
        pageRect.top - rootRect.top + viewerRoot.scrollTop,
        rootScale
      ) + rect.y
  }
}

const isDecodedHtmlParserPage = (
  pageNumber: number,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): boolean => {
  const pageElement = getPageElementByPageNumber(
    pageNumber,
    viewerRoot,
    pageRefs
  )
  return Boolean(pageElement?.classList.contains('hamster-note-page'))
}

// Task 4: 辅助函数，用于收集某页上的矩形，避免在渲染回调中嵌套 filter。
const collectPageRects = (
  rects: ReaderSelectionOverlayRect[],
  pageNumber: number
): ReaderSelectionOverlayRect[] => {
  const pageRects: ReaderSelectionOverlayRect[] = []
  for (const rect of rects) {
    if (rect.pageNumber === pageNumber) {
      pageRects.push(rect)
    }
  }
  return pageRects
}

const escapeSvgAttributeValue = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

// Task 4: 根据解析结果和激活状态生成单个已保存选择 SVG path 字符串。
const buildSavedSelectionOverlayPath = (
  result: ReaderSavedSelectionRestoreResult,
  activeId: string | null,
  pageRects?: ReaderSelectionOverlayRect[]
): string => {
  const rects = pageRects ?? result.rects
  if (rects.length === 0) return ''
  const polygons = rectsToUnionPolygons(rects)
  const d = polygonsToSvgPath(polygons)
  const isFallback = result.status === 'visual-fallback'
  const isActive = result.id === activeId
  const fallbackModifier = isFallback
    ? ' hamster-reader__saved-selection-overlay-path--fallback'
    : ''
  const activeModifier = isActive
    ? ' hamster-reader__saved-selection-overlay-path--active'
    : ''
  const fallbackAttr = isFallback ? ' data-saved-selection-fallback="true"' : ''
  const savedSelectionId = escapeSvgAttributeValue(result.id)
  return `<path class="hamster-reader__saved-selection-overlay-path${fallbackModifier}${activeModifier}" data-saved-selection-id="${savedSelectionId}"${fallbackAttr} fill-rule="evenodd" d="${d}"/>`
}

// Task 4: 为 html-parser 模式构建整份已保存选择 SVG 内容。
const buildSavedSelectionOverlaySvgForHtmlParser = (
  results: ReaderSavedSelectionRestoreResult[],
  activeId: string | null,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): string => {
  const parts: string[] = []
  for (const result of results) {
    if (result.rects.length === 0) continue
    const rootRects: ReaderSelectionOverlayRect[] = []
    for (const rect of result.rects) {
      rootRects.push(getRootOverlayRect(rect, viewerRoot, pageRefs))
    }
    parts.push(buildSavedSelectionOverlayPath(result, activeId, rootRects))
  }
  return `<svg class="hamster-reader__saved-selection-overlay-svg" width="100%" height="100%">${parts.join('')}</svg>`
}

// Task 4: 为 direct-render 模式构建单页已保存选择 SVG 内容。
const buildSavedSelectionOverlaySvgForDirectPage = (
  results: ReaderSavedSelectionRestoreResult[],
  activeId: string | null,
  pageNumber: number
): string => {
  const parts: string[] = []
  for (const result of results) {
    const pageRects = collectPageRects(result.rects, pageNumber)
    if (pageRects.length === 0) continue
    parts.push(buildSavedSelectionOverlayPath(result, activeId, pageRects))
  }
  return `<svg class="hamster-reader__saved-selection-overlay-svg" width="100%" height="100%">${parts.join('')}</svg>`
}

// Compute one boundary handle anchor point from a Selection's range.
// - 'start' → anchor at the LEFT edge of the collapsed-start rect (handle body
//   renders OUTSIDE/LEFT of selection so it never covers the first character).
// - 'end' → anchor at the RIGHT edge of the collapsed-end rect.
// Always returns page-relative coordinates plus the resolved page number.
const buildBoundaryHandlePosition = (
  range: Range,
  type: 'start' | 'end',
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): {
  x: number
  y: number
  pageNumber: number
  textHeight: number
  hitAreaWidth: number
  hitAreaHeight: number
} | null => {
  const collapsedRange = range.cloneRange()
  if (
    typeof collapsedRange.getClientRects !== 'function' ||
    typeof collapsedRange.getBoundingClientRect !== 'function'
  ) {
    collapsedRange.detach()
    return null
  }
  collapsedRange.collapse(type === 'start')
  const collapsedRects = Array.from(collapsedRange.getClientRects())

  let boundaryRect:
    | DOMRect
    | { left: number; right: number; top: number; bottom: number }
  if (collapsedRects.length === 0) {
    boundaryRect = collapsedRange.getBoundingClientRect()
  } else if (type === 'start') {
    boundaryRect = collapsedRects[0]
  } else {
    boundaryRect = collapsedRects[collapsedRects.length - 1]
  }

  const anchorX = type === 'start' ? boundaryRect.left : boundaryRect.right
  const anchorY = boundaryRect.bottom

  const pageInfo = getPageElementForPoint(
    anchorX,
    anchorY,
    viewerRoot,
    pageRefs
  )
  if (!pageInfo) return null

  // 优先使用 DOMRect 自带的 height；对于合成对象则通过 bottom - top 计算。
  // 当边界矩形高度为 0 或不可用时，回退到现有默认手柄高度 24px，
  // 保证默认手柄仍能用上 18×24 的 SCSS 回退尺寸。
  const rawHeight =
    'height' in boundaryRect
      ? boundaryRect.height
      : boundaryRect.bottom - boundaryRect.top
  const pageScale = getElementViewportScale(pageInfo.pageElement)
  const textHeight = rawHeight > 0 ? toPageRelative(rawHeight, pageScale) : 24
  const hitAreaWidth = textHeight / 2
  const hitAreaHeight = textHeight

  const pageRect = pageInfo.pageElement.getBoundingClientRect()
  return {
    x: toPageRelative(anchorX - pageRect.left, pageScale),
    y: toPageRelative(anchorY - pageRect.top, pageScale),
    pageNumber: pageInfo.pageNumber,
    textHeight,
    hitAreaWidth,
    hitAreaHeight
  }
}

// Assemble per-page handle positions from a selection range, optionally
// computing viewer-root-relative coordinates for html-parser mode where pages
// are not direct ancestors of the overlay layer.
const buildSelectionHandlePositions = (
  range: Range,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>,
  htmlParserOverlayActive: boolean
): Map<
  number,
  { start?: ReaderSelectionHandlePosition; end?: ReaderSelectionHandlePosition }
> => {
  const handlePositions = new Map<
    number,
    {
      start?: ReaderSelectionHandlePosition
      end?: ReaderSelectionHandlePosition
    }
  >()

  const startPosition = buildBoundaryHandlePosition(
    range,
    'start',
    viewerRoot,
    pageRefs
  )
  if (startPosition) {
    const entry = handlePositions.get(startPosition.pageNumber) ?? {}
    entry.start = {
      x: startPosition.x,
      y: startPosition.y,
      pageNumber: startPosition.pageNumber,
      textHeight: startPosition.textHeight,
      hitAreaWidth: startPosition.hitAreaWidth,
      hitAreaHeight: startPosition.hitAreaHeight
    }
    if (
      htmlParserOverlayActive &&
      isDecodedHtmlParserPage(startPosition.pageNumber, viewerRoot, pageRefs)
    ) {
      const rootStart = getRootOverlayRect(
        { ...entry.start, width: 0, height: 0 },
        viewerRoot,
        pageRefs
      )
      entry.start.rootX = rootStart.x
      entry.start.rootY = rootStart.y
    }
    handlePositions.set(startPosition.pageNumber, entry)
  }

  const endPosition = buildBoundaryHandlePosition(
    range,
    'end',
    viewerRoot,
    pageRefs
  )
  if (endPosition) {
    const entry = handlePositions.get(endPosition.pageNumber) ?? {}
    entry.end = {
      x: endPosition.x,
      y: endPosition.y,
      pageNumber: endPosition.pageNumber,
      textHeight: endPosition.textHeight,
      hitAreaWidth: endPosition.hitAreaWidth,
      hitAreaHeight: endPosition.hitAreaHeight
    }
    if (
      htmlParserOverlayActive &&
      isDecodedHtmlParserPage(endPosition.pageNumber, viewerRoot, pageRefs)
    ) {
      const rootEnd = getRootOverlayRect(
        { ...entry.end, width: 0, height: 0 },
        viewerRoot,
        pageRefs
      )
      entry.end.rootX = rootEnd.x
      entry.end.rootY = rootEnd.y
    }
    handlePositions.set(endPosition.pageNumber, entry)
  }

  return handlePositions
}

const buildSavedRectHandlePositions = (
  rects: ReaderSelectionOverlayRect[],
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>,
  htmlParserOverlayActive: boolean
): Map<
  number,
  { start?: ReaderSelectionHandlePosition; end?: ReaderSelectionHandlePosition }
> => {
  const firstRect = rects[0]
  const lastRect = rects[rects.length - 1]
  const handlePositions = new Map<
    number,
    {
      start?: ReaderSelectionHandlePosition
      end?: ReaderSelectionHandlePosition
    }
  >()
  if (!firstRect || !lastRect) return handlePositions

  const addPosition = (
    rect: ReaderSelectionOverlayRect,
    type: 'start' | 'end'
  ) => {
    const textHeight = rect.height > 0 ? rect.height : 24
    const position: ReaderSelectionHandlePosition = {
      x: type === 'start' ? rect.x : rect.x + rect.width,
      y: rect.y + rect.height,
      pageNumber: rect.pageNumber,
      textHeight,
      hitAreaWidth: textHeight / 2,
      hitAreaHeight: textHeight
    }
    if (
      htmlParserOverlayActive &&
      isDecodedHtmlParserPage(rect.pageNumber, viewerRoot, pageRefs)
    ) {
      const rootPosition = getRootOverlayRect(
        { ...position, width: 0, height: 0 },
        viewerRoot,
        pageRefs
      )
      position.rootX = rootPosition.x
      position.rootY = rootPosition.y
    }

    const entry = handlePositions.get(rect.pageNumber) ?? {}
    entry[type] = position
    handlePositions.set(rect.pageNumber, entry)
  }

  addPosition(firstRect, 'start')
  addPosition(lastRect, 'end')
  return handlePositions
}

const getTextTransform = (
  text: RenderableIntermediateText,
  skipRotate?: boolean
) => {
  const transforms: string[] = []

  if (!skipRotate && text.rotate) {
    transforms.push(`rotate(${text.rotate}deg)`)
  }

  if (text.skew) {
    transforms.push(`skewX(${text.skew}deg)`)
  }

  return transforms.length > 0 ? transforms.join(' ') : undefined
}

const getTextBbox = (text: RenderableIntermediateText) => {
  const polygonGeometry = getPolygonTextGeometry(text.polygon)
  const usePolygonGeometry = polygonGeometry !== null

  if (usePolygonGeometry) {
    return {
      x: polygonGeometry.x,
      y: polygonGeometry.y,
      width: polygonGeometry.width,
      height: polygonGeometry.height,
      rotation: polygonGeometry.rotation
    }
  }

  if (text.polygon) {
    return {
      ...getTextBoundingBox(text.polygon),
      rotation: 0
    }
  }

  return {
    x: text.x ?? 0,
    y: text.y ?? 0,
    width: text.width ?? 0,
    height: text.height ?? 0,
    rotation: 0
  }
}

const buildTextSpanStyle = (
  text: RenderableIntermediateText,
  bbox: ReturnType<typeof getTextBbox>
) => {
  const textTransform = getTextTransform(text, !!bbox.rotation)
  const transform = [
    bbox.rotation ? `rotate(${bbox.rotation}deg)` : '',
    textTransform
  ]
    .filter(Boolean)
    .join(' ')

  return {
    position: 'absolute' as const,
    left: Number.isFinite(bbox.x) ? `${bbox.x}px` : '0px',
    top: Number.isFinite(bbox.y) ? `${bbox.y}px` : '0px',
    width:
      Number.isFinite(bbox.width) && bbox.width > 0
        ? `${bbox.width}px`
        : undefined,
    height:
      Number.isFinite(bbox.height) && bbox.height > 0
        ? `${bbox.height}px`
        : undefined,
    fontSize:
      Number.isFinite(text.fontSize) && text.fontSize > 0
        ? `${text.fontSize}px`
        : undefined,
    fontFamily: text.fontFamily || undefined,
    fontWeight: text.fontWeight || undefined,
    fontStyle: text.italic ? 'italic' : undefined,
    color: text.color || undefined,
    lineHeight:
      Number.isFinite(text.lineHeight) && text.lineHeight > 0
        ? `${text.lineHeight}px`
        : undefined,
    transform,
    transformOrigin: 'left top' as const,
    whiteSpace: 'pre' as const
  }
}

const createSetTextsHandler = (
  pageNumber: number,
  texts: IntermediateText[]
) => {
  return (currentTexts: Map<number, IntermediateText[]>) => {
    const nextTexts = new Map(currentTexts)
    nextTexts.set(pageNumber, texts)
    return nextTexts
  }
}

const createSetPageStatusHandler = (
  pageNumber: number,
  status: PageLoadStatus
) => {
  return (currentStatuses: Map<number, PageLoadStatus>) => {
    const nextStatuses = new Map(currentStatuses)
    nextStatuses.set(pageNumber, status)
    return nextStatuses
  }
}

const createSetHtmlPageHandler = (pageNumber: number, html: string) => {
  return (currentPages: Map<number, string>) => {
    const nextPages = new Map(currentPages)
    nextPages.set(pageNumber, html)
    return nextPages
  }
}

const createSetHtmlPageStatusHandler = (
  pageNumber: number,
  status: HtmlPageStatus
) => {
  return (currentStatuses: Map<number, HtmlPageStatus>) => {
    const nextStatuses = new Map(currentStatuses)
    nextStatuses.set(pageNumber, status)
    return nextStatuses
  }
}

const buildSelectedTextSegmentsFromTexts = (
  texts: IntermediateText[],
  selectedText: string,
  pageNumber: number
): ReaderSelectedTextSegment[] => {
  if (selectedText.trim().length === 0) return []

  const exactText = texts.find((text) =>
    (text.content ?? '').includes(selectedText)
  )
  if (exactText) {
    const content = exactText.content ?? ''
    const startCharIndex = content.indexOf(selectedText)
    const endCharIndex = startCharIndex + selectedText.length
    return [
      {
        ...exactText,
        pageNumber,
        selectedText,
        startCharIndex,
        endCharIndex
      }
    ]
  }

  const joinedText = texts.map((text) => text.content ?? '').join('')
  const joinedStart = joinedText.indexOf(selectedText)
  if (joinedStart < 0) {
    const fallbackText = texts[0]
    if (!fallbackText) return []
    return [
      {
        ...fallbackText,
        content: selectedText,
        pageNumber,
        selectedText,
        startCharIndex: 0,
        endCharIndex: selectedText.length
      }
    ]
  }

  const joinedEnd = joinedStart + selectedText.length
  let cursor = 0
  return texts.flatMap((text) => {
    const content = text.content ?? ''
    const textStart = cursor
    const textEnd = cursor + content.length
    cursor = textEnd
    const startCharIndex = Math.max(0, joinedStart - textStart)
    const endCharIndex = Math.min(content.length, joinedEnd - textStart)
    if (endCharIndex <= startCharIndex) return []
    return [
      {
        ...text,
        pageNumber,
        selectedText: content.slice(startCharIndex, endCharIndex),
        startCharIndex,
        endCharIndex
      }
    ]
  })
}

const createSetBaseImageHandler = (
  pageNumber: number,
  baseImage: string | undefined
) => {
  return (currentImages: Map<number, string>) => {
    const nextImages = new Map(currentImages)
    if (baseImage) {
      nextImages.set(pageNumber, baseImage)
    } else {
      nextImages.delete(pageNumber)
    }
    return nextImages
  }
}

const deletePageEntry = <T,>(pageNumber: number) => {
  return (currentEntries: Map<number, T>) => {
    if (!currentEntries.has(pageNumber)) {
      return currentEntries
    }

    const nextEntries = new Map(currentEntries)
    nextEntries.delete(pageNumber)
    return nextEntries
  }
}

const deletePageFromSet = (pageNumber: number) => {
  return (currentPages: Set<number>) => {
    if (!currentPages.has(pageNumber)) {
      return currentPages
    }

    const nextPages = new Set(currentPages)
    nextPages.delete(pageNumber)
    return nextPages
  }
}

const getOcrCacheKey = (
  docId: string,
  pageNumber: number,
  imageSource: string
) => `${docId}::${pageNumber}::${imageSource}`

type PageWithBaseImage = {
  thumbnail?: unknown
  image?: unknown
  getThumbnail?: () => Promise<unknown> | unknown
}

type ImageSourceLike = {
  src?: unknown
}

const getStringBaseImage = (imageSource: unknown) => {
  if (typeof imageSource === 'string' && imageSource.trim()) {
    return imageSource
  }

  if (imageSource && typeof imageSource === 'object') {
    const image = imageSource as ImageSourceLike
    if (typeof image.src === 'string' && image.src.trim()) {
      return image.src
    }
  }

  return undefined
}

const getBaseImageFromPage = async (page: unknown) => {
  if (!page || typeof page !== 'object') {
    return undefined
  }

  const pageWithImage = page as PageWithBaseImage
  const directBaseImage =
    getStringBaseImage(pageWithImage.thumbnail) ??
    getStringBaseImage(pageWithImage.image)

  if (directBaseImage) {
    return directBaseImage
  }

  if (typeof pageWithImage.getThumbnail !== 'function') {
    return undefined
  }

  try {
    return getStringBaseImage(await pageWithImage.getThumbnail())
  } catch {
    return undefined
  }
}

const getImageParserInput = async (imageSource: string) => {
  const response = await fetch(imageSource)
  return response.blob()
}

const prefixOcrTextIds = (texts: IntermediateText[], pageNumber: number) =>
  texts.map((text) => ({
    ...text,
    id: `ocr-${pageNumber}-${text.id}`
  }))

type SelectedTextBodyDragState = {
  active: boolean
  pointerId: number | null
  overlayElement: HTMLElement | null
  payload: ReaderSelectionPayload | null
}

type SelectedTextBodyDragAdapterEntry = {
  adapter: DragSelectionAdapter
  stopActivePointerEvent: (event: Event) => void
}

const emptySelectedTextBodyDragState = (): SelectedTextBodyDragState => ({
  active: false,
  pointerId: null,
  overlayElement: null,
  payload: null
})

const useSelectedTextBodyDrag = ({
  viewerRootRef,
  pageRefs,
  overlayRectsRef,
  onDragSelectedTextStart,
  onDragSelectedTextMove,
  onDragSelectedTextEnd
}: {
  viewerRootRef: { current: HTMLDivElement | null }
  pageRefs: { current: Map<number, HTMLDivElement> }
  overlayRectsRef: { current: ReaderSelectionOverlayRect[] }
  onDragSelectedTextStart?: ReaderSelectedTextDragCallback
  onDragSelectedTextMove?: ReaderSelectedTextDragCallback
  onDragSelectedTextEnd?: ReaderSelectedTextDragCallback
}) => {
  const bodyDragStateRef = useRef<SelectedTextBodyDragState>(
    emptySelectedTextBodyDragState()
  )
  const bodyDragRafIdRef = useRef<number | null>(null)
  const bodyDragAdaptersRef = useRef(
    new Map<HTMLElement, SelectedTextBodyDragAdapterEntry>()
  )
  const beginBodyDragRef = useRef<
    (overlayElement: HTMLElement, clientX: number, clientY: number) => boolean
  >((_overlayElement, _clientX, _clientY) => false)
  const moveBodyDragRef = useRef((_clientX: number, _clientY: number) => {})
  const finishBodyDragRef = useRef((_clientX: number, _clientY: number) => {})
  const bodyDragCallbacksEnabled = Boolean(
    onDragSelectedTextStart || onDragSelectedTextMove || onDragSelectedTextEnd
  )

  const isPointInsideSelectionBody = useCallback(
    (clientX: number, clientY: number) => {
      const viewerRoot = viewerRootRef.current
      if (!viewerRoot || overlayRectsRef.current.length === 0) return false

      const pageInfo = getPageElementForPoint(
        clientX,
        clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pageInfo) return false

      const pageRect = pageInfo.pageElement.getBoundingClientRect()
      const pageScale = getElementViewportScale(pageInfo.pageElement)
      const pageX = clientX - pageRect.left
      const pageY = clientY - pageRect.top

      return overlayRectsRef.current.some((rect) => {
        if (rect.pageNumber !== pageInfo.pageNumber) return false
        const rectX = toScaledViewport(rect.x, pageScale)
        const rectY = toScaledViewport(rect.y, pageScale)
        const rectWidth = toScaledViewport(rect.width, pageScale)
        const rectHeight = toScaledViewport(rect.height, pageScale)
        return (
          pageX >= rectX &&
          pageX <= rectX + rectWidth &&
          pageY >= rectY &&
          pageY <= rectY + rectHeight
        )
      })
    },
    [overlayRectsRef, pageRefs, viewerRootRef]
  )

  const cancelPendingBodyDragMove = useCallback(() => {
    if (bodyDragRafIdRef.current !== null) {
      cancelAnimationFrame(bodyDragRafIdRef.current)
      bodyDragRafIdRef.current = null
    }
  }, [])

  const resetBodyDragState = useCallback(() => {
    bodyDragStateRef.current = emptySelectedTextBodyDragState()
  }, [])

  const beginBodyDrag = useCallback(
    (overlayElement: HTMLElement, clientX: number, clientY: number) => {
      if (!bodyDragCallbacksEnabled) return false
      if (!isPointInsideSelectionBody(clientX, clientY)) return false

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return false

      // Retained as a payload source only: body dragging is initiated by the
      // per-overlay Drag adapter, then reads the current composed Selection to
      // preserve the legacy selected-text drag callback arguments.
      const selection = getSelectionForRoot(viewerRoot)
      if (!selection) return false

      // html-parser native selections are visual-overlay only in this plan.
      // They do not have direct-render text ids, so selected-text drag must not
      // fabricate callback segments from parser DOM text nodes.
      if (
        isHtmlParserSelectionTarget(selection.anchorNode, viewerRoot) ||
        isHtmlParserSelectionTarget(selection.focusNode, viewerRoot)
      ) {
        return false
      }

      const payload = buildSelectionPayload(selection)
      if (!payload) return false

      bodyDragStateRef.current = {
        active: true,
        pointerId: null,
        overlayElement,
        payload
      }

      if (onDragSelectedTextStart) {
        onDragSelectedTextStart(
          payload.selection,
          payload.segments,
          payload.extractedText
        )
      }

      return true
    },
    [
      bodyDragCallbacksEnabled,
      isPointInsideSelectionBody,
      onDragSelectedTextStart,
      viewerRootRef
    ]
  )

  const handleBodyDragMove = useCallback(
    (_clientX: number, _clientY: number) => {
      if (!bodyDragStateRef.current.active) return
      if (!onDragSelectedTextMove || bodyDragRafIdRef.current !== null) return

      bodyDragRafIdRef.current = requestAnimationFrame(() => {
        bodyDragRafIdRef.current = null
        const payload = bodyDragStateRef.current.payload
        if (!bodyDragStateRef.current.active || !payload) return
        onDragSelectedTextMove(
          payload.selection,
          payload.segments,
          payload.extractedText
        )
      })
    },
    [onDragSelectedTextMove]
  )

  const finishBodyDrag = useCallback(
    (_clientX: number, _clientY: number) => {
      const bodyDragState = bodyDragStateRef.current
      if (!bodyDragState.active) return

      cancelPendingBodyDragMove()
      const payload = bodyDragState.payload
      resetBodyDragState()

      if (payload && onDragSelectedTextEnd) {
        onDragSelectedTextEnd(
          payload.selection,
          payload.segments,
          payload.extractedText
        )
      }
    },
    [cancelPendingBodyDragMove, onDragSelectedTextEnd, resetBodyDragState]
  )

  beginBodyDragRef.current = beginBodyDrag
  moveBodyDragRef.current = handleBodyDragMove
  finishBodyDragRef.current = finishBodyDrag

  const handleSelectionOverlayDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (bodyDragCallbacksEnabled) {
        event.preventDefault()
      }
    },
    [bodyDragCallbacksEnabled]
  )

  const destroyBodyDragAdapters = useCallback(() => {
    bodyDragAdaptersRef.current.forEach((entry, element) => {
      // These native pointer listeners are guards, not body-drag lifecycle
      // handlers. Drag owns start/move/end; the guards only stop an already
      // active overlay drag from bubbling into the root text-selection adapter.
      element.removeEventListener('pointerdown', entry.stopActivePointerEvent)
      element.removeEventListener('pointermove', entry.stopActivePointerEvent)
      element.removeEventListener('pointerup', entry.stopActivePointerEvent)
      element.removeEventListener('pointercancel', entry.stopActivePointerEvent)
      entry.adapter.destroy()
    })
    bodyDragAdaptersRef.current.clear()
  }, [])

  useEffect(() => {
    if (!bodyDragCallbacksEnabled) {
      destroyBodyDragAdapters()
      return
    }

    const viewerRoot = viewerRootRef.current
    if (!viewerRoot) {
      destroyBodyDragAdapters()
      return
    }

    const currentOverlayElements = new Set(
      Array.from(
        viewerRoot.querySelectorAll<HTMLElement>(
          '.hamster-reader__selection-overlay'
        )
      )
    )

    bodyDragAdaptersRef.current.forEach((entry, element) => {
      if (currentOverlayElements.has(element)) return

      // Stale overlay guards are lifecycle cleanup for Drag-owned body drags;
      // they do not initiate selection.
      element.removeEventListener('pointerdown', entry.stopActivePointerEvent)
      element.removeEventListener('pointermove', entry.stopActivePointerEvent)
      element.removeEventListener('pointerup', entry.stopActivePointerEvent)
      element.removeEventListener('pointercancel', entry.stopActivePointerEvent)
      entry.adapter.destroy()
      bodyDragAdaptersRef.current.delete(element)
    })

    currentOverlayElements.forEach((element) => {
      if (bodyDragAdaptersRef.current.has(element)) return

      const adapter = createDragSelectionAdapter(element, {
        onStart: (clientX, clientY) => {
          beginBodyDragRef.current(element, clientX, clientY)
        },
        onMove: (clientX, clientY) => {
          moveBodyDragRef.current(clientX, clientY)
        },
        onEnd: (clientX, clientY) => {
          finishBodyDragRef.current(clientX, clientY)
        },
        onAllEnd: (clientX, clientY) => {
          finishBodyDragRef.current(clientX, clientY)
        }
      })
      // Guard only: registered after the Drag adapter so Drag observes the
      // pointer first, then native propagation is suppressed while active.
      const stopActivePointerEvent = (event: Event) => {
        if (!bodyDragStateRef.current.active) return

        event.preventDefault()
        event.stopPropagation()
      }

      element.addEventListener('pointerdown', stopActivePointerEvent)
      element.addEventListener('pointermove', stopActivePointerEvent)
      element.addEventListener('pointerup', stopActivePointerEvent)
      element.addEventListener('pointercancel', stopActivePointerEvent)
      bodyDragAdaptersRef.current.set(element, {
        adapter,
        stopActivePointerEvent
      })
    })
  })

  useEffect(
    () => () => {
      cancelPendingBodyDragMove()
      resetBodyDragState()
      destroyBodyDragAdapters()
    },
    [cancelPendingBodyDragMove, destroyBodyDragAdapters, resetBodyDragState]
  )

  const overlayBodyDragProps = useMemo(
    () =>
      bodyDragCallbacksEnabled
        ? {
            onDragStart: handleSelectionOverlayDragStart
          }
        : {},
    [bodyDragCallbacksEnabled, handleSelectionOverlayDragStart]
  )

  const overlayBodyDragStyle = useMemo<React.CSSProperties>(
    () =>
      bodyDragCallbacksEnabled
        ? { pointerEvents: 'auto', touchAction: 'none' }
        : {},
    [bodyDragCallbacksEnabled]
  )

  return {
    bodyDragCallbacksEnabled,
    overlayBodyDragProps,
    overlayBodyDragStyle
  }
}

export function IntermediateDocumentViewer({
  document,
  serializedDocument,
  className,
  overscan = 1,
  pageRange,
  renderMode = 'html-parser',
  backgroundQuality,
  ocr,
  onOcrError,
  onTextSelectionChange,
  onTextSelectionEnd,
  onSelectText,
  onDragSelectedTextStart,
  onDragSelectedTextMove,
  onDragSelectedTextEnd,
  selectionOverlay,
  selectionHandleElement,
  savedSelections,
  activeSavedSelectionId,
  onActiveSavedSelectionChange,
  onSavedSelectionEdit,
  onSavedSelectionRestore,
  scale,
  defaultScale,
  onScaleChange,
  minScale,
  maxScale,
  maxLoadedPages,
  interactionMode = 'default'
}: IntermediateDocumentViewerProps) {
  const runtimeDocument = useMemo(() => {
    const inputDocument = document ?? serializedDocument
    return getRuntimeDocument(inputDocument)
  }, [document, serializedDocument])

  const pageNumbers = useMemo(() => {
    const allPageNumbers = runtimeDocument?.pageNumbers ?? []
    return getVisiblePageNumbers(allPageNumbers, pageRange)
  }, [runtimeDocument, pageRange])
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const loadingPagesRef = useRef(new Set<number>())
  const ocrLoadingPagesRef = useRef(new Set<number>())
  const ocrCacheRef = useRef(new Map<string, IntermediateText[]>())
  const evictedOcrPagesRef = useRef(new Set<number>())
  const activeDocumentRef = useRef<IntermediateDocument | null>(null)
  const isMountedRef = useRef(false)
  const viewerRootRef = useRef<HTMLDivElement>(null)
  const [viewerRootElement, setViewerRootElement] =
    useState<HTMLDivElement | null>(null)

  const maxLoadedPagesRef = useRef(maxLoadedPages)
  maxLoadedPagesRef.current = maxLoadedPages
  // 交互模式 ref，供后续手势逻辑读取（Wave 1 仅透传，不做行为分支）
  const interactionModeRef = useRef(interactionMode)
  interactionModeRef.current = interactionMode

  const scaleRange = useMemo(
    () => getEffectiveScaleRange(minScale, maxScale),
    [minScale, maxScale]
  )
  const [paperTransform, setPaperTransform] = useState<VirtualPaperTransform>(
    () => ({
      x: 0,
      y: 0,
      scale: clampScale(
        defaultScale ?? 1,
        getEffectiveScaleRange(minScale, maxScale)
      )
    })
  )

  const effectiveScale = useMemo(
    () => clampScale(scale ?? paperTransform.scale, scaleRange),
    [scale, paperTransform.scale, scaleRange]
  )
  const effectiveScaleRef = useRef(effectiveScale)
  effectiveScaleRef.current = effectiveScale

  const virtualPaperTransform = useMemo<VirtualPaperTransform>(
    () => ({
      x: paperTransform.x,
      y: paperTransform.y,
      scale: effectiveScale
    }),
    [effectiveScale, paperTransform.x, paperTransform.y]
  )

  const textElementsRef = useRef<
    Map<string, { text: IntermediateText; pageNumber: number }>
  >(new Map())
  const boundedDirectRenderPayloadsRef = useRef(
    new WeakMap<ReaderTextSelectionDetail, ReaderSelectionPayload>()
  )
  const activeMouseSelectionRef = useRef<ActiveMouseSelectionState>({
    active: false,
    startClientX: 0,
    startClientY: 0,
    clientX: 0,
    clientY: 0,
    startPagePercentX: 0,
    startPagePercentY: 0,
    pageNumber: null,
    pageElement: null,
    startNode: null,
    startOffset: 0,
    startCaret: null,
    endNode: null,
    endOffset: 0,
    lastTextElement: null,
    lastCaret: null,
    finalized: false
  })
  const strictMouseSelectionRef = useRef(false)
  const finishDragSelectionRef = useRef(
    (_clientX: number, _clientY: number): void => {}
  )
  const dragPreviewSessionRef = useRef<DragPreviewSession>(
    createDragPreviewSession()
  )
  const [dragPreviewState, setDragPreviewState] =
    useState<DragPreviewState>('idle')
  const dragPreviewStateRef = useRef<DragPreviewState>('idle')
  const dragSelectionAnchorRef = useRef<{
    node: Node
    offset: number
    previewRect: DragPreviewRect
  } | null>(null)
  const longPressSessionRef = useRef<LongPressSession | null>(null)
  const pointerTypesByIdRef = useRef(new Map<number, string>())
  const pointerTextTargetsByIdRef = useRef(new Map<number, boolean>())
  const dragSelectionEndEmittedRef = useRef(false)
  const skipNextMouseUpSelectionEndRef = useRef(false)
  const lastDragComposedSelectionRef = useRef<{
    selection: Selection
    selectedText: string
  } | null>(null)
  const ignoreNextBlankClickRef = useRef(false)
  const dragStateRef = useRef<{
    active: boolean
    handleType: 'start' | 'end' | null
    source: 'live' | 'saved'
    fixedPoint: { x: number; y: number; pageNumber: number } | null
    fixedAnchor: { node: Node; offset: number } | null
  }>({
    active: false,
    handleType: null,
    source: 'live',
    fixedPoint: null,
    fixedAnchor: null
  })
  const savedHandleDragContextRef = useRef<{
    id: string
    previousSelection: ReaderSavedSelection
  } | null>(null)
  const [loadablePages, setLoadablePages] = useState(() => new Set<number>())
  const loadablePagesRef = useRef(loadablePages)
  const [visiblePages, setVisiblePages] = useState(() => new Set<number>())
  const pageLastVisibleAtRef = useRef(new Map<number, number>())
  const evictionTimerRef = useRef<
    ReturnType<typeof requestIdleCallback> | number | null
  >(null)
  const activePinchRef = useRef(false)
  const multiPointerLockedRef = useRef(false)
  const lastKnownVisiblePagesRef = useRef(new Set<number>())
  const pinnedPagesRef = useRef(new Set<number>())
  const [textsByPageNumber, setTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  const [ocrTextsByPageNumber, setOcrTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  const [pageStatuses, setPageStatuses] = useState(
    () => new Map<number, PageLoadStatus>()
  )
  const [baseImagesByPageNumber, setBaseImagesByPageNumber] = useState(
    () => new Map<number, string>()
  )
  const [htmlPagesByPageNumber, setHtmlPagesByPageNumber] = useState(
    () => new Map<number, string>()
  )
  const htmlPagesByPageNumberRef = useRef(htmlPagesByPageNumber)
  htmlPagesByPageNumberRef.current = htmlPagesByPageNumber
  const [htmlPageStatusesByPageNumber, setHtmlPageStatusesByPageNumber] =
    useState(() => new Map<number, HtmlPageStatus>())
  const htmlPageStatusesByPageNumberRef = useRef(htmlPageStatusesByPageNumber)
  htmlPageStatusesByPageNumberRef.current = htmlPageStatusesByPageNumber
  const decodingPageNumbersRef = useRef(new Set<number>())
  const decodeGenerationRef = useRef(0)
  const decodeResetInputsRef = useRef({
    runtimeDocument,
    renderMode,
    backgroundQuality
  })
  // htmlContent is now a stable mode flag for legacy selection/overlay branches;
  // actual html-parser markup lives in per-page lazy decode maps.
  const htmlContent =
    renderMode === 'direct' ? null : 'html-parser-output-active'
  const htmlParserError = false
  const overlayRectsRef = useRef<ReaderSelectionOverlayRect[]>([])
  const overlayContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  // 记录所有曾出现过的 overlay 容器，便于 React 卸载后仍能清理孤立 DOM 节点
  const allOverlayContainersRef = useRef<Set<HTMLElement>>(new Set())
  const overlayElRef = useRef<HTMLDivElement | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const preserveOverlayDuringMouseUpRef = useRef(false)
  const ignoreHtmlParserSelectionRefreshRef = useRef(false)
  const htmlParserStoredSelectionRangeRef = useRef<Range | null>(null)
  const htmlParserStoredSelectionSnapshotRef =
    useRef<TextSelectionSnapshot | null>(null)
  // T6 选择手柄位置：每页记录 start/end 两个手柄坐标（页面相对坐标）。
  // 当 selection 落在该页时填入对应位置；否则该页无手柄渲染。
  const [selectionHandlePositions, setSelectionHandlePositions] = useState<
    Map<
      number,
      {
        start?: ReaderSelectionHandlePosition
        end?: ReaderSelectionHandlePosition
      }
    >
  >(() => new Map())

  // Task 4: 已保存选择覆盖层状态。
  // 支持受控与非受控两种模式：当调用方传入 activeSavedSelectionId 时，
  // 组件完全遵循该 prop；否则使用内部状态维护当前激活选择。
  const isControlledActiveSavedSelection = activeSavedSelectionId !== undefined
  const [internalActiveSavedSelectionId, setInternalActiveSavedSelectionId] =
    useState<string | null>(null)
  const effectiveActiveSavedSelectionId = isControlledActiveSavedSelection
    ? activeSavedSelectionId
    : internalActiveSavedSelectionId

  // 已保存选择的解析结果（按 id 索引），在 mount/update 时计算并缓存。
  const resolvedSavedSelectionsRef = useRef<
    Map<string, ReaderSavedSelectionRestoreResult>
  >(new Map())
  // 已保存选择覆盖层容器：direct 模式每页一个，html-parser 模式一个根容器。
  const savedOverlayContainerRefs = useRef<Map<number, HTMLDivElement>>(
    new Map()
  )
  const savedOverlayElRef = useRef<HTMLDivElement | null>(null)
  // 已保存选择手柄位置，仅当某个已解析选择被激活时才有值。
  const [savedSelectionHandlePositions, setSavedSelectionHandlePositions] =
    useState<
      Map<
        number,
        {
          start?: ReaderSelectionHandlePosition
          end?: ReaderSelectionHandlePosition
        }
      >
    >(() => new Map())
  // 用于在文本/page DOM 变化时触发已保存选择重新解析的版本计数器。
  const [savedSelectionDomVersion, setSavedSelectionDomVersion] = useState(0)

  const overlayOptions = useMemo(
    () => getSelectionOverlayOptions(selectionOverlay),
    [selectionOverlay]
  )
  const selectionHandleAdapterKey = useMemo(
    () =>
      Array.from(selectionHandlePositions.entries())
        .flatMap(([pageNumber, entry]) => [
          entry.start ? `${pageNumber}:start` : '',
          entry.end ? `${pageNumber}:end` : ''
        ])
        .filter(Boolean)
        .join('|'),
    [selectionHandlePositions]
  )
  const savedSelectionHandleAdapterKey = useMemo(
    () =>
      Array.from(savedSelectionHandlePositions.entries())
        .flatMap(([pageNumber, entry]) => [
          entry.start ? `${pageNumber}:saved-start` : '',
          entry.end ? `${pageNumber}:saved-end` : ''
        ])
        .filter(Boolean)
        .join('|'),
    [savedSelectionHandlePositions]
  )

  const buildSavedSelectionEditPageSizes = useCallback(
    (
      segments: ReaderSelectedTextSegment[],
      rects: ReaderSelectionOverlayRect[]
    ) => {
      const pageSizeMap = new Map<number, { width: number; height: number }>()
      if (!runtimeDocument) return pageSizeMap

      const pageNumbersForEdit = new Set<number>()
      for (const segment of segments) {
        pageNumbersForEdit.add(segment.pageNumber ?? 1)
      }
      for (const rect of rects) {
        pageNumbersForEdit.add(rect.pageNumber)
      }

      for (const pageNumber of pageNumbersForEdit) {
        const pageSize = normalizePageSize(
          runtimeDocument.getPageSizeByPageNumber(pageNumber)
        )
        pageSizeMap.set(pageNumber, {
          width: pageSize.width,
          height: pageSize.height
        })
      }

      return pageSizeMap
    },
    [runtimeDocument]
  )
  const {
    bodyDragCallbacksEnabled,
    overlayBodyDragProps,
    overlayBodyDragStyle
  } = useSelectedTextBodyDrag({
    viewerRootRef,
    pageRefs,
    overlayRectsRef,
    onDragSelectedTextStart,
    onDragSelectedTextMove,
    onDragSelectedTextEnd
  })

  useEffect(() => {
    const currentPageNumbers = new Set(pageNumbers)

    pinnedPagesRef.current.clear()
    activePinchRef.current = false
    multiPointerLockedRef.current = false
    pageLastVisibleAtRef.current.forEach((_lastVisibleAt, pageNumber) => {
      if (!currentPageNumbers.has(pageNumber)) {
        pageLastVisibleAtRef.current.delete(pageNumber)
      }
    })
    lastKnownVisiblePagesRef.current.forEach((pageNumber) => {
      if (!currentPageNumbers.has(pageNumber)) {
        lastKnownVisiblePagesRef.current.delete(pageNumber)
      }
    })
  }, [pageNumbers])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      activeDocumentRef.current = null
    }
  }, [])

  useEffect(() => {
    activeDocumentRef.current = runtimeDocument
    decodeGenerationRef.current += 1
    loadingPagesRef.current.clear()
    ocrLoadingPagesRef.current.clear()
    decodingPageNumbersRef.current.clear()
    ocrCacheRef.current.clear()
    evictedOcrPagesRef.current.clear()
    setLoadablePages(new Set())
    setVisiblePages(new Set())
    setTextsByPageNumber(new Map())
    setOcrTextsByPageNumber(new Map())
    setPageStatuses(new Map())
    setBaseImagesByPageNumber(new Map())
    setHtmlPagesByPageNumber(new Map())
    setHtmlPageStatusesByPageNumber(new Map())
  }, [runtimeDocument])

  const bumpDecodeGeneration = useCallback(() => {
    decodeGenerationRef.current += 1
    decodingPageNumbersRef.current.clear()
    return decodeGenerationRef.current
  }, [])

  const isCurrentDecodeGeneration = useCallback(
    (generation: number) => generation === decodeGenerationRef.current,
    []
  )

  const setViewerRootRef = useCallback((element: HTMLDivElement | null) => {
    viewerRootRef.current = element
    setViewerRootElement(element)
  }, [])

  const handleVirtualPaperTransform = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      const clampedScale = clampScale(nextTransform.scale, scaleRange)
      const isControlledScale = scale !== undefined
      const nextStoredTransform = {
        x: nextTransform.x,
        y: nextTransform.y,
        scale: isControlledScale ? effectiveScaleRef.current : clampedScale
      }
      const source = getScaleChangeSource(meta.source)
      const isTwoFingerGesture =
        meta.source === VirtualPaperInteractionMode.TouchTwoFingerZoom ||
        meta.source === VirtualPaperInteractionMode.TouchTwoFingerPan

      setPaperTransform(nextStoredTransform)

      if (isTwoFingerGesture && meta.phase !== 'end') {
        activePinchRef.current = true
        multiPointerLockedRef.current = true
      }
      if (meta.phase === 'end') {
        activePinchRef.current = false
        multiPointerLockedRef.current = false
      }

      if (clampedScale === effectiveScaleRef.current) return

      onScaleChange?.(
        clampedScale,
        meta.focalPoint ? { source, focalPoint: meta.focalPoint } : { source }
      )
    },
    [onScaleChange, scale, scaleRange]
  )

  const handleVirtualPaperTransformChange = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      handleVirtualPaperTransform(nextTransform, meta)
    },
    [handleVirtualPaperTransform]
  )

  const handleVirtualPaperTransformChangeEnd = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      handleVirtualPaperTransform(nextTransform, meta)
    },
    [handleVirtualPaperTransform]
  )

  useEffect(() => {
    const shouldResetDecode =
      decodeResetInputsRef.current.runtimeDocument !== runtimeDocument ||
      decodeResetInputsRef.current.renderMode !== renderMode ||
      decodeResetInputsRef.current.backgroundQuality !== backgroundQuality

    if (shouldResetDecode) {
      const nextHtmlPages = new Map<number, string>()
      const nextHtmlPageStatuses = new Map<number, HtmlPageStatus>()
      decodeResetInputsRef.current = {
        runtimeDocument,
        renderMode,
        backgroundQuality
      }
      bumpDecodeGeneration()
      htmlPagesByPageNumberRef.current = nextHtmlPages
      htmlPageStatusesByPageNumberRef.current = nextHtmlPageStatuses
      setHtmlPagesByPageNumber(nextHtmlPages)
      setHtmlPageStatusesByPageNumber(nextHtmlPageStatuses)
    }

    if (!runtimeDocument || renderMode === 'direct') {
      if (!shouldResetDecode) {
        const nextHtmlPages = new Map<number, string>()
        const nextHtmlPageStatuses = new Map<number, HtmlPageStatus>()
        htmlPagesByPageNumberRef.current = nextHtmlPages
        htmlPageStatusesByPageNumberRef.current = nextHtmlPageStatuses
        setHtmlPagesByPageNumber(nextHtmlPages)
        setHtmlPageStatusesByPageNumber(nextHtmlPageStatuses)
      }
      return
    }

    const generation = decodeGenerationRef.current
    const decodeOptions = buildHtmlParserDecodeOptions(backgroundQuality)

    loadablePages.forEach((pageNumber) => {
      if (
        htmlPagesByPageNumberRef.current.has(pageNumber) ||
        htmlPageStatusesByPageNumberRef.current.get(pageNumber) ===
          'fallback' ||
        decodingPageNumbersRef.current.has(pageNumber)
      ) {
        return
      }

      let pagePromise: ReturnType<IntermediateDocument['getPageByPageNumber']>

      try {
        pagePromise = runtimeDocument.getPageByPageNumber(pageNumber)
      } catch {
        setHtmlPageStatusesByPageNumber(
          createSetHtmlPageStatusHandler(pageNumber, 'fallback')
        )
        return
      }

      if (!pagePromise) {
        setHtmlPageStatusesByPageNumber(
          createSetHtmlPageStatusHandler(pageNumber, 'fallback')
        )
        return
      }

      decodingPageNumbersRef.current.add(pageNumber)
      pagePromise
        .then((page) => {
          if (!page) return ''
          return HtmlParser.decodePageToHtml(
            page as unknown as HtmlParserPageInput,
            decodeOptions
          )
        })
        .then((html) => {
          if (!isCurrentDecodeGeneration(generation)) {
            return
          }

          if (html.trim().length === 0) {
            setHtmlPageStatusesByPageNumber(
              createSetHtmlPageStatusHandler(pageNumber, 'fallback')
            )
            return
          }

          setHtmlPagesByPageNumber(createSetHtmlPageHandler(pageNumber, html))
          setHtmlPageStatusesByPageNumber(
            createSetHtmlPageStatusHandler(pageNumber, 'decoded')
          )
        })
        .catch(() => {
          if (!isCurrentDecodeGeneration(generation)) {
            return
          }

          setHtmlPageStatusesByPageNumber(
            createSetHtmlPageStatusHandler(pageNumber, 'fallback')
          )
        })
        .finally(() => {
          if (isCurrentDecodeGeneration(generation)) {
            decodingPageNumbersRef.current.delete(pageNumber)
          }
        })
    })
  }, [
    runtimeDocument,
    renderMode,
    backgroundQuality,
    loadablePages,
    bumpDecodeGeneration,
    isCurrentDecodeGeneration
  ])

  const markLoadableWithOverscan = useCallback(
    (pageNumber: number) => {
      const pageIndex = pageNumbers.indexOf(pageNumber)

      if (pageIndex === -1) {
        return
      }

      const safeOverscan = Math.max(0, overscan)
      const startIndex = Math.max(0, pageIndex - safeOverscan)
      const endIndex = Math.min(
        pageNumbers.length - 1,
        pageIndex + safeOverscan
      )

      setLoadablePages((currentPages) => {
        const nextPages = new Set(currentPages)

        for (let index = startIndex; index <= endIndex; index += 1) {
          nextPages.add(pageNumbers[index])
        }

        return nextPages
      })
    },
    [overscan, pageNumbers]
  )

  const evictPageBundle = useCallback(
    (pageNumber: number) => {
      if (!runtimeDocument) {
        return false
      }

      if (
        loadingPagesRef.current.has(pageNumber) ||
        ocrLoadingPagesRef.current.has(pageNumber) ||
        decodingPageNumbersRef.current.has(pageNumber)
      ) {
        return false
      }

      const cacheKeyPrefix = `${runtimeDocument.id}::${pageNumber}::`
      ocrCacheRef.current.forEach((_texts, cacheKey) => {
        if (cacheKey.startsWith(cacheKeyPrefix)) {
          ocrCacheRef.current.delete(cacheKey)
        }
      })
      evictedOcrPagesRef.current.add(pageNumber)

      pageLastVisibleAtRef.current.delete(pageNumber)
      lastKnownVisiblePagesRef.current.delete(pageNumber)
      setTextsByPageNumber(deletePageEntry(pageNumber))
      setOcrTextsByPageNumber(deletePageEntry(pageNumber))
      setBaseImagesByPageNumber(deletePageEntry(pageNumber))
      setPageStatuses(deletePageEntry(pageNumber))
      setLoadablePages(deletePageFromSet(pageNumber))
      setHtmlPagesByPageNumber(deletePageEntry(pageNumber))
      setHtmlPageStatusesByPageNumber(deletePageEntry(pageNumber))
      setSavedSelectionDomVersion((version) => version + 1)
      return true
    },
    [runtimeDocument]
  )

  const resolveProtectedPageNumberForNode = useCallback((node: Node | null) => {
    if (!node) return null

    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
    const pageElement = element?.closest('[data-page-number]')
    const pageNumberAttribute = pageElement?.getAttribute('data-page-number')
    if (pageNumberAttribute) {
      const pageNumber = Number(pageNumberAttribute)
      if (Number.isFinite(pageNumber)) return pageNumber
    }

    for (const [pageNumber, pageRef] of pageRefs.current.entries()) {
      if (pageRef.contains(node)) return pageNumber
    }

    return null
  }, [])

  const addProtectedPageRange = useCallback(
    (
      protectedPages: Set<number>,
      startPageNumber: number,
      endPageNumber: number
    ) => {
      const startIndex = pageNumbers.indexOf(startPageNumber)
      const endIndex = pageNumbers.indexOf(endPageNumber)

      if (startIndex === -1 || endIndex === -1) {
        protectedPages.add(startPageNumber)
        protectedPages.add(endPageNumber)
        return
      }

      const minIndex = Math.min(startIndex, endIndex)
      const maxIndex = Math.max(startIndex, endIndex)
      for (let index = minIndex; index <= maxIndex; index += 1) {
        protectedPages.add(pageNumbers[index])
      }
    },
    [pageNumbers]
  )

  const getProtectedPages = useCallback(() => {
    const protectedPages = new Set<number>()
    const currentVisiblePages =
      visiblePages.size > 0 ? visiblePages : lastKnownVisiblePagesRef.current

    currentVisiblePages.forEach((pageNumber) => {
      protectedPages.add(pageNumber)
    })

    const safeOverscan = Math.max(0, overscan)
    currentVisiblePages.forEach((pageNumber) => {
      const pageIndex = pageNumbers.indexOf(pageNumber)
      if (pageIndex === -1) return

      const startIndex = Math.max(0, pageIndex - safeOverscan)
      const endIndex = Math.min(
        pageNumbers.length - 1,
        pageIndex + safeOverscan
      )
      for (let index = startIndex; index <= endIndex; index += 1) {
        protectedPages.add(pageNumbers[index])
      }
    })

    loadingPagesRef.current.forEach((pageNumber) => {
      protectedPages.add(pageNumber)
    })
    ocrLoadingPagesRef.current.forEach((pageNumber) => {
      protectedPages.add(pageNumber)
    })
    pinnedPagesRef.current.forEach((pageNumber) => {
      protectedPages.add(pageNumber)
    })

    const selection = getSelectionForRoot(viewerRootRef.current)
    if (selection && !selection.isCollapsed) {
      const anchorPageNumber = resolveProtectedPageNumberForNode(
        selection.anchorNode
      )
      const focusPageNumber = resolveProtectedPageNumberForNode(
        selection.focusNode
      )
      if (anchorPageNumber !== null) protectedPages.add(anchorPageNumber)
      if (focusPageNumber !== null) protectedPages.add(focusPageNumber)
      if (anchorPageNumber !== null && focusPageNumber !== null) {
        addProtectedPageRange(protectedPages, anchorPageNumber, focusPageNumber)
      }
    }

    const fixedPoint = dragStateRef.current.fixedPoint
    if (fixedPoint) {
      protectedPages.add(fixedPoint.pageNumber)
    }

    for (const result of resolvedSavedSelectionsRef.current.values()) {
      protectedPages.add(result.selection.start.pageNumber)
      protectedPages.add(result.selection.end.pageNumber)
      result.selection.segments.forEach((segment) => {
        protectedPages.add(segment.pageNumber)
      })
      result.segments.forEach((segment) => {
        protectedPages.add(segment.pageNumber)
      })
      result.rects.forEach((rect) => {
        protectedPages.add(rect.pageNumber)
      })
    }

    return protectedPages
  }, [
    addProtectedPageRange,
    overscan,
    pageNumbers,
    resolveProtectedPageNumberForNode,
    visiblePages
  ])

  const scheduleEviction = useCallback(
    (snapshot: { visiblePages: Set<number>; pageNumbers: number[] }) => {
      if (evictionTimerRef.current !== null) {
        return
      }

      const knownPageNumbers = new Set(snapshot.pageNumbers)
      snapshot.visiblePages.forEach((pageNumber) => {
        knownPageNumbers.add(pageNumber)
      })
      const initialProtectedPages = getProtectedPages()

      const initialCap = getEffectiveMaxLoadedPages(
        maxLoadedPages,
        overscan,
        initialProtectedPages.size
      )

      if (!Number.isFinite(initialCap)) {
        return
      }

      const run = () => {
        evictionTimerRef.current = null
        if (dragPreviewStateRef.current !== 'idle' || activePinchRef.current) {
          evictionTimerRef.current = window.setTimeout(run, 50)
          return
        }

        pageLastVisibleAtRef.current.forEach((_lastVisibleAt, pageNumber) => {
          if (!knownPageNumbers.has(pageNumber)) {
            pageLastVisibleAtRef.current.delete(pageNumber)
          }
        })
        lastKnownVisiblePagesRef.current.forEach((pageNumber) => {
          if (!knownPageNumbers.has(pageNumber)) {
            lastKnownVisiblePagesRef.current.delete(pageNumber)
          }
        })

        const cap = getEffectiveMaxLoadedPages(
          maxLoadedPages,
          overscan,
          getProtectedPages().size
        )

        if (!Number.isFinite(cap)) {
          return
        }

        // Read current loaded pages from the ref so the async closure always
        // sees the latest set, not the snapshot captured at schedule time.
        const loadedPages = Array.from(loadablePagesRef.current).filter(
          (pageNumber) => knownPageNumbers.has(pageNumber)
        )

        if (loadedPages.length <= cap) {
          return
        }

        const protectedPages = getProtectedPages()
        const evictionCandidates = loadedPages
          .filter((pageNumber) => !protectedPages.has(pageNumber))
          .sort((leftPageNumber, rightPageNumber) => {
            const leftLastVisibleAt =
              pageLastVisibleAtRef.current.get(leftPageNumber) ?? 0
            const rightLastVisibleAt =
              pageLastVisibleAtRef.current.get(rightPageNumber) ?? 0

            if (leftLastVisibleAt === rightLastVisibleAt) {
              return leftPageNumber - rightPageNumber
            }

            return leftLastVisibleAt - rightLastVisibleAt
          })

        let loadedCount = loadedPages.length
        for (const pageNumber of evictionCandidates) {
          if (loadedCount <= cap) {
            break
          }

          if (evictPageBundle(pageNumber)) {
            loadedCount -= 1
          }
        }
      }

      if (typeof window.requestIdleCallback === 'function') {
        evictionTimerRef.current = window.requestIdleCallback(run, {
          timeout: 200
        })
        return
      }

      evictionTimerRef.current = window.setTimeout(run, 0)
    },
    [evictPageBundle, getProtectedPages, maxLoadedPages, overscan]
  )

  useEffect(() => {
    // Keep the async eviction callback seeing the current loaded page set
    // without adding mutable ref values to the dependency array.
    loadablePagesRef.current = loadablePages
    scheduleEviction({ visiblePages, pageNumbers })

    return () => {
      const timer = evictionTimerRef.current

      if (timer === null) {
        return
      }

      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(timer)
      }

      window.clearTimeout(timer)

      evictionTimerRef.current = null
    }
  }, [loadablePages, pageNumbers, scheduleEviction, visiblePages])

  const setPageRef = useCallback(
    (pageNumber: number) => (element: HTMLDivElement | null) => {
      if (element) {
        pageRefs.current.set(pageNumber, element)
      } else {
        pageRefs.current.delete(pageNumber)
      }
    },
    []
  )

  const setTextRef = useCallback(
    (text: IntermediateText, pageNumber: number) =>
      (element: HTMLSpanElement | null) => {
        if (element) {
          textElementsRef.current.set(text.id, { text, pageNumber })
          textElementRecords.set(element, { text, pageNumber })
        } else {
          textElementsRef.current.delete(text.id)
        }
      },
    []
  )

  const buildNormalizedSelection = useCallback(
    (
      selection: Selection,
      viewerRoot: HTMLElement
    ): ReaderTextSelectionDetail | null => {
      if (!activeMouseSelectionRef.current.active) return null

      const startElement =
        getClosestTextElement(selection.anchorNode) ??
        getClosestTextElement(selection.focusNode)
      if (!startElement) return null

      const startId = startElement.getAttribute('data-text-id')
      if (!startId) return null

      const startEntry = textElementsRef.current.get(startId)
      if (!startEntry) return null

      const pageInfo = getPageElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pageInfo) return null

      const endElement = getNearestTextElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        pageInfo.pageNumber,
        viewerRoot,
        textElementsRef.current
      )
      if (!endElement) return null

      const endId = endElement.getAttribute('data-text-id')
      if (!endId) return null

      const endEntry = textElementsRef.current.get(endId)
      if (!endEntry) return null

      const pageNumber = startEntry.pageNumber

      const allTextElements = Array.from(
        viewerRoot.querySelectorAll('[data-text-id]')
      )

      const startIndex = allTextElements.findIndex(
        (el) => el.getAttribute('data-text-id') === startId
      )
      const endIndex = allTextElements.findIndex(
        (el) => el.getAttribute('data-text-id') === endId
      )
      if (startIndex === -1 || endIndex === -1) return null

      const minIndex = Math.min(startIndex, endIndex)
      const maxIndex = Math.max(startIndex, endIndex)
      const sortedElements = allTextElements.slice(minIndex, maxIndex + 1)

      const texts = sortedElements.flatMap((el) => {
        const id = el.getAttribute('data-text-id')
        if (!id) return []
        const entry = textElementsRef.current.get(id)
        return entry ? [entry.text] : []
      })

      if (texts.length === 0) return null

      return {
        text: texts[0],
        texts,
        selectedText: texts.map((t) => t.content ?? '').join(''),
        pageNumber,
        selection
      }
    },
    []
  )

  const buildSelectionDetailBetweenElements = useCallback(
    (
      selection: Selection,
      viewerRoot: HTMLElement,
      startElement: HTMLElement,
      endElement: HTMLElement
    ): ReaderTextSelectionDetail | null => {
      const startId = startElement.getAttribute('data-text-id')
      const endId = endElement.getAttribute('data-text-id')
      if (!startId || !endId) return null

      const startEntry = textElementsRef.current.get(startId)
      const endEntry = textElementsRef.current.get(endId)
      if (!startEntry || !endEntry) return null

      const allTextElements = Array.from(
        viewerRoot.querySelectorAll('[data-text-id]')
      )
      const startIndex = allTextElements.findIndex(
        (el) => el.getAttribute('data-text-id') === startId
      )
      const endIndex = allTextElements.findIndex(
        (el) => el.getAttribute('data-text-id') === endId
      )
      if (startIndex === -1 || endIndex === -1) return null

      const minIndex = Math.min(startIndex, endIndex)
      const maxIndex = Math.max(startIndex, endIndex)
      const sortedElements = allTextElements.slice(minIndex, maxIndex + 1)
      const orderedEntries = sortedElements.flatMap((el) => {
        const id = el.getAttribute('data-text-id')
        if (!id) return []
        const entry = textElementsRef.current.get(id)
        return entry ? [entry] : []
      })
      const texts = orderedEntries.map((entry) => entry.text)

      if (texts.length === 0) return null

      const selectedText = texts.map((text) => text.content ?? '').join('')

      const detail = {
        text: texts[0],
        texts,
        selectedText,
        pageNumber: orderedEntries[0].pageNumber,
        selection
      }
      const payload = buildSelectionPayloadFromTexts(selection, texts)
      if (payload) {
        boundedDirectRenderPayloadsRef.current.set(detail, payload)
      }

      return detail
    },
    []
  )

  const buildHtmlParserSelectionPayload = useCallback(
    (selection: Selection): ReaderSelectionPayload | null => {
      if (!htmlContent) return null
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null
      }

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return null
      if (
        !viewerRoot.contains(selection.anchorNode) ||
        !viewerRoot.contains(selection.focusNode)
      ) {
        return null
      }
      if (
        !isHtmlParserSelectionTarget(selection.anchorNode, viewerRoot) &&
        !isHtmlParserSelectionTarget(selection.focusNode, viewerRoot)
      ) {
        return null
      }

      const selectedText = selection.toString()
      if (selectedText.trim().length === 0) return null

      const anchorElement =
        selection.anchorNode instanceof Element
          ? selection.anchorNode
          : selection.anchorNode?.parentElement
      const focusElement =
        selection.focusNode instanceof Element
          ? selection.focusNode
          : selection.focusNode?.parentElement
      const htmlPages = Array.from(
        viewerRoot.querySelectorAll<HTMLElement>('.hamster-note-page')
      )
      const selectionPage =
        anchorElement?.closest('.hamster-note-page') ??
        focusElement?.closest('.hamster-note-page')
      const pageIndex = selectionPage
        ? htmlPages.findIndex((page) => page === selectionPage)
        : -1
      const pageNumber =
        pageIndex >= 0 ? (pageNumbers[pageIndex] ?? pageIndex + 1) : 1
      const pageTexts = textsByPageNumber.get(pageNumber) ?? []
      const fallbackTexts =
        pageTexts.length > 0
          ? pageTexts
          : Array.from(textsByPageNumber.values()).flat()
      const segments = buildSelectedTextSegmentsFromTexts(
        fallbackTexts,
        selectedText,
        pageNumber
      )
      const extractedText = segments
        .map((segment) => segment.selectedText)
        .join('')
      if (segments.length === 0 || extractedText.trim().length === 0) {
        return null
      }

      const range = selection.getRangeAt(0)
      if (
        range.startContainer.nodeType === Node.TEXT_NODE &&
        range.endContainer.nodeType === Node.TEXT_NODE
      ) {
        htmlParserStoredSelectionRangeRef.current = range.cloneRange()
        htmlParserStoredSelectionSnapshotRef.current = {
          startNode: range.startContainer as Text,
          startOffset: range.startOffset,
          endNode: range.endContainer as Text,
          endOffset: range.endOffset
        }
      }

      return { selection, segments, extractedText }
    },
    [htmlContent, pageNumbers, textsByPageNumber]
  )

  const getNearestActiveTextElementForPoint = useCallback(
    (
      point: { clientX: number; clientY: number },
      viewerRoot: HTMLElement
    ): HTMLElement | null => {
      const pageInfo = getPageElementForPoint(
        point.clientX,
        point.clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pageInfo) return null

      return getNearestTextElementForPoint(
        point.clientX,
        point.clientY,
        pageInfo.pageNumber,
        viewerRoot,
        textElementsRef.current
      )
    },
    []
  )

  const buildPointerClampedSelection = useCallback(
    (
      selection: Selection,
      viewerRoot: HTMLElement
    ): ReaderTextSelectionDetail | null => {
      if (!activeMouseSelectionRef.current.active) return null

      const startElement = getNearestActiveTextElementForPoint(
        {
          clientX: activeMouseSelectionRef.current.startClientX,
          clientY: activeMouseSelectionRef.current.startClientY
        },
        viewerRoot
      )
      if (!startElement) return null

      const pointerPageInfo = getPageElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pointerPageInfo) return null

      const snappedFocusElement = getNearestTextElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        pointerPageInfo.pageNumber,
        viewerRoot,
        textElementsRef.current
      )
      if (!snappedFocusElement) return null

      return buildSelectionDetailBetweenElements(
        selection,
        viewerRoot,
        startElement,
        snappedFocusElement
      )
    },
    [buildSelectionDetailBetweenElements, getNearestActiveTextElementForPoint]
  )

  const recomposeActiveTextSelection = useCallback(
    (viewerRoot: HTMLElement): boolean => {
      const activeSelection = activeMouseSelectionRef.current
      if (!activeSelection.active) return false

      const selection = getSelectionForRoot(viewerRoot)
      if (
        !selection ||
        selection.isCollapsed ||
        typeof selection.removeAllRanges !== 'function' ||
        typeof selection.addRange !== 'function'
      ) {
        return false
      }

      const range = selection.getRangeAt(0)
      const startTextElement =
        range.startContainer instanceof Element
          ? range.startContainer.closest('[data-text-id]')
          : range.startContainer.parentElement?.closest('[data-text-id]')
      const endTextElement =
        range.endContainer instanceof Element
          ? range.endContainer.closest('[data-text-id]')
          : range.endContainer.parentElement?.closest('[data-text-id]')
      if (
        startTextElement instanceof HTMLElement &&
        endTextElement instanceof HTMLElement &&
        viewerRoot.contains(startTextElement) &&
        viewerRoot.contains(endTextElement)
      ) {
        return false
      }

      const startCaretInfo = resolveCaret(
        activeSelection.startClientX,
        activeSelection.startClientY,
        {
          viewerRoot,
          pageRefs: pageRefs.current,
          textElements: textElementsRef.current
        }
      )
      const endCaretInfo = resolveCaret(
        activeSelection.clientX,
        activeSelection.clientY,
        {
          viewerRoot,
          pageRefs: pageRefs.current,
          textElements: textElementsRef.current
        }
      )

      if (!startCaretInfo || !endCaretInfo) {
        startCaretInfo?.range.detach()
        endCaretInfo?.range.detach()
        return false
      }

      // 鼠标抬起时把浏览器可能包含的 Page 容器边界重新夹到文字 caret，
      // 保留文本选择结果，但避免 Selection 里残留整页节点。
      const normalizedRange = createOrderedRange(
        startCaretInfo.range.startContainer,
        startCaretInfo.range.startOffset,
        endCaretInfo.range.startContainer,
        endCaretInfo.range.startOffset
      )
      startCaretInfo.range.detach()
      endCaretInfo.range.detach()
      composeSelection(normalizedRange)
      return true
    },
    []
  )

  const composeActiveMouseSelectionFromStoredBoundaries = useCallback(() => {
    const activeSelection = activeMouseSelectionRef.current
    const viewerRoot = viewerRootRef.current
    const startCaret = activeSelection.startCaret
    const endCaret = activeSelection.lastCaret
    if (!viewerRoot || !startCaret || !endCaret) return false

    const writableSelection = getSelectionForRoot(viewerRoot)
    if (
      !writableSelection ||
      typeof writableSelection.removeAllRanges !== 'function' ||
      typeof writableSelection.addRange !== 'function'
    ) {
      return false
    }

    const resolveStoredCaret = (
      caret: MouseSelectionCaret,
      direction: SupportedHitDirection
    ): MouseSelectionCaret | null => {
      if (
        caret.node.isConnected &&
        caret.node.ownerDocument === viewerRoot.ownerDocument &&
        (caret.node instanceof Element
          ? viewerRoot.contains(caret.node)
          : viewerRoot.contains(caret.node.parentElement))
      ) {
        return caret
      }

      const hitElement = viewerRoot.ownerDocument.elementFromPoint?.(
        caret.clientX,
        caret.clientY
      )
      const textElement = hitElement?.closest(SUPPORTED_TEXT_HIT_SELECTOR)
      if (!(textElement instanceof HTMLElement)) return null
      if (!viewerRoot.contains(textElement)) return null
      const recovered =
        getNativeSupportedHitRange(
          caret.clientX,
          caret.clientY,
          textElement,
          viewerRoot.ownerDocument,
          direction
        ) ??
        createSupportedHitFallbackRange(caret.clientX, textElement, direction)
      return {
        node: recovered.node,
        offset: recovered.offset,
        clientX: caret.clientX,
        clientY: caret.clientY
      }
    }

    const resolvedStart = resolveStoredCaret(startCaret, 'forward')
    const resolvedEnd = resolveStoredCaret(endCaret, 'backward')
    if (!resolvedStart || !resolvedEnd) return false

    const range = createOrderedRange(
      resolvedStart.node,
      resolvedStart.offset,
      resolvedEnd.node,
      resolvedEnd.offset
    )
    composeSelection(range)
    if (htmlContentRef.current && !htmlParserErrorRef.current) {
      htmlParserStoredSelectionRangeRef.current = range.cloneRange()
      if (
        resolvedStart.node.nodeType === Node.TEXT_NODE &&
        resolvedEnd.node.nodeType === Node.TEXT_NODE
      ) {
        htmlParserStoredSelectionSnapshotRef.current = {
          startNode: resolvedStart.node as Text,
          startOffset: resolvedStart.offset,
          endNode: resolvedEnd.node as Text,
          endOffset: resolvedEnd.offset
        }
      }
    }
    const handlePositions = buildSelectionHandlePositions(
      range,
      viewerRoot,
      pageRefs.current,
      Boolean(htmlContentRef.current && !htmlParserErrorRef.current)
    )
    setSelectionHandlePositions(handlePositions)
    return true
  }, [])

  const getDirectTextElementForPoint = useCallback(
    (
      point: { clientX: number; clientY: number },
      viewerRoot: HTMLElement
    ): HTMLElement | null => {
      const pointElement = viewerRoot.ownerDocument.elementFromPoint?.(
        point.clientX,
        point.clientY
      )
      const textElement = pointElement?.closest('[data-text-id]')
      return textElement instanceof HTMLElement &&
        viewerRoot.contains(textElement)
        ? textElement
        : null
    },
    []
  )

  const resolveStrictSupportedTextHit = useCallback(
    (
      point: { clientX: number; clientY: number },
      viewerRoot: HTMLElement,
      fallbackElement?: Element | null,
      direction: SupportedHitDirection = 'nearest'
    ): SupportedTextHitCaret | null => {
      const ownerDocument = viewerRoot.ownerDocument
      const pointElement = ownerDocument.elementFromPoint?.(
        point.clientX,
        point.clientY
      )
      const pointTextElement = getSupportedTextElementAtPoint(
        viewerRoot,
        point.clientX,
        point.clientY
      )
      const hitElement =
        pointTextElement ??
        (pointElement &&
        viewerRoot.contains(pointElement) &&
        !isSelectionBackgroundTarget(pointElement) &&
        !pointElement.closest(SELECTION_CHROME_HIT_SELECTOR)
          ? pointElement
          : fallbackElement)
      if (!hitElement) return null
      if (!viewerRoot.contains(hitElement)) return null
      if (isSelectionBackgroundTarget(hitElement)) return null
      if (hitElement.closest(SELECTION_CHROME_HIT_SELECTOR)) return null

      const textElement = hitElement.closest(SUPPORTED_TEXT_HIT_SELECTOR)
      if (!(textElement instanceof HTMLElement)) return null
      if (!viewerRoot.contains(textElement)) return null
      if (isSelectionBackgroundTarget(textElement)) return null

      const pageNumber = getSupportedHitPageNumber(textElement)
      if (pageNumber === null) return null

      const caretDirection: SupportedHitDirection =
        direction !== 'nearest' &&
        activeMouseSelectionRef.current.lastTextElement !== textElement
          ? direction
          : 'nearest'

      const caret =
        getNativeSupportedHitRange(
          point.clientX,
          point.clientY,
          textElement,
          ownerDocument,
          caretDirection
        ) ??
        createSupportedHitFallbackRange(
          point.clientX,
          textElement,
          caretDirection
        )

      return {
        element: textElement,
        node: caret.node,
        offset: caret.offset,
        range: caret.range,
        pageNumber
      }
    },
    []
  )

  const isOverBroadDirectRenderSelection = useCallback(
    (selectedElements: HTMLElement[], viewerRoot: HTMLElement): boolean => {
      const selectedIds = new Set(
        selectedElements.flatMap((element) => {
          const id = element.getAttribute('data-text-id')
          return id ? [id] : []
        })
      )
      const pageTextCounts = new Map<number, number>()
      const selectedPageTextCounts = new Map<number, number>()

      viewerRoot.querySelectorAll('[data-text-id]').forEach((element) => {
        if (!(element instanceof HTMLElement)) return

        const textId = element.getAttribute('data-text-id')
        if (!textId || !textElementsRef.current.has(textId)) return

        const pageNumber = Number(element.getAttribute('data-page-number'))
        if (!Number.isFinite(pageNumber)) return

        pageTextCounts.set(
          pageNumber,
          (pageTextCounts.get(pageNumber) ?? 0) + 1
        )
        if (selectedIds.has(textId)) {
          selectedPageTextCounts.set(
            pageNumber,
            (selectedPageTextCounts.get(pageNumber) ?? 0) + 1
          )
        }
      })

      for (const [pageNumber, pageTextCount] of pageTextCounts) {
        // 单个文本 span 的页面常见且合法；至少 3 个 span 才能代表“页面级”误选。
        if (pageTextCount < 3) continue

        const selectedCount = selectedPageTextCounts.get(pageNumber) ?? 0
        if (selectedCount >= Math.ceil(pageTextCount * 0.9)) {
          return true
        }
      }

      return false
    },
    []
  )

  const hasValidActiveSelectionBoundaries = useCallback(
    (selectedElements: HTMLElement[], viewerRoot: HTMLElement): boolean => {
      if (!activeMouseSelectionRef.current.active) return false

      const firstTextId = selectedElements[0]?.getAttribute('data-text-id')
      const lastTextId =
        selectedElements[selectedElements.length - 1]?.getAttribute(
          'data-text-id'
        )
      if (!firstTextId || !lastTextId) return false

      const startElement = getNearestActiveTextElementForPoint(
        {
          clientX: activeMouseSelectionRef.current.startClientX,
          clientY: activeMouseSelectionRef.current.startClientY
        },
        viewerRoot
      )
      const endElement = getNearestActiveTextElementForPoint(
        {
          clientX: activeMouseSelectionRef.current.clientX,
          clientY: activeMouseSelectionRef.current.clientY
        },
        viewerRoot
      )
      const startTextId = startElement?.getAttribute('data-text-id')
      const endTextId = endElement?.getAttribute('data-text-id')
      const firstPageNumber = Number(selectedElements[0]?.dataset.pageNumber)
      const lastPageNumber = Number(
        selectedElements[selectedElements.length - 1]?.dataset.pageNumber
      )

      if (firstPageNumber === lastPageNumber) {
        const directStartTextId = getDirectTextElementForPoint(
          {
            clientX: activeMouseSelectionRef.current.startClientX,
            clientY: activeMouseSelectionRef.current.startClientY
          },
          viewerRoot
        )?.getAttribute('data-text-id')
        const directEndTextId = getDirectTextElementForPoint(
          {
            clientX: activeMouseSelectionRef.current.clientX,
            clientY: activeMouseSelectionRef.current.clientY
          },
          viewerRoot
        )?.getAttribute('data-text-id')

        return (
          (directStartTextId === firstTextId &&
            directEndTextId === lastTextId) ||
          (directStartTextId === lastTextId && directEndTextId === firstTextId)
        )
      }

      return (
        (startTextId === firstTextId && endTextId === lastTextId) ||
        (startTextId === lastTextId && endTextId === firstTextId)
      )
    },
    [getDirectTextElementForPoint, getNearestActiveTextElementForPoint]
  )

  const shouldRejectOverBroadSelection = useCallback(
    (
      selectedElements: HTMLElement[],
      viewerRoot: HTMLElement,
      firstPageNumber: number,
      lastPageNumber: number
    ): boolean => {
      if (!isOverBroadDirectRenderSelection(selectedElements, viewerRoot)) {
        return false
      }

      if (!activeMouseSelectionRef.current.active) return true

      return (
        firstPageNumber === lastPageNumber &&
        !hasValidActiveSelectionBoundaries(selectedElements, viewerRoot)
      )
    },
    [hasValidActiveSelectionBoundaries, isOverBroadDirectRenderSelection]
  )

  const getSelectionDetail = useCallback(
    (selection: Selection): ReaderTextSelectionDetail | null => {
      if (!selection || selection.isCollapsed) return null

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return null

      const anchorInViewer = viewerRoot.contains(selection.anchorNode)
      const focusInViewer = viewerRoot.contains(selection.focusNode)
      if (!anchorInViewer || !focusInViewer) return null

      // html-parser native ranges intentionally stop at the visual overlay
      // layer. Public text payload contracts stay direct-render-only until the
      // parser can provide stable text ids compatible with saved selections.
      if (
        isHtmlParserSelectionTarget(selection.anchorNode, viewerRoot) ||
        isHtmlParserSelectionTarget(selection.focusNode, viewerRoot)
      ) {
        return null
      }

      const selectedElements: HTMLElement[] = []
      textElementsRef.current.forEach((_, id) => {
        const element = viewerRoot.querySelector(`[data-text-id="${id}"]`)
        if (element && selection.containsNode(element, true)) {
          selectedElements.push(element as HTMLElement)
        }
      })

      if (selectedElements.length === 0) {
        return buildNormalizedSelection(selection, viewerRoot)
      }

      selectedElements.sort((a, b) => {
        const range = a.ownerDocument.createRange()
        range.setStartBefore(a)
        range.setEndBefore(b)
        const order = range.collapsed ? 1 : -1
        range.detach()
        return order
      })

      const firstElement = selectedElements[0]
      const lastElement = selectedElements[selectedElements.length - 1]
      const firstTextId = firstElement.getAttribute('data-text-id')
      const firstPageNumber = Number(
        firstElement.getAttribute('data-page-number')
      )
      const lastPageNumber = Number(
        lastElement.getAttribute('data-page-number')
      )
      if (
        shouldRejectOverBroadSelection(
          selectedElements,
          viewerRoot,
          firstPageNumber,
          lastPageNumber
        )
      ) {
        return null
      }

      if (
        activeMouseSelectionRef.current.active &&
        firstPageNumber !== lastPageNumber
      ) {
        const pointerClampedDetail = buildPointerClampedSelection(
          selection,
          viewerRoot
        )
        if (pointerClampedDetail) return pointerClampedDetail
      }

      if (!firstTextId) return null

      const firstEntry = textElementsRef.current.get(firstTextId)

      if (!firstEntry) return null

      const texts = selectedElements.flatMap((el) => {
        const id = el.getAttribute('data-text-id')

        if (!id) {
          return []
        }

        const entry = textElementsRef.current.get(id)
        return entry ? [entry.text] : []
      })

      return {
        text: firstEntry.text,
        texts,
        selectedText: selection.toString(),
        pageNumber: firstPageNumber,
        selection
      }
    },
    [
      buildNormalizedSelection,
      buildPointerClampedSelection,
      shouldRejectOverBroadSelection
    ]
  )

  const markVisiblePage = useCallback(
    (pageNumber: number) => {
      pageLastVisibleAtRef.current.set(pageNumber, Date.now())
      markLoadableWithOverscan(pageNumber)
      setVisiblePages((currentPages) => {
        if (currentPages.has(pageNumber)) {
          return currentPages
        }

        const nextPages = new Set(currentPages)
        nextPages.add(pageNumber)
        lastKnownVisiblePagesRef.current = new Set(nextPages)
        return nextPages
      })
    },
    [markLoadableWithOverscan]
  )

  const markHiddenPage = useCallback((pageNumber: number) => {
    setVisiblePages((currentPages) => {
      if (!currentPages.has(pageNumber)) {
        return currentPages
      }

      const nextPages = new Set(currentPages)
      nextPages.delete(pageNumber)
      if (nextPages.size > 0) {
        lastKnownVisiblePagesRef.current = new Set(nextPages)
      }
      return nextPages
    })
  }, [])

  const emitSelectionEnd = useCallback(() => {
    if (!onTextSelectionEnd && !onSelectText && !bodyDragCallbacksEnabled) {
      return
    }

    // Retained as a payload source only. Gesture completion is driven by Drag
    // (or by external/native Selection fallbacks below); this reads the live
    // composed Selection to emit public callbacks without changing their API.
    const selection = getSelectionForRoot(viewerRootRef.current)
    if (!selection) return

    const detail = getSelectionDetail(selection)
    if (!detail) {
      if (onSelectText && strictMouseSelectionRef.current) {
        const htmlParserPayload = buildHtmlParserSelectionPayload(selection)
        if (htmlParserPayload) {
          onSelectText(
            htmlParserPayload.selection,
            htmlParserPayload.segments,
            htmlParserPayload.extractedText
          )
        }
      }
      return
    }

    if (onTextSelectionEnd) {
      onTextSelectionEnd(detail.text, detail)
    }

    if (onSelectText) {
      const payload =
        boundedDirectRenderPayloadsRef.current.get(detail) ??
        buildSelectionPayload(selection)
      if (payload) {
        // 注意：onSelectText 签名固定为 3 参数（baseline 契约）；rects/pageSizes 等
        // 字符级几何信息由调用方在拿到 payload 后自行通过 getSelectionOverlayRects 推导。
        onSelectText(payload.selection, payload.segments, payload.extractedText)
      }
    }
  }, [
    onTextSelectionEnd,
    onSelectText,
    bodyDragCallbacksEnabled,
    getSelectionDetail,
    buildHtmlParserSelectionPayload
  ])

  useEffect(() => {
    if (!runtimeDocument || pageNumbers.length === 0) {
      return
    }

    markLoadableWithOverscan(pageNumbers[0])

    if (typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const pageNumber = Number(
          (entry.target as HTMLElement).dataset.pageNumber
        )

        if (!Number.isFinite(pageNumber)) {
          return
        }

        if (entry.isIntersecting) {
          markVisiblePage(pageNumber)
        } else {
          markHiddenPage(pageNumber)
        }
      })
    })

    pageNumbers.forEach((pageNumber) => {
      const element = pageRefs.current.get(pageNumber)

      if (element) {
        observer.observe(element)
      }
    })

    return () => {
      observer.disconnect()
    }
  }, [
    markHiddenPage,
    markLoadableWithOverscan,
    markVisiblePage,
    pageNumbers,
    runtimeDocument
  ])

  useEffect(() => {
    if (!runtimeDocument) {
      return
    }

    loadablePages.forEach((pageNumber) => {
      if (
        textsByPageNumber.has(pageNumber) ||
        loadingPagesRef.current.has(pageNumber)
      ) {
        return
      }

      let pagePromise: ReturnType<IntermediateDocument['getPageByPageNumber']>

      try {
        pagePromise = runtimeDocument.getPageByPageNumber(pageNumber)
      } catch {
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        return
      }

      if (!pagePromise) {
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        return
      }

      loadingPagesRef.current.add(pageNumber)
      pagePromise
        .then((page) => {
          return Promise.all([getBaseImageFromPage(page), page.getContent()])
        })
        .then(([baseImage, content]) => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          const texts = content.filter(isIntermediateText)
          setBaseImagesByPageNumber(
            createSetBaseImageHandler(pageNumber, baseImage)
          )
          setTextsByPageNumber(createSetTextsHandler(pageNumber, texts))
          setPageStatuses(createSetPageStatusHandler(pageNumber, 'loaded'))
        })
        .catch(() => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          setBaseImagesByPageNumber(
            createSetBaseImageHandler(pageNumber, undefined)
          )
          setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
          setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        })
        .finally(() => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          loadingPagesRef.current.delete(pageNumber)
        })
    })
  }, [loadablePages, runtimeDocument, textsByPageNumber])

  useEffect(() => {
    if (!ocr || !runtimeDocument) {
      return
    }

    const isOcrEnabled =
      ocr === true || (typeof ocr === 'object' && ocr.enabled !== false)

    if (!isOcrEnabled) {
      return
    }

    visiblePages.forEach((pageNumber) => {
      if (
        ocrTextsByPageNumber.has(pageNumber) ||
        ocrLoadingPagesRef.current.has(pageNumber)
      ) {
        return
      }

      const baseImageSource = baseImagesByPageNumber.get(pageNumber)

      if (!baseImageSource) {
        return
      }

      const cacheKey = getOcrCacheKey(
        runtimeDocument.id,
        pageNumber,
        baseImageSource
      )
      const cachedTexts = ocrCacheRef.current.get(cacheKey)
      const shouldBypassCache = evictedOcrPagesRef.current.has(pageNumber)

      if (cachedTexts && !shouldBypassCache) {
        setOcrTextsByPageNumber((currentTexts) => {
          const nextTexts = new Map(currentTexts)
          nextTexts.set(pageNumber, cachedTexts)
          return nextTexts
        })
        return
      }

      ocrLoadingPagesRef.current.add(pageNumber)

      const runOcr = async () => {
        try {
          const { ImageParser } = await import('@hamster-note/image-parser')
          const input = await getImageParserInput(baseImageSource)
          const ocrDocument = await ImageParser.encode(input)
          const ocrPages = await ocrDocument.pages
          const ocrPage = ocrPages[0]
          const ocrContent = ocrPage?.content ?? []
          const ocrTexts = prefixOcrTextIds(
            ocrContent.filter(isIntermediateText),
            pageNumber
          )

          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          ocrCacheRef.current.set(cacheKey, ocrTexts)
          evictedOcrPagesRef.current.delete(pageNumber)
          setOcrTextsByPageNumber(createSetTextsHandler(pageNumber, ocrTexts))
        } catch (error) {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          if (onOcrError) {
            onOcrError(error, { pageNumber })
          }
          // 没有 onOcrError 时静默吞掉，避免在生产代码中遗留日志输出；
          // 调用方需要可观测性时应主动传入 onOcrError 回调。
        } finally {
          if (
            isMountedRef.current &&
            activeDocumentRef.current === runtimeDocument
          ) {
            ocrLoadingPagesRef.current.delete(pageNumber)
          }
        }
      }

      runOcr()
    })
  }, [
    visiblePages,
    ocr,
    runtimeDocument,
    baseImagesByPageNumber,
    onOcrError,
    ocrTextsByPageNumber
  ])

  const rootClassName = [
    'hamster-reader__intermediate-document-viewer',
    className,
    overlayOptions?.enabled
      ? 'hamster-reader__intermediate-document-viewer--custom-selection'
      : ''
  ]
    .filter(Boolean)
    .join(' ')

  useEffect(() => {
    if (!onTextSelectionChange) return

    const handleSelectionChange = () => {
      if (
        ignoreHtmlParserSelectionRefreshRef.current &&
        htmlContentRef.current &&
        !htmlParserErrorRef.current
      ) {
        return
      }
      // Retained for external Selection sync only. Drag-composed selections are
      // emitted directly from the adapter path and skipped here to avoid double
      // onTextSelectionChange callbacks.
      const selection = getSelectionForRoot(viewerRootRef.current)
      if (!selection) return

      if (
        activeMouseSelectionRef.current.active &&
        selection.toString() === ''
      ) {
        return
      }

      const composedSelection = lastDragComposedSelectionRef.current
      if (
        composedSelection &&
        composedSelection.selection === selection &&
        composedSelection.selectedText === selection.toString()
      ) {
        return
      }

      const detail = getSelectionDetail(selection)
      if (detail) {
        onTextSelectionChange(detail.text, detail)
      }
    }

    // Observe browser/user-agent or test-created selections; this listener no
    // longer drives drag selection initiation.
    globalThis.document.addEventListener(
      'selectionchange',
      handleSelectionChange
    )
    return () => {
      globalThis.document.removeEventListener(
        'selectionchange',
        handleSelectionChange
      )
    }
  }, [onTextSelectionChange, getSelectionDetail])

  useEffect(() => {
    const stopHtmlParserSelectionRefresh = (event: Event) => {
      const viewerRoot = viewerRootRef.current
      const selection = getSelectionForRoot(viewerRoot)
      const shouldRecoverCollapsedHtmlParserSelection = Boolean(
        viewerRoot &&
        htmlContentRef.current &&
        !htmlParserErrorRef.current &&
        selection &&
        selection.toString() === '' &&
        viewerRoot.querySelector('.hamster-reader__selection-overlay-path') &&
        activeMouseSelectionRef.current.startCaret &&
        activeMouseSelectionRef.current.lastCaret
      )
      if (
        (ignoreHtmlParserSelectionRefreshRef.current ||
          shouldRecoverCollapsedHtmlParserSelection) &&
        htmlContentRef.current &&
        !htmlParserErrorRef.current
      ) {
        event.stopImmediatePropagation()
        const restoreHtmlParserTextSelection = () => {
          const storedSnapshot = htmlParserStoredSelectionSnapshotRef.current
          const storedRange = htmlParserStoredSelectionRangeRef.current
          const writableSelection = getSelectionForRoot(viewerRoot)
          const activeSelection = activeMouseSelectionRef.current
          if (!viewerRoot || !canWriteSelection(writableSelection)) {
            return false
          }

          if (storedSnapshot) {
            const restoredRange = restoreTextSelectionSnapshot(
              storedSnapshot,
              viewerRoot,
              writableSelection
            )
            if (restoredRange) {
              htmlParserStoredSelectionRangeRef.current =
                restoredRange.cloneRange()
              htmlParserStoredSelectionSnapshotRef.current = storedSnapshot
              return true
            }
          }

          if (
            restoreStoredTextRange(storedRange, viewerRoot, writableSelection)
          ) {
            return true
          }

          if (!activeSelection.startNode || !activeSelection.endNode) {
            return false
          }

          const activeRange = restoreActiveTextSelection(
            {
              startNode: activeSelection.startNode,
              startOffset: activeSelection.startOffset,
              endNode: activeSelection.endNode,
              endOffset: activeSelection.endOffset
            },
            viewerRoot,
            writableSelection
          )
          if (!activeRange) return false

          htmlParserStoredSelectionRangeRef.current = activeRange.cloneRange()
          htmlParserStoredSelectionSnapshotRef.current = {
            startNode: activeSelection.startNode as Text,
            startOffset: activeSelection.startOffset,
            endNode: activeSelection.endNode as Text,
            endOffset: activeSelection.endOffset
          }
          return true
        }
        restoreHtmlParserTextSelection()
        for (const delay of [0, 40, 120] as const) {
          window.setTimeout(() => {
            if (!restoreHtmlParserTextSelection()) {
              composeActiveMouseSelectionFromStoredBoundaries()
            }
          }, delay)
        }
      }
    }

    globalThis.document.addEventListener(
      'selectionchange',
      stopHtmlParserSelectionRefresh,
      { capture: true }
    )
    return () => {
      globalThis.document.removeEventListener(
        'selectionchange',
        stopHtmlParserSelectionRefresh,
        { capture: true }
      )
    }
  }, [composeActiveMouseSelectionFromStoredBoundaries])

  const htmlContentRef = useRef(htmlContent)
  htmlContentRef.current = htmlContent
  const htmlParserErrorRef = useRef(htmlParserError)
  htmlParserErrorRef.current = htmlParserError

  const setDragPreviewSession = useCallback((session: DragPreviewSession) => {
    dragPreviewSessionRef.current = session
    dragPreviewStateRef.current = session.state
    setDragPreviewState((prevState) =>
      prevState === session.state ? prevState : session.state
    )
  }, [])

  const pinDragSelectionPages = useCallback(
    (startPageNumber: number, endPageNumber: number) => {
      const nextPinnedPages = new Set<number>()
      addProtectedPageRange(nextPinnedPages, startPageNumber, endPageNumber)
      pinnedPagesRef.current = nextPinnedPages
    },
    [addProtectedPageRange]
  )

  const getCaretPreviewRect = useCallback(
    (caretInfo: {
      range: Range
      pageNumber: number
    }): DragPreviewRect | null => {
      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return null

      const range = caretInfo.range
      const startContainer = range.startContainer

      const isHtmlParser =
        startContainer.nodeType === Node.TEXT_NODE &&
        isHtmlParserSelectionTarget(startContainer, viewerRoot)

      if (isHtmlParser) {
        const pageElement = getPageElementByPageNumber(
          caretInfo.pageNumber,
          viewerRoot,
          pageRefs.current
        )
        if (!pageElement) return null

        const pageRect = pageElement.getBoundingClientRect()
        const pageScale = getElementViewportScale(pageElement)

        const clientRects = range.getClientRects()
        const rangeRect =
          clientRects && clientRects.length > 0
            ? clientRects[0]
            : range.getBoundingClientRect()

        return {
          x: toPageRelative(rangeRect.left - pageRect.left, pageScale),
          y: toPageRelative(rangeRect.top - pageRect.top, pageScale),
          width: Math.max(toPageRelative(rangeRect.width, pageScale), 1),
          height: Math.max(toPageRelative(rangeRect.height, pageScale), 1),
          pageNumber: caretInfo.pageNumber
        }
      }

      const textElement = getClosestTextElement(startContainer)
      if (!textElement || !viewerRoot.contains(textElement)) return null

      const pageElement = getPageElementByPageNumber(
        caretInfo.pageNumber,
        viewerRoot,
        pageRefs.current
      )
      if (!pageElement) return null

      const textRect = textElement.getBoundingClientRect()
      const pageRect = pageElement.getBoundingClientRect()
      const pageScale = getElementViewportScale(pageElement)
      const textLength = textElement.textContent?.length ?? 0
      const startOffset = caretInfo.range.startOffset
      const offsetRatio =
        textLength > 0
          ? Math.min(Math.max(startOffset, 0), textLength) / textLength
          : 0
      const caretX = textRect.left + textRect.width * offsetRatio

      return {
        x: toPageRelative(caretX - pageRect.left, pageScale),
        y: toPageRelative(textRect.top - pageRect.top, pageScale),
        width: 1,
        height: Math.max(toPageRelative(textRect.height, pageScale), 1),
        pageNumber: caretInfo.pageNumber
      }
    },
    []
  )

  const renderSelectionOverlayRects = useCallback(
    (rects: ReaderSelectionOverlayRect[]) => {
      const viewerRoot = viewerRootRef.current
      if (!viewerRoot || rects.length === 0) return false

      overlayRectsRef.current = rects

      const htmlParserOverlayActive =
        htmlContentRef.current && !htmlParserErrorRef.current

      if (htmlParserOverlayActive) {
        if (overlayElRef.current) {
          const rootRects = rects.flatMap((rect) =>
            isDecodedHtmlParserPage(
              rect.pageNumber,
              viewerRoot,
              pageRefs.current
            )
              ? [getRootOverlayRect(rect, viewerRoot, pageRefs.current)]
              : []
          )
          const polygons = rectsToUnionPolygons(rootRects)
          const d = polygonsToSvgPath(polygons)
          overlayElRef.current.innerHTML =
            d.length > 0
              ? `<svg class="hamster-reader__selection-overlay-svg" width="100%" height="100%"><path class="hamster-reader__selection-overlay-path" fill-rule="evenodd" d="${d}"/></svg>`
              : ''
        }
        overlayContainerRefs.current.forEach((container, pageNumber) => {
          const pageRects = isDecodedHtmlParserPage(
            pageNumber,
            viewerRoot,
            pageRefs.current
          )
            ? []
            : rects.filter((r) => r.pageNumber === pageNumber)
          if (pageRects.length === 0) {
            container.innerHTML = ''
            return
          }
          const polygons = rectsToUnionPolygons(pageRects)
          const d = polygonsToSvgPath(polygons)
          container.innerHTML = `<svg class="hamster-reader__selection-overlay-svg" width="100%" height="100%"><path class="hamster-reader__selection-overlay-path" fill-rule="evenodd" d="${d}"/></svg>`
        })
      } else {
        overlayContainerRefs.current.forEach((container, pageNumber) => {
          const pageRects = rects.filter((r) => r.pageNumber === pageNumber)
          if (pageRects.length === 0) {
            container.innerHTML = ''
            return
          }
          const polygons = rectsToUnionPolygons(pageRects)
          const d = polygonsToSvgPath(polygons)
          container.innerHTML = `<svg class="hamster-reader__selection-overlay-svg" width="100%" height="100%"><path class="hamster-reader__selection-overlay-path" fill-rule="evenodd" d="${d}"/></svg>`
        })
      }

      return true
    },
    []
  )

  const clearOverlay = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    overlayRectsRef.current = []
    overlayContainerRefs.current.forEach((container) => {
      container.innerHTML = ''
    })
    allOverlayContainersRef.current.forEach((container) => {
      container.innerHTML = ''
    })
    if (overlayElRef.current) {
      overlayElRef.current.innerHTML = ''
    }
    setSelectionHandlePositions(new Map())
  }, [])

  // Task 4: 独立清理已保存选择覆盖层与手柄，避免与实时选择清理互相干扰。
  const clearSavedSelectionOverlays = useCallback(() => {
    resolvedSavedSelectionsRef.current.clear()
    for (const container of savedOverlayContainerRefs.current.values()) {
      container.innerHTML = ''
    }
    if (savedOverlayElRef.current) {
      savedOverlayElRef.current.innerHTML = ''
    }
    setSavedSelectionHandlePositions(new Map())
  }, [])

  // Task 4: 构建解析器所需的 TextElementInfo 列表。
  // 扫描 viewerRoot 中所有 [data-text-id] 元素，并与 textElementsRef 中的记录配对，
  // 这样既能覆盖 direct-render 的文本 span，也能在 html-parser 输出带 data-text-id 时工作。
  const buildTextElementInfosForSavedSelection = useCallback(
    (viewerRoot: HTMLElement): TextElementInfo[] => {
      const elements = Array.from(viewerRoot.querySelectorAll('[data-text-id]'))
      const directInfos = elements.flatMap((element) => {
        const id = element.getAttribute('data-text-id')
        if (!id) return []
        const record = textElementsRef.current.get(id)
        if (!record) return []
        return [
          {
            element: element as HTMLElement,
            text: record.text,
            pageNumber: record.pageNumber
          }
        ]
      })

      if (!htmlContentRef.current || htmlParserErrorRef.current) {
        return directInfos
      }

      const htmlPages = Array.from(
        viewerRoot.querySelectorAll<HTMLElement>('.hamster-note-page')
      )
      const htmlParserInfos = htmlPages.flatMap((pageElement, pageIndex) => {
        const pageNumber = pageNumbers[pageIndex] ?? pageIndex + 1
        const pageTexts = textsByPageNumber.get(pageNumber) ?? []
        const textElements = Array.from(
          pageElement.querySelectorAll<HTMLElement>('.hamster-note-text')
        )

        return textElements.flatMap((element, textIndex) => {
          // html-parser 输出不保证带 data-text-id；保存选区恢复按页面内文本顺序
          // 回连到原始 IntermediateText，才能让浏览器实测中的保存手柄可编辑。
          if (element.hasAttribute('data-text-id')) return []
          const text = pageTexts[textIndex]
          if (!text) return []
          return [{ element, text, pageNumber }]
        })
      })

      return [...directInfos, ...htmlParserInfos]
    },
    [pageNumbers, textsByPageNumber]
  )

  // Task 4: 把 resolveSavedSelection 返回的客户端坐标矩形转换为页面相对坐标。
  // resolveSavedSelection 的 rects 来自 Range.getClientRects，是 viewport 坐标；
  // direct-render 覆盖层使用页面相对坐标，因此需要按对应页元素的位置做偏移。
  const convertSavedSelectionRectToPageRect = useCallback(
    (
      rect: ReaderSelectionOverlayRect,
      viewerRoot: HTMLElement
    ): ReaderSelectionOverlayRect => {
      const pageElement = getPageElementByPageNumber(
        rect.pageNumber,
        viewerRoot,
        pageRefs.current
      )
      if (!pageElement) return rect
      const pageRect = pageElement.getBoundingClientRect()
      const pageScale = getElementViewportScale(pageElement)
      return {
        ...rect,
        x: toPageRelative(rect.x - pageRect.left, pageScale),
        y: toPageRelative(rect.y - pageRect.top, pageScale),
        width: toPageRelative(rect.width, pageScale),
        height: toPageRelative(rect.height, pageScale)
      }
    },
    []
  )

  // Task 4: 渲染所有已保存选择覆盖层。
  // 与实时选择覆盖层使用独立的 DOM 容器，避免互相污染；
  // 每个选择单独生成 path，因此重叠的选择仍保持各自可点击。
  const renderSavedSelectionOverlays = useCallback(
    (results: ReaderSavedSelectionRestoreResult[], activeId: string | null) => {
      const viewerRoot = viewerRootRef.current
      if (!viewerRoot || results.length === 0) {
        for (const container of savedOverlayContainerRefs.current.values()) {
          container.innerHTML = ''
        }
        if (savedOverlayElRef.current) {
          savedOverlayElRef.current.innerHTML = ''
        }
        return
      }

      const htmlParserOverlayActive =
        htmlContentRef.current && !htmlParserErrorRef.current

      if (htmlParserOverlayActive) {
        if (savedOverlayElRef.current) {
          savedOverlayElRef.current.innerHTML =
            buildSavedSelectionOverlaySvgForHtmlParser(
              results,
              activeId,
              viewerRoot,
              pageRefs.current
            )
        }
        return
      }

      for (const [
        pageNumber,
        container
      ] of savedOverlayContainerRefs.current.entries()) {
        container.innerHTML = buildSavedSelectionOverlaySvgForDirectPage(
          results,
          activeId,
          pageNumber
        )
      }
    },
    []
  )

  // Task 4: 根据激活状态计算已保存选择手柄位置。
  // 只有解析成功（status === 'resolved' 且存在 range）的已保存选择才会显示手柄；
  // 手柄计算复用 buildSelectionHandlePositions，与实时选择使用同一套几何逻辑。
  const refreshSavedSelectionHandles = useCallback(
    (results: ReaderSavedSelectionRestoreResult[], activeId: string | null) => {
      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) {
        setSavedSelectionHandlePositions(new Map())
        return
      }

      const activeResult = results.find((result) => result.id === activeId)
      if (
        !activeResult ||
        activeResult.status !== 'resolved' ||
        !activeResult.range
      ) {
        setSavedSelectionHandlePositions(new Map())
        return
      }

      const htmlParserOverlayActive =
        htmlContentRef.current && !htmlParserErrorRef.current
      let positions = buildSelectionHandlePositions(
        activeResult.range,
        viewerRoot,
        pageRefs.current,
        Boolean(htmlParserOverlayActive)
      )
      if (positions.size === 0 && activeResult.rects.length > 0) {
        positions = buildSavedRectHandlePositions(
          activeResult.rects,
          viewerRoot,
          pageRefs.current,
          Boolean(htmlParserOverlayActive)
        )
      }
      setSavedSelectionHandlePositions(positions)
    },
    []
  )

  // Task 4: 激活/取消激活已保存选择。
  // 受控模式下仅回调通知调用方；非受控模式下同步更新内部状态。
  const setActiveSavedSelectionId = useCallback(
    (id: string | null) => {
      if (!isControlledActiveSavedSelection) {
        setInternalActiveSavedSelectionId(id)
      }
      onActiveSavedSelectionChange?.(id)
    },
    [isControlledActiveSavedSelection, onActiveSavedSelectionChange]
  )

  // Task 4: 点击已保存选择覆盖层时切换激活状态。
  // 视觉回退选择也允许激活，便于受控按钮（如删除）同步状态；手柄仍由 resolved range 单独控制。
  const handleSavedOverlayClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      const savedId = target
        ?.closest('[data-saved-selection-id]')
        ?.getAttribute('data-saved-selection-id')
      if (!savedId) return

      const resolvedResult = resolvedSavedSelectionsRef.current.get(savedId)
      if (
        !resolvedResult ||
        (resolvedResult.status !== 'resolved' &&
          resolvedResult.status !== 'visual-fallback')
      )
        return

      event.stopPropagation()

      // 已保存 overlay 被选中时，它会成为唯一活跃 overlay：清掉实时选区
      // 的原生 Selection、覆盖层和端点，避免两套端点图标同时出现。
      const selection = getSelectionForRoot(viewerRootRef.current)
      if (
        selection &&
        !selection.isCollapsed &&
        typeof selection.removeAllRanges === 'function'
      ) {
        selection.removeAllRanges()
      }
      clearOverlay()

      setActiveSavedSelectionId(
        effectiveActiveSavedSelectionId === savedId ? null : savedId
      )
    },
    [clearOverlay, effectiveActiveSavedSelectionId, setActiveSavedSelectionId]
  )

  const executeRefreshSelectionOverlay = useCallback(() => {
    rafIdRef.current = null

    // Retained for overlay extraction from the live Selection, including
    // externally-created selections. Drag paths refresh explicitly after they
    // compose Selection ranges.
    const viewerRoot = viewerRootRef.current
    const selection = getSelectionForRoot(viewerRoot)
    if (
      ignoreHtmlParserSelectionRefreshRef.current &&
      htmlContentRef.current &&
      !htmlParserErrorRef.current
    ) {
      return
    }
    if (!selection || selection.isCollapsed || !viewerRoot) {
      if (
        preserveOverlayDuringMouseUpRef.current &&
        overlayRectsRef.current.length > 0
      ) {
        return
      }
      clearOverlay()
      return
    }

    const isSavedHandleDragActive =
      dragStateRef.current.active && dragStateRef.current.source === 'saved'
    if (isSavedHandleDragActive || savedHandleDragContextRef.current) {
      return
    }

    const rects = getSelectionOverlayRects(
      selection,
      viewerRoot,
      pageRefs.current,
      textElementsRef.current
    )

    if (rects.length === 0) {
      clearOverlay()
      return
    }

    // 新的实时文本选择会接管 overlay 选中态；此时取消已保存 overlay
    // 的激活和手柄，保证同一时间最多只有一组端点图标。
    if (effectiveActiveSavedSelectionId !== null) {
      setActiveSavedSelectionId(null)
      setSavedSelectionHandlePositions(new Map())
    }

    renderSelectionOverlayRects(rects)

    // 根据 selection 的 start/end 容器创建 collapsed range 并取其边界矩形：
    // - start 手柄：锚定在 collapsed-start 矩形的 LEFT 边缘（不覆盖文字）
    // - end 手柄：锚定在 collapsed-end 矩形的 RIGHT 边缘
    const range = selection.getRangeAt(0)
    const handlePositions = buildSelectionHandlePositions(
      range,
      viewerRoot,
      pageRefs.current,
      Boolean(htmlContentRef.current && !htmlParserErrorRef.current)
    )
    setSelectionHandlePositions(handlePositions)
  }, [
    clearOverlay,
    effectiveActiveSavedSelectionId,
    renderSelectionOverlayRects,
    setActiveSavedSelectionId
  ])

  const refreshSelectionOverlay = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    executeRefreshSelectionOverlay()
  }, [executeRefreshSelectionOverlay])

  // 通过 ref 暴露 refreshSelectionOverlay，避免 useCallback 循环依赖
  const refreshSelectionOverlayRef = useRef(refreshSelectionOverlay)
  refreshSelectionOverlayRef.current = refreshSelectionOverlay

  useEffect(() => {
    if (!overlayOptions?.enabled) {
      clearOverlay()
      return
    }

    // External Selection observer only: keeps overlays in sync when Selection
    // is created outside the Drag adapters (keyboard, browser UI, tests).
    globalThis.document.addEventListener(
      'selectionchange',
      refreshSelectionOverlay
    )
    // Demoted native mouseup fallback: refreshes overlays after externally
    // created native selections; root Drag remains the primary selection path.
    globalThis.document.addEventListener('mouseup', refreshSelectionOverlay)

    return () => {
      globalThis.document.removeEventListener(
        'selectionchange',
        refreshSelectionOverlay
      )
      globalThis.document.removeEventListener(
        'mouseup',
        refreshSelectionOverlay
      )
      clearOverlay()
    }
  }, [overlayOptions, clearOverlay, refreshSelectionOverlay])

  useEffect(() => {
    const restoreHtmlParserSelectionAfterObservers = () => {
      const viewerRoot = viewerRootRef.current
      const storedRange = htmlParserStoredSelectionRangeRef.current
      const selection = getSelectionForRoot(viewerRoot)
      if (
        !viewerRoot ||
        !storedRange ||
        !selection ||
        !htmlContentRef.current ||
        htmlParserErrorRef.current ||
        selection.toString() !== '' ||
        overlayRectsRef.current.length === 0
      ) {
        return
      }

      const startElement =
        storedRange.startContainer instanceof Element
          ? storedRange.startContainer
          : storedRange.startContainer.parentElement
      const endElement =
        storedRange.endContainer instanceof Element
          ? storedRange.endContainer
          : storedRange.endContainer.parentElement
      if (!startElement || !endElement) return
      if (
        !viewerRoot.contains(startElement) ||
        !viewerRoot.contains(endElement)
      ) {
        return
      }
      if (
        typeof selection.removeAllRanges !== 'function' ||
        typeof selection.addRange !== 'function'
      ) {
        return
      }

      selection.removeAllRanges()
      selection.addRange(storedRange.cloneRange())
    }

    globalThis.document.addEventListener(
      'selectionchange',
      restoreHtmlParserSelectionAfterObservers
    )
    return () => {
      globalThis.document.removeEventListener(
        'selectionchange',
        restoreHtmlParserSelectionAfterObservers
      )
    }
  }, [])

  useEffect(() => {
    if (!overlayOptions?.enabled) return

    globalThis.window.addEventListener('resize', refreshSelectionOverlay)
    globalThis.document.addEventListener('scroll', refreshSelectionOverlay)

    return () => {
      globalThis.window.removeEventListener('resize', refreshSelectionOverlay)
      globalThis.document.removeEventListener('scroll', refreshSelectionOverlay)
    }
  }, [overlayOptions, refreshSelectionOverlay])

  // 当页面文本、html-parser 模式状态或 OCR 结果变化时，递增 DOM 版本号，
  // 触发已保存选择的重新解析。为了避免 hook 依赖数组中出现未在回调体中使用的
  // 变量，这里用 ref 保存上一次状态并比较引用。
  const savedSelectionDomStateRef = useRef({
    textsByPageNumber,
    ocrTextsByPageNumber,
    htmlContent
  })
  useEffect(() => {
    if (!overlayOptions?.enabled || !runtimeDocument) return

    const prev = savedSelectionDomStateRef.current
    const changed =
      prev.textsByPageNumber !== textsByPageNumber ||
      prev.ocrTextsByPageNumber !== ocrTextsByPageNumber ||
      prev.htmlContent !== htmlContent
    if (!changed) return

    savedSelectionDomStateRef.current = {
      textsByPageNumber,
      ocrTextsByPageNumber,
      htmlContent
    }
    setSavedSelectionDomVersion((version) => version + 1)
  }, [
    overlayOptions?.enabled,
    runtimeDocument,
    textsByPageNumber,
    ocrTextsByPageNumber,
    htmlContent
  ])

  // 记录最近一次解析时使用的 DOM 版本号，仅用于把 savedSelectionDomVersion
  // 真正用在回调体内，避免 exhaustive-deps 误报，同时保留触发重新解析的能力。
  const lastResolvedDomVersionRef = useRef(0)
  const lastResolvedScaleRef = useRef(effectiveScale)

  // Task 4: 解析并渲染已保存选择覆盖层。
  // 使用 requestAnimationFrame 等待 DOM 更新完成后再扫描 [data-text-id] 元素。
  const resolveAndRenderSavedSelections = useCallback(() => {
    lastResolvedDomVersionRef.current = savedSelectionDomVersion
    lastResolvedScaleRef.current = effectiveScale

    const viewerRoot = viewerRootRef.current
    if (!viewerRoot) return
    if (!savedSelections || savedSelections.length === 0) {
      clearSavedSelectionOverlays()
      return
    }

    if (!isMountedRef.current) return

    const textElementInfos = buildTextElementInfosForSavedSelection(viewerRoot)
    const results: ReaderSavedSelectionRestoreResult[] = []
    for (const selection of savedSelections) {
      const resolved = resolveSavedSelection(selection, textElementInfos)
      const pageRects: ReaderSelectionOverlayRect[] =
        resolved.status === 'resolved'
          ? resolved.rects.map((rect) =>
              convertSavedSelectionRectToPageRect(rect, viewerRoot)
            )
          : resolved.rects
      results.push({ ...resolved, rects: pageRects })
    }

    const resultsById = new Map<string, ReaderSavedSelectionRestoreResult>()
    for (const result of results) {
      resultsById.set(result.id, result)
    }
    resolvedSavedSelectionsRef.current = resultsById

    onSavedSelectionRestore?.(results)
    renderSavedSelectionOverlays(results, effectiveActiveSavedSelectionId)
    refreshSavedSelectionHandles(results, effectiveActiveSavedSelectionId)
  }, [
    savedSelections,
    savedSelectionDomVersion,
    effectiveActiveSavedSelectionId,
    clearSavedSelectionOverlays,
    buildTextElementInfosForSavedSelection,
    convertSavedSelectionRectToPageRect,
    renderSavedSelectionOverlays,
    refreshSavedSelectionHandles,
    onSavedSelectionRestore,
    effectiveScale
  ])

  // Task 4: 当 savedSelections、文档、overlay 开关或 DOM 版本变化时执行解析渲染。
  // resolveAndRenderSavedSelections 的依赖已包含 savedSelections 与 savedSelectionDomVersion，
  // 因此这里不需要重复声明，避免 exhaustive-deps 报错。
  useEffect(() => {
    if (!overlayOptions?.enabled || !runtimeDocument) return

    const frameId = requestAnimationFrame(resolveAndRenderSavedSelections)
    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [
    overlayOptions?.enabled,
    runtimeDocument,
    resolveAndRenderSavedSelections
  ])

  // Task 4: 激活选择变化时重新渲染覆盖层（高亮样式）与手柄。
  useEffect(() => {
    if (!overlayOptions?.enabled) return
    const results = Array.from(resolvedSavedSelectionsRef.current.values())
    renderSavedSelectionOverlays(results, effectiveActiveSavedSelectionId)
    refreshSavedSelectionHandles(results, effectiveActiveSavedSelectionId)
  }, [
    effectiveActiveSavedSelectionId,
    overlayOptions?.enabled,
    renderSavedSelectionOverlays,
    refreshSavedSelectionHandles
  ])

  // Task 4: 布局变化时重新解析并渲染已保存选择，保证覆盖层与文本位置同步。
  useEffect(() => {
    if (!overlayOptions?.enabled) return

    const handleLayoutChange = () => {
      resolveAndRenderSavedSelections()
    }

    globalThis.window.addEventListener('resize', handleLayoutChange)
    globalThis.document.addEventListener('scroll', handleLayoutChange)
    return () => {
      globalThis.window.removeEventListener('resize', handleLayoutChange)
      globalThis.document.removeEventListener('scroll', handleLayoutChange)
    }
  }, [overlayOptions?.enabled, resolveAndRenderSavedSelections])

  useEffect(() => {
    const root = viewerRootElement
    if (!root || !runtimeDocument) return

    const resolveDragCaret = (clientX: number, clientY: number) => {
      const pointElement = root.ownerDocument.elementFromPoint?.(
        clientX,
        clientY
      )
      const pointTextElement = pointElement?.closest('[data-text-id]')
      const pointHtmlParserTextElement = isHtmlParserSelectionTarget(
        pointElement ?? null,
        root
      )
      const shouldSnapToNearestText =
        !pointHtmlParserTextElement &&
        (!pointTextElement ||
          !root.contains(pointTextElement) ||
          isSelectionBackgroundTarget(pointElement))

      return resolveCaret(clientX, clientY, {
        viewerRoot: root,
        pageRefs: pageRefs.current,
        textElements: textElementsRef.current,
        allowHtmlParserRange: pointHtmlParserTextElement,
        ...(shouldSnapToNearestText
          ? {
              caretPositionFromPoint: () => null,
              caretRangeFromPoint: () => null
            }
          : {})
      })
    }

    const isTextSelectionStartTarget = (
      clientX: number,
      clientY: number,
      pointerId: number
    ) => {
      const nativePointerTargetHit =
        pointerTextTargetsByIdRef.current.get(pointerId)
      if (nativePointerTargetHit !== undefined) return nativePointerTargetHit

      const pointElement = root.ownerDocument.elementFromPoint?.(
        clientX,
        clientY
      )
      const pointTextElement = pointElement?.closest('[data-text-id]')

      return Boolean(
        (pointTextElement &&
          root.contains(pointTextElement) &&
          !isSelectionBackgroundTarget(pointElement)) ||
        isHtmlParserSelectionTarget(pointElement ?? null, root)
      )
    }

    const clearLongPressSession = () => {
      const session = longPressSessionRef.current
      if (!session) return

      clearTimeout(session.timerId)
      longPressSessionRef.current = null
    }

    const resetRootDragSelection = () => {
      clearLongPressSession()
      setDragPreviewSession(cancelDragPreview(dragPreviewSessionRef.current))
      dragSelectionAnchorRef.current = null
      activeMouseSelectionRef.current.active = false
      strictMouseSelectionRef.current = false
      pinnedPagesRef.current.clear()
    }

    const shouldCancelDragSelectionFinalization = (
      anchor: typeof dragSelectionAnchorRef.current,
      isStrictMouseFinalizing: boolean
    ) => {
      return (
        (!anchor && !isStrictMouseFinalizing) ||
        dragPreviewSessionRef.current.state !== 'dragging'
      )
    }

    const emitTextSelectionChange = (selection: Selection) => {
      lastDragComposedSelectionRef.current = {
        selection,
        selectedText: selection.toString()
      }

      if (!onTextSelectionChange) return

      const selectionDetail = getSelectionDetail(selection)
      if (selectionDetail) {
        onTextSelectionChange(selectionDetail.text, selectionDetail)
      }
    }

    const armTouchLongPress = (
      clientX: number,
      clientY: number,
      pointerId: number
    ) => {
      const timerId = setTimeout(() => {
        const session = longPressSessionRef.current
        if (!session || session.pointerId !== pointerId) return

        const caretInfo = resolveDragCaret(session.startX, session.startY)
        if (!caretInfo) {
          clearLongPressSession()
          return
        }

        const wordRange = createWordRangeFromCaret(caretInfo.range)
        caretInfo.range.detach()
        if (!wordRange) {
          clearLongPressSession()
          return
        }

        const previewRect = getCaretPreviewRect({
          range: wordRange,
          pageNumber: caretInfo.pageNumber
        })
        const writableSelection = getSelectionForRoot(root)
        if (
          !previewRect ||
          !writableSelection ||
          typeof writableSelection.removeAllRanges !== 'function' ||
          typeof writableSelection.addRange !== 'function'
        ) {
          clearLongPressSession()
          return
        }

        // 长按触发后先选中当前单词，并把单词起点作为后续拖拽扩展锚点。
        dragSelectionAnchorRef.current = {
          node: wordRange.startContainer,
          offset: wordRange.startOffset,
          previewRect
        }
        longPressSessionRef.current = {
          ...session,
          anchorRange: wordRange
        }
        setDragPreviewSession(
          armDragPreview(createDragPreviewSession(), {
            clientX: session.startX,
            clientY: session.startY
          })
        )
        pinnedPagesRef.current = new Set([caretInfo.pageNumber])
        dragSelectionEndEmittedRef.current = false
        const activeSelection = createActiveMouseSelection({
          clientX: session.startX,
          clientY: session.startY,
          caretInfo,
          textElement: null
        })
        if (!activeSelection) {
          clearLongPressSession()
          return
        }
        activeMouseSelectionRef.current = activeSelection

        composeSelection(wordRange)
        emitTextSelectionChange(writableSelection)
      }, 500)

      longPressSessionRef.current = {
        pointerId,
        timerId,
        startX: clientX,
        startY: clientY,
        anchorRange: null
      }
    }

    const hasStoredMouseEndpoint = () => {
      const activeSelection = activeMouseSelectionRef.current
      return Boolean(
        activeSelection.startCaret &&
        activeSelection.lastCaret &&
        activeSelection.endNode &&
        activeSelection.startNode
      )
    }

    const composeStrictFinalSelection = () => {
      if (!hasStoredMouseEndpoint()) return

      composeActiveMouseSelectionFromStoredBoundaries()
    }

    const composeAdapterFinalSelection = (
      anchor: NonNullable<typeof dragSelectionAnchorRef.current>,
      clientX: number,
      clientY: number
    ) => {
      const finalCaretInfo = resolveDragCaret(clientX, clientY)
      if (!finalCaretInfo) return

      const range = createOrderedRange(
        anchor.node,
        anchor.offset,
        finalCaretInfo.range.startContainer,
        finalCaretInfo.range.startOffset
      )
      finalCaretInfo.range.detach()
      composeSelection(range)
      recomposeActiveTextSelection(root)
    }

    const canComposeAdapterFinalSelection = (
      anchor: typeof dragSelectionAnchorRef.current,
      selection: Selection | null
    ): anchor is NonNullable<typeof dragSelectionAnchorRef.current> => {
      return Boolean(
        anchor &&
        selection &&
        typeof selection.removeAllRanges === 'function' &&
        typeof selection.addRange === 'function'
      )
    }

    const composeFinalSelection = (
      isStrictMouseFinalizing: boolean,
      anchor: typeof dragSelectionAnchorRef.current,
      writableSelection: Selection | null,
      clientX: number,
      clientY: number
    ) => {
      if (isStrictMouseFinalizing) {
        composeStrictFinalSelection()
        return
      }

      if (canComposeAdapterFinalSelection(anchor, writableSelection)) {
        composeAdapterFinalSelection(anchor, clientX, clientY)
        return
      }

      resolveDragCaret(clientX, clientY)?.range.detach()
    }

    const releaseHtmlParserSelectionRefreshGuard = (
      isStrictMouseFinalizing: boolean
    ) => {
      if (
        isStrictMouseFinalizing &&
        ignoreHtmlParserSelectionRefreshRef.current
      ) {
        window.setTimeout(() => {
          ignoreHtmlParserSelectionRefreshRef.current = false
        }, 500)
        return
      }

      ignoreHtmlParserSelectionRefreshRef.current = false
    }

    const finishDragSelection = (clientX: number, clientY: number) => {
      clearLongPressSession()
      if (activeMouseSelectionRef.current.finalized) return
      activeMouseSelectionRef.current.finalized = true
      const isStrictMouseFinalizing = strictMouseSelectionRef.current
      const anchor = dragSelectionAnchorRef.current
      if (
        shouldCancelDragSelectionFinalization(anchor, isStrictMouseFinalizing)
      ) {
        resetRootDragSelection()
        return
      }

      const finalizingPreview = finalizeDragPreview(
        dragPreviewSessionRef.current
      )
      setDragPreviewSession(
        finalizingPreview === dragPreviewSessionRef.current
          ? cancelDragPreview(finalizingPreview)
          : finalizingPreview
      )

      activeMouseSelectionRef.current.clientX = clientX
      activeMouseSelectionRef.current.clientY = clientY

      const writableSelection = getSelectionForRoot(root)
      composeFinalSelection(
        isStrictMouseFinalizing,
        anchor,
        writableSelection,
        clientX,
        clientY
      )

      // Retained to inspect the Selection that the Drag path just composed, so
      // blank-click suppression and final overlay refresh can be applied.
      const selection = getSelectionForRoot(viewerRootRef.current)
      if (selection && !selection.isCollapsed) {
        ignoreNextBlankClickRef.current = true
        preserveOverlayDuringMouseUpRef.current = true
      }

      if (!dragSelectionEndEmittedRef.current) {
        dragSelectionEndEmittedRef.current = true
        skipNextMouseUpSelectionEndRef.current = true
        emitSelectionEnd()
        window.setTimeout(() => {
          skipNextMouseUpSelectionEndRef.current = false
        }, 0)
      }

      activeMouseSelectionRef.current.active = false
      strictMouseSelectionRef.current = false
      releaseHtmlParserSelectionRefreshGuard(isStrictMouseFinalizing)
      dragSelectionAnchorRef.current = null
      pinnedPagesRef.current.clear()

      if (overlayOptions?.enabled && selection && !selection.isCollapsed) {
        refreshSelectionOverlayRef.current()
      }

      const shouldRecomposeStrictHtmlParserSelection =
        isStrictMouseFinalizing && ignoreHtmlParserSelectionRefreshRef.current
      if (shouldRecomposeStrictHtmlParserSelection) {
        window.setTimeout(() => {
          composeActiveMouseSelectionFromStoredBoundaries()
        }, 120)
      }

      preserveOverlayDuringMouseUpRef.current = false
      setDragPreviewSession(cancelDragPreview(dragPreviewSessionRef.current))
    }
    finishDragSelectionRef.current = finishDragSelection

    const rememberPointerType = (event: PointerEvent) => {
      const pointerId = event.pointerId ?? 1
      pointerTypesByIdRef.current.set(pointerId, event.pointerType || 'mouse')
      if (event.type === 'pointerdown') {
        const target = event.target instanceof Element ? event.target : null
        pointerTextTargetsByIdRef.current.set(
          pointerId,
          Boolean(
            (target?.closest(SUPPORTED_TEXT_HIT_SELECTOR) &&
              root.contains(target) &&
              !isSelectionBackgroundTarget(target)) ||
            isHtmlParserSelectionTarget(target, root)
          )
        )
      }
    }

    const forgetPointerType = (event: PointerEvent) => {
      const pointerId = event.pointerId ?? 1
      pointerTypesByIdRef.current.delete(pointerId)
      pointerTextTargetsByIdRef.current.delete(pointerId)
    }

    // Drag emits its Start callback from its own bubble-phase pointerdown
    // listener. Capture pointer metadata first so touch long-press routing does
    // not depend on listener registration order in tests or adapter internals.
    root.addEventListener('pointerdown', rememberPointerType, { capture: true })
    root.addEventListener('pointermove', rememberPointerType)
    root.addEventListener('pointerup', forgetPointerType)
    root.addEventListener('pointercancel', forgetPointerType)
    const handleLongPressPointerMove = (
      clientX: number,
      clientY: number,
      detailPointerId: number
    ) => {
      const longPressSession = longPressSessionRef.current
      if (!longPressSession || longPressSession.pointerId !== detailPointerId) {
        return false
      }

      const deltaY = clientY - longPressSession.startY
      const moveDistance = Math.hypot(clientX - longPressSession.startX, deltaY)
      if (longPressSession.anchorRange || moveDistance <= 10) return false

      clearLongPressSession()

      return true
    }

    const getWritableSelection = () => {
      const writableSelection = getSelectionForRoot(root)
      if (
        !writableSelection ||
        typeof writableSelection.removeAllRanges !== 'function' ||
        typeof writableSelection.addRange !== 'function'
      ) {
        return null
      }

      return writableSelection
    }

    const createActiveMouseSelection = ({
      clientX,
      clientY,
      caretInfo,
      textElement,
      requirePageMetrics = false
    }: {
      readonly clientX: number
      readonly clientY: number
      readonly caretInfo:
        | SupportedTextHitCaret
        | { range: Range; pageNumber: number }
      readonly textElement: HTMLElement | null
      readonly requirePageMetrics?: boolean
    }): ActiveMouseSelectionState | null => {
      const pageElement = pageRefs.current.get(caretInfo.pageNumber) ?? null
      if (!pageElement && requirePageMetrics) return null

      const pagePoint = pageElement
        ? getPagePercentPoint(
            clientX,
            clientY,
            pageElement.getBoundingClientRect()
          )
        : { x: 0, y: 0 }
      if (!pagePoint && requirePageMetrics) return null
      const startPagePoint = pagePoint ?? { x: 0, y: 0 }

      const startNode = caretInfo.range.startContainer
      const startOffset = caretInfo.range.startOffset

      return {
        active: true,
        startClientX: clientX,
        startClientY: clientY,
        clientX,
        clientY,
        startPagePercentX: startPagePoint.x,
        startPagePercentY: startPagePoint.y,
        pageNumber: caretInfo.pageNumber,
        pageElement,
        startNode,
        startOffset,
        startCaret: {
          node: startNode,
          offset: startOffset,
          clientX,
          clientY
        },
        endNode: startNode,
        endOffset: startOffset,
        lastTextElement: textElement,
        lastCaret: {
          node: startNode,
          offset: startOffset,
          clientX,
          clientY
        },
        finalized: false
      }
    }

    function rememberCurrentHtmlParserSelection() {
      const snapshot = getCurrentHtmlParserSelectionSnapshot()
      if (!snapshot) return false

      const range = createOrderedRange(
        snapshot.startNode,
        snapshot.startOffset,
        snapshot.endNode,
        snapshot.endOffset
      )
      htmlParserStoredSelectionRangeRef.current = range.cloneRange()
      htmlParserStoredSelectionSnapshotRef.current = snapshot
      range.detach()
      return true
    }

    const handleMouseDownSelectionStart = (event: MouseEvent) => {
      if (event.button !== 0) {
        if (htmlContentRef.current && !htmlParserErrorRef.current) {
          rememberCurrentHtmlParserSelection()
        }
        if (
          htmlContentRef.current &&
          !htmlParserErrorRef.current &&
          hasActiveStrictMouseSelection() &&
          (overlayRectsRef.current.length > 0 || hasStoredMouseEndpoint())
        ) {
          restoreHtmlParserStoredSelection(
            getCurrentHtmlParserSelectionSnapshot() ??
              htmlParserStoredSelectionSnapshotRef.current ??
              getActiveHtmlParserSelectionSnapshot()
          )
        }
        return
      }
      if (activeMouseSelectionRef.current.active) {
        return
      }
      if (shouldForceBlockSelection(interactionModeRef.current, 'mouse')) {
        resetRootDragSelection()
        return
      }

      const hit = resolveStrictSupportedTextHit(
        { clientX: event.clientX, clientY: event.clientY },
        root,
        event.target instanceof Element ? event.target : null
      )
      if (!hit) return

      const previewRect = getCaretPreviewRect(hit)
      if (!previewRect) {
        hit.range.detach()
        return
      }

      const activeSelection = createActiveMouseSelection({
        clientX: event.clientX,
        clientY: event.clientY,
        caretInfo: hit,
        textElement: hit.element,
        requirePageMetrics: false
      })
      const writableSelection = getWritableSelection()
      if (!activeSelection || !writableSelection) {
        hit.range.detach()
        return
      }

      event.preventDefault()
      strictMouseSelectionRef.current = true
      ignoreHtmlParserSelectionRefreshRef.current = Boolean(
        htmlContentRef.current && !htmlParserErrorRef.current
      )
      dragSelectionEndEmittedRef.current = false
      pinnedPagesRef.current = new Set([hit.pageNumber])
      activeMouseSelectionRef.current = activeSelection
      setDragPreviewSession(
        armDragPreview(createDragPreviewSession(), {
          clientX: event.clientX,
          clientY: event.clientY
        })
      )
      dragSelectionAnchorRef.current = {
        node: hit.node,
        offset: activeSelection.startOffset,
        previewRect
      }
      const collapsedRange = createOrderedRange(
        hit.node,
        hit.offset,
        hit.node,
        hit.offset
      )
      hit.range.detach()
      composeSelection(collapsedRange)
    }

    const getHtmlParserTextNodeBoundary = (node: Node) => {
      if (node.nodeType !== Node.TEXT_NODE) return null

      const textNode = node as Text
      const parent = textNode.parentElement
      if (!parent?.closest('.hamster-note-text')) return null
      if (!root.contains(parent)) return null

      return textNode
    }

    const getCurrentHtmlParserSelectionSnapshot = () => {
      const selection = getSelectionForRoot(root)
      if (!selection || selection.rangeCount === 0) return null

      const range = selection.getRangeAt(0)
      const startNode = getHtmlParserTextNodeBoundary(range.startContainer)
      const endNode = getHtmlParserTextNodeBoundary(range.endContainer)
      if (!startNode || !endNode || range.collapsed) return null

      return {
        startNode,
        startOffset: range.startOffset,
        endNode,
        endOffset: range.endOffset
      } satisfies TextSelectionSnapshot
    }

    const getActiveHtmlParserSelectionSnapshot = () => {
      const activeSelection = activeMouseSelectionRef.current
      const startNode = activeSelection.startNode
        ? getHtmlParserTextNodeBoundary(activeSelection.startNode)
        : null
      const endNode = activeSelection.endNode
        ? getHtmlParserTextNodeBoundary(activeSelection.endNode)
        : null
      if (!startNode || !endNode) return null

      if (
        startNode === endNode &&
        activeSelection.startOffset === activeSelection.endOffset
      ) {
        return null
      }

      return {
        startNode,
        startOffset: activeSelection.startOffset,
        endNode,
        endOffset: activeSelection.endOffset
      } satisfies TextSelectionSnapshot
    }

    const restoreHtmlParserSelectionSnapshot = (
      snapshot: TextSelectionSnapshot | null
    ) => {
      if (!snapshot) return false
      if (
        snapshot.startNode === snapshot.endNode &&
        snapshot.startOffset === snapshot.endOffset
      ) {
        return false
      }

      const writableSelection = getSelectionForRoot(root)
      if (
        !writableSelection ||
        typeof writableSelection.removeAllRanges !== 'function' ||
        typeof writableSelection.addRange !== 'function'
      ) {
        return false
      }

      const range = createOrderedRange(
        snapshot.startNode,
        snapshot.startOffset,
        snapshot.endNode,
        snapshot.endOffset
      )
      writableSelection.removeAllRanges()
      writableSelection.addRange(range)
      htmlParserStoredSelectionRangeRef.current = range.cloneRange()
      htmlParserStoredSelectionSnapshotRef.current = snapshot
      return true
    }

    const restoreHtmlParserStoredSelectionRange = () => {
      const viewerRoot = viewerRootRef.current
      const range = htmlParserStoredSelectionRangeRef.current
      if (!viewerRoot || !range) return false
      if (range.collapsed) return false
      const startContainer = range.startContainer
      const endContainer = range.endContainer
      const startElement =
        startContainer instanceof Element
          ? startContainer
          : startContainer.parentElement
      const endElement =
        endContainer instanceof Element
          ? endContainer
          : endContainer.parentElement
      if (!startElement || !endElement) return false
      if (
        !viewerRoot.contains(startElement) ||
        !viewerRoot.contains(endElement)
      ) {
        return false
      }

      const writableSelection = getSelectionForRoot(viewerRoot)
      if (
        !writableSelection ||
        typeof writableSelection.removeAllRanges !== 'function' ||
        typeof writableSelection.addRange !== 'function'
      ) {
        return false
      }

      writableSelection.removeAllRanges()
      writableSelection.addRange(range.cloneRange())
      return true
    }

    const restoreHtmlParserStoredSelection = (
      snapshot: TextSelectionSnapshot | null = null
    ) => {
      const initialSnapshot =
        snapshot ??
        htmlParserStoredSelectionSnapshotRef.current ??
        getActiveHtmlParserSelectionSnapshot()
      ignoreHtmlParserSelectionRefreshRef.current = true
      if (
        !restoreHtmlParserSelectionSnapshot(initialSnapshot) &&
        !restoreHtmlParserStoredSelectionRange()
      ) {
        composeActiveMouseSelectionFromStoredBoundaries()
      }
      for (const delay of [0, 40, 120, 240, 360] as const) {
        window.setTimeout(() => {
          if (
            !restoreHtmlParserSelectionSnapshot(initialSnapshot) &&
            !restoreHtmlParserStoredSelectionRange()
          ) {
            composeActiveMouseSelectionFromStoredBoundaries()
          }
        }, delay)
      }
      window.setTimeout(() => {
        ignoreHtmlParserSelectionRefreshRef.current = false
      }, 700)
    }

    const cloneCurrentTextSelectionRange = () => {
      const selection = getSelectionForRoot(root)
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null
      }

      const range = selection.getRangeAt(0)
      if (
        range.startContainer.nodeType !== Node.TEXT_NODE ||
        range.endContainer.nodeType !== Node.TEXT_NODE ||
        !isNodePairInsideRoot(root, range.startContainer, range.endContainer)
      ) {
        return null
      }

      return range.cloneRange()
    }

    const restoreClonedTextRange = (range: Range | null) => {
      if (!range) return false
      const selection = getSelectionForRoot(root)
      if (!canWriteSelection(selection)) return false
      restoreSelectionRange(selection, range.cloneRange())
      return true
    }

    const hasActiveStrictMouseSelection = () => {
      const activeSelection = activeMouseSelectionRef.current
      return Boolean(
        strictMouseSelectionRef.current &&
        activeSelection.active &&
        activeSelection.startCaret &&
        activeSelection.lastCaret &&
        activeSelection.startNode &&
        activeSelection.endNode
      )
    }

    const handleContextMenuSelectionGuard = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const rootContainsTarget = Boolean(target && root.contains(target))
      const rootSelection = getSelectionForRoot(root)
      const hasNonEmptyRootSelection = Boolean(rootSelection?.toString())
      const hasLiveOverlaySelection = Boolean(
        overlayRectsRef.current.length > 0 ||
        root.querySelector('.hamster-reader__selection-overlay-path')
      )
      const shouldProtectSelection = Boolean(
        hasActiveStrictMouseSelection() ||
        (hasLiveOverlaySelection && hasNonEmptyRootSelection)
      )
      if (!shouldProtectSelection) return
      if (!rootContainsTarget && !hasLiveOverlaySelection) return

      const selectionSnapshot =
        htmlContentRef.current && !htmlParserErrorRef.current
          ? (getCurrentHtmlParserSelectionSnapshot() ??
            htmlParserStoredSelectionSnapshotRef.current ??
            getActiveHtmlParserSelectionSnapshot())
          : null
      const contextMenuRange =
        htmlContentRef.current && !htmlParserErrorRef.current
          ? cloneCurrentTextSelectionRange()
          : null

      event.preventDefault()
      event.stopImmediatePropagation()

      if (!htmlContentRef.current || htmlParserErrorRef.current) {
        if (hasActiveStrictMouseSelection()) {
          composeActiveMouseSelectionFromStoredBoundaries()
        }
        return
      }

      restoreHtmlParserStoredSelection(selectionSnapshot)
      for (const delay of [0, 80, 180] as const) {
        window.setTimeout(() => {
          restoreClonedTextRange(contextMenuRange)
        }, delay)
      }
    }

    const preserveHtmlParserSelectionForNonPrimaryMouse = (
      event: MouseEvent
    ) => {
      if (event.button === 0) return
      const target = event.target instanceof Element ? event.target : null
      if (
        !htmlContentRef.current ||
        htmlParserErrorRef.current ||
        !target ||
        !root.contains(target)
      ) {
        return
      }
      rememberCurrentHtmlParserSelection()
      if (!hasActiveStrictMouseSelection()) return

      const selectionSnapshot =
        getCurrentHtmlParserSelectionSnapshot() ??
        htmlParserStoredSelectionSnapshotRef.current ??
        getActiveHtmlParserSelectionSnapshot()
      event.stopImmediatePropagation()
      restoreHtmlParserStoredSelection(selectionSnapshot)
    }

    const handleStrictMouseMovePrevention = (event: MouseEvent) => {
      if (
        !activeMouseSelectionRef.current.active ||
        !strictMouseSelectionRef.current
      ) {
        return
      }

      if (event.buttons > 0 && (event.buttons & 1) === 0) {
        resetRootDragSelection()
        return
      }

      event.preventDefault()
    }

    root.addEventListener('mousedown', handleMouseDownSelectionStart)
    root.ownerDocument.addEventListener(
      'pointerdown',
      preserveHtmlParserSelectionForNonPrimaryMouse,
      { capture: true }
    )
    root.ownerDocument.addEventListener(
      'mousedown',
      preserveHtmlParserSelectionForNonPrimaryMouse,
      { capture: true }
    )
    root.ownerDocument.addEventListener(
      'mouseup',
      preserveHtmlParserSelectionForNonPrimaryMouse,
      { capture: true }
    )
    root.addEventListener('contextmenu', handleContextMenuSelectionGuard, {
      capture: true
    })
    root.ownerDocument.addEventListener(
      'contextmenu',
      handleContextMenuSelectionGuard,
      { capture: true }
    )
    root.addEventListener('mousemove', handleStrictMouseMovePrevention, {
      capture: true
    })

    const updateDragSelectionPreviewRects = (
      anchor: NonNullable<typeof dragSelectionAnchorRef.current>,
      caretInfo: { range: Range; pageNumber: number },
      clientX: number,
      clientY: number
    ) => {
      const focusPreviewRect = getCaretPreviewRect(caretInfo)
      if (!focusPreviewRect) return

      pinDragSelectionPages(
        anchor.previewRect.pageNumber,
        focusPreviewRect.pageNumber
      )
      const previewRects = geometryToOverlayRects(
        anchor.previewRect,
        focusPreviewRect
      )
      const nextPreview = updateDragPreview(
        dragPreviewSessionRef.current,
        { clientX, clientY },
        previewRects
      )
      setDragPreviewSession(nextPreview)

      if (
        overlayOptions?.enabled &&
        nextPreview.state === 'dragging' &&
        nextPreview.previewRects.length > 0
      ) {
        renderSelectionOverlayRects(nextPreview.previewRects)
      }
    }

    const resolveInitialDragCaret = (
      clientX: number,
      clientY: number
    ): {
      caretInfo: { range: Range; pageNumber: number } | null
      strict: boolean
    } => {
      return { caretInfo: resolveDragCaret(clientX, clientY), strict: false }
    }

    const resolvePointerDragCaret = (
      clientX: number,
      clientY: number,
      pointerType: ReturnType<typeof toReaderPointerType>
    ) => {
      if (pointerType === 'mouse' && strictMouseSelectionRef.current) {
        const direction: SupportedHitDirection =
          activeMouseSelectionRef.current.active &&
          clientX < activeMouseSelectionRef.current.startClientX
            ? 'backward'
            : 'forward'
        return resolveStrictSupportedTextHit(
          { clientX, clientY },
          root,
          null,
          direction
        )
      }

      return resolveDragCaret(clientX, clientY)
    }

    const resolvePointerStartTextHit = (input: {
      readonly clientX: number
      readonly clientY: number
      readonly pointerId: number
      readonly pointerType: ReturnType<typeof toReaderPointerType>
    }) => {
      const startedOnText = isTextSelectionStartTarget(
        input.clientX,
        input.clientY,
        input.pointerId
      )
      if (startedOnText || input.pointerType === 'touch') return startedOnText

      const snappedCaretInfo = resolveDragCaret(input.clientX, input.clientY)
      if (!snappedCaretInfo) return false

      snappedCaretInfo.range.detach()
      return true
    }

    const shouldResetPointerStart = (input: {
      readonly activePointerCount: number
      readonly isOnText: boolean
      readonly pointerType: ReturnType<typeof toReaderPointerType>
    }) => {
      if (
        shouldForceBlockSelection(interactionModeRef.current, input.pointerType)
      ) {
        return true
      }

      if (multiPointerLockedRef.current && input.activePointerCount <= 1) {
        return true
      }

      if (dragStateRef.current.active) return true

      return !shouldStartSelectionOnPointerDown({
        interactionMode: interactionModeRef.current,
        pointerType: input.pointerType,
        isOnText: input.isOnText
      })
    }

    const resolvePointerMoveCaret = (input: {
      readonly clientX: number
      readonly clientY: number
      readonly pointerType: ReturnType<typeof toReaderPointerType>
    }) => {
      const isStrictMouseMove =
        input.pointerType === 'mouse' &&
        strictMouseSelectionRef.current &&
        activeMouseSelectionRef.current.active
      const strictMouseDirection: SupportedHitDirection =
        input.clientX < activeMouseSelectionRef.current.startClientX
          ? 'backward'
          : 'forward'
      const caretInfo = isStrictMouseMove
        ? resolveStrictSupportedTextHit(
            { clientX: input.clientX, clientY: input.clientY },
            root,
            null,
            strictMouseDirection
          )
        : resolvePointerDragCaret(
            input.clientX,
            input.clientY,
            input.pointerType
          )

      return { caretInfo, isStrictMouseMove }
    }

    const composePointerMoveSelection = (input: {
      readonly anchor: NonNullable<typeof dragSelectionAnchorRef.current>
      readonly caretInfo: { range: Range; pageNumber: number }
      readonly isStrictMouseMove: boolean
    }) => {
      const activeSelection = activeMouseSelectionRef.current
      activeSelection.endNode = input.caretInfo.range.startContainer
      activeSelection.endOffset = input.caretInfo.range.startOffset
      activeSelection.lastCaret = {
        node: input.caretInfo.range.startContainer,
        offset: input.caretInfo.range.startOffset,
        clientX: activeSelection.clientX,
        clientY: activeSelection.clientY
      }
      activeSelection.lastTextElement =
        'element' in input.caretInfo &&
        input.caretInfo.element instanceof HTMLElement
          ? input.caretInfo.element
          : activeSelection.lastTextElement

      const writableSelection = getWritableSelection()
      if (!writableSelection) {
        input.caretInfo.range.detach()
        return null
      }

      if (input.isStrictMouseMove) {
        input.caretInfo.range.detach()
        const isHtmlParserStrictMove = Boolean(
          htmlContentRef.current && !htmlParserErrorRef.current
        )
        if (isHtmlParserStrictMove) {
          if (!composeActiveMouseSelectionFromStoredBoundaries()) return null
        } else {
          const range = createOrderedRange(
            input.anchor.node,
            input.anchor.offset,
            activeSelection.endNode,
            activeSelection.endOffset
          )
          composeSelection(range)
        }
        return getSelectionForRoot(root)
      }

      const range = createOrderedRange(
        input.anchor.node,
        input.anchor.offset,
        input.caretInfo.range.startContainer,
        input.caretInfo.range.startOffset
      )
      input.caretInfo.range.detach()
      composeSelection(range)

      return getSelectionForRoot(root)
    }

    const adapter = createDragSelectionAdapter(root, {
      onStart: (clientX, clientY, detail) => {
        const pointerType = toReaderPointerType(detail?.pointerType)
        const activePointerCount = detail?.activePointerCount ?? 1
        const pointerId = detail?.pointerId ?? 0

        if (pointerType === 'mouse') {
          // Cleanup-only compatibility path: strict mousedown owns mouse selection state.
          clearLongPressSession()
          return
        }

        strictMouseSelectionRef.current = false
        const isOnText = resolvePointerStartTextHit({
          clientX,
          clientY,
          pointerId,
          pointerType
        })

        if (
          shouldArmLongPress({
            interactionMode: interactionModeRef.current,
            pointerType
          }) &&
          isOnText
        ) {
          armTouchLongPress(clientX, clientY, pointerId)
          return
        }

        if (
          shouldResetPointerStart({
            activePointerCount,
            pointerType,
            isOnText
          })
        ) {
          resetRootDragSelection()
          return
        }

        const { caretInfo, strict } = resolveInitialDragCaret(clientX, clientY)
        strictMouseSelectionRef.current = strict
        if (!caretInfo) {
          resetRootDragSelection()
          return
        }

        const previewRect = getCaretPreviewRect(caretInfo)
        if (!previewRect) {
          caretInfo.range.detach()
          resetRootDragSelection()
          return
        }

        dragSelectionAnchorRef.current = {
          node: caretInfo.range.startContainer,
          offset: caretInfo.range.startOffset,
          previewRect
        }
        setDragPreviewSession(
          armDragPreview(createDragPreviewSession(), { clientX, clientY })
        )
        pinnedPagesRef.current = new Set([caretInfo.pageNumber])
        dragSelectionEndEmittedRef.current = false
        const initialTextElement =
          'element' in caretInfo && caretInfo.element instanceof HTMLElement
            ? caretInfo.element
            : null
        const activeSelection = createActiveMouseSelection({
          clientX,
          clientY,
          caretInfo,
          textElement: initialTextElement
        })
        if (!activeSelection) {
          caretInfo.range.detach()
          resetRootDragSelection()
          return
        }
        activeMouseSelectionRef.current = activeSelection
        caretInfo.range.detach()
      },
      onMove: (clientX, clientY, detail) => {
        const pointerId = detail?.pointerId ?? 0
        const pointerType = toReaderPointerType(detail?.pointerType)

        if (multiPointerLockedRef.current) {
          resetRootDragSelection()
          return
        }

        if (handleLongPressPointerMove(clientX, clientY, pointerId)) {
          return
        }

        const anchor = dragSelectionAnchorRef.current
        if (!anchor) return
        if (dragStateRef.current.active) {
          resetRootDragSelection()
          return
        }

        activeMouseSelectionRef.current.clientX = clientX
        activeMouseSelectionRef.current.clientY = clientY

        const { caretInfo, isStrictMouseMove } = resolvePointerMoveCaret({
          clientX,
          clientY,
          pointerType
        })
        if (!caretInfo) return

        updateDragSelectionPreviewRects(anchor, caretInfo, clientX, clientY)

        // Required Selection composition capability check. Do not remove: the
        // Drag adapter writes the composed range via removeAllRanges/addRange.
        const selection = composePointerMoveSelection({
          anchor,
          caretInfo,
          isStrictMouseMove
        })
        if (!selection) return

        lastDragComposedSelectionRef.current = {
          selection,
          selectedText: selection.toString()
        }

        if (
          overlayOptions?.enabled &&
          dragPreviewSessionRef.current.state !== 'dragging'
        ) {
          refreshSelectionOverlayRef.current()
        }

        if (onTextSelectionChange) {
          const detail = getSelectionDetail(selection)
          if (detail) {
            onTextSelectionChange(detail.text, detail)
          }
        }
      },
      onEnd: (clientX, clientY, detail) => {
        if (toReaderPointerType(detail?.pointerType) === 'mouse') return
        finishDragSelection(clientX, clientY)
      },
      onAllEnd: (clientX, clientY, detail) => {
        if (toReaderPointerType(detail?.pointerType) === 'mouse') return
        finishDragSelection(clientX, clientY)
      },
      getPointerType: (pointerId) => pointerTypesByIdRef.current.get(pointerId)
    })

    return () => {
      clearLongPressSession()
      adapter.destroy()
      root.removeEventListener('pointerdown', rememberPointerType, {
        capture: true
      })
      root.removeEventListener('pointermove', rememberPointerType)
      root.removeEventListener('pointerup', forgetPointerType)
      root.removeEventListener('pointercancel', forgetPointerType)
      root.removeEventListener('mousedown', handleMouseDownSelectionStart)
      root.ownerDocument.removeEventListener(
        'pointerdown',
        preserveHtmlParserSelectionForNonPrimaryMouse,
        { capture: true }
      )
      root.ownerDocument.removeEventListener(
        'mousedown',
        preserveHtmlParserSelectionForNonPrimaryMouse,
        { capture: true }
      )
      root.ownerDocument.removeEventListener(
        'mouseup',
        preserveHtmlParserSelectionForNonPrimaryMouse,
        { capture: true }
      )
      root.removeEventListener('contextmenu', handleContextMenuSelectionGuard, {
        capture: true
      })
      root.ownerDocument.removeEventListener(
        'contextmenu',
        handleContextMenuSelectionGuard,
        { capture: true }
      )
      root.removeEventListener('mousemove', handleStrictMouseMovePrevention, {
        capture: true
      })
      pointerTypesByIdRef.current.clear()
      pointerTextTargetsByIdRef.current.clear()
      activeMouseSelectionRef.current.active = false
      strictMouseSelectionRef.current = false
      ignoreHtmlParserSelectionRefreshRef.current = false
      dragSelectionAnchorRef.current = null
      pinnedPagesRef.current.clear()
      dragSelectionEndEmittedRef.current = false
      setDragPreviewSession(cancelDragPreview(dragPreviewSessionRef.current))
    }
  }, [
    viewerRootElement,
    runtimeDocument,
    overlayOptions?.enabled,
    emitSelectionEnd,
    getCaretPreviewRect,
    getSelectionDetail,
    onTextSelectionChange,
    recomposeActiveTextSelection,
    composeActiveMouseSelectionFromStoredBoundaries,
    renderSelectionOverlayRects,
    resolveStrictSupportedTextHit,
    setDragPreviewSession,
    pinDragSelectionPages
  ])

  useEffect(() => {
    if (!overlayOptions?.enabled) return

    const root = viewerRootRef.current
    if (!root) return

    // 点击页面空白区域时清除原生 selection、实时覆盖层以及已保存选择的激活状态；
    // 排除文本节点、覆盖层、手柄自身的点击。
    const handleBlankClick = (event: MouseEvent) => {
      if (ignoreNextBlankClickRef.current) {
        ignoreNextBlankClickRef.current = false
        return
      }

      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-text-id]')) return
      if (target.closest('.hamster-reader__intermediate-text')) return
      if (target.closest('.hamster-reader__html-parser-output')) return
      if (target.closest('.hamster-reader__selection-overlay')) return
      if (target.closest('.hamster-reader__selection-overlay-path')) return
      if (target.closest('.hamster-reader__selection-handles')) return
      if (target.closest('[data-handle-type]')) return
      // Task 4: 已保存选择覆盖层及其手柄的点击由独立处理器处理，不在此处清除。
      if (target.closest('.hamster-reader__saved-selection-overlay-path'))
        return
      if (target.closest('.hamster-reader__saved-selection-handles')) return
      // Blank-click cleanup is not a selection initiation path; it clears an
      // existing external or Drag-composed Selection when the user clicks empty
      // viewer space.
      const selection = getSelectionForRoot(viewerRootRef.current)
      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges()
      }
      clearOverlay()
      // Task 4: 点击空白处取消已保存选择的激活状态（仅非受控模式需要更新内部状态）。
      if (effectiveActiveSavedSelectionId !== null) {
        setActiveSavedSelectionId(null)
      }
    }

    root.addEventListener('click', handleBlankClick)
    return () => {
      root.removeEventListener('click', handleBlankClick)
    }
  }, [
    overlayOptions,
    clearOverlay,
    effectiveActiveSavedSelectionId,
    setActiveSavedSelectionId
  ])

  useEffect(() => {
    const root = viewerRootRef.current
    if (!root) return
    const ownerDocument = root.ownerDocument

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) {
        emitSelectionEnd()
      }
    }

    const restoreHtmlParserMouseSelection = () => {
      const writableSelection = getSelectionForRoot(root)
      if (!canWriteSelection(writableSelection)) {
        return composeActiveMouseSelectionFromStoredBoundaries()
      }

      const currentRange =
        writableSelection.rangeCount > 0
          ? writableSelection.getRangeAt(0)
          : null
      if (
        currentRange &&
        !currentRange.collapsed &&
        currentRange.startContainer.nodeType === Node.TEXT_NODE &&
        currentRange.endContainer.nodeType === Node.TEXT_NODE &&
        isNodePairInsideRoot(
          root,
          currentRange.startContainer,
          currentRange.endContainer
        )
      ) {
        htmlParserStoredSelectionRangeRef.current = currentRange.cloneRange()
        htmlParserStoredSelectionSnapshotRef.current = {
          startNode: currentRange.startContainer as Text,
          startOffset: currentRange.startOffset,
          endNode: currentRange.endContainer as Text,
          endOffset: currentRange.endOffset
        }
        writableSelection.removeAllRanges()
        writableSelection.addRange(currentRange.cloneRange())
        return true
      }

      const storedSnapshot = htmlParserStoredSelectionSnapshotRef.current
      if (storedSnapshot) {
        const restoredRange = restoreTextSelectionSnapshot(
          storedSnapshot,
          root,
          writableSelection
        )
        if (restoredRange) {
          htmlParserStoredSelectionRangeRef.current = restoredRange.cloneRange()
          return true
        }
      }

      if (
        restoreStoredTextRange(
          htmlParserStoredSelectionRangeRef.current,
          root,
          writableSelection
        )
      ) {
        return true
      }

      return composeActiveMouseSelectionFromStoredBoundaries()
    }

    const restoreActiveStrictMouseSelection = () => {
      const activeSelection = activeMouseSelectionRef.current
      const writableSelection = getSelectionForRoot(root)
      if (
        !canWriteSelection(writableSelection) ||
        !activeSelection.startNode ||
        !activeSelection.endNode ||
        (activeSelection.startNode === activeSelection.endNode &&
          activeSelection.startOffset === activeSelection.endOffset)
      ) {
        return false
      }

      const range = createOrderedRange(
        activeSelection.startNode,
        activeSelection.startOffset,
        activeSelection.endNode,
        activeSelection.endOffset
      )
      restoreSelectionRange(writableSelection, range)
      if (
        range.startContainer.nodeType === Node.TEXT_NODE &&
        range.endContainer.nodeType === Node.TEXT_NODE
      ) {
        htmlParserStoredSelectionRangeRef.current = range.cloneRange()
        htmlParserStoredSelectionSnapshotRef.current = {
          startNode: range.startContainer as Text,
          startOffset: range.startOffset,
          endNode: range.endContainer as Text,
          endOffset: range.endOffset
        }
      }
      return true
    }

    const restoreNonPrimaryMouseUpSelection = (event: MouseEvent) => {
      const activeSelection = activeMouseSelectionRef.current
      const shouldRestoreSelection = Boolean(
        htmlContentRef.current &&
        !htmlParserErrorRef.current &&
        strictMouseSelectionRef.current &&
        activeSelection.active &&
        activeSelection.startCaret &&
        activeSelection.lastCaret &&
        activeSelection.startNode &&
        activeSelection.endNode
      )
      if (!shouldRestoreSelection) return

      const restoreSelection = () => {
        if (
          !restoreActiveStrictMouseSelection() &&
          !restoreHtmlParserMouseSelection()
        ) {
          composeActiveMouseSelectionFromStoredBoundaries()
        }
      }

      event.preventDefault()
      restoreSelection()
      window.setTimeout(restoreSelection, 0)
    }

    // Demoted native mouseup/touchend fallback: Drag emits selection end for
    // adapter-driven gestures. These listeners only cover externally-created
    // native selections and keyboard/touch browser selection completions.
    const handleMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) {
        restoreNonPrimaryMouseUpSelection(event)
        return
      }

      if (skipNextMouseUpSelectionEndRef.current) {
        skipNextMouseUpSelectionEndRef.current = false
        activeMouseSelectionRef.current.active = false
        return
      }

      if (activeMouseSelectionRef.current.active) {
        if (activeMouseSelectionRef.current.finalized) {
          activeMouseSelectionRef.current.active = false
          return
        }

        activeMouseSelectionRef.current.clientX = event.clientX
        activeMouseSelectionRef.current.clientY = event.clientY
        ignoreNextBlankClickRef.current = true

        if (strictMouseSelectionRef.current) {
          event.preventDefault()
          if (!htmlContentRef.current || htmlParserErrorRef.current) {
            finishDragSelectionRef.current(event.clientX, event.clientY)
            return
          }
          // Chromium may still apply its native mouseup selection after React/
          // document listeners run on html-parser transformed spans. Defer the
          // final strict composition one macrotask so our text-node range wins
          // after the browser has finished its default mouseup reconciliation.
          window.setTimeout(() => {
            finishDragSelectionRef.current(event.clientX, event.clientY)
          }, 50)
          return
        }

        activeMouseSelectionRef.current.finalized = true
        recomposeActiveTextSelection(root)
      }
      emitSelectionEnd()
      activeMouseSelectionRef.current.active = false
    }

    ownerDocument.addEventListener('mouseup', handleMouseUp)
    root.addEventListener('touchend', emitSelectionEnd)
    root.addEventListener('keyup', handleKeyUp)

    return () => {
      ownerDocument.removeEventListener('mouseup', handleMouseUp)
      root.removeEventListener('touchend', emitSelectionEnd)
      root.removeEventListener('keyup', handleKeyUp)
    }
  }, [
    composeActiveMouseSelectionFromStoredBoundaries,
    emitSelectionEnd,
    recomposeActiveTextSelection
  ])

  const renderSavedSelectionEditPreview = useCallback(
    (selection: Selection): ReaderSelectionOverlayRect[] => {
      const context = savedHandleDragContextRef.current
      const viewerRoot = viewerRootRef.current
      if (!context || !viewerRoot || selection.isCollapsed) return []

      const rects = getSelectionOverlayRects(
        selection,
        viewerRoot,
        pageRefs.current,
        textElementsRef.current
      )
      if (rects.length === 0 || selection.rangeCount === 0) return []

      const previewResults = Array.from(
        resolvedSavedSelectionsRef.current.values()
      ).map((result) =>
        result.id === context.id
          ? {
              ...result,
              status: 'resolved' as const,
              range: selection.getRangeAt(0),
              rects
            }
          : result
      )
      renderSavedSelectionOverlays(previewResults, context.id)
      return rects
    },
    [renderSavedSelectionOverlays]
  )

  const commitSavedSelectionEdit = useCallback(() => {
    const context = savedHandleDragContextRef.current
    const viewerRoot = viewerRootRef.current
    if (!context || !viewerRoot) return

    const selection = getSelectionForRoot(viewerRoot)
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return
    }

    const payload =
      buildSelectionPayload(selection) ??
      buildHtmlParserSelectionPayload(selection)
    if (!payload) return

    const rects = getSelectionOverlayRects(
      selection,
      viewerRoot,
      pageRefs.current,
      textElementsRef.current
    )
    if (rects.length === 0) return

    const nextSelection = rebuildSavedSelectionFromEdit({
      previousSelection: context.previousSelection,
      selection,
      segments: payload.segments,
      rects,
      pageSizes: buildSavedSelectionEditPageSizes(payload.segments, rects)
    })
    const nextResult: ReaderSavedSelectionRestoreResult = {
      id: context.id,
      selection: nextSelection,
      status: 'resolved',
      range: selection.getRangeAt(0),
      rects,
      segments: nextSelection.segments,
      extractedText: payload.extractedText
    }

    resolvedSavedSelectionsRef.current = new Map(
      resolvedSavedSelectionsRef.current
    ).set(context.id, nextResult)
    const optimisticResults = Array.from(
      resolvedSavedSelectionsRef.current.values()
    )
    renderSavedSelectionOverlays(optimisticResults, context.id)
    refreshSavedSelectionHandles(optimisticResults, context.id)

    onSavedSelectionEdit?.(context.id, nextSelection, {
      id: context.id,
      selection: nextSelection,
      previousSelection: context.previousSelection,
      status: 'resolved',
      segments: nextSelection.segments,
      extractedText: payload.extractedText
    })
  }, [
    buildSavedSelectionEditPageSizes,
    buildHtmlParserSelectionPayload,
    onSavedSelectionEdit,
    renderSavedSelectionOverlays,
    refreshSavedSelectionHandles
  ])

  const applyHandleDragSelection = useCallback(
    (movingCaretInfo: { range: Range; pageNumber: number }) => {
      const dragState = dragStateRef.current
      if (!dragState.active || !dragState.handleType) {
        return
      }

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return

      let fixedPoint: { node: Node; offset: number } | null = null
      if (dragState.fixedAnchor) {
        // 优先使用 Drag start 时记录的固定端节点/偏移，
        // 避免因浏览器 caret resolver 抖动导致固定端漂移。
        fixedPoint = {
          node: dragState.fixedAnchor.node,
          offset: dragState.fixedAnchor.offset
        }
      } else if (dragState.fixedPoint) {
        const fixedPageElement = pageRefs.current.get(
          dragState.fixedPoint.pageNumber
        )
        if (!fixedPageElement) return
        const fixedViewportPoint = getPageViewportPoint(
          fixedPageElement,
          dragState.fixedPoint
        )
        const fixedCaretInfo = resolveCaret(
          fixedViewportPoint.x,
          fixedViewportPoint.y,
          {
            viewerRoot,
            pageRefs: pageRefs.current,
            textElements: textElementsRef.current
          }
        )
        if (!fixedCaretInfo) return
        fixedPoint = {
          node: fixedCaretInfo.range.startContainer,
          offset: fixedCaretInfo.range.startOffset
        }
        fixedCaretInfo.range.detach()
      }
      if (!fixedPoint) return

      const movingPoint = {
        node: movingCaretInfo.range.startContainer,
        offset: movingCaretInfo.range.startOffset
      }
      if (dragState.fixedPoint) {
        pinDragSelectionPages(
          dragState.fixedPoint.pageNumber,
          movingCaretInfo.pageNumber
        )
      }
      const startPoint =
        dragState.handleType === 'start' ? movingPoint : fixedPoint
      const endPoint =
        dragState.handleType === 'start' ? fixedPoint : movingPoint
      const newRange = createOrderedRange(
        startPoint.node,
        startPoint.offset,
        endPoint.node,
        endPoint.offset
      )
      composeSelection(newRange)
      const selection = getSelectionForRoot(viewerRoot)
      if (dragState.source === 'saved' && selection) {
        renderSavedSelectionEditPreview(selection)
      } else {
        // 手动触发覆盖层刷新：测试环境下 mock 的 selection 不会自动派发 selectionchange，
        // 真实浏览器中此处也提前刷新，避免拖动期间出现一帧延迟。
        refreshSelectionOverlayRef.current()
      }
    },
    [pinDragSelectionPages, renderSavedSelectionEditPreview]
  )

  const beginHandleDrag = useCallback(
    (handleType: 'start' | 'end', source: 'live' | 'saved' = 'live') => {
      if (dragStateRef.current.active || dragSelectionAnchorRef.current) {
        return false
      }

      let range: Range | null = null
      if (source === 'saved') {
        const activeSavedId = effectiveActiveSavedSelectionId
        const activeResult = activeSavedId
          ? resolvedSavedSelectionsRef.current.get(activeSavedId)
          : undefined
        if (
          !activeResult ||
          activeResult.status !== 'resolved' ||
          !activeResult.range
        ) {
          savedHandleDragContextRef.current = null
          return false
        }
        savedHandleDragContextRef.current = {
          id: activeResult.id,
          previousSelection: activeResult.selection
        }
        range = activeResult.range
        clearOverlay()
      } else {
        savedHandleDragContextRef.current = null
        // Retained as handle-drag seed state only: the per-handle Drag adapter has
        // already initiated the gesture, and this reads the current Selection range
        // to determine the fixed anchor for subsequent composed updates.
        const selection = getSelectionForRoot(viewerRootRef.current)
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          return false
        }
        range = selection.getRangeAt(0)
      }

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot || !range) return false

      // 记录固定端的实际节点/偏移；start 手柄拖动 → 固定端=range.end，反之亦然
      const fixedAnchor =
        handleType === 'start'
          ? { node: range.endContainer, offset: range.endOffset }
          : { node: range.startContainer, offset: range.startOffset }

      const fixedAnchorDocument =
        fixedAnchor.node.ownerDocument ?? viewerRoot.ownerDocument
      const fixedRange = fixedAnchorDocument.createRange()
      fixedRange.setStart(fixedAnchor.node, fixedAnchor.offset)
      fixedRange.collapse(true)

      const fixedRect = fixedRange.getBoundingClientRect()
      fixedRange.detach()

      const fixedPageInfo = getPageElementForPoint(
        fixedRect.left,
        fixedRect.top,
        viewerRoot,
        pageRefs.current
      )

      if (!fixedPageInfo) return false

      const fixedPageRect = fixedPageInfo.pageElement.getBoundingClientRect()

      dragStateRef.current = {
        active: true,
        handleType,
        source,
        fixedPoint: {
          x: fixedRect.left - fixedPageRect.left,
          y: fixedRect.top - fixedPageRect.top,
          pageNumber: fixedPageInfo.pageNumber
        },
        fixedAnchor
      }
      pinnedPagesRef.current = new Set([fixedPageInfo.pageNumber])

      // 手柄拖拽接管后，清理主文本 Drag 的临时状态，避免 root adapter 同时合成选择区。
      dragSelectionAnchorRef.current = null
      activeMouseSelectionRef.current.active = false
      return true
    },
    [clearOverlay, effectiveActiveSavedSelectionId]
  )

  const applyHandleDragAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragStateRef.current.active || !dragStateRef.current.handleType)
        return false

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return false

      const caretInfo = resolveCaret(clientX, clientY, {
        viewerRoot,
        pageRefs: pageRefs.current,
        textElements: textElementsRef.current,
        // 拖拽手柄时启用「Y 钳制到最近文本行」精度修复：避免鼠标稍微偏离行
        // 时浏览器 caret API 把光标吸附到行首/行末，丢失 X 携带的字符级精度。
        snapToNearestLine: true
      })

      if (!caretInfo) return false

      applyHandleDragSelection(caretInfo)
      caretInfo.range.detach()
      return true
    },
    [applyHandleDragSelection]
  )

  const finishHandleDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragStateRef.current.active) return

      applyHandleDragAtPoint(clientX, clientY)

      const selection = getSelectionForRoot(viewerRootRef.current)
      if (selection && !selection.isCollapsed) {
        // 端点拖拽期间会临时禁用手柄 pointer-events，浏览器随后合成的 click
        // 可能落到下方空白页上；这里消费一次空白点击，避免误清掉刚调整好的选区。
        ignoreNextBlankClickRef.current = true
      }

      const dragSource = dragStateRef.current.source
      dragStateRef.current = {
        active: false,
        handleType: null,
        source: 'live',
        fixedPoint: null,
        fixedAnchor: null
      }
      pinnedPagesRef.current.clear()

      if (dragSource === 'saved') {
        commitSavedSelectionEdit()
        const selection = getSelectionForRoot(viewerRootRef.current)
        if (selection && typeof selection.removeAllRanges === 'function') {
          // 保存选区拖拽使用原生 Selection 作为临时编辑载体；提交后立即清掉，
          // 避免后续 selectionchange 把它误判成新的实时选区并取消已保存 overlay。
          selection.removeAllRanges()
        }
        clearOverlay()
        savedHandleDragContextRef.current = null
      } else {
        emitSelectionEnd()
      }
    },
    [
      applyHandleDragAtPoint,
      clearOverlay,
      commitSavedSelectionEdit,
      emitSelectionEnd
    ]
  )

  useEffect(() => {
    const root = viewerRootElement
    if (
      !root ||
      !runtimeDocument ||
      selectionHandleElement === null ||
      !(selectionHandleAdapterKey || savedSelectionHandleAdapterKey)
    ) {
      return
    }

    const handleElements: Array<{
      element: HTMLElement
      handleType: 'start' | 'end'
      source: 'live' | 'saved'
    }> = []
    for (const element of Array.from(
      root.querySelectorAll<HTMLElement>('[data-handle-type]')
    )) {
      const handleType = element.dataset.handleType
      if (handleType === 'start' || handleType === 'end') {
        handleElements.push({
          element,
          handleType,
          source:
            element.dataset.selectionHandleScope === 'saved' ? 'saved' : 'live'
        })
      }
    }

    if (handleElements.length === 0) return

    // Guard only: per-handle Drag owns start/move/end. These native pointer
    // listeners prevent the same pointer stream from bubbling into the root
    // adapter or triggering browser-native handle behavior.
    const stopHandlePointerEvent = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const pointerEventTypes = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel'
    ] as const

    const fallbackDragState = {
      active: false,
      pointerId: null as number | null,
      element: null as HTMLElement | null
    }

    const fallbackPointerMove = (event: PointerEvent) => {
      if (!fallbackDragState.active) return
      if (fallbackDragState.pointerId !== event.pointerId) return
      event.preventDefault()
      applyHandleDragAtPoint(event.clientX, event.clientY)
    }

    const fallbackPointerEnd = (event: PointerEvent) => {
      if (!fallbackDragState.active) return
      if (fallbackDragState.pointerId !== event.pointerId) return
      event.preventDefault()
      const activeElement = fallbackDragState.element
      fallbackDragState.active = false
      fallbackDragState.pointerId = null
      fallbackDragState.element = null
      if (activeElement) {
        activeElement.style.pointerEvents = ''
      }
      finishHandleDrag(event.clientX, event.clientY)
      globalThis.document.removeEventListener(
        'pointermove',
        fallbackPointerMove
      )
      globalThis.document.removeEventListener('pointerup', fallbackPointerEnd)
      globalThis.document.removeEventListener(
        'pointercancel',
        fallbackPointerEnd
      )
    }

    const adapters = handleElements.map(({ element, handleType, source }) => {
      const adapter = createDragSelectionAdapter(element, {
        onStart: () => {
          // 拖动开始时，禁用端点图标的指针事件，防止 mouseup 触发在端点上
          element.style.pointerEvents = 'none'
          beginHandleDrag(handleType, source)
        },
        onMove: (clientX, clientY) => {
          if (dragStateRef.current.handleType !== handleType) return
          if (dragStateRef.current.source !== source) return
          applyHandleDragAtPoint(clientX, clientY)
        },
        onEnd: (clientX, clientY) => {
          // 拖动结束时，恢复端点图标的指针事件
          element.style.pointerEvents = ''
          finishHandleDrag(clientX, clientY)
        },
        onAllEnd: (clientX, clientY) => {
          // 拖动结束时，恢复端点图标的指针事件
          element.style.pointerEvents = ''
          finishHandleDrag(clientX, clientY)
        }
      })

      const fallbackPointerStart = (event: PointerEvent) => {
        const dragAlreadyStarted =
          dragStateRef.current.active &&
          dragStateRef.current.handleType === handleType &&
          dragStateRef.current.source === source
        if (!dragAlreadyStarted && !beginHandleDrag(handleType, source)) return
        event.preventDefault()
        event.stopPropagation()
        element.style.pointerEvents = 'none'
        fallbackDragState.active = true
        fallbackDragState.pointerId = event.pointerId
        fallbackDragState.element = element
        globalThis.document.addEventListener('pointermove', fallbackPointerMove)
        globalThis.document.addEventListener('pointerup', fallbackPointerEnd)
        globalThis.document.addEventListener(
          'pointercancel',
          fallbackPointerEnd
        )
      }

      element.addEventListener('pointerdown', fallbackPointerStart)

      pointerEventTypes.forEach((eventType) => {
        element.addEventListener(eventType, stopHandlePointerEvent)
      })

      return { adapter, element, fallbackPointerStart }
    })

    return () => {
      globalThis.document.removeEventListener(
        'pointermove',
        fallbackPointerMove
      )
      globalThis.document.removeEventListener('pointerup', fallbackPointerEnd)
      globalThis.document.removeEventListener(
        'pointercancel',
        fallbackPointerEnd
      )

      for (const { adapter, element, fallbackPointerStart } of adapters) {
        element.removeEventListener('pointerdown', fallbackPointerStart)
        for (const eventType of pointerEventTypes) {
          element.removeEventListener(eventType, stopHandlePointerEvent)
        }
        // 清理时恢复端点图标的指针事件，防止因 effect 重新运行导致端点图标永久禁用
        element.style.pointerEvents = ''
        adapter.destroy()
      }

      if (dragStateRef.current.active) {
        dragStateRef.current = {
          active: false,
          handleType: null,
          source: 'live',
          fixedPoint: null,
          fixedAnchor: null
        }
        savedHandleDragContextRef.current = null
      }
    }
  }, [
    viewerRootElement,
    selectionHandleAdapterKey,
    savedSelectionHandleAdapterKey,
    runtimeDocument,
    selectionHandleElement,
    beginHandleDrag,
    applyHandleDragAtPoint,
    finishHandleDrag
  ])

  const renderSelectionHandle = useCallback(
    (
      type: 'start' | 'end',
      position: ReaderSelectionHandlePosition,
      hidden?: boolean,
      scope: 'live' | 'saved' = 'live'
    ): React.ReactNode => {
      if (selectionHandleElement === null) return null
      const baseStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${position.rootX ?? position.x}px`,
        top: `${position.rootY ?? position.y}px`,
        pointerEvents: hidden ? 'none' : 'auto'
      }
      const hiddenModifier = hidden
        ? ' hamster-reader__selection-handle--hidden'
        : ''
      const baseClassName = `hamster-reader__selection-handle hamster-reader__selection-handle--${type}${hiddenModifier}`
      const hiddenAttrs: Record<string, string> = hidden
        ? { 'aria-hidden': 'true', 'data-selection-handle-hidden': 'true' }
        : {}

      if (selectionHandleElement === undefined) {
        // 默认 Android 水滴样式手柄；具体外观由 SCSS 控制。
        // 使用文字高度驱动触控区域尺寸，未提供时由 SCSS 回退到 18×24px。
        const defaultStyle: React.CSSProperties = {
          ...baseStyle,
          '--hamster-reader-selection-handle-width': `${position.hitAreaWidth}px`,
          '--hamster-reader-selection-handle-height': `${position.hitAreaHeight}px`
        } as React.CSSProperties
        return (
          <div
            key={type}
            data-handle-type={type}
            data-selection-handle-scope={scope}
            className={`${baseClassName} hamster-reader__selection-handle--default hamster-reader__selection-handle--default-${type}`}
            style={defaultStyle}
            {...hiddenAttrs}
          />
        )
      }

      const isIntrinsicElement = typeof selectionHandleElement.type === 'string'
      const existingProps = (selectionHandleElement.props ?? {}) as {
        className?: string
        style?: React.CSSProperties
        textHeight?: number
        hitAreaWidth?: number
        hitAreaHeight?: number
      }
      const mergedClassName = [existingProps.className, baseClassName]
        .filter(Boolean)
        .join(' ')
      const mergedStyle: React.CSSProperties = {
        ...(existingProps.style ?? {}),
        ...baseStyle
      }
      // 只有自定义组件才传递文字高度元数据，避免把未知属性注入 DOM 元素
      // （如 <button>）触发 React 警告。
      const sizingProps = isIntrinsicElement
        ? {}
        : {
            position,
            textHeight: position.textHeight,
            hitAreaWidth: position.hitAreaWidth,
            hitAreaHeight: position.hitAreaHeight
          }
      return React.cloneElement(
        selectionHandleElement as React.ReactElement<{
          position?: ReaderSelectionHandlePosition
          className?: string
          style?: React.CSSProperties
          'data-handle-type'?: string
          'data-selection-handle-scope'?: string
          key?: string
          textHeight?: number
          hitAreaWidth?: number
          hitAreaHeight?: number
        }>,
        {
          key: type,
          className: mergedClassName,
          style: mergedStyle,
          'data-handle-type': type,
          'data-selection-handle-scope': scope,
          ...sizingProps,
          ...hiddenAttrs
        }
      )
    },
    [selectionHandleElement]
  )

  // 渲染 direct 模式页面内部内容（base image、overlay 容器、加载/错误状态、文本 spans）。
  // 被 direct 分支和 html-parser 模式下的 fallback/loading 页面共享。
  const renderDirectPageInner = (pageNumber: number) => {
    const texts = textsByPageNumber.get(pageNumber) ?? []
    const ocrTexts = ocrTextsByPageNumber.get(pageNumber) ?? []
    const allTexts = [...texts, ...ocrTexts]
    const directPageStatus = pageStatuses.get(pageNumber)
    const isDirectPageLoading =
      loadablePages.has(pageNumber) &&
      directPageStatus !== 'loaded' &&
      directPageStatus !== 'error'
    const directBaseImageSource = baseImagesByPageNumber.get(pageNumber)

    return (
      <>
        {directBaseImageSource && (
          <img
            className='hamster-reader__intermediate-page-base-image'
            src={directBaseImageSource}
            alt=''
            aria-hidden='true'
          />
        )}
        {overlayOptions?.enabled && (
          <div
            ref={(el) => {
              if (el) {
                overlayContainerRefs.current.set(pageNumber, el)
                allOverlayContainersRef.current.add(el)
              } else {
                overlayContainerRefs.current.delete(pageNumber)
              }
            }}
            className='hamster-reader__selection-overlay'
            role='presentation'
            aria-hidden='true'
            {...overlayBodyDragProps}
            style={
              {
                '--hamster-reader-selection-color': overlayOptions.color,
                '--hamster-reader-selection-opacity': overlayOptions.opacity,
                ...overlayBodyDragStyle
              } as React.CSSProperties
            }
          />
        )}
        {/* Task 4: 已保存选择覆盖层，每页独立容器。 */}
        {overlayOptions?.enabled && (
          <div
            ref={(el) => {
              if (el) {
                savedOverlayContainerRefs.current.set(pageNumber, el)
              } else {
                savedOverlayContainerRefs.current.delete(pageNumber)
              }
            }}
            className='hamster-reader__saved-selection-overlay'
            role='presentation'
            aria-hidden='true'
            onClick={handleSavedOverlayClick}
            style={
              {
                '--hamster-reader-saved-selection-color': overlayOptions.color,
                '--hamster-reader-saved-selection-opacity':
                  overlayOptions.opacity
              } as React.CSSProperties
            }
          />
        )}
        {overlayOptions?.enabled && selectionHandleElement !== null && (
          <div
            className='hamster-reader__saved-selection-handles'
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none'
            }}
          >
            {(() => {
              const savedEntry = savedSelectionHandlePositions.get(pageNumber)
              if (!savedEntry) return null
              return (
                <>
                  {savedEntry.start &&
                    renderSelectionHandle(
                      'start',
                      savedEntry.start,
                      false,
                      'saved'
                    )}
                  {savedEntry.end &&
                    renderSelectionHandle(
                      'end',
                      savedEntry.end,
                      false,
                      'saved'
                    )}
                </>
              )
            })()}
          </div>
        )}
        {overlayOptions?.enabled && selectionHandleElement !== null && (
          <div
            className='hamster-reader__selection-handles'
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none'
            }}
          >
            {(() => {
              const handlesHidden =
                !shouldShowSelectionHandles(dragPreviewState)
              const entry = selectionHandlePositions.get(pageNumber)
              if (!entry) return null
              return (
                <>
                  {entry.start &&
                    renderSelectionHandle('start', entry.start, handlesHidden)}
                  {entry.end &&
                    renderSelectionHandle('end', entry.end, handlesHidden)}
                </>
              )
            })()}
          </div>
        )}
        {isDirectPageLoading && (
          <div className='hamster-reader__intermediate-page-status'>
            Loading page {pageNumber}…
          </div>
        )}
        {directPageStatus === 'error' && (
          <div className='hamster-reader__intermediate-page-status hamster-reader__intermediate-page-status--error'>
            Failed to load page {pageNumber}
          </div>
        )}
        {allTexts.map((textData) => {
          const text = textData as RenderableIntermediateText
          const bbox = getTextBbox(text)
          const spanStyle = buildTextSpanStyle(text, bbox)

          return (
            <span
              key={text.id}
              ref={setTextRef(text, pageNumber)}
              className='hamster-reader__intermediate-text'
              data-text-id={text.id}
              data-page-number={pageNumber}
              style={spanStyle}
            >
              {text.content}
            </span>
          )
        })}
      </>
    )
  }

  if (!runtimeDocument) {
    return (
      <div
        ref={setViewerRootRef}
        className={rootClassName}
        data-testid='intermediate-document-viewer'
      />
    )
  }

  return (
    <div
      ref={setViewerRootRef}
      role='document'
      className={rootClassName}
      data-testid='intermediate-document-viewer'
    >
      {pageNumbers.length > 0 ? (
        <VirtualPaper
          renderMode={VirtualPaperRenderMode.Transform}
          transform={virtualPaperTransform}
          minScale={scaleRange.min}
          maxScale={scaleRange.max}
          onTransformChange={handleVirtualPaperTransformChange}
          onTransformChangeEnd={handleVirtualPaperTransformChangeEnd}
        >
          {renderMode !== 'direct' ? (
            <>
              <div
                className='hamster-reader__html-parser-output'
                data-testid='html-parser-output'
              >
                <div className='hamster-note-document'>
                  {pageNumbers.map((pageNumber) => {
                    const htmlPageSize = normalizePageSize(
                      runtimeDocument.getPageSizeByPageNumber(pageNumber)
                    )
                    const htmlPageStatusEntry =
                      htmlPageStatusesByPageNumber.get(pageNumber)
                    const htmlPageHtmlEntry =
                      htmlPagesByPageNumber.get(pageNumber)
                    const isHtmlPageDecoded =
                      htmlPageStatusEntry === 'decoded' &&
                      Boolean(htmlPageHtmlEntry)

                    return (
                      <div
                        key={pageNumber}
                        ref={setPageRef(pageNumber)}
                        className='hamster-reader__intermediate-page'
                        data-testid={`intermediate-page-${pageNumber}`}
                        data-page-number={pageNumber}
                        data-page-size-unavailable={
                          htmlPageSize.pageSizeUnavailable ? 'true' : undefined
                        }
                        style={{
                          position: 'relative',
                          width: `${htmlPageSize.width}px`,
                          height: `${htmlPageSize.height}px`,
                          overflow: 'hidden'
                        }}
                      >
                        {isHtmlPageDecoded ? (
                          <div
                            // The HTML comes from the trusted @hamster-note/html-parser package,
                            // which converts IntermediateDocument data into per-page HTML fragments.
                            // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted html-parser output
                            dangerouslySetInnerHTML={{
                              __html: htmlPageHtmlEntry ?? ''
                            }}
                          />
                        ) : (
                          renderDirectPageInner(pageNumber)
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {overlayOptions?.enabled && (
                <div
                  ref={(el) => {
                    overlayElRef.current = el
                    if (el) {
                      allOverlayContainersRef.current.add(el)
                    }
                  }}
                  className='hamster-reader__selection-overlay'
                  role='presentation'
                  aria-hidden='true'
                  {...overlayBodyDragProps}
                  style={
                    {
                      '--hamster-reader-selection-color': overlayOptions.color,
                      '--hamster-reader-selection-opacity':
                        overlayOptions.opacity,
                      ...overlayBodyDragStyle
                    } as React.CSSProperties
                  }
                />
              )}
              {/* Task 4: 已保存选择覆盖层，独立于实时选择覆盖层。 */}
              {overlayOptions?.enabled && (
                <div
                  ref={(el) => {
                    savedOverlayElRef.current = el
                  }}
                  className='hamster-reader__saved-selection-overlay'
                  role='presentation'
                  aria-hidden='true'
                  onClick={handleSavedOverlayClick}
                  style={
                    {
                      '--hamster-reader-saved-selection-color':
                        overlayOptions.color,
                      '--hamster-reader-saved-selection-opacity':
                        overlayOptions.opacity
                    } as React.CSSProperties
                  }
                />
              )}
              {overlayOptions?.enabled && selectionHandleElement !== null && (
                <div
                  className='hamster-reader__saved-selection-handles'
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none'
                  }}
                >
                  {Array.from(savedSelectionHandlePositions.entries()).flatMap(
                    ([pageNumber, entry]) => {
                      const nodes: React.ReactNode[] = []
                      if (entry.start) {
                        nodes.push(
                          <React.Fragment key={`saved-start-${pageNumber}`}>
                            {renderSelectionHandle(
                              'start',
                              entry.start,
                              false,
                              'saved'
                            )}
                          </React.Fragment>
                        )
                      }
                      if (entry.end) {
                        nodes.push(
                          <React.Fragment key={`saved-end-${pageNumber}`}>
                            {renderSelectionHandle(
                              'end',
                              entry.end,
                              false,
                              'saved'
                            )}
                          </React.Fragment>
                        )
                      }
                      return nodes
                    }
                  )}
                </div>
              )}
              {overlayOptions?.enabled && selectionHandleElement !== null && (
                <div
                  className='hamster-reader__selection-handles'
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none'
                  }}
                >
                  {Array.from(selectionHandlePositions.entries()).flatMap(
                    ([pageNumber, entry]) => {
                      const handlesHidden =
                        !shouldShowSelectionHandles(dragPreviewState)
                      const nodes: React.ReactNode[] = []
                      if (entry.start) {
                        nodes.push(
                          <React.Fragment key={`start-${pageNumber}`}>
                            {renderSelectionHandle(
                              'start',
                              entry.start,
                              handlesHidden
                            )}
                          </React.Fragment>
                        )
                      }
                      if (entry.end) {
                        nodes.push(
                          <React.Fragment key={`end-${pageNumber}`}>
                            {renderSelectionHandle(
                              'end',
                              entry.end,
                              handlesHidden
                            )}
                          </React.Fragment>
                        )
                      }
                      return nodes
                    }
                  )}
                </div>
              )}
            </>
          ) : (
            pageNumbers.map((pageNumber) => {
              const directPageSize = normalizePageSize(
                runtimeDocument.getPageSizeByPageNumber(pageNumber)
              )
              const directPageStatusEntry = pageStatuses.get(pageNumber)
              const isDirectPageLoading =
                loadablePages.has(pageNumber) &&
                directPageStatusEntry !== 'loaded' &&
                directPageStatusEntry !== 'error'
              const directPageClassName = isDirectPageLoading
                ? 'hamster-reader__intermediate-page hamster-reader__intermediate-page--loading'
                : 'hamster-reader__intermediate-page'

              return (
                <div
                  key={pageNumber}
                  ref={setPageRef(pageNumber)}
                  className={directPageClassName}
                  data-testid={`intermediate-page-${pageNumber}`}
                  data-page-number={pageNumber}
                  data-page-size-unavailable={
                    directPageSize.pageSizeUnavailable ? 'true' : undefined
                  }
                  style={{
                    position: 'relative',
                    width: `${directPageSize.width}px`,
                    height: `${directPageSize.height}px`,
                    overflow: 'hidden'
                  }}
                >
                  {renderDirectPageInner(pageNumber)}
                </div>
              )
            })
          )}
        </VirtualPaper>
      ) : null}
    </div>
  )
}
