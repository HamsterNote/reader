import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import {
  calculatePopoverPosition,
  getSelectionBounds,
  type PopoverPosition,
  type PopoverSelectionKind
} from './popoverPosition'

const POPOVER_GAP = 8

/**
 * PopoverPortal —— 将 popover 内容通过 React Portal 渲染到 document.body，
 * 使其脱离 VirtualPaper 的 CSS transform（scale / translate）影响。
 *
 * 核心思路：
 * 1. 聚合 container 内当前选区的全部矩形，得到视口坐标中的外包围盒
 * 2. 按“包围盒顶部 → 底部 → container 中央”的优先级计算位置
 * 3. 将实际内容以 position:fixed 渲染到 body，并钳制在 container 的安全间距内
 * 4. Selection 内的 0x0 anchor 只作为渲染时序与旧版 DOM 的兼容回退
 *
 * 这样 popover 的屏幕尺寸不会随 zoom 缩放，始终保持原始大小。
 *
 * @param visible  控制 portal 内容是否显示（用于 VirtualPaper transform debounce）
 * @param children 实际 popover 内容（按钮、颜色选择器等）
 */
export function PopoverPortal({
  children,
  containerRef,
  selectionKind,
  visible
}: {
  children: ReactNode
  containerRef: RefObject<HTMLElement | null>
  selectionKind: PopoverSelectionKind
  visible: boolean
}) {
  // anchor div 引用——它被渲染在 .hsn-selection-popover 内部，作为定位基准
  const anchorRef = useRef<HTMLDivElement>(null)

  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PopoverPosition | null>(null)

  useEffect(() => {
    // 不可见时清除位置，隐藏 portal 内容
    if (!visible) {
      setPosition(null)
      return
    }

    let rafId: number

    /**
     * rAF 循环：持续读取 anchor 的视口坐标并更新 portal 位置。
     * 这样在滚动、内容变化等场景下 portal 都能跟随锚点。
     * 仅在坐标变化超过 0.5px 时更新 state，避免不必要的 re-render。
     */
    const updatePosition = () => {
      const container = containerRef.current
      const popover = popoverRef.current
      const anchor = anchorRef.current
      if (container && popover && anchor) {
        const anchorRect = anchor.getBoundingClientRect()
        const selectionBounds =
          getSelectionBounds(container, selectionKind) ??
          (anchorRect.left !== 0 || anchorRect.top !== 0 ? anchorRect : null)

        if (selectionBounds) {
          const nextPosition = calculatePopoverPosition(
            container.getBoundingClientRect(),
            selectionBounds,
            popover.getBoundingClientRect(),
            POPOVER_GAP
          )
          setPosition((previousPosition) => {
            if (
              previousPosition &&
              Math.abs(previousPosition.left - nextPosition.left) < 0.5 &&
              Math.abs(previousPosition.top - nextPosition.top) < 0.5 &&
              Math.abs(previousPosition.maxWidth - nextPosition.maxWidth) <
                0.5 &&
              Math.abs(previousPosition.maxHeight - nextPosition.maxHeight) <
                0.5
            ) {
              return previousPosition
            }
            return nextPosition
          })
        } else {
          setPosition(null)
        }
      }
      rafId = requestAnimationFrame(updatePosition)
    }

    rafId = requestAnimationFrame(updatePosition)

    return () => cancelAnimationFrame(rafId)
  }, [containerRef, selectionKind, visible])

  return (
    <>
      {/*
        隐藏 anchor——它被渲染在 .hsn-selection-popover 内部，
        作为定位基准。0x0 尺寸不会影响 popover 的布局。
      */}
      <div
        ref={anchorRef}
        aria-hidden='true'
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          pointerEvents: 'none'
        }}
      />

      {/* Portal 内容：渲染到 document.body，脱离 VirtualPaper transform */}
      {visible &&
        createPortal(
          <div
            ref={popoverRef}
            // 添加 hsn-selection-popover class，使 Selection 库的 click-outside
            // 检测（e.target.closest('.hsn-selection-popover')）能识别 portal 内容，
            // 防止点击删除按钮/取色器时触发 deselect 关闭 popover
            className='hamster-reader-popover-portal hsn-selection-popover'
            style={{
              position: 'fixed',
              left: `${position?.left ?? 0}px`,
              top: `${position?.top ?? 0}px`,
              maxWidth: position ? `${position.maxWidth}px` : undefined,
              maxHeight: position ? `${position.maxHeight}px` : undefined,
              visibility: position ? 'visible' : 'hidden',
              overflow: 'auto',
              transform: 'none',
              // 覆盖 .hsn-selection-popover 的 margin-top:-6px，
              // 因为 portal 使用 fixed 定位，坐标已精确计算
              margin: 0,
              zIndex: 10000,
              pointerEvents: 'auto',
              userSelect: 'none'
            }}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  )
}
