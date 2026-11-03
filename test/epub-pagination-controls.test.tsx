import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EpubEngine,
  EpubEngineOptions
} from '../src/epub/foliateEpubEngine'
import { EngineDocumentViewer } from '../src/components/EngineDocumentViewer'
import type { ReaderEngineSource } from '../src/types/engineSource'
import { makeFakeView } from './epub/fakeView'

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
  it.each(['goToRange', 'selectRange'] as const)(
    'leaves the prepended cover when %s navigates to a body highlight',
    async (entry) => {
      // Keep the real package, compatibility index, engine and viewer together;
      // only Foliate's layout renderer is replaced in jsdom.
      const { createEpubEngine } = await vi.importActual<
        typeof import('../src/epub/foliateEpubEngine')
      >('../src/epub/foliateEpubEngine')
      const bytes = readFileSync(
        join(__dirname, 'compat/fixtures/epub/spine-omits-cover.epub')
      )
      const zip = await JSZip.loadAsync(bytes)
      const xml = await zip.file('OPS/chapter2.xhtml')!.async('string')
      const fake = makeFakeView({
        sectionHrefs: ['OPS/chapter1.xhtml', 'OPS/chapter2.xhtml']
      })
      vi.spyOn(fake.handle.view.book!, 'getCover').mockResolvedValue(
        new Blob(['cover'], { type: 'image/png' })
      )
      vi.stubGlobal(
        'URL',
        class extends URL {
          static readonly createObjectURL = vi.fn(() => 'blob:test-cover')
          static readonly revokeObjectURL = vi.fn()
        }
      )
      const onRelocate = vi.fn()
      factory.mockImplementation((value: EpubEngineOptions) => {
        engine = createEpubEngine(
          {
            ...value,
            onRelocate: (location) => {
              onRelocate(location)
              value.onRelocate?.(location)
            }
          },
          fake.factory
        )
        return engine
      })
      const { container, unmount } = await act(async () =>
        render(
          <EngineDocumentViewer
            engineSource={{ format: 'epub', data: bytes }}
            engineRenderMode='text'
          />
        )
      )
      try {
        await waitFor(() =>
          expect(
            container.querySelector('.hamster-reader__epub-cover')
          ).toBeInTheDocument()
        )
        expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
        expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
        expect(engine.captureTextAnchor()).toBeUndefined()

        const iframe = document.createElement('iframe')
        fake.handle.view.append(iframe)
        const doc = iframe.contentDocument!
        doc.documentElement.innerHTML = new DOMParser().parseFromString(
          xml,
          'text/html'
        ).documentElement.innerHTML
        await act(async () => fake.handle.emit('load', { index: 1, doc }))
        const renderer = fake.handle.renderer
        vi.spyOn(renderer, 'getContents').mockReturnValue([{ index: 1, doc }])
        const range = doc.createRange()
        Object.defineProperty(Object.getPrototypeOf(range), 'getClientRects', {
          configurable: true,
          value: () => []
        })
        range.setStart(doc.querySelector('p')!.firstChild!, 7)
        range.setEnd(doc.querySelector('p')!.firstChild!, 14)
        const serialized = engine.serializeRange(range)!
        expect(serialized.text).toBe('chapter')
        expect(
          engine.showRanges([{ id: 'body', ...serialized }]).located
        ).toEqual(['body'])
        const relocateRange = (target: Range) =>
          fake.handle.emit('relocate', {
            index: 1,
            fraction: 0,
            size: 1,
            range: target
          })
        const goTo = vi.spyOn(renderer, 'goTo').mockImplementation(async () => {
          relocateRange(range)
        })
        let scrolledRange: Range | undefined
        const scroll = vi
          .spyOn(renderer, 'scrollToAnchor')
          .mockImplementation(async (...[target]: unknown[]) => {
            scrolledRange = target as Range
            relocateRange(scrolledRange)
          })

        // Invalid highlight IDs must leave the cover and its boundary intact.
        await act(async () => {
          expect(await engine[entry]('missing')).toBe(
            entry === 'goToRange' ? false : null
          )
        })
        expect(
          container.querySelector('.hamster-reader__epub-cover')
        ).toBeInTheDocument()
        expect(goTo).not.toHaveBeenCalled()
        onRelocate.mockClear()
        await act(async () => {
          const result = await engine[entry]('body')
          if (entry === 'goToRange') expect(result).toBe(true)
          else expect((result as Range).toString()).toBe('chapter')
        })
        expect(goTo).toHaveBeenCalledWith({ index: 1 })
        expect(scroll).toHaveBeenCalledTimes(1)
        expect(scrolledRange?.startContainer.ownerDocument).toBe(doc)
        expect(
          container.querySelector('.hamster-reader__epub-cover')
        ).toBeNull()
        expect(doc.querySelector('p')).toBeVisible()
        expect(onRelocate).toHaveBeenLastCalledWith({
          chapterIndex: 1,
          pageNumber: 3,
          fraction: 0
        })
        expect(engine.captureTextAnchor()).toMatchObject({
          pageNumber: 3,
          offset: serialized.start.offset,
          text: 'chapter'
        })
        expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled()
        expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
        if (entry === 'selectRange')
          expect(doc.getSelection()?.toString()).toBe('chapter')
      } finally {
        unmount()
        vi.unstubAllGlobals()
      }
    }
  )

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
    expect(next).toHaveFocus()
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
