import { createRef } from 'react'
import type { ReaderReadingPositionHandle } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentViewer'
import type {
  IntermediateDocument,
  IntermediateText
} from '@hamster-note/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import { IntermediateDocumentTextViewer } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import type { ReaderSelectionRef } from '../src/types/selection'
import type { LinkedSelectionRange } from './mocks/selection'
import {
  clearSelectionProps,
  getAllSelectionProps,
  simulateLinkedDataChange
} from './mocks/selection'
import { mockElementSize, resizeObserverMock } from './setup'

const outlineDocumentMock = vi.hoisted(() => ({
  open: vi.fn()
}))
vi.mock('../src/pdf/pdfOutlineDocument', () => ({
  openPdfOutlineDocument: outlineDocumentMock.open
}))

function documentFixture(id: string, count = 100) {
  const loaders = Array.from({ length: count }, (_, index) =>
    vi.fn(async () => [
      {
        id: `${id}-${index + 1}`,
        content: `${id} page ${index + 1}`,
        fontSize: 12,
        polygon: [
          [0, 0],
          [100, 0],
          [100, 20],
          [0, 20]
        ],
        fontFamily: 'serif',
        fontWeight: 400,
        color: '#111',
        lineHeight: 18,
        ascent: 12,
        descent: 3,
        dir: 'ltr',
        skew: 0,
        isEOL: false
      } as IntermediateText
    ])
  )
  const document = {
    id,
    title: id,
    pageCount: count,
    pageNumbers: Array.from({ length: count }, (_, index) => index + 1),
    getPageSizeByPageNumber: () => ({ x: 300, y: 400 }),
    getPageByPageNumber: (page: number) =>
      Promise.resolve({ getContent: loaders[page - 1] })
  } as unknown as IntermediateDocument
  return { document, loaders }
}
import { tapNext } from './reading-gesture'

const paper = () =>
  document.querySelector<HTMLElement>(
    '.hamster-reader__intermediate-text-spacer'
  )!
function sizeRoot() {
  const root = screen.getByTestId('intermediate-document-text-viewer')
  mockElementSize(root, { width: 600, height: 400 })
  mockElementSize(paper(), { width: 300, height: 200 })
  resizeObserverMock.trigger(root)
}

