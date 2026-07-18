import type { DrawingTool, DrawingValue } from '@hamster-note/painting'
import type {
  LinkedSelectionData,
  LinkedSelectionRange,
  SelectionRange,
  SelectionRef
} from '@hamster-note/selection'
import { Selection as HamsterSelection } from '@hamster-note/selection'
import {
  type IntermediateContent,
  IntermediateDocument,
  type IntermediateDocumentSerialized,
  type IntermediateImage,
  type IntermediateText
} from '@hamster-note/types'
import {
  DEFAULT_ENABLED_INTERACTIONS,
  VirtualPaper,
  VirtualPaperInteractionMode,
  type VirtualPaperTransform,
  type VirtualPaperTransformMeta
} from '@hamster-note/virtual-paper'
import React, {
  Profiler,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryChangeSource,
  ReaderAnnotationHistoryOptions,
  ReaderAnnotationHistoryValue,
  ReaderHighlightPopover,
  ReaderLinkedSelectionData,
  ReaderMousePosition,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderSelectionTool
} from '../../types/selection'
import { hasDrawingStrokes, PageDrawingLayer } from '../PageDrawingLayer'
import { PopoverPortal } from '../PopoverPortal'
import { useAnnotationHistory } from '../Reader/useAnnotationHistory'
import { isPointOnSelectionText } from '../selection/caretResolver'
import {
  buildSelectionPayload,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload,
  textElementRecords
} from '../selection/selectionPayloadSerializer'
import { isSelectionPointerMoveTextHit } from '../selection/selectionPointerGuard'
import { IntermediateDocumentPageContent } from './IntermediateDocumentPageContent'
import { PageBrowser } from './PageBrowser'
import { RangeHandle } from './RangeHandle'
import { RangeMagnifierProvider } from './RangeMagnifier'
import {
  computePageOriginY,
  computeTransform,
  computeTransformForOffset,
  parsePublicPageId,
  rectCenterToPagePixels,
  resolveRangeJumpTarget
} from './rangeJumpHelpers'
import {
  createIntermediateDocumentRenderTiming,
  type IntermediateDocumentRenderTimingCallback,
  type IntermediateDocumentRenderTimingEntry
} from './renderTiming'
import {
  areRuntimeLinkedTransientsEqual,
  buildRuntimeLinkedSelectionData,
  extractRuntimeLinkedTransient,
  mapPublicRectanglesToRuntime,
  mapRuntimeLinkedDataToPublic,
  mapRuntimeRangeToPublic,
  mapRuntimeRectangleToPublic,
  mapRuntimeSelectionIdToPublic,
  type RuntimeLinkedSelectionTransient,
  runtimePageSelectionId
} from './selectionAdapter'
// intermediate-document 默认模式的懒加载页面队列 hook
import { type LazyPageQueueConfig, useLazyPageQueue } from './useLazyPageQueue'

export {
  getNearestTextElementForPoint,
  getPageElementByPageNumber,
  getPageElementForPoint,
  resolveCaret
} from '../selection/caretResolver'
export {
  buildSavedSelection,
  denormalizePageRects,
  type NormalizedRect,
  normalizePageRects,
  resolveSavedSelection,
  type TextElementInfo,
  textHash
} from '../selection/savedSelection'
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

const getSelectionForRoot = (
  viewerRoot: HTMLElement | null
): Selection | null => {
  return viewerRoot?.ownerDocument.defaultView?.getSelection?.() ?? null
}

const EMPTY_SELECTION_RANGES: SelectionRange[] = []
const EMPTY_INTERMEDIATE_TEXTS: IntermediateText[] = []
const EMPTY_INTERMEDIATE_IMAGES: IntermediateImage[] = []
const JUMP_PIN_CLEANUP_DELAY_MS = 5000

const getRenderTimingNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

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

/** 交互模式：'default' 为默认触摸/鼠标模式，'stylus' 为手写笔优化模式 */
export type ReaderInteractionMode = 'default' | 'stylus'

/** Touch/mouse pan mode for document scrolling through VirtualPaper. Default is single-finger pan. */
export type ReaderTouchPanMode = 'single-finger' | 'two-finger'

export type IntermediateDocumentViewerProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  serializedDocument?: IntermediateDocumentSerialized | null
  className?: string
  overscan?: number
  pageRange?: ReaderPageRange
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
    detail: {
      source: 'wheel' | 'pinch'
      focalPoint?: { x: number; y: number }
    }
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
   */
  maxLoadedPages?: number
  /** 交互模式，影响手势处理行为 */
  interactionMode?: ReaderInteractionMode
  /** 触摸文档平移模式：'single-finger' 为单指平移（默认），'two-finger' 为双指平移，避免与手写笔/选择操作冲突 */
  touchPanMode?: ReaderTouchPanMode
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
  /** 被高亮的片段上方弹出的 Popover 内容；renderer 接收当前高亮的原始公开对象。 */
  highlightPopover?: ReaderHighlightPopover
  /** 启动当前高亮的评论流程；Promise 完成后关闭该高亮的 Popover。 */
  onCommentHighlight?: (
    highlight: ReaderSelectionRange
  ) => Promise<ReaderSelectionRange>
  /** 是否在选区结束时自动触发高亮，默认为 false */
  autoHighlight?: boolean
  /** Selection 组件的命令式 ref，暴露 highlight()/clear()/confirm()/confirmRect() 方法 */
  selectionRef?: React.Ref<ReaderSelectionRef>
  /** 选区 Overlay 矩形坐标类型；默认 'percent' */
  overlayRectType?: ReaderSelectionOverlayRectType
  /** 当前选择工具模式；默认 'text'，传 'rect' 启用矩形框选 */
  tool?: ReaderSelectionTool
  /** 当前已存在的矩形框选列表（受控） */
  rects?: ReaderSelectionRectangle[]
  /** 当前被选中的矩形框选 ID（受控属性）；null 表示未选中任何矩形 */
  selectedRectId?: string | null
  /** 当用户确认一个新矩形框选时触发 */
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  /** 当用户选中/取消选中某个矩形框选时触发 */
  onSelectRect?: (id: string | null) => void
  /** 当用户拖动矩形手柄调整后触发 */
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  annotationHistory?: ReaderAnnotationHistoryOptions
  onAnnotationHistoryChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
  /**
   * 初始立即加载的页数。省略时默认 `1`。
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
  /** intermediate-document 渲染阶段计时回调 */
  onIntermediateDocumentRenderTiming?: IntermediateDocumentRenderTimingCallback
  /** VirtualPaper 水平留白边距，单位 px */
  containMarginX?: number
  /** VirtualPaper 顶部留白，单位 px */
  containMarginTop?: number
  /** VirtualPaper 底部留白，单位 px */
  containMarginBottom?: number
  /** @deprecated 使用 containMarginTop 和 containMarginBottom */
  containMarginY?: number
  selectedTool?: 'text-selection' | 'rect-selection' | 'drawing'
  paintingTool?: DrawingTool
  pagePaintings?: Record<string, DrawingValue>
  onPagePaintingChange?: (pageId: string, nextValue: DrawingValue) => void
  /** 是否显示从左侧滑入的页面浏览纵栏，默认 false */
  showPageBrowser?: boolean
  /** 主题色（CSS color），用于 page-browser 选中项的 outline。默认 '#2563eb'。 */
  themeColor?: string
}

type PageSize = {
  width: number
  height: number
}

type NormalizedPageSize = PageSize & {
  pageSizeUnavailable: boolean
}

type PageLoadStatus = 'loaded' | 'error'
const DEFAULT_PAGE_SIZE: PageSize = {
  width: 595,
  height: 842
}
// 与 reader.scss 中 intermediate page 的 12px 左右 margin 保持同步。
const INTERMEDIATE_PAGE_HORIZONTAL_MARGIN = 24

const TWO_FINGER_TOUCH_ENABLED_INTERACTIONS =
  DEFAULT_ENABLED_INTERACTIONS.filter(
    (mode) => mode !== VirtualPaperInteractionMode.TouchSingleFingerPan
  )

