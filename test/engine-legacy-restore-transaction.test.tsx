import { act, fireEvent, render } from '@testing-library/react'
import {
  createRef,
  StrictMode,
  forwardRef,
  useImperativeHandle,
  type ComponentProps
} from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { EngineDocumentViewer } from '../src/components/EngineDocumentViewer'
import type { EngineSelectionControls } from '../src/components/EngineSelectionControls'
import type { PageBrowser } from '../src/components/IntermediateDocumentViewer/PageBrowser'
import type { ReaderReadingPositionHandle } from '../src/components/IntermediateDocumentViewer'
import type { ReaderSelectionRef } from '../src/types/selection'
import type { ReaderBookmark } from '../src/types/readerData'
import type {
  PdfDocumentViewerProps,
  PdfDocumentViewerRef
} from '../src/pdf/PdfDocumentViewer'

const state = vi.hoisted(() => ({
  pdf: null as PdfDocumentViewerProps | null,
  browser: null as ComponentProps<typeof PageBrowser> | null,
  controls: null as ComponentProps<typeof EngineSelectionControls> | null,
  api: null as PdfDocumentViewerRef | null
}))
vi.mock('../src/components/EngineSelectionControls', () => ({
  EngineSelectionControls: (
    props: ComponentProps<typeof EngineSelectionControls>
  ) => {
    state.controls = props
    return null
  }
}))
vi.mock('../src/pdf/PdfDocumentViewer', () => ({
  PdfDocumentViewer: forwardRef<PdfDocumentViewerRef, PdfDocumentViewerProps>(
    (props, ref) => {
      state.pdf = props
      useImperativeHandle(ref, () => state.api!)
      return (
        <div
          data-testid='paper'
          className='hamster-reader__pdf-viewer-container'
        />
      )
    }
  )
}))
vi.mock('../src/components/IntermediateDocumentViewer/PageBrowser', () => ({
  PageBrowser: (props: ComponentProps<typeof PageBrowser>) => {
    state.browser = props
    return <div role='complementary' data-testid='sidebar' />
  }
}))

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const source = { format: 'pdf' as const, data: new Uint8Array([1]) }
const legacy = { x: 0, y: -3000, scale: 1 }
const fresh = { pageNumber: 3, verticalPercentage: 65 }
let position: ReaderBookmark
beforeEach(() => {
  position = { pageNumber: 1, verticalPercentage: 0 }
  state.api = {
    captureTextAnchor: () => null,
    captureReadingPosition: () => ({ status: 'ready', position }),
    scrollToAnchor: vi.fn(async (target) => {
      position = target
    }),
    scrollToAnchorForRestore: vi.fn(async (target) => {
      position = target
    }),
    scrollToPage: vi.fn((pageNumber) => {
      position = { ...fresh, pageNumber }
    }),
    scrollToRange: vi.fn(() => {
      position = fresh
    }),
    setScale: vi.fn(),
    releasePreviewPage: vi.fn(),
    isRendering: () => false,
    getCanonicalPageText: () => undefined,
    confirmSelection: vi.fn(),
    clearSelection: vi.fn(),
    selectRange: () => null,
    getSelectionRange: () => null,
    setSelectionRange: vi.fn(),
    hitTestSelection: () => null,
    serializeRangeEndpoint: () => null,
    serializeSelection: () => null
  }
})

function mountWaiting(strict = false) {
  const metadata = deferred()
  const onProgress = vi.fn()
  const onReady = vi.fn()
  const ref = createRef<ReaderReadingPositionHandle>()
  const selectionRef = createRef<ReaderSelectionRef>()
  const props = {
    engineSource: source,
    defaultVirtualPaperTransform: legacy,
    onLayoutReadingProgressChange: onProgress,
    onEngineReady: onReady,
    readingPositionRef: ref,
    selectionRef
  }
  const element = <EngineDocumentViewer {...props} />
  const view = render(strict ? <StrictMode>{element}</StrictMode> : element)
  const getPage = async () => {
    await metadata.promise
    return { getViewport: () => ({ width: 600, height: 2000 }) }
  }
  act(() => state.pdf!.onDocumentReady!({ numPages: 3, getPage } as never))
  let ready!: Promise<unknown>
  act(() => {
    ready = Promise.resolve(state.pdf!.onPagesLoaded!(3))
  })
  return {
    ...view,
    metadata,
    ready,
    onProgress,
    onReady,
    ref,
    selectionRef,
    props
  }
}

