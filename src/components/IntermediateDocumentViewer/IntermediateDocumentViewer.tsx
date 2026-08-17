import { Loading } from '@hamster-note/components'
import type {
  DrawingTool,
  DrawingValue,
  PaintingControllerData
} from '@hamster-note/painting'
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
  type IntermediatePage,
  IntermediatePageMap,
  type IntermediateParagraph,
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
  type CSSProperties,
  Profiler,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { getCommentCountByHighlightId } from '../../comments'
import type {
  ReaderComment,
  ReaderCommentChangeDetail
} from '../../types/comments'
import type { ReaderFontScale } from '../../types/fontScale'
import type {
  ReaderBookmark,
  ReaderEdgeCrop,
  ReaderPageEdgeCrop,
  ReaderTextAnchor,
  ReaderVirtualPaperState
} from '../../types/readerData'
import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryChangeSource,
  ReaderAnnotationHistoryOptions,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue,
  ReaderHighlightPopover,
  ReaderLinkedSelectionData,
  ReaderMousePosition,
  ReaderRectanglePopover,
  ReaderSelectionOverlayRectType,
  ReaderSelectionPopover,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderSelectionTool
} from '../../types/selection'
import { FLOW_LAYOUT_PAGE_WIDTH, type ReaderPageTool } from '../Page'
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
import { EdgeCropOverlay } from './EdgeCropOverlay'
import { summarizeHighlightRanges, traceHighlight } from './highlightDebug'
import { hasHighlightRects } from './highlightRectModes'
import { IntermediateDocumentPageContent } from './IntermediateDocumentPageContent'
import { getReaderImageAlt } from './intermediateImage'
import { deriveLayoutSelectionRange } from './layoutHighlightAdapter'
import {
  computeCenteredScrollPosition,
  computeNativeLayoutTransformExtent,
  isIPadOS,
  type NativeLayoutIntrinsicSize,
  type ReaderLayoutZoom,
  resolveNativeLayoutScaleStyle,
  resolveNativeLayoutTouchAction
} from './nativeLayoutZoom'
import { PageBrowser } from './PageBrowser'
import {
  getCroppedPreviewPoint,
  getPageCropGeometry,
  resolveHiddenPageNumbers,
  resolvePageEdgeCrop
} from './pageDisplay'
import { getPagePreloadWindow } from './pagePreloadWindow'
import { paginateTxtDocument } from './paginateTxtDocument'
import { ReadingProgress } from './ReadingProgress'
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
import {
  findTextAnchorAtOrBelow,
  findTopTextAnchor,
  getActiveBookmarkKey,
  getBookmarkKey,
  getTextAnchorKey,
  hasAnchorableText,
  isTextBookmark,
  resolveBookmarkNavigationHandler,
  resolveTextAnchorElement,
  type TextAnchorElementRecord
} from './textAnchor'
// intermediate-document 默认模式的懒加载页面队列 hook
import { useSelectionGeometryRevision } from './useDerivedTextSelectionRanges'
import { useHighlightDrag as useReaderHighlightDrag } from './useHighlightDrag'
import { type LazyPageQueueConfig, useLazyPageQueue } from './useLazyPageQueue'
import { useReadingProgressActivity } from './useReadingProgressActivity'

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

type NativeLayoutPageAnchor = {
  readonly pageNumber: number
  readonly element: HTMLDivElement
}

const findNearestConnectedPage = (
  targetPageNumber: number,
  pageNumbers: readonly number[],
  pageElements: ReadonlyMap<number, HTMLDivElement>
): NativeLayoutPageAnchor | null => {
  let nearestPage: NativeLayoutPageAnchor | null = null
  for (const pageNumber of pageNumbers) {
    const element = pageElements.get(pageNumber)
    if (!element?.isConnected) continue
    if (
      !nearestPage ||
      Math.abs(pageNumber - targetPageNumber) <
        Math.abs(nearestPage.pageNumber - targetPageNumber)
    ) {
      nearestPage = { pageNumber, element }
    }
  }
  return nearestPage
}

const getSelectionForRoot = (
  viewerRoot: HTMLElement | null
): Selection | null => {
  return viewerRoot?.ownerDocument.defaultView?.getSelection?.() ?? null
}

const EMPTY_SELECTION_RANGES: SelectionRange[] = []
const EMPTY_INTERMEDIATE_TEXTS: IntermediateText[] = []
const EMPTY_INTERMEDIATE_IMAGES: IntermediateImage[] = []
const EMPTY_INTERMEDIATE_PARAGRAPHS: IntermediateParagraph[] = []
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

/**
 * OCR 配置对象。`enabled` 为全局开关；
 * `pages` 存在时进入手动模式，仅识别并展示列出的页码（1-based）。
 */
export type ReaderOcrOptions = {
  enabled?: boolean
  pages?: readonly number[]
}

/** 外挂 OCR：接收页面原尺寸 base64 图片，返回该页的中间态识别结果。 */
export type ReaderExtraOcr = (
  imageBase64: string
) => IntermediatePage | Promise<IntermediatePage>

export type ReaderReadingPositionHandle = {
  readonly captureTextAnchor: () => ReaderTextAnchor | undefined
}

export type IntermediateDocumentViewerProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  serializedDocument?: IntermediateDocumentSerialized | null
  /** EPUB 高亮仅从字符锚点实时派生，不持久化页面矩形。 */
  isEpub?: boolean
  /** 仅 PDF 的版面模式进度反馈可显示页面缩略图。 */
  isPdf?: boolean
  className?: string
  fontScale?: ReaderFontScale
  overscan?: number
  pageRange?: ReaderPageRange
  hiddenPages?: readonly (number | string)[]
  edgeCrop?: ReaderPageEdgeCrop
  /**
   * 边缘裁切编辑模式：为 true 时页面以未裁切状态渲染，
   * 并在每页上方显示可拖拽的裁切线覆盖层。
   * 编辑期间 VirtualPaper 禁用单指拖拽，避免与裁切线拖拽冲突。
   */
  edgeCropEditing?: boolean
  /**
   * 用户在覆盖层点击「应用」时回调。
   * - `pageNumber` 为具体页码时：将 crop 应用到该页（写入 edgeCrop.pages）。
   * - `pageNumber` 为 `null` 时：将 crop 应用到所有页面（写入 edgeCrop.all）。
   * 宿主应在此回调中将 edgeCropEditing 设为 false。
   */
  onEdgeCropApply?: (pageNumber: number | null, crop: ReaderEdgeCrop) => void
  onEdgeCropHidePage?: (pageNumber: number) => void
  /**
   * OCR 配置。
   * - `true` / `{ enabled: true }`：自动模式，识别当前与后续加载完成的页面；
   * - `{ enabled: true, pages: [...] }`：手动模式，仅识别并展示列出的页码，
   *   从列表中移除某页即按页关闭该页 OCR（丢弃在途结果与缓存）；
   * - `false` / `{ enabled: false }`：全局关闭，清空所有 OCR 展示。
   */
  ocr?: boolean | ReaderOcrOptions
  /** 自定义 OCR 实现；未提供时使用内置的 @hamster-note/image-parser。 */
  extraOCR?: ReaderExtraOcr
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  /**
   * 受控 OCR 文本数据（pageNumber -> 文本列表，1-based）。
   * 已有数据的页不会重复发起 OCR，直接渲染该数据；
   * 手动模式下仅渲染 `ocr.pages` 列表内的页。
   */
  ocrTexts?: Readonly<Record<number, readonly IntermediateText[]>>
  /**
   * 单页 OCR 完成回调，输出识别结果供宿主持久化 / 受控回传。
   * OCR 文本颜色已统一设置为透明（隐形文本层，仅供选择/搜索）。
   */
  onOcrTextsChange?: (pageNumber: number, texts: IntermediateText[]) => void
  /**
   * OCR 开发调试模式：开启后 OCR 文本以黑色 50% 透明度显示并加红色外框，
   * 便于宿主核对识别位置与内容。仅影响渲染，不影响存储/回传的文本数据。
   */
  ocrDebug?: boolean
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
  /** 使用 VirtualPaper 承载版面模式；默认 true。 */
  useVirtualPaper?: boolean
  /** 非 VirtualPaper 模式的预设缩放或适配宽度策略。 */
  nativeLayoutZoom?: ReaderLayoutZoom
  /** 非 VirtualPaper 模式解析出实际缩放比例时触发。 */
  onNativeLayoutScaleChange?: (scale: number) => void
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
  defaultVirtualPaperTransform?: ReaderVirtualPaperState
  onVirtualPaperTransformChangeEnd?: (
    transform: ReaderVirtualPaperState
  ) => void
  /** 原生 Layout 缩放模式的可恢复阅读进度。 */
  layoutReadingProgress?: ReaderBookmark
  /** 原生 Layout 滚动后回传文字锚点，页面无文字时回传页内百分比。 */
  onLayoutReadingProgressChange?: (progress: ReaderBookmark) => void
  onTextAnchorChange?: (anchor: ReaderTextAnchor | undefined) => void
  readingPositionRef?: Ref<ReaderReadingPositionHandle>
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
  /** 鼠标拖动高亮或触摸长按高亮进入拖动状态时触发，每次手势仅触发一次。 */
  onDragHighlight?: (highlight: ReaderSelectionRange) => void
  /** 已确认高亮的 Overlay 颜色（CSS color），默认半透明黄 */
  highlightColor?: string
  /** 正在选择中的临时 Overlay 颜色（CSS color），默认半透明粉 */
  selectionColor?: string
  /** 是否启用选区端点放大镜，默认 false。 */
  showSelectionMagnifier?: boolean
  /** 当某个高亮被选中时，在其上方弹出的 Popover 内容（ReactNode），由调用方完全控制 */
  selectionPopover?: ReaderSelectionPopover
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
  /** 已确认矩形上方弹出的 Popover；renderer 接收当前矩形的原始公开对象。 */
  rectPopover?: ReaderRectanglePopover
  /** 当用户确认一个新矩形框选时触发 */
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  /** 当用户选中/取消选中某个矩形框选时触发 */
  onSelectRect?: (id: string | null) => void
  /** 当用户拖动矩形手柄调整后触发 */
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  /** 用户从页面浏览侧栏删除高亮 range 时触发；数据由调用方负责移除。 */
  onRemoveRange?: (id: string) => void
  /** 用户从页面浏览侧栏删除矩形框选时触发；数据由调用方负责移除。 */
  onRemoveRect?: (id: string) => void
  annotationHistory?: ReaderAnnotationHistoryOptions
  onAnnotationHistoryChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
  onAnnotationHistoryStatusChange?: (
    status: ReaderAnnotationHistoryStatus
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
   * Layout 模式按页、Text 模式按完整段预加载的前后范围。省略时默认各 `3`。
   */
  pagePreloadRadius?: number
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
  drawingStrokeColor?: string
  paintingControllerData?: PaintingControllerData
  onPaintingControllerDataChange?: (data: PaintingControllerData) => void
  pagePaintings?: Record<string, DrawingValue>
  onPagePaintingChange?: (pageId: string, nextValue: DrawingValue) => void
  /** 是否显示从左侧滑入的页面浏览纵栏，默认 false */
  showPageBrowser?: boolean
  /** 页面浏览纵栏被左滑关闭时触发。 */
  onPageBrowserClose?: () => void
  /** 主题色（CSS color），用于 page-browser 选中项的 outline。默认 '#2563eb'。 */
  themeColor?: string
  /** 每个 rangeId 对应的评论数量，传入 page-browser 高亮列表展示评论计数徽章。 */
  commentCountByRangeId?: Readonly<Record<string, number>>
  /** 每个 rectId 对应的评论数量，传入 page-browser 高亮列表展示评论计数徽章。 */
  commentCountByRectId?: Readonly<Record<string, number>>
  /** 受控评论数据；Reader 不内部修改，由 onCommentsChange 通知宿主更新。 */
  comments?: readonly ReaderComment[]
  /** 评论数据变更回调（库本身不修改评论；为宿主层预留的统一变更通道）。 */
  onCommentsChange?: (
    nextComments: readonly ReaderComment[],
    detail: ReaderCommentChangeDetail
  ) => void
  /** 由宿主控制的精确文字书签。 */
  bookmarks?: readonly ReaderBookmark[]
  /** 添加或删除指定文字书签。 */
  onToggleBookmark?: (bookmark: ReaderBookmark) => void
  onDragBookmark?: (bookmark: ReaderBookmark) => void
  /** @deprecated 使用 bookmarks。 */
  bookmarkedPageNumbers?: readonly number[]
  /** @deprecated 使用 onToggleBookmark。 */
  onTogglePageBookmark?: (pageNumber: number) => void
  /** 页面加载状态变化时的回调，报告当前已加载的页码列表 */
  onPageLoadStatusChange?: (loadedPageNumbers: number[]) => void
  /** Popover 使用相对定位（absolute）相对于容器，而非 fixed 相对于 window */
  popoverRelative?: boolean
}

function resolveRestoringNativeProgressKey(
  progressKey: string | undefined,
  lastReportedKey: string | undefined,
  restoringKey: string | undefined
): string | undefined {
  return progressKey !== undefined &&
    (restoringKey === progressKey || lastReportedKey !== progressKey)
    ? progressKey
    : undefined
}

function getUnreportedNativeProgressKey(
  useVirtualPaper: boolean,
  nextBookmark: ReaderBookmark | undefined,
  restoringKey: string | undefined,
  lastReportedKey: string | undefined
): string | undefined {
  if (useVirtualPaper || !nextBookmark || restoringKey !== undefined) {
    return undefined
  }
  const progressKey = getBookmarkKey(nextBookmark)
  return lastReportedKey === progressKey ? undefined : progressKey
}

function getInitialLayoutTextAnchor(
  defaultVirtualPaperTransform: ReaderVirtualPaperState | undefined,
  layoutReadingProgress: ReaderBookmark | undefined
): ReaderTextAnchor | undefined {
  if (defaultVirtualPaperTransform?.anchor) {
    return defaultVirtualPaperTransform.anchor
  }
  return layoutReadingProgress && isTextBookmark(layoutReadingProgress)
    ? layoutReadingProgress
    : undefined
}

function getInitialLayoutBookmark(
  defaultVirtualPaperTransform: ReaderVirtualPaperState | undefined,
  layoutReadingProgress: ReaderBookmark | undefined
): ReaderBookmark | undefined {
  return defaultVirtualPaperTransform?.anchor ?? layoutReadingProgress
}

function getOptionalBookmarkKey(
  bookmark: ReaderBookmark | undefined
): string | undefined {
  return bookmark ? getBookmarkKey(bookmark) : undefined
}

type NativeLayoutProgressReportOptions = {
  readonly lastReportedProgressKeyRef: { current: string | undefined }
  readonly nextBookmark: ReaderBookmark | undefined
  readonly onProgressChange: ((progress: ReaderBookmark) => void) | undefined
  readonly restoringProgressKeyRef: { current: string | undefined }
  readonly useVirtualPaper: boolean
}

function reportUnreportedNativeProgress({
  lastReportedProgressKeyRef,
  nextBookmark,
  onProgressChange,
  restoringProgressKeyRef,
  useVirtualPaper
}: NativeLayoutProgressReportOptions): void {
  const progressKey = getUnreportedNativeProgressKey(
    useVirtualPaper,
    nextBookmark,
    restoringProgressKeyRef.current,
    lastReportedProgressKeyRef.current
  )
  if (!progressKey || !nextBookmark) return

  lastReportedProgressKeyRef.current = progressKey
  onProgressChange?.(nextBookmark)
}

function completeNativeProgressRestore(
  source: 'restore' | 'bookmark',
  restoringProgressKeyRef: { current: string | undefined }
): void {
  if (source === 'restore') {
    restoringProgressKeyRef.current = undefined
  }
}

function resolveNativeLayoutBookmark(
  anchor: ReaderTextAnchor | undefined,
  contentTop: number,
  topPage: { readonly pageNumber: number; readonly rect: DOMRect } | undefined
): ReaderBookmark | undefined {
  if (anchor) return anchor
  if (!topPage) return undefined

  return {
    pageNumber: topPage.pageNumber,
    verticalPercentage:
      Math.round(
        Math.min(
          100,
          Math.max(
            0,
            ((contentTop - topPage.rect.top) / topPage.rect.height) * 100
          )
        ) * 100
      ) / 100
  }
}

type NativeLayoutProgressGateOptions = {
  readonly lastReportedProgressKeyRef: { current: string | undefined }
  readonly layoutReadingProgress: ReaderBookmark | undefined
  readonly restoringProgressKeyRef: { current: string | undefined }
  readonly runtimeDocument: IntermediateDocument | null
  readonly useVirtualPaper: boolean
}

function useSyncNativeLayoutProgressGate({
  lastReportedProgressKeyRef,
  layoutReadingProgress,
  restoringProgressKeyRef,
  runtimeDocument,
  useVirtualPaper
}: NativeLayoutProgressGateOptions): void {
  const progressDocumentRef = useRef(runtimeDocument)
  useLayoutEffect(() => {
    const progressKey = layoutReadingProgress
      ? getBookmarkKey(layoutReadingProgress)
      : undefined
    const documentChanged = progressDocumentRef.current !== runtimeDocument
    progressDocumentRef.current = runtimeDocument
    const nativeProgressKey = useVirtualPaper ? undefined : progressKey
    restoringProgressKeyRef.current = documentChanged
      ? nativeProgressKey
      : resolveRestoringNativeProgressKey(
          nativeProgressKey,
          lastReportedProgressKeyRef.current,
          restoringProgressKeyRef.current
        )
    lastReportedProgressKeyRef.current = progressKey
  }, [
    lastReportedProgressKeyRef,
    layoutReadingProgress,
    runtimeDocument,
    restoringProgressKeyRef,
    useVirtualPaper
  ])
}

type NativeLayoutReadingProgressRestoreOptions = {
  readonly cancelPendingProgressRestore: () => void
  readonly effectiveScale: number
  readonly layoutReadingProgress: ReaderBookmark | undefined
  readonly navigateToBookmark: (
    bookmark: ReaderBookmark,
    source?: 'restore' | 'bookmark'
  ) => void
  readonly pageRefs: { readonly current: Map<number, HTMLDivElement> }
  readonly pageNumbers: readonly number[]
  readonly pageResourcesDocument: IntermediateDocument | null
  readonly pageStatuses: ReadonlyMap<number, PageLoadStatus>
  readonly requestPageLoad: (pageNumber: number) => void
  readonly restoringProgressKeyRef: { current: string | undefined }
  readonly runtimeDocument: IntermediateDocument | null
  readonly useVirtualPaper: boolean
  readonly viewerRootRef: { readonly current: HTMLDivElement | null }
}