describe('PDF Text viewer integration', () => {
  it('bounds extraction around the restored target, evicts, retries, and skips hidden/out-of-range pages', async () => {
    const fixture = documentFixture('large')
    const onProgress = vi.fn()
    const props = {
      document: fixture.document,
      isPdf: true,
      pagePreloadRadius: 3,
      maxLoadedPages: 2,
      textReadingProgress: { currentPageNumber: 50 },
      pageRange: { start: 40, end: 80 },
      hiddenPages: [51],
      onTextReadingProgressChange: onProgress
    }
    const { rerender } = render(<IntermediateDocumentTextViewer {...props} />)
    sizeRoot()
    await waitFor(() =>
      expect(screen.getByText('large page 50')).toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.getByTestId('reading-page-indicator')).toHaveAttribute(
        'data-can-next',
        'true'
      )
    )
    expect(
      fixture.loaders.filter((loader) => loader.mock.calls.length)
    ).toHaveLength(2)
    expect(fixture.loaders[0]).not.toHaveBeenCalled()
    tapNext(paper())
    await waitFor(() =>
      expect(screen.getByText('large page 52')).toBeInTheDocument()
    )
    expect(fixture.loaders[50]).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(onProgress).toHaveBeenLastCalledWith({
        currentPageNumber: 52,
        verticalPercentage: 0
      })
    )
    const page49Calls = fixture.loaders[48].mock.calls.length
    fixture.loaders[69].mockRejectedValueOnce(
      new Error('temporary extraction failure')
    )
    onProgress.mockClear()
    rerender(
      <IntermediateDocumentTextViewer
        {...props}
        textReadingProgress={{ currentPageNumber: 70 }}
      />
    )
    await screen.findByRole('alert')
    expect(onProgress).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() =>
      expect(screen.getByText('large page 70')).toBeInTheDocument()
    )
    expect(fixture.loaders[69]).toHaveBeenCalledTimes(2)
    rerender(
      <IntermediateDocumentTextViewer
        {...props}
        textReadingProgress={{ currentPageNumber: 49 }}
      />
    )
    await waitFor(() =>
      expect(screen.getByText('large page 49')).toBeInTheDocument()
    )
    expect(fixture.loaders[48].mock.calls.length).toBeGreaterThan(page49Calls)
  })

  it('keeps each page of a scanned document as one empty screen with a Layout action', async () => {
    const fixture = documentFixture('scan', 3)
    fixture.loaders.forEach((loader) => loader.mockResolvedValue([]))
    const onRequestLayout = vi.fn()
    const onProgress = vi.fn()
    render(
      <IntermediateDocumentTextViewer
        document={fixture.document}
        isPdf
        onRequestLayout={onRequestLayout}
        onTextReadingProgressChange={onProgress}
      />
    )
    sizeRoot()
    await screen.findByText('第 1 页没有可提取的文字')
    await waitFor(() =>
      expect(screen.getByTestId('reading-page-indicator')).toHaveAttribute(
        'data-can-next',
        'true'
      )
    )
    expect(screen.getByTestId('reading-page-indicator')).toHaveAttribute(
      'data-can-previous',
      'false'
    )
    tapNext(paper())
    await screen.findByText('第 2 页没有可提取的文字')
    fireEvent.click(screen.getByRole('button', { name: '返回 Layout' }))
    expect(onRequestLayout).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(onProgress).toHaveBeenLastCalledWith({
        currentPageNumber: 2,
        verticalPercentage: 0
      })
    )
    tapNext(paper())
    await screen.findByText('第 3 页没有可提取的文字')
    await waitFor(() =>
      expect(screen.getByTestId('reading-page-indicator')).toHaveAttribute(
        'data-can-next',
        'false'
      )
    )
    // The button is disabled both while restoring and at the last page.
    // Wait for the actual position commit rather than that transient UI state.
    await waitFor(() =>
      expect(onProgress).toHaveBeenLastCalledWith({
        currentPageNumber: 3,
        verticalPercentage: 0
      })
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores an old extraction failure after replacing the document', async () => {
    const first = documentFixture('A', 1)
    const second = documentFixture('B', 1)
    let reject!: (error: Error) => void
    first.loaders[0].mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail
        })
    )
    const progress = vi.fn()
    const { rerender } = render(
      <IntermediateDocumentTextViewer
        document={first.document}
        isPdf
        onTextReadingProgressChange={progress}
      />
    )
    sizeRoot()
    await waitFor(() => expect(first.loaders[0]).toHaveBeenCalled())
    rerender(
      <IntermediateDocumentTextViewer
        document={second.document}
        isPdf
        onTextReadingProgressChange={progress}
      />
    )
    await waitFor(() =>
      expect(screen.getByText('B page 1')).toBeInTheDocument()
    )
    await act(async () => reject(new Error('old A failure')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('A page 1')).toBeNull()
    expect(progress).not.toHaveBeenCalled()
  })
})

it('waits for the requested PDF Text page before a close capture can flush progress', async () => {
  const fixture = documentFixture('close-pending', 2)
  const texts = await fixture.loaders[1]()
  let release!: () => void
  fixture.loaders[1].mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve(texts)
      })
  )
  const ref = createRef<ReaderReadingPositionHandle>()
  const onProgress = vi.fn()
  render(
    <IntermediateDocumentTextViewer
      document={fixture.document}
      isPdf
      readingPositionRef={ref}
      onTextReadingProgressChange={onProgress}
    />
  )
  sizeRoot()
  await waitFor(() =>
    expect(screen.getByTestId('reading-page-indicator')).toHaveAttribute(
      'data-can-next',
      'true'
    )
  )
  tapNext(paper())
  let complete = false
  const stable = ref.current!.waitForStable!().then(() => {
    complete = true
  })
  await act(async () => {
    await Promise.resolve()
  })
  expect(complete).toBe(false)
  await act(async () => {
    release()
  })
  await stable
  expect(complete).toBe(true)
  expect(onProgress).toHaveBeenLastCalledWith({
    currentPageNumber: 2,
    verticalPercentage: 0
  })
})

