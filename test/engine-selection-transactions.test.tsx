import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  createRef,
  type ComponentProps,
  type ReactElement,
  useState
} from 'react'
import { Reader } from '../src/components/Reader'
import type { ReaderEngineSource } from '../src/types/engineSource'
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
import * as selectionSegments from '../src/components/selection/engineSelectionSegments'
import { IntermediateText, TextDir } from '@hamster-note/types'

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
  mocks.factory.mockReset()
  mocks.controls = null
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
    setSelectionRange: vi.fn(),
    getSelectionRange: vi.fn(() => native),
    selectRange: vi.fn(async () => native.cloneRange()),
    goToRange: vi.fn(async () => true),
    updateRangeEndpoint: vi.fn(() => serialized),
    serializeRange: vi.fn(() => serialized),
    captureTextAnchor: vi.fn(),
    captureReadingPosition: vi.fn(() => ({ status: 'pending' })),
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

const compatibilityIndex = {
  id: 'shared-index',
  title: 'Shared index',
  pages: [{ id: 'page-1', number: 1, width: 600, height: 800, content: [] }]
}

it.each([false, true])(
  'waits for sidebar highlight navigation before selection (dispose=%s)',
  async (dispose) => {
    let finish!: (located: boolean) => void
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve
    })
    vi.mocked(engine.goToRange).mockReturnValue(pending)
    const view = render(
      <EngineDocumentViewer
        engineSource={source}
        defaultRanges={[original]}
        selectedTool='text-selection'
        showPageBrowser
      />
    )
    await waitFor(() => expect(mocks.factory).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('tab', { name: '高亮' }))
    fireEvent.click(screen.getByRole('button', { name: '跳转到高亮：Alpha' }))
    expect(engine.goToRange).toHaveBeenCalledOnce()
    expect(engine.selectRange).not.toHaveBeenCalled()
    if (dispose) view.unmount()
    await act(async () => {
      finish(true)
      await pending
    })
    expect(engine.goToRange).toHaveBeenCalledOnce()
    if (dispose) expect(engine.selectRange).not.toHaveBeenCalled()
    else {
      expect(engine.selectRange).toHaveBeenCalledWith('H1')
      expect(engine.setActiveRange).toHaveBeenLastCalledWith('H1')
    }
  }
)

function ControlledDeletionHost({
  response,
  selectionRef,
  onHistory,
  onRemove
}: {
  response: 'accept' | 'delayed' | 'reject'
  selectionRef: ComponentProps<typeof Reader>['selectionRef']
  onHistory: NonNullable<
    ComponentProps<typeof Reader>['onAnnotationHistoryChange']
  >
  onRemove: (id: string) => void
}) {
  const [ranges, setRanges] = useState([original, second])
  return (
    <>
      <button
        onClick={() =>
          setRanges((items) => items.filter((item) => item.id !== 'H1'))
        }
      >
        accept deletion
      </button>
      <output data-testid='host-ranges'>{JSON.stringify(ranges)}</output>
      <Reader
        document={compatibilityIndex}
        engineSource={source}
        bottomBar={null}
        ranges={ranges}
        annotationHistory
        selectionRef={selectionRef}
        onUpdateRange={(next) =>
          setRanges((items) =>
            items.map((item) => (item.id === next.id ? next : item))
          )
        }
        onRemoveRange={(id) => {
          onRemove(id)
          if (response === 'accept')
            setRanges((items) => items.filter((item) => item.id !== id))
          else if (response === 'reject')
            setRanges((items) => items.map((item) => ({ ...item })))
        }}
        onAnnotationHistoryChange={(next, detail) => {
          onHistory(next, detail)
          if (detail.source === 'undo' || detail.source === 'redo')
            setRanges(next.ranges)
        }}
      />
    </>
  )
}