function useNativeLayoutReadingProgressRestore({
  cancelPendingProgressRestore,
  effectiveScale,
  layoutReadingProgress,
  navigateToBookmark,
  pageNumbers,
  pageRefs,
  pageResourcesDocument,
  pageStatuses,
  requestPageLoad,
  restoringProgressKeyRef,
  runtimeDocument,
  useVirtualPaper,
  viewerRootRef
}: NativeLayoutReadingProgressRestoreOptions): void {
  const appliedProgressRef = useRef<{
    readonly runtimeDocument: IntermediateDocument
    readonly key: string
    readonly scale: number
  } | null>(null)

  useEffect(() => {
    if (useVirtualPaper) return
    if (!layoutReadingProgress) {
      cancelPendingProgressRestore()
      appliedProgressRef.current = null
      return
    }
    if (!runtimeDocument || pageResourcesDocument !== runtimeDocument) {
      return
    }

    const key = getBookmarkKey(layoutReadingProgress)
    const applied = appliedProgressRef.current
    if (
      applied?.runtimeDocument === runtimeDocument &&
      applied.key === key &&
      applied.scale === effectiveScale
    ) {
      return
    }

    const markApplied = () => {
      appliedProgressRef.current = {
        runtimeDocument,
        key,
        scale: effectiveScale
      }
    }
    const releaseRestore = () => {
      if (restoringProgressKeyRef.current === key) {
        restoringProgressKeyRef.current = undefined
      }
    }
    const isScaleReapplication =
      applied?.runtimeDocument === runtimeDocument && applied.key === key
    if (restoringProgressKeyRef.current !== key && !isScaleReapplication) {
      cancelPendingProgressRestore()
      markApplied()
      return
    }

    const progressPageStatus = pageStatuses.get(
      layoutReadingProgress.pageNumber
    )
    if (
      !pageNumbers.includes(layoutReadingProgress.pageNumber) ||
      progressPageStatus === 'error'
    ) {
      cancelPendingProgressRestore()
      releaseRestore()
      markApplied()
      return
    }
    if (
      !isTextBookmark(layoutReadingProgress) &&
      progressPageStatus !== 'loaded'
    ) {
      requestPageLoad(layoutReadingProgress.pageNumber)
      return
    }
    if (
      !isTextBookmark(layoutReadingProgress) &&
      !pageRefs.current.has(layoutReadingProgress.pageNumber)
    ) {
      releaseRestore()
      markApplied()
      return
    }
    if (isTextBookmark(layoutReadingProgress)) {
      markApplied()
      navigateToBookmark(layoutReadingProgress, 'restore')
      return
    }

    restoringProgressKeyRef.current = key
    const viewerWindow = viewerRootRef.current?.ownerDocument.defaultView
    if (!viewerWindow) {
      navigateToBookmark(layoutReadingProgress, 'restore')
      restoringProgressKeyRef.current = undefined
      markApplied()
      return
    }

    let settleFrameId: number | undefined
    const restoreProgress = () => {
      navigateToBookmark(layoutReadingProgress, 'restore')
      markApplied()
      releaseRestore()
    }
    const waitForSettledLayout = () => {
      settleFrameId = viewerWindow.requestAnimationFrame(restoreProgress)
    }
    const layoutFrameId =
      viewerWindow.requestAnimationFrame(waitForSettledLayout)
    return () => {
      viewerWindow.cancelAnimationFrame(layoutFrameId)
      if (settleFrameId !== undefined) {
        viewerWindow.cancelAnimationFrame(settleFrameId)
      }
    }
  }, [
    cancelPendingProgressRestore,
    effectiveScale,
    layoutReadingProgress,
    navigateToBookmark,
    pageNumbers,
    pageRefs,
    pageResourcesDocument,
    pageStatuses,
    requestPageLoad,
    restoringProgressKeyRef,
    runtimeDocument,
    useVirtualPaper,
    viewerRootRef
  ])
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
const MAX_RENDERABLE_PAGE_DIMENSION = 100_000
// 水平留白（最宽页面两侧各 12px）由 document 外层 gutter 承担，
// `.hamster-note-document` 本身只表示 Page 的紧密内容边界。
const INTERMEDIATE_PAGE_HORIZONTAL_MARGIN = 24
// 与 reader.scss 中 `.hamster-note-document` 的页面间距保持同步。
const INTERMEDIATE_PAGE_GAP = 16

const TWO_FINGER_TOUCH_ENABLED_INTERACTIONS = [
  ...DEFAULT_ENABLED_INTERACTIONS.filter(
    (mode) => mode !== VirtualPaperInteractionMode.TouchSingleFingerPan
  ),
  VirtualPaperInteractionMode.TouchTwoFingerPan
]

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

const serializedPageUsesFlowLayout = (page: object): boolean =>
  'useFlowLayout' in page && page.useFlowLayout === true

const getSerializedImageAlts = (
  serializedDocument: IntermediateDocumentSerialized
): ReadonlyMap<number, ReadonlyMap<string, string>> => {
  const imageAltsByPage = new Map<number, ReadonlyMap<string, string>>()

  for (const page of serializedDocument.pages) {
    const imageAlts = new Map<string, string>()
    for (const content of page.content ?? []) {
      const alt = getReaderImageAlt(content)
      if ('src' in content && alt) imageAlts.set(content.id, alt)
    }
    if (imageAlts.size > 0) imageAltsByPage.set(page.number, imageAlts)
  }

  return imageAltsByPage
}

const restoreSerializedFlowLayout = (
  runtimeDocument: IntermediateDocument,
  serializedDocument: IntermediateDocumentSerialized
): IntermediateDocument => {
  const flowLayoutPageNumbers = new Set(
    serializedDocument.pages
      .filter(serializedPageUsesFlowLayout)
      .map((page) => page.number)
  )
  const imageAltsByPage = getSerializedImageAlts(serializedDocument)
  if (flowLayoutPageNumbers.size === 0 && imageAltsByPage.size === 0) {
    return runtimeDocument
  }

  const pagesMap = IntermediatePageMap.makeByInfoList(
    serializedDocument.pages.map((serializedPage) => ({
      id: serializedPage.id,
      pageNumber: serializedPage.number,
      size: { x: serializedPage.width, y: serializedPage.height },
      getData: async () => {
        const pagePromise = runtimeDocument.getPageByPageNumber(
          serializedPage.number
        )
        if (!pagePromise) {
          throw new Error(`Missing runtime page ${serializedPage.number}`)
        }

        const page = await pagePromise
        if (flowLayoutPageNumbers.has(serializedPage.number)) {
          Object.defineProperty(page, 'useFlowLayout', {
            configurable: true,
            enumerable: true,
            value: true
          })
        }

        const imageAlts = imageAltsByPage.get(serializedPage.number)
        if (imageAlts) {
          for (const content of await page.getContent()) {
            const alt = imageAlts.get(content.id)
            if (!alt || !isIntermediateImage(content)) continue

            Object.defineProperty(content, 'alt', {
              configurable: true,
              enumerable: true,
              value: alt
            })
          }
        }
        return page
      }
    }))
  )

  return new IntermediateDocument({
    id: runtimeDocument.id,
    title: runtimeDocument.title,
    outline: runtimeDocument.getOutline(),
    pagesMap
  })
}

const getSerializedFlowLayoutPageNumbers = (
  document:
    | IntermediateDocument
    | IntermediateDocumentSerialized
    | null
    | undefined
): ReadonlySet<number> => {
  if (!document || isRuntimeDocument(document)) return new Set()

  return new Set(
    document.pages
      .filter(serializedPageUsesFlowLayout)
      .map((page) => page.number)
  )
}

export const getRuntimeDocument = (
  inputDocument:
    | IntermediateDocument
    | IntermediateDocumentSerialized
    | null
    | undefined
) => {
  if (!inputDocument) return null
  const runtimeDocument = isRuntimeDocument(inputDocument)
    ? inputDocument
    : restoreSerializedFlowLayout(
        IntermediateDocument.parse(inputDocument),
        inputDocument
      )

  return paginateTxtDocument(runtimeDocument)
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
  const sourceWidth = size?.x
  const sourceHeight = size?.y
  const widthAvailable =
    typeof sourceWidth === 'number' &&
    Number.isFinite(sourceWidth) &&
    sourceWidth > 0 &&
    sourceWidth <= MAX_RENDERABLE_PAGE_DIMENSION
  const heightAvailable =
    typeof sourceHeight === 'number' &&
    Number.isFinite(sourceHeight) &&
    sourceHeight > 0 &&
    sourceHeight <= MAX_RENDERABLE_PAGE_DIMENSION
  const pageSizeUnavailable = !widthAvailable || !heightAvailable
  const width = widthAvailable ? sourceWidth : DEFAULT_PAGE_SIZE.width
  const height = heightAvailable ? sourceHeight : DEFAULT_PAGE_SIZE.height

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

const createSetParagraphsHandler = (
  pageNumber: number,
  paragraphs: IntermediateParagraph[]
) => {
  return (currentParagraphs: Map<number, IntermediateParagraph[]>) => {
    const nextParagraphs = new Map(currentParagraphs)
    nextParagraphs.set(pageNumber, paragraphs)
    return nextParagraphs
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

const createSetContentHandler = (
  pageNumber: number,
  content: IntermediateContent[]
) => {
  return (currentContent: Map<number, IntermediateContent[]>) => {
    const nextContent = new Map(currentContent)
    nextContent.set(pageNumber, content)
    return nextContent
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

// OCR 固定使用原尺寸页面图像（IntermediatePage.getThumbnail(1)，即 viewport scale=1）。
// 展示缩略图按当前缩放比例渲染，分辨率随缩放变化，且其像素坐标空间与页面坐标空间
// （page.width/height 基于 scale=1）不一致，直接 OCR 会导致文本层多边形位置偏移。
const OCR_IMAGE_SCALE = 1

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

// OCR 文本统一设为透明：作为隐形文本层叠加在底图上，
// 仅供选择/搜索，避免与底图文字重复显示。
const prefixOcrTextIds = (texts: IntermediateText[], pageNumber: number) =>
  texts.map((text) => ({
    ...text,
    id: `ocr-${pageNumber}-${text.id}`,
    color: 'transparent'
  }))

// 已移除自定义 SVG 选区 overlay 的拖拽 hook；文本选择改回浏览器原生 Selection。

// 组合根节点 className：ocrDebug 时附加调试修饰类（驱动 OCR 文本红色外框样式）
const buildViewerRootClassName = (ocrDebug: boolean, className?: string) =>
  [
    'hamster-reader__intermediate-document-viewer',
    ocrDebug
      ? 'hamster-reader__intermediate-document-viewer--ocr-debug'
      : undefined,
    className
  ]
    .filter(Boolean)
    .join(' ')

// OCR 内容获取：优先外挂 extraOCR，否则回退到内置 image-parser
const fetchOcrContent = async (
  ocrImageSource: string,
  extraOCR?: ReaderExtraOcr
): Promise<IntermediateContent[]> => {
  if (extraOCR) {
    const ocrPage = await extraOCR(ocrImageSource)
    return await ocrPage.getContent()
  }
  const { ImageParser } = await import('@hamster-note/image-parser')
  const input = await getImageParserInput(ocrImageSource)
  const ocrDocument = await ImageParser.encode(input)
  const ocrPages = await ocrDocument.pages
  return ocrPages[0]?.content ?? []
}

// 编辑模式下页面以未裁切尺寸显示，effectiveEdgeCrop 为 undefined
const resolveEffectiveEdgeCrop = (
  editing: boolean | undefined,
  crop: ReaderPageEdgeCrop | undefined
): ReaderPageEdgeCrop | undefined => (editing ? undefined : crop)

type SetTextRef = (
  text: IntermediateText,
  pageNumber: number
) => (element: HTMLSpanElement | null) => void

type PageRefSetter = (
  pageNumber: number
) => (element: HTMLDivElement | null) => void

type PageResources = {
  pageSizesByPageNumber: Map<number, NormalizedPageSize>
  flowLayoutPages: ReadonlySet<number>
  orderedContentByPageNumber: Map<number, IntermediateContent[]>
  textsByPageNumber: Map<number, IntermediateText[]>
  paragraphsByPageNumber: Map<number, IntermediateParagraph[]>
  ocrTextsByPageNumber: Map<number, IntermediateText[]>
  /** 正在执行 OCR 的页码集合（驱动页内 Loading 角标渲染） */
  ocrLoadingPages: ReadonlySet<number>
  pageStatuses: Map<number, PageLoadStatus>
  loadablePages: Set<number>
  baseImagesByPageNumber: Map<number, string>
}

type ViewerContentProps = PageResources & {
  rootClassName: string
  viewerRootRef: (element: HTMLDivElement | null) => void
  selectionScope: symbol
  pageNumbers: number[]
  hiddenPageNumbers: ReadonlySet<number>
  fontScale?: ReaderFontScale
  edgeCrop?: ReaderPageEdgeCrop
  edgeCropEditing?: boolean
  onEdgeCropApply?: (pageNumber: number | null, crop: ReaderEdgeCrop) => void
  onEdgeCropHidePage?: (pageNumber: number) => void
  virtualPaperTransform: VirtualPaperTransform
  useVirtualPaper: boolean
  nativeLayoutZoom: ReaderLayoutZoom
  committedReaderScale: number
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
  storedRanges: ReaderSelectionRange[]
  effectiveRanges: ReaderSelectionRange[]
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
  showSelectionMagnifier: boolean
  selectionPopover: ReactNode
  highlightPopover: ReaderHighlightPopover
  rectPopover: ReactNode
  onCommentHighlight:
    | ((highlight: ReaderSelectionRange) => Promise<ReaderSelectionRange>)
    | undefined
  onDragHighlight: ((highlight: ReaderSelectionRange) => void) | undefined
  autoHighlight: boolean | undefined
  overlayRectType: ReaderSelectionOverlayRectType
  selectionRef: Ref<ReaderSelectionRef> | undefined
  tool?: ReaderSelectionTool
  rects?: ReaderSelectionRectangle[]
  selectedRectId?: string | null
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  onSelectRect?: (id: string | null) => void
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  onRemoveRange?: (id: string) => void
  onRemoveRect?: (id: string) => void
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
  paintingControllerData: PaintingControllerData
  onPaintingControllerDataChange: (data: PaintingControllerData) => void
  pagePaintings?: Record<string, DrawingValue>
  onPagePaintingChange?: (pageId: string, nextValue: DrawingValue) => void
  drawingScale: number
  showPageBrowser: boolean
  previewEnabled: boolean
  onPageBrowserClose?: () => void
  onPageBrowserVisibilityChange: (
    pageNumber: number,
    isVisible: boolean
  ) => void
  onNavigateToPage: (pageNumber: number) => void
  themeColor?: string
  visiblePageNumbers: ReadonlySet<number>
  commentCountByRangeId?: Readonly<Record<string, number>>
  commentCountByRectId?: Readonly<Record<string, number>>
  bookmarks?: readonly ReaderBookmark[]
  currentBookmark?: ReaderBookmark
  currentPageNumber: number
  activeBookmarkKey?: string
  onNavigateToBookmark?: (bookmark: ReaderBookmark) => void
  onDragBookmark?: (bookmark: ReaderBookmark) => void
  onToggleBookmark?: (bookmark: ReaderBookmark) => void
  bookmarkedPageNumbers?: readonly number[]
  onTogglePageBookmark?: (pageNumber: number) => void
  onViewportPositionChange: () => void
  popoverRelative?: boolean
}

type ScopedContentSize = {
  readonly selectionScope: symbol
  readonly size: PageSize
}

type PendingLinkedHighlightOperation = ReadonlySet<string>

type PendingTextAnchorOperation = {
  readonly anchor: ReaderTextAnchor
  readonly runtimeDocument: IntermediateDocument | null
  readonly source: 'restore' | 'bookmark'
  readonly token: symbol
}

function ignorePaintingControllerChange() {}

const getVirtualPaperStateKey = (state: ReaderVirtualPaperState): string =>
  `${state.x}:${state.y}:${state.scale}:${state.anchor ? getTextAnchorKey(state.anchor) : ''}`

const getOptionalVirtualPaperStateKey = (
  state: ReaderVirtualPaperState | undefined
): string => (state ? getVirtualPaperStateKey(state) : '')

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
  useVirtualPaper: boolean
  pageNumbers: number[]
  hiddenPageNumbers: ReadonlySet<number>
  fontScale?: ReaderFontScale
  edgeCrop?: ReaderPageEdgeCrop
  edgeCropEditing?: boolean
  /** 真实的 edgeCrop（未经编辑模式过滤），用于覆盖层初始化线条位置 */
  realEdgeCrop?: ReaderPageEdgeCrop
  /** 应用裁切回调；pageNumber 为 null 表示应用到所有页面 */
  onEdgeCropApply?: (pageNumber: number | null, crop: ReaderEdgeCrop) => void
  onEdgeCropHidePage?: (pageNumber: number) => void
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
  showSelectionMagnifier: boolean
  overlayRectType: ReaderSelectionOverlayRectType
  effectiveSelectedRangeId: string | null
  selectionPopover: ReactNode
  highlightPopover: ReactNode
  rectPopover: ReactNode
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
  paintingControllerData: PaintingControllerData
  onPaintingControllerDataChange: (data: PaintingControllerData) => void
  pagePaintings?: Record<string, DrawingValue>
  onPagePaintingChange?: (pageId: string, nextValue: DrawingValue) => void
  drawingScale: number
  cancelDrawingOnMultiTouch: boolean
  readerScale: number
  popoverRelative?: boolean
}

type PageVisibilityBoundaryProps = {
  readonly pageNumber: number
  readonly hidden: boolean
  readonly children: ReactNode
}

type PagePopoverOptions = {
  readonly containerRef: React.RefObject<HTMLElement | null>
  readonly visible: boolean
  readonly relative: boolean | undefined
  readonly selectionPopover: ReactNode
  readonly highlightPopover: ReactNode
  readonly rectPopover: ReactNode
  readonly selectedRectId: string | null | undefined
}

type PagePopovers = {
  readonly selected: ReactNode
  readonly active: ReactNode
}

const getPagePopovers = (
  isOwner: boolean,
  options: PagePopoverOptions
): PagePopovers => {
  if (!isOwner) return { selected: undefined, active: undefined }

  const selectedPopover = options.selectedRectId
    ? (options.rectPopover ?? options.selectionPopover)
    : (options.highlightPopover ?? options.selectionPopover)

  return {
    selected: (
      <PopoverPortal
        containerRef={options.containerRef}
        selectionKind='selected'
        visible={options.visible}
        relative={options.relative}
      >
        {selectedPopover}
      </PopoverPortal>
    ),
    active: (
      <PopoverPortal
        containerRef={options.containerRef}
        selectionKind='active'
        visible={options.visible}
        relative={options.relative}
      >
        {options.selectionPopover}
      </PopoverPortal>
    )
  }
}

function PageVisibilityBoundary({
  pageNumber,
  hidden,
  children
}: PageVisibilityBoundaryProps) {
  if (!hidden) return children

  return (
    <div
      className='hamster-reader__hidden-page-placeholder'
      data-testid={`intermediate-page-hidden-${pageNumber}`}
    >
      当前 第 {pageNumber} 页 已隐藏
    </div>
  )
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

const getPageShellStyle = (
  useFlowLayout: boolean,
  previewPageWidth: number,
  previewPageHeight: number,
  readerScale: number
): CSSProperties =>
  useFlowLayout
    ? {
        width: `${FLOW_LAYOUT_PAGE_WIDTH * readerScale}px`,
        // 水平留白改由 document 外层 gutter 的内联 padding 承担，避免块级布局
        // 过约束（over-constraint）时右侧 margin 被浏览器丢弃。
        margin: `${(INTERMEDIATE_PAGE_HORIZONTAL_MARGIN / 2) * readerScale}px 0`
      }
    : {
        position: 'relative',
        width: `${(previewPageWidth || DEFAULT_PAGE_SIZE.width) * readerScale}px`,
        height: `${previewPageHeight * readerScale}px`,
        // 水平留白改由 document 外层 gutter 的内联 padding 承担，避免块级布局
        // 过约束（over-constraint）时右侧 margin 被浏览器丢弃。
        margin: `${(INTERMEDIATE_PAGE_HORIZONTAL_MARGIN / 2) * readerScale}px 0`,
        overflow: 'hidden'
      }

const getContentScaleStyle = (
  useFlowLayout: boolean,
  shellPageSize: NormalizedPageSize,
  cropGeometry: ReturnType<typeof getPageCropGeometry>,
  pagePreviewScale: number,
  readerScale: number
): CSSProperties | undefined =>
  useFlowLayout
    ? {
        zoom: readerScale
      }
    : {
        position: 'absolute',
        top: `${-cropGeometry.top * pagePreviewScale * readerScale}px`,
        left: `${-cropGeometry.left * pagePreviewScale * readerScale}px`,
        width: `${shellPageSize.width}px`,
        height: `${shellPageSize.height}px`,
        transform: `scale(${pagePreviewScale * readerScale})`,
        transformOrigin: 'top left'
      }

type PageRectHitTestContext = {
  readonly shellPageSize: NormalizedPageSize
  readonly cropGeometry: ReturnType<typeof getPageCropGeometry>
  readonly rects: readonly ReaderSelectionRectangle[] | undefined
  readonly shellSelectionId: string
}

const findTouchedRect = (
  pageElement: HTMLElement,
  point: Pick<PointerEvent, 'clientX' | 'clientY'>,
  context: PageRectHitTestContext
): ReaderSelectionRectangle | undefined => {
  const pageContentScale = pageElement.querySelector<HTMLElement>(
    '.hamster-reader__intermediate-page-content-scale'
  )
  const contentBounds = pageContentScale?.getBoundingClientRect()
  const pageBounds = pageElement.getBoundingClientRect()
  const hasContentBounds =
    contentBounds !== undefined &&
    contentBounds.width > 0 &&
    contentBounds.height > 0
  const bounds = hasContentBounds ? contentBounds : pageBounds
  if (bounds.width <= 0 || bounds.height <= 0) return undefined

  const sourceLeft = hasContentBounds ? 0 : context.cropGeometry.left
  const sourceTop = hasContentBounds ? 0 : context.cropGeometry.top
  const sourceWidth = hasContentBounds
    ? context.shellPageSize.width
    : context.cropGeometry.width
  const sourceHeight = hasContentBounds
    ? context.shellPageSize.height
    : context.cropGeometry.height
  const pixelX =
    sourceLeft + ((point.clientX - bounds.left) / bounds.width) * sourceWidth
  const pixelY =
    sourceTop + ((point.clientY - bounds.top) / bounds.height) * sourceHeight
  const percentX = (pixelX / context.shellPageSize.width) * 100
  const percentY = (pixelY / context.shellPageSize.height) * 100

  return context.rects?.find((rect) => {
    const localX = rect.overlayRectType === 'percent' ? percentX : pixelX
    const localY = rect.overlayRectType === 'percent' ? percentY : pixelY
    return (
      rect.selectionId === context.shellSelectionId &&
      localX >= rect.rect.x &&
      localX <= rect.rect.x + rect.rect.width &&
      localY >= rect.rect.y &&
      localY <= rect.rect.y + rect.rect.height
    )
  })
}

type PagePointerInteractionContext = PageRectHitTestContext & {
  readonly tool: ReaderSelectionTool | undefined
  readonly runtimeLinkedData: ReaderLinkedSelectionData
  readonly selectedRectId: string | null | undefined
  readonly selectedRectPopoverOwnerRuntimeId: string | null
  readonly onSelectRect: ((id: string | null) => void) | undefined
  readonly handleLinkedSelectRange: (id: string | null) => void
}

const handlePagePointerDown = (
  event: React.PointerEvent<HTMLDivElement>,
  context: PagePointerInteractionContext
): void => {
  if (context.tool !== 'rect' || event.button !== 0) return
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('button, input, [role="toolbar"]')
  ) {
    return
  }

  const touchedRangeId = findTouchedRangeIdByPoint(
    context.runtimeLinkedData,
    event.clientX,
    event.clientY,
    [event.currentTarget]
  )
  if (touchedRangeId) {
    event.preventDefault()
    event.stopPropagation()
    if (context.selectedRectId !== null) context.onSelectRect?.(null)
    context.handleLinkedSelectRange(
      touchedRangeId === context.runtimeLinkedData.selectedRangeId
        ? null
        : touchedRangeId
    )
    return
  }

  const touchedRect = findTouchedRect(event.currentTarget, event, context)
  if (touchedRect) {
    event.preventDefault()
    event.stopPropagation()
    if (context.runtimeLinkedData.selectedRangeId !== null) {
      context.handleLinkedSelectRange(null)
    }
    context.onSelectRect?.(
      touchedRect.id === context.selectedRectId ? null : touchedRect.id
    )
    return
  }

  if (
    context.selectedRectId &&
    context.selectedRectPopoverOwnerRuntimeId !== context.shellSelectionId
  ) {
    context.onSelectRect?.(null)
  }
}

const handlePageClick = (
  event: React.MouseEvent<HTMLDivElement>,
  context: PagePointerInteractionContext
): void => {
  if (context.tool !== 'rect' || event.button !== 0) return
  if (
    findTouchedRangeIdByPoint(
      context.runtimeLinkedData,
      event.clientX,
      event.clientY,
      [event.currentTarget]
    ) ||
    findTouchedRect(event.currentTarget, event, context)
  ) {
    event.preventDefault()
    event.stopPropagation()
  }
}

function IntermediateDocumentPages({
  popoverContainerRef,
  pageNumbers,
  hiddenPageNumbers,
  fontScale,
  edgeCrop,
  edgeCropEditing,
  realEdgeCrop,
  onEdgeCropApply,
  onEdgeCropHidePage,
  setPageRef,
  setTextRef,
  useVirtualPaper,
  runtimePageSelectionId,
  pageSizesByPageNumber,
  flowLayoutPages,
  orderedContentByPageNumber,
  textsByPageNumber,
  paragraphsByPageNumber,
  ocrTextsByPageNumber,
  ocrLoadingPages,
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
  showSelectionMagnifier,
  overlayRectType,
  effectiveSelectedRangeId,
  selectionPopover,
  highlightPopover,
  rectPopover,
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
  paintingControllerData,
  onPaintingControllerDataChange,
  pagePaintings,
  onPagePaintingChange,
  drawingScale,
  cancelDrawingOnMultiTouch,
  readerScale,
  popoverRelative
}: IntermediateDocumentPagesProps) {
  // popover 归属计算：仅拥有「选中 range 的 start endpoint」所在页面的 Selection
  // 实例可以渲染 popover，其余页面传入 undefined。
  const selectedRangePopoverOwnerRuntimeId = useMemo(() => {
    const selectedId = runtimeLinkedData.selectedRangeId
    if (!selectedId) {
      return null
    }
    const selectedRange = runtimeLinkedData.items.find(
      (range) => range.id === selectedId
    )
    return selectedRange ? selectedRange.start.selectionId : null
  }, [runtimeLinkedData.selectedRangeId, runtimeLinkedData.items])
  const selectedRectPopoverOwnerRuntimeId = useMemo(() => {
    if (!selectedRectId) return null
    return (
      rects?.find((rect) => rect.id === selectedRectId)?.selectionId ?? null
    )
  }, [rects, selectedRectId])
  const popoverOwnerRuntimeId = selectedRectId
    ? selectedRectPopoverOwnerRuntimeId
    : selectedRangePopoverOwnerRuntimeId

  // onSelectionStart 仅在调用方提供 prop 时启用；
  // onSelectionEnd 当调用方提供 prop 或 autoHighlight 时启用。
  const selectionStartHandler = onSelectionStartProp
    ? handleSelectionStart
    : undefined
  const selectionEndHandler =
    onSelectionEndProp || autoHighlight ? handleSelectionEnd : undefined
  const previewPageWidth = pageNumbers.reduce((widestWidth, pageNumber) => {
    const pageSize = getCachedPageSize(pageSizesByPageNumber, pageNumber)
    const cropGeometry = getPageCropGeometry(
      pageSize,
      resolvePageEdgeCrop(edgeCrop, pageNumber)
    )

    return Math.max(widestWidth, cropGeometry.width)
  }, 0)

  return (
    <div
      className='hamster-note-document-gutter'
      style={{
        boxSizing: 'border-box',
        width: 'fit-content',
        margin: useVirtualPaper ? undefined : '0 auto',
        padding: useVirtualPaper
          ? `0 ${(INTERMEDIATE_PAGE_HORIZONTAL_MARGIN / 2) * readerScale}px`
          : 0
      }}
    >
      <div className='hamster-note-document' style={{ width: 'fit-content' }}>
        {pageNumbers.map((pageNumber) => {
          const isPageHidden = hiddenPageNumbers.has(pageNumber)
          const useFlowLayout = flowLayoutPages.has(pageNumber)
          const shellPageSize = getCachedPageSize(
            pageSizesByPageNumber,
            pageNumber
          )
          const cropGeometry = getPageCropGeometry(
            shellPageSize,
            resolvePageEdgeCrop(edgeCrop, pageNumber)
          )
          const pagePreviewScale = previewPageWidth / cropGeometry.width
          const previewPageHeight = cropGeometry.height * pagePreviewScale
          const shellSelectionId = runtimePageSelectionId(pageNumber)
          const publicPageId = `page-${pageNumber}`

          const pageTexts = textsByPageNumber.get(pageNumber)
          const pageOrderedContent = orderedContentByPageNumber.get(pageNumber)
          const pageParagraphs = paragraphsByPageNumber.get(pageNumber)
          const pageBaseImage = baseImagesByPageNumber.get(pageNumber)
          const isPageContentLoaded = pageStatuses.get(pageNumber) === 'loaded'

          // popover gating：owner 为 null（无 selected range）时所有页面均呈现 popover，
          // 否则仅 shellSelectionId === popoverOwnerRuntimeId 的页面拿到真实 popover 内容。
          const isPopoverOwner =
            popoverOwnerRuntimeId === null ||
            popoverOwnerRuntimeId === shellSelectionId
          const pagePopovers = getPagePopovers(isPopoverOwner, {
            containerRef: popoverContainerRef,
            visible: popoverVisible,
            relative: popoverRelative,
            selectionPopover,
            highlightPopover,
            rectPopover,
            selectedRectId
          })

          const pageContent = (
            <IntermediateDocumentPageContent
              pageNumber={pageNumber}
              fontScale={fontScale}
              texts={pageTexts ?? EMPTY_INTERMEDIATE_TEXTS}
              paragraphs={pageParagraphs ?? EMPTY_INTERMEDIATE_PARAGRAPHS}
              orderedContent={pageOrderedContent}
              useFlowLayout={useFlowLayout}
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
          )

          const ocrLoadingBadge = ocrLoadingPages.has(pageNumber) ? (
            <Loading
              className='hamster-reader__intermediate-page-status hamster-reader__intermediate-page-status--ocr'
              cover
              data-testid={`intermediate-page-ocr-loading-${pageNumber}`}
              size='medium'
              text='OCR 识别中…'
            />
          ) : null

          const loadedPageContent = isPageContentLoaded ? (
            <>
              <div
                className={`hamster-reader__intermediate-page-content-scale${
                  useFlowLayout
                    ? ' hamster-reader__intermediate-page-content-scale--flow'
                    : ''
                }`}
                data-testid={`intermediate-page-content-scale-${pageNumber}`}
                style={getContentScaleStyle(
                  useFlowLayout,
                  shellPageSize,
                  cropGeometry,
                  pagePreviewScale,
                  readerScale
                )}
              >
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
                  popover={pagePopovers.selected}
                  selectionPopover={pagePopovers.active}
                  overlayRectType={overlayRectType}
                  tool={tool}
                  rects={rects}
                  selectedRectId={selectedRectId}
                  onCreateRect={onCreateRect}
                  onSelectRect={onSelectRect}
                  onUpdateRect={onUpdateRect}
                  showSelectionMagnifier={showSelectionMagnifier}
                  ref={selectionRefForRuntimeId(shellSelectionId)}
                >
                  {pageContent}
                </HamsterSelection>
                {ocrLoadingBadge}
                {(selectedTool === 'drawing' ||
                  hasDrawingStrokes(pagePaintings?.[publicPageId])) && (
                  <PageDrawingLayer
                    enabled={selectedTool === 'drawing'}
                    pageId={publicPageId}
                    controllerData={paintingControllerData}
                    onControllerDataChange={onPaintingControllerDataChange}
                    value={pagePaintings?.[publicPageId]}
                    canvasScale={drawingScale * pagePreviewScale}
                    cancelDrawingOnMultiTouch={cancelDrawingOnMultiTouch}
                    onChange={
                      onPagePaintingChange
                        ? (nextValue) =>
                            onPagePaintingChange(publicPageId, nextValue)
                        : undefined
                    }
                  />
                )}
              </div>
              {edgeCropEditing ? (
                <EdgeCropOverlay
                  pageNumber={pageNumber}
                  edgeCrop={realEdgeCrop}
                  onApply={onEdgeCropApply}
                  onHidePage={onEdgeCropHidePage}
                />
              ) : null}
            </>
          ) : null
          const pagePointerInteractionContext: PagePointerInteractionContext = {
            shellPageSize,
            cropGeometry,
            rects,
            shellSelectionId,
            tool,
            runtimeLinkedData,
            selectedRectId,
            selectedRectPopoverOwnerRuntimeId,
            onSelectRect,
            handleLinkedSelectRange
          }

          return (
            <div
              key={pageNumber}
              ref={setPageRef(pageNumber)}
              className={`hamster-reader__intermediate-page${
                useFlowLayout ? ' hamster-reader__intermediate-page--flow' : ''
              }`}
              data-testid={`intermediate-page-${pageNumber}`}
              data-page-number={pageNumber}
              data-tool={selectedTool}
              data-selection-id={shellSelectionId}
              data-page-size-unavailable={
                shellPageSize.pageSizeUnavailable ? 'true' : undefined
              }
              onPointerDownCapture={(event) =>
                handlePagePointerDown(event, pagePointerInteractionContext)
              }
              onClickCapture={(event) =>
                handlePageClick(event, pagePointerInteractionContext)
              }
              onPointerUp={() => onRectPointerUp?.(pageNumber)}
              style={getPageShellStyle(
                useFlowLayout,
                previewPageWidth,
                previewPageHeight,
                readerScale
              )}
            >
              <PageVisibilityBoundary
                pageNumber={pageNumber}
                hidden={isPageHidden}
              >
                {loadedPageContent}
              </PageVisibilityBoundary>
            </div>
          )
        })}
      </div>
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

/**
 * 根据触点坐标在 linked ranges 中查找被点中的高亮 range。
 * 将坐标转换到对应页面的本地坐标系后，再与 range 的 rects 做命中检测。
 */
function findTouchedRangeIdByPoint(
  linkedData: ReaderLinkedSelectionData,
  clientX: number,
  clientY: number,
  selectionContainers: HTMLElement[]
): string | null {
  for (const range of linkedData.items) {
    const rectType =
      range.overlayRectType ?? linkedData.overlayRectType ?? 'percent'
    const touchedRange = Object.entries(range.rectsBySelectionId).some(
      ([selectionId, rects]) => {
        const container = selectionContainers.find(
          (element) => element.dataset.selectionId === selectionId
        )
        if (!container) return false

        const pageBounds = container.getBoundingClientRect()
        if (pageBounds.width <= 0 || pageBounds.height <= 0) return false
        if (
          clientX < pageBounds.left ||
          clientX > pageBounds.right ||
          clientY < pageBounds.top ||
          clientY > pageBounds.bottom
        ) {
          return false
        }

        const pageContentScale = container.querySelector<HTMLElement>(
          '.hamster-reader__intermediate-page-content-scale'
        )
        const contentBounds = pageContentScale?.getBoundingClientRect()
        const bounds =
          contentBounds && contentBounds.width > 0 && contentBounds.height > 0
            ? contentBounds
            : pageBounds
        const sourceWidth =
          pageContentScale?.clientWidth ||
          Number.parseFloat(pageContentScale?.style.width ?? '') ||
          bounds.width
        const sourceHeight =
          pageContentScale?.clientHeight ||
          Number.parseFloat(pageContentScale?.style.height ?? '') ||
          bounds.height

        const localX =
          rectType === 'percent'
            ? ((clientX - bounds.left) / bounds.width) * 100
            : ((clientX - bounds.left) / bounds.width) * sourceWidth
        const localY =
          rectType === 'percent'
            ? ((clientY - bounds.top) / bounds.height) * 100
            : ((clientY - bounds.top) / bounds.height) * sourceHeight
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
      return range.id
    }
  }
  return null
}

/**
 * 判断触点是否落在已渲染的高亮 DOM 元素上。
 * 用于在没找到 linked range 命中时，兜底决定是否取消当前选中的高亮。
 */
function isPointOnHighlightElement(
  rootElement: Element,
  clientX: number,
  clientY: number
): boolean {
  return Array.from(
    rootElement.querySelectorAll(
      '.hsn-selection-rect--highlight, .hsn-selection-rect--selected, .hsn-selection-percent-rect-highlight'
    )
  ).some((element) => {
    const rect = element.getBoundingClientRect()
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    )
  })
}

interface TouchTapStart {
  pointerId: number
  clientX: number
  clientY: number
  moved: boolean
}

/**
 * 判断一次 touch pointerup 是否应该被忽略：不是有效的轻触、或当前正在拖拽选区/创建 range。
 */
function shouldIgnoreTouchPointerUp(
  touchStart: TouchTapStart | null,
  event: React.PointerEvent<HTMLDivElement>,
  linkedData: ReaderLinkedSelectionData
): boolean {
  return (
    !touchStart ||
    touchStart.moved ||
    event.pointerType !== 'touch' ||
    event.pointerId !== touchStart.pointerId ||
    Math.abs(event.clientX - touchStart.clientX) > 4 ||
    Math.abs(event.clientY - touchStart.clientY) > 4 ||
    Boolean(linkedData.activeRange) ||
    Boolean(linkedData.draggingRange) ||
    Boolean(linkedData.selectingText)
  )
}

/**
 * 封装高亮相关逻辑：定位当前活跃选区对应的 upstream Selection ref，
 * 以及将原生选区/活跃 range 确认为持久高亮。抽出为独立 hook 以降低 ViewerContent 的认知复杂度。
 */
function useSelectionHighlight(
  pageNumbers: number[],
  runtimePageSelectionId: (pageNumber: number) => string,
  selectionRefsByRuntimeIdRef: React.MutableRefObject<
    Map<string, SelectionRef>
  >,
  runtimeLinkedDataRef: React.MutableRefObject<ReaderLinkedSelectionData>,
  lastActiveRangeRef: React.MutableRefObject<ReaderSelectionRange | null>,
  beginLinkedHighlightOperation: () => PendingLinkedHighlightOperation,
  handleLinkedDataChange: (data: ReaderLinkedSelectionData) => void,
  handleLinkedSelect: (range: ReaderSelectionRange) => void,
  handleLinkedSelectRange: (id: string | null) => void,
  schedulePendingLinkedHighlightCleanup: (
    operation: PendingLinkedHighlightOperation
  ) => void,
  activeRangeProp: ReaderSelectionRange | null | undefined
) {
  const getFirstVisibleSelectionRef = useCallback(() => {
    for (const pageNumber of pageNumbers) {
      const selectionId = runtimePageSelectionId(pageNumber)
      const selectionRef = selectionRefsByRuntimeIdRef.current.get(selectionId)
      if (selectionRef) return selectionRef
    }

    return undefined
  }, [pageNumbers, runtimePageSelectionId, selectionRefsByRuntimeIdRef])

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
  }, [runtimePageSelectionId, selectionRefsByRuntimeIdRef])

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
  }, [runtimeLinkedDataRef, selectionRefsByRuntimeIdRef])

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
    const currentActiveRange = runtimeLinkedDataRef.current.activeRange
    const activeRange = currentActiveRange ?? lastActiveRangeRef.current
    const activeSelectionRef = getActiveSelectionRef()
    const nativeSelectionText = window.getSelection()?.toString() ?? ''
    const directActiveRange =
      nativeSelectionText.length === 0 &&
      Boolean(activeRange) &&
      (currentActiveRange === null || activeRange !== activeRangeProp)
    try {
      if (directActiveRange && activeRange) {
        if (
          runtimeLinkedDataRef.current.items.some(
            (item) => item.id === activeRange.id
          )
        ) {
          lastActiveRangeRef.current = null
          if (currentActiveRange) {
            const nextLinkedData = {
              ...runtimeLinkedDataRef.current,
              selectedRangeId: activeRange.id,
              activeRange: null
            }
            runtimeLinkedDataRef.current = nextLinkedData
            handleLinkedDataChange(nextLinkedData)
          }
          return
        }

        const nextLinkedData = {
          ...runtimeLinkedDataRef.current,
          items: [...runtimeLinkedDataRef.current.items, activeRange],
          selectedRangeId: activeRange.id,
          activeRange: null
        }
        lastActiveRangeRef.current = null
        runtimeLinkedDataRef.current = nextLinkedData
        handleLinkedDataChange(nextLinkedData)
        handleLinkedSelect(activeRange)
        handleLinkedSelectRange(activeRange.id)
        return
      }

      if (nativeSelectionText.length > 0) {
        lastActiveRangeRef.current = null
      }
      activeSelectionRef?.highlight()
    } finally {
      schedulePendingLinkedHighlightCleanup(operation)
    }
  }, [
    activeRangeProp,
    beginLinkedHighlightOperation,
    getActiveSelectionRef,
    handleLinkedDataChange,
    handleLinkedSelect,
    handleLinkedSelectRange,
    lastActiveRangeRef,
    runtimeLinkedDataRef,
    schedulePendingLinkedHighlightCleanup
  ])

  return { getActiveSelectionRef, highlightSelection }
}

/**
 * 根据当前工具与触屏模式返回 VirtualPaper 允许的交互集合。
 */
function resolveEnabledInteractions(
  selectedTool: ReaderPageTool | undefined,
  touchPanMode: 'single-finger' | 'two-finger' | undefined,
  edgeCropEditing: boolean | undefined
): VirtualPaperInteractionMode[] {
  return selectedTool === 'drawing' ||
    selectedTool === 'rect-selection' ||
    touchPanMode === 'two-finger' ||
    edgeCropEditing
    ? TWO_FINGER_TOUCH_ENABLED_INTERACTIONS
    : DEFAULT_ENABLED_INTERACTIONS
}

/**
 * 在独立垂直边距未指定时回退到对称边距。
 */
function resolveContainMarginY(
  containMarginTop: number | undefined,
  containMarginBottom: number | undefined,
  containMarginY: number | undefined,
  scale: number
): number | undefined {
  if (containMarginTop !== undefined || containMarginBottom !== undefined) {
    return undefined
  }
  if (containMarginY === undefined) return undefined
  return containMarginY / scale
}

/**
 * 计算 VirtualPaper 容器样式：用缩放补偿保证视觉 padding 恒定。
 */
function buildContainerStyle(
  containMarginTop: number | undefined,
  containMarginBottom: number | undefined,
  scale: number
): React.CSSProperties {
  return {
    // container div 被 VirtualPaper 的 transform: scale(s) 缩放，
    // 直接设置 padding 会被 zoom 放大/缩小。
    // 除以 scale 补偿：视觉 padding = (margin / scale) * scale = margin（恒定）
    paddingTop:
      containMarginTop !== undefined ? containMarginTop / scale : undefined,
    paddingBottom:
      containMarginBottom !== undefined
        ? containMarginBottom / scale
        : undefined
  }
}

/**
 * 判断一次 touch pointerdown 是否应该被忽略：非 touch、非主指针、或当前处于 drawing 模式。
 */
function shouldIgnoreTouchPointerDown(
  event: React.PointerEvent<HTMLDivElement>,
  selectedTool: ReaderPageTool | undefined
): boolean {
  return (
    event.pointerType !== 'touch' ||
    !event.isPrimary ||
    selectedTool === 'drawing'
  )
}

/**
 * 处理 touch 轻触选高亮的逻辑：记录 pointerdown、跟踪移动、在 pointerup 时判断
 * 是否点中了已有高亮并切换选中态。抽出为独立 hook 以降低 ViewerContent 的认知复杂度。
 */
function useTouchTapSelection(
  selectedTool: ReaderPageTool | undefined,
  runtimeLinkedDataRef: React.MutableRefObject<ReaderLinkedSelectionData>,
  handlePageLinkedSelectRange: (id: string | null) => void
) {
  const touchTapStartRef = useRef<TouchTapStart | null>(null)

  const handleTouchPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (shouldIgnoreTouchPointerDown(event, selectedTool)) {
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
        shouldIgnoreTouchPointerUp(
          touchStart,
          event,
          runtimeLinkedDataRef.current
        )
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
      const touchedRangeId = findTouchedRangeIdByPoint(
        linkedData,
        event.clientX,
        event.clientY,
        selectionContainers
      )
      if (touchedRangeId) {
        if (touchedRangeId !== linkedData.selectedRangeId) {
          handlePageLinkedSelectRange(touchedRangeId)
        }
        return
      }

      const touchedHighlight = isPointOnHighlightElement(
        event.currentTarget,
        event.clientX,
        event.clientY
      )
      if (!touchedHighlight) {
        handlePageLinkedSelectRange(null)
      }
    },
    [handlePageLinkedSelectRange, runtimeLinkedDataRef]
  )

  const handleTouchPointerCancel = useCallback(() => {
    touchTapStartRef.current = null
  }, [])

  return {
    handleTouchPointerDown,
    handleTouchPointerMove,
    handleTouchPointerUp,
    handleTouchPointerCancel
  }
}

