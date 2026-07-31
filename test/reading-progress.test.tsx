import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReadingProgress } from '../src/components/IntermediateDocumentViewer/ReadingProgress'
import type { ReaderSelectionRange } from '../src/types/selection'
import { mockElementSize } from './setup'

const highlightedPage: ReaderSelectionRange = {
  id: 'range-page-3',
  text: 'highlight',
  start: { selectionId: 'page-3', offset: 0 },
  end: { selectionId: 'page-3', offset: 9 },
  createdAt: 1,
  overlayRectType: 'percent',
  rectsBySelectionId: {},
  markerStyle: { backgroundColor: 'rgb(220, 38, 38)' }
}

describe('ReadingProgress', () => {
  it('commits a pointer seek only once on release', () => {
    // Given: a five-page vertical rail with a measurable pointer lane.
    const onSeekPage = vi.fn()
    render(
      <ReadingProgress
        mode='text'
        pageNumbers={[1, 2, 3, 4, 5]}
        currentPageNumber={1}
        isMoving={false}
        ranges={[]}
        onSeekPage={onSeekPage}
      />
    )
    const slider = screen.getByRole('slider', { name: '文本阅读进度' })
    mockElementSize(slider, { width: 32, height: 400, left: 100, top: 100 })

    // When: a pen presses at page 2 and drags to page 4.
    fireEvent.pointerDown(slider, {
      clientY: 200,
      isPrimary: true,
      pointerId: 7,
      pointerType: 'pen'
    })
    fireEvent.pointerMove(slider, {
      clientY: 400,
      pointerId: 7,
      pointerType: 'pen'
    })

    // Then: feedback follows the pointer without navigating the document.
    expect(onSeekPage).not.toHaveBeenCalled()
    expect(within(slider).getByText('第 4 页')).toHaveAttribute(
      'data-visible',
      'true'
    )
    expect(
      slider.querySelector('.hamster-reader__reading-progress-position')
    ).toHaveAttribute('data-page-number', '4')
    expect(
      slider.querySelector('.hamster-reader__reading-progress-feedback')
    ).toHaveAttribute('data-page-number', '4')

    // When: that same pointer is released.
    fireEvent.pointerUp(slider, {
      clientY: 400,
      pointerId: 7,
      pointerType: 'pen'
    })

    // Then: the final pointed page is committed exactly once.
    expect(onSeekPage).toHaveBeenCalledTimes(1)
    expect(onSeekPage).toHaveBeenCalledWith(4)
  })

  it('does not seek when an active pointer is cancelled', () => {
    // Given: an active touch drag on the rail.
    const onSeekPage = vi.fn()
    render(
      <ReadingProgress
        mode='text'
        pageNumbers={[2, 4, 8]}
        currentPageNumber={2}
        isMoving={false}
        ranges={[]}
        onSeekPage={onSeekPage}
      />
    )
    const slider = screen.getByRole('slider', { name: '文本阅读进度' })
    mockElementSize(slider, { width: 32, height: 300 })
    fireEvent.pointerDown(slider, {
      clientY: 150,
      isPrimary: true,
      pointerId: 3,
      pointerType: 'touch'
    })

    // When: the operating system cancels that pointer sequence.
    fireEvent.pointerCancel(slider, {
      clientY: 150,
      pointerId: 3,
      pointerType: 'touch'
    })

    // Then: no page jump occurs.
    expect(onSeekPage).not.toHaveBeenCalled()
  })

  it('forwards wheel scrolling through the rail overlay', () => {
    // Given: the rail overlays a sibling native scroll viewport.
    const scrollBy = vi.fn()
    render(
      <div>
        <div className='hamster-reader__intermediate-text-viewer' />
        <ReadingProgress
          mode='text'
          pageNumbers={[1, 2]}
          currentPageNumber={1}
          isMoving={false}
          ranges={[]}
          onSeekPage={vi.fn()}
        />
      </div>
    )
    const slider = screen.getByRole('slider', { name: '文本阅读进度' })
    const scrollViewport = slider.parentElement?.querySelector(
      '.hamster-reader__intermediate-text-viewer'
    )
    if (!(scrollViewport instanceof HTMLElement)) {
      throw new Error('Expected the Text scroll viewport fixture')
    }
    scrollViewport.scrollBy = scrollBy

    // When: the user wheels over the rail's pointer lane.
    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 2,
      deltaY: 180
    })
    slider.dispatchEvent(wheelEvent)

    // Then: the native viewport receives the same wheel delta.
    expect(wheelEvent.defaultPrevented).toBe(true)
    expect(scrollBy).toHaveBeenCalledWith({
      behavior: 'auto',
      left: 2,
      top: 180
    })
  })

  it('forwards modified Layout wheel input to VirtualPaper zoom handling', () => {
    // Given: Layout mode overlays a VirtualPaper viewport that owns wheel zoom.
    render(
      <div>
        <div className='virtual-paper-wrapper' />
        <ReadingProgress
          mode='layout'
          pageNumbers={[1, 2]}
          currentPageNumber={1}
          isMoving={false}
          ranges={[]}
          previewEnabled={true}
          baseImagesByPageNumber={new Map()}
          pageSizesByPageNumber={new Map()}
          onSeekPage={vi.fn()}
        />
      </div>
    )
    const slider = screen.getByRole('slider', { name: '版面阅读进度' })
    const virtualPaper = slider.parentElement?.querySelector(
      '.virtual-paper-wrapper'
    )
    if (!(virtualPaper instanceof HTMLElement)) {
      throw new Error('Expected the VirtualPaper fixture')
    }
    const onVirtualPaperWheel = vi.fn()
    virtualPaper.addEventListener('wheel', onVirtualPaperWheel)

    // When: the user performs a modified wheel gesture over the rail.
    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -90
    })
    slider.dispatchEvent(wheelEvent)

    // Then: the browser default is suppressed and VirtualPaper receives zoom input.
    expect(wheelEvent.defaultPrevented).toBe(true)
    expect(onVirtualPaperWheel).toHaveBeenCalledTimes(1)
    expect(onVirtualPaperWheel.mock.calls[0]?.[0]).toMatchObject({
      ctrlKey: true,
      deltaY: -90
    })
  })

  it('shows live Layout touch feedback before committing the final page', () => {
    // Given: Layout mode has cached thumbnails for the pages a touch drag crosses.
    const onSeekPage = vi.fn()
    render(
      <ReadingProgress
        mode='layout'
        pageNumbers={[1, 2, 3, 4, 5]}
        currentPageNumber={1}
        isMoving={false}
        ranges={[]}
        previewEnabled={true}
        baseImagesByPageNumber={
          new Map([
            [2, 'data:image/png;base64,page2'],
            [4, 'data:image/png;base64,page4']
          ])
        }
        pageSizesByPageNumber={
          new Map([
            [2, { width: 600, height: 800 }],
            [4, { width: 600, height: 800 }]
          ])
        }
        onSeekPage={onSeekPage}
      />
    )
    const slider = screen.getByRole('slider', { name: '版面阅读进度' })
    mockElementSize(slider, { width: 32, height: 400, left: 100, top: 100 })

    // When: a finger presses near page 2 and drags to page 4.
    fireEvent.pointerDown(slider, {
      clientY: 200,
      isPrimary: true,
      pointerId: 9,
      pointerType: 'touch'
    })
    fireEvent.pointerMove(slider, {
      clientY: 400,
      pointerId: 9,
      pointerType: 'touch'
    })

    // Then: Layout mirrors Text timing and exposes touch-aware feedback before release.
    expect(onSeekPage).not.toHaveBeenCalled()
    expect(slider).toHaveAttribute('data-pointer-type', 'touch')
    expect(within(slider).getByText('第 4 页')).toHaveAttribute(
      'data-visible',
      'true'
    )
    expect(screen.getByTestId('reading-progress-preview-4')).toBeInTheDocument()

    // When: the same finger releases on page 4.
    fireEvent.pointerUp(slider, {
      clientY: 400,
      pointerId: 9,
      pointerType: 'touch'
    })

    // Then: navigation happens once and the temporary touch offset state is cleared.
    expect(onSeekPage).toHaveBeenCalledTimes(1)
    expect(onSeekPage).toHaveBeenCalledWith(4)
    expect(slider).not.toHaveAttribute('data-pointer-type')
    expect(within(slider).getByText('第 1 页')).toHaveAttribute(
      'data-visible',
      'false'
    )
  })

  it('shows cached Layout thumbnails on hover and protects their lazy page', () => {
    // Given: Layout mode already has a cached thumbnail for page 3.
    const onPreviewPageVisibilityChange = vi.fn()
    render(
      <ReadingProgress
        mode='layout'
        pageNumbers={[1, 2, 3]}
        currentPageNumber={1}
        isMoving={false}
        ranges={[highlightedPage]}
        highlightColor='rgb(250, 204, 21)'
        previewEnabled={true}
        baseImagesByPageNumber={new Map([[3, 'data:image/png;base64,page3']])}
        pageSizesByPageNumber={new Map([[3, { width: 600, height: 800 }]])}
        onPreviewPageVisibilityChange={onPreviewPageVisibilityChange}
        onSeekPage={vi.fn()}
      />
    )
    const slider = screen.getByRole('slider', { name: '版面阅读进度' })
    mockElementSize(slider, { width: 32, height: 300 })

    // When: a mouse points at the last page.
    fireEvent.pointerMove(slider, {
      clientY: 300,
      pointerId: 1,
      pointerType: 'mouse'
    })

    // Then: the cached page preview appears to the rail's left and its page is protected.
    expect(
      slider.querySelector('.hamster-reader__reading-progress-feedback')
    ).toHaveAttribute('data-has-preview', 'true')
    expect(screen.getByTestId('reading-progress-preview-3')).toHaveAttribute(
      'src',
      'data:image/png;base64,page3'
    )
    expect(onPreviewPageVisibilityChange).toHaveBeenCalledWith(3, true)

    // When: the mouse leaves the interaction lane.
    fireEvent.pointerLeave(slider, { pointerId: 1, pointerType: 'mouse' })

    // Then: the preview page leaves the shared lazy-loading protection set.
    expect(onPreviewPageVisibilityChange).toHaveBeenLastCalledWith(3, false)
  })

  it('moves the Layout page label only while a thumbnail is rendered', () => {
    // Given: scroll activity exposes a Layout page label without pointer preview.
    render(
      <ReadingProgress
        mode='layout'
        pageNumbers={[1, 2, 3]}
        currentPageNumber={2}
        isMoving={true}
        ranges={[]}
        previewEnabled={true}
        baseImagesByPageNumber={new Map()}
        pageSizesByPageNumber={new Map()}
        onSeekPage={vi.fn()}
      />
    )
    const slider = screen.getByRole('slider', { name: '版面阅读进度' })
    const feedback = slider.querySelector(
      '.hamster-reader__reading-progress-feedback'
    )
    if (!(feedback instanceof HTMLElement)) {
      throw new Error('Expected the Layout reading-progress feedback')
    }
    mockElementSize(slider, { width: 32, height: 300 })

    // Then: the page label declares that it should remain next to the rail.
    expect(feedback).toHaveAttribute('data-has-preview', 'false')

    // When: pointer hover targets a page whose thumbnail is not cached yet.
    fireEvent.pointerMove(slider, {
      clientY: 300,
      pointerId: 1,
      pointerType: 'mouse'
    })

    // Then: no empty preview shell appears and the label remains next to the rail.
    expect(feedback).toHaveAttribute('data-has-preview', 'false')
    expect(
      slider.querySelector('.hamster-reader__reading-progress-preview')
    ).not.toBeInTheDocument()
  })

  it('keeps non-PDF Layout feedback thumbnail-free and inside its safe area', () => {
    // Given: a non-PDF Layout document exposes an incidental cached page image.
    const onPreviewPageVisibilityChange = vi.fn()
    render(
      <ReadingProgress
        mode='layout'
        pageNumbers={[1, 2, 3]}
        currentPageNumber={1}
        isMoving={false}
        ranges={[]}
        previewEnabled={false}
        insetTop={16}
        insetBottom={72}
        baseImagesByPageNumber={new Map([[3, 'data:image/png;base64,page3']])}
        pageSizesByPageNumber={new Map([[3, { width: 600, height: 800 }]])}
        onPreviewPageVisibilityChange={onPreviewPageVisibilityChange}
        onSeekPage={vi.fn()}
      />
    )
    const slider = screen.getByRole('slider', { name: '版面阅读进度' })
    mockElementSize(slider, { width: 32, height: 300 })

    // When: the pointer drags to the cached image's page.
    fireEvent.pointerMove(slider, {
      clientY: 300,
      pointerId: 1,
      pointerType: 'mouse'
    })

    // Then: the page label remains centered beside the rail without a thumbnail,
    // and the rail is shortened by the viewer's toolbar-safe margins.
    expect(screen.getByText('第 3 页')).toBeInTheDocument()
    expect(
      slider.querySelector('.hamster-reader__reading-progress-preview')
    ).not.toBeInTheDocument()
    expect(onPreviewPageVisibilityChange).not.toHaveBeenCalled()
    expect(slider).toHaveStyle({ top: '16px', bottom: '72px' })
  })

  it('renders page-colored highlight ticks and keeps keyboard page semantics', () => {
    // Given: a non-contiguous page list with one custom-colored highlight.
    const onSeekPage = vi.fn()
    render(
      <ReadingProgress
        mode='text'
        pageNumbers={[1, 3, 9]}
        currentPageNumber={3}
        isMoving={false}
        ranges={[highlightedPage]}
        highlightColor='rgb(250, 204, 21)'
        onSeekPage={onSeekPage}
      />
    )
    const slider = screen.getByRole('slider', { name: '文本阅读进度' })

    // Then: the page-3 tick uses its range color at the middle of the rail.
    expect(screen.getByTestId('reading-progress-highlight-3')).toHaveStyle({
      backgroundColor: 'rgb(220, 38, 38)',
      top: '50%'
    })

    // When: keyboard navigation advances one available page.
    fireEvent.keyDown(slider, { key: 'ArrowDown' })

    // Then: it seeks to the next real document page rather than adding one.
    expect(onSeekPage).toHaveBeenCalledWith(9)
  })
})
