import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * PopoverPortal —— 将 popover 内容通过 React Portal 渲染到 document.body，
 * 使其脱离 VirtualPaper 的 CSS transform（scale / translate）影响。
 *
 * 核心思路：
 * 1. 在 .hsn-selection-popover 内部渲染一个 0x0 的隐藏 anchor div
 * 2. 通过 rAF 循环持续读取 anchor 的 getBoundingClientRect()（视口坐标）
 * 3. 将实际内容以 position:fixed 渲染到 body，位置与 anchor 对齐
 * 4. transform: translate(-50%,-100%) 与 .hsn-selection-popover 原有定位逻辑一致
 *
 * 这样 popover 的屏幕尺寸不会随 zoom 缩放，始终保持原始大小。
 *
 * @param visible  控制 portal 内容是否显示（用于 VirtualPaper transform debounce）
 * @param children 实际 popover 内容（按钮、颜色选择器等）
 */
export function PopoverPortal({
  children,
  visible
}: {
  children: React.ReactNode
  visible: boolean
}) {
  // anchor div 引用——它被渲染在 .hsn-selection-popover 内部，作为定位基准
  const anchorRef = useRef<HTMLDivElement>(null)

  // portal 内容的视口坐标（null 表示尚未计算或不可见）
  const [position, setPosition] = useState<{
    left: number
    top: number
  } | null>(null)

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
      const anchor = anchorRef.current
      if (anchor) {
        const rect = anchor.getBoundingClientRect()

        // 过滤无效坐标（anchor 不可见时 rect 全为 0）
        if (rect.left !== 0 || rect.top !== 0) {
          setPosition((prev) => {
            if (
              prev &&
              Math.abs(prev.left - rect.left) < 0.5 &&
              Math.abs(prev.top - rect.top) < 0.5
            ) {
              // 坐标变化不足 0.5px，跳过更新
              return prev
            }
            return { left: rect.left, top: rect.top }
          })
        }
      }
      rafId = requestAnimationFrame(updatePosition)
    }

    rafId = requestAnimationFrame(updatePosition)

    return () => cancelAnimationFrame(rafId)
  }, [visible])

  return (
    <>
      {/*
        隐藏 anchor——它被渲染在 .hsn-selection-popover 内部，
        作为定位基准。0x0 尺寸不会影响 popover 的布局。
      */}
      <div
        ref={anchorRef}
        aria-hidden="true"
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
        position &&
        createPortal(
          <div
            // 添加 hsn-selection-popover class，使 Selection 库的 click-outside
            // 检测（e.target.closest('.hsn-selection-popover')）能识别 portal 内容，
            // 防止点击删除按钮/取色器时触发 deselect 关闭 popover
            className="hamster-reader-popover-portal hsn-selection-popover"
            style={{
              position: 'fixed',
              left: `${position.left}px`,
              top: `${position.top}px`,
              // 与 .hsn-selection-popover 原有 transform 一致：
              // 水平居中、垂直向上
              transform: 'translate(-50%, -100%)',
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