/**
 * 监听文本选区相关的 pointer/selection 事件，实现拖拽过程中离开文字时冻结原生选区、
 * 重新进入文字时恢复的逻辑。抽出为独立 hook 以降低 ViewerContent 的认知复杂度。
 */
function useSelectionPointerGuard({
  viewerRootElement,
  selectedTool,
  runtimeLinkedDataRef,
  onSelectingTextEnd
}: {
  readonly viewerRootElement: HTMLDivElement | null
  readonly selectedTool: ReaderPageTool | undefined
  readonly runtimeLinkedDataRef: React.MutableRefObject<ReaderLinkedSelectionData>
  readonly onSelectingTextEnd: (next: LinkedSelectionData) => void
}): void {
  const onSelectingTextEndRef = useRef(onSelectingTextEnd)
  onSelectingTextEndRef.current = onSelectingTextEnd
  const lastValidSelectionRangeRef = useRef<Range | null>(null)
  const selectionFrozenRef = useRef(false)
  const restoringSelectionRef = useRef(false)
  const delayedPointerUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
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

      const currentLinkedData = runtimeLinkedDataRef.current
      if (currentLinkedData.selectingText) {
        onSelectingTextEndRef.current({
          ...currentLinkedData,
          selectingText: false
        })
      }
    }

    const cancelDelayedPointerUp = () => {
      if (delayedPointerUpTimerRef.current === null) return
      clearTimeout(delayedPointerUpTimerRef.current)
      delayedPointerUpTimerRef.current = null
    }

    const finishTouchSelectionDrag = () => {
      finishSelectionDrag()
      cancelDelayedPointerUp()
      delayedPointerUpTimerRef.current = setTimeout(() => {
        delayedPointerUpTimerRef.current = null
        const shouldDispatchPointerUp =
          runtimeLinkedDataRef.current.draggingRange?.type ===
          'active-selection'
        const PointerEventConstructor = ownerDocument.defaultView?.PointerEvent
        if (shouldDispatchPointerUp && PointerEventConstructor) {
          ownerDocument.dispatchEvent(
            new PointerEventConstructor('pointerup', {
              bubbles: true,
              isPrimary: true,
              pointerType: 'touch'
            })
          )
        }
      }, 0)
    }

    const cancelTouchSelectionDrag = () => {
      finishSelectionDrag()
      cancelDelayedPointerUp()
    }

    ownerDocument.addEventListener(
      'selectionchange',
      handleSelectionChange,
      true
    )
    ownerDocument.addEventListener('pointermove', guardPointerMove, true)
    ownerDocument.addEventListener('pointerup', finishSelectionDrag, true)
    ownerDocument.addEventListener('pointercancel', finishSelectionDrag, true)
    ownerDocument.addEventListener('touchend', finishTouchSelectionDrag, true)
    ownerDocument.addEventListener(
      'touchcancel',
      cancelTouchSelectionDrag,
      true
    )
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
      ownerDocument.removeEventListener(
        'touchend',
        finishTouchSelectionDrag,
        true
      )
      ownerDocument.removeEventListener(
        'touchcancel',
        cancelTouchSelectionDrag,
        true
      )
      selectionFrozenRef.current = false
      lastValidSelectionRangeRef.current = null
      cancelDelayedPointerUp()
    }
  }, [runtimeLinkedDataRef, selectedTool, viewerRootElement])
}

function syncLastActiveRange(
  selectionScope: symbol,
  activeRange: ReaderSelectionRange | null | undefined,
  lastActiveRangeRef: React.MutableRefObject<ReaderSelectionRange | null>,
  lastActiveRangeScopeRef: React.MutableRefObject<symbol>
) {
  if (lastActiveRangeScopeRef.current !== selectionScope) {
    lastActiveRangeScopeRef.current = selectionScope
    lastActiveRangeRef.current = activeRange ?? null
  } else if (activeRange) {
    lastActiveRangeRef.current = activeRange
  }
}

function getEffectiveEdgeCrop(
  edgeCropEditing: boolean | undefined,
  edgeCrop: ReaderPageEdgeCrop | undefined
) {
  return edgeCropEditing ? undefined : edgeCrop
}

function resolveHighlightPopover(
  highlightPopover: ReaderHighlightPopover | undefined,
  selectedHighlight: ReaderSelectionRange | null,
  selectionPopover: ReactNode
): ReactNode {
  if (typeof highlightPopover !== 'function') {
    return highlightPopover ?? selectionPopover
  }

  return selectedHighlight
    ? highlightPopover(selectedHighlight)
    : selectionPopover
}

