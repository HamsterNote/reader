import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * 把 viewer 捕获到的 pointerdown 转发给 multi-drag 的隐藏元素。
 * multi-drag 必须从真实 PointerEvent 建立 finger，后续才能统一追踪移出 viewer 的指针。
 */
export function forwardHighlightPointerDown(
  event: ReactPointerEvent<HTMLDivElement>,
  dragElement: HTMLElement | null
): boolean {
  const PointerEventConstructor =
    event.currentTarget.ownerDocument.defaultView?.PointerEvent
  if (!PointerEventConstructor || !dragElement) return false

  dragElement.dispatchEvent(
    new PointerEventConstructor('pointerdown', {
      bubbles: false,
      cancelable: true,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      width: event.width,
      height: event.height,
      pressure: event.pressure,
      tangentialPressure: event.tangentialPressure,
      tiltX: event.tiltX,
      tiltY: event.tiltY,
      twist: event.twist,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    })
  )
  return true
}
