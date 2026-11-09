import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RangeMagnifierProvider } from '../src/components/IntermediateDocumentViewer/RangeMagnifier'
import { TextSelectionMagnifier } from '../src/components/IntermediateDocumentViewer/TextSelectionMagnifier'
import { markSelectionPointerMoveAsTextHit } from '../src/components/selection/selectionPointerGuard'
import { mockElementSize } from './setup'

const html2canvasMock = vi.hoisted(() => vi.fn())

vi.mock('html2canvas', () => ({ default: html2canvasMock }))

interface HarnessProps {
  readonly children: ReactNode
  readonly pageClassName?: string
  readonly pdfText?: boolean
}

const Harness = ({
  children,
  pageClassName = 'hamster-reader__intermediate-page',
  pdfText = false
}: HarnessProps) => {
  const [viewerRoot, setViewerRoot] = useState<HTMLDivElement | null>(null)

  return (
    <div ref={setViewerRoot} data-testid='viewer-root'>
      <RangeMagnifierProvider rootElement={viewerRoot} pdfText={pdfText}>
        <TextSelectionMagnifier
          viewerRootElement={viewerRoot}
          pdfText={pdfText}
        />
        <div className={pageClassName}>{children}</div>
      </RangeMagnifierProvider>
    </div>
  )
}

interface TextHandleProps {
  readonly className: string
}

const TextHandle = ({ className }: TextHandleProps) => (
  <button type='button' className={className} aria-label='Text range handle' />
)

const renderHarness = (handle: ReactNode) => render(<Harness>{handle}</Harness>)

const prepareGeometry = () => {
  const viewerRoot = screen.getByTestId('viewer-root')
  const page = viewerRoot.querySelector<HTMLElement>(
    '.hamster-reader__intermediate-page'
  )
  const handle = screen.getByRole('button', { name: 'Text range handle' })
  if (!page) throw new Error('Expected an intermediate page')

  mockElementSize(viewerRoot, { left: 10, top: 20, width: 320, height: 480 })
  mockElementSize(page, { left: 30, top: 40, width: 200, height: 300 })
  mockElementSize(handle, { left: 140, top: 260, width: 20, height: 20 })
  return { handle, page }
}

afterEach(() => {
  html2canvasMock.mockReset()
})

describe('text selection handle magnifier', () => {
  it('keeps following an active handle after the selection layer removes it', () => {
    // Given: an active text range handle whose owning page can be captured.
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const { rerender } = renderHarness(
      <TextHandle className='hsn-selection-handle hsn-selection-handle--start' />
    )
    const { handle, page } = prepareGeometry()

    // When: dragging starts and the active-selection renderer removes its handle.
    fireEvent.pointerDown(handle, {
      pointerId: 17,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })
    const magnifier = screen.getByTestId('range-magnifier')
    expect(magnifier).not.toHaveAttribute('hidden')
    expect(html2canvasMock).toHaveBeenCalledWith(
      page,
      expect.objectContaining({ logging: false, useCORS: true })
    )
    rerender(<Harness>{null}</Harness>)
    fireEvent.pointerMove(document, {
      pointerId: 17,
      clientX: 155,
      clientY: 275,
      buttons: 1
    })

    // Then: the viewer-owned session follows the pointer until that drag ends.
    expect(magnifier).not.toHaveAttribute('hidden')
    expect(magnifier).toHaveStyle({ left: '90px', top: '122px' })
    fireEvent.pointerUp(document, { pointerId: 17 })
    expect(magnifier).toHaveAttribute('hidden')
  })

  it('follows a highlighted handle while its dragging class changes', () => {
    // Given: a persisted highlighted text range keeps its handle while dragging.
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const { rerender } = renderHarness(
      <TextHandle className='hsn-selection-handle hsn-selection-handle--end' />
    )
    const { handle } = prepareGeometry()

    // When: the dependency marks the same handle as dragging and moves it.
    fireEvent.pointerDown(handle, {
      pointerId: 23,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })
    const magnifier = screen.getByTestId('range-magnifier')
    rerender(
      <Harness>
        <TextHandle className='hsn-selection-handle hsn-selection-handle--end hsn-selection-handle--dragging' />
      </Harness>
    )
    fireEvent.pointerMove(document, {
      pointerId: 23,
      clientX: 160,
      clientY: 280,
      buttons: 1
    })

    // Then: the class transition does not interrupt the shared magnifier session.
    expect(magnifier).not.toHaveAttribute('hidden')
    expect(magnifier).toHaveStyle({ left: '95px', top: '127px' })
    fireEvent.pointerUp(document, { pointerId: 23 })
    expect(magnifier).toHaveAttribute('hidden')
  })

  it('opens for handles rendered by the text-only viewer', () => {
    // Given: a text-only page owns the browser selection handle.
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    render(
      <Harness pageClassName='hamster-reader__intermediate-text-page'>
        <TextHandle className='hsn-selection-handle hsn-selection-handle--start' />
      </Harness>
    )
    const viewerRoot = screen.getByTestId('viewer-root')
    const page = viewerRoot.querySelector<HTMLElement>(
      '.hamster-reader__intermediate-text-page'
    )
    const handle = screen.getByRole('button', { name: 'Text range handle' })
    if (!page) throw new Error('Expected an intermediate text page')
    mockElementSize(viewerRoot, { left: 10, top: 20, width: 320, height: 480 })
    mockElementSize(page, { left: 30, top: 40, width: 200, height: 300 })
    mockElementSize(handle, { left: 140, top: 260, width: 20, height: 20 })

    // When: mouse dragging starts from that text handle.
    fireEvent.pointerDown(handle, {
      pointerId: 29,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })

    // Then: the opt-in lens opens and captures the text-only page.
    expect(screen.getByTestId('range-magnifier')).not.toHaveAttribute('hidden')
    expect(html2canvasMock).toHaveBeenCalledWith(
      page,
      expect.objectContaining({ logging: false, useCORS: true })
    )
  })
})