function readWithTouch(paper: HTMLElement) {
  const point = { identifier: 1, clientX: 30, clientY: 100 }
  fireEvent.touchStart(paper, { touches: [point] })
  fireEvent.touchMove(paper, { touches: [{ ...point, clientY: 40 }] })
  fireEvent.touchEnd(paper, {
    touches: [],
    changedTouches: [{ ...point, clientY: 40 }]
  })
}

function touchPointer(paper: HTMLElement, distance: number) {
  // jsdom has no PointerEvent constructor; preserve the actual pointer payload.
  const point = {
    pointerType: 'touch',
    pointerId: 1,
    clientX: 30,
    clientY: 100
  }
  fireEvent(
    paper,
    Object.assign(new Event('pointerdown', { bubbles: true }), point)
  )
  fireEvent(
    paper,
    Object.assign(new Event('pointermove', { bubbles: true }), {
      ...point,
      clientY: 100 - distance
    })
  )
  fireEvent(
    paper,
    Object.assign(new Event('pointerup', { bubbles: true }), point)
  )
}

it.each(['wheel', 'touch', 'pinch', 'pointer-touch', 'pdf-link'] as const)(
  'retains %s reading and saves when legacy metadata completes before controlled echo',
  async (input) => {
    const view = mountWaiting()
    const paper = view.getByTestId('paper')
    paper.addEventListener(input === 'wheel' ? 'wheel' : 'touchmove', (event) =>
      event.stopPropagation()
    )
    if (input === 'wheel') fireEvent.wheel(paper, { deltaY: 250 })
    else if (input === 'touch') readWithTouch(paper)
    else if (input === 'pointer-touch') touchPointer(paper, 60)
    else if (input === 'pdf-link') {
      const link = document.createElement('a')
      link.className = 'internalLink'
      link.textContent = 'PDF internal destination'
      paper.append(link)
      // A tap's click can arrive without a mouse pointerdown or touch move.
      fireEvent.click(link)
    } else {
      const a = { identifier: 1, clientX: 30, clientY: 100 }
      const b = { identifier: 2, clientX: 100, clientY: 100 }
      fireEvent.touchStart(paper, { touches: [a, b] })
      fireEvent.touchMove(paper, { touches: [a, { ...b, clientX: 150 }] })
    }
    act(() => {
      position = fresh
      state.pdf!.onReadingPositionChange!({ status: 'ready', position })
    })
    expect(view.onProgress).toHaveBeenLastCalledWith(fresh)
    // Intentionally do NOT echo this publication into layoutReadingProgress.
    expect(view.props).not.toHaveProperty('layoutReadingProgress')
    await act(async () => {
      view.metadata.resolve()
      await view.ready
    })
    expect(state.api!.scrollToAnchorForRestore).not.toHaveBeenCalled()
    expect(state.api!.scrollToPage).not.toHaveBeenCalled()
    expect(position).toEqual(fresh)
    view.onProgress.mockClear()
    act(() => view.ref.current!.captureAndPublish!())
    expect(view.onProgress).toHaveBeenCalledExactlyOnceWith(fresh)
    expect(view.queryByRole('status')).toBeNull()
  }
)

