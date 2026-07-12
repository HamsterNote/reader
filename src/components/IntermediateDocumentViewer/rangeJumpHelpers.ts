/**
 * Pure range-jump helpers for public page ids and rect units.
 *
 * Given a range id and the public ReaderSelectionRange[],
 * these helpers return a jump target { pageNumber, centerX, centerY }
 * or null for no-op.  No React hooks or DOM access.
 */

import type {
  ReaderSelectionRange,
  ReaderSelectionRect
} from '../../types/selection'

// ── Types ────────────────────────────────────────────────────────────

export type RangeJumpTarget = {
  /** 1-based public page number parsed from the page-N id. */
  readonly pageNumber: number
  /** Horizontal center in page-local pixels. */
  readonly centerX: number
  /** Vertical center in page-local pixels. */
  readonly centerY: number
}

// ── Public page-id parsing ───────────────────────────────────────────

/** Parse a public `page-N` id → 1-based page number, or null for malformed ids. */
export function parsePublicPageId(pageId: string): number | null {
  const match = /^page-(\d+)$/.exec(pageId)
  if (!match) {
    return null
  }
  const n = Number(match[1])
  // Page numbers must be positive integers.
  return n >= 1 && Number.isInteger(n) ? n : null
}

// ── Range lookup ─────────────────────────────────────────────────────

/**
 * Find a range by its public `id` in the ranges array.
 * Returns null when no range matches.
 */
export function findRangeById(
  ranges: readonly ReaderSelectionRange[],
  rangeId: string
): ReaderSelectionRange | null {
  return ranges.find((r) => r.id === rangeId) ?? null
}

// ── Rect selection ───────────────────────────────────────────────────

type SelectedRect = {
  readonly rect: ReaderSelectionRect
  /** Page id that owns this rect (e.g. "page-3"). */
  readonly pageId: string
}

/**
 * Choose the best rect for jumping.
 *
 * Strategy (deterministic):
 *  1. First rect under `range.start.selectionId` when that key exists.
 *  2. Otherwise first rect from the first key in sorted key order.
 *
 * Returns null when rectsBySelectionId is empty or contains only empty arrays.
 */
export function selectTargetRect(
  range: ReaderSelectionRange
): SelectedRect | null {
  const { rectsBySelectionId, start } = range
  const startId = start.selectionId

  // 1. Prefer rects under the start selection id.
  const startRects = rectsBySelectionId[startId]
  if (startRects && startRects.length > 0) {
    return { rect: startRects[0], pageId: startId }
  }

  // 2. Fallback: first available rect from the first key in stable sorted order.
  const sortedKeys = Object.keys(rectsBySelectionId).sort()
  for (const key of sortedKeys) {
    const rects = rectsBySelectionId[key]
    if (rects && rects.length > 0) {
      return { rect: rects[0], pageId: key }
    }
  }

  return null
}

// ── Coordinate conversion ────────────────────────────────────────────

/**
 * Convert a rect's center from either percent (0-100) or px units
 * to page-local pixel coordinates.
 *
 * @param rect       The overlay rect (x, y, width, height).
 * @param rectType   'percent' treats x/y/width/height as 0-100;
 *                   'px' treats them as page-local pixels.
 * @param pageWidth  Page width in pixels.
 * @param pageHeight Page height in pixels.
 */
export function rectCenterToPagePixels(
  rect: ReaderSelectionRect,
  rectType: 'percent' | 'px',
  pageWidth: number,
  pageHeight: number
): { centerX: number; centerY: number } {
  if (rectType === 'percent') {
    return {
      centerX: ((rect.x + rect.width / 2) / 100) * pageWidth,
      centerY: ((rect.y + rect.height / 2) / 100) * pageHeight
    }
  }
  // px — already page-local pixels
  return {
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height / 2
  }
}

// ── Main entry point ─────────────────────────────────────────────────