it('defers the PDF selection popover until release and keeps it closed after a handoff clear', async () => {
  clearSelectionProps()
  const originalRects = Object.getOwnPropertyDescriptor(
    Range.prototype,
    'getClientRects'
  )
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(10, 10, 80, 20)]
  })
  const fixture = documentFixture('popover', 1)
  const selectionRef = createRef<ReaderSelectionRef>()
  const onSelectionStart = vi.fn()
  const onSelectionEnd = vi.fn()
  const view = render(
    <IntermediateDocumentTextViewer
      document={fixture.document}
      isPdf
      selectionRef={selectionRef}
      selectionPopover={<div data-testid='pdf-selection-popover'>高亮</div>}
      onSelectionStart={onSelectionStart}
      onSelectionEnd={onSelectionEnd}
    />
  )
  try {
    sizeRoot()
    await screen.findByText('popover page 1')
    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const runtimeSelectionId = getAllSelectionProps()[0]!.selectionId!
    const selection = window.getSelection()!
    let gesture = 0
    const requireProps = () => {
      const props = getAllSelectionProps().find(
        (candidate) => candidate.selectionId === runtimeSelectionId
      )
      if (!props?.linkedData) throw new Error('Expected PDF Selection props')
      return props
    }
    const beginSelection = (selectingText: boolean) => {
      gesture += 1
      const props = requireProps()
      const activeRange: LinkedSelectionRange = {
        id: `draft-${gesture}`,
        text: 'popover',
        createdAt: gesture,
        start: { selectionId: runtimeSelectionId, offset: 0 },
        end: { selectionId: runtimeSelectionId, offset: 7 },
        rectsBySelectionId: {
          [runtimeSelectionId]: [{ x: 10, y: 10, width: 80, height: 20 }]
        }
      }
      act(() => {
        simulateLinkedDataChange(runtimeSelectionId, {
          ...props.linkedData!,
          activeRange,
          selectingText
        })
        props.onSelectionStart?.({ x: 12, y: 16 }, selection)
      })
    }
    const endSelection = () => {
      const props = requireProps()
      act(() => {
        simulateLinkedDataChange(runtimeSelectionId, {
          ...props.linkedData!,
          selectingText: false
        })
        props.onSelectionEnd?.({ x: 12, y: 16 }, selection)
      })
    }

    beginSelection(false)
    expect(screen.queryByTestId('pdf-selection-popover')).toBeNull()
    endSelection()
    expect(screen.getByTestId('pdf-selection-popover')).toBeVisible()

    beginSelection(false)
    expect(screen.queryByTestId('pdf-selection-popover')).toBeNull()
    act(() => selectionRef.current!.clear())
    endSelection()
    expect(screen.queryByTestId('pdf-selection-popover')).toBeNull()

    beginSelection(true)
    expect(screen.queryByTestId('pdf-selection-popover')).toBeNull()
    endSelection()
    expect(screen.getByTestId('pdf-selection-popover')).toBeVisible()
    expect(onSelectionStart).toHaveBeenCalledTimes(3)
    expect(onSelectionEnd).toHaveBeenCalledTimes(3)
  } finally {
    view.unmount()
    clearSelectionProps()
    if (originalRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
    } else Reflect.deleteProperty(Range.prototype, 'getClientRects')
  }
})

