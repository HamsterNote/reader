import { describe, expect, it } from 'vitest'

import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryChangeSource,
  ReaderAnnotationHistoryOptions,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue,
  ReaderInteractiveProps,
  ReaderLinkedSelectionRange,
  ReaderPageRectSelectionMap,
  ReaderPageTextSelectionMap,
  ReaderProps,
  ReaderRenderMode,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderTouchPanMode
} from '../src'

type AssertFalse<Value extends false> = Value
type AssertTrue<Value extends true> = Value

type LegacySelectionRangeFixture = {
  readonly id: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly createdAt: number
  readonly rects: readonly [
    {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  ]
}

type LegacyRangeAssignableToReaderRange =
  LegacySelectionRangeFixture extends ReaderSelectionRange ? true : false

const legacyRangeRejected: AssertFalse<LegacyRangeAssignableToReaderRange> = false

const linkedRange = {
  id: 'r1',
  text: 't',
  start: { selectionId: 'page-2', offset: 0 },
  end: { selectionId: 'page-2', offset: 5 },
  createdAt: 1,
  rectsBySelectionId: {
    'page-2': [{ x: 1, y: 2, width: 3, height: 4 }]
  }
} satisfies ReaderSelectionRange

const linkedRangeAlias: ReaderLinkedSelectionRange = linkedRange

/**
 * GREEN 合约测试（T2 text-render-mode）：ReaderProps 现在重新接受 renderMode 属性，
 * 类型为 ReaderRenderMode ('layout' | 'text')。
 * 历史 commit bb8cd89 曾移除旧版 render modes 并用 RED 测试锁定移除；
 * T2 以新的 'layout' | 'text' 设计重新引入，此测试随之翻转为 GREEN。
 */
type RenderModeInReaderProps = 'renderMode' extends keyof ReaderProps
  ? true
  : false
const _renderModeAccepted: RenderModeInReaderProps = true

const _renderModeValue: ReaderRenderMode = 'layout'
const _readerPropsRenderMode: ReaderProps['renderMode'] = _renderModeValue

/**
 * GREEN 合约测试：touchPanMode 是 ReaderProps 和 ReaderInteractiveProps 的已知键，
 * 并且其值类型为 ReaderTouchPanMode。
 */
type TouchPanModeInReaderProps = 'touchPanMode' extends keyof ReaderProps
  ? true
  : false
const _touchPanModeAccepted: TouchPanModeInReaderProps = true

type TouchPanModeInInteractiveProps =
  'touchPanMode' extends keyof ReaderInteractiveProps ? true : false
const _touchPanModeInteractiveAccepted: TouchPanModeInInteractiveProps = true

const _touchPanModeValue: ReaderTouchPanMode = 'two-finger'
const _readerPropsTouchPanMode: ReaderProps['touchPanMode'] = _touchPanModeValue

const _legacyPageSelectionProps: ReaderProps = {
  pageTextSelections: {} satisfies ReaderPageTextSelectionMap,
  pageRectSelections: {} satisfies ReaderPageRectSelectionMap,
  onPageTextSelectionsChange: () => {},
  onPageRectSelectionsChange: () => {}
}

const _drawingInteractiveProps: ReaderInteractiveProps = {
  selectedTool: 'drawing',
  pagePaintings: {},
  onPagePaintingsChange: () => {}
}

const _highlightCommentProps: ReaderInteractiveProps = {
  containMarginTop: 24,
  containMarginBottom: 48,
  highlightPopover: (highlight) => highlight.text,
  onCommentHighlight: async (highlight) => highlight
}

const _bookmarkInteractiveProps: ReaderInteractiveProps = {
  bookmarkedPageNumbers: [1, 3],
  onTogglePageBookmark: () => {}
}

type AnnotationHistoryKeys = keyof ReaderAnnotationHistoryValue
type AnnotationHistoryExpectedKeys =
  | 'ranges'
  | 'rects'
  | 'selectedRangeId'
  | 'selectedRectId'
type AnnotationHistoryHasOnlyExpectedKeys =
  Exclude<AnnotationHistoryKeys, AnnotationHistoryExpectedKeys> extends never
    ? true
    : false
type AnnotationHistoryHasExpectedKeys =
  Exclude<AnnotationHistoryExpectedKeys, AnnotationHistoryKeys> extends never
    ? true
    : false
type AnnotationHistoryHasNoPagePaintings =
  'pagePaintings' extends AnnotationHistoryKeys ? false : true

const _annotationHistoryOnlyExpectedKeys: AssertTrue<AnnotationHistoryHasOnlyExpectedKeys> = true
const _annotationHistoryExpectedKeys: AssertTrue<AnnotationHistoryHasExpectedKeys> = true
const _annotationHistoryHasNoPagePaintings: AssertTrue<AnnotationHistoryHasNoPagePaintings> = true

const _annotationHistoryValue: ReaderAnnotationHistoryValue = {
  ranges: [linkedRange],
  rects: [
    {
      id: 'rect-1',
      createdAt: 2,
      overlayRectType: 'percent',
      start: { x: 1, y: 2 },
      end: { x: 5, y: 6 },
      rect: { x: 1, y: 2, width: 4, height: 4 },
      selectionId: 'page-2'
    } satisfies ReaderSelectionRectangle
  ],
  selectedRangeId: 'r1',
  selectedRectId: 'rect-1'
}

const _annotationHistoryStatus: ReaderAnnotationHistoryStatus = {
  enabled: true,
  canUndo: false,
  canRedo: true,
  pastCount: 0,
  futureCount: 1
}

const _annotationHistoryOptions: ReaderAnnotationHistoryOptions = {
  enabled: true,
  resetKey: 'document-1'
}

const _annotationHistorySource: ReaderAnnotationHistoryChangeSource =
  'external-sync'

const _annotationHistorySources = [
  'select',
  'highlight',
  'update-range',
  'create-rect',
  'update-rect',
  'clear',
  'undo',
  'redo',
  'reset',
  'external-sync'
] satisfies ReaderAnnotationHistoryChangeSource[]

const _annotationHistoryDetail: ReaderAnnotationHistoryChangeDetail = {
  source: _annotationHistorySource,
  status: _annotationHistoryStatus
}

const _annotationHistoryProps: ReaderProps = {
  annotationHistory: _annotationHistoryOptions,
  onAnnotationHistoryChange: (next, detail) => {
    const _next: ReaderAnnotationHistoryValue = next
    const _detail: ReaderAnnotationHistoryChangeDetail = detail
    expect(_next.selectedRangeId).toBe('r1')
    expect(_detail.status.enabled).toBe(true)
  }
}

const _annotationHistoryRef: ReaderSelectionRef = {
  highlight: () => {},
  confirm: () => {},
  confirmRect: () => {},
  clear: () => {},
  scrollToRange: () => {},
  scrollToRect: () => {},
  scrollToPosition: () => {},
  undo: () => true,
  redo: () => false,
  canUndo: () => true,
  canRedo: () => false,
  getAnnotationHistoryState: () => _annotationHistoryStatus
}

describe('Reader public selection types', () => {
  it('accepts linked ranges keyed by public page selection ids', () => {
    expect(legacyRangeRejected).toBe(false)
    expect(linkedRangeAlias.start.selectionId).toBe('page-2')
    expect(linkedRangeAlias.end.selectionId).toBe('page-2')
    expect(linkedRangeAlias.rectsBySelectionId['page-2']).toEqual([
      { x: 1, y: 2, width: 3, height: 4 }
    ])
  })

  /**
   * GREEN 合约测试（运行时辅助，T2 text-render-mode）：确认 ReaderProps 类型
   * 已重新接受 renderMode 属性且类型为 ReaderRenderMode。编译通过即证明契约成立。
   */
  it('ReaderProps type accepts renderMode as ReaderRenderMode', () => {
    expect(_renderModeAccepted).toBe(true)
    expect(_readerPropsRenderMode).toBe('layout')
  })

  /**
   * GREEN 合约测试：确认 ReaderProps 与 ReaderInteractiveProps 均接受 touchPanMode，
   * 且其类型为 ReaderTouchPanMode。编译通过即证明契约成立。
   */
  it('ReaderProps type accepts touchPanMode as ReaderTouchPanMode', () => {
    expect(_touchPanModeAccepted).toBe(true)
    expect(_touchPanModeInteractiveAccepted).toBe(true)
    expect(_readerPropsTouchPanMode).toBe('two-finger')
  })

  it('preserves page selection compatibility and drawing wrapper props', () => {
    expect(_legacyPageSelectionProps.pageTextSelections).toEqual({})
    expect(_legacyPageSelectionProps.pageRectSelections).toEqual({})
    expect(_drawingInteractiveProps.selectedTool).toBe('drawing')
    expect(_highlightCommentProps.containMarginTop).toBe(24)
    expect(_highlightCommentProps.containMarginBottom).toBe(48)
    expect(_bookmarkInteractiveProps.bookmarkedPageNumbers).toEqual([1, 3])
  })

  it('exposes annotation history value, props, detail, and ref command types', () => {
    expect(_annotationHistoryOnlyExpectedKeys).toBe(true)
    expect(_annotationHistoryExpectedKeys).toBe(true)
    expect(_annotationHistoryHasNoPagePaintings).toBe(true)
    expect(_annotationHistoryValue.ranges).toEqual([linkedRange])
    expect(_annotationHistoryValue.rects[0]?.selectionId).toBe('page-2')
    expect(_annotationHistoryValue.selectedRangeId).toBe('r1')
    expect(_annotationHistorySources).toContain('highlight')
    expect(_annotationHistorySources).toContain('undo')
    expect(_annotationHistorySources).toContain('redo')
    expect(_annotationHistoryDetail.source).toBe('external-sync')
    expect(_annotationHistoryDetail.status.futureCount).toBe(1)
    expect(_annotationHistoryProps.annotationHistory).toEqual(
      _annotationHistoryOptions
    )
    expect(_annotationHistoryRef.undo()).toBe(true)
    expect(_annotationHistoryRef.redo()).toBe(false)
    expect(_annotationHistoryRef.canUndo()).toBe(true)
    expect(_annotationHistoryRef.canRedo()).toBe(false)
    expect(_annotationHistoryRef.getAnnotationHistoryState().enabled).toBe(true)
  })
})
