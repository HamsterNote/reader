import type {
  HandleRenderProps,
  LinkedSelectionData
} from '@hamster-note/selection'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RangeHandle } from '../src/components/IntermediateDocumentViewer/RangeHandle'
import { RangeMagnifierProvider } from '../src/components/IntermediateDocumentViewer/RangeMagnifier'
import { mockElementSize } from './setup'

const html2canvasMock = vi.hoisted(() => vi.fn())

vi.mock('html2canvas', () => ({ default: html2canvasMock }))

const rectHandle: HandleRenderProps = {
  type: 'start',
  owner: 'persisted-range',
  rangeId: 'range-rect-1',
  target: 'rect',
  rectId: 'rect-1',
  position: { x: 20, y: 30 },
  positionUnit: 'px',
  isDragging: false,
  onPointerDown: vi.fn(),
  ariaLabel: 'Drag rectangle start',
  className: 'hsn-selection-handle hsn-selection-handle-rect',
  style: { left: 20, top: 30 }
}

const linkedData: LinkedSelectionData = {
  items: [],
  selectedRangeId: null,
  selectionOrder: []
}

afterEach(() => {
  html2canvasMock.mockReset()
  vi.mocked(rectHandle.onPointerDown).mockReset()
})

describe('rectangle range handle magnifier', () => {
  it('shows the lens when dragging a rectangle range handle', () => {
    // Given: a rectangle handle rendered with the dependency default geometry.
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const portalHost = document.createElement('div')
    document.body.append(portalHost)
    const { unmount } = render(
      <RangeMagnifierProvider rootElement={portalHost}>
        <div className='hamster-reader__intermediate-page'>
          <RangeHandle
            handle={rectHandle}
            linkedData={linkedData}
            scale={2}
            selectionId='reader:test:page-1'
          />
        </div>
      </RangeMagnifierProvider>
    )
    const handle = screen.getByRole('button', {
      name: 'Drag rectangle start'
    })
    mockElementSize(portalHost, { left: 10, top: 20, width: 320, height: 480 })
    mockElementSize(handle, { left: 140, top: 260, width: 20, height: 20 })

    // When: the user presses the rectangle range handle.
    fireEvent.pointerDown(handle, {
      pointerId: 17,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })

    // Then: the same root-level magnifier session starts without changing
    // the dependency-provided handle geometry or pointer-down callback.
    // 同时校验矩形 handle 在 scale=2 时通过反向 scale(1/2) 抵消 VirtualPaper
    // 容器缩放，保证不同 zoom 下视觉直径恒定为依赖库 CSS 类定义的尺寸。
    expect(screen.getByTestId('range-magnifier')).not.toHaveAttribute('hidden')
    expect(handle).toHaveStyle({ left: '20px', top: '30px' })
    expect(handle).toHaveStyle({
      transform: 'translate(-50%, -50%) scale(0.5)'
    })
    // 矩形 handle 与文字 handle 共用同一套圆形渲染：固定 20px 直径 + 50% 圆角，
    // 配合上面的反向 scale，在不同 zoom 下视觉直径均恒定为 20px，与文字 handle 一致。
    expect(handle).toHaveStyle({
      width: '20px',
      height: '20px',
      borderRadius: '50%'
    })
    expect(rectHandle.onPointerDown).toHaveBeenCalledOnce()

    fireEvent.pointerUp(document, { pointerId: 17 })
    unmount()
    portalHost.remove()
  })
})
