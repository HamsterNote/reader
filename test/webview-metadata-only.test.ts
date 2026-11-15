import { fireEvent, screen, waitFor } from '@testing-library/react'
import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WebBridgeOptions } from '../webview/src/bridgeClient'

const boot = vi.hoisted(() => ({
  bridge: null as WebBridgeOptions | null,
  render: vi.fn<(node: ReactNode) => void>(),
  open: vi.fn(),
  metadata: vi.fn(),
  dispose: vi.fn(),
  terminate: vi.fn(),
  failure: vi.fn(),
  sendChange: vi.fn()
}))

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: boot.render })
}))
vi.mock('react-dom', () => ({
  flushSync: (callback: () => void) => callback()
}))
vi.mock('../webview/src/nativePdf', () => ({ startNativePdfSurface: vi.fn() }))
vi.mock('../webview/src/ReaderSurface', () => ({ ReaderSurface: vi.fn() }))
vi.mock('../webview/src/packagedAsset', () => ({
  readPackagedAsset: async () => new ArrayBuffer(8)
}))
vi.mock('../webview/src/pdfWorker', () => ({
  createPdfWorkerFromAsset: async () => ({ terminate: boot.terminate })
}))
vi.mock('../webview/src/hostMessageChannel', () => ({
  listenHostMessages: vi.fn()
}))
vi.mock('../webview/src/bridgeClient', () => ({
  createWebBridgeClient: (options: WebBridgeOptions) => {
    boot.bridge = options
    return {
      start: vi.fn(),
      sendChange: boot.sendChange,
      reportEngineFailure: boot.failure,
      handleMessage: vi.fn(),
      flushPending: async () => true
    }
  }
}))
vi.mock('../src/pdf/pdfDocumentSession', () => ({
  PdfDocumentSession: { open: boot.open }
}))
vi.mock('../src/pdf/pdfTextModeDocument', () => ({
  createPdfTextModeDocument: boot.metadata
}))
vi.mock('../src/pdf/pdfjsRuntime', () => ({
  GlobalWorkerOptions: { workerPort: null },
  configurePdfJsWorker: vi.fn()
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = '<main id="reader"></main>'
  vi.stubGlobal('__READER_HOST__', {
    sessionId: 'diagnostic-session',
    sourceToken: 'test-token'
  })
  vi.stubGlobal('__READER_NATIVE_PDF__', undefined)
  vi.stubGlobal('ReactNativeWebView', { postMessage: vi.fn() })
  vi.stubGlobal('__READER_PDF_METADATA_EXPERIMENT__', {
    enabled: true,
    metadataOnly: true,
    batchSize: 0
  })
  vi.stubGlobal('__READER_PDF_METADATA_EXPERIMENT_ENABLED__', true)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  boot.open.mockResolvedValue({
    document: { numPages: 294 },
    dispose: boot.dispose
  })
  boot.dispose.mockResolvedValue(undefined)
  boot.metadata.mockResolvedValue({ document: { id: 'metadata-document' } })
})

afterEach(async () => {
  boot.bridge?.onDispose?.()
  for (let index = 0; index < 10; index++) await Promise.resolve()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function open() {
  await import('../webview/src/main')
  boot.bridge!.onOpen!({
    document: { fileId: 'diagnostic-file', format: 'pdf', fileUrl: 'book.pdf' }
  })
  boot.bridge!.onRestore!({ data: null, progress: null, revision: 0 })
}

function expectNoReaderTree() {
  expect(boot.render.mock.calls.filter(([node]) => node !== null)).toEqual([])
  expect(boot.open).toHaveBeenCalledTimes(1)
  expect(boot.sendChange).not.toHaveBeenCalled()
}

it('holds the actual display pipeline at both checkpoints without a reading tree or second session', async () => {
  await open()
  await screen.findByText('开始元数据')
  expect(boot.metadata).not.toHaveBeenCalled()
  expect(boot.dispose).not.toHaveBeenCalled()
  expectNoReaderTree()
  fireEvent.click(screen.getByText('开始元数据'))
  await screen.findByText('结束实验并释放')
  expect(boot.metadata).toHaveBeenCalledTimes(1)
  // Batch 0 keeps the existing two-argument metadata call.
  expect(boot.metadata.mock.calls[0]).toHaveLength(2)
  expect(boot.dispose).not.toHaveBeenCalled()
  expect(boot.terminate).not.toHaveBeenCalled()
  expectNoReaderTree()
  fireEvent.click(screen.getByText('结束实验并释放'))
  await waitFor(() => expect(boot.dispose).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(boot.terminate).toHaveBeenCalledTimes(1))
  expect(boot.open).toHaveBeenCalledTimes(1)
  expect(boot.failure).not.toHaveBeenCalled()
  expect(
    boot.render.mock.calls.filter(
      ([node]) => isValidElement(node) && typeof node.type !== 'string'
    )
  ).toEqual([])
})

it.each(['open', 'complete'] as const)(
  'unblocks close/quiesce while paused after %s',
  async (checkpoint) => {
    await open()
    await screen.findByText('开始元数据')
    if (checkpoint === 'complete') {
      fireEvent.click(screen.getByText('开始元数据'))
      await screen.findByText('结束实验并释放')
    }
    boot.bridge!.onDrainingChange!(true)
    await boot.bridge!.onQuiesce!(vi.fn())
    expect(screen.queryByRole('region')).toBeNull()
    expect(boot.dispose).toHaveBeenCalledTimes(1)
    expect(boot.terminate).toHaveBeenCalledTimes(1)
    expect(boot.failure).not.toHaveBeenCalled()
    expect(boot.open).toHaveBeenCalledTimes(1)
    expect(boot.sendChange).not.toHaveBeenCalled()
  }
)

it('also cancels a queued experiment when closing begins before the file read starts', async () => {
  await open()
  boot.bridge!.onDrainingChange!(true)
  await boot.bridge!.onQuiesce!(vi.fn())
  expect(screen.queryByRole('region')).toBeNull()
  expect(boot.metadata).not.toHaveBeenCalled()
  expect(boot.failure).not.toHaveBeenCalled()
})

it('cancels the old pause before processing a replacement restore', async () => {
  await open()
  await screen.findByText('开始元数据')
  boot.bridge!.onRestore!({ data: null, progress: null, revision: 0 })
  await waitFor(() => expect(boot.open).toHaveBeenCalledTimes(2))
  await screen.findByText('开始元数据')
  expect(boot.dispose).toHaveBeenCalledTimes(1)
  expect(boot.dispose.mock.invocationCallOrder[0]).toBeLessThan(
    boot.open.mock.invocationCallOrder[1]!
  )
  expect(boot.metadata).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('取消实验'))
  await waitFor(() => expect(boot.dispose).toHaveBeenCalledTimes(2))
  expect(boot.failure).not.toHaveBeenCalled()
})

it('releases the single session and reports a metadata failure without leaving a gate', async () => {
  boot.metadata.mockRejectedValueOnce(new Error('metadata failed'))
  await open()
  await screen.findByText('开始元数据')
  fireEvent.click(screen.getByText('开始元数据'))
  await waitFor(() =>
    expect(boot.failure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'metadata failed' })
    )
  )
  expect(boot.dispose).toHaveBeenCalledTimes(1)
  expect(boot.terminate).toHaveBeenCalledTimes(1)
  expect(boot.open).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('region')).toBeNull()
  expect(boot.sendChange).not.toHaveBeenCalled()
})

it('leaves the ordinary build on the original route with no pause controls', async () => {
  vi.stubGlobal('__READER_PDF_METADATA_EXPERIMENT_ENABLED__', false)
  vi.stubGlobal('__READER_PDF_METADATA_EXPERIMENT__', {
    enabled: false,
    metadataOnly: false,
    batchSize: 0
  })
  await open()
  await waitFor(() =>
    expect(
      boot.render.mock.calls.some(
        ([node]) => isValidElement(node) && typeof node.type !== 'string'
      )
    ).toBe(true)
  )
  expect(screen.queryByRole('region')).toBeNull()
  expect(boot.metadata.mock.calls[0]).toHaveLength(2)
  expect(boot.open.mock.calls[0]?.[1]).toEqual({
    documentOptions: expect.any(Object)
  })
  expect(boot.failure).not.toHaveBeenCalled()
})
