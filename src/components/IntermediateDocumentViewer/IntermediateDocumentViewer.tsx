import { HtmlParser, type DecodeOptions } from '@hamster-note/html-parser'
import { Selection as HamsterSelection } from '@hamster-note/selection'
import type {
  MousePosition as HamsterMousePosition,
  OverlayRectType as HamsterOverlayRectType,
  SelectionRange as HamsterSelectionRange,
  SelectionRef as HamsterSelectionRef
} from '@hamster-note/selection'
import {
  IntermediateDocument,
  type IntermediateContent,
  type IntermediateDocumentSerialized,
  type IntermediateText
} from '@hamster-note/types'
import {
  VirtualPaper,
  VirtualPaperInteractionMode,
  type VirtualPaperTransform,
  type VirtualPaperTransformMeta
} from '@hamster-note/virtual-paper'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isHtmlParserSelectionTarget } from '../selection/caretResolver'
import {
  buildSelectionPayload,
  textElementRecords,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload
} from '../selection/selectionPayloadSerializer'

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

const getSelectionForRoot = (
  viewerRoot: HTMLElement | null
): Selection | null => {
  return viewerRoot?.ownerDocument.defaultView?.getSelection?.() ?? null
}

export type ReaderTextSelectionDetail = {
  text: IntermediateText
  texts: IntermediateText[]
  selectedText: string
  pageNumber: number
  selection: Selection
}

/**
 * Reader 前缀的 Selection 库类型别名。
 * Reader 已导出大量 selection 符号（ReaderSavedSelection 系列、
 * ReaderSelectionOverlayRect 等），这里使用 Reader 前缀避免与
 * @hamster-note/selection 库的原生类型名冲突。
 */
export type ReaderSelectionRange = HamsterSelectionRange
export type ReaderSelectionRef = HamsterSelectionRef
export type ReaderMousePosition = HamsterMousePosition
export type ReaderSelectionOverlayRectType = HamsterOverlayRectType

export type ReaderPageRange = {
  start: number
  end: number
}

export type ReaderRenderMode = 'html-parser' | 'direct'

/** 背景质量级别：low（低）、medium（中）、high（高） */
export type BackgroundQuality = 'low' | 'medium' | 'high'

/**
 * 选择覆盖层矩形区域。
 *
 * 坐标原由可选 `origin` 字段标识：
 * - `'viewport'`    — 来自 Range.getClientRects / getBoundingClientRect 的浏览器视口坐标，
 *                      viewer 边界需调用 convertSavedSelectionRectToPageRect 转为页面相对坐标。
 * - `'page-relative'` — 已是页面像素相对坐标（来自归一化 bbox 反归一化或 visual fallback），
 *                      viewer 边界不应再做 viewport→page-relative 转换，否则会双重偏移。
 * - `undefined`     — 历史调用方未显式标注，按 viewport 坐标处理（向后兼容）。
 */
