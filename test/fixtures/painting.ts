import {
  migrateLegacyDocument,
  type EditorDocument,
  type PageGeometry
} from '@hamster-note/painting/core'
import { act } from '@testing-library/react'
import { vi } from 'vitest'

/** Historical fixtures enter the same published migrator, never a reader mapping. */
export function drawingFixture(input: unknown): EditorDocument {
  const result = migrateLegacyDocument(input)
  if (!result.ok) throw new Error(result.error.path)
  return result.value
}

export const emptyDrawing = drawingFixture({ strokes: [] })
export const pageGeometry: PageGeometry = {
  width: 600,
  height: 800,
  pageToSurface: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
}

export function mockPaintingCanvas() {
  const context = Object.fromEntries(
    [
      'setTransform',
      'clearRect',
      'save',
      'restore',
      'transform',
      'beginPath',
      'moveTo',
      'lineTo',
      'closePath',
      'fill'
    ].map((key) => [key, vi.fn()])
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
}

export function paintingPointer(
  target: EventTarget,
  phase: 'down' | 'move' | 'up' | 'cancel',
  x: number,
  y: number,
  source = 'pen',
  id = 1
) {
  const event = new Event(`pointer${phase}`, {
    bubbles: true,
    cancelable: true
  })
  Object.assign(event, {
    pointerId: id,
    pointerType: source,
    button: 0,
    buttons: phase === 'up' || phase === 'cancel' ? 0 : 1,
    clientX: x,
    clientY: y,
    pressure: phase === 'up' ? 0 : 0.5
  })
  act(() => {
    target.dispatchEvent(event)
  })
}