async function paneGestureFixture(withLeftPopover: boolean) {
  clearSelectionProps()
  const originalRects = Object.getOwnPropertyDescriptor(
    Range.prototype,
    'getClientRects'
  )
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(10, 10, 80, 20)]
  })
  const left = documentFixture('left', 2)
  const right = documentFixture('right', 2)
  const leftProgress = vi.fn()
  const rightProgress = vi.fn()
  const savedRange: LinkedSelectionRange = {
    id: 'left-saved',
    text: 'left page',
    createdAt: 1,
    start: { selectionId: 'page-1', offset: 0 },
    end: { selectionId: 'page-1', offset: 9 },
    rectsBySelectionId: {}
  }
  const view = render(
    <>
      <IntermediateDocumentTextViewer
        document={left.document}
        isPdf
        overlayRectType='px'
        defaultRanges={withLeftPopover ? [savedRange] : []}
        defaultSelectedRangeId={withLeftPopover ? savedRange.id : null}
        highlightPopover={
          withLeftPopover ? (
            <div data-testid='left-selection-popover'>左栏高亮</div>
          ) : undefined
        }
        onTextReadingProgressChange={leftProgress}
      />
      <IntermediateDocumentTextViewer
        document={right.document}
        isPdf
        onTextReadingProgressChange={rightProgress}
      />
    </>
  )
  const roots = screen.getAllByTestId('intermediate-document-text-viewer')
  const papers = document.querySelectorAll<HTMLElement>(
    '.hamster-reader__intermediate-text-spacer'
  )
  roots.forEach((root) => {
    mockElementSize(root, { width: 600, height: 400 })
    resizeObserverMock.trigger(root)
  })
  papers.forEach((paper) => mockElementSize(paper, { width: 300, height: 200 }))
  await screen.findByText('left page 1')
  await screen.findByText('right page 1')
  await waitFor(() => expect(getAllSelectionProps()).toHaveLength(2))
  await waitFor(() => {
    const indicators = screen.getAllByTestId('reading-page-indicator')
    expect(indicators).toHaveLength(2)
    for (const indicator of indicators)
      expect(indicator).toHaveAttribute('data-can-next', 'true')
    for (const root of roots) expect(root).toHaveAttribute('aria-busy', 'false')
  })
  if (withLeftPopover) await screen.findByTestId('left-selection-popover')
  else expect(screen.queryByTestId('left-selection-popover')).toBeNull()
  leftProgress.mockClear()
  rightProgress.mockClear()
  return {
    leftProgress,
    rightProgress,
    papers,
    cleanup() {
      window.getSelection()?.removeAllRanges()
      view.unmount()
      clearSelectionProps()
      if (originalRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
      } else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    }
  }
}

it('blocks this pane navigation with only its own selection popover open', async () => {
  const fixture = await paneGestureFixture(true)
  try {
    expect(window.getSelection()?.isCollapsed).toBe(true)
    expect(getAllSelectionProps()[0]?.linkedData?.activeRange).toBeFalsy()
    tapNext(fixture.papers[0]!)
    tapNext(fixture.papers[1]!)
    await screen.findByText('right page 2')
    await waitFor(() =>
      expect(fixture.rightProgress).toHaveBeenCalledWith(
        expect.objectContaining({ currentPageNumber: 2 })
      )
    )
    expect(screen.getByText('left page 1')).toBeVisible()
    expect(screen.queryByText('left page 2')).toBeNull()
    expect(fixture.leftProgress).not.toHaveBeenCalled()
  } finally {
    fixture.cleanup()
  }
})

it('allows this pane navigation with only another pane selection popover open', async () => {
  const fixture = await paneGestureFixture(true)
  try {
    expect(window.getSelection()?.isCollapsed).toBe(true)
    expect(getAllSelectionProps()[0]?.linkedData?.activeRange).toBeFalsy()
    tapNext(fixture.papers[1]!)
    await screen.findByText('right page 2')
    await waitFor(() =>
      expect(fixture.rightProgress).toHaveBeenCalledWith(
        expect.objectContaining({ currentPageNumber: 2 })
      )
    )
    expect(screen.getByText('left page 1')).toBeVisible()
    expect(fixture.leftProgress).not.toHaveBeenCalled()
  } finally {
    fixture.cleanup()
  }
})

it('allows this pane navigation with only another pane native selection', async () => {
  const fixture = await paneGestureFixture(false)
  try {
    const leftText = screen.getByText('left page 1').firstChild
    expect(leftText).toBeInstanceOf(Text)
    const nativeSelection = window.getSelection()!
    const nativeRange = document.createRange()
    nativeRange.selectNodeContents(leftText!)
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(nativeRange)
    expect(nativeSelection.isCollapsed).toBe(false)
    expect(screen.queryByTestId('left-selection-popover')).toBeNull()

    tapNext(fixture.papers[1]!)
    await screen.findByText('right page 2')
    await waitFor(() =>
      expect(fixture.rightProgress).toHaveBeenCalledWith(
        expect.objectContaining({ currentPageNumber: 2 })
      )
    )
    expect(screen.getByText('left page 1')).toBeVisible()
    expect(fixture.leftProgress).not.toHaveBeenCalled()
  } finally {
    fixture.cleanup()
  }
})

