import { beforeEach, expect, test, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  page: vi.fn(),
  render: vi.fn(),
  destroy: vi.fn(async () => undefined)
}))
vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 80, getPage: mock.page }),
    destroy: mock.destroy
  }),
  PDFWorker: { create: () => ({ destroy: vi.fn() }) },
  TextLayer: class {
    render = async () => undefined
    cancel = vi.fn()
  }
}))
import { createPdfDomSession } from '../src/pdf/pdfDom'

beforeEach(() => {
  vi.stubGlobal(
    'Worker',
    class extends EventTarget {
      terminate = vi.fn()
    }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,AA=='
  )
  mock.render
    .mockReset()
    .mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  mock.page.mockReset().mockImplementation(async () => ({
    rotate: 0,
    cleanup: vi.fn(),
    getViewport: ({ scale }: { scale: number }) => ({
      width: 400 * scale,
      height: 520 * scale,
      rotation: 0
    }),
    getTextContent: async () => ({}),
    render: mock.render
  }))
})

const open = async () => {
  const viewport = document.createElement('div')
  document.body.append(viewport)
  const events = {
    onStateChange: vi.fn(),
    onMetadata: vi.fn(),
    onPageChange: vi.fn(),
    onSelectionChange: vi.fn()
  }
  const session = createPdfDomSession({
    viewport,
    coordinateRoot: viewport,
    bytes: new Uint8Array([1]),
    identity: { sessionId: 'lifecycle', generation: 1 },
    events,
    assetBaseUrl: `${location.origin}/pdf-runtime/`
  })
  await vi.waitFor(() => expect(events.onMetadata).toHaveBeenCalled())
  return { session, events, viewport }
}

test('thumbnail failures remain local and out-of-range requests do not access pages', async () => {
  const { session, events, viewport } = await open()
  const before = mock.page.mock.calls.length
  expect(await session.getThumbnail(0)).toBeNull()
  expect(await session.getThumbnail(81)).toBeNull()
  expect(mock.page.mock.calls).toHaveLength(before)
  mock.page.mockRejectedValueOnce(new Error('thumbnail unavailable'))
  expect(await session.getThumbnail(40)).toBeNull()
  expect(
    events.onStateChange.mock.calls.some(([state]) => state.status === 'error')
  ).toBe(false)
  expect(await session.getThumbnail(41)).toMatchObject({
    pageNumber: 41,
    generation: 1
  })
  session.dispose()
  viewport.remove()
})

test('disposing settles active and queued thumbnails, and late render results cannot repopulate', async () => {
  const { session, events, viewport } = await open()
  let finish!: () => void
  const promise = new Promise<void>((resolve) => {
    finish = resolve
  })
  mock.render.mockImplementation(() => ({ promise, cancel: vi.fn() }))
  const thumbnails = [40, 41, 42, 43].map((number) =>
    session.getThumbnail(number)
  )
  await vi.waitFor(() =>
    expect(mock.render.mock.calls.length).toBeGreaterThanOrEqual(2)
  )
  session.dispose()
  session.dispose()
  const count = events.onPageChange.mock.calls.length
  expect(await Promise.all(thumbnails)).toEqual([null, null, null, null])
  finish()
  await Promise.resolve()
  expect(await session.getThumbnail(40)).toBeNull()
  expect(await session.goToPage(1)).toBe(false)
  expect(events.onPageChange).toHaveBeenCalledTimes(count)
  expect(viewport.childElementCount).toBe(0)
  viewport.remove()
})
