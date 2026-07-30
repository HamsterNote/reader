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
 * 当 relative 为 true 时（参考 @hamster-note/components Popover 的 relative 属性）：
 * - 通过 Portal 渲染到 containerRef 指向的定位容器
 * - 使用 position: absolute 相对于该容器定位（容器需要 position: relative）
 * - 坐标从视口坐标转换为容器相对坐标
 *
 * @param visible  控制 portal 内容是否显示（用于 VirtualPaper transform debounce）
 * @param relative 使用相对定位（absolute）而非固定定位（fixed），从容器基准定位
 * @param children 实际 popover 内容（按钮、颜色选择器等）
 */
export function PopoverPortal({
  children,
  containerRef,
  selectionKind,
  visible,
  relative = false
}: {
  children: ReactNode
  containerRef: RefObject<HTMLElement | null>
  selectionKind: PopoverSelectionKind
  visible: boolean
  relative?: boolean
}) {
  // anchor div 引用——它被渲染在 .hsn-selection-popover 内部，作为定位基准
  const anchorRef = useRef<HTMLDivElement>(null)

  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const initialPortalContainer = relative ? containerRef.current : document.body
  const portalContainerRef = useRef<HTMLElement | null>(initialPortalContainer)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    initialPortalContainer
  )

  useEffect(() => {
    // 不可见时清除位置，隐藏 portal 内容
    if (!visible) {
      setPosition(null)
      return
    }

    let rafId: number

    const syncPortalContainer = (): boolean => {
      const nextPortalContainer = relative
        ? containerRef.current
        : document.body
      if (portalContainerRef.current === nextPortalContainer) return false

      portalContainerRef.current = nextPortalContainer
      setPortalContainer(nextPortalContainer)
      setPosition(null)
      return true
    }

    syncPortalContainer()

    /**
     * rAF 循环：持续读取 anchor 的视口坐标并更新 portal 位置。
     * 这样在滚动、内容变化等场景下 portal 都能跟随锚点。
     * 仅在坐标变化超过 0.5px 时更新 state，避免不必要的 re-render。
     */
    const updatePosition = () => {
      if (syncPortalContainer()) {
        rafId = requestAnimationFrame(updatePosition)
        return
      }

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
            POPOVER_GAP,
            relative
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
  }, [containerRef, selectionKind, visible, relative])

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

      {/* Portal / 内联内容 */}
      {visible && (
        <PopoverContent
          portalContainer={portalContainer}
          relative={relative}
          position={position}
          popoverRef={popoverRef}
        >
          {children}
        </PopoverContent>
      )}
    </>
  )
}

/**
 * 根据 relative 模式决定渲染方式：
 * - relative=false（默认）：createPortal 到 document.body，position: fixed
 * - relative=true：createPortal 到 containerRef，position: absolute
 */
function PopoverContent({
  children,
  portalContainer,
  relative,
  position,
  popoverRef
}: {
  children: ReactNode
  portalContainer: HTMLElement | null
  relative: boolean
  position: PopoverPosition | null
  popoverRef: RefObject<HTMLDivElement | null>
}) {
  const style: React.CSSProperties = {
    left: `${position?.left ?? 0}px`,
    top: `${position?.top ?? 0}px`,
    maxWidth: position ? `${position.maxWidth}px` : undefined,
    maxHeight: position ? `${position.maxHeight}px` : undefined,
    visibility: position ? 'visible' : 'hidden',
    overflow: 'auto',
    transform: 'none',
    margin: 0,
    zIndex: 10000,
    pointerEvents: 'auto',
    userSelect: 'none'
  }

  if (!portalContainer) {
    return null
  }

  return createPortal(
    <div
      ref={popoverRef}
      className='hamster-reader-popover-portal hsn-selection-popover'
      style={{
        ...style,
        position: relative ? 'absolute' : 'fixed'
      }}
    >
      {children}
    </div>,
    portalContainer
  )
}
