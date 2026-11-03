import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, type ComponentProps, type ReactElement } from 'react'
import type { DefaultPopoverContext } from '../src/components/DefaultPopover'
import type { EngineSelectionControls } from '../src/components/EngineSelectionControls'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineDocumentViewer } from '../src/components/EngineDocumentViewer'
import type {
  EpubEngine,
  EpubEngineOptions
} from '../src/epub/foliateEpubEngine'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../src/types/selection'

type ControlsProps = ComponentProps<typeof EngineSelectionControls>

const mocks = vi.hoisted(() => ({
  factory: vi.fn(),
  controls: null as ControlsProps | null
}))
vi.mock('../src/epub/foliateEpubEngine', () => ({
  createEpubEngine: mocks.factory
}))
vi.mock('../src/pdf/PdfDocumentViewer', () => ({
  PdfDocumentViewer: () => null
}))
vi.mock('../src/components/EngineSelectionControls', () => ({
  EngineSelectionControls: (props: ControlsProps) => {
    mocks.controls = props
    return props.range ? props.children : null
  }
}))
let options: EpubEngineOptions
let engine: EpubEngine
let doc: Document
let native: Range
let serialized: {
  start: { selectionId: string; offset: number }
  end: { selectionId: string; offset: number }
  text: string
} | null
const source = { format: 'epub' as const, data: new Uint8Array([1]) }
const original: ReaderSelectionRange = {
  id: 'H1',
  createdAt: 123,
  start: { selectionId: 'page-1', offset: 0 },
  end: { selectionId: 'page-1', offset: 5 },
  text: 'Alpha',
  rectsBySelectionId: {},
  markerStyle: { backgroundColor: '#ff0000', color: '#112233' }
}
const second: ReaderSelectionRange = { ...original, id: 'H2' }

beforeEach(() => {
  doc = document.implementation.createHTMLDocument()
  doc.body.innerHTML = '<p>Alpha beta gamma</p>'
  native = doc.createRange()
  native.setStart(doc.querySelector('p')!.firstChild!, 0)
  native.setEnd(doc.querySelector('p')!.firstChild!, 5)
  serialized = { start: original.start, end: original.end, text: original.text }
  engine = {
    ready: Promise.resolve({
      title: 'Book',
      pageCount: 2,
      cover: null,
      coverPrepended: false,
      toc: []
    }),
    setHiddenPages: vi.fn(async () => {}),
    setFontScale: vi.fn(),
    showRanges: vi.fn(() => ({ located: [], unlocatable: [] })),
    setActiveRange: vi.fn(),
    clearSelection: vi.fn(),
    destroy: vi.fn(async () => {}),
    serializeCurrentSelection: vi.fn(() => serialized),
    getSelectionRange: vi.fn(() => native),
    selectRange: vi.fn(async () => native.cloneRange()),
    updateRangeEndpoint: vi.fn(() => serialized),
    serializeRange: vi.fn(() => serialized),
    captureTextAnchor: vi.fn(),
    nextPage: vi.fn(async () => true)
  } as unknown as EpubEngine
  mocks.factory.mockImplementation((value: EpubEngineOptions) => {
    options = value
    return engine
  })
})
async function activate(id = 'H1') {
  await act(async () => options.onHighlightActivate?.(id, { x: 0, y: 0 }))
  await screen.findByRole('toolbar', { name: '高亮操作' })
}

