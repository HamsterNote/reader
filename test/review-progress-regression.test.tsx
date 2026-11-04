import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useReadingProgressSaves } from '../src/components/Reader/useLayoutReadingProgressSave'
import type { ReaderData, ReaderTextAnchor } from '../src/types/readerData'

it('saves a previously committed location after a mode handoff replaces the supplied progress', () => {
  const saved = vi.fn()
  const position = (verticalPercentage: number): ReaderData => ({
    layoutReadingProgress: { pageNumber: 1, verticalPercentage }
  })
  const { result, rerender } = renderHook(
    ({ data }) => useReadingProgressSaves('same-book', data, saved),
    { initialProps: { data: position(0) } }
  )
  act(() => {
    result.current.layout({ pageNumber: 1, verticalPercentage: 40 })
    result.current.flush()
  })
  rerender({ data: position(40) })
  // Returning from Text mode supplies its current position directly via onDataChange.
  rerender({ data: position(70) })
  saved.mockClear()
  act(() => {
    result.current.layout({ pageNumber: 1, verticalPercentage: 40 })
    result.current.flush()
  })
  expect(saved).toHaveBeenCalledWith(position(40))
})

it.each(['layout', 'text'] as const)(
  'resaves the %s source anchor after external replacement, while deduplicating echoes and unrelated edits',
  (mode) => {
    const saved = vi.fn()
    const anchor = (offset: number): ReaderTextAnchor => ({
      pageNumber: 1,
      textId: 'page-1',
      text: 'Source text',
      offset
    })
    const position = (offset: number): ReaderData =>
      mode === 'layout'
        ? { layoutReadingProgress: anchor(offset) }
        : {
            textReadingProgress: {
              currentPageNumber: 1,
              anchor: anchor(offset)
            }
          }
    const { result, rerender } = renderHook(
      ({ data }) => useReadingProgressSaves('same-book', data, saved),
      { initialProps: { data: position(0) } }
    )
    const collect = () => {
      if (mode === 'layout') result.current.layout(anchor(40))
      else result.current.text({ currentPageNumber: 1, anchor: anchor(40) })
      result.current.flush()
    }
    act(collect)
    act(collect) // React has not echoed our save yet.
    expect(saved).toHaveBeenCalledTimes(1)
    const echo = position(40)
    rerender({ data: echo })
    act(collect)
    rerender({ data: { ...echo, hiddenPages: [3] } })
    act(collect)
    expect(saved).toHaveBeenCalledTimes(1)
    rerender({ data: position(70) })
    saved.mockClear()
    act(collect)
    expect(saved).toHaveBeenCalledExactlyOnceWith(position(40))
  }
)
