import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import type { IntermediateDocumentViewerProps } from '../src/components/IntermediateDocumentViewer'
import type { ReaderBookmark } from '../src/types/readerData'
import { Reader } from '../src'
import { mockPaintingCanvas } from './fixtures/painting'
import { beforeEach } from 'vitest'
beforeEach(mockPaintingCanvas)

const state = vi.hoisted(() => ({
  props: null as IntermediateDocumentViewerProps | null,
  handoff: undefined as ReaderBookmark | undefined
}))
// Exercise Reader orchestration synchronously; lazy-module loading is not under test.
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    lazy: (load: () => Promise<unknown>) =>
      load.toString().includes('EngineDocumentViewer')
        ? (props: IntermediateDocumentViewerProps) => {
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
                  captureModeSwitchPosition: () => state.handoff
                })
              return () => {
                if (typeof ref === 'function') ref(null)
              }
            }, [props.readingPositionRef])
            return null
          }
        : react.lazy(load as Parameters<typeof react.lazy>[0])
  }
})
vi.mock(
  '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer',
  () => ({
    IntermediateDocumentTextViewer: () => null
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