describe('engine selection transactions', () => {
  it('merges color into only the active ID and records undo/redo internally', async () => {
    const onUpdate = vi.fn(),
      onColor = vi.fn()
    const ref = createRef<ReaderSelectionRef>()
    render(
      <EngineDocumentViewer
        engineSource={source}
        defaultRanges={[original, second]}
        selectedTool='text-selection'
        onUpdateRange={onUpdate}
        selectionRef={ref}
        annotationHistory={{ enabled: true }}
        enginePopoverContext={{ onHighlightColorChange: onColor }}
      />
    )
    await activate('H2')
    fireEvent.change(screen.getByLabelText('Highlight color'), {
      target: { value: '#00ff00' }
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toEqual({
      ...second,
      markerStyle: { ...second.markerStyle, backgroundColor: '#00ff00' }
    })
    expect(onColor).toHaveBeenCalledWith('#00ff00')
    expect(ref.current?.canUndo()).toBe(true)
    act(() => {
      ref.current?.undo()
    })
    expect(screen.getByLabelText('Highlight color')).toHaveValue('#ff0000')
    act(() => {
      ref.current?.redo()
    })
    expect(screen.getByLabelText('Highlight color')).toHaveValue('#00ff00')
  })
  it('turns a different native selection into a draft despite delayed controlled selection echo', async () => {
    const onUpdate = vi.fn(),
      onSelect = vi.fn(),
      onColor = vi.fn()
    const ref = createRef<ReaderSelectionRef>()
    render(
      <EngineDocumentViewer
        engineSource={source}
        ranges={[original]}
        selectedRangeId='H1'
        selectedTool='text-selection'
        onUpdateRange={onUpdate}
        onSelect={onSelect}
        selectionRef={ref}
        enginePopoverContext={{ onHighlightColorChange: onColor }}
      />
    )
    await activate()
    native = native.cloneRange()
    native.setStart(doc.querySelector('p')!.firstChild!, 6)
    native.setEnd(doc.querySelector('p')!.firstChild!, 10)
    serialized = {
      start: { selectionId: 'page-1', offset: 6 },
      end: { selectionId: 'page-1', offset: 10 },
      text: 'beta'
    }
    act(() => options.onSelection?.(serialized))
    fireEvent.change(screen.getByLabelText('Highlight color'), {
      target: { value: '#00ff00' }
    })
    expect(onUpdate).not.toHaveBeenCalled()
    act(() => {
      ref.current?.confirm()
      ref.current?.confirm()
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].text).toBe('beta')
    expect(original.markerStyle?.backgroundColor).toBe('#ff0000')
  })
  it.each([false, true])(
    'deletes an entire ID and rejects captured edit/color callbacks (controlled=%s)',
    async (controlled) => {
      const onUpdate = vi.fn(),
        onRemove = vi.fn(),
        onHistory = vi.fn()
      const props = {
        engineSource: source,
        selectedTool: 'text-selection' as const,
        onUpdateRange: onUpdate,
        onRemoveRange: onRemove,
        onAnnotationHistoryChange: onHistory,
        annotationHistory: { enabled: true }
      }
      const view = render(
        <EngineDocumentViewer
          {...props}
          {...(controlled
            ? { ranges: [original, second] }
            : { defaultRanges: [original, second] })}
        />
      )
      await activate()
      const lateEdit = mocks.controls!.onUpdate
      const lateColor = (
        mocks.controls!.children as ReactElement<DefaultPopoverContext>
      ).props.onUpdateRange
      const lateDelete = (
        mocks.controls!.children as ReactElement<DefaultPopoverContext>
      ).props.onRemoveRange
      fireEvent.click(screen.getByRole('button', { name: '删除' }))
      expect(onRemove).toHaveBeenCalledExactlyOnceWith('H1')
      act(() => lateEdit(native, true))
      expect(onUpdate).not.toHaveBeenCalled()
      expect(screen.queryByRole('toolbar', { name: '高亮操作' })).toBeNull()
      if (controlled)
        view.rerender(<EngineDocumentViewer {...props} ranges={[second]} />)
      else expect(onHistory.mock.calls.at(-1)?.[0].ranges).toEqual([second])
      await activate('H2')
      act(() => {
        lateEdit(native, true)
        lateColor!({ ...original, markerStyle: { backgroundColor: '#000000' } })
        lateDelete!('H1')
      })
      expect(onUpdate).not.toHaveBeenCalled()
      expect(onRemove).toHaveBeenCalledTimes(1)
    }
  )
  it('invalidates pending activation and editing when the book changes', async () => {
    let release!: (value: Range) => void
    vi.mocked(engine.selectRange).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const onUpdate = vi.fn()
    const view = render(
      <EngineDocumentViewer
        engineSource={source}
        ranges={[original]}
        onUpdateRange={onUpdate}
      />
    )
    await waitFor(() => expect(mocks.factory).toHaveBeenCalled())
    act(() => options.onHighlightActivate?.('H1', { x: 0, y: 0 }))
    view.rerender(
      <EngineDocumentViewer
        engineSource={{ ...source, data: new Uint8Array([2]) }}
        ranges={[original]}
        onUpdateRange={onUpdate}
      />
    )
    await act(async () => release(native))
    expect(screen.queryByRole('toolbar', { name: '高亮操作' })).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

it('commits only a valid endpoint edit, preserves identity/style, and discards unmappable edits', async () => {
  const onUpdate = vi.fn(),
    onHistory = vi.fn()
  render(
    <EngineDocumentViewer
      engineSource={source}
      defaultRanges={[original]}
      onUpdateRange={onUpdate}
      onAnnotationHistoryChange={onHistory}
      annotationHistory={{ enabled: true }}
    />
  )
  await activate()
  serialized = {
    ...original,
    end: { selectionId: 'page-1', offset: 10 },
    text: 'Alpha beta'
  }
  act(() => mocks.controls!.onUpdate(native.cloneRange(), true))
  expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
    ...original,
    end: serialized.end,
    text: serialized.text
  })
  expect(onHistory.mock.calls.at(-1)?.[1].source).toBe('update-range')
  const historyCount = onHistory.mock.calls.length
  serialized = null
  act(() => mocks.controls!.onUpdate(native.cloneRange(), true))
  expect(onUpdate).toHaveBeenCalledTimes(1)
  expect(onHistory).toHaveBeenCalledTimes(historyCount)
})

it('recognizes a native endpoint touch lifecycle but cancels a gesture that also changes the other endpoint', async () => {
  const iframe = document.createElement('iframe')
  document.body.append(iframe)
  doc = iframe.contentDocument!
  doc.body.innerHTML = '<p>Alpha beta gamma</p>'
  native = doc.createRange()
  native.setStart(doc.querySelector('p')!.firstChild!, 0)
  native.setEnd(doc.querySelector('p')!.firstChild!, 5)
  Object.defineProperty(Object.getPrototypeOf(native), 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(20, 20, 100, 20)]
  })
  const onUpdate = vi.fn()
  const view = render(
    <EngineDocumentViewer
      engineSource={source}
      defaultRanges={[original]}
      onUpdateRange={onUpdate}
    />
  )
  try {
    act(() => options.onDocumentLoad?.(doc, 1))
    await activate()
    const selection = doc.getSelection()!
    selection.addRange(native.cloneRange())
    fireEvent.touchStart(doc, { touches: [{ clientX: 120, clientY: 40 }] })
    const expanded = native.cloneRange()
    expanded.setEnd(expanded.endContainer, 10)
    selection.removeAllRanges()
    selection.addRange(expanded)
    serialized = {
      ...original,
      end: { selectionId: 'page-1', offset: 10 },
      text: 'Alpha beta'
    }
    act(() => options.onSelection?.(serialized))
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.touchEnd(doc)
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    fireEvent.touchStart(doc, { touches: [{ clientX: 120, clientY: 40 }] })
    const fresh = expanded.cloneRange()
    fresh.setStart(fresh.startContainer, 2)
    fresh.setEnd(fresh.endContainer, 13)
    selection.removeAllRanges()
    selection.addRange(fresh)
    fireEvent.touchEnd(doc)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(selection.getRangeAt(0).toString()).toBe('Alpha beta')
  } finally {
    view.unmount()
    await new Promise((resolve) => setTimeout(resolve, 10))
    iframe.remove()
  }
})

it('auto-highlights a fresh draft once and keeps custom Popovers on their current target', async () => {
  const onSelect = vi.fn()
  const view = await act(async () =>
    render(
      <EngineDocumentViewer
        engineSource={source}
        selectedTool='text-selection'
        autoHighlight
        onSelect={onSelect}
        selectionPopover={<span>Custom draft</span>}
        highlightPopover={(range) => <span>Custom {range.id}</span>}
      />
    )
  )
  act(() => options.onDocumentLoad?.(doc, 1))
  act(() => options.onSelection?.(serialized))
  expect(screen.getByText('Custom draft')).toBeInTheDocument()
  await act(async () => {
    doc.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse' }))
  })
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(
    screen.getByText(`Custom ${onSelect.mock.calls[0][0].id}`)
  ).toBeInTheDocument()
  await act(async () => {
    doc.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse' }))
  })
  expect(onSelect).toHaveBeenCalledTimes(1)
  view.unmount()
})
