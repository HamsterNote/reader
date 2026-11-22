import type {
  PDFDataRangeTransport,
  PDFDocumentLoadingTask,
  PDFWorker
} from 'pdfjs-dist'

// PDF.js 5.4.530 never acknowledges Terminate while a worker task waits for a
// missing range. These are the document-local operations waiting on that worker.
type Capability = { resolve(): void }
type DocumentMessages = {
  streamControllers: Record<
    string,
    {
      isClosed: boolean
      controller: ReadableStreamDefaultController
      startCall: Capability
      pullCall?: Capability
      cancelCall?: Capability
    }
  >
  callbackCapabilities: Record<string, { reject(reason: unknown): void }>
  sendWithPromise(action: string): Promise<unknown>
  sendWithStream(): ReadableStream
}
type WorkerTransport = {
  messageHandler: DocumentMessages
  downloadInfoCapability: {
    promise: Promise<unknown>
    reject(reason: unknown): void
  }
}

function disconnect(messages: DocumentMessages, reason: unknown) {
  for (const stream of Object.values(messages.streamControllers)) {
    stream.isClosed = true
    stream.controller.error(reason)
    stream.startCall.resolve()
    stream.pullCall?.resolve()
    stream.cancelCall?.resolve()
  }
  for (const request of Object.values(messages.callbackCapabilities))
    request.reject(reason)
  // The worker has exited. PDF.js can still run its normal local teardown,
  // including page destruction and networkStream.cancelAllRequests().
  messages.sendWithPromise = (action) =>
    action === 'Terminate' ? Promise.resolve() : Promise.reject(reason)
  messages.sendWithStream = () =>
    new ReadableStream({ start: (controller) => controller.error(reason) })
}

export function stopPdfRange(
  range: PDFDataRangeTransport,
  task: PDFDocumentLoadingTask | undefined,
  worker: PDFWorker | undefined,
  reason: unknown
) {
  const transport: WorkerTransport | undefined =
    task && Reflect.get(task, '_transport')
  if (worker) {
    const port = worker.port
    worker.promise.catch(() => {})
    worker.destroy()
    // PDFWorker.destroy terminates the real Worker. Disconnect the listeners
    // on PDF.js's in-process LoopbackPort when it uses its fallback instead.
    if (port && (typeof Worker === 'undefined' || !(port instanceof Worker)))
      port.terminate()
    if (transport) {
      disconnect(transport.messageHandler, reason)
      transport.downloadInfoCapability.promise.catch(() => {})
      transport.downloadInfoCapability.reject(reason)
    }
  }
  // Before PDF.js installs WorkerTransport, task.destroy() cannot reach range.
  if (!transport) range.abort()
}
