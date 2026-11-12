import { act, render, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  measurePdfTextColumns,
  pdfTextAnchorColumn,
  pdfTextTurnTarget
} from '../src/pdf/pdfTextPagination'
import { usePdfTextPagination } from '../src/pdf/usePdfTextPagination'

let root: HTMLDivElement
let charsPerColumn: number
const rect = (column: number, transform = 0) =>
  new DOMRect(column * 324 + transform, 0, 290, 20)
beforeEach(() => {
  charsPerColumn = 100
  root = document.createElement('div')
  root.innerHTML = `<div class="hsn-selection-content"><span data-selection-start-offset="0" data-text-id="same">${'abc'.repeat(100)}</span></div>`
  document.body.append(root)
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 300, 200)
  )
  const content = root.firstElementChild as HTMLElement
  vi.spyOn(content, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 300, 200)
  )
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: function (this: Range) {
      if (this.startContainer.nodeType === Node.ELEMENT_NODE) {
        return Array.from({ length: Math.ceil(300 / charsPerColumn) }, (_, i) =>
          rect(i)
        )
      }
      return [rect(Math.floor(this.startOffset / charsPerColumn))]
    }
  })
})
afterEach(() => {
  root.remove()
  vi.restoreAllMocks()
})
const anchor = (offset: number) => ({
  pageNumber: 1,
  textId: 'same',
  text: 'abc',
  offset
})