export type ResolveRangeJumpTargetParams = {
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rangeId: string
  /** Rect unit type to apply; falls back to range.overlayRectType then 'percent'. */
  readonly rectType?: 'percent' | 'px'
  readonly pageWidth: number
  readonly pageHeight: number
}

/**
 * Resolve a range id to a concrete page-local jump target.
 *
 * Flow:
 *  1. Find the range by id → null if not found.
 *  2. Select the best rect (start page → fallback) → null if no rects.
 *  3. Parse the page id to a 1-based page number → null if malformed.
 *  4. Convert the rect center to page-local pixels.
 */
export function resolveRangeJumpTarget(
  params: ResolveRangeJumpTargetParams
): RangeJumpTarget | null {
  const { ranges, rangeId, pageWidth, pageHeight } = params

  // 1. Find range.
  const range = findRangeById(ranges, rangeId)
  if (!range) {
    return null
  }

  // 2. Select target rect.
  const selected = selectTargetRect(range)
  if (!selected) {
    return null
  }

  // 3. Parse page id.
  const pageNumber = parsePublicPageId(selected.pageId)
  if (pageNumber === null) {
    return null
  }

  // 4. Resolve rect unit type: explicit param → range overlay → 'percent'.
  const resolvedType = params.rectType ?? range.overlayRectType ?? 'percent'

  // 5. Convert center.
  const { centerX, centerY } = rectCenterToPagePixels(
    selected.rect,
    resolvedType,
    pageWidth,
    pageHeight
  )

  return { pageNumber, centerX, centerY }
}

// ── VirtualPaper content-coordinate transform helpers ────────────────

/**
 * A VirtualPaper transform: `{ x, y, scale }`.
 * Applied as `translate3d(x, y, 0) scale(scale)` on the content container.
 */
export type VirtualPaperTransform = {
  readonly x: number
  readonly y: number
  readonly scale: number
}

/** Page layout gap between adjacent pages (from reader.scss intermediate pages). */
const PAGE_GAP_PX = 16

/**
 * Compute the content-space origin (top-left) of a page by summing the
 * heights of preceding pages and inter-page gaps.  X is 0 because the
 * `.hamster-note-document` flex-column centers pages horizontally
 * relative to the widest page (content coordinate 0 = left edge of the
 * widest page, not necessarily the target page — but for transform
 * clamping we only need the vertical origin; horizontal centering is
 * handled by the page-local `targetCenterX`).
 *
 * This is the deterministic fallback for jsdom and zero-layout cases
 * where real DOM measurement is unavailable.
 */
export function computePageOriginY(
  pageNumber: number,
  pageNumbers: readonly number[],
  pageSizesByPageNumber: ReadonlyMap<number, { width: number; height: number }>
): number {
  let originY = 0

  for (const pn of pageNumbers) {
    if (pn === pageNumber) {
      break
    }
    const size = pageSizesByPageNumber.get(pn)
    originY += (size?.height ?? 0) + PAGE_GAP_PX
  }

  return originY
}

export type ComputeTransformParams = {
  /** Viewport width in CSS pixels (the VirtualPaper wrapper element). */
  readonly viewportWidth: number
  /** Viewport height in CSS pixels. */
  readonly viewportHeight: number
  /** Content element total width in CSS pixels (pre-scale). */
  readonly contentWidth: number
  /** Content element total height in CSS pixels (pre-scale). */
  readonly contentHeight: number
  /** Content-space X coordinate to center on. */
  readonly targetContentX: number
  /** Content-space Y coordinate to center on. */
  readonly targetContentY: number
  /** Scale to apply. */
  readonly scale: number
}

/**
 * Compute a VirtualPaper transform that centers `(targetContentX,
 * targetContentY)` in the viewport, clamped to VirtualPaper contain
 * semantics.
 *
 * Math:
 *   screen = content * scale + translate
 *   → translate = viewportCenter - targetContent * scale
 *
 * Contain clamping per axis:
 *   - If scaledContentSize ≤ viewportSize → center the content:
 *       translate = (viewportSize - scaledContentSize) / 2
 *   - Otherwise → clamp so content edges stay visible:
 *       translate ∈ [viewportSize - scaledContentSize, 0]
 *
 * Returns `null` when inputs are invalid (zero, negative, non-finite).
 */