function useNativeLayoutViewport(
  useVirtualPaper: boolean,
  viewerRootElement: HTMLDivElement | null,
  touchPanMode: ReaderTouchPanMode | undefined,
  stylusOnly: boolean
) {
  useEffect(() => {
    if (useVirtualPaper || !viewerRootElement) return
    const viewport = viewerRootElement.querySelector<HTMLElement>(
      '.hamster-reader__native-layout-viewport'
    )
    if (!viewport) return

    let previousCentroid: {
      readonly x: number
      readonly y: number
    } | null = null
    let activeTouchPointer: {
      readonly id: number
      readonly x: number
      readonly y: number
    } | null = null
    const getGesturePoint = (event: TouchEvent) => {
      if (event.touches.length < 2) return null
      const firstTouch = event.touches[0]
      const secondTouch = event.touches[1]
      if (!firstTouch || !secondTouch) return null
      return {
        x: (firstTouch.clientX + secondTouch.clientX) / 2,
        y: (firstTouch.clientY + secondTouch.clientY) / 2
      }
    }
    const handleTouchStart = (event: TouchEvent) => {
      if (stylusOnly) return
      previousCentroid = getGesturePoint(event)
    }
    const handleTouchMove = (event: TouchEvent) => {
      if (stylusOnly) return
      const nextCentroid = getGesturePoint(event)
      if (!nextCentroid) {
        previousCentroid = null
        return
      }
      event.preventDefault()
      if ((stylusOnly || touchPanMode === 'two-finger') && previousCentroid) {
        viewport.scrollLeft += previousCentroid.x - nextCentroid.x
        viewport.scrollTop += previousCentroid.y - nextCentroid.y
      }
      previousCentroid = nextCentroid
    }
    const handleTouchEnd = (event: TouchEvent) => {
      if (stylusOnly) return
      previousCentroid = getGesturePoint(event)
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!stylusOnly || event.pointerType !== 'touch' || !event.isPrimary) return
      activeTouchPointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY
      }
      viewport.setPointerCapture(event.pointerId)
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || event.pointerId !== activeTouchPointer?.id) {
        return
      }
      event.preventDefault()
      viewport.scrollLeft += activeTouchPointer.x - event.clientX
      viewport.scrollTop += activeTouchPointer.y - event.clientY
      activeTouchPointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY
      }
    }
    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== activeTouchPointer?.id) return
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId)
      }
      activeTouchPointer = null
    }
    const preventGestureZoom = (event: Event) => event.preventDefault()
    viewport.addEventListener('touchstart', handleTouchStart)
    viewport.addEventListener('touchmove', handleTouchMove, {
      passive: false
    })
    viewport.addEventListener('touchend', handleTouchEnd)
    viewport.addEventListener('touchcancel', handleTouchEnd)
    viewport.addEventListener('pointerdown', handlePointerDown, true)
    viewport.addEventListener('pointermove', handlePointerMove, true)
    viewport.addEventListener('pointerup', handlePointerEnd, true)
    viewport.addEventListener('pointercancel', handlePointerEnd, true)
    viewport.addEventListener('gesturestart', preventGestureZoom)
    viewport.addEventListener('gesturechange', preventGestureZoom)

    return () => {
      viewport.removeEventListener('touchstart', handleTouchStart)
      viewport.removeEventListener('touchmove', handleTouchMove)
      viewport.removeEventListener('touchend', handleTouchEnd)
      viewport.removeEventListener('touchcancel', handleTouchEnd)
      viewport.removeEventListener('pointerdown', handlePointerDown, true)
      viewport.removeEventListener('pointermove', handlePointerMove, true)
      viewport.removeEventListener('pointerup', handlePointerEnd, true)
      viewport.removeEventListener('pointercancel', handlePointerEnd, true)
      viewport.removeEventListener('gesturestart', preventGestureZoom)
      viewport.removeEventListener('gesturechange', preventGestureZoom)
    }
  }, [stylusOnly, touchPanMode, useVirtualPaper, viewerRootElement])
}

type NativeLayoutViewportProps = Readonly<{
  pagesNode: ReactNode
  transform: VirtualPaperTransform
  containMarginX: number | undefined
  containMarginTop: number | undefined
  containMarginBottom: number | undefined
  touchPanMode: ReaderTouchPanMode | undefined
  stylusOnly: boolean
  measurementKey: symbol
}>

