import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, useState, type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Reader } from '../src/components/Reader'
import type { EngineSelectionControls } from '../src/components/EngineSelectionControls'
import type { ReaderData } from '../src/types/readerData'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../src/types/selection'

type ControlsProps = ComponentProps<typeof EngineSelectionControls>

const mocks = vi.hoisted(() => ({
  pdf: null as Record<string, unknown> | null,
  controls: null as ControlsProps | null
}))

vi.mock('../src/pdf/PdfDocumentViewer', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    PdfDocumentViewer: forwardRef(
      (props: Record<string, unknown>, ref: unknown) => {
        mocks.pdf = props
        useImperativeHandle(ref as never, () => ({
          selectRange: () => {
            const doc = document.implementation.createHTMLDocument()
            doc.body.innerHTML = '<p>Alpha beta gamma</p>'
            const range = doc.createRange()
            range.setStart(doc.querySelector('p')!.firstChild!, 0)
            range.setEnd(doc.querySelector('p')!.firstChild!, 5)
            return range
          },
          setSelectionRange: () => undefined,
          hitTestSelection: () => null,
          serializeSelection: () => null,
          serializeRangeEndpoint: () => null,
          scrollToPage: () => undefined,
          setScale: () => undefined,
          captureReadingPosition: () => undefined,
          captureTextAnchor: () => undefined
        }))
        return null
      }
    )
  }
})

vi.mock('../src/components/EngineSelectionControls', () => ({
  EngineSelectionControls: (props: ControlsProps) => {
    mocks.controls = props
    return props.range ? props.children : null
  }
}))

const documentIndex = {
  id: 'pdf-history',
  title: 'PDF history',
  pages: [{ id: 'page-1', number: 1, width: 600, height: 800, content: [] }]
}
const source = { format: 'pdf' as const, data: new Uint8Array([1]) }
const original: ReaderSelectionRange = {
  id: 'H1',
  createdAt: 1,
  start: { selectionId: 'page-1', offset: 0 },
  end: { selectionId: 'page-1', offset: 5 },
  text: 'Alpha',
  rectsBySelectionId: {},
  markerStyle: { backgroundColor: '#d1b88a', color: '#112233' }
}
const second: ReaderSelectionRange = { ...original, id: 'H2', createdAt: 2 }
const initial: ReaderData = {
  ranges: [original, second],
  rects: [],
  pagePaintings: {}
}

// ReaderSurface 的真实回传方式：宿主把受控标注快照写回 data，再作为受控 props 传回。
// normalize 模拟宿主持久化后回传时的字段规范化（键顺序、默认值）。
function ControlledDataHost({
  selectionRef,
  onChange,
  normalize = (ranges) => ranges
}: {
  selectionRef: React.RefObject<ReaderSelectionRef | null>
  onChange: (next: ReaderData) => void
  normalize?: (ranges: ReaderSelectionRange[]) => ReaderSelectionRange[]
}) {
  const [data, setData] = useState<ReaderData>(initial)
  const [rangeId, setRangeId] = useState<string | null>(null)
  const write = (next: ReaderData) => {
    const normalized: ReaderData = {
      ...next,
      ranges: normalize(next.ranges ?? [])
    }
    setData(normalized)
    onChange(normalized)
  }
  return (
    <Reader
      document={documentIndex}
      engineSource={source}
      useVirtualPaper={false}
      bottomBar={null}
      selectedTool='text-selection'
      data={data}
      selectionRef={selectionRef}
      selectedRangeId={rangeId}
      onSelectRange={setRangeId}
      annotationHistory={{ enabled: true, resetKey: documentIndex.id }}
      onDataChange={write}
      onUpdateRange={(range) =>
        write({
          ...data,
          ranges: data.ranges?.map((item) =>
            item.id === range.id ? range : item
          )
        })
      }
      onHighlight={(range) =>
        write({
          ...data,
          ranges: [...(data.ranges ?? []), range]
        })
      }
      onAnnotationHistoryChange={(next, detail) => {
        setRangeId(next.selectedRangeId)
        if (detail.source !== 'reset' && detail.source !== 'drawing')
          write({
            ...data,
            ranges: next.ranges,
            rects: next.rects,
            pagePaintings: next.pagePaintings ?? data.pagePaintings
          })
      }}
    />
  )
}

const activate = (id: string) =>
  act(() => {
    ;(mocks.pdf as Record<string, (id: string) => void>).onSelectRange(id)
  })

const changeColor = (color: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: `Highlight color ${color}` })
  )