describe('PDF Text actual fragments and navigation', () => {
  it('announces engine ready before the ready render can expose enabled controls', async () => {
    const onReady = vi.fn()
    const observedAtLayout: boolean[] = []
    const options = {
      enabled: true,
      generation: 0,
      root,
      pages: [1],
      progress: { currentPageNumber: 1 },
      loaded: new Map([[1, []]]),
      errors: new Set<number>(),
      width: 300,
      height: 200,
      layoutKey: 1,
      enqueue: vi.fn(),
      onCommit: vi.fn(),
      onTurn: vi.fn()
    }
    function Harness() {
      const pagination = usePdfTextPagination({ ...options, onReady })
      useLayoutEffect(() => {
        if (pagination.ready)
          observedAtLayout.push(onReady.mock.calls.length > 0)
      }, [pagination.ready])
      return null
    }
    render(<Harness />)
    await waitFor(() => expect(observedAtLayout.length).toBeGreaterThan(0))
    // Passive ready notification would make this false: the ready render would
    // be visible to the host before onEngineReady ran.
    expect(observedAtLayout[0]).toBe(true)
  })

  it('maps a proportion to a column, then hands off its actual first source character', async () => {
    const onCommit = vi.fn()
    const options = {
      enabled: true,
      generation: 0,
      root,
      pages: [1],
      progress: { currentPageNumber: 1, verticalPercentage: 60 },
      loaded: new Map([[1, []]]),
      errors: new Set<number>(),
      width: 300,
      height: 200,
      layoutKey: 1,
      enqueue: vi.fn(),
      onCommit,
      onTurn: vi.fn()
    }
    const { result } = renderHook(() => usePdfTextPagination(options))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.column).toBe(1)
    expect(result.current.capturePosition()).toMatchObject({
      pageNumber: 1,
      offset: 100
    })
    expect(onCommit.mock.lastCall?.[0].verticalPercentage).toBeUndefined()
  })

  it('retains a scanned page proportion, and resets it when turning to another empty source page', async () => {
    root.innerHTML = '<div role="status">No text</div>'
    const onCommit = vi.fn()
    const options = {
      enabled: true,
      generation: 0,
      root,
      pages: [2, 3],
      progress: { currentPageNumber: 2, verticalPercentage: 60 },
      loaded: new Map([
        [2, []],
        [3, []]
      ]),
      errors: new Set<number>(),
      width: 300,
      height: 200,
      layoutKey: 1,
      enqueue: vi.fn(),
      onCommit,
      onTurn: vi.fn()
    }
    const { result } = renderHook(() => usePdfTextPagination(options))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.capturePosition()).toEqual({
      pageNumber: 2,
      verticalPercentage: 60
    })
    expect(onCommit.mock.lastCall?.[0]).toEqual({
      currentPageNumber: 2,
      verticalPercentage: 60
    })
    act(() => result.current.turn(true))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.capturePosition()).toEqual({
      pageNumber: 3,
      verticalPercentage: 0
    })
  })

  it.each([false, true])(
    'completes initial layout and sequential navigation in StrictMode (deferred content: %s)',
    async (deferred) => {
      const onCommit = vi.fn()
      const options = {
        enabled: true,
        generation: 0,
        root: deferred ? null : root,
        pages: [1],
        loaded: deferred ? new Map<number, unknown>() : new Map([[1, []]]),
        errors: new Set<number>(),
        width: 300,
        height: 200,
        layoutKey: 1,
        enqueue: vi.fn(),
        onCommit,
        onTurn: vi.fn()
      }
      const { result, rerender } = renderHook(
        (props) => usePdfTextPagination(props),
        { initialProps: options, wrapper: StrictMode }
      )
      if (deferred) {
        rerender({ ...options, root, loaded: new Map([[1, []]]) })
      }
      const content = root.firstElementChild as HTMLElement
      const settled = async (column: number, offset: number) => {
        await waitFor(() => {
          expect(result.current.ready).toBe(true)
          expect(result.current.navigation.busy).toBe(false)
          expect(result.current.column).toBe(column)
          expect(result.current.capture()?.offset).toBe(offset)
          expect(content.style.transform).toBe(`translateX(${-column * 324}px)`)
        })
      }
      await settled(0, 0)
      expect(result.current.navigation.canNext).toBe(true)
      expect(result.current.navigation.canPrevious).toBe(false)
      act(() => {
        result.current.turn(true)
        result.current.turn(true)
      })
      await settled(1, 100)
      act(() => result.current.turn(true))
      await settled(2, 200)
      expect(result.current.navigation.canNext).toBe(false)
      act(() => result.current.turn(false))
      await settled(1, 100)
      act(() => result.current.navigate(1, anchor(250)))
      await settled(2, 250)
      expect(onCommit.mock.lastCall).toEqual([
        { currentPageNumber: 1, anchor: anchor(250) },
        true
      ])
    }
  )

  it('finds three nonempty columns within one source span and restores an interior character', () => {
    const content = root.firstElementChild as HTMLElement
    const columns = measurePdfTextColumns(content, 1, 300)
    expect(columns.map((column) => column.anchor?.offset)).toEqual([
      0, 100, 200
    ])
    expect(pdfTextAnchorColumn(content, anchor(150), 300)).toBe(1)
    expect(pdfTextTurnTarget([1, 3], 1, 2, columns, true)).toEqual({
      pageNumber: 3,
      last: false
    })
    expect(pdfTextTurnTarget([1, 3], 3, 0, [{ index: 0 }], false)).toEqual({
      pageNumber: 1,
      last: true
    })
    expect(pdfTextTurnTarget([1, 3], 1, 0, columns, false)).toBeNull()
    expect(pdfTextTurnTarget([1, 3], 3, 0, [{ index: 0 }], true)).toBeNull()
  })

  it('restores source anchors after inserted whitespace and reordered spans', () => {
    const content = root.firstElementChild as HTMLElement
    content.innerHTML =
      '<span data-selection-start-offset="200" data-text-id="last">tail</span> <span data-selection-start-offset="0" data-text-id="same">' +
      'a'.repeat(200) +
      '</span>'
    // The source anchor is in the second column of "same", independently of
    // the text that precedes that span in the reflowed DOM.
    expect(pdfTextAnchorColumn(content, anchor(100), 300)).toBe(1)
    expect(
      pdfTextAnchorColumn(content, { ...anchor(201), textId: 'last' }, 300)
    ).toBe(0)
  })

  it('serializes rapid turns, commits source anchors, and preserves them across reflow', async () => {
    const onCommit = vi.fn()
    const options = {
      enabled: true,
      generation: 0,
      root,
      pages: [1, 3],
      loaded: new Map([
        [1, []],
        [3, []]
      ]),
      errors: new Set<number>(),
      width: 300,
      height: 200,
      layoutKey: 1,
      enqueue: vi.fn(),
      onCommit,
      onTurn: vi.fn()
    }
    const { result, rerender } = renderHook(
      (props) => usePdfTextPagination(props),
      { initialProps: options }
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => {
      result.current.turn(true)
      result.current.turn(true)
    })
    await waitFor(() => {
      expect(result.current.capture()?.offset).toBe(100)
      expect(result.current.navigation.busy).toBe(false)
      expect(result.current.ready).toBe(true)
    })
    act(() => result.current.turn(true))
    await waitFor(() => {
      expect(result.current.capture()?.offset).toBe(200)
      expect(result.current.navigation.busy).toBe(false)
      expect(result.current.ready).toBe(true)
    })
    charsPerColumn = 60
    rerender({ ...options, layoutKey: 2 })
    await waitFor(() => expect(result.current.column).toBe(3))
    expect(result.current.capture()?.offset).toBe(200)
    act(() => result.current.turn(true))
    await waitFor(() => {
      expect(result.current.capture()?.offset).toBe(240)
      expect(result.current.navigation.busy).toBe(false)
      expect(result.current.ready).toBe(true)
    })
    expect(onCommit.mock.lastCall?.[0]).toEqual({
      currentPageNumber: 1,
      anchor: expect.objectContaining({ offset: 240 })
    })
    expect(JSON.stringify(onCommit.mock.calls)).not.toContain('column')
  })

  it('freezes the confirmed character through a late font load', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'fonts')
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() })
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts
    })
    const options = {
      enabled: true,
      generation: 0,
      root,
      pages: [1],
      loaded: new Map([[1, []]]),
      errors: new Set<number>(),
      width: 300,
      height: 200,
      layoutKey: 1,
      enqueue: vi.fn(),
      onCommit: vi.fn(),
      onTurn: vi.fn()
    }
    const { result, unmount } = renderHook(() => usePdfTextPagination(options))
    try {
      await waitFor(() => expect(result.current.ready).toBe(true))
      act(() => result.current.turn(true))
      await waitFor(() => {
        expect(result.current.capture()?.offset).toBe(100)
        expect(result.current.navigation.busy).toBe(false)
        expect(result.current.ready).toBe(true)
      })
      act(() => result.current.turn(true))
      await waitFor(() => {
        expect(result.current.capture()?.offset).toBe(200)
        expect(result.current.navigation.busy).toBe(false)
        expect(result.current.ready).toBe(true)
      })
      charsPerColumn = 60
      act(() => fonts.dispatchEvent(new Event('loadingdone')))
      await waitFor(() => expect(result.current.column).toBe(3))
      expect(result.current.capture()?.offset).toBe(200)
      act(() => result.current.turn(true))
      await waitFor(() => {
        expect(result.current.capture()?.offset).toBe(240)
        expect(result.current.navigation.busy).toBe(false)
        expect(result.current.ready).toBe(true)
      })
    } finally {
      unmount()
      if (original) Object.defineProperty(document, 'fonts', original)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('does not publish failed loads and recovers the pending target after retry', async () => {
    const onCommit = vi.fn()
    const loaded = new Map<number, unknown>([[1, []]])
    const options = {
      enabled: true,
      generation: 0,
      root,
      pages: [1, 3],
      loaded,
      errors: new Set<number>(),
      width: 300,
      height: 200,
      layoutKey: 1,
      enqueue: vi.fn(),
      onCommit,
      onTurn: vi.fn()
    }
    const { result, rerender } = renderHook(
      (props) => usePdfTextPagination(props),
      { initialProps: options }
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.navigate(3))
    rerender({ ...options, errors: new Set([3]) })
    await waitFor(() => expect(options.enqueue).toHaveBeenCalledWith(3))
    expect(onCommit.mock.calls.filter((call) => call[1])).toHaveLength(0)
    expect(result.current.capture()?.pageNumber).toBe(1)
    rerender({
      ...options,
      loaded: new Map([
        [1, []],
        [3, []]
      ])
    })
    await waitFor(() => expect(result.current.capture()?.pageNumber).toBe(3))
    expect(onCommit.mock.lastCall?.[1]).toBe(true)
  })

  it('ignores pending frames after replacement, disabling Text, and unmount', async () => {
    const onCommit = vi.fn()
    const options = {
      enabled: true,
      generation: 0,
      root,
      pages: [1],
      loaded: new Map<number, unknown>(),
      errors: new Set<number>(),
      width: 300,
      height: 200,
      layoutKey: 1,
      enqueue: vi.fn(),
      onCommit,
      onTurn: vi.fn()
    }
    const { rerender, unmount } = renderHook(
      (props) => usePdfTextPagination(props),
      { initialProps: options }
    )
    rerender({ ...options, generation: 1, loaded: new Map([[1, []]]) })
    rerender({
      ...options,
      generation: 2,
      enabled: false,
      loaded: new Map([[1, []]])
    })
    unmount()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('supports an empty source page and an entirely filtered range without fake progress', async () => {
    root.innerHTML = '<div role="status">No text</div>'
    const onCommit = vi.fn()
    const options = {
      enabled: true,
      generation: 0,
      root,
      pages: [2],
      loaded: new Map([[2, []]]),
      errors: new Set<number>(),
      width: 300,
      height: 200,
      layoutKey: 1,
      enqueue: vi.fn(),
      onCommit,
      onTurn: vi.fn()
    }
    const { result, rerender } = renderHook(
      (props) => usePdfTextPagination(props),
      { initialProps: options }
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(onCommit.mock.lastCall?.[0]).toEqual({
      currentPageNumber: 2,
      verticalPercentage: 0
    })
    expect(result.current.navigation).toEqual({
      busy: false,
      canPrevious: false,
      canNext: false
    })
    onCommit.mockClear()
    rerender({ ...options, generation: 1, pages: [] })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.pageNumber).toBe(0)
  })
})

function readinessOptions() {
  return {
    enabled: true,
    generation: 0,
    root,
    pages: [1],
    progress: { currentPageNumber: 1, anchor: anchor(120) },
    loaded: new Map([[1, []]]),
    errors: new Set<number>(),
    width: 300,
    height: 200,
    layoutKey: 1,
    enqueue: vi.fn(),
    onCommit: vi.fn(),
    onTurn: vi.fn(),
    onReady: vi.fn(),
    onError: vi.fn()
  }
}

describe('PDF text restoration lifecycle notifications', () => {
  it('does not announce ready on mount, before font layout, or before restoring the source column', async () => {
    let finishFonts!: () => void
    const original = Object.getOwnPropertyDescriptor(document, 'fonts')
    const fonts = Object.assign(new EventTarget(), {
      ready: new Promise<void>((resolve) => {
        finishFonts = resolve
      })
    })
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts
    })
    const options = readinessOptions()
    const { result, unmount } = renderHook(() => usePdfTextPagination(options))
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      expect(result.current.ready).toBe(false)
      expect(options.onReady).not.toHaveBeenCalled()
      expect(options.onCommit).not.toHaveBeenCalled()
      await act(async () => {
        finishFonts()
      })
      await waitFor(() => expect(options.onReady).toHaveBeenCalledTimes(1))
      expect(result.current.column).toBe(1)
      expect((root.firstElementChild as HTMLElement).style.transform).toBe(
        'translateX(-324px)'
      )
      expect(options.onCommit.mock.invocationCallOrder[0]).toBeLessThan(
        options.onReady.mock.invocationCallOrder[0]
      )
      act(() => fonts.dispatchEvent(new Event('loadingdone')))
      await waitFor(() => expect(result.current.navigation.busy).toBe(false))
      expect(options.onReady).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
      if (original) Object.defineProperty(document, 'fonts', original)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('reports target-page load failure without a ready receipt', async () => {
    const options = readinessOptions()
    options.loaded.clear()
    options.errors.add(1)
    const { result } = renderHook(() => usePdfTextPagination(options))
    await waitFor(() => expect(options.onError).toHaveBeenCalledTimes(1))
    expect(options.onReady).not.toHaveBeenCalled()
    await expect(result.current.whenStable()).rejects.toThrow('阅读页加载失败')
  })

  it('reports layout failure to the same lifecycle and stability barrier', async () => {
    const options = readinessOptions()
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => {
      throw new Error('Injected layout failure')
    })
    const { result } = renderHook(() => usePdfTextPagination(options))
    await waitFor(() =>
      expect(options.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Injected layout failure' })
      )
    )
    expect(options.onReady).not.toHaveBeenCalled()
    await expect(result.current.whenStable()).rejects.toThrow(
      'Injected layout failure'
    )
  })
})
