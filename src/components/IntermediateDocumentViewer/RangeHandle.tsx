import type {
  HandleRenderProps,
  LinkedSelectionData
} from '@hamster-note/selection'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef
} from 'react'

// 圆圈手柄的目标视觉直径（屏幕像素）。
// CSS 尺寸固定为此值，再通过 transform: scale(1/scale) 抵消
// VirtualPaper 容器的 transform: scale(s)，使视觉直径恒为 20px，方便用户拖动。
const HANDLE_CIRCLE_DIAMETER_PX = 20

/**
 * 去除 CSS 颜色字符串中的透明度（alpha 通道），返回无 alpha 的等价颜色。
 *
 * 覆盖常见带透明度的格式：
 * - `rgba(r,g,b,a)` / `rgba(r g b / a)` -> `rgb(r,g,b)`
 * - `hsla(h,s%,l%,a)` / `hsla(h s% l% / a)` -> `hsl(h,s%,l%)`
 * - `#RRGGBBAA` -> `#RRGGBB` ；`#RGBA` -> `#RGB`
 *
 * 其它本就无 alpha 的格式（`rgb()`/`hsl()`/`#RRGGBB`/命名色等）原样返回，
 * 让交互手柄在文档上保持纯色、足够醒目。
 */
const toOpaqueColor = (color: string): string => {
  const trimmed = color.trim()

  // 函数形式颜色：rgb()/rgba()/hsl()/hsla()
  // 仅用一层简单捕获 + 按分隔符拆分，避免复杂回溯
  const fnMatch = trimmed.match(/^(rgba?|hsla?)\((.*)\)$/i)
  if (fnMatch) {
    const fn = fnMatch[1].toLowerCase()
    // 传统逗号与现代空格/斜杠语法统一拆分
    const parts = fnMatch[2].split(/[,/\s]+/).filter(Boolean)
    // 仅当存在第 4 个分量（alpha）时才需要去除透明度
    if (parts.length >= 4) {
      if (fn.startsWith('rgb')) {
        return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`
      }
      return `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`
    }
    return color
  }

  // #RRGGBBAA -> #RRGGBB
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return trimmed.slice(0, 7)
  }
  // #RGBA -> #RGB
  if (/^#[0-9a-f]{4}$/i.test(trimmed)) {
    return trimmed.slice(0, 4)
  }

  return color
}

/**
 * 将一个 CSSProperties 中的背景色字段（background / backgroundColor）
 * 转为去透明度后的版本，其它字段原样保留。
 * 仅当字段为字符串时才处理，避免破坏无颜色时回退到 className 的行为。
 */
const withOpaqueBackground = (style: CSSProperties): CSSProperties => {
  const next: CSSProperties = { ...style }
  if (typeof next.background === 'string') {
    next.background = toOpaqueColor(next.background)
  }
  if (typeof next.backgroundColor === 'string') {
    next.backgroundColor = toOpaqueColor(next.backgroundColor)
  }
  return next
}

interface ActivePointerCorrection {
  cleanup: () => void
  container: ParentNode
}

const activePointerCorrections = new WeakMap<
  Document,
  ActivePointerCorrection
>()

interface RangeHandleProps {
  handle: HandleRenderProps
  linkedData: LinkedSelectionData
  scale: number
  selectionId: string
}

const axisPosition = (
  value: number,
  unit: HandleRenderProps['positionUnit'],
  pixelOffset = 0
): number | string => {
  if (unit === 'px') return value + pixelOffset
  if (pixelOffset === 0) return `${value}%`

  const operator = pixelOffset < 0 ? '-' : '+'
  return `calc(${value}% ${operator} ${Math.abs(pixelOffset)}px)`
}

const findLineHeight = (
  handle: HandleRenderProps,
  linkedData: LinkedSelectionData,
  selectionId: string
): number | null => {
  if (handle.target === 'rect') return null

  const range =
    handle.owner === 'active-selection'
      ? linkedData.activeRange
      : linkedData.items.find((item) => item.id === handle.rangeId)
  const rects = range?.rectsBySelectionId[selectionId]
  if (!rects || rects.length === 0) return null

  const endpointRect =
    handle.type === 'start' ? rects[0] : rects[rects.length - 1]
  return endpointRect?.height ?? null
}

const copyPointerEvent = (
  event: PointerEvent,
  clientX: number,
  clientY: number
): PointerEvent =>
  new PointerEvent(event.type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: event.view,
    detail: event.detail,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX,
    clientY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
    pointerId: event.pointerId,
    width: event.width,
    height: event.height,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary
  })

export const RangeHandle = ({
  handle,
  linkedData,
  scale,
  selectionId
}: RangeHandleProps) => {
  const circleRef = useRef<HTMLButtonElement>(null)
  const lineHeight = findLineHeight(handle, linkedData, selectionId)

  const startPointerCorrection = useCallback((event: PointerEvent) => {
    const circle = circleRef.current
    if (!circle) return

    const ownerDocument = circle.ownerDocument
    activePointerCorrections.get(ownerDocument)?.cleanup()

    // 圆圈圆心即 range 端点位置；拖拽时把指针纠正到圆心，
    // 使选区边界始终跟随圆圈中心（无论用户在圆内何处抓取）。
    const circleRect = circle.getBoundingClientRect()
    const offsetX = circleRect.left + circleRect.width / 2 - event.clientX
    const offsetY = circleRect.top + circleRect.height / 2 - event.clientY
    const forwardedEvents = new WeakSet<PointerEvent>()

    const cleanup = () => {
      ownerDocument.removeEventListener('pointermove', correctPointerMove, true)
      ownerDocument.removeEventListener('pointerup', cleanup, true)
      ownerDocument.removeEventListener('pointercancel', cleanup, true)
      ownerDocument.defaultView?.removeEventListener('blur', cleanup)
      if (activePointerCorrections.get(ownerDocument)?.cleanup === cleanup) {
        activePointerCorrections.delete(ownerDocument)
      }
    }
    const correctPointerMove = (moveEvent: PointerEvent) => {
      if (
        forwardedEvents.has(moveEvent) ||
        moveEvent.pointerId !== event.pointerId
      ) {
        return
      }

      moveEvent.preventDefault()
      moveEvent.stopImmediatePropagation()
      const correctedEvent = copyPointerEvent(
        moveEvent,
        moveEvent.clientX + offsetX,
        moveEvent.clientY + offsetY
      )
      forwardedEvents.add(correctedEvent)
      ownerDocument.dispatchEvent(correctedEvent)
    }

    ownerDocument.addEventListener('pointermove', correctPointerMove, true)
    ownerDocument.addEventListener('pointerup', cleanup, true)
    ownerDocument.addEventListener('pointercancel', cleanup, true)
    ownerDocument.defaultView?.addEventListener('blur', cleanup)
    activePointerCorrections.set(ownerDocument, {
      cleanup,
      container: circle.parentNode ?? ownerDocument
    })
  }, [])

  useEffect(() => {
    const circle = circleRef.current
    if (!circle || lineHeight === null) return

    const ownerDocument = circle.ownerDocument
    const capturePointerDown = (event: PointerEvent) => {
      if (event.target === circle) startPointerCorrection(event)
    }
    ownerDocument.addEventListener('pointerdown', capturePointerDown, true)

    return () => {
      ownerDocument.removeEventListener('pointerdown', capturePointerDown, true)
      ownerDocument.defaultView?.setTimeout(() => {
        const activeCorrection = activePointerCorrections.get(ownerDocument)
        const replacementSelector = `[data-range-handle-circle="${handle.type}"]`
        if (
          activeCorrection &&
          !activeCorrection.container.querySelector(replacementSelector)
        ) {
          activeCorrection.cleanup()
        }
      }, 0)
    }
  }, [handle.type, lineHeight, startPointerCorrection])

  if (lineHeight === null) {
    return (
      <button
        ref={circleRef}
        type='button'
        className={handle.className}
        tabIndex={-1}
        aria-label={handle.ariaLabel}
        style={withOpaqueBackground(handle.style)}
        data-rect-id={handle.rectId ?? ''}
        data-range-id={handle.rangeId ?? ''}
        onPointerDown={handle.onPointerDown}
      />
    )
  }

  // 圆圈 CSS 尺寸固定 20px，通过反向 scale(1/scale) 抵消
  // VirtualPaper 容器的 transform: scale(s)，使视觉直径恒为 20px。
  // translate(-50%, -50%) 写在 scale 左侧（先于 scale 应用），
  // 其百分比基于元素 border box（20px），不受 scale 影响，
  // 保证圆心精确对齐 range 端点位置。
  const inverseScale = 1 / scale
  const circleStyle: CSSProperties = {
    // 圆圈背景色去透明度，保证交互手柄纯色醒目
    ...withOpaqueBackground(handle.style),
    position: 'absolute',
    left: axisPosition(handle.position.x, handle.positionUnit),
    top: axisPosition(handle.position.y, handle.positionUnit),
    width: HANDLE_CIRCLE_DIAMETER_PX,
    height: HANDLE_CIRCLE_DIAMETER_PX,
    borderRadius: '50%',
    // 先平移居中（圆心对齐端点），再反向缩放抵消父容器缩放
    transform: `translate(-50%, -50%) scale(${inverseScale})`
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    startPointerCorrection(event.nativeEvent)
    handle.onPointerDown(event)
  }

  return (
    <button
      ref={circleRef}
      type='button'
      className={handle.className}
      tabIndex={-1}
      aria-label={handle.ariaLabel}
      data-range-handle-circle={handle.type}
      style={circleStyle}
      data-rect-id={handle.rectId ?? ''}
      data-range-id={handle.rangeId ?? ''}
      onPointerDown={handlePointerDown}
    />
  )
}
