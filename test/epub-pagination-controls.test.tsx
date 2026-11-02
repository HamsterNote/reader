import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EpubEngine,
  EpubEngineOptions
} from '../src/epub/foliateEpubEngine'
import { EngineDocumentViewer } from '../src/components/EngineDocumentViewer'
import type { ReaderEngineSource } from '../src/types/engineSource'

const factory = vi.hoisted(() => vi.fn())
vi.mock('../src/epub/foliateEpubEngine', () => ({ createEpubEngine: factory }))
vi.mock('../src/pdf/PdfDocumentViewer', () => ({
  PdfDocumentViewer: () => <div>PDF</div>
}))

let options: EpubEngineOptions
let engine: EpubEngine
let offset = 0
const source: ReaderEngineSource = { format: 'epub', data: new Uint8Array([1]) }
function relocate(next: number) {
  offset = next
  options.onRelocate?.({
    pageNumber: 2,
    chapterIndex: 1,
    fraction: next / 1000
  })
}
beforeEach(() => {
  offset = 0
  engine = {
    ready: Promise.resolve({
      title: 'Book',
      pageCount: 2,
      toc: [],
      coverPrepended: false,
      cover: null
    }),
    setHiddenPages: vi.fn(async () => {}),
    setFontScale: vi.fn(),
    showRanges: vi.fn(() => ({ located: [], unlocatable: [] })),
    setActiveRange: vi.fn(),
    captureTextAnchor: () => ({
      pageNumber: 2,
      textId: 'page-2-text',
      text: '正文',
      offset
    }),
    goToAnchor: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    nextPage: vi.fn(async () => {
      relocate(offset + 100)
      return true
    }),
    previousPage: vi.fn(async () => {
      relocate(offset - 100)
      return true
    })
  } as unknown as EpubEngine
  factory.mockImplementation((value: EpubEngineOptions) => {
    options = value
    return engine
  })
})
const enable = () =>
  act(() =>
    options.onNavigationState?.({
      canPrevious: false,
      canNext: true,
      busy: false
    })
  )

describe('EPUB pagination controls and progress', () => {
  it.each(['layout', 'text'] as const)(
    'publishes same-chapter offsets using existing %s progress',
    async (mode) => {
      const layout = vi.fn(),
        text = vi.fn()
      render(
        <EngineDocumentViewer
          engineSource={source}
          engineRenderMode={mode}
          onLayoutReadingProgressChange={layout}
          onTextReadingProgressChange={text}
        />
      )
      const next = screen.getByRole('button', { name: '下一页' })
      expect(next).toBeDisabled()
      await act(async () => {
        await engine.ready
      })
      enable()
      expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
      await userEvent.click(next)
      await userEvent.click(next)
      const callback = mode === 'layout' ? layout : text
      expect(callback).toHaveBeenCalledTimes(2)
      const expected = {
        pageNumber: 2,
        textId: 'page-2-text',
        text: '正文',
        offset: 200
      }
      expect(callback).toHaveBeenLastCalledWith(
        mode === 'layout'
          ? expected
          : { currentPageNumber: 2, anchor: expected }
      )
      act(() =>
        options.onNavigationState?.({
          canPrevious: true,
          canNext: false,
          busy: false
        })
      )
      expect(next).toBeDisabled()
      expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled()
    }
  )

  it('supports Enter/Space and blocks clicks while busy', async () => {
    render(<EngineDocumentViewer engineSource={source} />)
    await act(async () => {
      await engine.ready
    })
    enable()
    const next = screen.getByRole('button', { name: '下一页' })
    next.focus()
    await userEvent.keyboard('{Enter} ')
    expect(engine.nextPage).toHaveBeenCalledTimes(2)
    act(() =>
      options.onNavigationState?.({
        canPrevious: true,
        canNext: true,
        busy: true
      })
    )
    fireEvent.click(next)
    expect(engine.nextPage).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  it('does not publish initialization or stale callbacks after a file switch', async () => {
    const layout = vi.fn()
    const { rerender } = render(
      <EngineDocumentViewer
        engineSource={source}
        onLayoutReadingProgressChange={layout}
      />
    )
    await act(async () => {
      await engine.ready
    })
    act(() => relocate(0))
    expect(layout).not.toHaveBeenCalled()
    const old = options
    rerender(
      <EngineDocumentViewer
        engineSource={{ ...source, data: new Uint8Array([2]) }}
        onLayoutReadingProgressChange={layout}
      />
    )
    await waitFor(() => expect(engine.destroy).toHaveBeenCalled())
    act(() =>
      old.onRelocate?.({ pageNumber: 2, chapterIndex: 1, fraction: 0.2 })
    )
    expect(layout).not.toHaveBeenCalled()
  })

  it('renders no EPUB controls for PDF', () => {
    render(
      <EngineDocumentViewer
        engineSource={{ format: 'pdf', data: new Uint8Array([1]) }}
      />
    )
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull()
    expect(screen.getByText('PDF')).toBeInTheDocument()
  })
})
