import { act, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReaderProps } from '../src/components/Reader'
import type { ReaderAnnotationHistoryValue } from '../src/types/selection'
import type { IntermediateDocument } from '@hamster-note/types'
import { ReaderSurface } from '../webview/src/ReaderSurface'
import { restoreReaderSnapshot } from '../src/host/readerSnapshot'
import { drawingFixture } from './fixtures/painting'

const capture = vi.hoisted(() => ({ props: null as ReaderProps | null }))
vi.mock('../src/components/Reader', () => ({
  Reader: (props: ReaderProps) => {
    capture.props = props
    return null
  }
}))

it('saves each drawing/replay once, fills all pages atomically, and reopens the replayed V5 snapshot', () => {
  const changed = vi.fn()
  const document = { id: 'book' } as IntermediateDocument
  const source = { format: 'pdf' as const, data: new Uint8Array() }
  const initial = {
    data: { ranges: [], rects: [], pagePaintings: {} },
    comments: [],
    extra: { retained: true },
    migrated: false
  }
  const view = render(
    <ReaderSurface
      source={source}
      document={document}
      initial={initial}
      onChange={changed}
    />
  )
  const a = drawingFixture({
    strokes: [{ id: 'a', tool: 'pen', points: [{ x: 10, y: 20 }] }]
  })
  const b = drawingFixture({
    strokes: [
      {
        id: 'b',
        tool: 'line',
        points: [
          { x: 30, y: 40 },
          { x: 50, y: 60 }
        ]
      }
    ]
  })
  const target: ReaderAnnotationHistoryValue = {
    ranges: [],
    rects: [],
    selectedRangeId: null,
    selectedRectId: null,
    pagePaintings: { 'page-1': a, 'page-2': b }
  }
  const status = {
    enabled: true,
    canUndo: true,
    canRedo: false,
    pastCount: 1,
    futureCount: 0
  }
  act(() => {
    capture.props!.onAnnotationHistoryChange!(target, {
      source: 'drawing',
      status
    })
    capture.props!.onPagePaintingsChange!(target.pagePaintings!)
  })
  expect(changed).toHaveBeenCalledTimes(1)
  act(() =>
    capture.props!.onAnnotationHistoryChange!(
      { ...target, pagePaintings: { 'page-1': a } },
      { source: 'undo', status }
    )
  )
  expect(changed).toHaveBeenCalledTimes(2)
  expect(capture.props!.data?.pagePaintings).toEqual({ 'page-1': a })
  act(() =>
    capture.props!.onAnnotationHistoryChange!(target, {
      source: 'redo',
      status
    })
  )
  expect(changed).toHaveBeenCalledTimes(3)
  const reopened = restoreReaderSnapshot(changed.mock.lastCall![0])
  expect(reopened.data.pagePaintings).toEqual(target.pagePaintings)
  expect(reopened.extra).toMatchObject({ retained: true })
  // Reset/save confirmation does not write another logical change.
  act(() =>
    capture.props!.onAnnotationHistoryChange!(target, {
      source: 'reset',
      status
    })
  )
  view.rerender(
    <ReaderSurface
      source={source}
      document={document}
      initial={reopened}
      onChange={changed}
    />
  )
  expect(changed).toHaveBeenCalledTimes(3)
  const legacy = { ...target }
  delete legacy.pagePaintings
  act(() =>
    capture.props!.onAnnotationHistoryChange!(legacy, {
      source: 'undo',
      status
    })
  )
  expect(capture.props!.data?.pagePaintings).toEqual(target.pagePaintings)
  act(() =>
    capture.props!.onAnnotationHistoryChange!(
      { ...target, pagePaintings: {} },
      { source: 'undo', status }
    )
  )
  expect(capture.props!.data?.pagePaintings).toEqual({})
})

it('keeps same-batch ink when a pending progress snapshot flushes before React echoes it', () => {
  const changed = vi.fn()
  const initial = {
    data: {
      ranges: [],
      rects: [],
      pagePaintings: {},
      bookmarks: [{ pageNumber: 1, verticalPercentage: 20 }]
    },
    comments: [],
    extra: { retained: true },
    migrated: false
  }
  render(
    <ReaderSurface
      document={{ id: 'book' } as IntermediateDocument}
      source={{ format: 'pdf', data: new Uint8Array() }}
      initial={initial}
      onChange={changed}
    />
  )
  const ink = drawingFixture({
    strokes: [{ id: 'latest', tool: 'pen', points: [{ x: 10, y: 20 }] }]
  })
  const props = capture.props!
  act(() => {
    props.onPagePaintingsChange!({ 'page-1': ink })
    props.onDataChange!({
      ...props.data,
      layoutReadingProgress: { pageNumber: 2, verticalPercentage: 40 }
    })
  })
  const restored = restoreReaderSnapshot(changed.mock.lastCall![0])
  expect(restored.data.pagePaintings).toEqual({ 'page-1': ink })
  expect(restored.data.layoutReadingProgress).toEqual({
    pageNumber: 2,
    verticalPercentage: 40
  })
  expect(restored.data.bookmarks).toEqual(initial.data.bookmarks)
  expect(restored.extra).toMatchObject({ retained: true })
})
