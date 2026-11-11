import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import type {
  IntermediateDocumentViewerProps,
  ReaderReadingPositionHandle
} from '../src/components/IntermediateDocumentViewer'
import type { ReaderBookmark } from '../src/types/readerData'
import { Reader } from '../src'
import { useImperativeHandle } from 'react'
import { mockPaintingCanvas } from './fixtures/painting'
import { beforeEach } from 'vitest'
beforeEach(() => {
  mockPaintingCanvas()
  state.failure = false
})

const state = vi.hoisted(() => ({
  props: null as IntermediateDocumentViewerProps | null,
  textProps: null as IntermediateDocumentViewerProps | null,
  failure: false,
  handoff: undefined as ReaderBookmark | undefined
}))

function captureHandoffResult(): ReturnType<
  NonNullable<ReaderReadingPositionHandle['captureModeSwitchResult']>
> {
  if (state.failure) return { status: 'failed' }
  if (state.handoff) return { status: 'ready', position: state.handoff }
  return { status: 'pending' }
}

// Exercise Reader orchestration synchronously; lazy-module loading is not under test.
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  function LayoutViewerMock(props: IntermediateDocumentViewerProps) {
    state.props = props
    react.useEffect(() => {
      const ref = props.readingPositionRef
      if (typeof ref === 'function')
        ref({
          captureTextAnchor: () => undefined,
          captureReadingPosition: () => ({
            pageNumber: 1,
            verticalPercentage: 35
          }),
          captureModeSwitchPosition: () => state.handoff,
          captureModeSwitchResult: captureHandoffResult
        })
      return () => {
        if (typeof ref === 'function') ref(null)
      }
    }, [props.readingPositionRef])
    return <div data-testid='pdf-layout-source' />
  }
  return {
    ...react,
    lazy: (load: () => Promise<unknown>) =>
      load.toString().includes('EngineDocumentViewer')
        ? LayoutViewerMock
        : react.lazy(load as Parameters<typeof react.lazy>[0])
  }
})
vi.mock(
  '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer',
  () => ({
    IntermediateDocumentTextViewer: (
      props: IntermediateDocumentViewerProps
    ) => {
      state.textProps = props
      useImperativeHandle(props.readingPositionRef, () => ({
        captureTextAnchor: () => undefined,
        captureReadingPosition: () => state.handoff,
        captureModeSwitchResult: captureHandoffResult
      }))
      return <div data-testid='pdf-text-target' />
    }
  })
)
const document: IntermediateDocumentSerialized = {
  id: 'pdf-handoff',
  title: 'PDF',
  pages: [{ id: 'page-1', number: 1, width: 600, height: 1000, content: [] }]
}
const source = { format: 'pdf' as const, data: new Uint8Array([1]) }
const anchor = (offset: number) => ({
  pageNumber: 1,
  textId: 'line',
  offset,
  text: 'safe line'
})

it('hands off A over saved 35% and stale target progress, then returns using the current Text line B', async () => {
  state.handoff = anchor(48)
  const changed = vi.fn()
  await act(async () => {
    render(
      <Reader
        document={document}
        engineSource={source}
        useVirtualPaper={false}
        data={{
          layoutReadingProgress: { pageNumber: 1, verticalPercentage: 35 },
          textReadingProgress: { currentPageNumber: 1, anchor: anchor(3) }
        }}
        onDataChange={changed}
      />
    )
  })
  fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({
      renderMode: 'text',
      textReadingProgress: { currentPageNumber: 1, anchor: anchor(48) }
    })
  )
  const ref = state.props!.readingPositionRef
  act(() => {
    if (typeof ref === 'function')
      ref({
        captureTextAnchor: () => anchor(72),
        captureReadingPosition: () => anchor(72)
      })
  })
  fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({
      renderMode: 'layout',
      layoutReadingProgress: anchor(72)
    })
  )
})

it('keeps the source mode when text is pending or failed despite ready geometry', async () => {
  state.handoff = undefined
  const changed = vi.fn()
  await act(async () => {
    render(
      <Reader
        document={document}
        engineSource={source}
        useVirtualPaper={false}
        data={{
          layoutReadingProgress: { pageNumber: 1, verticalPercentage: 35 }
        }}
        onDataChange={changed}
      />
    )
  })
  fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
  expect(changed).not.toHaveBeenCalled()
})

it('hands off a confirmed text-free 60% position', async () => {
  state.handoff = { pageNumber: 1, verticalPercentage: 60 }
  const changed = vi.fn()
  await act(async () => {
    render(
      <Reader
        document={document}
        engineSource={source}
        useVirtualPaper={false}
        onDataChange={changed}
      />
    )
  })
  fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({
      renderMode: 'text',
      textReadingProgress: { currentPageNumber: 1, verticalPercentage: 60 }
    })
  )
})

