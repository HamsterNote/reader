import handoffFixture from './fixtures/highlight-handoff.json'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHighlightDrag } from '../src/components/IntermediateDocumentViewer/useHighlightDrag'
import {
  HIGHLIGHT_HANDOFF_TIMEOUT_MS,
  type ReaderHighlightDragHandoff
} from '../src/types/highlightDrag'
import type { ReaderSelectionRange } from '../src/types/selection'

const range: ReaderSelectionRange = {
  ...handoffFixture.highlight,
  epubRangeCoordinates: 'reader-compat-v1'
}

function event(type: string, input: Partial<PointerEvent> = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 80,
    clientY: 240,
    ...input
  })
  return e as PointerEvent
}
function setup() {
  vi.useFakeTimers()
  const root = document.createElement('div')
  document.body.append(root)
  const onGesture = vi.fn<ReaderHighlightDragHandoff['onGesture']>()
  const legacy = vi.fn()
  const handoff: ReaderHighlightDragHandoff = {
    contract: 'pane-highlight-drag-v1',
    onGesture
  }
  const hook = renderHook(
    ({ element }) =>
      useHighlightDrag({
        viewerRootElement: element,
        resolveHighlight: () => range,
        onDragHighlight: legacy,
        highlightDragHandoff: handoff
      }),
    { initialProps: { element: root } }
  )
  const down = (data: Partial<PointerEvent> = {}) =>
    act(() =>
      hook.result.current.handleHighlightPointerDown(event('pointerdown', data))
    )
  const send = (type: string, data: Partial<PointerEvent> = {}) =>
    act(() => document.dispatchEvent(event(type, data)))
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
  return { ...hook, onGesture, legacy, down, send, advance, root }
}
afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})
describe('highlight handoff lifecycle', () => {
  it('preserves the complete original serializable range and never calls the legacy callback', () => {
    const h = setup()
    h.down()
    h.advance(499)
    expect(h.onGesture).not.toHaveBeenCalled()
    h.advance(1)
    expect(h.onGesture.mock.calls[0][0]).toEqual({
      phase: 'start',
      pointerId: 7,
      pointerType: 'touch',
      client: { x: 80, y: 240 },
      highlight: range
    })
    expect(
      JSON.parse(JSON.stringify(h.onGesture.mock.calls[0][0])).highlight
    ).toEqual(range)
    expect(
      h.onGesture.mock.calls[0][0].phase === 'start' &&
        h.onGesture.mock.calls[0][0].highlight
    ).toBe(range)
    expect(h.legacy).not.toHaveBeenCalled()
    expect(h.root.children).toHaveLength(0)
  })
  it('times out at the named 250ms boundary and ignores late acceptance', () => {
    const h = setup()
    h.down()
    h.advance(500)
    const acknowledge = h.onGesture.mock.calls[0][1]
    h.advance(HIGHLIGHT_HANDOFF_TIMEOUT_MS - 1)
    expect(h.onGesture).toHaveBeenCalledTimes(1)
    h.advance(1)
    expect(h.onGesture.mock.calls[1][0]).toEqual({
      phase: 'cancel',
      pointerId: 7,
      reason: 'handoff-timeout'
    })
    act(() => acknowledge('accepted'))
    expect(h.result.current.suppressNativeSelection).toBe(false)
    h.send('pointermove')
    expect(h.onGesture).toHaveBeenCalledTimes(2)
  })
  it('forwards pre-ack movement and release, then cannot be revived', () => {
    const h = setup()
    h.down()
    h.advance(500)
    const acknowledge = h.onGesture.mock.calls[0][1]
    h.send('pointermove', { clientX: 90 })
    h.send('pointerup')
    expect(h.onGesture.mock.calls.map(([e]) => e.phase)).toEqual([
      'start',
      'move',
      'end'
    ])
    act(() => acknowledge('accepted'))
    h.advance(1000)
    expect(h.onGesture).toHaveBeenCalledTimes(3)
  })
  it('stops sending authoritative movement/end after takeover, host ended releases suppression', () => {
    const h = setup()
    h.down()
    h.advance(500)
    const acknowledge = h.onGesture.mock.calls[0][1]
    act(() => acknowledge('accepted'))
    h.advance(1000)
    h.send('pointermove', { clientX: 300 })
    expect(h.onGesture).toHaveBeenCalledTimes(1)
    act(() => acknowledge('ended'))
    expect(h.result.current.suppressNativeSelection).toBe(false)
    h.down()
    h.advance(500)
    expect(h.onGesture).toHaveBeenCalledTimes(2)
  })
  describe.each(['pointercancel', 'pointerup'])(
    'host ownership after source %s',
    (type) => {
      it.each(['replace', 'unmount'])(
        'still cancels the host session on source %s',
        (cleanup) => {
          const h = setup()
          h.down()
          h.advance(500)
          const acknowledge = h.onGesture.mock.calls[0][1]
          act(() => acknowledge('accepted'))
          h.send(type)
          expect(h.result.current.activePointerType).toBeNull()
          expect(h.result.current.suppressNativeSelection).toBe(false)
          expect(h.onGesture.mock.calls.map(([e]) => e.phase)).toEqual([
            'start'
          ])

          if (cleanup === 'replace')
            h.rerender({ element: document.createElement('div') })
          else h.unmount()
          expect(h.onGesture.mock.calls.map(([e]) => e.phase)).toEqual([
            'start',
            'cancel'
          ])
          expect(h.onGesture.mock.calls[1][0]).toEqual({
            phase: 'cancel',
            pointerId: 7,
            reason: 'source-replaced'
          })
          act(() => {
            acknowledge('accepted')
            acknowledge('ended')
          })
          h.advance(1000)
          h.unmount()
          expect(h.onGesture).toHaveBeenCalledTimes(2)
        }
      )
      it('releases the session on host ended and ignores its late acknowledgements', () => {
        const h = setup()
        h.down()
        h.advance(500)
        const acknowledge = h.onGesture.mock.calls[0][1]
        act(() => acknowledge('accepted'))
        h.send(type)
        act(() => acknowledge('ended'))
        h.rerender({ element: document.createElement('div') })
        expect(h.onGesture).toHaveBeenCalledTimes(1)

        h.down()
        h.advance(500)
        const nextAcknowledge = h.onGesture.mock.calls[1][1]
        act(() => {
          nextAcknowledge('accepted')
          acknowledge('ended')
          acknowledge('rejected')
        })
        h.unmount()
        expect(h.onGesture.mock.calls.map(([e]) => e.phase)).toEqual([
          'start',
          'start',
          'cancel'
        ])
      })
    }
  )
  it('still cancels on blur after native takeover cancels the source stream', () => {
    const h = setup()
    h.down()
    h.advance(500)
    act(() => h.onGesture.mock.calls[0][1]('accepted'))
    h.send('pointercancel')
    act(() => window.dispatchEvent(new Event('blur')))
    expect(h.onGesture.mock.calls.map(([e]) => e.phase)).toEqual([
      'start',
      'cancel'
    ])
    expect(h.onGesture.mock.calls[1][0]).toEqual({
      phase: 'cancel',
      pointerId: 7,
      reason: 'blur'
    })
    h.unmount()
    expect(h.onGesture).toHaveBeenCalledTimes(2)
  })
  it.each(['pointerup', 'pointercancel', 'pointermove'])(
    'cancels early %s',
    (type) => {
      const h = setup()
      h.down()
      h.send(type, { clientX: 85 })
      h.advance(1000)
      expect(h.onGesture).not.toHaveBeenCalled()
      expect(h.result.current.suppressNativeSelection).toBe(false)
    }
  )
  it('rejects multi-touch even outside the viewer', () => {
    const h = setup()
    h.down()
    h.send('pointerdown', { pointerId: 8, isPrimary: false })
    h.advance(1000)
    expect(h.onGesture).not.toHaveBeenCalled()
  })
  it.each(['blur', 'pointercancel', 'replace', 'unmount', 'reject'])(
    'cleans up %s and permits no stale updates',
    (type) => {
      const h = setup()
      h.down()
      h.advance(500)
      const acknowledge = h.onGesture.mock.calls[0][1]
      act(() => {
        if (type === 'blur') window.dispatchEvent(new Event('blur'))
        if (type === 'pointercancel')
          document.dispatchEvent(event('pointercancel'))
        if (type === 'replace')
          h.rerender({ element: document.createElement('div') })
        if (type === 'unmount') h.unmount()
        if (type === 'reject') acknowledge('rejected')
      })
      expect(h.onGesture.mock.calls[1][0].phase).toBe('cancel')
      act(() => acknowledge('accepted'))
      h.advance(1000)
      expect(h.onGesture).toHaveBeenCalledTimes(2)
    }
  )
  it('retains the mouse threshold and ignores pen/right button', () => {
    const h = setup()
    h.down({ pointerType: 'pen' })
    h.advance(500)
    expect(h.onGesture).not.toHaveBeenCalled()
    h.down({ pointerType: 'mouse', button: 2 })
    h.advance(500)
    expect(h.onGesture).not.toHaveBeenCalled()
    h.down({ pointerType: 'mouse' })
    h.send('pointermove', { clientX: 84 })
    expect(h.onGesture).not.toHaveBeenCalled()
    h.send('pointermove', { clientX: 85 })
    expect(h.onGesture).toHaveBeenCalledTimes(1)
  })
})

it('lets the host own crossing a frame boundary and source pointer cancellation after acceptance', () => {
  const h = setup()
  h.down()
  h.advance(500)
  act(() => h.onGesture.mock.calls[0][1]('accepted'))
  h.send('pointerout', { relatedTarget: null })
  h.send('pointercancel')
  h.send('pointercancel')
  h.send('pointermove', { clientX: 300 })
  expect(h.onGesture).toHaveBeenCalledTimes(1)
  expect(h.result.current.activePointerType).toBeNull()
  expect(h.result.current.suppressNativeSelection).toBe(false)
  const touch = new Event('touchstart', { bubbles: true, cancelable: true })
  Object.assign(touch, { touches: [{}] })
  act(() => h.root.dispatchEvent(touch))
  expect(touch.defaultPrevented).toBe(false)
})