describe('Reader with the native viewer and a controlled host', () => {
  it.each([false, true])(
    'isolates source-only file changes with identical page-1 content (index=%s)',
    async (withIndex) => {
      const ref = createRef<ReaderSelectionRef>()
      const onHistory = vi.fn()
      function Host({ file }: { file: ReaderEngineSource }) {
        const [ranges, setRanges] = useState([original])
        return (
          <Reader
            document={withIndex ? compatibilityIndex : undefined}
            engineSource={file}
            bottomBar={null}
            ranges={ranges}
            annotationHistory
            selectionRef={ref}
            onUpdateRange={(next) => setRanges([next])}
            onAnnotationHistoryChange={(next, detail) => {
              onHistory(next, detail)
              if (detail.source !== 'reset') setRanges(next.ranges)
            }}
          />
        )
      }
      const view = await act(async () => render(<Host file={source} />))
      await waitFor(() => expect(mocks.factory).toHaveBeenCalled())
      await activate()
      fireEvent.change(screen.getByLabelText('Highlight color'), {
        target: { value: '#00ff00' }
      })
      expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(1)
      act(() => expect(ref.current?.undo()).toBe(true))
      expect(ref.current?.getAnnotationHistoryState().futureCount).toBe(1)
      const fileB = { ...source, data: new Uint8Array([2]) }
      view.rerender(<Host file={fileB} />)
      await waitFor(() => expect(mocks.factory).toHaveBeenCalledTimes(2))
      expect(ref.current?.getAnnotationHistoryState()).toMatchObject({
        pastCount: 0,
        futureCount: 0,
        canUndo: false,
        canRedo: false
      })
      const calls = onHistory.mock.calls.length
      act(() => {
        expect(ref.current?.undo()).toBe(false)
        expect(ref.current?.redo()).toBe(false)
      })
      expect(onHistory).toHaveBeenCalledTimes(calls)
      // B has the same public ID but gets its own baseline and editable history.
      await activate()
      fireEvent.change(screen.getByLabelText('Highlight color'), {
        target: { value: '#0000ff' }
      })
      act(() => expect(ref.current?.undo()).toBe(true))
      expect(onHistory.mock.lastCall?.[0].ranges).toEqual([original])
      expect(ref.current?.canUndo()).toBe(false)
    }
  )

  it.each(['accept', 'delayed', 'reject'] as const)(
    'reconciles controlled deletion before external replacement (%s)',
    async (response) => {
      const ref = createRef<ReaderSelectionRef>()
      const onHistory = vi.fn()
      const onRemove = vi.fn()
      await act(async () =>
        render(
          <ControlledDeletionHost
            response={response}
            selectionRef={ref}
            onHistory={onHistory}
            onRemove={onRemove}
          />
        )
      )
      await waitFor(() => expect(mocks.factory).toHaveBeenCalled())
      await activate()
      fireEvent.change(screen.getByLabelText('Highlight color'), {
        target: { value: '#00ff00' }
      })
      expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(1)
      const edited = {
        ...original,
        markerStyle: { ...original.markerStyle, backgroundColor: '#00ff00' }
      }
      fireEvent.click(screen.getByRole('button', { name: '删除' }))
      expect(onRemove).toHaveBeenCalledExactlyOnceWith('H1')
      if (response === 'delayed') {
        expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(1)
        fireEvent.click(screen.getByRole('button', { name: 'accept deletion' }))
      }
      const accepted = response !== 'reject'
      expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(
        accepted ? 2 : 1
      )
      expect(
        onHistory.mock.calls.filter(([, detail]) => detail.source === 'clear')
      ).toHaveLength(accepted ? 1 : 0)
      act(() => expect(ref.current?.undo()).toBe(true))
      expect(
        JSON.parse(screen.getByTestId('host-ranges').textContent!)
      ).toEqual(accepted ? [edited, second] : [original, second])
      expect(ref.current?.getAnnotationHistoryState().pastCount).toBe(
        accepted ? 1 : 0
      )
      if (accepted) {
        act(() => expect(ref.current?.undo()).toBe(true))
        expect(
          JSON.parse(screen.getByTestId('host-ranges').textContent!)
        ).toEqual([original, second])
        act(() => {
          expect(ref.current?.redo()).toBe(true)
          expect(ref.current?.redo()).toBe(true)
        })
        expect(
          JSON.parse(screen.getByTestId('host-ranges').textContent!)
        ).toEqual([second])
      }
    }
  )

  it('uses the new source baseline for uncontrolled native annotations', async () => {
    const ref = createRef<ReaderSelectionRef>()
    const props = {
      defaultRanges: [original],
      annotationHistory: true,
      selectionRef: ref,
      bottomBar: null
    }
    const view = await act(async () =>
      render(<Reader {...props} engineSource={source} />)
    )
    await waitFor(() => expect(mocks.factory).toHaveBeenCalled())
    await activate()
    fireEvent.change(screen.getByLabelText('Highlight color'), {
      target: { value: '#00ff00' }
    })
    expect(ref.current?.canUndo()).toBe(true)
    view.rerender(
      <Reader
        {...props}
        engineSource={{ ...source, data: new Uint8Array([2]) }}
      />
    )
    await waitFor(() => expect(mocks.factory).toHaveBeenCalledTimes(2))
    expect(ref.current?.canUndo()).toBe(false)
    await activate()
    expect(screen.getByLabelText('Highlight color')).toHaveValue('#ff0000')
    fireEvent.change(screen.getByLabelText('Highlight color'), {
      target: { value: '#0000ff' }
    })
    act(() => expect(ref.current?.undo()).toBe(true))
    await activate()
    expect(screen.getByLabelText('Highlight color')).toHaveValue('#ff0000')
    expect(ref.current?.canUndo()).toBe(false)
  })
})

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
  it('reactivates a host-retained range after rejected deletion and retries without accepting old actions', async () => {
    const onUpdate = vi.fn(),
      onRemove = vi.fn()
    // An engine may reuse the same Range. Session invalidation must not depend
    // on getting a different DOM object on the next activation.
    vi.mocked(engine.selectRange).mockResolvedValue(native)
    const props = {
      engineSource: source,
      selectedTool: 'text-selection' as const,
      onUpdateRange: onUpdate,
      onRemoveRange: onRemove
    }
    const view = render(
      <EngineDocumentViewer {...props} ranges={[original, second]} />
    )
    await activate()
    const lateEdit = mocks.controls!.onUpdate
    const lateEditing = mocks.controls!.onEditingChange
    const staleMenu = (
      mocks.controls!.children as ReactElement<DefaultPopoverContext>
    ).props
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('H1')
    // The host rejects the request and echoes its retained authoritative data.
    view.rerender(
      <EngineDocumentViewer {...props} ranges={[{ ...original }, second]} />
    )
    expect(screen.queryByRole('toolbar', { name: '高亮操作' })).toBeNull()
    await activate()
    act(() => {
      lateEditing(true)
      lateEdit(native, true)
      staleMenu.onUpdateRange!({
        ...original,
        markerStyle: { backgroundColor: '#000000' }
      })
      staleMenu.onRemoveRange!('H1')
    })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('toolbar', { name: '高亮操作' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('Highlight color'), {
      target: { value: '#00ff00' }
    })
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      ...original,
      markerStyle: { ...original.markerStyle, backgroundColor: '#00ff00' }
    })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onRemove.mock.calls).toEqual([['H1'], ['H1']])
    view.rerender(<EngineDocumentViewer {...props} ranges={[second]} />)
    act(() => options.onHighlightActivate?.('H1', { x: 0, y: 0 }))
    expect(screen.queryByRole('toolbar', { name: '高亮操作' })).toBeNull()
    await activate('H2')
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

