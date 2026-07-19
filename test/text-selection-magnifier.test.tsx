import { fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RangeMagnifierProvider } from '../src/components/IntermediateDocumentViewer/RangeMagnifier'
import { TextSelectionMagnifier } from '../src/components/IntermediateDocumentViewer/TextSelectionMagnifier'
import { mockElementSize } from './setup'

const html2canvasMock = vi.hoisted(() => vi.fn())

vi.mock('html2canvas', () => ({ default: html2canvasMock }))

interface HarnessProps {
  readonly children: ReactNode
}

const Harness = ({ children }: HarnessProps) => {
  const [viewerRoot, setViewerRoot] = useState<HTMLDivElement | null>(null)

  return (
    <div ref={setViewerRoot} data-testid='viewer-root'>
      <RangeMagnifierProvider rootElement={viewerRoot}>
        <TextSelectionMagnifier viewerRootElement={viewerRoot} />
        <div className='hamster-reader__intermediate-page'>{children}</div>
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
})