export const getVisiblePageNumbers = (
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

export const getRuntimeDocument = (
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

export const isIntermediateText = (
  content: IntermediateContent
): content is IntermediateText => 'content' in content && 'fontSize' in content

export const isIntermediateImage = (
  content: IntermediateContent
): content is IntermediateImage => {
  if (!('src' in content) || !('polygon' in content)) {
    return false
  }

  return typeof content.src === 'string' && content.src.trim().length > 0
}

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

const getCachedPageSize = (
  pageSizesByPageNumber: Map<number, NormalizedPageSize>,
  pageNumber: number
) => pageSizesByPageNumber.get(pageNumber) ?? normalizePageSize(undefined)

const getKnownPageSize = (
  pageSizesByPageNumber: Map<number, NormalizedPageSize>,
  pageNumber: number
): NormalizedPageSize | null => {
  const pageSize = pageSizesByPageNumber.get(pageNumber)
  return pageSize && !pageSize.pageSizeUnavailable ? pageSize : null
}

const getWidestKnownPageSize = (
  pageNumbers: number[],
  pageSizesByPageNumber: Map<number, NormalizedPageSize>
): NormalizedPageSize | null => {
  let widestPageSize: NormalizedPageSize | null = null

  for (const pageNumber of pageNumbers) {
    const pageSize = getKnownPageSize(pageSizesByPageNumber, pageNumber)
    if (!pageSize) return null
    if (!widestPageSize || pageSize.width > widestPageSize.width) {
      widestPageSize = pageSize
    }
  }

  return widestPageSize
}

const getWidestRenderedPageSize = (
  pageNumbers: number[],
  pageSizesByPageNumber: Map<number, NormalizedPageSize>
): NormalizedPageSize | null => {
  let widestPageSize: NormalizedPageSize | null = null

  for (const pageNumber of pageNumbers) {
    const pageSize = getCachedPageSize(pageSizesByPageNumber, pageNumber)
    if (!widestPageSize || pageSize.width > widestPageSize.width) {
      widestPageSize = pageSize
    }
  }

  return widestPageSize
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
  // scale 参数对应 IntermediatePage.getThumbnail(scale)，
  // 用于按当前缩放比例获取更高分辨率的缩略图，放大时背景图更清晰
  getThumbnail?: (scale?: number) => Promise<unknown> | unknown
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

// scale 可选参数传入 getThumbnail(scale)，用于按当前缩放比例请求
// 对应分辨率的缩略图。不传时使用 getThumbnail 的默认行为（初始加载）。
const getBaseImageFromPage = async (page: unknown, scale?: number) => {
  if (!page || typeof page !== 'object') {
    return undefined
  }

  const pageWithImage = page as PageWithBaseImage
  const inlineBaseImage =
    getStringBaseImage(pageWithImage.thumbnail) ??
    getStringBaseImage(pageWithImage.image)

  // 如果页面内联了静态缩略图（thumbnail/image 属性），直接使用，
  // 不走 getThumbnail —— 内联缩略图不支持按 scale 生成不同分辨率
  if (inlineBaseImage) {
    return inlineBaseImage
  }

  if (typeof pageWithImage.getThumbnail !== 'function') {
    return undefined
  }

  try {
    return getStringBaseImage(await pageWithImage.getThumbnail(scale))
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

export const getPageContentEntries = async (
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

type SetTextRef = (
  text: IntermediateText,
  pageNumber: number
) => (element: HTMLSpanElement | null) => void

type PageRefSetter = (
  pageNumber: number
) => (element: HTMLDivElement | null) => void

type PageResources = {
  pageSizesByPageNumber: Map<number, NormalizedPageSize>
  textsByPageNumber: Map<number, IntermediateText[]>
  ocrTextsByPageNumber: Map<number, IntermediateText[]>
  pageStatuses: Map<number, PageLoadStatus>
  loadablePages: Set<number>
  baseImagesByPageNumber: Map<number, string>
}

type ViewerContentProps = PageResources & {
  rootClassName: string
  viewerRootRef: (element: HTMLDivElement | null) => void
  pageNumbers: number[]
  virtualPaperTransform: VirtualPaperTransform
  scaleRange: { min: number; max: number }
  onInitialFitScale: (fitScale: number) => void
  onScrollToRange: (id: string) => void
  onScrollToRect: (id: string) => void
  onScrollToPosition: (position: {
    x: number
    y: number
    scale?: number
  }) => void
  imagesByPageNumber: Map<number, IntermediateImage[]>
  onPageRenderTiming:
    | ((
        pageNumber: number,
        startTime: number,
        commitTime: number,
        actualDuration: number
      ) => void)
    | undefined
  handleVirtualPaperTransformChange: (
    nextTransform: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => void
  handleVirtualPaperTransformChangeEnd: (
    nextTransform: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => void
  effectiveSelectedRangeId: string | null
  selectedHighlight: ReaderSelectionRange | null
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
  selectionPopover: ReactNode
  highlightPopover: ReaderHighlightPopover
  onCommentHighlight:
    | ((highlight: ReaderSelectionRange) => Promise<ReaderSelectionRange>)
    | undefined
  autoHighlight: boolean | undefined
  overlayRectType: ReaderSelectionOverlayRectType
  selectionRef: Ref<ReaderSelectionRef> | undefined
  tool?: ReaderSelectionTool
  rects?: ReaderSelectionRectangle[]
  selectedRectId?: string | null
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  onSelectRect?: (id: string | null) => void
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  annotationHistoryController: ReturnType<typeof useAnnotationHistory>
  onClearAnnotationHistory: () => void
  onRunAnnotationHistory: (source: 'undo' | 'redo') => boolean
  setPageRef: PageRefSetter
  setTextRef: SetTextRef
  touchPanMode?: ReaderTouchPanMode
  containMarginX?: number
  containMarginTop?: number
  containMarginBottom?: number
  containMarginY?: number
  selectedTool?: 'text-selection' | 'rect-selection' | 'drawing'
  paintingTool?: DrawingTool
  pagePaintings?: Record<string, DrawingValue>
  onPagePaintingChange?: (pageId: string, nextValue: DrawingValue) => void
  drawingScale: number
  showPageBrowser: boolean
  onPageBrowserVisibilityChange: (
    pageNumber: number,
    isVisible: boolean
  ) => void
  onNavigateToPage: (pageNumber: number) => void
  themeColor?: string
  visiblePageNumbers: ReadonlySet<number>
}

type PendingLinkedHighlightOperation = ReadonlySet<string>

type PageLoadTimingStart = {
  readonly startedAt: number
  readonly stage: 'initial-page-loading' | 'visibility-lazy-loading'
}

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

/**
 * `intermediate-document` 默认模式的页面渲染器。
 *
 * 为每个 `pageNumbers` 条目渲染一个 `.hamster-reader__intermediate-page` 外壳，
 * 设置 `data-testid`、`data-page-number`、`data-selection-id` 及缓存尺寸
 * （缺失时回退 `DEFAULT_PAGE_SIZE`）。
 *
 * 当某页已在内容 maps 中拥有已加载内容时，在外壳内渲染
 * `<IntermediateDocumentPageContent>`（底图 + 文本 span + OCR span + 图片项）；
 * 未加载的页面保持空外壳，由懒加载队列（后续任务）填充。
 *
 * 关键约束：外壳渲染阶段绝不调用页面/内容加载器；绝不使用
 * `dangerouslySetInnerHTML`；内容由独立渲染器以 React 元素绘制。
 */
type IntermediateDocumentPagesProps = PageResources & {
  popoverContainerRef: React.RefObject<HTMLElement | null>
  viewerRootElement: HTMLElement | null
  pageNumbers: number[]
  setPageRef: PageRefSetter
  setTextRef: SetTextRef
  runtimePageSelectionId: (pageNumber: number) => string
  imagesByPageNumber: Map<number, IntermediateImage[]>
  // 每个「已加载」页面内容由一个 HamsterSelection 实例包裹，
  // 使用 runtimePageSelectionId(pageNumber) 作为 runtime 选中 id，
  // 共享同一份 runtime LinkedSelectionData 引用，并通过回调桥接 public 语义。
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
  handleSelectionEnd: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  autoHighlight: boolean | undefined
  highlightColor: string | undefined
  selectionColor: string | undefined
  overlayRectType: ReaderSelectionOverlayRectType
  effectiveSelectedRangeId: string | null
  selectionPopover: ReactNode
  highlightPopover: ReactNode
  popoverVisible: boolean
  selectionRefForRuntimeId: (
    selectionId: string
  ) => (node: SelectionRef | null) => void
  tool?: ReaderSelectionTool
  rects?: ReaderSelectionRectangle[]
  selectedRectId?: string | null
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  onSelectRect?: (id: string | null) => void
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  onRectPointerUp?: (pageNumber: number) => void
  onPageRenderTiming?: (
    pageNumber: number,
    startTime: number,
    commitTime: number,
    actualDuration: number
  ) => void
  selectedTool?: 'text-selection' | 'rect-selection' | 'drawing'
  paintingTool?: DrawingTool
  pagePaintings?: Record<string, DrawingValue>
  onPagePaintingChange?: (pageId: string, nextValue: DrawingValue) => void
  drawingScale: number
}

const areAnnotationHistorySnapshotsEqual = (
  left: ReaderAnnotationHistoryValue,
  right: ReaderAnnotationHistoryValue
): boolean => JSON.stringify(left) === JSON.stringify(right)

const makeAnnotationHistorySnapshot = (
  ranges: ReaderSelectionRange[],
  rects: ReaderSelectionRectangle[],
  selectedRangeId: string | null,
  selectedRectId: string | null
): ReaderAnnotationHistoryValue => ({
  ranges,
  rects,
  selectedRangeId,
  selectedRectId
})

const normalizeAnnotationHistorySnapshot = (
  snapshot: ReaderAnnotationHistoryValue
): ReaderAnnotationHistoryValue => {
  const selectedRangeExists = snapshot.selectedRangeId
    ? snapshot.ranges.some((range) => range.id === snapshot.selectedRangeId)
    : false
  const selectedRectExists = snapshot.selectedRectId
    ? snapshot.rects.some((rect) => rect.id === snapshot.selectedRectId)
    : false

  return {
    ...snapshot,
    selectedRangeId: selectedRangeExists ? snapshot.selectedRangeId : null,
    selectedRectId: selectedRectExists ? snapshot.selectedRectId : null
  }
}

const getLinkedDataChangeSource = (
  current: ReaderAnnotationHistoryValue,
  next: ReaderAnnotationHistoryValue
): ReaderAnnotationHistoryChangeSource | null => {
  if (areAnnotationHistorySnapshotsEqual(current, next)) return null
  if (
    JSON.stringify(current.ranges) === JSON.stringify(next.ranges) &&
    JSON.stringify(current.rects) === JSON.stringify(next.rects)
  ) {
    return null
  }

  if (next.ranges.length > current.ranges.length) return 'select'
  if (next.ranges.length < current.ranges.length) return 'clear'
  return 'update-range'
}

const hasUnsupportedUncontrolledRectTarget = (
  currentRects: ReaderSelectionRectangle[],
  targetRects: ReaderSelectionRectangle[]
): boolean =>
  !(currentRects.length === 0 && targetRects.length === 0) &&
  JSON.stringify(currentRects) !== JSON.stringify(targetRects)

const shouldBlockSelectionPointerMove = (
  event: PointerEvent,
  linkedData: LinkedSelectionData,
  viewerRootElement: HTMLElement
): boolean =>
  (linkedData.selectingText || Boolean(linkedData.draggingRange)) &&
  !isPointOnSelectionText(event.clientX, event.clientY, viewerRootElement)

function IntermediateDocumentPages({
  popoverContainerRef,
  viewerRootElement,
  pageNumbers,
  setPageRef,
  setTextRef,
  runtimePageSelectionId,
  pageSizesByPageNumber,
  textsByPageNumber,
  ocrTextsByPageNumber,
  baseImagesByPageNumber,
  imagesByPageNumber,
  pageStatuses,
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
  selectionRefForRuntimeId,
  tool,
  rects,
  selectedRectId,
  onCreateRect,
  onSelectRect,
  onUpdateRect,
  onRectPointerUp,
  onPageRenderTiming,
  selectedTool,
  paintingTool,
  pagePaintings,
  onPagePaintingChange,
  drawingScale
}: IntermediateDocumentPagesProps) {
  // popover 归属计算：仅拥有「选中 range 的 start endpoint」所在页面的 Selection
  // 实例可以渲染 popover，其余页面传入 undefined。
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

  // onSelectionStart 仅在调用方提供 prop 时启用；
  // onSelectionEnd 当调用方提供 prop 或 autoHighlight 时启用。
  const selectionStartHandler = onSelectionStartProp
    ? handleSelectionStart
    : undefined
  const selectionEndHandler =
    onSelectionEndProp || autoHighlight ? handleSelectionEnd : undefined

  return (
    <div className='hamster-note-document'>
      {pageNumbers.map((pageNumber) => {
        const shellPageSize = getCachedPageSize(
          pageSizesByPageNumber,
          pageNumber
        )
        const shellSelectionId = runtimePageSelectionId(pageNumber)
        const publicPageId = `page-${pageNumber}`

        const pageTexts = textsByPageNumber.get(pageNumber)
        const pageBaseImage = baseImagesByPageNumber.get(pageNumber)
        const isPageContentLoaded = pageStatuses.get(pageNumber) === 'loaded'

        // popover gating：owner 为 null（无 selected range）时所有页面均呈现 popover，
        // 否则仅 shellSelectionId === popoverOwnerRuntimeId 的页面拿到真实 popover 内容。
        const isPopoverOwner =
          popoverOwnerRuntimeId === null ||
          popoverOwnerRuntimeId === shellSelectionId
        const pagePopover = isPopoverOwner ? (
          <PopoverPortal
            containerRef={popoverContainerRef}
            selectionKind='selected'
            visible={popoverVisible}
          >
            {highlightPopover ?? selectionPopover}
          </PopoverPortal>
        ) : undefined
        const pageSelectionPopover = isPopoverOwner ? (
          <PopoverPortal
            containerRef={popoverContainerRef}
            selectionKind='active'
            visible={popoverVisible}
          >
            {selectionPopover}
          </PopoverPortal>
        ) : undefined

        const pageContent = isPageContentLoaded ? (
          <IntermediateDocumentPageContent
            pageNumber={pageNumber}
            texts={pageTexts ?? EMPTY_INTERMEDIATE_TEXTS}
            ocrTexts={
              ocrTextsByPageNumber.get(pageNumber) ?? EMPTY_INTERMEDIATE_TEXTS
            }
            baseImageSource={pageBaseImage}
            images={
              imagesByPageNumber.get(pageNumber) ?? EMPTY_INTERMEDIATE_IMAGES
            }
            setTextRef={setTextRef}
            onRenderTiming={onPageRenderTiming}
          />
        ) : null

        return (
          <div
            key={pageNumber}
            ref={setPageRef(pageNumber)}
            className='hamster-reader__intermediate-page'
            data-testid={`intermediate-page-${pageNumber}`}
            data-page-number={pageNumber}
            data-tool={selectedTool}
            data-selection-id={shellSelectionId}
            data-page-size-unavailable={
              shellPageSize.pageSizeUnavailable ? 'true' : undefined
            }
            onPointerUp={() => onRectPointerUp?.(pageNumber)}
            style={{
              position: 'relative',
              width: `${shellPageSize.width}px`,
              height: `${shellPageSize.height}px`,
              overflow: 'hidden'
            }}
          >
            {isPageContentLoaded ? (
              <HamsterSelection
                selectionId={shellSelectionId}
                linkedMode
                linkedData={runtimeLinkedData}
                onLinkedDataChange={handleLinkedDataChange}
                onLinkedSelect={handleLinkedSelect}
                onLinkedUpdateRange={handleLinkedUpdateRange}
                onLinkedSelectRange={handleLinkedSelectRange}
                ranges={EMPTY_SELECTION_RANGES}
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
                tool={tool}
                rects={rects}
                selectedRectId={selectedRectId}
                onCreateRect={onCreateRect}
                onSelectRect={onSelectRect}
                onUpdateRect={onUpdateRect}
                renderHandle={(handle) => (
                  <RangeHandle
                    handle={handle}
                    linkedData={runtimeLinkedData}
                    scale={drawingScale}
                    selectionId={shellSelectionId}
                    viewerRoot={viewerRootElement}
                  />
                )}
                ref={selectionRefForRuntimeId(shellSelectionId)}
              >
                {pageContent}
              </HamsterSelection>
            ) : null}
            {isPageContentLoaded &&
              (selectedTool === 'drawing' ||
                hasDrawingStrokes(pagePaintings?.[publicPageId])) && (
                <PageDrawingLayer
                  enabled={selectedTool === 'drawing'}
                  pageId={publicPageId}
                  tool={paintingTool}
                  value={pagePaintings?.[publicPageId]}
                  canvasScale={drawingScale}
                  onChange={
                    onPagePaintingChange
                      ? (nextValue) =>
                          onPagePaintingChange(publicPageId, nextValue)
                      : undefined
                  }
                />
              )}
          </div>
        )
      })}
    </div>
  )
}

function getValidSelectionRange(
  selection: Selection | null,
  viewerRootElement: HTMLElement
): Range | null {
  if (
    !selection ||
    typeof selection.getRangeAt !== 'function' ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (
    !viewerRootElement.contains(range.startContainer) ||
    !viewerRootElement.contains(range.endContainer)
  ) {
    return null
  }
  return range
}

function ViewerContent({
  rootClassName,
  viewerRootRef,
  pageNumbers,
  pageSizesByPageNumber,
  virtualPaperTransform,
  scaleRange,
  onInitialFitScale,
  onScrollToRange,
  onScrollToRect,
  onScrollToPosition,
  handleVirtualPaperTransformChange,
  handleVirtualPaperTransformChangeEnd,
  effectiveSelectedRangeId,
  selectedHighlight,
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
  onCommentHighlight,
  autoHighlight,
  overlayRectType,
  selectionRef,
  tool,
  rects,
  selectedRectId,
  onCreateRect,
  onSelectRect,
  onUpdateRect,
  annotationHistoryController,
  onClearAnnotationHistory,
  onRunAnnotationHistory,
  setPageRef,
  setTextRef,
  textsByPageNumber,
  ocrTextsByPageNumber,
  pageStatuses,
  loadablePages,
  baseImagesByPageNumber,
  imagesByPageNumber,
  onPageRenderTiming,
  touchPanMode,
  containMarginX,
  containMarginTop,
  containMarginBottom,
  containMarginY,
  selectedTool,
  paintingTool,
  pagePaintings,
  onPagePaintingChange,
  drawingScale,
  showPageBrowser,
  onPageBrowserVisibilityChange,
  onNavigateToPage,
  themeColor,
  visiblePageNumbers
}: ViewerContentProps) {
  const [viewerRootElement, setViewerRootElement] =
    useState<HTMLDivElement | null>(null)
  const popoverContainerRef = useRef<HTMLElement | null>(null)
  const selectionRefsByRuntimeIdRef = useRef(new Map<string, SelectionRef>())
  const selectionRefSettersByRuntimeIdRef = useRef(
    new Map<string, (node: SelectionRef | null) => void>()
  )
  const syncForwardedSelectionRefRef = useRef<() => void>(() => {})
  const runtimeLinkedDataRef = useRef(runtimeLinkedData)
  runtimeLinkedDataRef.current = runtimeLinkedData
  const touchTapStartRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    moved: boolean
  } | null>(null)
  const lastValidSelectionRangeRef = useRef<Range | null>(null)
  const selectionFrozenRef = useRef(false)
  const restoringSelectionRef = useRef(false)

  // --- Portal popover 可见性控制 ---
  // VirtualPaper pan/zoom 期间隐藏 popover，transform 结束后 500ms debounce 再显示
  const [popoverVisible, setPopoverVisible] = useState(true)
  const [commentingRangeId, setCommentingRangeId] = useState<string | null>(
    null
  )
  const popoverDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const annotationHistoryControllerRef = useRef(annotationHistoryController)
  annotationHistoryControllerRef.current = annotationHistoryController
  const runAnnotationHistoryRef = useRef(onRunAnnotationHistory)
  runAnnotationHistoryRef.current = onRunAnnotationHistory

  const setRootRef = useCallback(
    (element: HTMLDivElement | null) => {
      setViewerRootElement(element)
      viewerRootRef(element)
    },
    [viewerRootRef]
  )

  useEffect(() => {
    if (
      !viewerRootElement ||
      selectedTool === 'rect-selection' ||
      selectedTool === 'drawing'
    ) {
      return
    }

    const ownerDocument = viewerRootElement.ownerDocument

    const restoreLastValidSelection = (): void => {
      const range = lastValidSelectionRangeRef.current
      const selection = ownerDocument.defaultView?.getSelection()
      if (!range || !selection) return

      try {
        restoringSelectionRef.current = true
        selection.removeAllRanges()
        selection.addRange(range.cloneRange())
      } catch {
        lastValidSelectionRangeRef.current = null
      } finally {
        restoringSelectionRef.current = false
      }
    }

    // Native selection can emit selectionchange after an off-text pointermove.
    // Restore the last real text range instead of accepting the page-start caret.
    const handleSelectionChange = () => {
      if (restoringSelectionRef.current) return

      if (selectionFrozenRef.current) {
        restoreLastValidSelection()
        return
      }

      const range = getValidSelectionRange(
        ownerDocument.defaultView?.getSelection() ?? null,
        viewerRootElement
      )
      if (range) {
        lastValidSelectionRangeRef.current = range.cloneRange()
      }
    }

    const guardPointerMove = (event: PointerEvent) => {
      if (isSelectionPointerMoveTextHit(event)) return

      const linkedData = runtimeLinkedDataRef.current
      if (!linkedData.selectingText) {
        if (!linkedData.draggingRange) return
      }

      const pointerOnText = isPointOnSelectionText(
        event.clientX,
        event.clientY,
        viewerRootElement
      )
      if (linkedData.selectingText && pointerOnText) {
        selectionFrozenRef.current = false
        return
      }

      if (
        !shouldBlockSelectionPointerMove(event, linkedData, viewerRootElement)
      ) {
        return
      }

      if (linkedData.selectingText) {
        selectionFrozenRef.current = true
        restoreLastValidSelection()
      }

      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const finishSelectionDrag = () => {
      if (selectionFrozenRef.current) {
        restoreLastValidSelection()
      }
      selectionFrozenRef.current = false
      lastValidSelectionRangeRef.current = null
    }

    ownerDocument.addEventListener(
      'selectionchange',
      handleSelectionChange,
      true
    )
    ownerDocument.addEventListener('pointermove', guardPointerMove, true)
    ownerDocument.addEventListener('pointerup', finishSelectionDrag, true)
    ownerDocument.addEventListener('pointercancel', finishSelectionDrag, true)
    ownerDocument.addEventListener('touchend', finishSelectionDrag, true)
    ownerDocument.addEventListener('touchcancel', finishSelectionDrag, true)
    return () => {
      ownerDocument.removeEventListener(
        'selectionchange',
        handleSelectionChange,
        true
      )
      ownerDocument.removeEventListener('pointermove', guardPointerMove, true)
      ownerDocument.removeEventListener('pointerup', finishSelectionDrag, true)
      ownerDocument.removeEventListener(
        'pointercancel',
        finishSelectionDrag,
        true
      )
      ownerDocument.removeEventListener('touchend', finishSelectionDrag, true)
      ownerDocument.removeEventListener(
        'touchcancel',
        finishSelectionDrag,
        true
      )
      selectionFrozenRef.current = false
      lastValidSelectionRangeRef.current = null
    }
  }, [selectedTool, viewerRootElement])

  useEffect(() => {
    const container =
      viewerRootElement?.querySelector<HTMLElement>('.virtual-paper-wrapper') ??
      null
    popoverContainerRef.current = container
    if (!container) return

    const widestPageSize = getWidestRenderedPageSize(
      pageNumbers,
      pageSizesByPageNumber
    )
    const applyInitialFit = (width: number) => {
      if (!widestPageSize || width <= 0) return false

      onInitialFitScale(
        width / (widestPageSize.width + INTERMEDIATE_PAGE_HORIZONTAL_MARGIN)
      )
      return true
    }

    if (applyInitialFit(container.getBoundingClientRect().width)) {
      return () => {
        popoverContainerRef.current = null
      }
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry && applyInitialFit(entry.contentRect.width)) {
        observer.disconnect()
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      popoverContainerRef.current = null
    }
  }, [onInitialFitScale, pageNumbers, pageSizesByPageNumber, viewerRootElement])

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

  const getActiveLinkedRangeOwnerRef = useCallback(() => {
    const activeRange = runtimeLinkedDataRef.current.activeRange
    if (!activeRange) return undefined

    const ownerSelectionIds = [
      activeRange.start.selectionId,
      activeRange.end.selectionId
    ]

    for (const selectionId of ownerSelectionIds) {
      const selectionRef = selectionRefsByRuntimeIdRef.current.get(selectionId)
      if (selectionRef) return selectionRef
    }

    return null
  }, [])

  const getActiveSelectionRef = useCallback(() => {
    const ownerSelectionRef = getActiveSelectionOwnerRef()
    const linkedRangeOwnerSelectionRef =
      ownerSelectionRef === undefined
        ? getActiveLinkedRangeOwnerRef()
        : ownerSelectionRef
    return linkedRangeOwnerSelectionRef === undefined
      ? getFirstVisibleSelectionRef()
      : linkedRangeOwnerSelectionRef
  }, [
    getActiveLinkedRangeOwnerRef,
    getActiveSelectionOwnerRef,
    getFirstVisibleSelectionRef
  ])

  const highlightSelection = useCallback(() => {
    const operation = beginLinkedHighlightOperation()
    const activeRange = runtimeLinkedDataRef.current.activeRange
    const activeSelectionRef = getActiveSelectionRef()
    const nativeSelectionText = window.getSelection()?.toString() ?? ''

    try {
      if (
        nativeSelectionText.length === 0 &&
        activeRange &&
        activeRange !== runtimeLinkedData.activeRange
      ) {
        const nextLinkedData = {
          ...runtimeLinkedDataRef.current,
          items: [...runtimeLinkedDataRef.current.items, activeRange],
          selectedRangeId: activeRange.id,
          activeRange: null
        }
        runtimeLinkedDataRef.current = nextLinkedData
        handleLinkedDataChange(nextLinkedData)
        handleLinkedSelect(activeRange)
        handleLinkedSelectRange(activeRange.id)
        return
      }

      activeSelectionRef?.highlight()
    } finally {
      schedulePendingLinkedHighlightCleanup(operation)
    }
  }, [
    beginLinkedHighlightOperation,
    getActiveSelectionRef,
    handleLinkedDataChange,
    handleLinkedSelect,
    handleLinkedSelectRange,
    runtimeLinkedData.activeRange,
    schedulePendingLinkedHighlightCleanup
  ])

  const confirmRectSelection = useCallback(() => {
    selectionRefsByRuntimeIdRef.current.forEach((selectionRef) => {
      selectionRef.confirmRect()
    })
  }, [])

  const handleRectPointerUp = useCallback(
    (pageNumber: number) => {
      if (!autoHighlight || tool !== 'rect') return
      const selectionId = runtimePageSelectionId(pageNumber)
      selectionRefsByRuntimeIdRef.current.get(selectionId)?.confirmRect()
    },
    [autoHighlight, runtimePageSelectionId, tool]
  )

  const confirmSelection = useCallback(() => {
    if (tool === 'rect') {
      confirmRectSelection()
      return
    }
    highlightSelection()
  }, [confirmRectSelection, highlightSelection, tool])

  const clearSelections = useCallback(() => {
    selectionRefsByRuntimeIdRef.current.forEach((selectionRef) => {
      selectionRef.clear()
    })
    onClearAnnotationHistory()
  }, [onClearAnnotationHistory])

  const publicSelectionRef = useMemo<ReaderSelectionRef>(
    () => ({
      highlight: highlightSelection,
      confirm: confirmSelection,
      confirmRect: confirmRectSelection,
      clear: clearSelections,
      scrollToRange: onScrollToRange,
      scrollToRect: onScrollToRect,
      scrollToPosition: onScrollToPosition,
      undo: () => runAnnotationHistoryRef.current('undo'),
      redo: () => runAnnotationHistoryRef.current('redo'),
      canUndo: () => annotationHistoryControllerRef.current.getStatus().canUndo,
      canRedo: () => annotationHistoryControllerRef.current.getStatus().canRedo,
      getAnnotationHistoryState: () =>
        annotationHistoryControllerRef.current.getStatus()
    }),
    [
      clearSelections,
      confirmSelection,
      confirmRectSelection,
      highlightSelection,
      onScrollToRange,
      onScrollToRect,
      onScrollToPosition
    ]
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
      setSelectionRef = (node: SelectionRef | null) => {
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

  const handleTouchPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.pointerType !== 'touch' ||
        !event.isPrimary ||
        selectedTool === 'drawing'
      ) {
        touchTapStartRef.current = null
        return
      }

      touchTapStartRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false
      }
    },
    [selectedTool]
  )

  const handleTouchPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const touchStart = touchTapStartRef.current
      if (
        touchStart &&
        event.pointerId === touchStart.pointerId &&
        (Math.abs(event.clientX - touchStart.clientX) > 4 ||
          Math.abs(event.clientY - touchStart.clientY) > 4)
      ) {
        touchStart.moved = true
      }
    },
    []
  )

  const handleTouchPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const touchStart = touchTapStartRef.current
      touchTapStartRef.current = null
      if (
        !touchStart ||
        touchStart.moved ||
        event.pointerType !== 'touch' ||
        event.pointerId !== touchStart.pointerId ||
        Math.abs(event.clientX - touchStart.clientX) > 4 ||
        Math.abs(event.clientY - touchStart.clientY) > 4 ||
        runtimeLinkedDataRef.current.selectedRangeId === null ||
        runtimeLinkedDataRef.current.activeRange ||
        runtimeLinkedDataRef.current.draggingRange ||
        runtimeLinkedDataRef.current.selectingText
      ) {
        return
      }

      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          '.hsn-selection-popover, .hsn-selection-handle, button, a, input, textarea, select, option, label, summary, details, [role="button"], [contenteditable="true"]'
        )
      ) {
        return
      }

      const linkedData = runtimeLinkedDataRef.current
      const selectionContainers = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          '.hamster-reader__intermediate-page[data-selection-id]'
        )
      )
      let touchedRangeId: string | null = null
      for (const range of linkedData.items) {
        const rectType =
          range.overlayRectType ?? linkedData.overlayRectType ?? 'percent'
        const touchedRange = Object.entries(range.rectsBySelectionId).some(
          ([selectionId, rects]) => {
            const container = selectionContainers.find(
              (element) => element.dataset.selectionId === selectionId
            )
            if (!container) return false

            const bounds = container.getBoundingClientRect()
            if (bounds.width <= 0 || bounds.height <= 0) return false

            const localX =
              rectType === 'percent'
                ? ((event.clientX - bounds.left) / bounds.width) * 100
                : ((event.clientX - bounds.left) / bounds.width) *
                  (container.clientWidth || bounds.width)
            const localY =
              rectType === 'percent'
                ? ((event.clientY - bounds.top) / bounds.height) * 100
                : ((event.clientY - bounds.top) / bounds.height) *
                  (container.clientHeight || bounds.height)
            return rects.some(
              (rect) =>
                localX >= rect.x &&
                localX <= rect.x + rect.width &&
                localY >= rect.y &&
                localY <= rect.y + rect.height
            )
          }
        )
        if (touchedRange) {
          touchedRangeId = range.id
          break
        }
      }
      if (touchedRangeId) {
        if (touchedRangeId !== linkedData.selectedRangeId) {
          handlePageLinkedSelectRange(touchedRangeId)
        }
        return
      }

      const touchedHighlight = Array.from(
        event.currentTarget.querySelectorAll(
          '.hsn-selection-rect--highlight, .hsn-selection-rect--selected, .hsn-selection-percent-rect-highlight'
        )
      ).some((element) => {
        const rect = element.getBoundingClientRect()
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        )
      })
      if (!touchedHighlight) {
        handlePageLinkedSelectRange(null)
      }
    },
    [handlePageLinkedSelectRange]
  )

  const handleCommentHighlight = useCallback(() => {
    if (!selectedHighlight || !onCommentHighlight || commentingRangeId) return

    const highlight = selectedHighlight
    setCommentingRangeId(highlight.id)
    onCommentHighlight(highlight).then(
      () => {
        if (runtimeLinkedDataRef.current.selectedRangeId === highlight.id) {
          handlePageLinkedSelectRange(null)
        }
        setCommentingRangeId(null)
      },
      () => {
        setCommentingRangeId(null)
      }
    )
  }, [
    commentingRangeId,
    handlePageLinkedSelectRange,
    onCommentHighlight,
    selectedHighlight
  ])

  let resolvedHighlightPopover: ReactNode
  if (typeof highlightPopover === 'function') {
    resolvedHighlightPopover = selectedHighlight
      ? highlightPopover(selectedHighlight)
      : selectionPopover
  } else {
    resolvedHighlightPopover = highlightPopover ?? selectionPopover
  }
  const existingHighlightPopover =
    selectedHighlight && onCommentHighlight ? (
      <div className='hamster-reader__highlight-popover'>
        {resolvedHighlightPopover}
        <button
          type='button'
          className='hamster-reader__highlight-comment-button'
          disabled={commentingRangeId !== null}
          onClick={handleCommentHighlight}
        >
          评论
        </button>
      </div>
    ) : (
      resolvedHighlightPopover
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

  const intermediateDocumentPages = (
    <IntermediateDocumentPages
      popoverContainerRef={popoverContainerRef}
      viewerRootElement={viewerRootElement}
      pageNumbers={pageNumbers}
      setPageRef={setPageRef}
      setTextRef={setTextRef}
      runtimePageSelectionId={runtimePageSelectionId}
      pageSizesByPageNumber={pageSizesByPageNumber}
      textsByPageNumber={textsByPageNumber}
      ocrTextsByPageNumber={ocrTextsByPageNumber}
      pageStatuses={pageStatuses}
      loadablePages={loadablePages}
      baseImagesByPageNumber={baseImagesByPageNumber}
      imagesByPageNumber={imagesByPageNumber}
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
      highlightPopover={existingHighlightPopover}
      popoverVisible={popoverVisible}
      selectionRefForRuntimeId={selectionRefForRuntimeId}
      tool={tool}
      rects={rects}
      selectedRectId={selectedRectId}
      onCreateRect={onCreateRect}
      onSelectRect={onSelectRect}
      onUpdateRect={onUpdateRect}
      onRectPointerUp={handleRectPointerUp}
      onPageRenderTiming={onPageRenderTiming}
      selectedTool={selectedTool}
      paintingTool={paintingTool}
      pagePaintings={pagePaintings}
      onPagePaintingChange={onPagePaintingChange}
      drawingScale={drawingScale}
    />
  )

  const pagesNode = onPageRenderTiming ? (
    <Profiler
      id='intermediate-document-shell'
      onRender={(
        _id,
        _phase,
        actualDuration,
        _baseDuration,
        startTime,
        commitTime
      ) => {
        onPageRenderTiming(0, startTime, commitTime, actualDuration)
      }}
    >
      {intermediateDocumentPages}
    </Profiler>
  ) : (
    intermediateDocumentPages
  )

  return (
    <div
      ref={setRootRef}
      role='document'
      className={rootClassName}
      data-testid='intermediate-document-viewer'
      onPointerDown={handleTouchPointerDown}
      onPointerMove={handleTouchPointerMove}
      onPointerUp={handleTouchPointerUp}
      onPointerCancel={() => {
        touchTapStartRef.current = null
      }}
    >
      {pageNumbers.length > 0 ? (
        <RangeMagnifierProvider rootElement={viewerRootElement}>
          <PageBrowser
            isOpen={showPageBrowser}
            pageNumbers={pageNumbers}
            pageSizesByPageNumber={pageSizesByPageNumber}
            baseImagesByPageNumber={baseImagesByPageNumber}
            onPageVisibilityChange={onPageBrowserVisibilityChange}
            onNavigateToPage={onNavigateToPage}
            themeColor={themeColor}
            visiblePageNumbers={visiblePageNumbers}
            containMarginTop={containMarginTop}
            containMarginBottom={containMarginBottom}
          />
          <VirtualPaper
            containMode={true}
            transform={virtualPaperTransform}
            minScale={scaleRange.min}
            maxScale={scaleRange.max}
            enabledInteractions={
              selectedTool === 'drawing' || touchPanMode === 'two-finger'
                ? TWO_FINGER_TOUCH_ENABLED_INTERACTIONS
                : DEFAULT_ENABLED_INTERACTIONS
            }
            onTransformChange={handleTransformChangeWithPopover}
            onTransformChangeEnd={handleTransformChangeEndWithPopover}
            containMarginX={containMarginX}
            containMarginY={
              containMarginTop === undefined &&
              containMarginBottom === undefined
                ? containMarginY
                : undefined
            }
            containerStyle={{
              // container div 被 VirtualPaper 的 transform: scale(s) 缩放，
              // 直接设置 padding 会被 zoom 放大/缩小。
              // 除以 scale 补偿：视觉 padding = (margin / scale) * scale = margin（恒定）
              paddingTop:
                containMarginTop !== undefined
                  ? containMarginTop / virtualPaperTransform.scale
                  : undefined,
              paddingBottom:
                containMarginBottom !== undefined
                  ? containMarginBottom / virtualPaperTransform.scale
                  : undefined
            }}
          >
            {pagesNode}
          </VirtualPaper>
        </RangeMagnifierProvider>
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
  touchPanMode,
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
  onCommentHighlight,
  autoHighlight,
  selectionRef,
  overlayRectType = 'percent',
  tool,
  rects,
  selectedRectId,
  onCreateRect,
  onSelectRect,
  onUpdateRect,
  annotationHistory,
  onAnnotationHistoryChange,
  initialLoadedPages = 1,
  pageLoadConcurrency = 3,
  pageLoadEnterDelayMs = 500,
  pageUnloadDelayMs = 5000,
  onIntermediateDocumentRenderTiming,
  containMarginX,
  containMarginTop,
  containMarginBottom,
  containMarginY,
  selectedTool,
  paintingTool,
  pagePaintings,
  onPagePaintingChange,
  showPageBrowser = false,
  themeColor
}: IntermediateDocumentViewerProps) {
  // Render timing controller: stable across renders, callback identity
  // does not cause re-renders. Stored in ref for Tasks 5-7 pipeline
  // instrumentation.
  const renderTimingCallbackRef = useRef(onIntermediateDocumentRenderTiming)
  renderTimingCallbackRef.current = onIntermediateDocumentRenderTiming
  const renderTimingRef = useRef(
    createIntermediateDocumentRenderTiming({
      callback: (...args) => renderTimingCallbackRef.current?.(...args)
    })
  )
  const renderPhaseTimingBufferRef = useRef<
    IntermediateDocumentRenderTimingEntry[]
  >([])
  const pageLoadTimingStartsRef = useRef(new Map<number, PageLoadTimingStart>())

  const runtimeDocument = useMemo(() => {
    const inputDocument = document ?? serializedDocument
    if (!renderTimingRef.current.enabled)
      return getRuntimeDocument(inputDocument)

    const startedAt = getRenderTimingNow()
    const nextRuntimeDocument = getRuntimeDocument(inputDocument)
    const endedAt = getRenderTimingNow()
    renderPhaseTimingBufferRef.current.push({
      stage: 'document-resolution',
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      detail: {
        hasDocument: Boolean(document),
        hasSerializedDocument: Boolean(serializedDocument),
        pageCount: nextRuntimeDocument?.pageNumbers.length ?? 0
      }
    })
    return nextRuntimeDocument
  }, [document, serializedDocument])

  useEffect(() => {
    const buffer = renderPhaseTimingBufferRef.current
    if (buffer.length === 0) return

    renderPhaseTimingBufferRef.current = []
    buffer.forEach((entry) => {
      renderTimingRef.current.record(entry)
    })
  })

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
  const pageSizesByPageNumber = useMemo(() => {
    const nextPageSizes = new Map<number, NormalizedPageSize>()
    if (!runtimeDocument) return nextPageSizes

    pageNumbers.forEach((pageNumber) => {
      nextPageSizes.set(
        pageNumber,
        normalizePageSize(runtimeDocument.getPageSizeByPageNumber(pageNumber))
      )
    })

    return nextPageSizes
  }, [runtimeDocument, pageNumbers])
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const loadingPagesRef = useRef(new Set<number>())
  const ocrLoadingPagesRef = useRef(new Set<number>())
  const ocrCacheRef = useRef(new Map<string, IntermediateText[]>())
  const evictedOcrPagesRef = useRef(new Set<number>())
  // 每页 OCR 驱逐代际：离屏卸载时递增对应页码代际。OCR 异步任务发起时
  // 捕获代际，resolve 时比对——不一致即运行期间被卸载过（stale，丢弃），
  // 一致则为重载后的新鲜结果（写回）。借此区分卸载前 stale OCR 与重载后
  // 重新发起的 OCR，修复仅凭 evictedOcrPagesRef.has 导致重载后永久被拒的死锁。
  const ocrEvictGenerationRef = useRef(new Map<number, number>())
  // 被 evictLazyPageBundle 卸载的初始页面集合。enqueueInitialPages 的
  // isPageLoaded 检查此集合，防止 eviction 后 lazyPageQueue identity
  // 变化触发 effect 重跑而重新加载已卸载的页面。页面重新进入可见窗口
  // 时从集合中移除，允许通过 enqueuePage 重新加载。
  const lazilyEvictedPagesRef = useRef(new Set<number>())
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

  const handlePageRenderTiming = useCallback(
    (
      pageNumber: number,
      startTime: number,
      commitTime: number,
      actualDuration: number
    ) => {
      if (pageNumber === 0) {
        renderTimingRef.current.record({
          stage: 'shell-rendering',
          startedAt: startTime,
          endedAt: commitTime,
          durationMs: actualDuration,
          detail: { pageCount: pageNumbers.length }
        })
        return
      }

      renderTimingRef.current.record({
        stage: 'page-content-rendering',
        startedAt: startTime,
        endedAt: commitTime,
        durationMs: actualDuration,
        pageNumber
      })
    },
    [pageNumbers.length]
  )
  const pageRenderTimingHandler = renderTimingRef.current.enabled
    ? handlePageRenderTiming
    : undefined

  // ---- Selection 库受控/非受控 state ----
  // ranges 受控（prop 提供）则直接用；否则内部 state 从 defaultRanges 初始化
  const isRangesControlled = ranges !== undefined
  const [internalRanges, setInternalRanges] = useState<ReaderSelectionRange[]>(
    () => defaultRanges ?? []
  )
  const effectiveRanges = isRangesControlled ? ranges : internalRanges
  const effectiveRangesRef = useRef<ReaderSelectionRange[]>(effectiveRanges)
  effectiveRangesRef.current = effectiveRanges

  const effectiveRects = rects ?? []
  const effectiveRectsRef = useRef<ReaderSelectionRectangle[]>(effectiveRects)
  effectiveRectsRef.current = effectiveRects
  const isRectsControlled = rects !== undefined

  const isSelectedRectIdControlled = selectedRectId !== undefined
  const [internalSelectedRectId, setInternalSelectedRectId] = useState<
    string | null
  >(null)
  const effectiveSelectedRectId = isSelectedRectIdControlled
    ? selectedRectId
    : internalSelectedRectId
  const effectiveSelectedRectIdRef = useRef(effectiveSelectedRectId)
  effectiveSelectedRectIdRef.current = effectiveSelectedRectId

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
  const effectiveSelectedRangeIdRef = useRef(effectiveSelectedRangeId)
  effectiveSelectedRangeIdRef.current = effectiveSelectedRangeId
  const selectedHighlight = useMemo(
    () =>
      effectiveSelectedRangeId
        ? (effectiveRanges.find(
            (range) => range.id === effectiveSelectedRangeId
          ) ?? null)
        : null,
    [effectiveRanges, effectiveSelectedRangeId]
  )
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
  const runtimeRects = useMemo(
    () => mapPublicRectanglesToRuntime(effectiveRects, readerLinkedScopeId),
    [effectiveRects, readerLinkedScopeId]
  )

  const annotationHistoryEnabled = annotationHistory?.enabled === true
  const currentAnnotationHistorySnapshot = useCallback(
    () =>
      normalizeAnnotationHistorySnapshot(
        makeAnnotationHistorySnapshot(
          effectiveRangesRef.current,
          effectiveRectsRef.current,
          effectiveSelectedRangeIdRef.current,
          effectiveSelectedRectIdRef.current
        )
      ),
    []
  )
  const annotationHistoryController = useAnnotationHistory({
    enabled: annotationHistoryEnabled,
    initialValue: currentAnnotationHistorySnapshot(),
    onChange: onAnnotationHistoryChange
  })
  const lastAnnotationHistoryResetKeyRef = useRef(annotationHistory?.resetKey)

  const syncAnnotationHistorySnapshot = useCallback(
    (next: ReaderAnnotationHistoryValue) => {
      annotationHistoryController.syncSilent(
        normalizeAnnotationHistorySnapshot(next)
      )
    },
    [annotationHistoryController]
  )

  const commitAnnotationCheckpoint = useCallback(
    (
      next: ReaderAnnotationHistoryValue,
      source: ReaderAnnotationHistoryChangeSource
    ) => {
      annotationHistoryController.setCheckpoint(
        normalizeAnnotationHistorySnapshot(next),
        source
      )
    },
    [annotationHistoryController]
  )

  const applyAnnotationHistoryTarget = useCallback(
    (target: ReaderAnnotationHistoryValue) => {
      const normalizedTarget = normalizeAnnotationHistorySnapshot(target)

      if (!isRangesControlled) {
        setInternalRanges(normalizedTarget.ranges)
      }
      if (!isSelectedRangeIdControlled) {
        setInternalSelectedRangeId(normalizedTarget.selectedRangeId)
      }
      if (!isSelectedRectIdControlled) {
        setInternalSelectedRectId(normalizedTarget.selectedRectId)
      }
    },
    [
      isRangesControlled,
      isSelectedRangeIdControlled,
      isSelectedRectIdControlled
    ]
  )

  const runAnnotationHistory = useCallback(
    (source: 'undo' | 'redo') => {
      const target = annotationHistoryController.getTarget(source)
      if (!target) return false

      const normalizedTarget = normalizeAnnotationHistorySnapshot(target)
      if (isRangesControlled && !onAnnotationHistoryChange) return false
      if (isRectsControlled && !onAnnotationHistoryChange) return false
      if (
        !isRectsControlled &&
        hasUnsupportedUncontrolledRectTarget(
          effectiveRectsRef.current,
          normalizedTarget.rects
        )
      ) {
        return false
      }

      const result = annotationHistoryController.applyTargetSilently(source)
      if (!result.applied) return false

      applyAnnotationHistoryTarget(normalizedTarget)
      onAnnotationHistoryChange?.(normalizedTarget, result.detail)
      return true
    },
    [
      annotationHistoryController,
      applyAnnotationHistoryTarget,
      isRangesControlled,
      isRectsControlled,
      onAnnotationHistoryChange
    ]
  )

  const clearAnnotationHistory = useCallback(() => {
    const nextSnapshot = makeAnnotationHistorySnapshot([], [], null, null)
    commitAnnotationCheckpoint(nextSnapshot, 'clear')
    if (!isRangesControlled) {
      setInternalRanges([])
    }
    if (!isSelectedRangeIdControlled) {
      setInternalSelectedRangeId(null)
    }
    if (!isSelectedRectIdControlled) {
      setInternalSelectedRectId(null)
    }
  }, [
    commitAnnotationCheckpoint,
    isRangesControlled,
    isSelectedRangeIdControlled,
    isSelectedRectIdControlled
  ])

  useEffect(() => {
    const historyRects = isRectsControlled
      ? effectiveRects
      : annotationHistoryController.getPresent().rects
    syncAnnotationHistorySnapshot(
      makeAnnotationHistorySnapshot(
        effectiveRanges,
        historyRects,
        effectiveSelectedRangeId,
        effectiveSelectedRectId
      )
    )
  }, [
    effectiveRanges,
    effectiveRects,
    effectiveSelectedRangeId,
    effectiveSelectedRectId,
    annotationHistoryController,
    isRectsControlled,
    syncAnnotationHistorySnapshot
  ])

  useEffect(() => {
    if (
      lastAnnotationHistoryResetKeyRef.current === annotationHistory?.resetKey
    ) {
      return
    }
    lastAnnotationHistoryResetKeyRef.current = annotationHistory?.resetKey
    annotationHistoryController.reset(
      currentAnnotationHistorySnapshot(),
      'reset'
    )
  }, [
    annotationHistory?.resetKey,
    annotationHistoryController,
    currentAnnotationHistorySnapshot
  ])
  const handleCreateRect = useCallback(
    (rect: ReaderSelectionRectangle) => {
      const publicRect = mapRuntimeRectangleToPublic(rect, readerLinkedScopeId)
      if (!isSelectedRectIdControlled) {
        setInternalSelectedRectId(publicRect.id)
      }
      commitAnnotationCheckpoint(
        makeAnnotationHistorySnapshot(
          effectiveRangesRef.current,
          [...effectiveRectsRef.current, publicRect],
          effectiveSelectedRangeIdRef.current,
          publicRect.id
        ),
        'create-rect'
      )
      onCreateRect?.(publicRect)
    },
    [
      commitAnnotationCheckpoint,
      isSelectedRectIdControlled,
      onCreateRect,
      readerLinkedScopeId
    ]
  )
  const handleUpdateRect = useCallback(
    (rect: ReaderSelectionRectangle) => {
      const publicRect = mapRuntimeRectangleToPublic(rect, readerLinkedScopeId)
      const nextRects = effectiveRectsRef.current.map((currentRect) =>
        currentRect.id === publicRect.id ? publicRect : currentRect
      )
      commitAnnotationCheckpoint(
        makeAnnotationHistorySnapshot(
          effectiveRangesRef.current,
          nextRects,
          effectiveSelectedRangeIdRef.current,
          effectiveSelectedRectIdRef.current
        ),
        'update-rect'
      )
      onUpdateRect?.(publicRect)
    },
    [commitAnnotationCheckpoint, onUpdateRect, readerLinkedScopeId]
  )
  const handleSelectRect = useCallback(
    (id: string | null) => {
      if (!isSelectedRectIdControlled) {
        setInternalSelectedRectId(id)
      }
      syncAnnotationHistorySnapshot(
        makeAnnotationHistorySnapshot(
          effectiveRangesRef.current,
          effectiveRectsRef.current,
          effectiveSelectedRangeIdRef.current,
          id
        )
      )
      onSelectRect?.(id)
    },
    [isSelectedRectIdControlled, onSelectRect, syncAnnotationHistorySnapshot]
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
  const initialFitDocumentRef = useRef<IntermediateDocument | null>(null)

  const handleInitialFitScale = useCallback(
    (fitScale: number) => {
      if (
        !runtimeDocument ||
        initialFitDocumentRef.current === runtimeDocument
      ) {
        return
      }

      initialFitDocumentRef.current = runtimeDocument
      if (scale !== undefined) return

      setPaperTransform((currentTransform) => ({
        ...currentTransform,
        scale: clampScale(fitScale, scaleRange)
      }))
    },
    [runtimeDocument, scale, scaleRange]
  )

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
  const pageBrowserVisiblePagesRef = useRef(new Set<number>())
  const pinnedPagesRef = useRef(new Set<number>())
  const jumpPinTokensRef = useRef(new Map<number, symbol>())
  const jumpPinCleanupTimersRef = useRef(
    new Map<number, ReturnType<typeof setTimeout>>()
  )
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

  // --- debounced thumbnail refresh 所需的 refs ---
  // 在 setTimeout 回调中读取最新 state，避免将这些 state 加入 effect deps 导致循环
  const pageStatusesRef = useRef(pageStatuses)
  pageStatusesRef.current = pageStatuses
  const baseImagesByPageNumberRef = useRef(baseImagesByPageNumber)
  baseImagesByPageNumberRef.current = baseImagesByPageNumber
  const pageNumbersRef = useRef(pageNumbers)
  pageNumbersRef.current = pageNumbers
  // 记录上次刷新缩略图时的 scale，避免微小缩放变化触发不必要的重新生成
  const lastThumbnailRefreshScaleRef = useRef(effectiveScale)
  // intermediate-document 默认模式懒加载队列 hook。
  // 队列项为页码，通过 generation token 忽略 stale async 结果，
  // 并复用 loadingPagesRef 强制并发上限。callbacks 复用已有的
  // createSet*Handler immutable updater helpers 更新状态 maps。
  const lazyPageQueue = useLazyPageQueue(lazyQueueConfigRef, runtimeDocument, {
    activeDocumentRef,
    isMountedRef,
    loadingPagesRef,
    getBaseImageFromPage,
    getPageContentEntries,
    isIntermediateText,
    isIntermediateImage,
    effectiveScaleRef,
    callbacks: {
      onPageLoaded: ({ pageNumber, baseImage, texts, images }) => {
        const loadTimingStart = pageLoadTimingStartsRef.current.get(pageNumber)
        if (loadTimingStart) {
          const endedAt = getRenderTimingNow()
          renderTimingRef.current.record({
            stage: loadTimingStart.stage,
            startedAt: loadTimingStart.startedAt,
            endedAt,
            durationMs: endedAt - loadTimingStart.startedAt,
            pageNumber
          })
          renderTimingRef.current.record({
            stage: 'content-extraction',
            startedAt: loadTimingStart.startedAt,
            endedAt,
            durationMs: endedAt - loadTimingStart.startedAt,
            pageNumber
          })
          pageLoadTimingStartsRef.current.delete(pageNumber)
        }
        lazilyEvictedPagesRef.current.delete(pageNumber)
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, baseImage)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, texts))
        setImagesByPageNumber(createSetImagesHandler(pageNumber, images))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'loaded'))
      },
      onPageError: (pageNumber) => {
        pageLoadTimingStartsRef.current.delete(pageNumber)
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setImagesByPageNumber(createSetImagesHandler(pageNumber, []))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
      },
      isPageLoaded: (pageNumber) =>
        pageStatuses.get(pageNumber) === 'loaded' ||
        textsByPageNumber.has(pageNumber) ||
        baseImagesByPageNumber.has(pageNumber) ||
        imagesByPageNumber.has(pageNumber) ||
        lazilyEvictedPagesRef.current.has(pageNumber)
    }
  })

  const enqueueVisiblePageRef = useRef(lazyPageQueue.enqueuePage)
  enqueueVisiblePageRef.current = lazyPageQueue.enqueuePage

  // intermediate-document 模式下 IO 可见性防抖定时器（按页码 keyed）。
  // 页面进入可加载窗口后启动 pageLoadEnterDelayMs 定时器，仅当页面持续
  // 可见至定时器触发时才调用 enqueuePage；页面提前离开则取消挂起入队，
  // 保持空外壳，从而避免快速滚动把所有路过页面都入队加载。
  // enqueuePage 不能作为 scheduleVisibilityEnqueue 的依赖：它由 useLazyPageQueue
  // 返回，其 callbacks 依赖每渲染新建，故 enqueuePage 每渲染变 identity；若
  // 进入 IO effect deps 会导致观察者每渲染重建 -> markLoadableWithOverscan
  // -> setLoadablePages 死循环。改由 ref 在定时器触发时读取最新 enqueuePage。
  const pendingVisibilityTimersRef = useRef(
    new Map<number, ReturnType<typeof setTimeout>>()
  )

  const clearAllVisibilityTimers = useCallback(() => {
    pendingVisibilityTimersRef.current.forEach((timer) => {
      clearTimeout(timer)
    })
    pendingVisibilityTimersRef.current.clear()
  }, [])

  const cancelVisibilityEnqueue = useCallback((pageNumber: number) => {
    const timer = pendingVisibilityTimersRef.current.get(pageNumber)
    if (timer) {
      clearTimeout(timer)
      pendingVisibilityTimersRef.current.delete(pageNumber)
    }
  }, [])

  const scheduleVisibilityEnqueue = useCallback((pageNumber: number) => {
    if (pendingVisibilityTimersRef.current.has(pageNumber)) {
      return
    }
    const delay = lazyQueueConfigRef.current.pageLoadEnterDelayMs
    const timer = setTimeout(() => {
      pendingVisibilityTimersRef.current.delete(pageNumber)
      if (!isMountedRef.current) {
        return
      }
      if (renderTimingRef.current.enabled) {
        pageLoadTimingStartsRef.current.set(pageNumber, {
          stage: 'visibility-lazy-loading',
          startedAt: getRenderTimingNow()
        })
      }
      enqueueVisiblePageRef.current(pageNumber)
    }, delay)
    pendingVisibilityTimersRef.current.set(pageNumber, timer)
  }, [])

  // intermediate-document 模式下离屏页面卸载定时器（按页码 keyed）。
  // 页面离开可加载窗口后启动 pageUnloadDelayMs 定时器，仅当页面持续
  // 离开至定时器触发时才卸载其内容包回到空外壳；页面在定时器触发前
  // 重新进入可见窗口则取消挂起卸载，保持内容。
  const pendingUnloadTimersRef = useRef(
    new Map<number, ReturnType<typeof setTimeout>>()
  )

  const clearUnloadTimer = useCallback((pageNumber: number) => {
    const timer = pendingUnloadTimersRef.current.get(pageNumber)
    if (timer) {
      clearTimeout(timer)
      pendingUnloadTimersRef.current.delete(pageNumber)
    }
  }, [])

  const clearAllUnloadTimers = useCallback(() => {
    pendingUnloadTimersRef.current.forEach((timer) => {
      clearTimeout(timer)
    })
    pendingUnloadTimersRef.current.clear()
  }, [])

  const clearJumpPinCleanupTimer = useCallback((pageNumber: number) => {
    const timer = jumpPinCleanupTimersRef.current.get(pageNumber)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    jumpPinCleanupTimersRef.current.delete(pageNumber)
  }, [])

  const releaseJumpPinnedPage = useCallback(
    (pageNumber: number, token: symbol) => {
      if (jumpPinTokensRef.current.get(pageNumber) !== token) {
        return
      }
      clearJumpPinCleanupTimer(pageNumber)
      jumpPinTokensRef.current.delete(pageNumber)
      pinnedPagesRef.current.delete(pageNumber)
    },
    [clearJumpPinCleanupTimer]
  )

  const clearAllJumpPins = useCallback(() => {
    jumpPinCleanupTimersRef.current.forEach((timer) => {
      clearTimeout(timer)
    })
    jumpPinCleanupTimersRef.current.clear()
    jumpPinTokensRef.current.clear()
    pinnedPagesRef.current.clear()
  }, [])

  const pinJumpTargetPage = useCallback(
    (pageNumber: number): symbol => {
      const token = Symbol(`jump-target-page-${pageNumber}`)
      clearJumpPinCleanupTimer(pageNumber)
      jumpPinTokensRef.current.set(pageNumber, token)
      pinnedPagesRef.current.add(pageNumber)

      const timer = setTimeout(() => {
        releaseJumpPinnedPage(pageNumber, token)
      }, JUMP_PIN_CLEANUP_DELAY_MS)
      jumpPinCleanupTimersRef.current.set(pageNumber, timer)

      return token
    },
    [clearJumpPinCleanupTimer, releaseJumpPinnedPage]
  )

  // 已保存选择的解析结果（按 id 索引），在 mount/update 时计算并缓存。
  // 已移除组件内自定义 SVG overlay 状态、容器 refs 与手柄状态，保留已保存选择类型缓存供数据流程使用。
  useEffect(() => {
    const currentPageNumbers = new Set(pageNumbers)

    clearAllJumpPins()
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
    pageBrowserVisiblePagesRef.current.forEach((pageNumber) => {
      if (!currentPageNumbers.has(pageNumber)) {
        pageBrowserVisiblePagesRef.current.delete(pageNumber)
      }
    })
  }, [clearAllJumpPins, pageNumbers])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      activeDocumentRef.current = null
    }
  }, [])

  useEffect(() => {
    activeDocumentRef.current = runtimeDocument
    loadingPagesRef.current.clear()
    ocrLoadingPagesRef.current.clear()
    ocrCacheRef.current.clear()
    evictedOcrPagesRef.current.clear()
    lazilyEvictedPagesRef.current.clear()
    pageBrowserVisiblePagesRef.current.clear()
    setLoadablePages(new Set())
    setVisiblePages(new Set())
    setTextsByPageNumber(new Map())
    setOcrTextsByPageNumber(new Map())
    setPageStatuses(new Map())
    setBaseImagesByPageNumber(new Map())
    setImagesByPageNumber(new Map())
    clearAllUnloadTimers()
    clearAllJumpPins()
  }, [runtimeDocument, clearAllUnloadTimers, clearAllJumpPins])

  const bumpOcrEvictGeneration = useCallback((pageNumber: number) => {
    const current = ocrEvictGenerationRef.current.get(pageNumber) ?? 0
    ocrEvictGenerationRef.current.set(pageNumber, current + 1)
  }, [])

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

  // 缩放结束后 debounce 300ms，按当前 effectiveScale 刷新可见已加载页面的缩略图。
  // 传入 scale 给 getThumbnail(scale) 获取匹配实际展示尺寸的分辨率，
  // 放大时背景图更清晰，缩小时节省内存。
  // scale 变化 < 0.1 时不刷新，避免微小缩放触发不必要的缩略图重新生成。
  useEffect(() => {
    const prevScale = lastThumbnailRefreshScaleRef.current
    if (Math.abs(effectiveScale - prevScale) < 0.1) {
      return
    }

    const timer = setTimeout(async () => {
      if (!isMountedRef.current || !runtimeDocument) return
      const activeDoc = activeDocumentRef.current
      if (activeDoc !== runtimeDocument) return

      // 在 setTimeout 回调中通过 ref 读取最新 state，避免将其加入 effect deps
      const visibleSet = lastKnownVisiblePagesRef.current
      const statuses = pageStatusesRef.current
      const validPageNumbers = new Set(pageNumbersRef.current)

      const pagesToRefresh: number[] = []
      visibleSet.forEach((pageNumber) => {
        if (
          validPageNumbers.has(pageNumber) &&
          statuses.get(pageNumber) === 'loaded'
        ) {
          pagesToRefresh.push(pageNumber)
        }
      })

      // 先记录本次刷新的 scale，即使没有可刷新的页面也更新，
      // 避免后续相同 scale 反复进入 effect
      lastThumbnailRefreshScaleRef.current = effectiveScale

      if (pagesToRefresh.length === 0) return

      // 并行获取每页按当前 scale 的缩略图
      await Promise.all(
        pagesToRefresh.map(async (pageNumber) => {
          if (!isMountedRef.current || activeDocumentRef.current !== activeDoc)
            return
          try {
            const pagePromise = runtimeDocument.getPageByPageNumber(pageNumber)
            if (!pagePromise) return
            const page = await pagePromise
            if (
              !isMountedRef.current ||
              activeDocumentRef.current !== activeDoc
            )
              return

            // 如果用户在 fetch 期间又缩放了，跳过此页更新（新的 debounce 会处理）
            if (effectiveScaleRef.current !== effectiveScale) return

            const newBaseImage = await getBaseImageFromPage(
              page,
              effectiveScale
            )
            if (
              !isMountedRef.current ||
              activeDocumentRef.current !== activeDoc
            )
              return
            if (effectiveScaleRef.current !== effectiveScale) return

            // 仅当新缩略图与当前不同时才更新，避免不必要的 re-render
            const currentBaseImage =
              baseImagesByPageNumberRef.current.get(pageNumber)
            if (newBaseImage && newBaseImage !== currentBaseImage) {
              setBaseImagesByPageNumber(
                createSetBaseImageHandler(pageNumber, newBaseImage)
              )
            }
          } catch {
            // 单页刷新失败不影响其他页
          }
        })
      )
    }, 300)

    return () => clearTimeout(timer)
  }, [effectiveScale, runtimeDocument])

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
        let hasMissingPage = false

        for (let index = startIndex; index <= endIndex; index += 1) {
          if (!currentPages.has(pageNumbers[index])) {
            hasMissingPage = true
            break
          }
        }

        if (!hasMissingPage) {
          return currentPages
        }

        const nextPages = new Set(currentPages)

        for (let index = startIndex; index <= endIndex; index += 1) {
          nextPages.add(pageNumbers[index])
        }

        return nextPages
      })
    },
    [overscan, pageNumbers]
  )

  const scrollToRange = useCallback(
    (rangeId: string) => {
      if (!runtimeDocument || pageNumbers.length === 0) return

      const widestPageSize = getWidestKnownPageSize(
        pageNumbers,
        pageSizesByPageNumber
      )
      if (!widestPageSize) return

      const initialTarget = resolveRangeJumpTarget({
        ranges: effectiveRangesRef.current,
        rangeId,
        rectType: overlayRectType,
        pageWidth: widestPageSize.width,
        pageHeight: widestPageSize.height
      })
      if (!initialTarget) return
      if (!pageNumbers.includes(initialTarget.pageNumber)) return

      const targetPageSize = getKnownPageSize(
        pageSizesByPageNumber,
        initialTarget.pageNumber
      )
      if (!targetPageSize) return

      const target = resolveRangeJumpTarget({
        ranges: effectiveRangesRef.current,
        rangeId,
        rectType: overlayRectType,
        pageWidth: targetPageSize.width,
        pageHeight: targetPageSize.height
      })
      if (!target) return

      const viewportElement = viewerRootRef.current?.querySelector(
        '.virtual-paper-wrapper'
      )
      if (!(viewportElement instanceof HTMLElement)) return

      const viewportRect = viewportElement.getBoundingClientRect()
      const contentWidth = widestPageSize.width
      const lastPageNumber = pageNumbers.at(-1)
      if (lastPageNumber === undefined) return
      const lastPageSize = getKnownPageSize(
        pageSizesByPageNumber,
        lastPageNumber
      )
      if (!lastPageSize) return
      const contentHeight =
        computePageOriginY(lastPageNumber, pageNumbers, pageSizesByPageNumber) +
        lastPageSize.height

      const pageOriginY = computePageOriginY(
        target.pageNumber,
        pageNumbers,
        pageSizesByPageNumber
      )
      const targetContentX =
        (contentWidth - targetPageSize.width) / 2 + target.centerX
      const targetContentY = pageOriginY + target.centerY
      const nextTransform = computeTransform({
        viewportWidth: viewportRect.width,
        viewportHeight: viewportRect.height,
        contentWidth,
        contentHeight,
        targetContentX,
        targetContentY,
        scale: effectiveScaleRef.current
      })
      if (!nextTransform) return

      const targetPageNumber = target.pageNumber
      const alreadyLoaded = pageStatuses.get(targetPageNumber) === 'loaded'
      const pinToken = pinJumpTargetPage(targetPageNumber)
      clearUnloadTimer(targetPageNumber)
      lazilyEvictedPagesRef.current.delete(targetPageNumber)
      markLoadableWithOverscan(targetPageNumber)

      if (alreadyLoaded) {
        queueMicrotask(() => {
          releaseJumpPinnedPage(targetPageNumber, pinToken)
        })
      } else {
        lazyPageQueue.enqueuePage(targetPageNumber)
      }

      setPaperTransform((currentTransform) => ({
        x: nextTransform.x,
        y: nextTransform.y,
        scale: currentTransform.scale
      }))
    },
    [
      clearUnloadTimer,
      lazyPageQueue,
      markLoadableWithOverscan,
      overlayRectType,
      pageNumbers,
      pageSizesByPageNumber,
      pageStatuses,
      pinJumpTargetPage,
      releaseJumpPinnedPage,
      runtimeDocument
    ]
  )

  const scrollToRect = useCallback(
    (rectId: string) => {
      if (!runtimeDocument || pageNumbers.length === 0) return

      const rect = effectiveRectsRef.current.find((r) => r.id === rectId)
      if (!rect) return

      const rawSelectionId = rect.selectionId
      if (!rawSelectionId) return

      const publicSelectionId = rawSelectionId.includes(':')
        ? mapRuntimeSelectionIdToPublic(rawSelectionId, readerLinkedScopeId)
        : rawSelectionId
      if (!publicSelectionId) return

      const pageNumber = parsePublicPageId(publicSelectionId)
      if (pageNumber === null || !pageNumbers.includes(pageNumber)) return

      const widestPageSize = getWidestKnownPageSize(
        pageNumbers,
        pageSizesByPageNumber
      )
      if (!widestPageSize) return

      const targetPageSize = getKnownPageSize(pageSizesByPageNumber, pageNumber)
      if (!targetPageSize) return

      const viewportElement = viewerRootRef.current?.querySelector(
        '.virtual-paper-wrapper'
      )
      if (!(viewportElement instanceof HTMLElement)) return

      const viewportRect = viewportElement.getBoundingClientRect()
      const contentWidth = widestPageSize.width
      const lastPageNumber = pageNumbers.at(-1)
      if (lastPageNumber === undefined) return
      const lastPageSize = getKnownPageSize(
        pageSizesByPageNumber,
        lastPageNumber
      )
      if (!lastPageSize) return
      const contentHeight =
        computePageOriginY(lastPageNumber, pageNumbers, pageSizesByPageNumber) +
        lastPageSize.height

      const pageOriginY = computePageOriginY(
        pageNumber,
        pageNumbers,
        pageSizesByPageNumber
      )
      const { centerX, centerY } = rectCenterToPagePixels(
        rect.rect,
        rect.overlayRectType,
        targetPageSize.width,
        targetPageSize.height
      )
      const targetContentX = (contentWidth - targetPageSize.width) / 2 + centerX
      const targetContentY = pageOriginY + centerY

      const nextTransform = computeTransform({
        viewportWidth: viewportRect.width,
        viewportHeight: viewportRect.height,
        contentWidth,
        contentHeight,
        targetContentX,
        targetContentY,
        scale: effectiveScaleRef.current
      })
      if (!nextTransform) return

      const alreadyLoaded = pageStatuses.get(pageNumber) === 'loaded'
      const pinToken = pinJumpTargetPage(pageNumber)
      clearUnloadTimer(pageNumber)
      lazilyEvictedPagesRef.current.delete(pageNumber)
      markLoadableWithOverscan(pageNumber)

      if (alreadyLoaded) {
        queueMicrotask(() => {
          releaseJumpPinnedPage(pageNumber, pinToken)
        })
      } else {
        lazyPageQueue.enqueuePage(pageNumber)
      }

      setPaperTransform((currentTransform) => ({
        x: nextTransform.x,
        y: nextTransform.y,
        scale: currentTransform.scale
      }))
    },
    [
      clearUnloadTimer,
      lazyPageQueue,
      markLoadableWithOverscan,
      pageNumbers,
      pageSizesByPageNumber,
      pageStatuses,
      pinJumpTargetPage,
      readerLinkedScopeId,
      releaseJumpPinnedPage,
      runtimeDocument
    ]
  )

  const scrollToPosition = useCallback(
    (position: { x: number; y: number; scale?: number }) => {
      if (!runtimeDocument || pageNumbers.length === 0) return

      const widestPageSize = getWidestKnownPageSize(
        pageNumbers,
        pageSizesByPageNumber
      )
      if (!widestPageSize) return

      const viewportElement = viewerRootRef.current?.querySelector(
        '.virtual-paper-wrapper'
      )
      if (!(viewportElement instanceof HTMLElement)) return

      const viewportRect = viewportElement.getBoundingClientRect()
      const contentWidth = widestPageSize.width
      const lastPageNumber = pageNumbers.at(-1)
      if (lastPageNumber === undefined) return
      const lastPageSize = getKnownPageSize(
        pageSizesByPageNumber,
        lastPageNumber
      )
      if (!lastPageSize) return
      const contentHeight =
        computePageOriginY(lastPageNumber, pageNumbers, pageSizesByPageNumber) +
        lastPageSize.height

      const nextTransform = computeTransformForOffset({
        viewportWidth: viewportRect.width,
        viewportHeight: viewportRect.height,
        contentWidth,
        contentHeight,
        offsetX: position.x,
        offsetY: position.y,
        scale: position.scale ?? effectiveScaleRef.current
      })
      if (!nextTransform) return

      setPaperTransform((currentTransform) => ({
        x: nextTransform.x,
        y: nextTransform.y,
        scale: nextTransform.scale ?? currentTransform.scale
      }))
    },
    [pageNumbers, pageSizesByPageNumber, runtimeDocument]
  )

  useEffect(() => {
    pageStatuses.forEach((status, pageNumber) => {
      if (status !== 'loaded' && status !== 'error') {
        return
      }
      const token = jumpPinTokensRef.current.get(pageNumber)
      if (token) {
        releaseJumpPinnedPage(pageNumber, token)
      }
    })
  }, [pageStatuses, releaseJumpPinnedPage])

  const evictLazyPageBundle = useCallback(
    (pageNumber: number) => {
      if (!runtimeDocument) {
        return false
      }

      if (
        loadingPagesRef.current.has(pageNumber) ||
        ocrLoadingPagesRef.current.has(pageNumber)
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
      lazilyEvictedPagesRef.current.add(pageNumber)

      pageLastVisibleAtRef.current.delete(pageNumber)
      lastKnownVisiblePagesRef.current.delete(pageNumber)
      setTextsByPageNumber(deletePageEntry(pageNumber))
      setOcrTextsByPageNumber(deletePageEntry(pageNumber))
      setBaseImagesByPageNumber(deletePageEntry(pageNumber))
      setImagesByPageNumber(deletePageEntry(pageNumber))
      setPageStatuses(deletePageEntry(pageNumber))
      setLoadablePages(deletePageFromSet(pageNumber))
      bumpOcrEvictGeneration(pageNumber)
      return true
    },
    [runtimeDocument, bumpOcrEvictGeneration]
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

  // 将 Selection 库的运行时 selectionId 映射回 pageNumber，
  // 用于保护正在拖选的跨页 activeRange 对应的页面。
  const resolveProtectedPageNumberForRuntimeSelectionId = useCallback(
    (selectionId: string) => {
      for (const pageNumber of pageNumbers) {
        if (getRuntimePageSelectionId(pageNumber) === selectionId) {
          return pageNumber
        }
      }
      return null
    },
    [getRuntimePageSelectionId, pageNumbers]
  )

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

  const addResolvedProtectedPageRange = useCallback(
    (
      protectedPages: Set<number>,
      startPageNumber: number | null,
      endPageNumber: number | null
    ) => {
      if (startPageNumber !== null) protectedPages.add(startPageNumber)
      if (endPageNumber !== null) protectedPages.add(endPageNumber)
      if (startPageNumber !== null && endPageNumber !== null) {
        addProtectedPageRange(protectedPages, startPageNumber, endPageNumber)
      }
    },
    [addProtectedPageRange]
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
    pageBrowserVisiblePagesRef.current.forEach((pageNumber) => {
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
      addResolvedProtectedPageRange(
        protectedPages,
        anchorPageNumber,
        focusPageNumber
      )
    }

    // 保护 Selection 库正在拖选的 activeRange，避免离屏卸载打断跨页选区。
    const activeLinkedRange = runtimeLinkedData.activeRange
    if (activeLinkedRange) {
      const startPageNumber = resolveProtectedPageNumberForRuntimeSelectionId(
        activeLinkedRange.start.selectionId
      )
      const endPageNumber = resolveProtectedPageNumberForRuntimeSelectionId(
        activeLinkedRange.end.selectionId
      )
      addResolvedProtectedPageRange(
        protectedPages,
        startPageNumber,
        endPageNumber
      )
    }

    return protectedPages
  }, [
    addResolvedProtectedPageRange,
    overscan,
    pageNumbers,
    resolveProtectedPageNumberForNode,
    resolveProtectedPageNumberForRuntimeSelectionId,
    runtimeLinkedData.activeRange,
    visiblePages
  ])

  // getProtectedPages 的 ref，供定时器回调在触发时读取最新版本。
  // 与 enqueueVisiblePageRef 模式一致：定时器创建时捕获
  // 的是 ref，触发时通过 ref 读取最新的 getProtectedPages，避免闭包
  // 捕获到 stale 的 visiblePages 状态。
  const getProtectedPagesRef = useRef(getProtectedPages)
  getProtectedPagesRef.current = getProtectedPages

  const schedulePageUnload = useCallback(
    (pageNumber: number) => {
      if (pendingUnloadTimersRef.current.has(pageNumber)) {
        return
      }
      const delay = lazyQueueConfigRef.current.pageUnloadDelayMs
      const timer = setTimeout(() => {
        pendingUnloadTimersRef.current.delete(pageNumber)
        if (!isMountedRef.current) {
          return
        }
        // 通过 ref 读取最新的 getProtectedPages，确保定时器触发时
        // 使用的是已 flush 的 visiblePages 状态而非创建时的闭包。
        const protectedPages = getProtectedPagesRef.current()
        if (protectedPages.has(pageNumber)) {
          return
        }
        const startedAt = getRenderTimingNow()
        const didEvict = evictLazyPageBundle(pageNumber)
        if (didEvict) {
          const endedAt = getRenderTimingNow()
          renderTimingRef.current.record({
            stage: 'offscreen-unload',
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            pageNumber
          })
        }
      }, delay)
      pendingUnloadTimersRef.current.set(pageNumber, timer)
    },
    [evictLazyPageBundle]
  )

  const handlePageBrowserVisibilityChange = useCallback(
    (pageNumber: number, isVisible: boolean) => {
      if (!pageNumbers.includes(pageNumber)) return

      if (isVisible) {
        pageBrowserVisiblePagesRef.current.add(pageNumber)
        clearUnloadTimer(pageNumber)
        lazilyEvictedPagesRef.current.delete(pageNumber)
        markLoadableWithOverscan(pageNumber)
        scheduleVisibilityEnqueue(pageNumber)
        return
      }

      pageBrowserVisiblePagesRef.current.delete(pageNumber)
      if (!lastKnownVisiblePagesRef.current.has(pageNumber)) {
        cancelVisibilityEnqueue(pageNumber)
      }
      schedulePageUnload(pageNumber)
    },
    [
      cancelVisibilityEnqueue,
      clearUnloadTimer,
      markLoadableWithOverscan,
      pageNumbers,
      schedulePageUnload,
      scheduleVisibilityEnqueue
    ]
  )

  const navigateToPage = useCallback(
    (pageNumber: number) => {
      if (!pageNumbers.includes(pageNumber)) return

      const alreadyLoaded = pageStatuses.get(pageNumber) === 'loaded'
      const pinToken = pinJumpTargetPage(pageNumber)
      clearUnloadTimer(pageNumber)
      lazilyEvictedPagesRef.current.delete(pageNumber)
      markLoadableWithOverscan(pageNumber)

      if (alreadyLoaded) {
        queueMicrotask(() => {
          releaseJumpPinnedPage(pageNumber, pinToken)
        })
      } else {
        lazyPageQueue.enqueuePage(pageNumber)
      }

      scrollToPosition({
        x: 0,
        y: computePageOriginY(pageNumber, pageNumbers, pageSizesByPageNumber)
      })
    },
    [
      clearUnloadTimer,
      lazyPageQueue,
      markLoadableWithOverscan,
      pageNumbers,
      pageSizesByPageNumber,
      pageStatuses,
      pinJumpTargetPage,
      releaseJumpPinnedPage,
      scrollToPosition
    ]
  )

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

          if (evictLazyPageBundle(pageNumber)) {
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
    [evictLazyPageBundle, getProtectedPages, maxLoadedPages, overscan]
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

      const nextTransient = extractRuntimeLinkedTransient(next)
      setRuntimeLinkedTransient((currentTransient) =>
        areRuntimeLinkedTransientsEqual(currentTransient, nextTransient)
          ? currentTransient
          : nextTransient
      )
      onLinkedDataChange?.(publicLinkedData)

      const currentSnapshot = currentAnnotationHistorySnapshot()
      const nextSnapshot = normalizeAnnotationHistorySnapshot(
        makeAnnotationHistorySnapshot(
          publicLinkedData.items,
          effectiveRectsRef.current,
          publicLinkedData.selectedRangeId,
          effectiveSelectedRectIdRef.current
        )
      )
      const pendingHighlightOperation =
        pendingLinkedHighlightOperationRef.current
      const hasPendingHighlightRangeAddition =
        nextSnapshot.ranges.length > currentSnapshot.ranges.length &&
        Boolean(pendingHighlightOperation) &&
        nextSnapshot.ranges.some(
          (range) => !pendingHighlightOperation?.has(range.id)
        )
      const historySource = hasPendingHighlightRangeAddition
        ? 'highlight'
        : getLinkedDataChangeSource(currentSnapshot, nextSnapshot)
      if (historySource) {
        commitAnnotationCheckpoint(nextSnapshot, historySource)
      } else {
        syncAnnotationHistorySnapshot(nextSnapshot)
      }

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
      commitAnnotationCheckpoint,
      currentAnnotationHistorySnapshot,
      emitPendingLinkedHighlight,
      syncAnnotationHistorySnapshot,
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
      if (!isSelectedRangeIdControlled) {
        setInternalSelectedRangeId(id)
      }
      syncAnnotationHistorySnapshot(
        makeAnnotationHistorySnapshot(
          effectiveRangesRef.current,
          effectiveRectsRef.current,
          id,
          effectiveSelectedRectIdRef.current
        )
      )
      onLinkedSelectRange?.(id)
      onSelectRange?.(id)
    },
    [
      isSelectedRangeIdControlled,
      onLinkedSelectRange,
      onSelectRange,
      syncAnnotationHistorySnapshot
    ]
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
          clearUnloadTimer(pageNumber)
          lazilyEvictedPagesRef.current.delete(pageNumber)
          const pageIndex = pageNumbers.indexOf(pageNumber)
          const initialPageCount = lazyQueueConfigRef.current.initialLoadedPages
          if (pageIndex >= 0 && pageIndex < initialPageCount) {
            return
          }
          scheduleVisibilityEnqueue(pageNumber)
        } else {
          markHiddenPage(pageNumber)
          cancelVisibilityEnqueue(pageNumber)
          schedulePageUnload(pageNumber)
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
      // 观察者销毁时清除本效应周期内的所有挂起可见性/卸载定时器，防止
      // 卸载/文档切换后仍触发迟到入队或卸载。
      clearAllVisibilityTimers()
      clearAllUnloadTimers()
    }
  }, [
    markHiddenPage,
    markLoadableWithOverscan,
    markVisiblePage,
    pageNumbers,
    runtimeDocument,
    scheduleVisibilityEnqueue,
    cancelVisibilityEnqueue,
    clearAllVisibilityTimers,
    clearUnloadTimer,
    schedulePageUnload,
    clearAllUnloadTimers
  ])

  useEffect(() => {
    if (!runtimeDocument) {
      return
    }
    if (renderTimingRef.current.enabled) {
      const initialCount = lazyQueueConfigRef.current.initialLoadedPages
      const targetPages = pageNumbers.slice(0, initialCount)
      targetPages.forEach((pageNumber) => {
        if (
          !textsByPageNumber.has(pageNumber) &&
          !loadingPagesRef.current.has(pageNumber) &&
          !pageLoadTimingStartsRef.current.has(pageNumber)
        ) {
          pageLoadTimingStartsRef.current.set(pageNumber, {
            stage: 'initial-page-loading',
            startedAt: getRenderTimingNow()
          })
        }
      })
    }
    lazyPageQueue.enqueueInitialPages(pageNumbers)
  }, [pageNumbers, runtimeDocument, lazyPageQueue, textsByPageNumber])

  useEffect(() => {
    return () => {
      clearAllVisibilityTimers()
      clearAllUnloadTimers()
    }
  }, [clearAllVisibilityTimers, clearAllUnloadTimers])

  useEffect(() => {
    if (!ocr || !runtimeDocument) {
      return
    }

    const isOcrEnabled =
      ocr === true || (typeof ocr === 'object' && ocr.enabled === true)

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
      // 捕获本次 OCR 发起时该页的驱逐代际，resolve 时比对以识别 stale 结果。
      const ocrRunGeneration =
        ocrEvictGenerationRef.current.get(pageNumber) ?? 0

      const startedAt = getRenderTimingNow()
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

          // 该页在本次 OCR 运行期间被离屏卸载过（代际已变），结果为 stale，
          // 丢弃以免写回已卸载的空外壳；重载后会以新代际重新发起 OCR。
          const currentGeneration =
            ocrEvictGenerationRef.current.get(pageNumber) ?? 0
          if (currentGeneration !== ocrRunGeneration) {
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
            const endedAt = getRenderTimingNow()
            renderTimingRef.current.record({
              stage: 'ocr-processing',
              startedAt,
              endedAt,
              durationMs: endedAt - startedAt,
              pageNumber
            })
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
      pageNumbers={pageNumbers}
      pageSizesByPageNumber={pageSizesByPageNumber}
      virtualPaperTransform={virtualPaperTransform}
      scaleRange={scaleRange}
      onInitialFitScale={handleInitialFitScale}
      onScrollToRange={scrollToRange}
      onScrollToRect={scrollToRect}
      onScrollToPosition={scrollToPosition}
      handleVirtualPaperTransformChange={handleVirtualPaperTransformChange}
      handleVirtualPaperTransformChangeEnd={
        handleVirtualPaperTransformChangeEnd
      }
      effectiveSelectedRangeId={effectiveSelectedRangeId}
      selectedHighlight={selectedHighlight}
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
      onCommentHighlight={onCommentHighlight}
      autoHighlight={autoHighlight}
      overlayRectType={overlayRectType}
      selectionRef={selectionRef}
      tool={tool}
      rects={runtimeRects}
      selectedRectId={effectiveSelectedRectId}
      onCreateRect={handleCreateRect}
      onSelectRect={handleSelectRect}
      onUpdateRect={handleUpdateRect}
      annotationHistoryController={annotationHistoryController}
      onClearAnnotationHistory={clearAnnotationHistory}
      onRunAnnotationHistory={runAnnotationHistory}
      setPageRef={setPageRef}
      setTextRef={setTextRef}
      textsByPageNumber={textsByPageNumber}
      ocrTextsByPageNumber={ocrTextsByPageNumber}
      pageStatuses={pageStatuses}
      loadablePages={loadablePages}
      baseImagesByPageNumber={baseImagesByPageNumber}
      imagesByPageNumber={imagesByPageNumber}
      onPageRenderTiming={pageRenderTimingHandler}
      touchPanMode={touchPanMode}
      containMarginX={containMarginX}
      containMarginTop={containMarginTop}
      containMarginBottom={containMarginBottom}
      containMarginY={containMarginY}
      selectedTool={selectedTool}
      paintingTool={paintingTool}
      pagePaintings={pagePaintings}
      onPagePaintingChange={onPagePaintingChange}
      drawingScale={virtualPaperTransform.scale}
      showPageBrowser={showPageBrowser}
      onPageBrowserVisibilityChange={handlePageBrowserVisibilityChange}
      onNavigateToPage={navigateToPage}
      themeColor={themeColor}
      visiblePageNumbers={visiblePages}
    />
  )
}