it('shows a PDF Text caret at the scaled and clamped snapshot point', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 400
  vi.spyOn(canvas, 'getContext').mockReturnValue(null)
  html2canvasMock.mockResolvedValue(canvas)
  const caret = document.createRange()
  Object.defineProperty(caret, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 18)
  })
  const caretRangeFromPoint = vi.fn(() => caret)
  const previous = Object.getOwnPropertyDescriptor(
    document,
    'caretRangeFromPoint'
  )
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: caretRangeFromPoint
  })
  const view = render(
    <Harness pageClassName='hamster-reader__intermediate-text-page' pdfText>
      <TextHandle className='hsn-selection-handle hsn-selection-handle--start' />
    </Harness>
  )
  try {
    const viewerRoot = screen.getByTestId('viewer-root')
    const page = viewerRoot.querySelector<HTMLElement>(
      '.hamster-reader__intermediate-text-page'
    )!
    const handle = screen.getByRole('button', { name: 'Text range handle' })
    handle.style.setProperty('--hsn-handle-color', 'rgb(10, 20, 30)')
    mockElementSize(viewerRoot, { left: 10, top: 20, width: 320, height: 480 })
    mockElementSize(page, { left: 30, top: 40, width: 200, height: 300 })
    mockElementSize(handle, { left: 90, top: 120, width: 20, height: 20 })

    fireEvent.pointerDown(handle, {
      pointerId: 31,
      pointerType: 'mouse',
      clientX: 105,
      clientY: 135,
      buttons: 1
    })
    const marker = screen
      .getByTestId('range-magnifier')
      .querySelector<HTMLElement>('.hamster-reader__range-magnifier-marker')!
    await waitFor(() => expect(marker).toHaveAttribute('data-caret', 'true'))
    expect(marker).toHaveStyle({
      left: '50%',
      top: '50%',
      height: '36px',
      backgroundColor: 'rgb(10, 20, 30)'
    })
    expect(caretRangeFromPoint).toHaveBeenCalledWith(105, 135)
    expect(screen.getByTestId('range-magnifier')).toHaveStyle({
      left: '35px',
      top: '55px'
    })

    fireEvent.pointerMove(document, {
      pointerId: 31,
      clientX: 37,
      clientY: 50,
      buttons: 1
    })
    expect(parseFloat(marker.style.left)).toBeCloseTo((14 / 120) * 100)
    expect(parseFloat(marker.style.top)).toBeCloseTo((20 / 120) * 100)
    expect(caretRangeFromPoint).toHaveBeenLastCalledWith(37, 50)
    expect(screen.getByTestId('range-magnifier')).toHaveStyle({
      left: '-33px',
      top: '-30px'
    })
    fireEvent.pointerUp(document, { pointerId: 31 })
    expect(marker).not.toHaveAttribute('data-caret')
    expect(screen.getByTestId('range-magnifier')).toHaveAttribute('hidden')
  } finally {
    view.unmount()
    if (previous)
      Object.defineProperty(document, 'caretRangeFromPoint', previous)
    else Reflect.deleteProperty(document, 'caretRangeFromPoint')
  }
})

it.each(['mouse', 'pen'])(
  'keeps the PDF Text %s lens on the physical pointer despite endpoint correction',
  (pointerType) => {
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const { rerender } = render(
      <Harness pdfText>
        <TextHandle className='hsn-selection-handle hsn-selection-handle--end' />
      </Harness>
    )
    const { handle } = prepareGeometry()
    // The endpoint is well above the handle's enlarged grab area.
    handle.dataset.pdfTextTargetX = '150'
    handle.dataset.pdfTextTargetY = '240'
    fireEvent.pointerDown(handle, {
      pointerId: 41,
      pointerType,
      clientX: 159,
      clientY: 279,
      buttons: 1
    })
    const lens = screen.getByTestId('range-magnifier')
    expect(lens).toHaveStyle({ left: '89px', top: '199px' })
    expect(lens).toHaveAttribute('data-placement', 'center')
    rerender(<Harness pdfText>{null}</Harness>)
    fireEvent.pointerMove(document, {
      pointerId: 41,
      pointerType,
      clientX: 175,
      clientY: 295,
      buttons: 1
    })
    const corrected = new PointerEvent('pointermove', {
      pointerId: 41,
      pointerType,
      clientX: 166,
      clientY: 256,
      bubbles: true
    })
    markSelectionPointerMoveAsTextHit(corrected)
    fireEvent(document, corrected)
    expect(lens).toHaveStyle({ left: '105px', top: '215px' })
    fireEvent.pointerCancel(document, { pointerId: 41 })
    expect(lens).toHaveAttribute('hidden')
  }
)

it('preserves finger clearance and corrected sampling for PDF Text touch', () => {
  html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
  render(
    <Harness pdfText>
      <TextHandle className='hsn-selection-handle hsn-selection-handle--end' />
    </Harness>
  )
  const { handle } = prepareGeometry()
  handle.dataset.pdfTextTargetX = '150'
  handle.dataset.pdfTextTargetY = '240'
  fireEvent.pointerDown(handle, {
    pointerId: 43,
    pointerType: 'touch',
    clientX: 159,
    clientY: 279,
    buttons: 1
  })
  const lens = screen.getByTestId('range-magnifier')
  expect(lens).toHaveStyle({ left: '80px', top: '82px' })
  expect(lens).toHaveAttribute('data-placement', 'above')
  fireEvent.pointerUp(document, { pointerId: 43 })
  expect(lens).toHaveAttribute('hidden')
})
