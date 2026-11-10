import type {
  HandleRenderProps,
  LinkedSelectionData,
  LinkedSelectionRange
} from '@hamster-note/selection'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const magnifier = vi.hoisted(() => ({
  end: vi.fn(),
  move: vi.fn(),
  registerDragCleanup: vi.fn(() => vi.fn()),
  start: vi.fn()
}))

vi.mock('../src/components/IntermediateDocumentViewer/RangeMagnifier', () => ({
  useRangeMagnifier: () => magnifier
}))

import { PdfTextHandle } from '../src/pdf/PdfTextHandle'

const selectionId = 'page-1'
const originalGetClientRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
)
const originalElementFromPoint = Object.getOwnPropertyDescriptor(
  document,
  'elementFromPoint'
)
let root: HTMLDivElement
let container: HTMLDivElement
let content: HTMLDivElement
let text: HTMLSpanElement
let characterWidth: number
let characterHeight: number
let characterTop: number

const characterRect = (offset: number) =>
  new DOMRect(
    10 + offset * characterWidth,
    characterTop + Math.floor(offset / 4) * (characterHeight + 10),
    characterWidth,
    characterHeight
  )

const domCharacterOffset = (node: Node, offset: number) => {
  const walker = content.ownerDocument.createTreeWalker(
    content,
    NodeFilter.SHOW_TEXT
  )
  let traversed = 0
  while (walker.nextNode()) {
    if (walker.currentNode === node) return traversed + offset
    traversed += walker.currentNode.textContent?.length ?? 0
  }
  return offset
}

const makeRange = (): LinkedSelectionRange => ({
  id: 'saved-range',
  text: 'bcd',
  start: { selectionId, offset: 1 },
  end: { selectionId, offset: 4 },
  createdAt: 1,
  overlayRectType: 'px',
  rectsBySelectionId: {
    [selectionId]: [{ x: 10, y: 20, width: 30, height: 20 }]
  },
  markerStyle: { backgroundColor: 'rgba(10, 20, 30, 0.35)' }
})

const makeHandle = (
  type: 'start' | 'end',
  owner: HandleRenderProps['owner'],
  positionUnit: 'px' | 'percent'
): HandleRenderProps => {
  const localX = type === 'start' ? 10 : 40
  const localY = 30
  return {
    type,
    owner,
    rangeId: owner === 'persisted-range' ? 'saved-range' : null,
    target: 'text',
    rectId: null,
    position:
      positionUnit === 'px'
        ? { x: localX, y: localY }
        : { x: (localX / 300) * 100, y: (localY / 200) * 100 },
    positionUnit,
    isDragging: false,
    onPointerDown: vi.fn(),
    ariaLabel: type === 'start' ? '拖动以调整选区起点' : '拖动以调整选区终点',
    className: `hsn-selection-handle hsn-selection-handle--${type}`,
    style: {
      '--hsn-handle-color': 'rgba(10, 20, 30, 0.35)'
    } as CSSProperties,
    lineHeight: 20
  }
}

const renderHandle = ({
  type = 'start',
  owner = 'active-selection',
  positionUnit = 'px',
  column = 0,
  startOffset = 1,
  endOffset = 4
}: {
  type?: 'start' | 'end'
  owner?: HandleRenderProps['owner']
  positionUnit?: 'px' | 'percent'
  column?: number
  startOffset?: number
  endOffset?: number
} = {}) => {
  const range = {
    ...makeRange(),
    start: { selectionId, offset: startOffset },
    end: { selectionId, offset: endOffset }
  }
  const linkedData: LinkedSelectionData = {
    items: owner === 'persisted-range' ? [range] : [],
    selectedRangeId: owner === 'persisted-range' ? range.id : null,
    selectionOrder: [],
    activeRange: owner === 'active-selection' ? range : null
  }
  const handle = makeHandle(type, owner, positionUnit)
  const props: ComponentProps<typeof PdfTextHandle> = {
    handle,
    linkedData,
    root,
    selectionId,
    width: 300,
    column,
    magnifierEnabled: true
  }
  const view = render(<PdfTextHandle {...props} />)
  return { ...view, handle, props, range }
}

beforeEach(() => {
  characterWidth = 10
  characterHeight = 20
  characterTop = 40
  root = document.createElement('div')
  root.className = 'hamster-reader__intermediate-document-viewer'
  root.innerHTML =
    '<div class="hsn-selection-container" data-selection-id="page-1"><div class="hsn-selection-content"><span data-selection-start-offset="0" data-text-id="glyph">abcdefgh</span></div></div>'
  document.body.append(root)
  container = root.querySelector<HTMLDivElement>('.hsn-selection-container')!
  content = root.querySelector<HTMLDivElement>('.hsn-selection-content')!
  text = root.querySelector<HTMLSpanElement>('[data-text-id]')!
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 20, 300, 200)
  )
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 20, 300, 200)
  )
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: function (this: Range) {
      return [
        characterRect(domCharacterOffset(this.startContainer, this.startOffset))
      ]
    }
  })
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: (clientX: number, clientY: number) =>
      Array.from({ length: 8 }, (_, offset) => characterRect(offset)).some(
        (rect) =>
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
      )
        ? text
        : root
  })
})

