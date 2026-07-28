import type { ReaderSelectionRange } from '../../types/selection'

export const HIGHLIGHT_DEBUG_STORAGE_KEY = 'hamster-reader:debug-highlights'

const HIGHLIGHT_DEBUG_PREFIX = '[hamster-reader:highlight]'

export type HighlightDebugEvent =
  | 'demo.callback.highlight'
  | 'demo.callback.linked-data'
  | 'demo.callback.select'
  | 'demo.history.change'
  | 'demo.storage.write'
  | 'layout.geometry'
  | 'layout.writeback'
  | 'mode.render'
  | 'text.callback.linked-data'
  | 'text.callback.select'
  | 'text.callback.update'
  | 'text.geometry'

export function traceHighlight(
  event: HighlightDebugEvent,
  detail: Readonly<Record<string, unknown>>
): void {
  if (typeof window === 'undefined') return

  try {
    if (window.localStorage.getItem(HIGHLIGHT_DEBUG_STORAGE_KEY) !== '1') {
      return
    }
  } catch {
    return
  }

  // 这是显式开启的诊断流，使用 DevTools 默认可见的 Info 级别，
  // 避免 `console.debug` 被 Chrome 的 Verbose 过滤器静默隐藏。
  console.info(HIGHLIGHT_DEBUG_PREFIX, { event, ...detail })
}

export function summarizeHighlightRanges(
  ranges: readonly ReaderSelectionRange[]
): readonly Readonly<Record<string, unknown>>[] {
  return ranges.map((range) => ({
    id: range.id,
    start: range.start,
    end: range.end,
    overlayRectType: range.overlayRectType,
    rects: Object.entries(range.rectsBySelectionId).map(
      ([selectionId, rects]) => ({
        selectionId,
        count: rects.length,
        first: rects[0] ?? null
      })
    )
  }))
}
