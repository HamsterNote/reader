import { HtmlParser, type DecodeOptions } from '@hamster-note/html-parser'
import { Selection as HamsterSelection } from '@hamster-note/selection'
import type {
  LinkedSelectionData,
  LinkedSelectionRange
} from '@hamster-note/selection'
import {
  IntermediateDocument,
  type IntermediateContent,
  type IntermediateDocumentSerialized,
  type IntermediateImage,
  type IntermediateText
} from '@hamster-note/types'
import {
  VirtualPaper,
  VirtualPaperInteractionMode,
  type VirtualPaperTransform,
  type VirtualPaperTransformMeta
} from '@hamster-note/virtual-paper'
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import { PopoverPortal } from '../PopoverPortal'
import { isHtmlParserSelectionTarget } from '../selection/caretResolver'
import {
  buildSelectionPayload,
  textElementRecords,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload
} from '../selection/selectionPayloadSerializer'
import type {
  ReaderMousePosition,
  ReaderLinkedSelectionData,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../../types/selection'
import {
  buildRuntimeLinkedSelectionData,
  extractRuntimeLinkedTransient,
  mapRuntimeLinkedDataToPublic,
  mapRuntimeRangeToPublic,
  runtimePageSelectionId,
  type RuntimeLinkedSelectionTransient
} from './selectionAdapter'
// 共享纯几何/样式辅助（文本 span + IntermediateImage），供 direct / html-parser /
// intermediate-document 三种渲染模式复用，避免 viewer 文件继续膨胀。
import {
  buildTextSpanStyle,
  getTextBbox,
  type RenderableIntermediateText
} from './pageContentGeometry'
// intermediate-document 默认模式的已加载页面内容渲染器
import { IntermediateDocumentPageContent } from './IntermediateDocumentPageContent'
// intermediate-document 默认模式的懒加载页面队列 hook
import { useLazyPageQueue, type LazyPageQueueConfig } from './useLazyPageQueue'

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

export type {
  ReaderLinkedSelectionData,
  ReaderLinkedSelectionRange,
  ReaderMousePosition,
  ReaderSelectionEndpoint,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRect,
  ReaderSelectionRef
} from '../../types/selection'

export type ReaderPageRange = {
  start: number
  end: number
}

/**
 * 渲染模式：
 * - `'html-parser'`：走 html-parser 解码路径（`HtmlParser.decodePageToHtml`），逐页解码为 HTML 片段渲染。
 * - `'direct'`：直接渲染中间文档内容，不经过 html-parser，不调用 `HtmlParser.decodePageToHtml`。
 * - `'intermediate-document'`：新增的默认模式。当前阶段为占位实现，复用 direct 渲染最小化满足编译，
 *   绝不调用 html-parser。后续任务 将在此基础上实现真正的懒加载队列。
 *
 * 当调用方省略 `renderMode` 时，组件默认使用 `'intermediate-document'`。
 * 显式传入 `'html-parser'` 或 `'direct'` 仍走各自既有路径，行为保持不变。
 */
export type ReaderRenderMode =
  | 'html-parser'
  | 'direct'
  | 'intermediate-document'

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
  onLinkedDataChange?: (next: ReaderLinkedSelectionData) => void
  onLinkedSelect?: (range: ReaderSelectionRange) => void
  onLinkedUpdateRange?: (range: ReaderSelectionRange) => void
  onLinkedSelectRange?: (id: string | null) => void
  /** 用户点击或取消选中某个已高亮 range 时触发 */
  onSelectRange?: (id: string | null) => void
  /** 用户拖动已高亮 range 的首尾手柄调整范围时触发；非受控 ranges 模式下内部先替换对应 range */
  onUpdateRange?: (range: ReaderSelectionRange) => void
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
  /** 被高亮的片段上方弹出的 Popover 内容，未提供时 fallback 到 selectionPopover */
  highlightPopover?: React.ReactNode
  /** 是否在选区结束时自动触发高亮，默认为 false */
  autoHighlight?: boolean
  /** Selection 组件的命令式 ref，暴露 highlight()/clear() 方法，仅 html-parser 模式有效 */
  selectionRef?: React.Ref<ReaderSelectionRef>
  /** 选区 Overlay 矩形坐标类型；默认 'percent' */
  overlayRectType?: ReaderSelectionOverlayRectType
  // ---- intermediate-document 懒加载队列 props（仅新增默认模式预留，当前占位分支暂未消费）----
  /**
   * 初始立即加载的页数。省略时默认 `1`。后续任务 将在 `'intermediate-document'` 懒加载队列中消费。
   */
  initialLoadedPages?: number
  /**
   * 同时并发加载的页数上限。省略时默认 `3`。
   */
  pageLoadConcurrency?: number
  /**
   * 页面进入可加载窗口后、真正发起加载前的延迟（毫秒）。省略时默认 `500`。
   */
  pageLoadEnterDelayMs?: number
  /**
   * 页面离开可加载窗口后、卸载其内容的延迟（毫秒）。省略时默认 `5000`。
   */
  pageUnloadDelayMs?: number
}

type PageSize = {
  width: number
  height: number
}

type PageLoadStatus = 'loaded' | 'error'
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

// IntermediateImage 内容项判断（与 isIntermediateText 互补）
const isIntermediateImage = (
  content: IntermediateContent
): content is IntermediateImage => 'src' in content && 'polygon' in content

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