function makeOutlineProxy({
  numPages,
  getOutline,
  getDestination,
  getPageIndex
}: {
  numPages: number
  getOutline: () => Promise<unknown>
  getDestination?: (name: string) => Promise<unknown>
  getPageIndex?: (ref: { num: number }) => Promise<number>
}) {
  return {
    numPages,
    getOutline: vi.fn(getOutline),
    getDestination: vi.fn(getDestination ?? (async () => null)),
    getPageIndex: vi.fn(
      getPageIndex ?? (async (ref: { num: number }) => ref.num - 1)
    )
  } as unknown as PDFDocumentProxy
}

function pdfOutlineSource(proxy: PDFDocumentProxy) {
  return {
    format: 'pdf' as const,
    data: new Uint8Array(),
    loadPdfDocument: async () => proxy
  }
}

describe('PDF text mode outline', () => {
  it('shows the 目录 tab and jumps to the target text page', async () => {
    const fixture = documentFixture('outline', 6)
    const proxy = makeOutlineProxy({
      numPages: 6,
      getOutline: async () => [{ title: '第二章', dest: [1], items: [] }]
    })
    render(
      <IntermediateDocumentTextViewer
        document={fixture.document}
        isPdf
        pdfSource={pdfOutlineSource(proxy)}
        showPageBrowser
        textReadingProgress={{ currentPageNumber: 1 }}
      />
    )
    sizeRoot()

    const outlineTab = await screen.findByRole('tab', { name: '目录' })
    expect(screen.queryByRole('tab', { name: '页面' })).toBeNull()
    expect(screen.getByRole('tab', { name: '高亮' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    fireEvent.click(outlineTab)
    fireEvent.click(await screen.findByRole('button', { name: '第二章' }))

    await waitFor(() =>
      expect(screen.getByText('outline page 2')).toBeInTheDocument()
    )
  })

  it('shows the layout-mode empty-outline notice', async () => {
    const fixture = documentFixture('empty', 3)
    const proxy = makeOutlineProxy({
      numPages: 3,
      getOutline: async () => null
    })
    render(
      <IntermediateDocumentTextViewer
        document={fixture.document}
        isPdf
        pdfSource={pdfOutlineSource(proxy)}
        showPageBrowser
        textReadingProgress={{ currentPageNumber: 1 }}
      />
    )
    sizeRoot()

    fireEvent.click(await screen.findByRole('tab', { name: '目录' }))

    expect(
      await screen.findByText('此 PDF 没有内嵌章节目录，可使用页面导航。')
    ).toBeInTheDocument()
  })

  it('opens its own PDF document for 目录 when the host passes no loader', async () => {
    outlineDocumentMock.open.mockReset()
    const fixture = documentFixture('fallback', 6)
    const proxy = makeOutlineProxy({
      numPages: 6,
      getOutline: async () => [{ title: '第二章', dest: [1], items: [] }]
    })
    const dispose = vi.fn(async () => {})
    outlineDocumentMock.open.mockResolvedValueOnce({
      document: proxy,
      dispose
    })
    const view = render(
      <IntermediateDocumentTextViewer
        document={fixture.document}
        isPdf
        pdfSource={{ format: 'pdf', data: new Uint8Array() }}
        showPageBrowser
        textReadingProgress={{ currentPageNumber: 1 }}
      />
    )
    sizeRoot()

    fireEvent.click(await screen.findByRole('tab', { name: '目录' }))
    fireEvent.click(await screen.findByRole('button', { name: '第二章' }))

    await waitFor(() =>
      expect(screen.getByText('fallback page 2')).toBeInTheDocument()
    )
    expect(outlineDocumentMock.open).toHaveBeenCalledOnce()
    view.unmount()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
