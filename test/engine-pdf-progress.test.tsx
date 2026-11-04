import { act, render } from '@testing-library/react'
import { forwardRef, useImperativeHandle, type ComponentProps } from 'react'
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
    captureReadingPosition: () => (textReady ? position : null),
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
    serializeSelection: () => null
  }
})
const source = { format: 'pdf' as const, data: new Uint8Array([1]) }
const saved = { pageNumber: 1, offset: 20, textId: 'x', text: 'text' }

it.each(['complete', 'page', 'bookmark', 'failed'] as const)(
  'keeps progress publishable after initial restoration is %s',
  async (replacement) => {
    const onProgress = vi.fn()
    render(
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
      state.pdf!.onPageChange!(2)
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
  expect(state.api!.scrollToAnchor).toHaveBeenCalledWith(first)
})
