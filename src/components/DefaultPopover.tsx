import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../types/selection'

/**
 * 默认 Popover 组件
 *
 * 当 Reader 外部未传入 selectionPopover / highlightPopover 时使用。
 * 样式参考 @hamster-note/notes 的 SelectionPopover（.hn-note-popover 系列）：
 * 暗色背景、圆角按钮、淡入动画。
 *
 * 功能从 demo/App.tsx 中提取：
 * - selectionPopover：高亮按钮（移动端安全点击）+ 背景颜色选择器
 * - highlightPopover：删除按钮 + 背景颜色选择器
 */

// ---------------------------------------------------------------------------
// 公共 props 类型
// ---------------------------------------------------------------------------

/**
 * 默认 Popover 组件所需的外部上下文。
 *
 * 这些字段全部来自 Reader 已有的 props，由 Reader 在创建默认 popover 时注入。
 * 使用结构化类型（而非 RefObject）以兼容外部传入的 ref 对象。
 */
export type DefaultPopoverContext = {
  /**
   * Reader 暴露的命令式 ref，用于调用 confirm() / highlight() 等方法。
   * 结构化类型兼容 RefObject<ReaderSelectionRef | null>。
   */
  readonly selectionRef: {
    readonly current: ReaderSelectionRef | null
  }
  /** 当前全局高亮颜色（CSS color string），未设置时 fallback 到 #ffc107 */
  readonly highlightColor: string | undefined
  /** 全局高亮颜色变更回调；默认 popover 改色时触发 */
  readonly onHighlightColorChange?: (color: string) => void
  /** 当前选中的 range ID（受控），用于定位要改色/删除的 range */
  readonly selectedRangeId?: string | null
  /** 受控 ranges 列表，用于查找当前选中 range 以更新其 markerStyle */
  readonly ranges?: ReaderSelectionRange[]
  /** range 更新回调（对应 Reader 的 onUpdateRange），用于改单个 range 颜色 */
  readonly onUpdateRange?: (range: ReaderSelectionRange) => void
  /** range 删除回调（对应 Reader 的 onRemoveRange），用于删除高亮 */
  readonly onRemoveRange?: (id: string) => void
}

// ---------------------------------------------------------------------------
// MobileSafeHighlightButton -- 从 demo/MobileSafeHighlightButton.tsx 挪入
// ---------------------------------------------------------------------------

/**
 * 移动端安全的高亮按钮
 *
 * 移动端（pointerType !== 'mouse'）上 click 事件可能不可靠，
 * 因此在 pointerdown 时就触发 confirm()，并通过 skipNextClick 标志
 * 阻止后续 click 事件的重复触发。
 *
 * 桌面端（pointerType === 'mouse'）正常走 click 事件。
 */
function MobileSafeHighlightButton({
  selectionRef
}: {
  selectionRef: {
    readonly current: ReaderSelectionRef | null
  }
}) {
  // 标记下一个 click 事件已被 pointerdown 处理，需跳过
  const skipNextClickRef = useRef(false)
  // skipNextClick 的重置定时器
  const resetTimerRef = useRef<number | null>(null)

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current === null) return
    window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = null
  }, [])

  useEffect(() => clearResetTimer, [clearResetTimer])

  const markNextClickAsHandled = useCallback(() => {
    skipNextClickRef.current = true
    clearResetTimer()
    // 500ms 后自动重置，避免标志位卡住
    resetTimerRef.current = window.setTimeout(() => {
      skipNextClickRef.current = false
      resetTimerRef.current = null
    }, 500)
  }, [clearResetTimer])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      // 桌面端鼠标不处理，走 click
      if (event.pointerType === 'mouse') return

      // 移动端：阻止默认行为 + 立即确认高亮
      event.preventDefault()
      event.stopPropagation()
      markNextClickAsHandled()
      selectionRef.current?.confirm()
    },
    [markNextClickAsHandled, selectionRef]
  )

  const handleClick = useCallback(() => {
    // 如果 pointerdown 已处理过，跳过本次 click
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false
      clearResetTimer()
      return
    }

    selectionRef.current?.confirm()
  }, [clearResetTimer, selectionRef])

  return (
    <button
      type='button'
      className='hamster-reader-popover-btn'
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      高亮
    </button>
  )
}