for (const entrance of ['prop', 'data'] as const) {
  for (const sourceMode of ['layout', 'text'] as const) {
    for (const status of ['pending', 'failed'] as const) {
      it(`${entrance} ${sourceMode} keeps its mounted source on ${status}, then hands off current text`, async () => {
        state.handoff = undefined
        state.failure = status === 'failed'
        const targetMode = sourceMode === 'layout' ? 'text' : 'layout'
        const changed = vi.fn()
        const props = (mode: 'layout' | 'text') => ({
          document,
          engineSource: source,
          renderMode: entrance === 'prop' ? mode : undefined,
          data: {
            renderMode: entrance === 'data' ? mode : undefined,
            layoutReadingProgress: { pageNumber: 1, verticalPercentage: 35 },
            textReadingProgress: { currentPageNumber: 1, anchor: anchor(3) }
          },
          onDataChange: changed
        })
        const view = render(<Reader {...props(sourceMode)} />)
        await act(async () => {})
        const sourceId =
          sourceMode === 'layout' ? 'pdf-layout-source' : 'pdf-text-target'
        const targetId =
          sourceMode === 'layout' ? 'pdf-text-target' : 'pdf-layout-source'
        view.rerender(<Reader {...props(targetMode)} />)
        expect(screen.queryByTestId(sourceId)).not.toBeNull()
        expect(screen.queryByTestId(targetId)).toBeNull()
        expect(changed).not.toHaveBeenCalled()
        if (status === 'failed')
          expect(screen.getByRole('status').textContent).toContain('重试')
        state.handoff = anchor(72)
        state.failure = false
        if (status === 'failed')
          fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
        await act(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          )
        })
        expect(screen.queryByTestId(targetId)).not.toBeNull()
        expect(screen.queryByTestId(sourceId)).toBeNull()
        expect(changed).toHaveBeenLastCalledWith(
          expect.objectContaining(
            targetMode === 'text'
              ? {
                  renderMode: 'text',
                  textReadingProgress: {
                    currentPageNumber: 1,
                    anchor: anchor(72)
                  }
                }
              : { renderMode: 'layout', layoutReadingProgress: anchor(72) }
          )
        )
      })
    }
  }
}

it('cancels a pending external request when the owner returns to the source mode', async () => {
  state.handoff = undefined
  const changed = vi.fn()
  const props = { document, engineSource: source, onDataChange: changed }
  const view = render(<Reader {...props} renderMode='layout' />)
  await act(async () => {})
  view.rerender(<Reader {...props} renderMode='text' />)
  expect(screen.queryByTestId('pdf-layout-source')).not.toBeNull()
  view.rerender(<Reader {...props} renderMode='layout' />)
  state.handoff = anchor(72)
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  expect(screen.queryByTestId('pdf-layout-source')).not.toBeNull()
  expect(changed).not.toHaveBeenCalled()
})

it('does not apply a pending toolbar switch to a replacement PDF source', async () => {
  state.handoff = undefined
  const changed = vi.fn()
  const view = render(
    <Reader document={document} engineSource={source} onDataChange={changed} />
  )
  await act(async () => {})
  fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
  view.rerender(
    <Reader
      document={document}
      engineSource={{ ...source, data: new Uint8Array([2]) }}
      onDataChange={changed}
    />
  )
  state.handoff = anchor(72)
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  expect(screen.queryByTestId('pdf-layout-source')).not.toBeNull()
  expect(changed).not.toHaveBeenCalled()
})

it('keeps a controlled toolbar source mounted until its owner accepts the request', async () => {
  state.handoff = anchor(48)
  const changed = vi.fn()
  const props = { document, engineSource: source, onDataChange: changed }
  const view = render(<Reader {...props} renderMode='layout' />)
  await act(async () => {})
  fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
  expect(changed).toHaveBeenCalledWith(
    expect.objectContaining({ renderMode: 'text' })
  )
  expect(screen.queryByTestId('pdf-layout-source')).not.toBeNull()
  expect(screen.queryByTestId('pdf-text-target')).toBeNull()
  view.rerender(<Reader {...props} renderMode='text' />)
  expect(screen.queryByTestId('pdf-text-target')).not.toBeNull()
})

it('cancels a pending PDF request when the same Reader changes to a non-PDF document', async () => {
  state.handoff = undefined
  const changed = vi.fn()
  const view = render(
    <Reader document={document} engineSource={source} onDataChange={changed} />
  )
  await act(async () => {})
  fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
  const replacement = { ...document, id: 'replacement-text' }
  view.rerender(<Reader document={replacement} onDataChange={changed} />)
  state.handoff = anchor(72)
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  expect(changed).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
})