function NativeLayoutViewport({
  pagesNode,
  transform,
  containMarginX,
  containMarginTop,
  containMarginBottom,
  touchPanMode,
  stylusOnly,
  measurementKey
}: NativeLayoutViewportProps) {
  const [useTransformScale, setUseTransformScale] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const measuredCycleRef = useRef<symbol | null>(null)
  const [intrinsicSize, setIntrinsicSize] =
    useState<NativeLayoutIntrinsicSize | null>(null)

  useEffect(() => {
    setUseTransformScale(
      typeof navigator !== 'undefined' && isIPadOS(navigator)
    )
  }, [])

  useLayoutEffect(() => {
    if (!useTransformScale || !containerRef.current) return
    const container = containerRef.current
    if (measuredCycleRef.current !== measurementKey) {
      measuredCycleRef.current = measurementKey
      setIntrinsicSize(null)
    }
    const measure = () => {
      const nextSize = {
        width: Math.max(container.scrollWidth, container.offsetWidth),
        height: Math.max(container.scrollHeight, container.offsetHeight)
      }
      if (nextSize.width <= 0 || nextSize.height <= 0) return
      setIntrinsicSize((currentSize) =>
        currentSize?.width === nextSize.width &&
        currentSize.height === nextSize.height
          ? currentSize
          : nextSize
      )
    }
    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(container)
    let documentGutter: HTMLElement | null = null
    const bindDocumentGutter = () => {
      const nextDocumentGutter = container.querySelector<HTMLElement>(
        '.hamster-note-document-gutter'
      )
      if (nextDocumentGutter === documentGutter) {
        measure()
        return
      }
      if (documentGutter) resizeObserver.unobserve(documentGutter)
      documentGutter = nextDocumentGutter
      if (documentGutter) resizeObserver.observe(documentGutter)
      measure()
    }
    bindDocumentGutter()
    const mutationObserver = new MutationObserver(bindDocumentGutter)
    mutationObserver.observe(container, { childList: true, subtree: true })
    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [measurementKey, useTransformScale])

  const containerStyle = {
    ...buildContainerStyle(
      containMarginTop,
      containMarginBottom,
      transform.scale
    ),
    paddingLeft:
      containMarginX === undefined
        ? undefined
        : containMarginX / transform.scale,
    paddingRight:
      containMarginX === undefined
        ? undefined
        : containMarginX / transform.scale,
    ...resolveNativeLayoutScaleStyle(transform.scale, useTransformScale)
  }

  const extent = intrinsicSize
    ? computeNativeLayoutTransformExtent(intrinsicSize, transform.scale)
    : null

  return (
    <div
      className='virtual-paper-wrapper hamster-reader__native-layout-viewport'
      data-testid='native-layout-viewport'
      style={{
        overflow: 'auto',
        touchAction: resolveNativeLayoutTouchAction(touchPanMode, stylusOnly)
      }}
    >
      {useTransformScale ? (
        <div
          data-testid='native-layout-transform-extent'
          style={{
            display: 'flex',
            justifyContent: 'center',
            minWidth: '100%',
            minHeight: '100%',
            width: extent?.width,
            height: extent?.height
          }}
        >
          <div
            data-testid='native-layout-transform-clip'
            style={{
              flex: '0 0 auto',
              overflow: 'clip',
              position: 'relative',
              width: extent?.width,
              height: extent?.height
            }}
          >
            <div
              className='virtual-paper-container hamster-reader__native-layout-container'
              ref={containerRef}
              style={{
                ...containerStyle,
                left: 0,
                minHeight: 0,
                minWidth: 0,
                position: 'absolute',
                top: 0
              }}
            >
              {pagesNode}
            </div>
          </div>
        </div>
      ) : (
        <div
          className='virtual-paper-container hamster-reader__native-layout-container'
          style={containerStyle}
        >
          {pagesNode}
        </div>
      )}
    </div>
  )
}

function LayoutZoomIndicator({
  useVirtualPaper,
  percent
}: Readonly<{
  useVirtualPaper: boolean
  percent: number | null
}>) {
  if (!useVirtualPaper || percent === null) return null

  return (
    <output
      aria-hidden='true'
      className='hamster-reader__layout-zoom-indicator'
      data-testid='layout-zoom-indicator'
    >
      {percent}%
    </output>
  )
}

function ViewerContent({
  rootClassName,
  viewerRootRef,
  selectionScope,
  pageNumbers,
  hiddenPageNumbers,
  fontScale,
  edgeCrop,
  edgeCropEditing,
  onEdgeCropApply,
  onEdgeCropHidePage,
  pageSizesByPageNumber,
  flowLayoutPages,
  virtualPaperTransform,
  useVirtualPaper,
  nativeLayoutZoom,
  committedReaderScale,
  scaleRange,
  onInitialFitScale,
  onScrollToRange,
  onScrollToRect,
  onScrollToPosition,
  handleVirtualPaperTransformChange,
  handleVirtualPaperTransformChangeEnd,
  effectiveSelectedRangeId,
  selectedHighlight,
  storedRanges,
  effectiveRanges,
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
  showSelectionMagnifier,
  selectionPopover,
  highlightPopover,
  rectPopover,
  onCommentHighlight,
  onDragHighlight,
  autoHighlight,
  overlayRectType,
  selectionRef,
  tool,
  rects,
  selectedRectId,
  onCreateRect,
  onSelectRect,
  onUpdateRect,
  onRemoveRange,
  onRemoveRect,
  annotationHistoryController,
  onClearAnnotationHistory,
  onRunAnnotationHistory,
  setPageRef,
  setTextRef,
  textsByPageNumber,
  orderedContentByPageNumber,
  paragraphsByPageNumber,
  ocrTextsByPageNumber,
  ocrLoadingPages,
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
  paintingControllerData,
  onPaintingControllerDataChange,
  pagePaintings,
  onPagePaintingChange,
  drawingScale,
  showPageBrowser,
  previewEnabled,
  onPageBrowserClose,
  onPageBrowserVisibilityChange,
  onNavigateToPage,
  themeColor,
  visiblePageNumbers,
  commentCountByRangeId,
  commentCountByRectId,
  bookmarks,
  currentBookmark,
  currentPageNumber,
  activeBookmarkKey,
  onNavigateToBookmark,
  onDragBookmark,
  onToggleBookmark,
  bookmarkedPageNumbers,
  onTogglePageBookmark,
  onViewportPositionChange,
  popoverRelative
}: ViewerContentProps) {
  // --- 边缘裁切编辑模式 ---
  // 编辑模式下，页面以未裁剪（原始）尺寸显示，叠加可拖拽的裁切线
  // effectiveEdgeCrop 在编辑时为 undefined，使 resolvePageEdgeCrop 返回零裁剪
  const effectiveEdgeCrop = getEffectiveEdgeCrop(edgeCropEditing, edgeCrop)

  const [viewerRootElement, setViewerRootElement] =
    useState<HTMLDivElement | null>(null)
  const [measuredContentSize, setMeasuredContentSize] =
    useState<ScopedContentSize | null>(null)
  const popoverContainerRef = useRef<HTMLElement | null>(null)
  const stylusOnly = paintingControllerData.stylusMode === true
  useNativeLayoutViewport(
    useVirtualPaper,
    viewerRootElement,
    touchPanMode,
    stylusOnly
  )
  const selectionRefsByRuntimeIdRef = useRef(new Map<string, SelectionRef>())
  const selectionRefSettersByRuntimeIdRef = useRef(
    new Map<string, (node: SelectionRef | null) => void>()
  )
  const syncForwardedSelectionRefRef = useRef<() => void>(() => {})
  const runtimeLinkedDataRef = useRef(runtimeLinkedData)
  runtimeLinkedDataRef.current = runtimeLinkedData
  const lastActiveRangeRef = useRef<ReaderSelectionRange | null>(
    runtimeLinkedData.activeRange ?? null
  )
  const lastActiveRangeScopeRef = useRef(selectionScope)
  syncLastActiveRange(
    selectionScope,
    runtimeLinkedData.activeRange,
    lastActiveRangeRef,
    lastActiveRangeScopeRef
  )

  // --- Portal popover 可见性控制 ---
  // VirtualPaper pan/zoom 期间隐藏 popover，transform 结束后 500ms debounce 再显示
  const [popoverVisible, setPopoverVisible] = useState(true)
  const {
    isActive: isReadingProgressMoving,
    signalActivity: signalReadingProgressActivity
  } = useReadingProgressActivity()
  const onViewportPositionChangeRef = useRef(onViewportPositionChange)
  onViewportPositionChangeRef.current = onViewportPositionChange
  const signalReadingProgressActivityRef = useRef(signalReadingProgressActivity)
  signalReadingProgressActivityRef.current = signalReadingProgressActivity
  useEffect(() => {
    if (!viewerRootElement) return

    const scrollViewport = viewerRootElement.querySelector<HTMLElement>(
      '.virtual-paper-wrapper'
    )
    if (!scrollViewport) return

    const ownerWindow = scrollViewport.ownerDocument.defaultView
    let frameId: number | null = null
    const cancelScheduledViewportPositionChange = () => {
      if (frameId === null || !ownerWindow) return

      ownerWindow.cancelAnimationFrame(frameId)
      frameId = null
    }
    const scheduleViewportPositionChange = () => {
      if (frameId !== null) return

      if (!ownerWindow) {
        onViewportPositionChangeRef.current()
        return
      }
      frameId = ownerWindow.requestAnimationFrame(() => {
        frameId = null
        onViewportPositionChangeRef.current()
      })
    }
    const usesScrollEndForPosition =
      !useVirtualPaper && 'onscrollend' in scrollViewport
    const handleViewportScroll = () => {
      signalReadingProgressActivityRef.current()
      if (usesScrollEndForPosition) {
        cancelScheduledViewportPositionChange()
      }
      if (!usesScrollEndForPosition) scheduleViewportPositionChange()
    }

    scrollViewport.addEventListener('scroll', handleViewportScroll, {
      passive: true
    })
    if (usesScrollEndForPosition) {
      scrollViewport.addEventListener(
        'scrollend',
        scheduleViewportPositionChange,
        { passive: true }
      )
    }
    return () => {
      scrollViewport.removeEventListener('scroll', handleViewportScroll)
      if (usesScrollEndForPosition) {
        scrollViewport.removeEventListener(
          'scrollend',
          scheduleViewportPositionChange
        )
      }
      cancelScheduledViewportPositionChange()
    }
  }, [useVirtualPaper, viewerRootElement])
  const [activeZoomPercent, setActiveZoomPercent] = useState<number | null>(
    null
  )
  const lastObservedTransformScaleRef = useRef(virtualPaperTransform.scale)
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

  // VirtualPaper 1.0.0 的 readerMode 首次布局就需要正数 contentSize。
  // 固定版式可由页面元数据准确估算；flow 页面先使用原始页高兜底，随后由
  // ResizeObserver 用真实 DOM 高度替换，避免自动排版内容被视口高度截断。
  // 宽度额外加上 INTERMEDIATE_PAGE_HORIZONTAL_MARGIN（水平留白），保证首次
  // 测量前文档内容不会溢出容器、再次引入不对称的 scrollWidth。
  const fallbackContentSize = useMemo(() => {
    const previewPageWidth = pageNumbers.reduce((widestWidth, pageNumber) => {
      const pageSize = getCachedPageSize(pageSizesByPageNumber, pageNumber)
      const cropGeometry = getPageCropGeometry(
        pageSize,
        resolvePageEdgeCrop(effectiveEdgeCrop, pageNumber)
      )
      return Math.max(widestWidth, cropGeometry.width)
    }, 0)
    const contentWidth =
      Math.max(
        1,
        previewPageWidth,
        flowLayoutPages.size > 0 ? FLOW_LAYOUT_PAGE_WIDTH : 0
      ) + INTERMEDIATE_PAGE_HORIZONTAL_MARGIN
    const pagesHeight = pageNumbers.reduce((totalHeight, pageNumber) => {
      const pageSize = getCachedPageSize(pageSizesByPageNumber, pageNumber)
      if (flowLayoutPages.has(pageNumber)) {
        return totalHeight + pageSize.height
      }

      const cropGeometry = getPageCropGeometry(
        pageSize,
        resolvePageEdgeCrop(effectiveEdgeCrop, pageNumber)
      )
      return (
        totalHeight +
        cropGeometry.height *
          (Math.max(1, previewPageWidth) / cropGeometry.width)
      )
    }, 0)

    return {
      width: contentWidth,
      height: Math.max(
        1,
        pagesHeight +
          Math.max(0, pageNumbers.length - 1) * INTERMEDIATE_PAGE_GAP
      )
    }
  }, [effectiveEdgeCrop, flowLayoutPages, pageNumbers, pageSizesByPageNumber])
  const activeContentSize =
    measuredContentSize?.selectionScope === selectionScope
      ? measuredContentSize.size
      : fallbackContentSize

  useEffect(() => {
    if (!viewerRootElement) return

    let documentGutterElement: HTMLElement | null = null
    let intrinsicContentWidth: number | null = null

    const measureContent = () => {
      if (!documentGutterElement) return
      // readerMode 提交缩放后，document 的布局宽度会继承 container width。
      // 宽度只采集一次可阻断 contentSize -> container -> document 的反馈放大；
      // 高度继续同步，以覆盖 flow 重排和异步内容加载。
      const measuredWidth =
        Math.max(
          documentGutterElement.scrollWidth,
          documentGutterElement.offsetWidth
        ) / committedReaderScale
      if (intrinsicContentWidth === null && measuredWidth > 0) {
        intrinsicContentWidth = measuredWidth
      }
      const width = intrinsicContentWidth
      const height =
        Math.max(
          documentGutterElement.scrollHeight,
          documentGutterElement.offsetHeight
        ) / committedReaderScale
      if (width === null || height <= 0) return

      setMeasuredContentSize((currentSize) =>
        currentSize?.selectionScope === selectionScope &&
        currentSize.size.width === width &&
        currentSize.size.height === height
          ? currentSize
          : { selectionScope, size: { width, height } }
      )
    }

    const resizeObserver = new ResizeObserver(measureContent)
    const bindDocumentElement = () => {
      const nextDocumentGutterElement =
        viewerRootElement.querySelector<HTMLElement>(
          '.hamster-note-document-gutter'
        )
      if (nextDocumentGutterElement !== documentGutterElement) {
        resizeObserver.disconnect()
        documentGutterElement = nextDocumentGutterElement
        intrinsicContentWidth = null
        if (documentGutterElement) {
          resizeObserver.observe(documentGutterElement)
        }
      }
      measureContent()
    }

    bindDocumentElement()
    const mutationObserver = new MutationObserver(bindDocumentElement)
    mutationObserver.observe(viewerRootElement, {
      childList: true,
      subtree: true
    })
    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [committedReaderScale, selectionScope, viewerRootElement])

  const { highlightSelection } = useSelectionHighlight(
    pageNumbers,
    runtimePageSelectionId,
    selectionRefsByRuntimeIdRef,
    runtimeLinkedDataRef,
    lastActiveRangeRef,
    beginLinkedHighlightOperation,
    handleLinkedDataChange,
    handleLinkedSelect,
    handleLinkedSelectRange,
    schedulePendingLinkedHighlightCleanup,
    runtimeLinkedData.activeRange
  )

  useEffect(() => {
    const container =
      viewerRootElement?.querySelector<HTMLElement>('.virtual-paper-wrapper') ??
      null
    popoverContainerRef.current = container
    if (!container) return

    const widestPageSize = pageNumbers.reduce<PageSize | null>(
      (widestSize, pageNumber) => {
        if (flowLayoutPages.has(pageNumber)) {
          if (widestSize && widestSize.width >= FLOW_LAYOUT_PAGE_WIDTH) {
            return widestSize
          }
          return {
            width: FLOW_LAYOUT_PAGE_WIDTH,
            height: 0
          }
        }

        const pageSize = pageSizesByPageNumber.get(pageNumber)
        if (!pageSize) return widestSize

        const cropGeometry = getPageCropGeometry(
          pageSize,
          resolvePageEdgeCrop(effectiveEdgeCrop, pageNumber)
        )
        if (widestSize && widestSize.width >= cropGeometry.width) {
          return widestSize
        }
        return {
          width: cropGeometry.width,
          height: cropGeometry.height
        }
      },
      null
    )
    const applyInitialFit = (width: number) => {
      if (!widestPageSize || width <= 0) return false

      onInitialFitScale(
        width /
          (widestPageSize.width +
            (useVirtualPaper ? INTERMEDIATE_PAGE_HORIZONTAL_MARGIN : 0))
      )
      return true
    }

    if (
      useVirtualPaper &&
      applyInitialFit(container.getBoundingClientRect().width)
    ) {
      return () => {
        popoverContainerRef.current = null
      }
    }

    if (!useVirtualPaper && nativeLayoutZoom !== 'fit-width') {
      return () => {
        popoverContainerRef.current = null
      }
    }

    applyInitialFit(container.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (
        entry &&
        applyInitialFit(entry.contentRect.width) &&
        useVirtualPaper
      ) {
        observer.disconnect()
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      popoverContainerRef.current = null
    }
  }, [
    effectiveEdgeCrop,
    flowLayoutPages,
    onInitialFitScale,
    pageNumbers,
    pageSizesByPageNumber,
    nativeLayoutZoom,
    useVirtualPaper,
    viewerRootElement
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
    lastActiveRangeRef.current = null
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
    if (typeof selectionRef === 'function') {
      selectionRef(publicSelectionRef)
    } else if (selectionRef) {
      ;(
        selectionRef as React.MutableRefObject<ReaderSelectionRef | null>
      ).current = publicSelectionRef
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
      if (next.activeRange) {
        lastActiveRangeRef.current = next.activeRange
      } else if (
        lastActiveRangeRef.current &&
        next.items.some((item) => item.id === lastActiveRangeRef.current?.id)
      ) {
        lastActiveRangeRef.current = null
      }
      handleLinkedDataChange(next)
    },
    [handleLinkedDataChange]
  )

  useSelectionPointerGuard({
    viewerRootElement,
    selectedTool,
    runtimeLinkedDataRef,
    onSelectingTextEnd: handlePageLinkedDataChange
  })

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

  const {
    handleTouchPointerDown,
    handleTouchPointerMove,
    handleTouchPointerUp,
    handleTouchPointerCancel
  } = useTouchTapSelection(
    selectedTool,
    runtimeLinkedDataRef,
    handlePageLinkedSelectRange
  )
  const resolveHighlightDragTarget = useCallback(
    (clientX: number, clientY: number) => {
      const linkedData = runtimeLinkedDataRef.current
      if (
        selectedTool === 'drawing' ||
        linkedData.activeRange ||
        linkedData.draggingRange ||
        linkedData.selectingText
      ) {
        return null
      }
      const touchedRangeId = findTouchedRangeIdByPoint(
        linkedData,
        clientX,
        clientY,
        Array.from(
          viewerRootElement?.querySelectorAll<HTMLElement>(
            '.hamster-reader__intermediate-page[data-selection-id]'
          ) ?? []
        )
      )
      return storedRanges.find((range) => range.id === touchedRangeId) ?? null
    },
    [selectedTool, storedRanges, viewerRootElement]
  )
  const {
    activePointerType: highlightDragPointerType,
    suppressNativeSelection,
    handleHighlightPointerDown,
    handleHighlightPointerMove,
    handleHighlightPointerUp,
    handleHighlightPointerCancel
  } = useReaderHighlightDrag({
    viewerRootElement,
    resolveItem: resolveHighlightDragTarget,
    onDragItem: onDragHighlight
  })

  const enabledInteractions = useMemo(() => {
    const interactions = resolveEnabledInteractions(
      selectedTool,
      touchPanMode,
      edgeCropEditing
    )
    return highlightDragPointerType === 'touch'
      ? interactions.filter(
          (mode) =>
            mode !== VirtualPaperInteractionMode.TouchSingleFingerPan &&
            mode !== VirtualPaperInteractionMode.TouchTwoFingerPan
        )
      : interactions
  }, [edgeCropEditing, highlightDragPointerType, selectedTool, touchPanMode])

  const handleViewerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.hamster-reader__reading-progress')
      ) {
        return
      }
      // Viewer 内的新交互代表用户已离开旧的临时选区。高亮按钮通过 portal
      // 渲染在根节点之外，因此点击确认不会经过这里并误删待提交缓存。
      lastActiveRangeRef.current = null
      handleHighlightPointerDown(event)
      handleTouchPointerDown(event)
    },
    [handleHighlightPointerDown, handleTouchPointerDown]
  )

  const handleViewerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.hamster-reader__reading-progress')
      ) {
        return
      }
      handleHighlightPointerMove(event)
      handleTouchPointerMove(event)
    },
    [handleHighlightPointerMove, handleTouchPointerMove]
  )

  const handleViewerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.hamster-reader__reading-progress')
      ) {
        return
      }
      if (!handleHighlightPointerUp(event)) {
        handleTouchPointerUp(event)
      }
    },
    [handleHighlightPointerUp, handleTouchPointerUp]
  )

  const handleViewerPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.hamster-reader__reading-progress')
      ) {
        return
      }
      handleHighlightPointerCancel(event)
      handleTouchPointerCancel()
    },
    [handleHighlightPointerCancel, handleTouchPointerCancel]
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

  const resolvedHighlightPopover = resolveHighlightPopover(
    highlightPopover,
    selectedHighlight,
    selectionPopover
  )
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
  // transform 进行中时立即隐藏 portal popover，静默 500ms 后再显示。
  // change 也安排恢复，兼容首次自动布局缺少 end 回调的情况。
  const handleTransformChangeWithPopover = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      if (
        meta.source !== 'initialPlacement' &&
        nextTransform.scale !== lastObservedTransformScaleRef.current
      ) {
        lastObservedTransformScaleRef.current = nextTransform.scale
        const topWhitespace = containMarginTop ?? containMarginY ?? 0
        const baselineHeight = topWhitespace + activeContentSize.height
        const scaledHeight =
          topWhitespace + activeContentSize.height * nextTransform.scale
        setActiveZoomPercent(Math.round((scaledHeight / baselineHeight) * 100))
      }
      setPopoverVisible(false)
      signalReadingProgressActivity()
      if (popoverDebounceRef.current) {
        clearTimeout(popoverDebounceRef.current)
      }
      popoverDebounceRef.current = setTimeout(() => {
        setPopoverVisible(true)
        popoverDebounceRef.current = null
      }, 500)
      handleVirtualPaperTransformChange(nextTransform, meta)
    },
    [
      activeContentSize.height,
      containMarginTop,
      containMarginY,
      handleVirtualPaperTransformChange,
      signalReadingProgressActivity
    ]
  )

  const handleTransformChangeEndWithPopover = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      lastObservedTransformScaleRef.current = nextTransform.scale
      setActiveZoomPercent(null)
      signalReadingProgressActivity()
      handleVirtualPaperTransformChangeEnd(nextTransform, meta)
      if (popoverDebounceRef.current) {
        clearTimeout(popoverDebounceRef.current)
      }
      popoverDebounceRef.current = setTimeout(() => {
        setPopoverVisible(true)
        popoverDebounceRef.current = null
      }, 500)
    },
    [handleVirtualPaperTransformChangeEnd, signalReadingProgressActivity]
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
      pageNumbers={pageNumbers}
      hiddenPageNumbers={hiddenPageNumbers}
      fontScale={fontScale}
      edgeCrop={effectiveEdgeCrop}
      edgeCropEditing={edgeCropEditing}
      realEdgeCrop={edgeCrop}
      onEdgeCropApply={onEdgeCropApply}
      onEdgeCropHidePage={onEdgeCropHidePage}
      setPageRef={setPageRef}
      setTextRef={setTextRef}
      useVirtualPaper={useVirtualPaper}
      runtimePageSelectionId={runtimePageSelectionId}
      pageSizesByPageNumber={pageSizesByPageNumber}
      flowLayoutPages={flowLayoutPages}
      orderedContentByPageNumber={orderedContentByPageNumber}
      textsByPageNumber={textsByPageNumber}
      paragraphsByPageNumber={paragraphsByPageNumber}
      ocrTextsByPageNumber={ocrTextsByPageNumber}
      ocrLoadingPages={ocrLoadingPages}
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
      showSelectionMagnifier={showSelectionMagnifier}
      overlayRectType={overlayRectType}
      effectiveSelectedRangeId={effectiveSelectedRangeId}
      selectionPopover={selectionPopover}
      highlightPopover={existingHighlightPopover}
      rectPopover={rectPopover}
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
      paintingControllerData={paintingControllerData}
      onPaintingControllerDataChange={onPaintingControllerDataChange}
      pagePaintings={pagePaintings}
      onPagePaintingChange={onPagePaintingChange}
      drawingScale={drawingScale}
      cancelDrawingOnMultiTouch={!useVirtualPaper}
      readerScale={useVirtualPaper ? committedReaderScale : 1}
      popoverRelative={popoverRelative}
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
  const viewerThemeStyle: CSSProperties & {
    '--hamster-reader-theme-color': string
  } = {
    '--hamster-reader-theme-color': themeColor ?? '#2563eb'
  }

  return (
    <div
      ref={setRootRef}
      role='document'
      className={`${rootClassName}${
        suppressNativeSelection
          ? ' hamster-reader__intermediate-document-viewer--suppress-native-selection'
          : ''
      }${
        highlightDragPointerType === null
          ? ''
          : ' hamster-reader__intermediate-document-viewer--highlight-dragging'
      }`}
      data-testid='intermediate-document-viewer'
      style={viewerThemeStyle}
      onPointerDownCapture={handleViewerPointerDown}
      onPointerMoveCapture={handleViewerPointerMove}
      onPointerUpCapture={handleViewerPointerUp}
      onPointerCancelCapture={handleViewerPointerCancel}
    >
      {pageNumbers.length > 0 ? (
        <>
          <PageBrowser
            isOpen={showPageBrowser}
            pageNumbers={pageNumbers}
            pageSizesByPageNumber={pageSizesByPageNumber}
            baseImagesByPageNumber={baseImagesByPageNumber}
            pagePaintings={pagePaintings}
            onPageVisibilityChange={onPageBrowserVisibilityChange}
            onNavigateToPage={onNavigateToPage}
            themeColor={themeColor}
            visiblePageNumbers={visiblePageNumbers}
            containMarginTop={containMarginTop}
            containMarginBottom={containMarginBottom}
            ranges={effectiveRanges}
            selectedRangeId={effectiveSelectedRangeId}
            onSelectRange={handleLinkedSelectRange}
            onNavigateToRange={onScrollToRange}
            onDragHighlight={onDragHighlight}
            onDeleteRange={onRemoveRange}
            commentCountByRangeId={commentCountByRangeId}
            rects={rects}
            selectedRectId={selectedRectId}
            onSelectRect={onSelectRect}
            onNavigateToRect={onScrollToRect}
            onDeleteRect={onRemoveRect}
            commentCountByRectId={commentCountByRectId}
            bookmarks={bookmarks}
            currentBookmark={currentBookmark}
            currentPageNumber={currentPageNumber}
            activeBookmarkKey={activeBookmarkKey}
            onNavigateToBookmark={onNavigateToBookmark}
            onDragBookmark={onDragBookmark}
            onToggleBookmark={onToggleBookmark}
            bookmarkedPageNumbers={bookmarkedPageNumbers}
            onTogglePageBookmark={onTogglePageBookmark}
            onClose={onPageBrowserClose}
          />
          <LayoutZoomIndicator
            useVirtualPaper={useVirtualPaper}
            percent={activeZoomPercent}
          />
          <ReadingProgress
            mode='layout'
            pageNumbers={pageNumbers}
            currentPageNumber={currentPageNumber}
            isMoving={isReadingProgressMoving}
            ranges={effectiveRanges}
            highlightColor={highlightColor}
            previewEnabled={previewEnabled}
            insetTop={containMarginTop ?? containMarginY}
            insetBottom={containMarginBottom ?? containMarginY}
            baseImagesByPageNumber={baseImagesByPageNumber}
            pageSizesByPageNumber={pageSizesByPageNumber}
            onPreviewPageVisibilityChange={onPageBrowserVisibilityChange}
            onSeekPage={onNavigateToPage}
          />
          {useVirtualPaper ? (
            <VirtualPaper
              readerMode={true}
              containMode={false}
              // 程序化/受控 scale 变化也走「CSS 预览 + 防抖提交」，
              // 与手势缩放同一套机制，避免缩放期间整页重排。
              readerModeExternalZoomPreview={true}
              contentSize={activeContentSize}
              transform={virtualPaperTransform}
              minScale={scaleRange.min}
              maxScale={scaleRange.max}
              enabledInteractions={enabledInteractions}
              wrapperProps={
                touchPanMode === 'two-finger'
                  ? {
                      className: 'hamster-reader__two-finger-touch-pan'
                    }
                  : undefined
              }
              onTransformChange={handleTransformChangeWithPopover}
              onTransformChangeEnd={handleTransformChangeEndWithPopover}
              containMarginX={containMarginX}
              containMarginY={resolveContainMarginY(
                containMarginTop,
                containMarginBottom,
                containMarginY,
                virtualPaperTransform.scale
              )}
              containerStyle={buildContainerStyle(
                containMarginTop,
                containMarginBottom,
                virtualPaperTransform.scale
              )}
            >
              {pagesNode}
            </VirtualPaper>
          ) : (
            <NativeLayoutViewport
              pagesNode={pagesNode}
              transform={virtualPaperTransform}
              containMarginX={containMarginX}
              containMarginTop={containMarginTop}
              containMarginBottom={containMarginBottom}
              touchPanMode={touchPanMode}
              stylusOnly={stylusOnly}
              measurementKey={selectionScope}
            />
          )}
        </>
      ) : null}
    </div>
  )
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export function IntermediateDocumentViewer({
  document,
  serializedDocument,
  isEpub = false,
  isPdf = false,
  className,
  fontScale,
  overscan = 1,
  pageRange,
  hiddenPages,
  edgeCrop,
  edgeCropEditing,
  onEdgeCropApply,
  onEdgeCropHidePage,
  ocr,
  extraOCR,
  onOcrError,
  ocrTexts: controlledOcrTexts,
  onOcrTextsChange,
  ocrDebug = false,
  onTextSelectionChange,
  onTextSelectionEnd,
  onSelectText,
  useVirtualPaper = true,
  nativeLayoutZoom = 'fit-width',
  onNativeLayoutScaleChange,
  scale,
  defaultScale,
  defaultVirtualPaperTransform,
  onVirtualPaperTransformChangeEnd,
  layoutReadingProgress,
  onLayoutReadingProgressChange,
  onTextAnchorChange,
  readingPositionRef,
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
  onDragHighlight,
  highlightColor,
  selectionColor,
  showSelectionMagnifier = true,
  selectionPopover,
  highlightPopover,
  rectPopover,
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
  onRemoveRange,
  onRemoveRect,
  annotationHistory,
  onAnnotationHistoryChange,
  onAnnotationHistoryStatusChange,
  initialLoadedPages = 1,
  pageLoadConcurrency = 3,
  pageLoadEnterDelayMs = 500,
  pagePreloadRadius = 3,
  pageUnloadDelayMs = 5000,
  onIntermediateDocumentRenderTiming,
  containMarginX,
  containMarginTop,
  containMarginBottom,
  containMarginY,
  selectedTool,
  paintingTool,
  drawingStrokeColor,
  paintingControllerData,
  onPaintingControllerDataChange,
  pagePaintings,
  onPagePaintingChange,
  showPageBrowser = false,
  onPageBrowserClose,
  themeColor,
  commentCountByRangeId,
  commentCountByRectId,
  comments,
  bookmarks,
  onToggleBookmark,
  onDragBookmark,
  bookmarkedPageNumbers,
  onTogglePageBookmark,
  onPageLoadStatusChange,
  popoverRelative
}: IntermediateDocumentViewerProps) {
  // 编辑模式下页面以未裁切尺寸显示，effectiveEdgeCrop 为 undefined
  const effectiveEdgeCrop = resolveEffectiveEdgeCrop(edgeCropEditing, edgeCrop)
  const resolvedPaintingControllerData = useMemo<PaintingControllerData>(
    () =>
      paintingControllerData ?? {
        tool: paintingTool ?? 'pen',
        minimap: false,
        strokeColor: drawingStrokeColor ?? '#2563eb',
        strokeWidth: 3
      },
    [drawingStrokeColor, paintingControllerData, paintingTool]
  )
  const handlePaintingControllerDataChange =
    onPaintingControllerDataChange ?? ignorePaintingControllerChange
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
  const serializedFlowLayoutPageNumbers = useMemo(
    () => getSerializedFlowLayoutPageNumbers(document ?? serializedDocument),
    [document, serializedDocument]
  )

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

  const hiddenPageNumbers = useMemo(
    () => resolveHiddenPageNumbers(hiddenPages),
    [hiddenPages]
  )
  const pageNumbers = useMemo(() => {
    const allPageNumbers = runtimeDocument?.pageNumbers ?? []
    const visiblePageNumbers = getVisiblePageNumbers(allPageNumbers, pageRange)
    return edgeCropEditing
      ? visiblePageNumbers
      : visiblePageNumbers.filter(
          (pageNumber) => !hiddenPageNumbers.has(pageNumber)
        )
  }, [edgeCropEditing, hiddenPageNumbers, runtimeDocument, pageRange])
  const pageNumbersKey = pageNumbers.join(',')
  const selectionScopeRef = useRef({
    runtimeDocument,
    pageNumbersKey,
    value: Symbol('intermediate-document-selection-scope')
  })
  if (
    selectionScopeRef.current.runtimeDocument !== runtimeDocument ||
    selectionScopeRef.current.pageNumbersKey !== pageNumbersKey
  ) {
    selectionScopeRef.current = {
      runtimeDocument,
      pageNumbersKey,
      value: Symbol('intermediate-document-selection-scope')
    }
  }
  const selectionScope = selectionScopeRef.current.value
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
  const previewPageSizesByPageNumber = useMemo(() => {
    const previewPageSizes = new Map<number, NormalizedPageSize>()
    const previewPageWidth = pageNumbers.reduce((widestWidth, pageNumber) => {
      const sourcePageSize = getCachedPageSize(
        pageSizesByPageNumber,
        pageNumber
      )
      const cropGeometry = getPageCropGeometry(
        sourcePageSize,
        resolvePageEdgeCrop(effectiveEdgeCrop, pageNumber)
      )
      return Math.max(widestWidth, cropGeometry.width)
    }, 0)
    if (previewPageWidth <= 0) return previewPageSizes

    pageNumbers.forEach((pageNumber) => {
      const sourcePageSize = getCachedPageSize(
        pageSizesByPageNumber,
        pageNumber
      )
      const cropGeometry = getPageCropGeometry(
        sourcePageSize,
        resolvePageEdgeCrop(effectiveEdgeCrop, pageNumber)
      )
      const previewScale = previewPageWidth / cropGeometry.width
      previewPageSizes.set(pageNumber, {
        ...sourcePageSize,
        width: previewPageWidth,
        height: cropGeometry.height * previewScale
      })
    })

    return previewPageSizes
  }, [effectiveEdgeCrop, pageNumbers, pageSizesByPageNumber])
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const loadingPagesRef = useRef(new Set<number>())
  const ocrLoadingPagesRef = useRef(new Set<number>())
  // Loading 可在关闭页面时提前隐藏，但底层 Promise 无法取消；独立活动槽必须保留到
  // Promise settle，才能保证任何时刻实际运行的 OCR 任务都不超过一个。
  const ocrActivePageRef = useRef<number | null>(null)
  const ocrCacheRef = useRef(new Map<string, IntermediateText[]>())
  const evictedOcrPagesRef = useRef(new Set<number>())
  // 每页 OCR 驱逐代际：离屏卸载时递增对应页码代际。OCR 异步任务发起时
  // 捕获代际，resolve 时比对——不一致即运行期间被卸载过（stale，丢弃），
  // 一致则为重载后的新鲜结果（写回）。借此区分卸载前 stale OCR 与重载后
  // 重新发起的 OCR，修复仅凭 evictedOcrPagesRef.has 导致重载后永久被拒的死锁。
  const ocrEvictGenerationRef = useRef(new Map<number, number>())
  // OCR 失败页标记：防止 effect 重跑时对持续失败的页无限重试；
  // 按页关闭 / 全局关闭 / 切换文档时清除，允许重新开启后再试。
  const ocrFailedPagesRef = useRef(new Set<number>())
  // 被 evictLazyPageBundle 卸载的初始页面集合。enqueueInitialPages 的
  // isPageLoaded 检查此集合，防止 eviction 后 lazyPageQueue identity
  // 变化触发 effect 重跑而重新加载已卸载的页面。页面重新进入可见窗口
  // 时从集合中移除，允许通过 enqueuePage 重新加载。
  const lazilyEvictedPagesRef = useRef(new Set<number>())
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
  const [textsByPageNumber, setTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  const [orderedContentByPageNumber, setOrderedContentByPageNumber] = useState(
    () => new Map<number, IntermediateContent[]>()
  )
  const [flowLayoutPages, setFlowLayoutPages] = useState(
    () => new Set<number>()
  )
  useSelectionGeometryRevision(
    viewerRootElement,
    `${Array.from(flowLayoutPages).join(',')}:${Array.from(
      textsByPageNumber,
      ([pageNumber, texts]) => `${pageNumber}:${texts.length}`
    ).join(',')}`
  )
  const storedRanges = isRangesControlled ? ranges : internalRanges
  const storedRangesRef = useRef<ReaderSelectionRange[]>(storedRanges)
  storedRangesRef.current = storedRanges
  const effectiveRanges = storedRanges.map((range) => {
    if (hasHighlightRects(range.rectsBySelectionId)) {
      return range
    }
    return deriveLayoutSelectionRange({
      range,
      root: viewerRootElement,
      flowLayoutPages,
      textsByPageNumber,
      pageSizesByPageNumber,
      overlayRectType
    })
  })
  const effectiveRangesRef = useRef<ReaderSelectionRange[]>(effectiveRanges)
  effectiveRangesRef.current = effectiveRanges
  const lastLayoutGeometryTraceRef = useRef('')
  useEffect(() => {
    const detail = {
      mode: 'layout',
      isEpub,
      overlayRectType,
      loadedTextPageNumbers: Array.from(textsByPageNumber.keys()),
      pageSizeNumbers: Array.from(pageSizesByPageNumber.keys()),
      storedRanges: summarizeHighlightRanges(storedRanges),
      effectiveRanges: summarizeHighlightRanges(effectiveRanges)
    }
    const signature = JSON.stringify(detail)
    if (lastLayoutGeometryTraceRef.current === signature) return
    lastLayoutGeometryTraceRef.current = signature
    traceHighlight('layout.geometry', detail)
  }, [
    effectiveRanges,
    isEpub,
    overlayRectType,
    pageSizesByPageNumber,
    storedRanges,
    textsByPageNumber
  ])
  const derivedCommentCountByRangeId = useMemo(
    () => (comments ? getCommentCountByHighlightId(comments) : undefined),
    [comments]
  )
  const effectiveCommentCountByRangeId =
    commentCountByRangeId ?? derivedCommentCountByRangeId

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
  const pendingLinkedHighlightScopeRef = useRef(selectionScope)
  if (pendingLinkedHighlightScopeRef.current !== selectionScope) {
    pendingLinkedHighlightScopeRef.current = selectionScope
    pendingLinkedHighlightOperationRef.current = null
    emittedLinkedSelectRangeIdsRef.current.clear()
    emittedLinkedHighlightRangeIdsRef.current.clear()
  }

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
        ? (storedRanges.find(
            (range) => range.id === effectiveSelectedRangeId
          ) ?? null)
        : null,
    [effectiveSelectedRangeId, storedRanges]
  )
  const selectedRectangle = useMemo(
    () =>
      effectiveSelectedRectId
        ? (effectiveRects.find(
            (rectangle) => rectangle.id === effectiveSelectedRectId
          ) ?? null)
        : null,
    [effectiveRects, effectiveSelectedRectId]
  )
  let resolvedRectPopover: ReactNode
  if (typeof rectPopover === 'function') {
    resolvedRectPopover = selectedRectangle
      ? rectPopover(selectedRectangle)
      : undefined
  } else {
    resolvedRectPopover = rectPopover
  }
  const [runtimeLinkedTransientState, setRuntimeLinkedTransientState] =
    useState<{
      readonly scope: symbol
      readonly transient: RuntimeLinkedSelectionTransient
    }>(() => ({ scope: selectionScope, transient: {} }))
  const runtimeLinkedTransient =
    runtimeLinkedTransientState.scope === selectionScope
      ? runtimeLinkedTransientState.transient
      : {}
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
  const emittedDerivedLayoutRectsRef = useRef(new Map<string, string>())
  useEffect(() => {
    if (isEpub) {
      traceHighlight('layout.writeback', {
        mode: 'layout',
        isEpub,
        decision: 'skip-epub',
        ranges: summarizeHighlightRanges(effectiveRanges)
      })
      return
    }

    let hasNewDerivedRects = false
    const nextRanges = storedRanges.map((storedRange, index) => {
      if (hasHighlightRects(storedRange.rectsBySelectionId)) return storedRange
      const effectiveRange = effectiveRanges[index]
      if (
        !effectiveRange ||
        !hasHighlightRects(effectiveRange.rectsBySelectionId)
      ) {
        return storedRange
      }

      const signature = JSON.stringify(effectiveRange.rectsBySelectionId)
      if (
        emittedDerivedLayoutRectsRef.current.get(storedRange.id) === signature
      ) {
        return storedRange
      }
      emittedDerivedLayoutRectsRef.current.set(storedRange.id, signature)
      hasNewDerivedRects = true
      return effectiveRange
    })

    if (!hasNewDerivedRects) {
      traceHighlight('layout.writeback', {
        mode: 'layout',
        isEpub,
        decision: 'skip-no-new-rects',
        ranges: summarizeHighlightRanges(effectiveRanges)
      })
      return
    }
    if (!isRangesControlled) setInternalRanges(nextRanges)

    const publicLinkedData = mapRuntimeLinkedDataToPublic(
      runtimeLinkedData,
      readerLinkedScopeId
    )
    traceHighlight('layout.writeback', {
      mode: 'layout',
      isEpub,
      decision: 'emit-derived-rects',
      ranges: summarizeHighlightRanges(nextRanges)
    })
    onLinkedDataChange?.({ ...publicLinkedData, items: nextRanges })
  }, [
    effectiveRanges,
    isEpub,
    isRangesControlled,
    onLinkedDataChange,
    readerLinkedScopeId,
    runtimeLinkedData,
    storedRanges
  ])
  const runtimeRects = useMemo(
    () => mapPublicRectanglesToRuntime(effectiveRects, readerLinkedScopeId),
    [effectiveRects, readerLinkedScopeId]
  )

  const annotationHistoryEnabled = annotationHistory?.enabled === true
  const currentAnnotationHistorySnapshot = useCallback(
    () =>
      normalizeAnnotationHistorySnapshot(
        makeAnnotationHistorySnapshot(
          storedRangesRef.current,
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
  const {
    enabled: annotationHistoryStatusEnabled,
    canUndo: annotationHistoryCanUndo,
    canRedo: annotationHistoryCanRedo,
    pastCount: annotationHistoryPastCount,
    futureCount: annotationHistoryFutureCount
  } = annotationHistoryController.getStatus()
  useEffect(() => {
    onAnnotationHistoryStatusChange?.({
      enabled: annotationHistoryStatusEnabled,
      canUndo: annotationHistoryCanUndo,
      canRedo: annotationHistoryCanRedo,
      pastCount: annotationHistoryPastCount,
      futureCount: annotationHistoryFutureCount
    })
  }, [
    annotationHistoryCanRedo,
    annotationHistoryCanUndo,
    annotationHistoryFutureCount,
    annotationHistoryPastCount,
    annotationHistoryStatusEnabled,
    onAnnotationHistoryStatusChange
  ])
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
        storedRanges,
        historyRects,
        effectiveSelectedRangeId,
        effectiveSelectedRectId
      )
    )
  }, [
    storedRanges,
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
  const defaultVirtualPaperX = defaultVirtualPaperTransform?.x
  const defaultVirtualPaperY = defaultVirtualPaperTransform?.y
  const defaultVirtualPaperScale = defaultVirtualPaperTransform?.scale
  const normalizedDefaultVirtualPaperTransform = useMemo(
    () =>
      defaultVirtualPaperX !== undefined &&
      defaultVirtualPaperY !== undefined &&
      defaultVirtualPaperScale !== undefined
        ? {
            x: Number.isFinite(defaultVirtualPaperX) ? defaultVirtualPaperX : 0,
            y: Number.isFinite(defaultVirtualPaperY) ? defaultVirtualPaperY : 0,
            scale: clampScale(defaultVirtualPaperScale, scaleRange)
          }
        : undefined,
    [
      defaultVirtualPaperScale,
      defaultVirtualPaperX,
      defaultVirtualPaperY,
      scaleRange
    ]
  )
  const [paperTransform, setPaperTransform] = useState<VirtualPaperTransform>(
    () =>
      normalizedDefaultVirtualPaperTransform ?? {
        x: 0,
        y: 0,
        scale: clampScale(defaultScale ?? 1, scaleRange)
      }
  )
  const isTransformingRef = useRef(false)
  const [committedReaderScale, setCommittedReaderScale] = useState(() =>
    clampScale(
      scale ??
        normalizedDefaultVirtualPaperTransform?.scale ??
        defaultScale ??
        1,
      scaleRange
    )
  )
  const appliedDefaultVirtualPaperRef = useRef<{
    readonly runtimeDocument: IntermediateDocument | null
    readonly transform: VirtualPaperTransform
  } | null>(null)
  const paperTransformRef = useRef(paperTransform)
  paperTransformRef.current = paperTransform
  const lastLocallyEmittedVirtualPaperKeyRef = useRef('')
  const defaultVirtualPaperStateKey = getOptionalVirtualPaperStateKey(
    defaultVirtualPaperTransform
  )

  useEffect(() => {
    if (!normalizedDefaultVirtualPaperTransform) return

    if (
      defaultVirtualPaperStateKey.length > 0 &&
      lastLocallyEmittedVirtualPaperKeyRef.current ===
        defaultVirtualPaperStateKey
    ) {
      return
    }

    const appliedDefault = appliedDefaultVirtualPaperRef.current
    if (
      appliedDefault?.runtimeDocument === runtimeDocument &&
      appliedDefault.transform.x === normalizedDefaultVirtualPaperTransform.x &&
      appliedDefault.transform.y === normalizedDefaultVirtualPaperTransform.y &&
      appliedDefault.transform.scale ===
        normalizedDefaultVirtualPaperTransform.scale
    ) {
      return
    }
    appliedDefaultVirtualPaperRef.current = {
      runtimeDocument,
      transform: normalizedDefaultVirtualPaperTransform
    }
    paperTransformRef.current = normalizedDefaultVirtualPaperTransform

    setPaperTransform((currentTransform) =>
      currentTransform.x === normalizedDefaultVirtualPaperTransform.x &&
      currentTransform.y === normalizedDefaultVirtualPaperTransform.y &&
      currentTransform.scale === normalizedDefaultVirtualPaperTransform.scale
        ? currentTransform
        : normalizedDefaultVirtualPaperTransform
    )
  }, [
    defaultVirtualPaperStateKey,
    normalizedDefaultVirtualPaperTransform,
    runtimeDocument
  ])

  const effectiveScale = useMemo(() => {
    if (!useVirtualPaper && nativeLayoutZoom === 'fit-width') {
      return paperTransform.scale
    }
    return clampScale(scale ?? paperTransform.scale, scaleRange)
  }, [
    nativeLayoutZoom,
    paperTransform.scale,
    scale,
    scaleRange,
    useVirtualPaper
  ])
  const effectiveScaleRef = useRef(effectiveScale)
  effectiveScaleRef.current = effectiveScale
  const initialFitDocumentRef = useRef<IntermediateDocument | null>(null)

  useEffect(() => {
    if (isTransformingRef.current) return
    setCommittedReaderScale(effectiveScale)
  }, [effectiveScale])

  const virtualPaperTransform = useMemo<VirtualPaperTransform>(
    () => ({
      x: paperTransform.x,
      y: paperTransform.y,
      scale: effectiveScale
    }),
    [effectiveScale, paperTransform.x, paperTransform.y]
  )

  const textElementsRef = useRef(
    new Map<string, TextAnchorElementRecord<IntermediateText>>()
  )
  const [currentTextAnchor, setCurrentTextAnchor] = useState<
    ReaderTextAnchor | undefined
  >(
    getInitialLayoutTextAnchor(
      defaultVirtualPaperTransform,
      layoutReadingProgress
    )
  )
  const [currentBookmark, setCurrentBookmark] = useState<
    ReaderBookmark | undefined
  >(
    getInitialLayoutBookmark(
      defaultVirtualPaperTransform,
      layoutReadingProgress
    )
  )
  const currentTextAnchorRef = useRef(currentTextAnchor)
  currentTextAnchorRef.current = currentTextAnchor
  const [currentLayoutPageNumber, setCurrentLayoutPageNumber] = useState(
    () => pageNumbers[0] ?? 0
  )
  const currentLayoutPageNumberRef = useRef(currentLayoutPageNumber)
  currentLayoutPageNumberRef.current = currentLayoutPageNumber
  const [fallbackBookmarkKey, setFallbackBookmarkKey] = useState<string>()
  const activeBookmarkKey = getActiveBookmarkKey(
    currentBookmark,
    fallbackBookmarkKey,
    bookmarks
  )
  const [pendingTextAnchor, setPendingTextAnchor] =
    useState<PendingTextAnchorOperation | null>(null)
  const pendingTextAnchorRef = useRef<PendingTextAnchorOperation | null>(null)
  const appliedDefaultTextAnchorRef = useRef<{
    readonly runtimeDocument: IntermediateDocument | null
    readonly key: string
  } | null>(null)
  const lastReportedLayoutProgressKeyRef = useRef(
    getOptionalBookmarkKey(layoutReadingProgress)
  )
  const restoringNativeProgressKeyRef = useRef(
    getOptionalBookmarkKey(layoutReadingProgress)
  )
  useSyncNativeLayoutProgressGate({
    lastReportedProgressKeyRef: lastReportedLayoutProgressKeyRef,
    layoutReadingProgress,
    restoringProgressKeyRef: restoringNativeProgressKeyRef,
    runtimeDocument,
    useVirtualPaper
  })
  const captureCurrentTextAnchor = useCallback(
    (
      clearFallback: boolean,
      reportNativeProgress: boolean,
      scanBelow: boolean = false
    ) => {
      const viewport = viewerRootRef.current?.querySelector<HTMLElement>(
        '.virtual-paper-wrapper'
      )
      const viewportRect = viewport?.getBoundingClientRect()
      const contentTop =
        (viewportRect?.top ?? 0) + (containMarginTop ?? containMarginY ?? 0)
      const pageRects = viewportRect
        ? pageNumbers.flatMap((pageNumber) => {
            const rect = pageRefs.current
              .get(pageNumber)
              ?.getBoundingClientRect()
            return rect && rect.height > 0 ? [{ pageNumber, rect }] : []
          })
        : []
      const topPage = viewportRect
        ? (pageRects.find(
            ({ rect }) => rect.top <= contentTop && rect.bottom > contentTop
          ) ??
          pageRects
            .filter(({ rect }) => rect.top > contentTop)
            .sort((left, right) => left.rect.top - right.rect.top)[0])
        : undefined
      const resolvedPageNumber =
        topPage?.pageNumber ??
        currentLayoutPageNumberRef.current ??
        pageNumbers[0]
      if (resolvedPageNumber !== undefined) {
        currentLayoutPageNumberRef.current = resolvedPageNumber
        setCurrentLayoutPageNumber(resolvedPageNumber)
      }
      const findAnchor = scanBelow ? findTextAnchorAtOrBelow : findTopTextAnchor
      const anchor = viewport
        ? (findAnchor(viewport, textElementsRef.current, textsByPageNumber, {
            pageNumber: resolvedPageNumber,
            topInset: containMarginTop ?? containMarginY
          }) ?? undefined)
        : undefined
      const nextBookmark = resolveNativeLayoutBookmark(
        anchor,
        contentTop,
        topPage
      )
      setCurrentBookmark((value) =>
        value &&
        nextBookmark &&
        getBookmarkKey(value) === getBookmarkKey(nextBookmark)
          ? value
          : nextBookmark
      )
      if (reportNativeProgress) {
        reportUnreportedNativeProgress({
          lastReportedProgressKeyRef: lastReportedLayoutProgressKeyRef,
          nextBookmark,
          onProgressChange: onLayoutReadingProgressChange,
          restoringProgressKeyRef: restoringNativeProgressKeyRef,
          useVirtualPaper
        })
      }

      const currentAnchor = currentTextAnchorRef.current
      const anchorChanged =
        (currentAnchor === undefined) !== (anchor === undefined) ||
        (currentAnchor !== undefined &&
          anchor !== undefined &&
          (getTextAnchorKey(currentAnchor) !== getTextAnchorKey(anchor) ||
            currentAnchor.text !== anchor.text))
      if (anchorChanged) {
        currentTextAnchorRef.current = anchor
        setCurrentTextAnchor(anchor)
        onTextAnchorChange?.(anchor)
      }
      if (clearFallback && anchor) setFallbackBookmarkKey(undefined)
      return anchor
    },
    [
      onLayoutReadingProgressChange,
      onTextAnchorChange,
      containMarginTop,
      containMarginY,
      pageNumbers,
      textsByPageNumber,
      useVirtualPaper
    ]
  )
  useImperativeHandle(
    readingPositionRef,
    () => ({
      captureTextAnchor: () => captureCurrentTextAnchor(false, false, true)
    }),
    [captureCurrentTextAnchor]
  )
  const pendingNativeZoomAnchorRef = useRef<{
    readonly element: HTMLElement | null
    readonly scale: number
    readonly top: number | null
  } | null>(null)
  const applyNativeLayoutScale = useCallback(
    (nextScale: number) => {
      if (effectiveScaleRef.current === nextScale) return

      const anchor = captureCurrentTextAnchor(false, false)
      const anchorElement = anchor
        ? resolveTextAnchorElement(
            anchor,
            textElementsRef.current,
            textsByPageNumber
          )
        : null
      const viewport = viewerRootRef.current?.querySelector<HTMLElement>(
        '.hamster-reader__native-layout-viewport'
      )
      const viewerWindow = viewport?.ownerDocument.defaultView
      const previousScale = effectiveScaleRef.current
      const transformContainer = viewport?.querySelector<HTMLElement>(
        '[data-testid="native-layout-transform-extent"] .hamster-reader__native-layout-container'
      )
      const intrinsicSize = transformContainer
        ? {
            width: Math.max(
              transformContainer.scrollWidth,
              transformContainer.offsetWidth
            ),
            height: Math.max(
              transformContainer.scrollHeight,
              transformContainer.offsetHeight
            )
          }
        : undefined
      const centeredPosition = viewport
        ? computeCenteredScrollPosition(
            viewport,
            previousScale,
            nextScale,
            intrinsicSize
          )
        : null
      const pendingAnchor = {
        element: anchorElement,
        scale: nextScale,
        top: anchorElement?.getBoundingClientRect().top ?? null
      }
      pendingNativeZoomAnchorRef.current = pendingAnchor
      setPaperTransform((currentTransform) => ({
        ...currentTransform,
        scale: nextScale
      }))
      onNativeLayoutScaleChange?.(nextScale)

      if (!viewport || !viewerWindow || !centeredPosition) return
      viewerWindow.requestAnimationFrame(() => {
        viewerWindow.requestAnimationFrame(() => {
          if (
            pendingNativeZoomAnchorRef.current !== pendingAnchor ||
            !viewport.isConnected ||
            effectiveScaleRef.current !== nextScale ||
            (pendingAnchor.element !== null &&
              !pendingAnchor.element.isConnected)
          ) {
            return
          }
          pendingNativeZoomAnchorRef.current = null
          viewport.scrollLeft = centeredPosition.left
          viewport.scrollTop =
            pendingAnchor.element && pendingAnchor.top !== null
              ? viewport.scrollTop +
                pendingAnchor.element.getBoundingClientRect().top -
                pendingAnchor.top
              : centeredPosition.top
        })
      })
    },
    [captureCurrentTextAnchor, onNativeLayoutScaleChange, textsByPageNumber]
  )
  const handleInitialFitScale = useCallback(
    (fitScale: number) => {
      if (!useVirtualPaper && nativeLayoutZoom === 'fit-width') {
        applyNativeLayoutScale(fitScale)
        return
      }

      if (!useVirtualPaper) return

      if (
        !runtimeDocument ||
        initialFitDocumentRef.current === runtimeDocument
      ) {
        return
      }

      initialFitDocumentRef.current = runtimeDocument
      if (scale !== undefined || defaultVirtualPaperTransform !== undefined)
        return

      setPaperTransform((currentTransform) => ({
        ...currentTransform,
        scale: clampScale(fitScale, scaleRange)
      }))
    },
    [
      applyNativeLayoutScale,
      defaultVirtualPaperTransform,
      nativeLayoutZoom,
      runtimeDocument,
      scale,
      scaleRange,
      useVirtualPaper
    ]
  )
  useEffect(() => {
    if (useVirtualPaper || nativeLayoutZoom === 'fit-width') return
    applyNativeLayoutScale(clampScale(nativeLayoutZoom, scaleRange))
  }, [applyNativeLayoutScale, nativeLayoutZoom, scaleRange, useVirtualPaper])
  const handleViewportPositionChange = useCallback(() => {
    captureCurrentTextAnchor(true, true)
  }, [captureCurrentTextAnchor])
  useEffect(() => {
    const viewerWindow = viewerRootRef.current?.ownerDocument.defaultView
    if (!viewerWindow) {
      captureCurrentTextAnchor(false, false)
      return
    }

    const frameId = viewerWindow.requestAnimationFrame(() => {
      captureCurrentTextAnchor(false, false)
    })
    return () => viewerWindow.cancelAnimationFrame(frameId)
  }, [captureCurrentTextAnchor])
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
  const transformStartScaleRef = useRef<number | null>(null)
  const refreshThumbnailImmediatelyRef = useRef(false)
  const [thumbnailRefreshEndBump, setThumbnailRefreshEndBump] = useState(0)
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
  const [paragraphsByPageNumber, setParagraphsByPageNumber] = useState(
    () => new Map<number, IntermediateParagraph[]>()
  )
  const [ocrTextsByPageNumber, setOcrTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  // 驱动页内 OCR Loading 角标渲染的 state；与 ocrLoadingPagesRef 保持同步
  const [ocrLoadingPages, setOcrLoadingPages] = useState(
    () => new Set<number>()
  )
  const [ocrActivePage, setOcrActivePage] = useState<number | null>(null)
  const [pageStatuses, setPageStatuses] = useState(
    () => new Map<number, PageLoadStatus>()
  )
  const [pageResourcesDocument, setPageResourcesDocument] =
    useState(runtimeDocument)
  const [baseImagesByPageNumber, setBaseImagesByPageNumber] = useState(
    () => new Map<number, string>()
  )
  // intermediate-document 模式专用：getContent() 返回的 IntermediateImage 内容项
  const [imagesByPageNumber, setImagesByPageNumber] = useState(
    () => new Map<number, IntermediateImage[]>()
  )

  // --- debounced thumbnail refresh 所需的 refs ---
  useEffect(() => {
    const loaded = Array.from(pageStatuses.entries())
      .filter(([, status]) => status === 'loaded')
      .map(([pageNumber]) => pageNumber)
      .sort((a, b) => a - b)
    onPageLoadStatusChange?.(loaded)
  }, [pageStatuses, onPageLoadStatusChange])
  const baseImagesByPageNumberRef = useRef(baseImagesByPageNumber)
  baseImagesByPageNumberRef.current = baseImagesByPageNumber
  const pageNumbersRef = useRef(pageNumbers)
  pageNumbersRef.current = pageNumbers
  const pagePreloadRadiusRef = useRef(pagePreloadRadius)
  pagePreloadRadiusRef.current = pagePreloadRadius
  const getThumbnailScale = useCallback(
    (pageNumber: number) => {
      const sourcePageSize = pageSizesByPageNumber.get(pageNumber)
      const pageElement = pageRefs.current.get(pageNumber)
      const contentScaleElement = pageElement?.querySelector<HTMLElement>(
        '.hamster-reader__intermediate-page-content-scale'
      )
      const viewerWindow =
        contentScaleElement?.ownerDocument.defaultView ??
        pageElement?.ownerDocument.defaultView ??
        viewerRootRef.current?.ownerDocument.defaultView
      const deviceScale =
        viewerWindow?.devicePixelRatio ??
        (typeof window === 'undefined' ? 1 : window.devicePixelRatio)

      if (!sourcePageSize) {
        return effectiveScaleRef.current * deviceScale
      }

      const contentRenderedWidth =
        contentScaleElement?.getBoundingClientRect().width ?? 0
      const renderedWidth =
        contentRenderedWidth > 0
          ? contentRenderedWidth
          : (pageElement?.getBoundingClientRect().width ?? 0)
      if (renderedWidth > 0) {
        return (renderedWidth / sourcePageSize.width) * deviceScale
      }

      const previewWidth =
        previewPageSizesByPageNumber.get(pageNumber)?.width ??
        sourcePageSize.width
      return (
        (previewWidth / sourcePageSize.width) *
        effectiveScaleRef.current *
        deviceScale
      )
    },
    [pageSizesByPageNumber, previewPageSizesByPageNumber]
  )
  // 每页记录最后一次成功请求的 PDF source scale，页面拉伸比例不同时也能独立去重。
  const lastThumbnailRefreshScalesRef = useRef(new Map<number, number>())
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
    getThumbnailScale,
    callbacks: {
      onPageLoaded: ({
        pageNumber,
        useFlowLayout,
        baseImage,
        thumbnailScale,
        texts,
        paragraphs,
        images,
        content
      }) => {
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
        if (thumbnailScale !== undefined) {
          lastThumbnailRefreshScalesRef.current.set(pageNumber, thumbnailScale)
        }
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, baseImage)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, texts))
        setParagraphsByPageNumber(
          createSetParagraphsHandler(pageNumber, paragraphs)
        )
        setFlowLayoutPages((currentPages) => {
          const isCurrentValue = currentPages.has(pageNumber)
          if (isCurrentValue === useFlowLayout) return currentPages

          const nextPages = new Set(currentPages)
          if (useFlowLayout) nextPages.add(pageNumber)
          else nextPages.delete(pageNumber)
          return nextPages
        })
        setImagesByPageNumber(createSetImagesHandler(pageNumber, images))
        setOrderedContentByPageNumber(
          createSetContentHandler(pageNumber, content)
        )
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'loaded'))
      },
      onPageError: (pageNumber) => {
        pageLoadTimingStartsRef.current.delete(pageNumber)
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setParagraphsByPageNumber(createSetParagraphsHandler(pageNumber, []))
        if (!serializedFlowLayoutPageNumbers.has(pageNumber)) {
          setFlowLayoutPages(deletePageFromSet(pageNumber))
        }
        setImagesByPageNumber(createSetImagesHandler(pageNumber, []))
        setOrderedContentByPageNumber(createSetContentHandler(pageNumber, []))
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
      const preloadPages = getPagePreloadWindow(
        pageNumbersRef.current,
        [pageNumber],
        pagePreloadRadiusRef.current
      )
      preloadPages.forEach((preloadPageNumber) => {
        if (renderTimingRef.current.enabled) {
          pageLoadTimingStartsRef.current.set(preloadPageNumber, {
            stage: 'visibility-lazy-loading',
            startedAt: getRenderTimingNow()
          })
        }
        enqueueVisiblePageRef.current(preloadPageNumber)
      })
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

  const cancelPendingTextAnchor = useCallback(() => {
    const operation = pendingTextAnchorRef.current
    pendingTextAnchorRef.current = null
    setPendingTextAnchor(null)
    if (operation) {
      releaseJumpPinnedPage(operation.anchor.pageNumber, operation.token)
    }
  }, [releaseJumpPinnedPage])

  const cancelPendingProgressRestore = useCallback(() => {
    if (pendingTextAnchorRef.current?.source === 'restore') {
      cancelPendingTextAnchor()
    }
  }, [cancelPendingTextAnchor])

  // 已保存选择的解析结果（按 id 索引），在 mount/update 时计算并缓存。
  // 已移除组件内自定义 SVG overlay 状态、容器 refs 与手柄状态，保留已保存选择类型缓存供数据流程使用。
  useEffect(() => {
    const currentPageNumbers = new Set(pageNumbers)

    const pendingOperation = pendingTextAnchorRef.current
    if (pendingOperation) {
      cancelPendingTextAnchor()
      appliedDefaultTextAnchorRef.current = null
      if (!currentPageNumbers.has(pendingOperation.anchor.pageNumber)) {
        setFallbackBookmarkKey(undefined)
      }
    }

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
  }, [cancelPendingTextAnchor, clearAllJumpPins, pageNumbers])

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
    ocrFailedPagesRef.current.clear()
    evictedOcrPagesRef.current.clear()
    lazilyEvictedPagesRef.current.clear()
    pageBrowserVisiblePagesRef.current.clear()
    setLoadablePages(new Set())
    setVisiblePages(new Set())
    setTextsByPageNumber(new Map())
    setParagraphsByPageNumber(new Map())
    setFlowLayoutPages(new Set(serializedFlowLayoutPageNumbers))
    setOcrTextsByPageNumber(new Map())
    setOcrLoadingPages(new Set())
    setPageStatuses(new Map())
    setBaseImagesByPageNumber(new Map())
    setImagesByPageNumber(new Map())
    setOrderedContentByPageNumber(new Map())
    setPageResourcesDocument(runtimeDocument)
    setCurrentTextAnchor(undefined)
    const firstPageNumber = pageNumbersRef.current[0] ?? 0
    currentLayoutPageNumberRef.current = firstPageNumber
    setCurrentLayoutPageNumber(firstPageNumber)
    setFallbackBookmarkKey(undefined)
    lastLocallyEmittedVirtualPaperKeyRef.current = ''
    cancelPendingTextAnchor()
    lastThumbnailRefreshScalesRef.current.clear()
    clearAllUnloadTimers()
    clearAllJumpPins()
  }, [
    runtimeDocument,
    serializedFlowLayoutPageNumbers,
    clearAllUnloadTimers,
    clearAllJumpPins,
    cancelPendingTextAnchor
  ])

  const bumpOcrEvictGeneration = useCallback((pageNumber: number) => {
    const current = ocrEvictGenerationRef.current.get(pageNumber) ?? 0
    ocrEvictGenerationRef.current.set(pageNumber, current + 1)
  }, [])

  // OCR loading 标记的统一入口：ref 供异步流程快速查询，state 驱动角标渲染
  const addOcrLoadingPage = useCallback((pageNumber: number) => {
    ocrLoadingPagesRef.current.add(pageNumber)
    setOcrLoadingPages((currentPages) => {
      if (currentPages.has(pageNumber)) return currentPages
      const nextPages = new Set(currentPages)
      nextPages.add(pageNumber)
      return nextPages
    })
  }, [])

  const removeOcrLoadingPage = useCallback((pageNumber: number) => {
    ocrLoadingPagesRef.current.delete(pageNumber)
    setOcrLoadingPages((currentPages) => {
      if (!currentPages.has(pageNumber)) return currentPages
      const nextPages = new Set(currentPages)
      nextPages.delete(pageNumber)
      return nextPages
    })
  }, [])

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

      // 新版 virtual-paper 的 meta 不再包含 focalPoint
      onScaleChange?.(clampedScale, { source })
    },
    [onScaleChange, scale, scaleRange]
  )

  const handleVirtualPaperTransformChange = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      if (!isTransformingRef.current) {
        transformStartScaleRef.current = effectiveScaleRef.current
      }
      isTransformingRef.current = true
      handleVirtualPaperTransform(nextTransform, meta)
    },
    [handleVirtualPaperTransform]
  )

  const handleVirtualPaperTransformChangeEnd = useCallback(
    (nextTransform: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      const transformStartScale = transformStartScaleRef.current
      const completedScale = clampScale(nextTransform.scale, scaleRange)
      transformStartScaleRef.current = null
      isTransformingRef.current = false
      handleVirtualPaperTransform(nextTransform, meta)
      setCommittedReaderScale(
        scale === undefined ? completedScale : effectiveScaleRef.current
      )
      const completedState: ReaderVirtualPaperState = {
        x: nextTransform.x,
        y: nextTransform.y,
        scale: scale === undefined ? completedScale : effectiveScaleRef.current
      }
      const anchor = captureCurrentTextAnchor(true, false)
      const completedReaderState = anchor
        ? { ...completedState, anchor }
        : completedState
      lastLocallyEmittedVirtualPaperKeyRef.current =
        getVirtualPaperStateKey(completedReaderState)
      onVirtualPaperTransformChangeEnd?.(completedReaderState)
      if (
        transformStartScale !== null &&
        completedScale > transformStartScale
      ) {
        refreshThumbnailImmediatelyRef.current = true
        setThumbnailRefreshEndBump((current) => current + 1)
      }
      // 仅在活动 transform 期间确实跳过了 eviction 时才补偿触发
      if (evictionSkippedDuringTransformRef.current) {
        evictionSkippedDuringTransformRef.current = false
        setEvictionBump((v) => v + 1)
      }
    },
    [
      captureCurrentTextAnchor,
      handleVirtualPaperTransform,
      onVirtualPaperTransformChangeEnd,
      scale,
      scaleRange
    ]
  )

  // 缩放结束后 debounce 300ms，按每页当前 DOM 尺寸刷新可见已加载页面的缩略图。
  // 传入 PDF source scale 给 getThumbnail(scale) 获取匹配实际展示尺寸的分辨率，
  // 放大时背景图更清晰，缩小时节省内存。
  // 每页实际倍率变化 < 0.1 时不刷新，避免微小尺寸变化触发不必要的重新生成。
  useEffect(() => {
    const refreshDelay =
      thumbnailRefreshEndBump > 0 && refreshThumbnailImmediatelyRef.current
        ? 0
        : 300
    refreshThumbnailImmediatelyRef.current = false
    const timer = setTimeout(async () => {
      if (!isMountedRef.current || !runtimeDocument) return
      const activeDoc = activeDocumentRef.current
      if (activeDoc !== runtimeDocument) return

      const visibleSet =
        visiblePages.size > 0 ? visiblePages : lastKnownVisiblePagesRef.current
      const statuses = pageStatuses
      const validPageNumbers = new Set(pageNumbersRef.current)

      const pagesToRefresh: Array<{
        pageNumber: number
        thumbnailScale: number
      }> = []
      visibleSet.forEach((pageNumber) => {
        if (
          validPageNumbers.has(pageNumber) &&
          statuses.get(pageNumber) === 'loaded'
        ) {
          const thumbnailScale = getThumbnailScale(pageNumber)
          const previousThumbnailScale =
            lastThumbnailRefreshScalesRef.current.get(pageNumber)
          if (
            previousThumbnailScale === undefined ||
            Math.abs(thumbnailScale - previousThumbnailScale) >= 0.1
          ) {
            pagesToRefresh.push({ pageNumber, thumbnailScale })
          }
        }
      })

      if (pagesToRefresh.length === 0) return

      // 并行获取每页按当前 scale 的缩略图
      await Promise.all(
        pagesToRefresh.map(async ({ pageNumber, thumbnailScale }) => {
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
              thumbnailScale
            )
            if (
              !isMountedRef.current ||
              activeDocumentRef.current !== activeDoc
            )
              return
            if (effectiveScaleRef.current !== effectiveScale) return
            if (Math.abs(getThumbnailScale(pageNumber) - thumbnailScale) >= 0.1)
              return

            lastThumbnailRefreshScalesRef.current.set(
              pageNumber,
              thumbnailScale
            )

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
    }, refreshDelay)

    return () => clearTimeout(timer)
  }, [
    effectiveScale,
    getThumbnailScale,
    pageStatuses,
    runtimeDocument,
    thumbnailRefreshEndBump,
    visiblePages
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

  // native Layout 通过自身可滚动视口承载平移：把目标范围中心滚动到视口中心。
  // 抽成独立函数以降低 scrollToRange 的认知复杂度（含嵌套条件与提前返回）。
  const scrollNativeLayoutToRange = useCallback(
    ({
      targetPageNumber,
      targetPoint,
      targetPreviewPageSize,
      viewportElement,
      viewportRect,
      nextTransform
    }: {
      targetPageNumber: number
      targetPoint: { readonly x: number; readonly y: number }
      targetPreviewPageSize: NormalizedPageSize
      viewportElement: HTMLElement
      viewportRect: DOMRect
      nextTransform: { readonly x: number; readonly y: number }
    }): void => {
      const targetPageElement = pageRefs.current.get(targetPageNumber)
      const targetPageRect = targetPageElement?.getBoundingClientRect()
      if (targetPageRect && targetPageRect.height > 0) {
        const targetRatioX = targetPoint.x / targetPreviewPageSize.width
        const targetRatioY = targetPoint.y / targetPreviewPageSize.height
        viewportElement.scrollLeft +=
          targetPageRect.left +
          targetPageRect.width * targetRatioX -
          (viewportRect.left + viewportRect.width / 2)
        viewportElement.scrollTop +=
          targetPageRect.top +
          targetPageRect.height * targetRatioY -
          (viewportRect.top + viewportRect.height / 2)
        return
      }
      viewportElement.scrollLeft = -nextTransform.x
      viewportElement.scrollTop = -nextTransform.y
    },
    []
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
      const targetPreviewPageSize = previewPageSizesByPageNumber.get(
        initialTarget.pageNumber
      )
      if (!targetPreviewPageSize) return
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
      const widestRenderedPageSize = getWidestRenderedPageSize(
        pageNumbers,
        previewPageSizesByPageNumber
      )
      if (!widestRenderedPageSize) return
      const contentWidth = widestRenderedPageSize.width
      const lastPageNumber = pageNumbers.at(-1)
      if (lastPageNumber === undefined) return
      const lastPageSize = previewPageSizesByPageNumber.get(lastPageNumber)
      if (!lastPageSize) return
      const contentHeight =
        computePageOriginY(
          lastPageNumber,
          pageNumbers,
          previewPageSizesByPageNumber
        ) + lastPageSize.height

      const pageOriginY = computePageOriginY(
        target.pageNumber,
        pageNumbers,
        previewPageSizesByPageNumber
      )
      const targetPoint = getCroppedPreviewPoint({
        pageSize: targetPageSize,
        crop: resolvePageEdgeCrop(effectiveEdgeCrop, target.pageNumber),
        previewWidth: targetPreviewPageSize.width,
        sourceX: target.centerX,
        sourceY: target.centerY
      })
      const targetContentX = targetPoint.x
      const targetContentY = pageOriginY + targetPoint.y
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

      if (!useVirtualPaper) {
        scrollNativeLayoutToRange({
          targetPageNumber,
          targetPoint,
          targetPreviewPageSize,
          viewportElement,
          viewportRect,
          nextTransform
        })
        return
      }

      setPaperTransform((currentTransform) => ({
        x: nextTransform.x,
        y: nextTransform.y,
        scale: currentTransform.scale
      }))
    },
    [
      clearUnloadTimer,
      effectiveEdgeCrop,
      lazyPageQueue,
      markLoadableWithOverscan,
      overlayRectType,
      pageNumbers,
      pageSizesByPageNumber,
      pageStatuses,
      pinJumpTargetPage,
      previewPageSizesByPageNumber,
      releaseJumpPinnedPage,
      runtimeDocument,
      scrollNativeLayoutToRange,
      useVirtualPaper
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

      const widestPageSize = getWidestRenderedPageSize(
        pageNumbers,
        previewPageSizesByPageNumber
      )
      if (!widestPageSize) return

      const targetPageSize = getKnownPageSize(pageSizesByPageNumber, pageNumber)
      if (!targetPageSize) return
      const targetPreviewPageSize = previewPageSizesByPageNumber.get(pageNumber)
      if (!targetPreviewPageSize) return
      const viewportElement = viewerRootRef.current?.querySelector(
        '.virtual-paper-wrapper'
      )
      if (!(viewportElement instanceof HTMLElement)) return

      const viewportRect = viewportElement.getBoundingClientRect()
      const contentWidth = widestPageSize.width
      const lastPageNumber = pageNumbers.at(-1)
      if (lastPageNumber === undefined) return
      const lastPageSize = previewPageSizesByPageNumber.get(lastPageNumber)
      if (!lastPageSize) return
      const contentHeight =
        computePageOriginY(
          lastPageNumber,
          pageNumbers,
          previewPageSizesByPageNumber
        ) + lastPageSize.height

      const pageOriginY = computePageOriginY(
        pageNumber,
        pageNumbers,
        previewPageSizesByPageNumber
      )
      const { centerX, centerY } = rectCenterToPagePixels(
        rect.rect,
        rect.overlayRectType,
        targetPageSize.width,
        targetPageSize.height
      )
      const targetPoint = getCroppedPreviewPoint({
        pageSize: targetPageSize,
        crop: resolvePageEdgeCrop(effectiveEdgeCrop, pageNumber),
        previewWidth: targetPreviewPageSize.width,
        sourceX: centerX,
        sourceY: centerY
      })
      const targetContentX = targetPoint.x
      const targetContentY = pageOriginY + targetPoint.y

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
      effectiveEdgeCrop,
      lazyPageQueue,
      markLoadableWithOverscan,
      pageNumbers,
      pageSizesByPageNumber,
      pageStatuses,
      pinJumpTargetPage,
      previewPageSizesByPageNumber,
      readerLinkedScopeId,
      releaseJumpPinnedPage,
      runtimeDocument
    ]
  )

  const scrollToPosition = useCallback(
    (position: {
      x: number
      y: number
      scale?: number
    }): VirtualPaperTransform | null => {
      if (!runtimeDocument || pageNumbers.length === 0) return null

      const widestPageSize = getWidestRenderedPageSize(
        pageNumbers,
        previewPageSizesByPageNumber
      )
      if (!widestPageSize) return null

      const viewportElement = viewerRootRef.current?.querySelector(
        '.virtual-paper-wrapper'
      )
      if (!(viewportElement instanceof HTMLElement)) return null

      const viewportRect = viewportElement.getBoundingClientRect()
      const contentWidth = widestPageSize.width
      const lastPageNumber = pageNumbers.at(-1)
      if (lastPageNumber === undefined) return null
      const lastPageSize = previewPageSizesByPageNumber.get(lastPageNumber)
      if (!lastPageSize) return null
      const contentHeight =
        computePageOriginY(
          lastPageNumber,
          pageNumbers,
          previewPageSizesByPageNumber
        ) + lastPageSize.height

      const nextTransform = computeTransformForOffset({
        viewportWidth: viewportRect.width,
        viewportHeight: viewportRect.height,
        contentWidth,
        contentHeight,
        offsetX: position.x,
        offsetY: position.y,
        scale: position.scale ?? effectiveScaleRef.current
      })
      if (!nextTransform) return null

      const resolvedTransform = {
        x: nextTransform.x,
        y: nextTransform.y,
        scale:
          nextTransform.scale ?? position.scale ?? effectiveScaleRef.current
      }
      paperTransformRef.current = resolvedTransform
      setPaperTransform(resolvedTransform)
      return resolvedTransform
    },
    [pageNumbers, previewPageSizesByPageNumber, runtimeDocument]
  )

  useEffect(() => {
    pageStatuses.forEach((status, pageNumber) => {
      if (status !== 'loaded' && status !== 'error') {
        return
      }
      const token = jumpPinTokensRef.current.get(pageNumber)
      if (pendingTextAnchorRef.current?.token === token) {
        return
      }
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
      setParagraphsByPageNumber(deletePageEntry(pageNumber))
      setOcrTextsByPageNumber(deletePageEntry(pageNumber))
      setBaseImagesByPageNumber(deletePageEntry(pageNumber))
      setImagesByPageNumber(deletePageEntry(pageNumber))
      setOrderedContentByPageNumber(deletePageEntry(pageNumber))
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

    getPagePreloadWindow(
      pageNumbers,
      Array.from(currentVisiblePages),
      pagePreloadRadius
    ).forEach((pageNumber) => {
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
    pagePreloadRadius,
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

  const navigateToNativeLayoutPage = useCallback(
    (pageNumber: number): boolean => {
      if (useVirtualPaper) return false

      // 原生滚动视口只消费缩放值，页面平移必须直接修改 scrollTop。
      const viewport = viewerRootRef.current?.querySelector<HTMLElement>(
        '.hamster-reader__native-layout-viewport'
      )
      if (viewport) {
        const viewportRect = viewport.getBoundingClientRect()
        const pageElement = pageRefs.current.get(pageNumber)
        if (pageElement) {
          viewport.scrollTop +=
            pageElement.getBoundingClientRect().top - viewportRect.top
        } else {
          const scale = paperTransformRef.current.scale
          const anchor = findNearestConnectedPage(
            pageNumber,
            pageNumbers,
            pageRefs.current
          )
          if (anchor) {
            const anchorRect = anchor.element.getBoundingClientRect()
            const docDeltaY =
              computePageOriginY(
                pageNumber,
                pageNumbers,
                previewPageSizesByPageNumber
              ) -
              computePageOriginY(
                anchor.pageNumber,
                pageNumbers,
                previewPageSizesByPageNumber
              )
            viewport.scrollTop +=
              anchorRect.top - viewportRect.top + docDeltaY * scale
          }
        }
      }

      currentLayoutPageNumberRef.current = pageNumber
      setCurrentLayoutPageNumber(pageNumber)
      return true
    },
    [pageNumbers, previewPageSizesByPageNumber, useVirtualPaper]
  )

  const navigateToPage = useCallback(
    (pageNumber: number) => {
      cancelPendingTextAnchor()
      setFallbackBookmarkKey(undefined)
      if (!pageNumbers.includes(pageNumber)) return
      initialFitDocumentRef.current = runtimeDocument

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

      if (navigateToNativeLayoutPage(pageNumber)) return

      const nextTransform = scrollToPosition({
        x: 0,
        y: computePageOriginY(
          pageNumber,
          pageNumbers,
          previewPageSizesByPageNumber
        )
      })
      if (nextTransform) {
        lastLocallyEmittedVirtualPaperKeyRef.current =
          getVirtualPaperStateKey(nextTransform)
        onVirtualPaperTransformChangeEnd?.(nextTransform)
      }
    },
    [
      clearUnloadTimer,
      cancelPendingTextAnchor,
      lazyPageQueue,
      markLoadableWithOverscan,
      navigateToNativeLayoutPage,
      pageNumbers,
      pageStatuses,
      pinJumpTargetPage,
      previewPageSizesByPageNumber,
      releaseJumpPinnedPage,
      runtimeDocument,
      scrollToPosition,
      onVirtualPaperTransformChangeEnd
    ]
  )

  const alignTextAnchor = useCallback(
    (operation: PendingTextAnchorOperation): boolean => {
      if (
        pendingTextAnchorRef.current !== operation ||
        operation.runtimeDocument !== runtimeDocument
      ) {
        return false
      }
      const viewport = viewerRootRef.current?.querySelector<HTMLElement>(
        '.virtual-paper-wrapper'
      )
      if (!viewport) return false

      const targetElement = resolveTextAnchorElement(
        operation.anchor,
        textElementsRef.current,
        textsByPageNumber
      )
      if (!targetElement) return false

      const viewportRect = viewport.getBoundingClientRect()
      const targetRect = targetElement.getBoundingClientRect()
      const currentTransform = paperTransformRef.current
      const nextTransform = useVirtualPaper
        ? {
            ...currentTransform,
            y: currentTransform.y + viewportRect.top - targetRect.top
          }
        : currentTransform
      if (useVirtualPaper) {
        paperTransformRef.current = nextTransform
        setPaperTransform(nextTransform)
      } else {
        viewport.scrollTop += targetRect.top - viewportRect.top
      }
      setCurrentTextAnchor(operation.anchor)
      setFallbackBookmarkKey(undefined)
      currentLayoutPageNumberRef.current = operation.anchor.pageNumber
      setCurrentLayoutPageNumber(operation.anchor.pageNumber)
      setPendingTextAnchor(null)
      pendingTextAnchorRef.current = null
      releaseJumpPinnedPage(operation.anchor.pageNumber, operation.token)
      completeNativeProgressRestore(
        operation.source,
        restoringNativeProgressKeyRef
      )
      if (operation.source === 'bookmark') {
        const completedState = { ...nextTransform, anchor: operation.anchor }
        lastLocallyEmittedVirtualPaperKeyRef.current =
          getVirtualPaperStateKey(completedState)
        onVirtualPaperTransformChangeEnd?.(completedState)
      }
      return true
    },
    [
      onVirtualPaperTransformChangeEnd,
      releaseJumpPinnedPage,
      runtimeDocument,
      textsByPageNumber,
      useVirtualPaper
    ]
  )

  const alignTextAnchorPageFallback = useCallback(
    (anchor: ReaderTextAnchor) => {
      if (!useVirtualPaper) {
        const viewport = viewerRootRef.current?.querySelector<HTMLElement>(
          '.hamster-reader__native-layout-viewport'
        )
        const pageElement = pageRefs.current.get(anchor.pageNumber)
        if (viewport && pageElement) {
          viewport.scrollTop +=
            pageElement.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top
        }
        setCurrentTextAnchor(undefined)
        currentLayoutPageNumberRef.current = anchor.pageNumber
        setCurrentLayoutPageNumber(anchor.pageNumber)
        return
      }

      const pageOriginY = computePageOriginY(
        anchor.pageNumber,
        pageNumbers,
        previewPageSizesByPageNumber
      )
      const currentTransform = paperTransformRef.current
      const nextTransform = {
        ...currentTransform,
        y:
          -pageOriginY *
          (scale === undefined
            ? currentTransform.scale
            : clampScale(scale, scaleRange))
      }
      paperTransformRef.current = nextTransform
      setPaperTransform(nextTransform)
      setCurrentTextAnchor(undefined)
      currentLayoutPageNumberRef.current = anchor.pageNumber
      setCurrentLayoutPageNumber(anchor.pageNumber)
    },
    [
      pageNumbers,
      previewPageSizesByPageNumber,
      scale,
      scaleRange,
      useVirtualPaper
    ]
  )

  const completeTextAnchorPageFallback = useCallback(
    (operation: PendingTextAnchorOperation) => {
      if (pendingTextAnchorRef.current !== operation) return

      pendingTextAnchorRef.current = null
      setPendingTextAnchor(null)
      releaseJumpPinnedPage(operation.anchor.pageNumber, operation.token)
      completeNativeProgressRestore(
        operation.source,
        restoringNativeProgressKeyRef
      )
      if (operation.source === 'bookmark') {
        const completedState = {
          ...paperTransformRef.current,
          anchor: operation.anchor
        }
        setFallbackBookmarkKey(getTextAnchorKey(operation.anchor))
        lastLocallyEmittedVirtualPaperKeyRef.current =
          getVirtualPaperStateKey(completedState)
        onVirtualPaperTransformChangeEnd?.(completedState)
      }
    },
    [onVirtualPaperTransformChangeEnd, releaseJumpPinnedPage]
  )

  const navigateToTextAnchor = useCallback(
    (anchor: ReaderTextAnchor, source: 'restore' | 'bookmark' = 'bookmark') => {
      cancelPendingTextAnchor()
      if (
        !pageNumbers.includes(anchor.pageNumber) ||
        pageResourcesDocument !== runtimeDocument
      ) {
        setFallbackBookmarkKey(undefined)
        return
      }

      const token = pinJumpTargetPage(anchor.pageNumber)
      const operation: PendingTextAnchorOperation = {
        anchor,
        runtimeDocument,
        source,
        token
      }
      pendingTextAnchorRef.current = operation
      setPendingTextAnchor(operation)
      setFallbackBookmarkKey(
        source === 'bookmark' ? getTextAnchorKey(anchor) : undefined
      )
      const pageStatus = pageStatuses.get(anchor.pageNumber)
      const pageHasRegistrableText = hasAnchorableText(
        textsByPageNumber.get(anchor.pageNumber)
      )
      if (pageStatus !== 'loaded' || !pageHasRegistrableText) {
        alignTextAnchorPageFallback(anchor)
      }
      clearUnloadTimer(anchor.pageNumber)
      lazilyEvictedPagesRef.current.delete(anchor.pageNumber)
      markLoadableWithOverscan(anchor.pageNumber)

      if (pageStatus !== 'loaded') {
        lazyPageQueue.enqueuePage(anchor.pageNumber)
      } else if (!pageHasRegistrableText) {
        completeTextAnchorPageFallback(operation)
      }
    },
    [
      alignTextAnchorPageFallback,
      cancelPendingTextAnchor,
      clearUnloadTimer,
      completeTextAnchorPageFallback,
      lazyPageQueue,
      markLoadableWithOverscan,
      pageNumbers,
      pageResourcesDocument,
      pageStatuses,
      pinJumpTargetPage,
      runtimeDocument,
      textsByPageNumber
    ]
  )

  const navigateToBookmark = useCallback(
    (bookmark: ReaderBookmark, source: 'restore' | 'bookmark' = 'bookmark') => {
      if (isTextBookmark(bookmark)) {
        navigateToTextAnchor(bookmark, source)
        return
      }
      if (!pageNumbers.includes(bookmark.pageNumber)) return

      cancelPendingTextAnchor()
      const verticalRatio =
        Math.min(100, Math.max(0, bookmark.verticalPercentage)) / 100
      const pageElement = pageRefs.current.get(bookmark.pageNumber)
      if (!useVirtualPaper) {
        const viewport = viewerRootRef.current?.querySelector<HTMLElement>(
          '.hamster-reader__native-layout-viewport'
        )
        if (viewport && pageElement) {
          const pageRect = pageElement.getBoundingClientRect()
          viewport.scrollTop +=
            pageRect.top +
            pageRect.height * verticalRatio -
            viewport.getBoundingClientRect().top
        }
      } else {
        const pageHeight = previewPageSizesByPageNumber.get(
          bookmark.pageNumber
        )?.height
        if (pageHeight === undefined) return
        const currentTransform = paperTransformRef.current
        const viewport = viewerRootRef.current?.querySelector<HTMLElement>(
          '.virtual-paper-wrapper'
        )
        const pageRect = pageElement?.getBoundingClientRect()
        const viewportRect = viewport?.getBoundingClientRect()
        const targetY =
          computePageOriginY(
            bookmark.pageNumber,
            pageNumbers,
            previewPageSizesByPageNumber
          ) +
          pageHeight * verticalRatio
        const nextTransform = {
          ...currentTransform,
          y:
            pageRect && viewportRect && pageRect.height > 0
              ? currentTransform.y +
                viewportRect.top -
                (pageRect.top + pageRect.height * verticalRatio)
              : -targetY * currentTransform.scale
        }
        paperTransformRef.current = nextTransform
        setPaperTransform(nextTransform)
        lastLocallyEmittedVirtualPaperKeyRef.current =
          getVirtualPaperStateKey(nextTransform)
        onVirtualPaperTransformChangeEnd?.(nextTransform)
      }
      currentTextAnchorRef.current = undefined
      setCurrentTextAnchor(undefined)
      setCurrentBookmark(bookmark)
      currentLayoutPageNumberRef.current = bookmark.pageNumber
      setCurrentLayoutPageNumber(bookmark.pageNumber)
      setFallbackBookmarkKey(
        source === 'bookmark' ? getBookmarkKey(bookmark) : undefined
      )
    },
    [
      cancelPendingTextAnchor,
      navigateToTextAnchor,
      onVirtualPaperTransformChangeEnd,
      pageNumbers,
      previewPageSizesByPageNumber,
      useVirtualPaper
    ]
  )

  const requestNativeProgressPageLoad = useCallback(
    (pageNumber: number) => {
      clearUnloadTimer(pageNumber)
      lazilyEvictedPagesRef.current.delete(pageNumber)
      markLoadableWithOverscan(pageNumber)
      lazyPageQueue.enqueuePage(pageNumber)
    },
    [clearUnloadTimer, lazyPageQueue, markLoadableWithOverscan]
  )

  useNativeLayoutReadingProgressRestore({
    cancelPendingProgressRestore,
    effectiveScale,
    layoutReadingProgress,
    navigateToBookmark,
    pageNumbers,
    pageRefs,
    pageResourcesDocument,
    pageStatuses,
    requestPageLoad: requestNativeProgressPageLoad,
    restoringProgressKeyRef: restoringNativeProgressKeyRef,
    runtimeDocument,
    useVirtualPaper,
    viewerRootRef
  })

  useEffect(() => {
    if (!pendingTextAnchor) return
    if (
      pendingTextAnchorRef.current !== pendingTextAnchor ||
      pendingTextAnchor.runtimeDocument !== runtimeDocument
    ) {
      return
    }
    const anchor = pendingTextAnchor.anchor
    const pageStatus = pageStatuses.get(anchor.pageNumber)
    if (pageStatus !== 'loaded' && pageStatus !== 'error') {
      return
    }

    if (pageStatus === 'error') {
      completeTextAnchorPageFallback(pendingTextAnchor)
      return
    }

    const viewerWindow = viewerRootRef.current?.ownerDocument.defaultView
    if (!viewerWindow) {
      if (!alignTextAnchor(pendingTextAnchor) && pageStatus === 'loaded') {
        completeTextAnchorPageFallback(pendingTextAnchor)
      }
      return
    }

    const frameId = viewerWindow.requestAnimationFrame(() => {
      if (!alignTextAnchor(pendingTextAnchor) && pageStatus === 'loaded') {
        completeTextAnchorPageFallback(pendingTextAnchor)
      }
    })
    return () => viewerWindow.cancelAnimationFrame(frameId)
  }, [
    alignTextAnchor,
    completeTextAnchorPageFallback,
    pageStatuses,
    pendingTextAnchor,
    runtimeDocument
  ])

  useEffect(() => {
    const defaultAnchor = defaultVirtualPaperTransform?.anchor
    if (!defaultAnchor) {
      if (
        appliedDefaultTextAnchorRef.current?.runtimeDocument === runtimeDocument
      ) {
        cancelPendingTextAnchor()
        setFallbackBookmarkKey(undefined)
        appliedDefaultTextAnchorRef.current = null
      }
      return
    }
    if (pageResourcesDocument !== runtimeDocument) return

    const key = getTextAnchorKey(defaultAnchor)
    const appliedDefaultAnchor = appliedDefaultTextAnchorRef.current
    if (
      appliedDefaultAnchor?.runtimeDocument === runtimeDocument &&
      appliedDefaultAnchor.key === key
    ) {
      return
    }
    appliedDefaultTextAnchorRef.current = { runtimeDocument, key }
    if (
      defaultVirtualPaperStateKey.length > 0 &&
      lastLocallyEmittedVirtualPaperKeyRef.current ===
        defaultVirtualPaperStateKey
    ) {
      appliedDefaultTextAnchorRef.current = { runtimeDocument, key }
      return
    }
    navigateToTextAnchor(defaultAnchor, 'restore')
  }, [
    defaultVirtualPaperTransform?.anchor,
    defaultVirtualPaperStateKey,
    cancelPendingTextAnchor,
    navigateToTextAnchor,
    pageResourcesDocument,
    runtimeDocument
  ])

  useEffect(() => {
    if (
      defaultVirtualPaperStateKey.length > 0 &&
      lastLocallyEmittedVirtualPaperKeyRef.current ===
        defaultVirtualPaperStateKey
    ) {
      lastLocallyEmittedVirtualPaperKeyRef.current = ''
    }
  }, [defaultVirtualPaperStateKey])

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
          textElementsRef.current.set(text.id, { text, pageNumber, element })
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

  const toLayoutRange = useCallback(
    (range: ReaderSelectionRange): ReaderSelectionRange =>
      isEpub ? { ...range, rectsBySelectionId: {} } : range,
    [isEpub]
  )
  const publicActiveSelection = runtimeLinkedData.activeRange
    ? mapRuntimeRangeToPublic(
        runtimeLinkedData.activeRange,
        readerLinkedScopeId
      )
    : null
  const activeSelection = publicActiveSelection
    ? toLayoutRange(publicActiveSelection)
    : null
  let resolvedSelectionPopover: ReactNode
  if (typeof selectionPopover === 'function') {
    resolvedSelectionPopover = activeSelection
      ? selectionPopover(activeSelection)
      : undefined
  } else {
    resolvedSelectionPopover = selectionPopover
  }

  const handleLinkedDataChange = useCallback(
    (next: LinkedSelectionData) => {
      const runtimePublicLinkedData = mapRuntimeLinkedDataToPublic(
        next,
        readerLinkedScopeId
      )
      const publicLinkedData: ReaderLinkedSelectionData = {
        ...runtimePublicLinkedData,
        items: runtimePublicLinkedData.items.map(toLayoutRange),
        activeRange: runtimePublicLinkedData.activeRange
          ? toLayoutRange(runtimePublicLinkedData.activeRange)
          : runtimePublicLinkedData.activeRange
      }

      const nextTransient = extractRuntimeLinkedTransient(next)
      setRuntimeLinkedTransientState((currentState) => {
        if (
          currentState.scope === selectionScope &&
          areRuntimeLinkedTransientsEqual(currentState.transient, nextTransient)
        ) {
          return currentState
        }
        return { scope: selectionScope, transient: nextTransient }
      })
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
      readerLinkedScopeId,
      selectionScope,
      toLayoutRange
    ]
  )

  const handleLinkedSelect = useCallback(
    (range: LinkedSelectionRange) => {
      const publicRange = mapRuntimeRangeToPublic(range, readerLinkedScopeId)

      if (publicRange) {
        const layoutRange = toLayoutRange(publicRange)
        onLinkedSelect?.(layoutRange)
        emitLinkedSelectOnce(layoutRange)
        emitPendingLinkedHighlight(layoutRange)
      }
    },
    [
      emitLinkedSelectOnce,
      emitPendingLinkedHighlight,
      onLinkedSelect,
      readerLinkedScopeId,
      toLayoutRange
    ]
  )

  const handleLinkedUpdateRange = useCallback(
    (range: LinkedSelectionRange) => {
      const publicRange = mapRuntimeRangeToPublic(range, readerLinkedScopeId)

      if (publicRange) {
        const layoutRange = toLayoutRange(publicRange)
        onLinkedUpdateRange?.(layoutRange)
        onUpdateRange?.(layoutRange)
      }
    },
    [onLinkedUpdateRange, onUpdateRange, readerLinkedScopeId, toLayoutRange]
  )

  const handleLinkedSelectRange = useCallback(
    (id: string | null) => {
      if (!isSelectedRangeIdControlled) {
        setInternalSelectedRangeId(id)
      }
      syncAnnotationHistorySnapshot(
        makeAnnotationHistorySnapshot(
          storedRangesRef.current,
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
          const preloadPageNumbers = getPagePreloadWindow(
            pageNumbers,
            [pageNumber],
            pagePreloadRadius
          )
          for (const preloadPageNumber of preloadPageNumbers) {
            clearUnloadTimer(preloadPageNumber)
            lazilyEvictedPagesRef.current.delete(preloadPageNumber)
          }
          scheduleVisibilityEnqueue(pageNumber)
        } else {
          markHiddenPage(pageNumber)
          cancelVisibilityEnqueue(pageNumber)
          getPagePreloadWindow(
            pageNumbers,
            [pageNumber],
            pagePreloadRadius
          ).forEach(schedulePageUnload)
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
    pagePreloadRadius,
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

  const isOcrEnabled =
    ocr === true || (typeof ocr === 'object' && ocr?.enabled === true)
  // 手动模式：ocr.pages 存在时仅识别/展示列表内页码（1-based 正整数）
  const manualOcrPages =
    typeof ocr === 'object' && ocr !== null && Array.isArray(ocr.pages)
      ? ocr.pages.filter((page) => Number.isInteger(page) && page > 0)
      : undefined
  const loadedOcrPages = useMemo(
    () =>
      Array.from(pageStatuses.entries())
        .filter(([, status]) => status === 'loaded')
        .map(([pageNumber]) => pageNumber)
        .sort((a, b) => a - b),
    [pageStatuses]
  )

  // 合并受控 OCR 数据与内部识别结果：受控数据优先；
  // 手动模式仅保留 pages 列表内的页面；全局关闭时不渲染任何 OCR 文本。
  // 显示颜色在渲染边界统一覆盖：默认透明（隐形文本层），
  // 开发调试模式（ocrDebug）下为黑色 50% 透明度（红色外框由根节点修饰类提供），
  // 不回写存储/缓存中的文本数据。
  const resolvedOcrTextsByPageNumber = useMemo(() => {
    const resolved = new Map<number, IntermediateText[]>()
    if (!isOcrEnabled) {
      return resolved
    }

    const displayColor = ocrDebug ? 'rgba(0, 0, 0, 0.5)' : 'transparent'
    const mergePage = (pageNumber: number) => {
      const texts =
        controlledOcrTexts?.[pageNumber] ?? ocrTextsByPageNumber.get(pageNumber)
      if (texts && texts.length > 0) {
        resolved.set(
          pageNumber,
          texts.map((text) => ({ ...text, color: displayColor }))
        )
      }
    }

    if (manualOcrPages) {
      manualOcrPages.forEach(mergePage)
      return resolved
    }

    ocrTextsByPageNumber.forEach((_texts, pageNumber) => {
      mergePage(pageNumber)
    })
    if (controlledOcrTexts) {
      Object.keys(controlledOcrTexts).forEach((key) => {
        mergePage(Number(key))
      })
    }
    return resolved
    // manualOcrPages 由 ocr 派生，父组件行内传入时引用每次渲染都会变化；
    // 合并逻辑开销极小，重复计算可接受。
  }, [
    isOcrEnabled,
    manualOcrPages,
    controlledOcrTexts,
    ocrTextsByPageNumber,
    ocrDebug
  ])

  // OCR 关闭清理：全局关闭（enabled=false）清空全部内部 OCR 展示与缓存；
  // 手动模式下从 pages 列表移除的页视为按页关闭 —— 丢弃在途结果（bump 代际）、
  // 标记缓存失效，重新开启时会重新识别（除非宿主持有受控数据）。
  useEffect(() => {
    if (!runtimeDocument) {
      return
    }

    if (!isOcrEnabled) {
      ocrLoadingPagesRef.current.forEach(bumpOcrEvictGeneration)
      ocrLoadingPagesRef.current.clear()
      setOcrLoadingPages(new Set())
      ocrCacheRef.current.clear()
      ocrFailedPagesRef.current.clear()
      setOcrTextsByPageNumber((currentTexts) =>
        currentTexts.size > 0 ? new Map() : currentTexts
      )
      return
    }

    if (!manualOcrPages) {
      return
    }

    const activePages = new Set(manualOcrPages)
    const closedPages = new Set<number>()
    ocrTextsByPageNumber.forEach((_texts, pageNumber) => {
      if (!activePages.has(pageNumber)) {
        closedPages.add(pageNumber)
      }
    })
    ocrLoadingPagesRef.current.forEach((pageNumber) => {
      if (!activePages.has(pageNumber)) {
        closedPages.add(pageNumber)
      }
    })
    ocrFailedPagesRef.current.forEach((pageNumber) => {
      if (!activePages.has(pageNumber)) {
        closedPages.add(pageNumber)
      }
    })

    closedPages.forEach((pageNumber) => {
      bumpOcrEvictGeneration(pageNumber)
      evictedOcrPagesRef.current.add(pageNumber)
      ocrFailedPagesRef.current.delete(pageNumber)
      removeOcrLoadingPage(pageNumber)
      setOcrTextsByPageNumber(deletePageEntry(pageNumber))
    })
  }, [
    isOcrEnabled,
    manualOcrPages,
    runtimeDocument,
    ocrTextsByPageNumber,
    bumpOcrEvictGeneration,
    removeOcrLoadingPage
  ])

  useEffect(() => {
    if (!isOcrEnabled || !runtimeDocument) {
      return
    }
    if (ocrActivePage !== null || ocrActivePageRef.current !== null) {
      return
    }

    const targetPages = manualOcrPages ?? loadedOcrPages
    const pageNumber = targetPages.find(
      (targetPageNumber) =>
        !controlledOcrTexts?.[targetPageNumber] &&
        !ocrTextsByPageNumber.has(targetPageNumber) &&
        !ocrLoadingPagesRef.current.has(targetPageNumber) &&
        !ocrFailedPagesRef.current.has(targetPageNumber)
    )
    if (pageNumber === undefined) {
      return
    }

    ocrActivePageRef.current = pageNumber
    setOcrActivePage(pageNumber)
    addOcrLoadingPage(pageNumber)
    // 捕获本次 OCR 发起时该页的驱逐代际，resolve 时比对以识别 stale 结果。
    const ocrRunGeneration = ocrEvictGenerationRef.current.get(pageNumber) ?? 0
    const isRunAborted = () =>
      !isMountedRef.current ||
      activeDocumentRef.current !== runtimeDocument ||
      (ocrEvictGenerationRef.current.get(pageNumber) ?? 0) !== ocrRunGeneration

    const startedAt = getRenderTimingNow()
    const runOcr = async () => {
      try {
        // 向 parser 重新请求原尺寸（scale=1）页面图像用于 OCR；
        // 不复用展示缩略图（baseImagesByPageNumber，按当前缩放渲染）。
        const page = await runtimeDocument.getPageByPageNumber(pageNumber)
        const ocrImageSource = page
          ? await getBaseImageFromPage(page, OCR_IMAGE_SCALE)
          : undefined

        if (!ocrImageSource) {
          throw new Error(`OCR image is unavailable for page ${pageNumber}`)
        }

        if (isRunAborted()) {
          return
        }

        const cacheKey = getOcrCacheKey(
          runtimeDocument.id,
          pageNumber,
          ocrImageSource
        )
        const cachedTexts = ocrCacheRef.current.get(cacheKey)
        const shouldBypassCache = evictedOcrPagesRef.current.has(pageNumber)

        if (cachedTexts && !shouldBypassCache) {
          setOcrTextsByPageNumber(
            createSetTextsHandler(pageNumber, cachedTexts)
          )
          onOcrTextsChange?.(pageNumber, cachedTexts)
          return
        }

        const ocrContent = await fetchOcrContent(ocrImageSource, extraOCR)
        const ocrTexts = prefixOcrTextIds(
          ocrContent.filter(isIntermediateText),
          pageNumber
        )

        if (isRunAborted()) {
          return
        }

        ocrCacheRef.current.set(cacheKey, ocrTexts)
        evictedOcrPagesRef.current.delete(pageNumber)
        // 始终写入内部 state 防止受控回传前的空窗期重复触发 OCR；
        // 渲染时受控 ocrTexts 优先，宿主可随时用规范化数据覆盖。
        setOcrTextsByPageNumber(createSetTextsHandler(pageNumber, ocrTexts))
        onOcrTextsChange?.(pageNumber, ocrTexts)
      } catch (error) {
        if (isRunAborted()) {
          return
        }
        // 标记失败页，避免 effect 重跑造成无限重试；重新开启该页 OCR 时可再试
        ocrFailedPagesRef.current.add(pageNumber)
        onOcrError?.(error, { pageNumber })
        // 没有 onOcrError 时静默吞掉，避免在生产代码中遗留日志输出；
        // 调用方需要可观测性时应主动传入 onOcrError 回调。
      } finally {
        if (!isRunAborted()) {
          const endedAt = getRenderTimingNow()
          renderTimingRef.current.record({
            stage: 'ocr-processing',
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            pageNumber
          })
        }
        if (ocrActivePageRef.current === pageNumber) {
          ocrActivePageRef.current = null
        }
        if (isMountedRef.current) {
          removeOcrLoadingPage(pageNumber)
          setOcrActivePage(null)
        }
      }
    }

    runOcr()
  }, [
    isOcrEnabled,
    manualOcrPages,
    loadedOcrPages,
    runtimeDocument,
    extraOCR,
    onOcrError,
    onOcrTextsChange,
    controlledOcrTexts,
    ocrTextsByPageNumber,
    ocrActivePage,
    addOcrLoadingPage,
    removeOcrLoadingPage
  ])

  const rootClassName = buildViewerRootClassName(ocrDebug, className)

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
      selectionScope={selectionScope}
      pageNumbers={pageNumbers}
      hiddenPageNumbers={hiddenPageNumbers}
      fontScale={fontScale}
      edgeCrop={edgeCrop}
      edgeCropEditing={edgeCropEditing}
      onEdgeCropApply={onEdgeCropApply}
      onEdgeCropHidePage={onEdgeCropHidePage}
      pageSizesByPageNumber={pageSizesByPageNumber}
      flowLayoutPages={flowLayoutPages}
      orderedContentByPageNumber={orderedContentByPageNumber}
      virtualPaperTransform={virtualPaperTransform}
      useVirtualPaper={useVirtualPaper}
      nativeLayoutZoom={nativeLayoutZoom}
      committedReaderScale={committedReaderScale}
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
      storedRanges={storedRanges}
      effectiveRanges={effectiveRanges}
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
      showSelectionMagnifier={showSelectionMagnifier}
      selectionPopover={resolvedSelectionPopover}
      highlightPopover={highlightPopover}
      rectPopover={resolvedRectPopover}
      onCommentHighlight={onCommentHighlight}
      onDragHighlight={onDragHighlight}
      autoHighlight={autoHighlight}
      overlayRectType={overlayRectType}
      selectionRef={selectionRef}
      tool={tool}
      rects={runtimeRects}
      selectedRectId={effectiveSelectedRectId}
      onCreateRect={handleCreateRect}
      onSelectRect={handleSelectRect}
      onUpdateRect={handleUpdateRect}
      onRemoveRange={onRemoveRange}
      onRemoveRect={onRemoveRect}
      annotationHistoryController={annotationHistoryController}
      onClearAnnotationHistory={clearAnnotationHistory}
      onRunAnnotationHistory={runAnnotationHistory}
      setPageRef={setPageRef}
      setTextRef={setTextRef}
      textsByPageNumber={textsByPageNumber}
      paragraphsByPageNumber={paragraphsByPageNumber}
      ocrTextsByPageNumber={resolvedOcrTextsByPageNumber}
      ocrLoadingPages={ocrLoadingPages}
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
      paintingControllerData={resolvedPaintingControllerData}
      onPaintingControllerDataChange={handlePaintingControllerDataChange}
      pagePaintings={pagePaintings}
      onPagePaintingChange={onPagePaintingChange}
      drawingScale={virtualPaperTransform.scale}
      showPageBrowser={showPageBrowser}
      previewEnabled={isPdf}
      onPageBrowserClose={onPageBrowserClose}
      onPageBrowserVisibilityChange={handlePageBrowserVisibilityChange}
      onNavigateToPage={navigateToPage}
      themeColor={themeColor}
      visiblePageNumbers={visiblePages}
      commentCountByRangeId={effectiveCommentCountByRangeId}
      commentCountByRectId={commentCountByRectId}
      bookmarks={bookmarks}
      currentBookmark={currentBookmark}
      currentPageNumber={currentLayoutPageNumber}
      activeBookmarkKey={activeBookmarkKey}
      onNavigateToBookmark={resolveBookmarkNavigationHandler(
        bookmarks,
        onToggleBookmark,
        navigateToBookmark
      )}
      onDragBookmark={onDragBookmark}
      onToggleBookmark={onToggleBookmark}
      bookmarkedPageNumbers={bookmarkedPageNumbers}
      onTogglePageBookmark={onTogglePageBookmark}
      onViewportPositionChange={handleViewportPositionChange}
      popoverRelative={popoverRelative}
    />
  )
}