export function computeTransform(
  params: ComputeTransformParams
): VirtualPaperTransform | null {
  const {
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    targetContentX,
    targetContentY,
    scale
  } = params

  // Guard: all dimensions and scale must be positive finite numbers.
  if (
    !(
      viewportWidth > 0 &&
      viewportHeight > 0 &&
      contentWidth > 0 &&
      contentHeight > 0 &&
      scale > 0 &&
      Number.isFinite(targetContentX) &&
      Number.isFinite(targetContentY)
    )
  ) {
    return null
  }

  const scaledW = contentWidth * scale
  const scaledH = contentHeight * scale

  // Raw translate: center the target in the viewport.
  const rawX = viewportWidth / 2 - targetContentX * scale
  const rawY = viewportHeight / 2 - targetContentY * scale

  // Contain clamping.
  const tx =
    scaledW <= viewportWidth
      ? (viewportWidth - scaledW) / 2
      : Math.min(0, Math.max(viewportWidth - scaledW, rawX))
  const ty =
    scaledH <= viewportHeight
      ? (viewportHeight - scaledH) / 2
      : Math.min(0, Math.max(viewportHeight - scaledH, rawY))

  return { x: tx, y: ty, scale }
}

export type ComputeTransformForOffsetParams = {
  /** Viewport width in CSS pixels (the VirtualPaper wrapper element). */
  readonly viewportWidth: number
  /** Viewport height in CSS pixels. */
  readonly viewportHeight: number
  /** Content element total width in CSS pixels (pre-scale). */
  readonly contentWidth: number
  /** Content element total height in CSS pixels (pre-scale). */
  readonly contentHeight: number
  /** Content-space X scroll offset (0 = left edge). */
  readonly offsetX: number
  /** Content-space Y scroll offset (0 = top edge). */
  readonly offsetY: number
  /** Scale to apply. */
  readonly scale: number
}

/**
 * Compute a VirtualPaper transform that places content-space `(offsetX,
 * offsetY)` at the viewport top-left, clamped to VirtualPaper contain
 * semantics.
 *
 * Math:
 *   screen = content * scale + translate
 *   To align content point (offsetX, offsetY) with viewport top-left:
 *     translate = -(offsetX, offsetY) * scale
 *
 * Contain clamping per axis:
 *   - If scaledContentSize ≤ viewportSize → center the content.
 *   - Otherwise → clamp so content edges stay visible:
 *       translate ∈ [viewportSize - scaledContentSize, 0]
 *
 * Returns `null` when inputs are invalid (zero, negative, non-finite).
 */
export function computeTransformForOffset(
  params: ComputeTransformForOffsetParams
): VirtualPaperTransform | null {
  const {
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    offsetX,
    offsetY,
    scale
  } = params

  if (
    !(
      viewportWidth > 0 &&
      viewportHeight > 0 &&
      contentWidth > 0 &&
      contentHeight > 0 &&
      scale > 0 &&
      Number.isFinite(offsetX) &&
      Number.isFinite(offsetY)
    )
  ) {
    return null
  }

  const scaledW = contentWidth * scale
  const scaledH = contentHeight * scale

  // Raw translate: align requested content offset with viewport top-left.
  const rawX = -offsetX * scale
  const rawY = -offsetY * scale

  // Contain clamping.
  const tx =
    scaledW <= viewportWidth
      ? (viewportWidth - scaledW) / 2
      : Math.min(0, Math.max(viewportWidth - scaledW, rawX))
  const ty =
    scaledH <= viewportHeight
      ? (viewportHeight - scaledH) / 2
      : Math.min(0, Math.max(viewportHeight - scaledH, rawY))

  return { x: tx, y: ty, scale }
}
