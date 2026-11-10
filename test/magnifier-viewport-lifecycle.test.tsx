import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  RangeMagnifierProvider,
  useRangeMagnifier
} from '../src/components/IntermediateDocumentViewer/RangeMagnifier'
import { mockElementSize } from './setup'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('remeasures active text sessions, recovers from empty intersections and disposes all pending work', () => {
  vi.useFakeTimers()
  const host = document.createElement('div')
  host.innerHTML = '<p>abcd</p>'
  document.body.append(host)
  mockElementSize(host, { left: 0, top: 47, width: 390, height: 700 })
  const style = document.createElement('style')
  style.textContent =
    '[data-magnifier-safe-area] { padding: 47px 0 34px !important; }'
  document.head.append(style)
  const range = document.createRange()
  range.selectNodeContents(host.firstChild!)
  const focus = { range, end: true, color: '#ff0000' }
  let controller!: NonNullable<ReturnType<typeof useRangeMagnifier>>
  function Consumer() {
    controller = useRangeMagnifier()!
    return null
  }
  const tree = (source = 'first', enabled = true) => (
    <RangeMagnifierProvider
      rootElement={host}
      source={source}
      enabled={enabled}
    >
      <Consumer />
    </RangeMagnifierProvider>
  )
  const view = render(tree())
  const start = () =>
    act(() =>
      controller.start(host, { clientX: 195, clientY: 161 }, focus, 'touch')
    )
  const flush = () => act(() => vi.advanceTimersByTime(40))
  start()
  const lens = screen.getByTestId('range-magnifier')
  expect(lens.hidden).toBe(false)
  expect(lens.style.top).toBe('47px')
  expect(lens.dataset.placement).toBe('above')
  flush()
  const reads = vi.spyOn(host, 'getBoundingClientRect')
  act(() => {
    controller.move({ clientX: 195, clientY: 160 })
    controller.move({ clientX: 196, clientY: 160 })
  })
  expect(reads).toHaveBeenCalledTimes(1)
  expect(lens.dataset.placement).toBe('below')
  expect(lens.style.top).toBe('198px')
  mockElementSize(host, { left: 0, top: 900, width: 390, height: 700 })
  fireEvent.resize(window)
  flush()
  expect(lens.hidden).toBe(true)
  mockElementSize(host, { left: 0, top: 47, width: 390, height: 700 })
  flush()
  expect(lens.hidden).toBe(false)
  expect(lens.style.top).toBe('198px')
  // Container translation plus repeated viewport signals are coalesced.
  mockElementSize(host, { left: 0, top: 180, width: 390, height: 500 })
  fireEvent.resize(window)
  fireEvent.scroll(document)
  flush()
  expect(lens.style.top).toBe('198px')
  act(() => controller.end())
  expect(lens.hidden).toBe(true)
  expect(document.querySelector('[data-magnifier-safe-area]')).toBeNull()
  start()
  fireEvent.blur(window)
  flush()
  expect(lens.hidden).toBe(true)
  expect(document.querySelector('[data-magnifier-safe-area]')).toBeNull()
  start()
  view.rerender(tree('new-document'))
  expect(lens.hidden).toBe(true)
  start()
  view.rerender(tree('new-document', false))
  expect(document.querySelector('[data-magnifier-safe-area]')).toBeNull()
  view.rerender(tree())
  start()
  fireEvent.resize(window)
  view.unmount()
  flush()
  expect(document.querySelector('[data-magnifier-safe-area]')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  host.remove()
  style.remove()
})
