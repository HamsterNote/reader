import { fireEvent } from '@testing-library/react'

export function readingPointer(target: Element, type: string, x = 250, y = 100) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1
  })
  Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 } })
  fireEvent(target, event)
}

export function tapNext(target: Element) {
  for (const type of ['pointerdown', 'pointerup', 'click']) readingPointer(target, type)
}