// ---------------------------------------------------------------------------
// 颜色选择器
// ---------------------------------------------------------------------------

/**
 * 背景颜色选择器
 *
 * 改色时做两件事：
 * 1. 调用 onHighlightColorChange 更新全局高亮色（影响后续新建的高亮）
 * 2. 如果当前有选中的 range，通过 onUpdateRange 更新该 range 的 markerStyle
 */
function HighlightColorPicker({
  highlightColor,
  onHighlightColorChange,
  selectedRangeId,
  ranges,
  onUpdateRange
}: DefaultPopoverContext) {
  // 非 # 开头的颜色值 fallback 到 #ffc107（与 Demo 逻辑一致）
  const colorValue = highlightColor?.startsWith('#')
    ? highlightColor
    : '#ffc107'

  return (
    <label className='hamster-reader-popover-color'>
      <span className='hamster-reader-popover-color-label'>背景颜色设置</span>
      <input
        type='color'
        className='hamster-reader-popover-color-input'
        value={colorValue}
        onChange={(e) => {
          const newColor = e.target.value
          // 1. 更新全局高亮色
          onHighlightColorChange?.(newColor)

          // 2. 同步更新当前选中 range 的 markerStyle，使颜色立即生效
          if (selectedRangeId && ranges && onUpdateRange) {
            const selectedRange = ranges.find((r) => r.id === selectedRangeId)
            if (selectedRange) {
              onUpdateRange({
                ...selectedRange,
                markerStyle: { backgroundColor: newColor }
              })
            }
          }
        }}
      />
    </label>
  )
}

// ---------------------------------------------------------------------------
// DefaultSelectionPopover -- 选区弹出（选择中，未确认高亮）
// ---------------------------------------------------------------------------

/**
 * 默认选区 Popover
 *
 * 在用户选择文字时弹出，提供：
 * - 高亮按钮：调用 selectionRef.confirm() 将当前选区确认为高亮
 * - 背景颜色选择器：设置全局高亮色 + 更新当前选中 range 颜色
 */
export function DefaultSelectionPopover(props: DefaultPopoverContext) {
  return (
    <div
      className='hamster-reader-popover'
      role='toolbar'
      aria-label='选区操作'
      // 阻止 mousedown 默认行为：点击按钮时不会抢走选区焦点、不会折叠选区
      onMouseDown={(e) => e.preventDefault()}
    >
      <MobileSafeHighlightButton selectionRef={props.selectionRef} />
      <HighlightColorPicker {...props} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// DefaultHighlightPopover -- 高亮弹出（已确认高亮被点击时）
// ---------------------------------------------------------------------------

/**
 * 默认高亮 Popover
 *
 * 在用户点击已有高亮时弹出，提供：
 * - 删除按钮：通过 onRemoveRange 删除当前选中的高亮
 * - 背景颜色选择器：设置全局高亮色 + 更新当前选中 range 颜色
 */
export function DefaultHighlightPopover(props: DefaultPopoverContext) {
  const handleRemove = useCallback(() => {
    if (props.selectedRangeId && props.onRemoveRange) {
      props.onRemoveRange(props.selectedRangeId)
    }
  }, [props.selectedRangeId, props.onRemoveRange])

  return (
    <div
      className='hamster-reader-popover'
      role='toolbar'
      aria-label='高亮操作'
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type='button'
        className='hamster-reader-popover-btn hamster-reader-popover-btn--danger'
        onClick={handleRemove}
      >
        删除
      </button>
      <HighlightColorPicker {...props} />
    </div>
  )
}