const createSetImagesHandler = (
  pageNumber: number,
  images: IntermediateImage[]
) => {
  return (currentImages: Map<number, IntermediateImage[]>) => {
    const nextImages = new Map(currentImages)
    nextImages.set(pageNumber, images)
    return nextImages
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

// 兼容当前 getContent() 与旧版 texts / getTexts() 形状的内容提取。
// 优先调用 getContent()；若不存在则回退到 texts 属性或 getTexts() 方法。
type PageWithContent = {
  getContent?: () =>
    | Promise<IntermediateContent[] | IntermediateText[]>
    | IntermediateContent[]
    | IntermediateText[]
  getTexts?: () =>
    | Promise<IntermediateContent[] | IntermediateText[]>
    | IntermediateContent[]
    | IntermediateText[]
  texts?: IntermediateContent[] | IntermediateText[]
}

const getPageContentEntries = async (
  page: unknown
): Promise<IntermediateContent[]> => {
  if (!page || typeof page !== 'object') {
    return []
  }

  const pageWithContent = page as PageWithContent

  if (typeof pageWithContent.getContent === 'function') {
    return pageWithContent.getContent()
  }

  if (typeof pageWithContent.getTexts === 'function') {
    return pageWithContent.getTexts()
  }

  if (Array.isArray(pageWithContent.texts)) {
    return pageWithContent.texts
  }

  return []
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

type SetTextRef = (
  text: IntermediateText,
  pageNumber: number
) => (element: HTMLSpanElement | null) => void

type DirectPageInnerProps = {
  pageNumber: number
  texts: IntermediateText[]
  ocrTexts: IntermediateText[]
  pageStatus: PageLoadStatus | undefined
  isLoadable: boolean
  baseImageSource: string | undefined
  setTextRef: SetTextRef
}

type PageRefSetter = (
  pageNumber: number
) => (element: HTMLDivElement | null) => void

type DirectPageResources = {
  textsByPageNumber: Map<number, IntermediateText[]>
  ocrTextsByPageNumber: Map<number, IntermediateText[]>
  pageStatuses: Map<number, PageLoadStatus>
  loadablePages: Set<number>
  baseImagesByPageNumber: Map<number, string>
}

type HtmlParserPagesProps = DirectPageResources & {
  pageNumbers: number[]
  runtimeDocument: IntermediateDocument
  htmlPageStatusesByPageNumber: Map<number, HtmlPageStatus>
  htmlPagesByPageNumber: Map<number, string>
  setPageRef: PageRefSetter
  setTextRef: SetTextRef
  // T5: per-page linked-mode selection props
  // 每个 .hamster-reader__intermediate-page 内容由一个 HamsterSelection 实例包裹，
  // 使用 runtimePageSelectionId(pageNumber) 作为 runtime 选中 id，
  // 共享同一份 runtime LinkedSelectionData 引用，并通过回调桥接 public 语义。
  runtimePageSelectionId: (pageNumber: number) => string
  runtimeLinkedData: LinkedSelectionData
  handleLinkedDataChange: (next: LinkedSelectionData) => void
  handleLinkedSelect: (range: LinkedSelectionRange) => void
  handleLinkedUpdateRange: (range: LinkedSelectionRange) => void
  handleLinkedSelectRange: (id: string | null) => void
  onSelectionStartProp:
    | ((mousePos: ReaderMousePosition, selection: Selection) => void)
    | undefined
  handleSelectionStart: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  onSelectionEndProp:
    | ((mousePos: ReaderMousePosition, selection: Selection) => void)
    | undefined
  // 已包装 autoHighlight 逻辑（含 fallback ref.highlight()）的 onSelectionEnd
  handleSelectionEnd: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  autoHighlight: boolean | undefined
  highlightColor: string | undefined
  selectionColor: string | undefined
  overlayRectType: ReaderSelectionOverlayRectType
  effectiveSelectedRangeId: string | null
  selectionPopover: React.ReactNode
  highlightPopover: React.ReactNode
  // 控制 PopoverPortal 在 VirtualPaper 平移/缩放期间的可见性
  popoverVisible: boolean
  selectionRefForRuntimeId: (
    selectionId: string
  ) => (node: ReaderSelectionRef | null) => void
}

type DirectPagesProps = DirectPageResources & {
  pageNumbers: number[]
  runtimeDocument: IntermediateDocument
  setPageRef: PageRefSetter
  setTextRef: SetTextRef
}

type ViewerContentProps = DirectPageResources & {
  rootClassName: string
  viewerRootRef: React.Ref<HTMLDivElement>
  runtimeDocument: IntermediateDocument
  pageNumbers: number[]
  virtualPaperTransform: VirtualPaperTransform
  scaleRange: { min: number; max: number }
  imagesByPageNumber: Map<number, IntermediateImage[]>
  handleVirtualPaperTransformChange: (
    nextTransform: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => void
  handleVirtualPaperTransformChangeEnd: (
    nextTransform: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => void
  renderMode: ReaderRenderMode
  effectiveSelectedRangeId: string | null
  runtimePageSelectionId: (pageNumber: number) => string
  runtimeLinkedData: LinkedSelectionData
  handleLinkedDataChange: (next: LinkedSelectionData) => void
  handleLinkedSelect: (range: LinkedSelectionRange) => void
  handleLinkedUpdateRange: (range: LinkedSelectionRange) => void
  handleLinkedSelectRange: (id: string | null) => void
  beginLinkedHighlightOperation: () => PendingLinkedHighlightOperation
  schedulePendingLinkedHighlightCleanup: (
    operation: PendingLinkedHighlightOperation
  ) => void
  onSelectionStartProp:
    | ((mousePos: ReaderMousePosition, selection: Selection) => void)
    | undefined
  handleSelectionStart: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  onSelectionEndProp:
    | ((mousePos: ReaderMousePosition, selection: Selection) => void)
    | undefined
  handleSelectionEnd: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  highlightColor: string | undefined
  selectionColor: string | undefined
  selectionPopover: React.ReactNode
  highlightPopover: React.ReactNode
  autoHighlight: boolean | undefined
  overlayRectType: ReaderSelectionOverlayRectType
  selectionRef: React.Ref<ReaderSelectionRef> | undefined
  htmlPageStatusesByPageNumber: Map<number, HtmlPageStatus>
  htmlPagesByPageNumber: Map<number, string>
  setPageRef: PageRefSetter
  setTextRef: SetTextRef
}

type PendingLinkedHighlightOperation = ReadonlySet<string>

const getElementFromSelectionNode = (node: Node | null): Element | null => {
  if (!node) return null
  return node instanceof Element ? node : node.parentElement
}

const getRuntimeSelectionIdFromSelectionNode = (
  node: Node | null,
  runtimePageSelectionId: (pageNumber: number) => string
): string | null => {
  const element = getElementFromSelectionNode(node)
  if (!element) return null

  const selectionContainer = element.closest('.hsn-selection-container')
  if (selectionContainer instanceof HTMLElement) {
    const selectionId = selectionContainer.dataset.selectionId
    if (selectionId) return selectionId
  }

  const pageContainer = element.closest('.hamster-reader__intermediate-page')
  if (!(pageContainer instanceof HTMLElement)) return null

  const pageSelectionId = pageContainer.dataset.selectionId
  if (pageSelectionId) return pageSelectionId

  const pageNumber = Number(pageContainer.dataset.pageNumber)
  return Number.isFinite(pageNumber) ? runtimePageSelectionId(pageNumber) : null
}

function DirectPageInner({
  pageNumber,
  texts,
  ocrTexts,
  pageStatus,
  isLoadable,
  baseImageSource,
  setTextRef
}: DirectPageInnerProps) {
  const allTexts = [...texts, ...ocrTexts]
  const isDirectPageLoading =
    isLoadable && pageStatus !== 'loaded' && pageStatus !== 'error'

  return (
    <>
      {baseImageSource && (
        <img
          className='hamster-reader__intermediate-page-base-image'
          src={baseImageSource}
          alt=''
          aria-hidden='true'
        />
      )}
      {isDirectPageLoading && (
        <div className='hamster-reader__intermediate-page-status'>
          Loading page {pageNumber}…
        </div>
      )}
      {pageStatus === 'error' && (
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

function HtmlParserPages({
  pageNumbers,
  runtimeDocument,
  htmlPageStatusesByPageNumber,
  htmlPagesByPageNumber,
  setPageRef,
  setTextRef,
  textsByPageNumber,
  ocrTextsByPageNumber,
  pageStatuses,
  loadablePages,
  baseImagesByPageNumber,
  runtimePageSelectionId,
  runtimeLinkedData,
  handleLinkedDataChange,
  handleLinkedSelect,
  handleLinkedUpdateRange,
  handleLinkedSelectRange,
  onSelectionStartProp,
  handleSelectionStart,
  onSelectionEndProp,
  handleSelectionEnd,
  autoHighlight,
  highlightColor,
  selectionColor,
  overlayRectType,
  effectiveSelectedRangeId,
  selectionPopover,
  highlightPopover,
  popoverVisible,
  selectionRefForRuntimeId
}: HtmlParserPagesProps) {
  // 计算 popover 归属：仅拥有「选中 range 的 start endpoint」所在页面的 Selection
  // 实例可以渲染 selectionPopover / highlightPopover，其余页面均传入 undefined，
  // 避免多页面同时为同一 selected range 重复 rendering popover。
  // 当 selectedRangeId 为 null / 在 items 中找不到时，不进行 gating：
  // 每个页面都可呈现 popover（覆盖 active text selection 跟随当前页面的用户行为）。
  const popoverOwnerRuntimeId = useMemo(() => {
    const selectedId = runtimeLinkedData.selectedRangeId
    if (!selectedId) {
      return null
    }
    const selectedRange = runtimeLinkedData.items.find(
      (range) => range.id === selectedId
    )
    return selectedRange ? selectedRange.start.selectionId : null
  }, [runtimeLinkedData.selectedRangeId, runtimeLinkedData.items])

  // 与外层 ViewerContent 行为一致：onSelectionStart 仅在调用方提供 prop 时启用；
  // onSelectionEnd 当调用方提供 prop 或 autoHighlight 时启用；autoHighlight
  // 由 ViewerContent 的 multiplex wrapper 决定具体调用哪个页面 ref。
  const selectionStartHandler = onSelectionStartProp
    ? handleSelectionStart
    : undefined
  const selectionEndHandler =
    onSelectionEndProp || autoHighlight ? handleSelectionEnd : undefined

  return (
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
          const htmlPageHtmlEntry = htmlPagesByPageNumber.get(pageNumber)
          const isHtmlPageDecoded =
            htmlPageStatusEntry === 'decoded' && Boolean(htmlPageHtmlEntry)

          // runtime 选中 id 由 readerLinkedScopeId + 页码派生，
          // 公共持久化层始终使用 `page-${pageNumber}`。
          const pageRuntimeId = runtimePageSelectionId(pageNumber)

          // popover gating：owner 为 null（无 selected range）时所有页面均呈现 popover，
          // 否则仅 pageRuntimeId === popoverOwnerRuntimeId 的页面拿到真实 popover 内容，
          // 其余页面传入 undefined 以避免重复渲染同一 selected range 的 popover。
          const isPopoverOwner =
            popoverOwnerRuntimeId === null ||
            popoverOwnerRuntimeId === pageRuntimeId
          const pagePopover = isPopoverOwner ? (
            <PopoverPortal visible={popoverVisible}>
              {highlightPopover ?? selectionPopover}
            </PopoverPortal>
          ) : undefined
          const pageSelectionPopover = isPopoverOwner ? (
            <PopoverPortal visible={popoverVisible}>
              {selectionPopover}
            </PopoverPortal>
          ) : undefined

          return (
            <div
              key={pageNumber}
              ref={setPageRef(pageNumber)}
              className='hamster-reader__intermediate-page'
              data-testid={`intermediate-page-${pageNumber}`}
              data-page-number={pageNumber}
              data-selection-id={pageRuntimeId}
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
              {/*
               * T5：每个 .hamster-reader__intermediate-page 内容由独立的
               * HamsterSelection（linked-mode）包裹；所有页面共享同一份
               * runtime LinkedSelectionData 引用，回调桥接回 public 语义。
               * 不手动调用 registerLinkedContainer —— Selection 内部自注册。
               * legacy range callbacks（onSelect/onUpdateRange/onHighlight）
               * 显式传 undefined，禁止以 legacy 通道下放 linked payload。
               */}
              <HamsterSelection
                selectionId={pageRuntimeId}
                linkedMode
                linkedData={runtimeLinkedData}
                onLinkedDataChange={handleLinkedDataChange}
                onLinkedSelect={handleLinkedSelect}
                onLinkedUpdateRange={handleLinkedUpdateRange}
                onLinkedSelectRange={handleLinkedSelectRange}
                ranges={[]}
                selectedRangeId={effectiveSelectedRangeId}
                onSelect={undefined}
                onSelectRange={undefined}
                onUpdateRange={undefined}
                onSelectionStart={selectionStartHandler}
                onSelectionEnd={selectionEndHandler}
                onHighlight={undefined}
                highlightColor={highlightColor}
                selectionColor={selectionColor}
                popover={pagePopover}
                selectionPopover={pageSelectionPopover}
                overlayRectType={overlayRectType}
                ref={selectionRefForRuntimeId(pageRuntimeId)}
              >
                {isHtmlPageDecoded ? (
                  <HtmlPageContent html={htmlPageHtmlEntry ?? ''} />
                ) : (
                  <DirectPageInner
                    pageNumber={pageNumber}
                    texts={textsByPageNumber.get(pageNumber) ?? []}
                    ocrTexts={ocrTextsByPageNumber.get(pageNumber) ?? []}
                    pageStatus={pageStatuses.get(pageNumber)}
                    isLoadable={loadablePages.has(pageNumber)}
                    baseImageSource={baseImagesByPageNumber.get(pageNumber)}
                    setTextRef={setTextRef}
                  />
                )}
              </HamsterSelection>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DirectPages({
  pageNumbers,
  runtimeDocument,
  setPageRef,
  setTextRef,
  textsByPageNumber,
  ocrTextsByPageNumber,
  pageStatuses,
  loadablePages,
  baseImagesByPageNumber
}: DirectPagesProps) {
  return pageNumbers.map((pageNumber) => {
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
        <DirectPageInner
          pageNumber={pageNumber}
          texts={textsByPageNumber.get(pageNumber) ?? []}
          ocrTexts={ocrTextsByPageNumber.get(pageNumber) ?? []}
          pageStatus={directPageStatusEntry}
          isLoadable={loadablePages.has(pageNumber)}
          baseImageSource={baseImagesByPageNumber.get(pageNumber)}
          setTextRef={setTextRef}
        />
      </div>
    )
  })
}

/**
 * `intermediate-document` 默认模式的页面渲染器。
 *
 * 为每个 `pageNumbers` 条目渲染一个 `.hamster-reader__intermediate-page` 外壳，
 * 设置 `data-testid`、`data-page-number`、`data-selection-id` 及尺寸
 * （`normalizePageSize(getPageSizeByPageNumber)`，回退 `DEFAULT_PAGE_SIZE`）。
 *
 * 当某页已在内容 maps 中拥有已加载内容时，在外壳内渲染
 * `<IntermediateDocumentPageContent>`（底图 + 文本 span + OCR span + 图片项）；
 * 未加载的页面保持空外壳，由懒加载队列（后续任务）填充。
 *
 * 关键约束：外壳渲染阶段绝不调用页面/内容加载器；绝不使用
 * `dangerouslySetInnerHTML`；内容由独立渲染器以 React 元素绘制。
 */
type IntermediateDocumentPagesProps = DirectPageResources & {
  pageNumbers: number[]
  runtimeDocument: IntermediateDocument
  setPageRef: PageRefSetter
  setTextRef: SetTextRef
  runtimePageSelectionId: (pageNumber: number) => string
  imagesByPageNumber: Map<number, IntermediateImage[]>
}

function IntermediateDocumentPages({
  pageNumbers,
  runtimeDocument,
  setPageRef,
  setTextRef,
  runtimePageSelectionId,
  textsByPageNumber,
  ocrTextsByPageNumber,
  baseImagesByPageNumber,
  imagesByPageNumber
}: IntermediateDocumentPagesProps) {
  return pageNumbers.map((pageNumber) => {
    const shellPageSize = normalizePageSize(
      runtimeDocument.getPageSizeByPageNumber(pageNumber)
    )
    const shellSelectionId = runtimePageSelectionId(pageNumber)

    return (
      <div
        key={pageNumber}
        ref={setPageRef(pageNumber)}
        className='hamster-reader__intermediate-page'
        data-testid={`intermediate-page-${pageNumber}`}
        data-page-number={pageNumber}
        data-selection-id={shellSelectionId}
        data-page-size-unavailable={
          shellPageSize.pageSizeUnavailable ? 'true' : undefined
        }
        style={{
          position: 'relative',
          width: `${shellPageSize.width}px`,
          height: `${shellPageSize.height}px`,
          overflow: 'hidden'
        }}
      >
        <IntermediateDocumentPageContent
          pageNumber={pageNumber}
          texts={textsByPageNumber.get(pageNumber) ?? []}
          ocrTexts={ocrTextsByPageNumber.get(pageNumber) ?? []}
          baseImageSource={baseImagesByPageNumber.get(pageNumber)}
          images={imagesByPageNumber.get(pageNumber) ?? []}
          setTextRef={setTextRef}
        />
      </div>
    )
  })
}

function ViewerContent({
  rootClassName,
  viewerRootRef,
  runtimeDocument,
  pageNumbers,
  virtualPaperTransform,
  scaleRange,
  handleVirtualPaperTransformChange,
  handleVirtualPaperTransformChangeEnd,
  renderMode,
  effectiveSelectedRangeId,
  runtimePageSelectionId,
  runtimeLinkedData,
  handleLinkedDataChange,
  handleLinkedSelect,
  handleLinkedUpdateRange,
  handleLinkedSelectRange,
  beginLinkedHighlightOperation,
  schedulePendingLinkedHighlightCleanup,
  onSelectionStartProp,
  handleSelectionStart,
  onSelectionEndProp,
  handleSelectionEnd,
  highlightColor,
  selectionColor,
  selectionPopover,
  highlightPopover,
  autoHighlight,
  overlayRectType,
  selectionRef,
  htmlPageStatusesByPageNumber,
  htmlPagesByPageNumber,
  setPageRef,
  setTextRef,
  textsByPageNumber,
  ocrTextsByPageNumber,
  pageStatuses,
  loadablePages,
  baseImagesByPageNumber,
  imagesByPageNumber
}: ViewerContentProps) {
  const selectionRefsByRuntimeIdRef = useRef(
    new Map<string, ReaderSelectionRef>()
  )
  const selectionRefSettersByRuntimeIdRef = useRef(
    new Map<string, (node: ReaderSelectionRef | null) => void>()
  )
  const syncForwardedSelectionRefRef = useRef<() => void>(() => {})

  // --- Portal popover 可见性控制 ---
  // VirtualPaper pan/zoom 期间隐藏 popover，transform 结束后 500ms debounce 再显示
  const [popoverVisible, setPopoverVisible] = useState(true)
  const popoverDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getFirstVisibleSelectionRef = useCallback(() => {
    for (const pageNumber of pageNumbers) {
      const selectionId = runtimePageSelectionId(pageNumber)
      const selectionRef = selectionRefsByRuntimeIdRef.current.get(selectionId)
      if (selectionRef) return selectionRef
    }

    return undefined
  }, [pageNumbers, runtimePageSelectionId])

  const getActiveSelectionOwnerRef = useCallback(() => {
    const activeSelection = window.getSelection()
    if (!activeSelection || activeSelection.isCollapsed) return undefined

    const ownerSelectionIds = [
      getRuntimeSelectionIdFromSelectionNode(
        activeSelection.anchorNode,
        runtimePageSelectionId
      ),
      getRuntimeSelectionIdFromSelectionNode(
        activeSelection.focusNode,
        runtimePageSelectionId
      )
    ]

    for (const selectionId of ownerSelectionIds) {
      if (!selectionId) continue

      const selectionRef = selectionRefsByRuntimeIdRef.current.get(selectionId)
      if (selectionRef) return selectionRef
    }

    return ownerSelectionIds.some(Boolean) ? null : undefined
  }, [runtimePageSelectionId])

  const highlightSelection = useCallback(() => {
    const operation = beginLinkedHighlightOperation()

    try {
      const ownerSelectionRef = getActiveSelectionOwnerRef()
      const selectionRef =
        ownerSelectionRef === undefined
          ? getFirstVisibleSelectionRef()
          : ownerSelectionRef
      selectionRef?.highlight()
    } finally {
      schedulePendingLinkedHighlightCleanup(operation)
    }
  }, [
    beginLinkedHighlightOperation,
    getActiveSelectionOwnerRef,
    getFirstVisibleSelectionRef,
    schedulePendingLinkedHighlightCleanup
  ])

  const clearSelections = useCallback(() => {
    selectionRefsByRuntimeIdRef.current.forEach((selectionRef) => {
      selectionRef.clear()
    })
  }, [])

  const publicSelectionRef = useMemo<ReaderSelectionRef>(
    () => ({
      highlight: highlightSelection,
      clear: clearSelections
    }),
    [clearSelections, highlightSelection]
  )

  const syncForwardedSelectionRef = useCallback(() => {
    const forwardedRef =
      selectionRefsByRuntimeIdRef.current.size > 0 ? publicSelectionRef : null

    if (typeof selectionRef === 'function') {
      selectionRef(forwardedRef)
    } else if (selectionRef) {
      ;(
        selectionRef as React.MutableRefObject<ReaderSelectionRef | null>
      ).current = forwardedRef
    }
  }, [publicSelectionRef, selectionRef])

  syncForwardedSelectionRefRef.current = syncForwardedSelectionRef

  useEffect(() => {
    syncForwardedSelectionRef()
    return () => {
      if (typeof selectionRef === 'function') {
        selectionRef(null)
      } else if (selectionRef) {
        ;(
          selectionRef as React.MutableRefObject<ReaderSelectionRef | null>
        ).current = null
      }
    }
  }, [selectionRef, syncForwardedSelectionRef])

  const selectionRefForRuntimeId = useCallback((selectionId: string) => {
    let setSelectionRef =
      selectionRefSettersByRuntimeIdRef.current.get(selectionId)
    if (!setSelectionRef) {
      setSelectionRef = (node: ReaderSelectionRef | null) => {
        if (node) {
          selectionRefsByRuntimeIdRef.current.set(selectionId, node)
        } else {
          selectionRefsByRuntimeIdRef.current.delete(selectionId)
        }

        syncForwardedSelectionRefRef.current()
      }
      selectionRefSettersByRuntimeIdRef.current.set(
        selectionId,
        setSelectionRef
      )
    }

    return setSelectionRef
  }, [])

  const handleSelectionEndWrap = useCallback(
    (mousePos: ReaderMousePosition, selection: Selection) => {
      if (autoHighlight) {
        highlightSelection()
      }
      handleSelectionEnd(mousePos, selection)
    },
    [autoHighlight, handleSelectionEnd, highlightSelection]
  )

  const runtimeLinkedDataRef = useRef(runtimeLinkedData)
  runtimeLinkedDataRef.current = runtimeLinkedData

  const handlePageLinkedDataChange = useCallback(
    (next: LinkedSelectionData) => {
      runtimeLinkedDataRef.current = next
      handleLinkedDataChange(next)
    },
    [handleLinkedDataChange]
  )

  const handlePageLinkedSelectRange = useCallback(
    (id: string | null) => {
      const currentData = runtimeLinkedDataRef.current
      if (currentData.selectedRangeId !== id) {
        handlePageLinkedDataChange({
          ...currentData,
          selectedRangeId: id
        })
      }
      handleLinkedSelectRange(id)
    },
    [handleLinkedSelectRange, handlePageLinkedDataChange]
  )

  // 包装 VirtualPaper 的 transform 回调：
  // transform 进行中时立即隐藏 portal popover，结束后 debounce 500ms 再显示
  const handleTransformChangeWithPopover = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      setPopoverVisible(false)
      if (popoverDebounceRef.current) {
        clearTimeout(popoverDebounceRef.current)
        popoverDebounceRef.current = null
      }
      handleVirtualPaperTransformChange(nextTransform, meta)
    },
    [handleVirtualPaperTransformChange]
  )

  const handleTransformChangeEndWithPopover = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      handleVirtualPaperTransformChangeEnd(nextTransform, meta)
      if (popoverDebounceRef.current) {
        clearTimeout(popoverDebounceRef.current)
      }
      popoverDebounceRef.current = setTimeout(() => {
        setPopoverVisible(true)
        popoverDebounceRef.current = null
      }, 500)
    },
    [handleVirtualPaperTransformChangeEnd]
  )

  // 组件卸载时清理 debounce 定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (popoverDebounceRef.current) {
        clearTimeout(popoverDebounceRef.current)
      }
    }
  }, [])

  // 根据 renderMode 选择页面内容渲染器。
  // 这里使用独立的 if/else if/else 赋值，而非嵌套三元表达式，
  // 以满足 sonarjs/no-nested-conditional 规则并保持可读性。
  let pagesNode: React.ReactNode
  if (renderMode === 'html-parser') {
    // T5/T7：每页内容自带一个 linked-mode HamsterSelection；
    // 公共 ReaderSelectionRef 通过 runtime selectionId 复用这些子 ref。
    pagesNode = (
      <HtmlParserPages
        pageNumbers={pageNumbers}
        runtimeDocument={runtimeDocument}
        htmlPageStatusesByPageNumber={htmlPageStatusesByPageNumber}
        htmlPagesByPageNumber={htmlPagesByPageNumber}
        setPageRef={setPageRef}
        setTextRef={setTextRef}
        textsByPageNumber={textsByPageNumber}
        ocrTextsByPageNumber={ocrTextsByPageNumber}
        pageStatuses={pageStatuses}
        loadablePages={loadablePages}
        baseImagesByPageNumber={baseImagesByPageNumber}
        runtimePageSelectionId={runtimePageSelectionId}
        runtimeLinkedData={runtimeLinkedData}
        handleLinkedDataChange={handlePageLinkedDataChange}
        handleLinkedSelect={handleLinkedSelect}
        handleLinkedUpdateRange={handleLinkedUpdateRange}
        handleLinkedSelectRange={handlePageLinkedSelectRange}
        onSelectionStartProp={onSelectionStartProp}
        handleSelectionStart={handleSelectionStart}
        onSelectionEndProp={onSelectionEndProp}
        handleSelectionEnd={handleSelectionEndWrap}
        autoHighlight={autoHighlight}
        highlightColor={highlightColor}
        selectionColor={selectionColor}
        overlayRectType={overlayRectType}
        effectiveSelectedRangeId={effectiveSelectedRangeId}
        selectionPopover={selectionPopover}
        highlightPopover={highlightPopover}
        popoverVisible={popoverVisible}
        selectionRefForRuntimeId={selectionRefForRuntimeId}
      />
    )
  } else if (renderMode === 'direct') {
    /* 'direct' 渲染路径：不调用 html-parser，直接渲染页面文本/图片内容 */
    pagesNode = (
      <DirectPages
        pageNumbers={pageNumbers}
        runtimeDocument={runtimeDocument}
        setPageRef={setPageRef}
        setTextRef={setTextRef}
        textsByPageNumber={textsByPageNumber}
        ocrTextsByPageNumber={ocrTextsByPageNumber}
        pageStatuses={pageStatuses}
        loadablePages={loadablePages}
        baseImagesByPageNumber={baseImagesByPageNumber}
      />
    )
  } else {
    /* 'intermediate-document' 默认分支：渲染页面外壳，并在已加载页面的
     * 外壳内绘制内容（底图 + 文本 + 图片项）。外壳阶段不调用页面/内容加载器；
     * 真实懒加载队列将在后续任务 中在此基础上实现。 */
    pagesNode = (
      <IntermediateDocumentPages
        pageNumbers={pageNumbers}
        runtimeDocument={runtimeDocument}
        setPageRef={setPageRef}
        setTextRef={setTextRef}
        runtimePageSelectionId={runtimePageSelectionId}
        textsByPageNumber={textsByPageNumber}
        ocrTextsByPageNumber={ocrTextsByPageNumber}
        pageStatuses={pageStatuses}
        loadablePages={loadablePages}
        baseImagesByPageNumber={baseImagesByPageNumber}
        imagesByPageNumber={imagesByPageNumber}
      />
    )
  }

  return (
    <div
      ref={viewerRootRef}
      role='document'
      className={rootClassName}
      data-testid='intermediate-document-viewer'
    >
      {pageNumbers.length > 0 ? (
        <VirtualPaper
          containMode
          transform={virtualPaperTransform}
          minScale={scaleRange.min}
          maxScale={scaleRange.max}
          onTransformChange={handleTransformChangeWithPopover}
          onTransformChangeEnd={handleTransformChangeEndWithPopover}
        >
          {pagesNode}
        </VirtualPaper>
      ) : null}
    </div>
  )
}

export function IntermediateDocumentViewer({
  document,
  serializedDocument,
  className,
  overscan = 1,
  pageRange,
  renderMode = 'intermediate-document',
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
  onLinkedDataChange,
  onLinkedSelect,
  onLinkedUpdateRange,
  onLinkedSelectRange,
  onSelectRange,
  onUpdateRange,
  onSelectionStart: onSelectionStartProp,
  onSelectionEnd: onSelectionEndProp,
  onHighlight,
  highlightColor,
  selectionColor,
  selectionPopover,
  highlightPopover,
  autoHighlight,
  selectionRef,
  overlayRectType = 'percent',
  initialLoadedPages = 1,
  pageLoadConcurrency = 3,
  pageLoadEnterDelayMs = 500,
  pageUnloadDelayMs = 5000
}: IntermediateDocumentViewerProps) {
  const runtimeDocument = useMemo(() => {
    const inputDocument = document ?? serializedDocument
    return getRuntimeDocument(inputDocument)
  }, [document, serializedDocument])

  // intermediate-document 模式懒加载队列参数。集中存储四个 lazy props，
  // 供 useLazyPageQueue hook 读取以驱动逐页懒加载/并发/卸载节流。
  const lazyQueueConfigRef = useRef<LazyPageQueueConfig>({
    initialLoadedPages,
    pageLoadConcurrency,
    pageLoadEnterDelayMs,
    pageUnloadDelayMs
  })
  lazyQueueConfigRef.current = {
    initialLoadedPages,
    pageLoadConcurrency,
    pageLoadEnterDelayMs,
    pageUnloadDelayMs
  }

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
  const reactInstanceId = useId()
  const readerLinkedScopeId = useMemo(
    () => `reader-linked-${reactInstanceId}`,
    [reactInstanceId]
  )
  const getRuntimePageSelectionId = useCallback(
    (pageNumber: number) =>
      runtimePageSelectionId(readerLinkedScopeId, pageNumber),
    [readerLinkedScopeId]
  )

  // ---- Selection 库受控/非受控 state ----
  // ranges 受控（prop 提供）则直接用；否则内部 state 从 defaultRanges 初始化
  const isRangesControlled = ranges !== undefined
  const [internalRanges, setInternalRanges] = useState<ReaderSelectionRange[]>(
    () => defaultRanges ?? []
  )
  const effectiveRanges = isRangesControlled ? ranges : internalRanges
  const effectiveRangesRef = useRef<ReaderSelectionRange[]>(effectiveRanges)
  effectiveRangesRef.current = effectiveRanges
  const pendingLinkedHighlightOperationRef =
    useRef<PendingLinkedHighlightOperation | null>(null)
  const emittedLinkedSelectRangeIdsRef = useRef(new Set<string>())
  const emittedLinkedHighlightRangeIdsRef = useRef(new Set<string>())

  // selectedRangeId 同理
  const isSelectedRangeIdControlled = selectedRangeId !== undefined
  const [internalSelectedRangeId, setInternalSelectedRangeId] = useState<
    string | null
  >(defaultSelectedRangeId ?? null)
  const effectiveSelectedRangeId = isSelectedRangeIdControlled
    ? selectedRangeId
    : internalSelectedRangeId
  const [runtimeLinkedTransient, setRuntimeLinkedTransient] =
    useState<RuntimeLinkedSelectionTransient>({})
  const runtimeLinkedData = useMemo(
    () =>
      buildRuntimeLinkedSelectionData({
        scopeId: readerLinkedScopeId,
        ranges: effectiveRanges,
        selectedRangeId: effectiveSelectedRangeId,
        pageNumbers,
        overlayRectType,
        transient: runtimeLinkedTransient
      }),
    [
      effectiveRanges,
      effectiveSelectedRangeId,
      overlayRectType,
      pageNumbers,
      readerLinkedScopeId,
      runtimeLinkedTransient
    ]
  )

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
  // intermediate-document 模式专用：getContent() 返回的 IntermediateImage 内容项
  const [imagesByPageNumber, setImagesByPageNumber] = useState(
    () => new Map<number, IntermediateImage[]>()
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

  // intermediate-document 默认模式懒加载队列 hook。
  // 队列项为页码，通过 generation token 忽略 stale async 结果，
  // 并复用 loadingPagesRef 强制并发上限。callbacks 复用已有的
  // createSet*Handler immutable updater helpers 更新状态 maps。
  const lazyPageQueue = useLazyPageQueue(lazyQueueConfigRef, runtimeDocument, {
    renderMode,
    activeDocumentRef,
    isMountedRef,
    loadingPagesRef,
    getBaseImageFromPage,
    getPageContentEntries,
    isIntermediateText,
    isIntermediateImage,
    callbacks: {
      onPageLoaded: ({ pageNumber, baseImage, texts, images }) => {
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, baseImage)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, texts))
        setImagesByPageNumber(createSetImagesHandler(pageNumber, images))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'loaded'))
      },
      onPageError: (pageNumber) => {
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setImagesByPageNumber(createSetImagesHandler(pageNumber, []))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
      },
      isPageLoaded: (pageNumber) => textsByPageNumber.has(pageNumber)
    }
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
    setImagesByPageNumber(new Map())
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

    // 仅显式 html-parser 模式需要逐页解码；direct 与中间默认模式均不走 html-parser。
    if (!runtimeDocument || renderMode !== 'html-parser') {
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
          return HtmlParser.decodePageToHtml(page, decodeOptions)
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
  // linked 模式下只有 onLinkedDataChange 能写入内部 uncontrolled state；
  // 其它 linked callbacks 只负责向外层公开回调发出 public-id payload。
  const beginLinkedHighlightOperation =
    useCallback((): PendingLinkedHighlightOperation => {
      const operation = new Set(
        effectiveRangesRef.current.map((range) => range.id)
      )
      pendingLinkedHighlightOperationRef.current = operation
      return operation
    }, [])

  const schedulePendingLinkedHighlightCleanup = useCallback(
    (operation: PendingLinkedHighlightOperation) => {
      const cleanup = () => {
        if (pendingLinkedHighlightOperationRef.current === operation) {
          pendingLinkedHighlightOperationRef.current = null
        }
      }

      const viewerWindow = viewerRootRef.current?.ownerDocument.defaultView
      if (viewerWindow) {
        viewerWindow.setTimeout(cleanup, 0)
        return
      }

      globalThis.setTimeout(cleanup, 0)
    },
    []
  )

  const emitLinkedSelectOnce = useCallback(
    (range: ReaderSelectionRange) => {
      if (emittedLinkedSelectRangeIdsRef.current.has(range.id)) {
        return
      }

      emittedLinkedSelectRangeIdsRef.current.add(range.id)
      onSelect?.(range)
    },
    [onSelect]
  )

  const emitPendingLinkedHighlight = useCallback(
    (range: ReaderSelectionRange) => {
      const pendingOperation = pendingLinkedHighlightOperationRef.current
      if (!pendingOperation || pendingOperation.has(range.id)) {
        return
      }

      pendingLinkedHighlightOperationRef.current = null
      if (emittedLinkedHighlightRangeIdsRef.current.has(range.id)) {
        return
      }

      emittedLinkedHighlightRangeIdsRef.current.add(range.id)
      onHighlight?.(range)
    },
    [onHighlight]
  )

  const handleLinkedDataChange = useCallback(
    (next: LinkedSelectionData) => {
      const publicLinkedData = mapRuntimeLinkedDataToPublic(
        next,
        readerLinkedScopeId
      )

      setRuntimeLinkedTransient(extractRuntimeLinkedTransient(next))
      onLinkedDataChange?.(publicLinkedData)

      if (!isRangesControlled) {
        setInternalRanges(publicLinkedData.items)
      }

      if (!isSelectedRangeIdControlled) {
        setInternalSelectedRangeId(publicLinkedData.selectedRangeId)
      }

      for (const range of publicLinkedData.items) {
        emitPendingLinkedHighlight(range)
        if (!pendingLinkedHighlightOperationRef.current) {
          break
        }
      }
    },
    [
      emitPendingLinkedHighlight,
      isRangesControlled,
      isSelectedRangeIdControlled,
      onLinkedDataChange,
      readerLinkedScopeId
    ]
  )

  const handleLinkedSelect = useCallback(
    (range: LinkedSelectionRange) => {
      const publicRange = mapRuntimeRangeToPublic(range, readerLinkedScopeId)

      if (publicRange) {
        onLinkedSelect?.(publicRange)
        emitLinkedSelectOnce(publicRange)
        emitPendingLinkedHighlight(publicRange)
      }
    },
    [
      emitLinkedSelectOnce,
      emitPendingLinkedHighlight,
      onLinkedSelect,
      readerLinkedScopeId
    ]
  )

  const handleLinkedUpdateRange = useCallback(
    (range: LinkedSelectionRange) => {
      const publicRange = mapRuntimeRangeToPublic(range, readerLinkedScopeId)

      if (publicRange) {
        onLinkedUpdateRange?.(publicRange)
        onUpdateRange?.(publicRange)
      }
    },
    [onLinkedUpdateRange, onUpdateRange, readerLinkedScopeId]
  )

  const handleLinkedSelectRange = useCallback(
    (id: string | null) => {
      onLinkedSelectRange?.(id)
      onSelectRange?.(id)
    },
    [onLinkedSelectRange, onSelectRange]
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

    // intermediate-document 默认模式仅渲染空外壳，绝不调用页面/内容加载器；
    // 真实懒加载队列将在后续任务 中实现。
    if (renderMode === 'intermediate-document') {
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
  }, [loadablePages, runtimeDocument, renderMode, textsByPageNumber])

  // intermediate-document 模式的懒加载队列触发器。
  // 在 shell 就绪后（pageNumbers/runtimeDocument 稳定），通过
  // useLazyPageQueue hook 入队前 initialLoadedPages 页并启动加载。
  // 队列强制 pageLoadConcurrency 并发上限，去重 queued/in-flight/loaded，
  // 并通过 generation token 忽略 document/renderMode 变更后的 stale 结果。
  useEffect(() => {
    if (renderMode !== 'intermediate-document' || !runtimeDocument) {
      return
    }
    lazyPageQueue.enqueueInitialPages(pageNumbers)
  }, [pageNumbers, runtimeDocument, renderMode, lazyPageQueue])

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
    <ViewerContent
      rootClassName={rootClassName}
      viewerRootRef={setViewerRootRef}
      runtimeDocument={runtimeDocument}
      pageNumbers={pageNumbers}
      virtualPaperTransform={virtualPaperTransform}
      scaleRange={scaleRange}
      handleVirtualPaperTransformChange={handleVirtualPaperTransformChange}
      handleVirtualPaperTransformChangeEnd={
        handleVirtualPaperTransformChangeEnd
      }
      renderMode={renderMode}
      effectiveSelectedRangeId={effectiveSelectedRangeId}
      runtimePageSelectionId={getRuntimePageSelectionId}
      runtimeLinkedData={runtimeLinkedData}
      handleLinkedDataChange={handleLinkedDataChange}
      handleLinkedSelect={handleLinkedSelect}
      handleLinkedUpdateRange={handleLinkedUpdateRange}
      handleLinkedSelectRange={handleLinkedSelectRange}
      beginLinkedHighlightOperation={beginLinkedHighlightOperation}
      schedulePendingLinkedHighlightCleanup={
        schedulePendingLinkedHighlightCleanup
      }
      onSelectionStartProp={onSelectionStartProp}
      handleSelectionStart={handleSelectionStart}
      onSelectionEndProp={onSelectionEndProp}
      handleSelectionEnd={handleSelectionEnd}
      highlightColor={highlightColor}
      selectionColor={selectionColor}
      selectionPopover={selectionPopover}
      highlightPopover={highlightPopover}
      autoHighlight={autoHighlight}
      overlayRectType={overlayRectType}
      selectionRef={selectionRef}
      htmlPageStatusesByPageNumber={htmlPageStatusesByPageNumber}
      htmlPagesByPageNumber={htmlPagesByPageNumber}
      setPageRef={setPageRef}
      setTextRef={setTextRef}
      textsByPageNumber={textsByPageNumber}
      ocrTextsByPageNumber={ocrTextsByPageNumber}
      pageStatuses={pageStatuses}
      loadablePages={loadablePages}
      baseImagesByPageNumber={baseImagesByPageNumber}
      imagesByPageNumber={imagesByPageNumber}
    />
  )
}