export type ReaderSelectionOverlayRect = {
  x: number
  y: number
  width: number
  height: number
  pageNumber: number
  /** 坐标原点标识，用于 viewer 边界区分 viewport / page-relative */
  origin?: 'viewport' | 'page-relative'
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
  /** 恢复后的覆盖层矩形，坐标原点由 rectsOrigin 标识 */
  rects: ReaderSelectionOverlayRect[]
  /**
   * rects 的坐标原点：
   * - `'viewport'`      — 浏览器视口坐标，viewer 需转为 page-relative
   * - `'page-relative'` — 已是页面相对像素坐标，viewer 不应二次转换
   * - `'mixed'`         — 混合来源，需逐 rect 检查 origin 字段
   * - `undefined`       — 历史行为，按 viewport 处理（向后兼容）
   */
  rectsOrigin?: 'viewport' | 'page-relative' | 'mixed'
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
  // ---- Selection 库集成 props（仅 html-parser 模式生效）----
  /** 受控的已高亮 range 列表；传入时组件不内部 mutation，缺失则用内部 state 从 defaultRanges 初始化 */
  ranges?: ReaderSelectionRange[]
  /** 非受控模式下 ranges 的初始值，默认空数组 */
  defaultRanges?: ReaderSelectionRange[]
  /** 受控的当前选中 range ID；null 表示未选中；缺失则用内部 state 从 defaultSelectedRangeId 初始化 */
  selectedRangeId?: string | null
  /** 非受控模式下 selectedRangeId 的初始值，默认 null */
  defaultSelectedRangeId?: string | null
  /** 用户确认高亮时触发；非受控 ranges 模式下内部先 append range 再回调 */
  onSelect?: (range: ReaderSelectionRange) => void
  /** 用户点击或取消选中某个已高亮 range 时触发 */
  onSelectRange?: (id: string | null) => void
  /** 用户开始选择时触发（容器内 mousedown），mousePos 为 viewport 坐标 */
  onSelectionStart?: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  /** 用户结束选择时触发（容器内 mouseup 且有有效选区）；注意 Selection 库此回调基于 mouseup，touch 选择可能不触发 */
  onSelectionEnd?: (mousePos: ReaderMousePosition, selection: Selection) => void
  /** 执行高亮操作时额外触发（在 onSelect 之后） */
  onHighlight?: (range: ReaderSelectionRange) => void
  /** 已确认高亮的 Overlay 颜色（CSS color），默认半透明黄 */
  highlightColor?: string
  /** 正在选择中的临时 Overlay 颜色（CSS color），默认半透明粉 */
  selectionColor?: string
  /** 当某个高亮被选中时，在其上方弹出的 Popover 内容（ReactNode），由调用方完全控制 */
  selectionPopover?: React.ReactNode
  /** Selection 组件的命令式 ref，暴露 highlight()/clear() 方法，仅 html-parser 模式有效 */
  selectionRef?: React.Ref<ReaderSelectionRef>
  /** 选区 Overlay 矩形坐标类型；默认 'percent' */
  overlayRectType?: ReaderSelectionOverlayRectType
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

// 已移除自定义 SVG 选区 overlay 的拖拽 hook；文本选择改回浏览器原生 Selection。

/**
 * 记忆化 HTML 页面内容子组件
 *
 * 隔离 dangerouslySetInnerHTML，使其不受父组件 IntermediateDocumentViewer
 * 中无关 state 变化（选区、overlay 等）导致的重新渲染影响。
 *
 * React.memo 对 string prop 做浅比较（值比较），所以当 html 字符串未变化时
 * 不会重新渲染，从而避免触发浏览器侧的 Parse HTML + set innerHTML。
 */
const HtmlPageContent = React.memo(({ html }: { html: string }) => {
  // 缓存 dangerouslySetInnerHTML 对象，稳定对象 identity
  const htmlObj = useMemo(() => ({ __html: html }), [html])
  return (
    <div
      // HTML 来自受信任的 @hamster-note/html-parser 包，
      // 将 IntermediateDocument 数据转换为每页 HTML 片段。
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted html-parser output
      dangerouslySetInnerHTML={htmlObj}
    />
  )
})

HtmlPageContent.displayName = 'HtmlPageContent'

export function IntermediateDocumentViewer({
  document,
  serializedDocument,
  className,
  overscan = 1,
  pageRange,
  renderMode = 'html-parser',
  backgroundQuality = 'high',
  ocr,
  onOcrError,
  onTextSelectionChange,
  onTextSelectionEnd,
  onSelectText,
  scale,
  defaultScale,
  onScaleChange,
  minScale,
  maxScale,
  maxLoadedPages,
  interactionMode = 'default',
  ranges,
  defaultRanges,
  selectedRangeId,
  defaultSelectedRangeId,
  onSelect,
  onSelectRange,
  onSelectionStart: onSelectionStartProp,
  onSelectionEnd: onSelectionEndProp,
  onHighlight,
  highlightColor,
  selectionColor,
  selectionPopover,
  selectionRef,
  overlayRectType = 'percent'
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

  const maxLoadedPagesRef = useRef(maxLoadedPages)
  maxLoadedPagesRef.current = maxLoadedPages
  // 交互模式 ref，供后续手势逻辑读取（Wave 1 仅透传，不做行为分支）
  const interactionModeRef = useRef(interactionMode)
  interactionModeRef.current = interactionMode

  // ---- Selection 库受控/非受控 state ----
  // ranges 受控（prop 提供）则直接用；否则内部 state 从 defaultRanges 初始化
  const isRangesControlled = ranges !== undefined
  const [internalRanges, setInternalRanges] = useState<ReaderSelectionRange[]>(
    () => defaultRanges ?? []
  )
  const effectiveRanges = isRangesControlled ? ranges! : internalRanges

  // selectedRangeId 同理
  const isSelectedRangeIdControlled = selectedRangeId !== undefined
  const [internalSelectedRangeId, setInternalSelectedRangeId] = useState<
    string | null
  >(defaultSelectedRangeId ?? null)
  const effectiveSelectedRangeId = isSelectedRangeIdControlled
    ? selectedRangeId!
    : internalSelectedRangeId

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
  const [loadablePages, setLoadablePages] = useState(() => new Set<number>())
  const loadablePagesRef = useRef(loadablePages)
  const [visiblePages, setVisiblePages] = useState(() => new Set<number>())
  const pageLastVisibleAtRef = useRef(new Map<number, number>())
  const evictionTimerRef = useRef<
    ReturnType<typeof requestIdleCallback> | number | null
  >(null)
  const activePinchRef = useRef(false)
  const multiPointerLockedRef = useRef(false)
  // 跟踪 VirtualPaper 是否正在活动 transform（pan/zoom），用于在 transform 期间暂停 eviction
  const isTransformingRef = useRef(false)
  // transform 结束后递增，驱动 eviction effect 在活动 transform 期间被跳过后重新执行
  const [evictionBump, setEvictionBump] = useState(0)
  // 标记活动 transform 期间是否有 eviction 被跳过，仅在确实跳过时才在 transform 结束后补偿
  const evictionSkippedDuringTransformRef = useRef(false)
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
  // 已保存选择的解析结果（按 id 索引），在 mount/update 时计算并缓存。
  // 已移除组件内自定义 SVG overlay 状态、容器 refs 与手柄状态，保留已保存选择类型缓存供数据流程使用。
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

      // 新版 virtual-paper 的 meta 不再包含 focalPoint
      onScaleChange?.(clampedScale, { source })
    },
    [onScaleChange, scale, scaleRange]
  )

  const handleVirtualPaperTransformChange = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      isTransformingRef.current = true
      handleVirtualPaperTransform(nextTransform, meta)
    },
    [handleVirtualPaperTransform]
  )

  const handleVirtualPaperTransformChangeEnd = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      isTransformingRef.current = false
      handleVirtualPaperTransform(nextTransform, meta)
      // 仅在活动 transform 期间确实跳过了 eviction 时才补偿触发
      if (evictionSkippedDuringTransformRef.current) {
        evictionSkippedDuringTransformRef.current = false
        setEvictionBump((v) => v + 1)
      }
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
        if (activePinchRef.current) {
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
    // eslint-disable-next-line sonarjs/void-use -- 依赖仅用于触发 effect 刷新，无需消费值
    void evictionBump
    // Keep the async eviction callback seeing the current loaded page set
    // without adding mutable ref values to the dependency array.
    loadablePagesRef.current = loadablePages

    // 活动 transform（pan/zoom）期间跳过 eviction，避免 decode/evict 乒乓循环
    if (isTransformingRef.current) {
      evictionSkippedDuringTransformRef.current = true
      return
    }
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
  }, [loadablePages, pageNumbers, scheduleEviction, visiblePages, evictionBump])

  // 缓存每个 pageNumber 对应的稳定 ref callback，避免每次渲染创建新函数
  // 导致 React detach/attach ref —— 旧做法在每个 transform frame 都会 churn pageRefs.current
  const stablePageRefCallbacks = useRef(
    new Map<number, (element: HTMLDivElement | null) => void>()
  )
  const setPageRef = useCallback((pageNumber: number) => {
    let callback = stablePageRefCallbacks.current.get(pageNumber)
    if (!callback) {
      callback = (element: HTMLDivElement | null) => {
        if (element) {
          pageRefs.current.set(pageNumber, element)
        } else {
          pageRefs.current.delete(pageNumber)
        }
      }
      stablePageRefCallbacks.current.set(pageNumber, callback)
    }
    return callback
  }, [])

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

  const shouldRejectOverBroadSelection = useCallback(
    (selectedElements: HTMLElement[], viewerRoot: HTMLElement): boolean => {
      return isOverBroadDirectRenderSelection(selectedElements, viewerRoot)
    },
    [isOverBroadDirectRenderSelection]
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
        return null
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
      const firstTextId = firstElement.getAttribute('data-text-id')
      const firstPageNumber = Number(
        firstElement.getAttribute('data-page-number')
      )
      if (shouldRejectOverBroadSelection(selectedElements, viewerRoot)) {
        return null
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
    [shouldRejectOverBroadSelection]
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
    if (!onTextSelectionEnd && !onSelectText) {
      return
    }

    // Retained as a payload source only. Gesture completion is driven by Drag
    // (or by external/native Selection fallbacks below); this reads the live
    // composed Selection to emit public callbacks without changing their API.
    const selection = getSelectionForRoot(viewerRootRef.current)
    if (!selection) return

    const detail = getSelectionDetail(selection)
    if (!detail) {
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
        onSelectText(payload.selection, payload.segments, payload.extractedText)
      }
    }
  }, [onTextSelectionEnd, onSelectText, getSelectionDetail])

  // ---- Selection 库回调桥接 ----
  // Selection.onSelect：非受控模式下内部先 append range，再回调外部
  const handleSelectionSelect = useCallback(
    (range: ReaderSelectionRange) => {
      if (!isRangesControlled) {
        setInternalRanges((prev) => [...prev, range])
      }
      onSelect?.(range)
    },
    [isRangesControlled, onSelect]
  )

  // Selection.onSelectRange：非受控模式下内部先更新 ID，再回调外部
  const handleSelectionSelectRange = useCallback(
    (id: string | null) => {
      if (!isSelectedRangeIdControlled) {
        setInternalSelectedRangeId(id)
      }
      onSelectRange?.(id)
    },
    [isSelectedRangeIdControlled, onSelectRange]
  )

  // Selection.onSelectionStart：直接转发到外部 prop
  const handleSelectionStart = useCallback(
    (mousePos: ReaderMousePosition, selection: Selection) => {
      onSelectionStartProp?.(mousePos, selection)
    },
    [onSelectionStartProp]
  )

  // Selection.onSelectionEnd：仅转发到外部 prop。
  // 不桥接 emitSelectionEnd，因为原生 mouseup 监听已负责 legacy 通路
  // （onTextSelectionEnd/onSelectText），避免双重触发。
  const handleSelectionEnd = useCallback(
    (mousePos: ReaderMousePosition, selection: Selection) => {
      onSelectionEndProp?.(mousePos, selection)
    },
    [onSelectionEndProp]
  )

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
    className
  ]
    .filter(Boolean)
    .join(' ')

  useEffect(() => {
    if (!onTextSelectionChange) return

    const handleSelectionChange = () => {
      const selection = getSelectionForRoot(viewerRootRef.current)
      if (!selection) return

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

  // 已移除 SVG overlay 渲染、保存选区 overlay 同步与手柄刷新 effects；原生 Selection 负责视觉反馈。

  // 已移除自定义拖拽/触摸选区 adapter 与 overlay 刷新 effect，改由浏览器原生 Selection 处理拖选。

  useEffect(() => {
    const root = viewerRootRef.current
    if (!root) return

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) {
        emitSelectionEnd()
      }
    }

    root.addEventListener('touchend', emitSelectionEnd)
    root.addEventListener('mouseup', emitSelectionEnd)
    root.addEventListener('keyup', handleKeyUp)

    return () => {
      root.removeEventListener('touchend', emitSelectionEnd)
      root.removeEventListener('mouseup', emitSelectionEnd)
      root.removeEventListener('keyup', handleKeyUp)
    }
  }, [emitSelectionEnd])

  // 已移除保存选区手柄拖拽处理与手柄渲染函数；保存选区仅保留数据类型，不再渲染 SVG/手柄 UI。

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
        {/* 已移除 direct 模式页面内 selection/saved-selection SVG overlay 与手柄 JSX。 */}
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
          transform={virtualPaperTransform}
          minScale={scaleRange.min}
          maxScale={scaleRange.max}
          onTransformChange={handleVirtualPaperTransformChange}
          onTransformChangeEnd={handleVirtualPaperTransformChangeEnd}
        >
          {renderMode !== 'direct' ? (
            <HamsterSelection
              ranges={effectiveRanges}
              selectedRangeId={effectiveSelectedRangeId}
              onSelect={onSelect ? handleSelectionSelect : undefined}
              onSelectRange={
                onSelectRange ? handleSelectionSelectRange : undefined
              }
              onSelectionStart={
                onSelectionStartProp ? handleSelectionStart : undefined
              }
              onSelectionEnd={
                onSelectionEndProp ? handleSelectionEnd : undefined
              }
              onHighlight={onHighlight}
              highlightColor={highlightColor}
              selectionColor={selectionColor}
              popover={selectionPopover}
              overlayRectType={overlayRectType}
              ref={selectionRef}
            >
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
                          <HtmlPageContent html={htmlPageHtmlEntry ?? ''} />
                        ) : (
                          renderDirectPageInner(pageNumber)
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* 已移除 html-parser 根级 selection/saved-selection SVG overlay 与手柄 JSX。 */}
            </HamsterSelection>
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