it('does not commit obsolete native endpoint touch gestures', async () => {
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
    expect(onUpdate).not.toHaveBeenCalled()
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
    expect(onUpdate).not.toHaveBeenCalled()
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
  // EPUB finishes its managed handoff on the next animation frame.
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
  expect(
    screen.getByText(`Custom ${onSelect.mock.calls[0][0].id}`)
  ).toBeInTheDocument()
  await act(async () => {
    doc.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse' }))
  })
  expect(onSelect).toHaveBeenCalledTimes(1)
  view.unmount()
})

it.each([
  'finish',
  'late-selection',
  'late-during-extraction',
  'callback-confirm',
  'cancel',
  'unload'
] as const)(
  'hands a finished native EPUB gesture to managed controls safely (%s)',
  async (scenario) => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    doc = iframe.contentDocument!
    doc.body.innerHTML = '<p>Alpha beta gamma</p>'
    const selection = doc.getSelection()!
    let managed: Range | null = null
    const currentRange = () =>
      selection.rangeCount && !selection.isCollapsed
        ? selection.getRangeAt(0)
        : managed
    vi.mocked(engine.getSelectionRange).mockImplementation(currentRange)
    vi.mocked(engine.serializeCurrentSelection).mockImplementation(() => {
      const range = currentRange()
      return range
        ? {
            start: { selectionId: 'page-1', offset: range.startOffset },
            end: { selectionId: 'page-1', offset: range.endOffset },
            text: range.toString()
          }
        : null
    })
    vi.mocked(engine.setSelectionRange).mockImplementation((range) => {
      managed = range?.cloneRange() ?? null
      selection.removeAllRanges()
    })
    vi.mocked(engine.clearSelection).mockImplementation(() => {
      managed = null
      selection.removeAllRanges()
    })
    let resolveExtraction!: (
      value: Awaited<
        ReturnType<typeof selectionSegments.engineSelectionSegments>
      >
    ) => void
    const extraction = new Promise<
      Awaited<ReturnType<typeof selectionSegments.engineSelectionSegments>>
    >((resolve) => {
      resolveExtraction = resolve
    })
    const extract = vi
      .spyOn(selectionSegments, 'engineSelectionSegments')
      .mockReturnValue(extraction)
    const callbacks: string[] = []
    const ref = createRef<ReaderSelectionRef>()
    const onSelect = vi.fn()
    const onEnd = vi.fn((_position, value: Selection) =>
      callbacks.push(`native:${value.toString()}`)
    )
    const onTextEnd = vi.fn((_text, detail) => {
      callbacks.push(`text:${detail.selection.toString()}`)
      if (scenario === 'callback-confirm') ref.current?.confirm()
    })
    const onSelectText = vi.fn((value: Selection) =>
      callbacks.push(`segments:${value.toString()}`)
    )
    const view = render(
      <EngineDocumentViewer
        engineSource={source}
        document={compatibilityIndex}
        selectedTool='text-selection'
        selectionRef={ref}
        onSelect={onSelect}
        onSelectionEnd={onEnd}
        onTextSelectionEnd={onTextEnd}
        onSelectText={onSelectText}
      />
    )
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 70))
      })
    const select = (end: number) => {
      native = doc.createRange()
      native.setStart(doc.querySelector('p')!.firstChild!, 0)
      native.setEnd(native.endContainer, end)
      selection.removeAllRanges()
      selection.addRange(native)
      act(() => options.onSelection?.(engine.serializeCurrentSelection()))
    }
    try {
      await act(async () => options.onDocumentLoad?.(doc, 1))
      fireEvent.pointerDown(doc, {
        pointerId: 71,
        pointerType: 'touch',
        clientX: 20,
        clientY: 30
      })
      fireEvent.touchStart(doc, {
        touches: [{ identifier: 71 }],
        changedTouches: [{ identifier: 71 }]
      })
      if (scenario !== 'late-selection') select(5)
      await settle()
      expect(engine.setSelectionRange).not.toHaveBeenCalled()
      expect(Boolean(mocks.controls?.range && mocks.controls.showHandles)).toBe(
        false
      )
      if (scenario !== 'late-selection')
        expect(selection.toString()).toBe('Alpha')
      fireEvent.pointerUp(doc, {
        pointerId: 71,
        pointerType: 'touch',
        clientX: 60,
        clientY: 30
      })
      // Pointerup alone must not clear a still active native touch.
      await settle()
      expect(engine.setSelectionRange).not.toHaveBeenCalled()
      fireEvent.touchEnd(doc, {
        touches: [],
        changedTouches: [{ identifier: 71, clientX: 60, clientY: 30 }]
      })
      if (scenario === 'late-selection') select(10)
      await settle()
      expect(mocks.controls?.showHandles).toBe(false)
      expect(engine.setSelectionRange).not.toHaveBeenCalled()
      if (scenario === 'late-during-extraction') {
        select(10)
        await settle()
      }
      if (scenario === 'cancel') act(() => ref.current?.clear())
      if (scenario === 'unload') act(() => options.onDocumentUnload?.(doc))
      resolveExtraction({
        texts: [
          IntermediateText.parse({
            id: 'native-text',
            content: 'Alpha beta gamma',
            fontSize: 16,
            fontFamily: 'sans-serif',
            fontWeight: 400,
            italic: false,
            color: '#000000',
            polygon: [
              [0, 0],
              [100, 0],
              [100, 20],
              [0, 20]
            ],
            lineHeight: 20,
            ascent: 16,
            descent: 4,
            dir: TextDir.LTR,
            skew: 0,
            isEOL: false
          })
        ],
        segments: []
      })
      await settle()
      if (scenario === 'cancel' || scenario === 'unload') {
        expect(engine.setSelectionRange).not.toHaveBeenCalled()
        expect(mocks.controls?.range).toBeNull()
        expect(onTextEnd).not.toHaveBeenCalled()
      } else {
        const expected =
          scenario === 'late-selection' || scenario === 'late-during-extraction'
            ? 'Alpha beta'
            : 'Alpha'
        expect(callbacks).toEqual([
          `native:${scenario === 'late-during-extraction' ? 'Alpha' : expected}`,
          `text:${expected}`,
          `segments:${expected}`
        ])
        expect(engine.setSelectionRange).toHaveBeenCalledOnce()
        expect(managed!.toString()).toBe(expected)
        expect(selection.rangeCount).toBe(0)
        await waitFor(() => expect(mocks.controls?.showHandles).toBe(true))
        expect(mocks.controls?.range?.toString()).toBe(expected)
        act(() => {
          ref.current?.confirm()
          ref.current?.confirm()
        })
        expect(onSelect).toHaveBeenCalledOnce()
        expect(onSelect.mock.calls[0][0].text).toBe(expected)
      }
    } finally {
      view.unmount()
      extract.mockRestore()
      iframe.remove()
    }
  }
)