it.each([
  'page',
  'bookmark',
  'range',
  'browser-range',
  'coordinates',
  'controlled',
  'controlled-same-position',
  'keyboard',
  'pointer',
  'selection-auto-scroll'
] as const)(
  'cancels legacy metadata for the %s position writer',
  async (entry) => {
    const view = mountWaiting()
    const paper = view.getByTestId('paper')
    await act(async () => {
      switch (entry) {
        case 'page':
          state.browser!.onNavigateToPage(3)
          break
        case 'bookmark':
          state.browser!.onNavigateToBookmark!(fresh)
          break
        case 'range':
          view.selectionRef.current!.scrollToRange('range')
          break
        case 'browser-range':
          state.browser!.onNavigateToRange!('range')
          break
        case 'coordinates':
          paper.scrollTo = vi.fn(() => {
            position = fresh
          })
          view.selectionRef.current!.scrollToPosition({
            x: 0,
            y: 200,
            scale: 2
          })
          expect(state.api!.setScale).toHaveBeenCalledWith(2)
          break
        case 'controlled-same-position':
          position = fresh
          view.rerender(
            <EngineDocumentViewer
              {...view.props}
              layoutReadingProgress={fresh}
            />
          )
          break
        case 'controlled':
          view.rerender(
            <EngineDocumentViewer
              {...view.props}
              layoutReadingProgress={fresh}
            />
          )
          break
        case 'keyboard':
          fireEvent.keyDown(paper, { key: 'PageDown' })
          position = fresh
          break
        case 'pointer':
          fireEvent.pointerDown(paper, { pointerType: 'mouse' })
          position = fresh
          break
        case 'selection-auto-scroll':
          state.controls!.onEditingChange(true)
          position = fresh
          break
      }
    })
    const callsBeforeMetadata = vi.mocked(state.api!.scrollToAnchorForRestore)
      .mock.calls.length
    await act(async () => {
      view.metadata.resolve()
      await view.ready
    })
    expect(state.api!.scrollToAnchorForRestore).toHaveBeenCalledTimes(
      callsBeforeMetadata
    )
    expect(state.api!.scrollToAnchorForRestore).not.toHaveBeenCalledWith(
      { pageNumber: 2, verticalPercentage: 48.8 },
      { preserveOnFailure: false }
    )
    expect(position).toEqual(fresh)
  }
)

it.each(['source', 'document', 'pdf-document', 'retry', 'unmount'] as const)(
  'discards metadata after %s replacement',
  async (entry) => {
    const view = mountWaiting()
    act(() => {
      switch (entry) {
        case 'source':
          view.rerender(
            <EngineDocumentViewer
              {...view.props}
              engineSource={{ ...source, data: new Uint8Array([2]) }}
            />
          )
          break
        case 'document':
          view.rerender(
            <EngineDocumentViewer {...view.props} document={{} as never} />
          )
          break
        case 'pdf-document':
          state.pdf!.onDocumentReady!({ numPages: 3 } as never)
          break
        case 'retry':
          state.pdf!.onError!({ kind: 'unknown', message: 'retry' })
          break
        case 'unmount':
          view.unmount()
          break
      }
    })
    if (entry === 'retry')
      fireEvent.click(view.getByRole('button', { name: '重试' }))
    await act(async () => {
      view.metadata.resolve()
      await view.ready
    })
    expect(state.api!.scrollToAnchorForRestore).not.toHaveBeenCalled()
    expect(view.onProgress).not.toHaveBeenCalled()
    expect(view.onReady).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  }
)

it.each([
  'zero-wheel',
  'stationary-touch',
  'stationary-pointer-touch',
  'untracked-touch',
  'sidebar-wheel',
  'programmatic-scroll'
] as const)('keeps the untouched legacy restore for %s', async (input) => {
  const view = mountWaiting()
  const paper = view.getByTestId('paper')
  const point = { identifier: 1, clientX: 30, clientY: 100 }
  switch (input) {
    case 'zero-wheel':
      fireEvent.wheel(paper, { deltaY: 0 })
      break
    case 'stationary-touch':
      fireEvent.touchStart(paper, { touches: [point] })
      fireEvent.touchMove(paper, { touches: [point] })
      break
    case 'stationary-pointer-touch':
      touchPointer(paper, 0)
      break
    case 'untracked-touch':
      fireEvent.touchMove(paper, {
        touches: [{ ...point, clientY: 40 }]
      })
      break
    case 'sidebar-wheel':
      fireEvent.wheel(view.getByTestId('sidebar'), { deltaY: 250 })
      break
    case 'programmatic-scroll':
      fireEvent.scroll(paper)
      break
  }
  await act(async () => {
    view.metadata.resolve()
    await view.ready
  })
  expect(state.api!.scrollToAnchorForRestore).toHaveBeenCalledExactlyOnceWith(
    { pageNumber: 2, verticalPercentage: 48.8 },
    { preserveOnFailure: false }
  )
  expect(view.onProgress).not.toHaveBeenCalled()
  expect(view.onReady).toHaveBeenCalledOnce()
})

