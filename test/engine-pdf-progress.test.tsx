import { act, fireEvent, render } from '@testing-library/react'
import {
  createRef,
  forwardRef,
  useImperativeHandle,
  type ComponentProps
} from 'react'
import type { ReaderReadingPositionHandle } from '../src/components/IntermediateDocumentViewer'
import { beforeEach, expect, it, vi } from 'vitest'
import { EngineDocumentViewer } from '../src/components/EngineDocumentViewer'
import type {
  PdfDocumentViewerProps,
  PdfDocumentViewerRef
} from '../src/pdf/PdfDocumentViewer'
import type { PageBrowser } from '../src/components/IntermediateDocumentViewer/PageBrowser'
import type { ReaderBookmark } from '../src/types/readerData'

const state = vi.hoisted(() => ({
  pdf: null as PdfDocumentViewerProps | null,
  browser: null as ComponentProps<typeof PageBrowser> | null,
  api: null as PdfDocumentViewerRef | null
}))
vi.mock('../src/pdf/PdfDocumentViewer', () => ({
  PdfDocumentViewer: forwardRef<PdfDocumentViewerRef, PdfDocumentViewerProps>(
    (props, ref) => {
      state.pdf = props
      useImperativeHandle(ref, () => state.api!)
      return null
    }
  )
}))
vi.mock('../src/components/IntermediateDocumentViewer/PageBrowser', () => ({
  PageBrowser: (props: ComponentProps<typeof PageBrowser>) => {
    state.browser = props
    return null
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
let textReady: boolean
let position: ReaderBookmark
let pending: ReturnType<typeof deferred>[]
beforeEach(() => {
  textReady = false
  position = { pageNumber: 1, verticalPercentage: 0 }
  pending = []
  state.api = {
    captureTextAnchor: () => null,
    captureReadingPosition: () =>
      textReady ? { status: 'ready', position } : { status: 'pending' },
    scrollToAnchor: vi.fn((target) => {
      position = target
      const navigation = deferred()
      pending.push(navigation)
      return navigation.promise
    }),
    scrollToPage: vi.fn((pageNumber) => {
      position = { pageNumber, verticalPercentage: 20 }
      pending[0]?.resolve()
    }),
    releasePreviewPage: vi.fn(),
    isRendering: () => false,
    setScale: vi.fn(),
    scrollToRange: vi.fn(),
    getCanonicalPageText: () => undefined,
    confirmSelection: vi.fn(),
    clearSelection: vi.fn(),
    selectRange: () => null,
    getSelectionRange: () => null,
    setSelectionRange: () => {},
    hitTestSelection: () => null,
    serializeRangeEndpoint: () => null,
    serializeSelection: () => null
  }
})
const source = { format: 'pdf' as const, data: new Uint8Array([1]) }
const saved = { pageNumber: 1, offset: 20, textId: 'x', text: 'text' }

it.each(['complete', 'page', 'bookmark', 'failed'] as const)(
  'keeps progress publishable after initial restoration is %s',
  async (replacement) => {
    const onProgress = vi.fn()
    const view = render(
      <EngineDocumentViewer
        engineSource={source}
        layoutReadingProgress={saved}
        onLayoutReadingProgressChange={onProgress}
      />
    )
    let ready!: Promise<void>
    act(() => {
      ready = Promise.resolve(state.pdf!.onPagesLoaded!(3))
    })
    expect(pending).toHaveLength(1)
    await act(async () => {
      if (replacement === 'page') state.browser!.onNavigateToPage(2)
      else if (replacement === 'bookmark') {
        state.browser!.onNavigateToBookmark!({
          pageNumber: 2,
          verticalPercentage: 20
        })
        textReady = true
        pending[1]!.resolve()
        pending[0]!.resolve()
      } else if (replacement === 'failed')
        pending[0]!.reject(new Error('restore failed'))
      else pending[0]!.resolve()
      await ready
    })
    if (replacement !== 'bookmark') expect(onProgress).not.toHaveBeenCalled()

    fireEvent.wheel(view.container.querySelector('[data-engine="pdf"]')!)

    // The Page Browser replaces an unresolved text target before text geometry
    // exists. Once geometry arrives, scrolls AND later page seeks must persist.
    act(() => {
      textReady = true
      if (replacement === 'failed') state.browser!.onNavigateToPage(2)
      state.pdf!.onTextLayerReady!([position.pageNumber])
    })
    expect(onProgress).toHaveBeenLastCalledWith(position)
    act(() => {
      position = { pageNumber: position.pageNumber, verticalPercentage: 40 }
      state.pdf!.onTextAnchorChange!(null)
    })
    expect(onProgress).toHaveBeenLastCalledWith(position)
    act(() => {
      state.browser!.onNavigateToPage(3)
      state.pdf!.onPageChange!(3)
    })
    expect(onProgress).toHaveBeenLastCalledWith({
      pageNumber: 3,
      verticalPercentage: 20
    })
  }
)

it.each(['page', 'bookmark'] as const)(
  'captures the final ready position on close after a %s replaces initial restoration',
  async (replacement) => {
    const onProgress = vi.fn()
    const ref = createRef<ReaderReadingPositionHandle>()
    render(
      <EngineDocumentViewer
        engineSource={source}
        layoutReadingProgress={saved}
        readingPositionRef={ref}
        onLayoutReadingProgressChange={onProgress}
      />
    )
    let ready!: Promise<void>
    act(() => {
      ready = Promise.resolve(state.pdf!.onPagesLoaded!(3))
    })
    await act(async () => {
      if (replacement === 'page') state.browser!.onNavigateToPage(2)
      else {
        state.browser!.onNavigateToBookmark!({
          pageNumber: 2,
          verticalPercentage: 20
        })
        pending[1]!.resolve()
        pending[0]!.resolve()
      }
      await ready
    })
    textReady = true
    position = { pageNumber: 2, verticalPercentage: 42.83582089552239 }
    act(() => ref.current!.captureAndPublish!()) // No scroll callback or debounce before close.
    expect(onProgress).toHaveBeenLastCalledWith(position)
    expect(ref.current!.captureReadingPosition!()).toEqual(position)
  }
)

it('deduplicates a controlled echo but navigates an external replacement and captures the next position on close', async () => {
  const onProgress = vi.fn()
  const ref = createRef<ReaderReadingPositionHandle>()
  const props = {
    engineSource: source,
    readingPositionRef: ref,
    onLayoutReadingProgressChange: onProgress
  }
  const view = render(
    <EngineDocumentViewer {...props} layoutReadingProgress={saved} />
  )
  let ready!: Promise<void>
  act(() => {
    ready = Promise.resolve(state.pdf!.onPagesLoaded!(3))
  })
  await act(async () => {
    textReady = true
    pending[0]!.resolve()
    await ready
  })
  expect(onProgress).not.toHaveBeenCalled() // Initial restoration does not migrate storage.
  const first = { pageNumber: 1, verticalPercentage: 40 }
  fireEvent.wheel(view.container.querySelector('[data-engine="pdf"]')!)
  position = first
  act(() => state.pdf!.onReadingPositionChange!({ status: 'ready', position }))
  view.rerender(
    <EngineDocumentViewer {...props} layoutReadingProgress={{ ...first }} />
  )
  expect(pending).toHaveLength(1)
  view.rerender(
    <EngineDocumentViewer
      {...props}
      layoutReadingProgress={{ pageNumber: 1, verticalPercentage: 70 }}
    />
  )
  expect(pending).toHaveLength(2)
  await act(async () => pending[1]!.resolve())
  expect(onProgress).toHaveBeenLastCalledWith({
    pageNumber: 1,
    verticalPercentage: 70
  })
  position = first
  act(() => ref.current!.captureAndPublish!())
  expect(onProgress).toHaveBeenLastCalledWith(first)
})

it('does not publish restored or fallback geometry before a real interaction, including close', async () => {
  const onProgress = vi.fn()
  const ref = createRef<ReaderReadingPositionHandle>()
  const view = render(
    <EngineDocumentViewer
      engineSource={source}
      layoutReadingProgress={saved}
      readingPositionRef={ref}
      onLayoutReadingProgressChange={onProgress}
    />
  )
  let ready!: Promise<void>
  act(() => {
    ready = Promise.resolve(state.pdf!.onPagesLoaded!(3))
  })
  await act(async () => {
    textReady = true
    pending[0]!.resolve()
    await ready
  })
  act(() => {
    state.pdf!.onTextLayerReady!([1])
    state.pdf!.onReadingPositionChange!({ status: 'ready', position })
    ref.current!.captureAndPublish!()
  })
  expect(onProgress).not.toHaveBeenCalled()
  fireEvent.wheel(view.container.querySelector('[data-engine="pdf"]')!)
  act(() => ref.current!.captureAndPublish!())
  expect(onProgress).toHaveBeenLastCalledWith(position)
})

it('does not replay a previously acknowledged progress object during crop reflow', async () => {
  const onProgress = vi.fn()
  const props = {
    engineSource: source,
    onLayoutReadingProgressChange: onProgress
  }
  const view = render(
    <EngineDocumentViewer {...props} layoutReadingProgress={saved} />
  )
  let ready!: Promise<void>
  act(() => {
    ready = Promise.resolve(state.pdf!.onPagesLoaded!(3))
  })
  await act(async () => {
    textReady = true
    pending[0]!.resolve()
    await ready
  })
  fireEvent.wheel(view.container.querySelector('[data-engine="pdf"]')!)
  vi.mocked(state.api!.scrollToAnchor).mockClear()
  const first: ReaderBookmark = {
    pageNumber: 2,
    textId: 'line-15',
    offset: 435,
    text: 'line 15'
  }
  const second: ReaderBookmark = { ...first, offset: 436 }
  for (const bookmark of [first, second]) {
    act(() => {
      position = bookmark
      state.pdf!.onReadingPositionChange!({ status: 'ready', position })
    })
    expect(onProgress).toHaveBeenLastCalledWith(bookmark)
    view.rerender(
      <EngineDocumentViewer {...props} layoutReadingProgress={bookmark} />
    )
  }
  // A debounced save can return an older emitted object while geometry is
  // rebuilding. No readable position is available until the anchor settles.
  textReady = false
  view.rerender(
    <EngineDocumentViewer {...props} layoutReadingProgress={first} />
  )
  expect(state.api!.scrollToAnchor).not.toHaveBeenCalled()

  // A fresh external bookmark request, including the same coordinates, works.
  view.rerender(
    <EngineDocumentViewer {...props} layoutReadingProgress={{ ...first }} />
  )
  expect(state.api!.scrollToAnchor).toHaveBeenCalledWith(first, {
    preserveOnFailure: true
  })
})