afterEach(() => {
  root.remove()
  vi.restoreAllMocks()
  if (originalGetClientRects)
    Object.defineProperty(
      Range.prototype,
      'getClientRects',
      originalGetClientRects
    )
  else Reflect.deleteProperty(Range.prototype, 'getClientRects')
  if (originalElementFromPoint)
    Object.defineProperty(
      document,
      'elementFromPoint',
      originalElementFromPoint
    )
  else Reflect.deleteProperty(document, 'elementFromPoint')
  Object.values(magnifier).forEach((mock) => mock.mockClear())
})

describe('PdfTextHandle appearance and geometry', () => {
  it.each(['active-selection', 'persisted-range'] as const)(
    'shares the Layout visual for %s and keeps its own opaque color',
    (owner) => {
      const { handle } = renderHandle({ owner })
      const button = screen.getByRole('button', { name: handle.ariaLabel })
      const visual = button.querySelector<HTMLElement>(
        '[data-pdf-handle-visual]'
      )!
      const line = visual.children[0] as HTMLElement
      const circle = visual.querySelector<HTMLElement>(
        '[data-range-handle-circle="start"]'
      )!

      expect(button).toHaveStyle({ width: '40px', height: '40px' })
      expect(button).toHaveAttribute('data-range-id', handle.rangeId ?? '')
      expect(button).toHaveAttribute('data-rect-id', '')
      expect(visual).toHaveStyle({
        filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))'
      })
      expect(visual.children[1]).toBe(circle)
      expect(circle.style.width).toBe('20px')
      expect(circle.style.height).toBe('20px')
      expect(circle.style.border).toBe('2px solid white')
      expect(circle.style.backgroundColor).toBe('rgb(10, 20, 30)')
      expect(line).toHaveStyle({
        width: '2px',
        height: '20px',
        backgroundColor: 'rgb(10, 20, 30)'
      })
      expect(circle.style.pointerEvents).toBe('none')
    }
  )

  it.each([
    { type: 'start' as const, left: '10px', top: '10px', lineTop: '28px' },
    { type: 'end' as const, left: '40px', top: '50px', lineTop: '-10px' }
  ])(
    'places the $type circle outside its real source row',
    ({ type, left, top, lineTop }) => {
      const { handle } = renderHandle({ type })
      const button = screen.getByRole('button', { name: handle.ariaLabel })
      const visual = button.querySelector<HTMLElement>(
        '[data-pdf-handle-visual]'
      )!
      expect(button).toHaveStyle({ left, top })
      expect((visual.children[0] as HTMLElement).style.top).toBe(lineTop)
    }
  )

  it('keeps the 10px displacement outside percentage coordinates', () => {
    const start = renderHandle({ positionUnit: 'percent' })
    const startButton = screen.getByRole('button', {
      name: start.handle.ariaLabel
    })
    expect(parseFloat(startButton.style.left)).toBeCloseTo((10 / 300) * 100)
    expect(startButton.style.top).toBe('calc(10% - 10px)')
    start.unmount()

    const end = renderHandle({ type: 'end', positionUnit: 'percent' })
    const endButton = screen.getByRole('button', { name: end.handle.ariaLabel })
    expect(parseFloat(endButton.style.left)).toBeCloseTo((40 / 300) * 100)
    expect(endButton.style.top).toBe('calc(20% + 10px)')
  })

  it('recomputes source geometry after reflow and font size changes', () => {
    const { handle, props, rerender } = renderHandle()
    const button = screen.getByRole('button', { name: handle.ariaLabel })
    characterWidth = 14
    characterHeight = 32
    characterTop = 55
    rerender(<PdfTextHandle {...props} />)
    expect(button).toHaveStyle({ left: '14px', top: '25px' })
    expect(
      button.querySelector<HTMLElement>('[data-pdf-handle-visual] span')
    ).toHaveStyle({ width: '2px', height: '32px' })
  })

  it.each([
    { type: 'start' as const, left: '50px', top: '40px' },
    { type: 'end' as const, left: '60px', top: '80px' }
  ])(
    'uses the DOM $type endpoint across reflow whitespace',
    ({ type, left, top }) => {
      content.innerHTML =
        '<span data-selection-start-offset="0" data-text-id="first">abcd</span> <span data-selection-start-offset="4" data-text-id="second">efgh</span>'
      const { handle } = renderHandle({
        type,
        startOffset: 5,
        endOffset: 6
      })
      expect(
        screen.getByRole('button', { name: handle.ariaLabel })
      ).toHaveStyle({ left, top })
    }
  )

  it('measures only the content that owns the selectionId', () => {
    container.dataset.selectionId = 'page-other'
    renderHandle()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not substitute an endpoint from another paginated column', () => {
    renderHandle({ column: 1 })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('PdfTextHandle drag coordinates', () => {
  it.each([
    { name: 'center', x: 20, y: 30 },
    { name: 'white border', x: 20, y: 22 },
    { name: 'corner 9px outside the circle', x: 39, y: 49 }
  ])(
    'hits the same physical destination when grabbed at the $name',
    ({ x, y }) => {
      const { handle } = renderHandle()
      const button = screen.getByRole('button', { name: handle.ariaLabel })
      const move = vi.fn()
      document.addEventListener('pointermove', move)

      fireEvent.pointerDown(button, {
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y
      })
      fireEvent.pointerMove(document, {
        pointerId: 7,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50
      })

      expect(handle.onPointerDown).toHaveBeenCalledTimes(1)
      expect(magnifier.start).toHaveBeenCalledWith(button, {
        clientX: x,
        clientY: y
      })
      expect(move).toHaveBeenCalledTimes(1)
      expect(move.mock.calls[0][0]).toMatchObject({ clientX: 50, clientY: 50 })
      expect(magnifier.move).toHaveBeenLastCalledWith({
        clientX: 50,
        clientY: 50
      })

      fireEvent.pointerUp(document, { pointerId: 7, clientX: 50, clientY: 50 })
      document.removeEventListener('pointermove', move)
    }
  )

  it('uses the actual final release point before pointerup', () => {
    const { handle } = renderHandle({ type: 'end' })
    const button = screen.getByRole('button', { name: handle.ariaLabel })
    const events: string[] = []
    const move = vi.fn((event: PointerEvent) => {
      events.push(`move:${event.clientX},${event.clientY}`)
    })
    const up = vi.fn(() => events.push('up'))
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)

    fireEvent.pointerDown(button, {
      pointerId: 9,
      pointerType: 'touch',
      clientX: 50,
      clientY: 50
    })
    fireEvent.pointerUp(document, {
      pointerId: 9,
      pointerType: 'touch',
      clientX: 70,
      clientY: 80
    })

    expect(move).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['move:70,80', 'up'])
    expect(magnifier.end).toHaveBeenCalledTimes(1)
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
  })

  it.each(['pointercancel', 'blur', 'unmount'] as const)(
    'cleans up on %s without applying a final position',
    (termination) => {
      const view = renderHandle()
      const button = screen.getByRole('button', { name: view.handle.ariaLabel })
      const move = vi.fn()
      document.addEventListener('pointermove', move)
      fireEvent.pointerDown(button, {
        pointerId: 11,
        pointerType: 'touch',
        clientX: 20,
        clientY: 30
      })

      if (termination === 'unmount') view.unmount()
      else if (termination === 'blur') window.dispatchEvent(new Event('blur'))
      else
        fireEvent.pointerCancel(document, {
          pointerId: 11,
          clientX: 70,
          clientY: 90
        })
      expect(move).not.toHaveBeenCalled()
      fireEvent.pointerMove(document, {
        pointerId: 11,
        clientX: 70,
        clientY: 90
      })

      expect(move).toHaveBeenCalledTimes(1)
      expect(move.mock.calls[0][0]).toMatchObject({ clientX: 70, clientY: 90 })
      expect(magnifier.end).toHaveBeenCalledTimes(1)
      document.removeEventListener('pointermove', move)
    }
  )

  it('cleans up when pagination hides the source endpoint', () => {
    const view = renderHandle()
    const button = screen.getByRole('button', { name: view.handle.ariaLabel })
    fireEvent.pointerDown(button, {
      pointerId: 12,
      pointerType: 'touch',
      clientX: 20,
      clientY: 30
    })
    view.rerender(<PdfTextHandle {...view.props} column={1} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(magnifier.end).toHaveBeenCalledTimes(1)
  })

  it('keeps pointer capture and cleanup scoped to the starting pointerId', () => {
    const view = renderHandle()
    const button = screen.getByRole('button', { name: view.handle.ariaLabel })
    fireEvent.pointerDown(button, {
      pointerId: 13,
      pointerType: 'touch',
      clientX: 20,
      clientY: 30
    })
    fireEvent.pointerUp(document, { pointerId: 14, clientX: 70, clientY: 90 })
    expect(magnifier.end).not.toHaveBeenCalled()
    fireEvent.pointerCancel(document, { pointerId: 13 })
    expect(magnifier.end).toHaveBeenCalledTimes(1)
  })

  it('does not capture pointerdown outside the enlarged target', () => {
    const { handle } = renderHandle()
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 12,
      pointerType: 'touch',
      clientX: 41,
      clientY: 30
    })
    text.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(handle.onPointerDown).not.toHaveBeenCalled()
    expect(magnifier.start).not.toHaveBeenCalled()
  })
})
