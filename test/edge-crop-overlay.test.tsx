import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EdgeCropOverlay } from '../src/components/IntermediateDocumentViewer/EdgeCropOverlay'
import type { ReaderPageEdgeCrop } from '../src/types/readerData'
import { mockElementSize } from './setup'

describe('EdgeCropOverlay', () => {
  /** 获取覆盖层容器元素（用于模拟尺寸） */
  function getOverlayContainer(container: HTMLElement): HTMLElement {
    return container.querySelector(
      '.hamster-reader__edge-crop-overlay'
    ) as HTMLElement
  }

  it('renders four crop lines and two apply buttons', () => {
    // 基本渲染：验证四条裁切线和两个操作按钮都存在
    render(<EdgeCropOverlay pageNumber={1} edgeCrop={undefined} />)

    expect(screen.getByTestId('edge-crop-line-top')).toBeInTheDocument()
    expect(screen.getByTestId('edge-crop-line-bottom')).toBeInTheDocument()
    expect(screen.getByTestId('edge-crop-line-left')).toBeInTheDocument()
    expect(screen.getByTestId('edge-crop-line-right')).toBeInTheDocument()
    expect(screen.getByTestId('edge-crop-apply-page')).toBeInTheDocument()
    expect(screen.getByTestId('edge-crop-apply-all')).toBeInTheDocument()
  })

  it('initializes line positions from global edgeCrop', () => {
    // 验证：传入全局裁切值时，四条线的初始位置正确反映裁切比例
    const edgeCrop: ReaderPageEdgeCrop = {
      all: { top: 0.1, right: 0.2, bottom: 0.15, left: 0.1 }
    }
    render(<EdgeCropOverlay pageNumber={1} edgeCrop={edgeCrop} />)

    // top: 0.1 -> 10%
    expect(screen.getByTestId('edge-crop-line-top')).toHaveStyle({ top: '10%' })
    // bottom: 0.15 -> (1 - 0.15) * 100 = 85%
    expect(screen.getByTestId('edge-crop-line-bottom')).toHaveStyle({
      top: '85%'
    })
    // left: 0.1 -> 10%
    expect(screen.getByTestId('edge-crop-line-left')).toHaveStyle({
      left: '10%'
    })
    // right: 0.2 -> (1 - 0.2) * 100 = 80%
    expect(screen.getByTestId('edge-crop-line-right')).toHaveStyle({
      left: '80%'
    })
  })

  it('uses page-specific edgeCrop override when available', () => {
    // 验证：当存在页码特定覆盖时，使用覆盖值而非全局值
    const edgeCrop: ReaderPageEdgeCrop = {
      all: { top: 0.1, right: 0.2, bottom: 0.15, left: 0.1 },
      pages: {
        'page-2': { top: 0.3, right: 0.4, bottom: 0.05, left: 0.25 }
      }
    }
    render(<EdgeCropOverlay pageNumber={2} edgeCrop={edgeCrop} />)

    // page-2 覆盖：top: 0.3 -> 30%
    expect(screen.getByTestId('edge-crop-line-top')).toHaveStyle({ top: '30%' })
    // bottom: 0.05 -> (1 - 0.05) * 100 = 95%
    expect(screen.getByTestId('edge-crop-line-bottom')).toHaveStyle({
      top: '95%'
    })
    // left: 0.25 -> 25%
    expect(screen.getByTestId('edge-crop-line-left')).toHaveStyle({
      left: '25%'
    })
    // right: 0.4 -> (1 - 0.4) * 100 = 60%
    expect(screen.getByTestId('edge-crop-line-right')).toHaveStyle({
      left: '60%'
    })
  })

  it('defaults all crop lines to edges when edgeCrop is undefined', () => {
    // 验证：无裁切配置时，四条线位于页面边缘（0% 和 100%）
    render(<EdgeCropOverlay pageNumber={1} edgeCrop={undefined} />)

    // 上边线在 0%，下边线在 100%
    expect(screen.getByTestId('edge-crop-line-top')).toHaveStyle({ top: '0%' })
    expect(screen.getByTestId('edge-crop-line-bottom')).toHaveStyle({
      top: '100%'
    })
    // 左边线在 0%，右边线在 100%
    expect(screen.getByTestId('edge-crop-line-left')).toHaveStyle({
      left: '0%'
    })
    expect(screen.getByTestId('edge-crop-line-right')).toHaveStyle({
      left: '100%'
    })
  })

  it('updates top crop ratio when dragging the top line', () => {
    // 验证：拖拽顶边线后，裁切比例正确更新
    const { container } = render(
      <EdgeCropOverlay pageNumber={1} edgeCrop={undefined} />
    )
    // 模拟覆盖层尺寸为 200×400
    const overlay = getOverlayContainer(container)
    mockElementSize(overlay, { width: 200, height: 400 })

    const topLine = screen.getByTestId('edge-crop-line-top')

    // 拖拽顶边线到 y=40 的位置
    fireEvent.pointerDown(topLine, {
      clientX: 100,
      clientY: 40,
      pointerId: 1
    })
    fireEvent.pointerMove(topLine, {
      clientX: 100,
      clientY: 40,
      pointerId: 1
    })
    fireEvent.pointerUp(topLine, {
      clientX: 100,
      clientY: 40,
      pointerId: 1
    })

    // 40 / 400 = 0.1 -> 10%
    expect(topLine).toHaveStyle({ top: '10%' })
  })

  it('updates left crop ratio when dragging the left line', () => {
    // 验证：拖拽左边线后，裁切比例正确更新
    const { container } = render(
      <EdgeCropOverlay pageNumber={1} edgeCrop={undefined} />
    )
    const overlay = getOverlayContainer(container)
    mockElementSize(overlay, { width: 200, height: 400 })

    const leftLine = screen.getByTestId('edge-crop-line-left')

    // 拖拽左边线到 x=50 的位置
    fireEvent.pointerDown(leftLine, {
      clientX: 50,
      clientY: 200,
      pointerId: 1
    })
    fireEvent.pointerMove(leftLine, {
      clientX: 50,
      clientY: 200,
      pointerId: 1
    })
    fireEvent.pointerUp(leftLine, {
      clientX: 50,
      clientY: 200,
      pointerId: 1
    })

    // 50 / 200 = 0.25 -> 25%
    expect(leftLine).toHaveStyle({ left: '25%' })
  })

  it('clamps crop ratio so opposite edges do not exceed MAX_AXIS_CROP', () => {
    // 验证：对边约束——top 已为 0.9 时，bottom 最多只能到 0.09
    const edgeCrop: ReaderPageEdgeCrop = {
      all: { top: 0.9, right: 0, bottom: 0, left: 0 }
    }
    const { container } = render(
      <EdgeCropOverlay pageNumber={1} edgeCrop={edgeCrop} />
    )
    const overlay = getOverlayContainer(container)
    mockElementSize(overlay, { width: 200, height: 400 })

    const bottomLine = screen.getByTestId('edge-crop-line-bottom')

    // 尝试将底边拖到 y=0（即 bottom ratio = 1.0），但 top 已是 0.9
    // clampRatio 应将 bottom 限制为 MAX_AXIS_CROP - top = 0.99 - 0.9 = 0.09
    fireEvent.pointerDown(bottomLine, {
      clientX: 100,
      clientY: 0,
      pointerId: 1
    })
    fireEvent.pointerMove(bottomLine, {
      clientX: 100,
      clientY: 0,
      pointerId: 1
    })
    fireEvent.pointerUp(bottomLine, {
      clientX: 100,
      clientY: 0,
      pointerId: 1
    })

    // bottom: 0.09 -> (1 - 0.09) * 100 = 91%
    expect(bottomLine).toHaveStyle({ top: '91%' })
  })

  it('calls onApply with page number when apply-page button is clicked', () => {
    // 验证：点击「应用到此页」时，onApply 收到当前页码和裁切值
    const onApply = vi.fn()
    const edgeCrop: ReaderPageEdgeCrop = {
      all: { top: 0.1, right: 0.2, bottom: 0.05, left: 0.15 }
    }
    render(
      <EdgeCropOverlay pageNumber={3} edgeCrop={edgeCrop} onApply={onApply} />
    )

    fireEvent.click(screen.getByTestId('edge-crop-apply-page'))

    expect(onApply).toHaveBeenCalledWith(3, {
      top: 0.1,
      right: 0.2,
      bottom: 0.05,
      left: 0.15
    })
  })

  it('calls onApply with null when apply-all button is clicked', () => {
    // 验证：点击「应用到所有页」时，onApply 收到 null 和裁切值
    const onApply = vi.fn()
    const edgeCrop: ReaderPageEdgeCrop = {
      all: { top: 0.1, right: 0.2, bottom: 0.05, left: 0.15 }
    }
    render(
      <EdgeCropOverlay pageNumber={3} edgeCrop={edgeCrop} onApply={onApply} />
    )

    fireEvent.click(screen.getByTestId('edge-crop-apply-all'))

    expect(onApply).toHaveBeenCalledWith(null, {
      top: 0.1,
      right: 0.2,
      bottom: 0.05,
      left: 0.15
    })
  })

  it('passes updated crop after drag to onApply', () => {
    // 验证：拖拽后点击应用，onApply 收到的是更新后的裁切值
    const onApply = vi.fn()
    const { container } = render(
      <EdgeCropOverlay pageNumber={1} edgeCrop={undefined} onApply={onApply} />
    )
    const overlay = getOverlayContainer(container)
    mockElementSize(overlay, { width: 200, height: 400 })

    const topLine = screen.getByTestId('edge-crop-line-top')

    // 拖拽顶边线到 y=80 的位置
    fireEvent.pointerDown(topLine, {
      clientX: 100,
      clientY: 80,
      pointerId: 1
    })
    fireEvent.pointerMove(topLine, {
      clientX: 100,
      clientY: 80,
      pointerId: 1
    })
    fireEvent.pointerUp(topLine, {
      clientX: 100,
      clientY: 80,
      pointerId: 1
    })

    // 80 / 400 = 0.2
    fireEvent.click(screen.getByTestId('edge-crop-apply-page'))

    expect(onApply).toHaveBeenCalledWith(1, {
      top: 0.2,
      right: 0,
      bottom: 0,
      left: 0
    })
  })

  it('drags lines when an ancestor natively stops pointerdown propagation', () => {
    // 复现真实阅读器环境：VirtualPaper 在未启用 MouseDragPan 时，
    // 会在其 container 上注册原生 pointerdown 监听器并 stopPropagation，
    // 导致 React 合成事件无法到达覆盖层（真实 bug：虚线可见但拖不动）。
    // Given: 覆盖层被「原生拦截 pointerdown 冒泡」的祖先包裹
    const onApply = vi.fn()
    const { container } = render(
      <div
        ref={(node) => {
          node?.addEventListener('pointerdown', (event) =>
            event.stopPropagation()
          )
        }}
      >
        <EdgeCropOverlay
          pageNumber={1}
          edgeCrop={undefined}
          onApply={onApply}
        />
      </div>
    )
    const overlay = getOverlayContainer(container)
    mockElementSize(overlay, { width: 1000, height: 800 })
    const topLine = screen.getByTestId('edge-crop-line-top')

    // When: 沿顶边线按下并拖动（fireEvent 走完整原生冒泡，与真实浏览器一致）
    fireEvent.pointerDown(topLine, { clientX: 500, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(topLine, { clientX: 500, clientY: 80, pointerId: 1 })
    fireEvent.pointerUp(topLine, { clientX: 500, clientY: 80, pointerId: 1 })

    // Then: 祖先的原生拦截不影响拖拽，top 应更新为 80/800 = 10%
    expect(topLine).toHaveStyle({ top: '10%' })
  })
})