it.each(['zoom', 'inset', 'page-range'] as const)(
  'cancels stale metadata on a host %s change',
  async (entry) => {
    const view = mountWaiting()
    const options = {
      zoom: { nativeLayoutZoom: 2 as const },
      inset: { containMarginTop: 80 },
      'page-range': { pageRange: { start: 2, end: 3 } }
    }[entry] satisfies Partial<ComponentProps<typeof EngineDocumentViewer>>
    view.rerender(<EngineDocumentViewer {...view.props} {...options} />)
    await act(async () => {
      view.metadata.resolve()
      await view.ready
    })
    expect(state.api!.scrollToAnchorForRestore).not.toHaveBeenCalled()
    expect(view.onProgress).not.toHaveBeenCalled()
  }
)

it('allows the same restore after StrictMode effect replay', async () => {
  // Effect replay must invalidate abandoned async work without treating a
  // pristine document as if the user had navigated it.
  const view = mountWaiting(true)
  await act(async () => {
    view.metadata.resolve()
    await view.ready
  })
  expect(state.api!.scrollToAnchorForRestore).toHaveBeenCalledExactlyOnceWith(
    { pageNumber: 2, verticalPercentage: 48.8 },
    { preserveOnFailure: false }
  )
})

it('discards a stale metadata failure after reading instead of showing a restore warning', async () => {
  const view = mountWaiting()
  fireEvent.wheel(view.getByTestId('paper'), { deltaY: 250 })
  position = fresh
  await act(async () => {
    view.metadata.reject(new Error('late metadata failure'))
    await view.ready
  })
  expect(view.queryByRole('status')).toBeNull()
  expect(state.api!.scrollToAnchorForRestore).not.toHaveBeenCalled()
  act(() => view.ref.current!.captureAndPublish!())
  expect(view.onProgress).toHaveBeenLastCalledWith(fresh)
})

it('ignores disposed document callbacks without cancelling the replacement restore', async () => {
  const view = mountWaiting()
  const disposed = state.pdf!.onDocumentReady!
  view.rerender(
    <EngineDocumentViewer
      {...view.props}
      engineSource={{ ...source, data: new Uint8Array([2]) }}
      containMarginTop={80}
    />
  )
  act(() => {
    disposed(null)
    state.pdf!.onDocumentReady!({
      numPages: 3,
      getPage: async () => ({
        getViewport: () => ({ width: 600, height: 2000 })
      })
    } as never)
  })
  await act(async () => {
    await state.pdf!.onPagesLoaded!(3)
  })
  expect(state.api!.scrollToAnchorForRestore).toHaveBeenCalledExactlyOnceWith(
    { pageNumber: 2, verticalPercentage: 48.8 },
    { preserveOnFailure: false }
  )
  await act(async () => {
    view.metadata.resolve()
    await view.ready
  })
  expect(state.api!.scrollToAnchorForRestore).toHaveBeenCalledOnce()
  expect(view.onReady).toHaveBeenCalledOnce()
})

it('falls back to the saved page without a host error when restore cannot reach it', async () => {
  const view = mountWaiting()
  const restoration = deferred()
  vi.mocked(state.api!.scrollToAnchorForRestore).mockImplementation(
    () => restoration.promise
  )
  await act(async () => {
    view.metadata.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(state.api!.scrollToAnchorForRestore).toHaveBeenCalledOnce()
  await act(async () => {
    restoration.reject(new Error('目标页面不可用，原位置已保留'))
    await view.ready
  })
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.getByRole('status').textContent).toContain('无法精确恢复')
  expect(state.api!.scrollToPage).toHaveBeenCalledWith(2)
})

it('does not run a failed programmatic restore fallback after a newer reading interaction', async () => {
  const view = mountWaiting()
  const restoration = deferred()
  vi.mocked(state.api!.scrollToAnchorForRestore).mockImplementation(
    () => restoration.promise
  )
  await act(async () => {
    view.metadata.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(state.api!.scrollToAnchorForRestore).toHaveBeenCalledOnce()
  fireEvent.wheel(view.getByTestId('paper'), { deltaY: 250 })
  position = fresh
  await act(async () => {
    restoration.reject(new Error('late restoration failure'))
    await view.ready
  })
  expect(position).toEqual(fresh)
  expect(state.api!.scrollToPage).not.toHaveBeenCalled()
  expect(view.queryByRole('status')).toBeNull()
  expect(view.queryByRole('alert')).toBeNull()
  act(() => view.ref.current!.captureAndPublish!())
  expect(view.onProgress).toHaveBeenLastCalledWith(fresh)
})