const rangesOf = (data: ReaderData) =>
  (data.ranges ?? []).map((range) => [
    range.id,
    range.markerStyle?.backgroundColor
  ])

describe('PDF controlled data history', () => {
  it('keeps multi-step undo/redo across controlled snapshot echoes', async () => {
    const ref = createRef<ReaderSelectionRef>()
    let latest: ReaderData = initial
    render(
      <ControlledDataHost
        selectionRef={ref}
        onChange={(next) => {
          latest = next
        }}
      />
    )
    await waitFor(() => expect(mocks.pdf).not.toBeNull())
    await activate('H1')
    await screen.findByRole('toolbar', { name: '高亮操作' })
    changeColor('#8eba8e')
    expect(rangesOf(latest)).toEqual([
      ['H1', '#8eba8e'],
      ['H2', '#d1b88a']
    ])
    expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(1)

    await activate('H2')
    await screen.findByRole('toolbar', { name: '高亮操作' })
    changeColor('#7d9ec0')
    expect(rangesOf(latest)).toEqual([
      ['H1', '#8eba8e'],
      ['H2', '#7d9ec0']
    ])
    expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(2)

    act(() => expect(ref.current?.undo()).toBe(true))
    expect(rangesOf(latest)).toEqual([
      ['H1', '#8eba8e'],
      ['H2', '#d1b88a']
    ])
    expect(ref.current?.getAnnotationHistoryState()).toMatchObject({
      pastCount: 1,
      futureCount: 1
    })

    act(() => expect(ref.current?.undo()).toBe(true))
    expect(rangesOf(latest)).toEqual([
      ['H1', '#d1b88a'],
      ['H2', '#d1b88a']
    ])
    expect(ref.current?.getAnnotationHistoryState()).toMatchObject({
      pastCount: 0,
      futureCount: 2
    })

    act(() => expect(ref.current?.redo()).toBe(true))
    expect(rangesOf(latest)).toEqual([
      ['H1', '#8eba8e'],
      ['H2', '#d1b88a']
    ])

    act(() => expect(ref.current?.redo()).toBe(true))
    expect(rangesOf(latest)).toEqual([
      ['H1', '#8eba8e'],
      ['H2', '#7d9ec0']
    ])
    expect(ref.current?.getAnnotationHistoryState()).toMatchObject({
      pastCount: 2,
      futureCount: 0
    })
  })

  it('keeps undo/redo when the host echoes normalized persisted ranges', async () => {
    const ref = createRef<ReaderSelectionRef>()
    let latest: ReaderData = initial
    const normalize = (
      ranges: ReaderSelectionRange[]
    ): ReaderSelectionRange[] =>
      ranges.map((range) => ({
        ...range,
        markerStyle: {
          color: range.markerStyle?.color ?? '#000000',
          backgroundColor: range.markerStyle?.backgroundColor
        },
        selectionStyle: range.selectionStyle ?? {},
        rectsBySelectionId: range.rectsBySelectionId ?? {}
      }))
    render(
      <ControlledDataHost
        selectionRef={ref}
        onChange={(next) => {
          latest = next
        }}
        normalize={normalize}
      />
    )
    await waitFor(() => expect(mocks.pdf).not.toBeNull())
    await activate('H1')
    await screen.findByRole('toolbar', { name: '高亮操作' })
    changeColor('#8eba8e')
    expect(rangesOf(latest)).toEqual([
      ['H1', '#8eba8e'],
      ['H2', '#d1b88a']
    ])
    expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(1)

    await activate('H2')
    await screen.findByRole('toolbar', { name: '高亮操作' })
    changeColor('#7d9ec0')
    expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(2)

    act(() => expect(ref.current?.undo()).toBe(true))
    expect(rangesOf(latest)).toEqual([
      ['H1', '#8eba8e'],
      ['H2', '#d1b88a']
    ])
    act(() => expect(ref.current?.undo()).toBe(true))
    expect(rangesOf(latest)).toEqual([
      ['H1', '#d1b88a'],
      ['H2', '#d1b88a']
    ])
    act(() => expect(ref.current?.redo()).toBe(true))
    act(() => expect(ref.current?.redo()).toBe(true))
    expect(rangesOf(latest)).toEqual([
      ['H1', '#8eba8e'],
      ['H2', '#7d9ec0']
    ])
    expect(ref.current?.getAnnotationHistoryState()).toMatchObject({
      pastCount: 2,
      futureCount: 0
    })
  })
})
