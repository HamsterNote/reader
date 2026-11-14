import { act, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startNativePdfSurface } from '../../webview/src/nativePdf'
import { NativeCanonicalDelivery } from '../../src/nativePdf/canonicalDelivery'
import { nativeCanonicalPageFromOcr } from '../../src/nativePdf/ocr'
import type {
  PdfCanonicalPage,
  PdfIdentity
} from '../../src/nativePdf/contracts'

const pdf = vi.hoisted(() => ({ open: vi.fn(), terminate: vi.fn() }))
vi.mock('../../src/pdf/pdfDocumentSession', () => ({
  PdfDocumentSession: { open: pdf.open }
}))
vi.mock('../../webview/src/pdfWorker', () => ({
  createPdfWorkerFromAsset: async () => ({ terminate: pdf.terminate })
}))
vi.mock('../../webview/src/packagedAsset', () => ({
  readPackagedAsset: async () => new ArrayBuffer(1)
}))
vi.mock('../../webview/src/pdfAssets', () => ({ packagedPdfOptions: {} }))
vi.mock('../../src/pdf/pdfjsRuntime', () => ({ GlobalWorkerOptions: {} }))
// Only the PDF text extractor and UI rendering are replaced. The receiver,
// pending queue, canonical delivery, session guards and materializer are real.
vi.mock('../../src/nativePdf/textGeometry', () => ({
  NativeCanonicalCache: class {
    pages = new Map<number, PdfCanonicalPage>()
    retain(numbers: number[]) {
      for (const n of this.pages.keys())
        if (!numbers.includes(n)) this.pages.delete(n)
    }
    async get(pageNumber: number) {
      if (!this.pages.has(pageNumber))
        this.pages.set(pageNumber, {
          pageNumber,
          text: '',
          width: 400,
          height: 500,
          boundaries: [],
          glyphs: []
        })
      return this.pages.get(pageNumber)!
    }
    dispose() {
      this.pages.clear()
    }
  }
}))
vi.mock('../../demo/CommentPanel', () => ({ CommentPanel: () => null }))
vi.mock('../../src/components/DefaultPopover', () => ({
  DefaultSelectionPopover: () => <button>highlight</button>,
  DefaultHighlightPopover: () => <button>edit highlight</button>
}))
vi.mock('../../src/components/PopoverPortal', () => ({
  PopoverPortal: ({
    visible,
    children
  }: {
    visible: boolean
    children: ReactNode
  }) => (visible ? <div>{children}</div> : null)
}))

const identity: PdfIdentity = {
  fileId: 'scan',
  paneId: 'left',
  sessionId: 'scan-session',
  generation: 1
}
const canonical = nativeCanonicalPageFromOcr(1, 400, 500, [
  {
    id: 'ocr-1',
    content: 'OCR QA SAMPLE',
    polygon: [
      [0.1, 0.1],
      [0.9, 0.2]
    ]
  }
])!
const range = {
  id: 'saved',
  createdAt: 1,
  text: 'QA',
  start: { selectionId: 'page-1', offset: 4 },
  end: { selectionId: 'page-1', offset: 6 },
  overlayRectType: 'px',
  markerStyle: { backgroundColor: '#ffc107' },
  rectsBySelectionId: { 'page-1': [{ x: 40, y: 50, width: 320, height: 50 }] }
}
type Message = Record<string, unknown> & {
  type: string
  command?: Record<string, unknown>
}
let messages: Message[]
let onSend: (message: Message) => void
let resolveOpen: (session: unknown) => void
let activeIdentity: PdfIdentity | undefined

function receive(body: Record<string, unknown>, sender = identity) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ ...body, identity: sender })
    })
  )
}
async function start(sender = identity) {
  activeIdentity = sender
  await act(async () => {
    startNativePdfSurface({
      ...sender,
      publicationUrl: 'file:///scan.pdf',
      progress: null,
      snapshot: {
        annotations: { version: 5, ranges: [range], rects: [], paintings: {} }
      }
    })
  })
}
async function openPdf() {
  await act(async () =>
    resolveOpen({
      document: { numPages: 1, getOutline: async () => null },
      dispose: async () => undefined
    })
  )
}
async function send(body: Record<string, unknown>, sender = identity) {
  await act(async () => receive(body, sender))
}
function activations() {
  return messages.filter(
    (m) =>
      m.type === 'command' &&
      m.command?.type === 'selection' &&
      m.command?.showMenu
  )
}
function refillRequests() {
  return messages.filter((m) => m.type === 'canonical-request')
}
async function nativeSelectionEnd() {
  await send({
    type: 'nativeSelection',
    event: {
      ...identity,
      type: 'selection',
      phase: 'end',
      rangeId: 'saved',
      start: range.start,
      end: range.end,
      anchor: { x: 40, y: 50, width: 320, height: 50 },
      geometryRevision: 1
    }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  messages = []
  onSend = () => undefined
  pdf.open.mockReturnValue(
    new Promise((resolve) => {
      resolveOpen = resolve
    })
  )
  document.body.innerHTML = '<div id="reader"></div>'
  window.ReactNativeWebView = {
    postMessage: (raw: string) => {
      const message = JSON.parse(raw) as Message
      messages.push(message)
      onSend(message)
    }
  }
})
afterEach(async () => {
  if (activeIdentity) await send({ type: 'dispose' }, activeIdentity)
  activeIdentity = undefined
  delete window.ReactNativeWebView
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Web canonical receiver readiness and pending activation', () => {
  it('installs the receiver before ready, retaining early replay until the PDF service exists', async () => {
    const delivery = new NativeCanonicalDelivery(identity, (page) => {
      receive({ type: 'ocrText', canonicalPage: page })
      return true
    })
    delivery.publish(canonical)
    onSend = (message) => {
      if (message.type === 'web-ready')
        delivery.webReady(message as unknown as PdfIdentity)
    }
    await start()
    expect(messages[0]?.type).toBe('web-ready')
    expect(messages.filter((m) => m.type === 'web-ready')).toHaveLength(1)
    await send({ type: 'activate', rangeId: 'saved' })
    expect(activations()).toHaveLength(0)
    await openPdf()
    expect(activations()).toHaveLength(1)
    await nativeSelectionEnd()
    expect(screen.getByRole('button', { name: 'edit highlight' })).toBeVisible()
    expect(console.info).toHaveBeenCalledWith(
      'reader-pdf-materialize-result',
      expect.objectContaining({ id: 'saved', textLength: 2 })
    )
  })

  it('requests backfill once when activate arrives first, then materializes and replays exactly once', async () => {
    await start()
    await openPdf()
    await send({ type: 'activate', rangeId: 'saved' })
    await send({ type: 'activate', rangeId: 'saved' })
    expect(refillRequests()).toEqual([
      expect.objectContaining({ ...identity, pages: [1] })
    ])
    expect(activations()).toHaveLength(0)
    await send({ type: 'ocrText', canonicalPage: canonical })
    await send({ type: 'ocrText', canonicalPage: canonical })
    expect(activations()).toHaveLength(1)
    await nativeSelectionEnd()
    expect(screen.getByRole('button', { name: 'edit highlight' })).toBeVisible()
    await act(async () => vi.advanceTimersByTimeAsync(3001))
    expect(console.info).not.toHaveBeenCalledWith(
      'reader-pdf-activate-wait-timeout',
      expect.anything()
    )
  })

  it('does not spend the pending replay when backfill arrives before the PDF service', async () => {
    await start()
    await send({ type: 'activate', rangeId: 'saved' })
    await send({ type: 'ocrText', canonicalPage: canonical })
    expect(activations()).toHaveLength(0)
    await openPdf()
    expect(activations()).toHaveLength(1)
    expect(refillRequests()).toHaveLength(1)
    expect(messages.some((m) => m.type === 'failure')).toBe(false)
  })

  it('drops an unanswered activation after three seconds without retrying or reviving it', async () => {
    await start()
    await openPdf()
    await send({ type: 'activate', rangeId: 'saved' })
    await act(async () => vi.advanceTimersByTimeAsync(3001))
    expect(console.info).toHaveBeenCalledWith(
      'reader-pdf-activate-wait-timeout',
      { rangeId: 'saved', pages: [1] }
    )
    expect(console.info).toHaveBeenCalledWith(
      'reader-pdf-activate-pending-dropped',
      { rangeId: 'saved', pages: [1] }
    )
    await send({ type: 'ocrText', canonicalPage: canonical })
    expect(activations()).toHaveLength(0)
    expect(refillRequests()).toHaveLength(1)
  })

  it('drops a failed replay once and does not retry it on later canonical updates', async () => {
    await start()
    await openPdf()
    await send({ type: 'activate', rangeId: 'saved' })
    await send({
      type: 'ocrText',
      canonicalPage: { ...canonical, boundaries: [] }
    })
    expect(console.info).toHaveBeenCalledWith(
      'reader-pdf-activate-pending-dropped',
      {
        rangeId: 'saved',
        reason: 'replay-failed'
      }
    )
    await send({ type: 'ocrText', canonicalPage: canonical })
    expect(activations()).toHaveLength(0)
    expect(refillRequests()).toHaveLength(1)
    expect(messages.filter((m) => m.type === 'failure')).toHaveLength(1)
  })

  it('cancels pending work on dispose and rejects canonical from a different file/session', async () => {
    await start()
    await openPdf()
    await send({ type: 'activate', rangeId: 'saved' })
    await send(
      { type: 'ocrText', canonicalPage: canonical },
      { ...identity, fileId: 'other', sessionId: 'other' }
    )
    expect(activations()).toHaveLength(0)
    await send({ type: 'dispose' })
    await act(async () => vi.advanceTimersByTimeAsync(3001))
    await send({ type: 'ocrText', canonicalPage: canonical })
    expect(activations()).toHaveLength(0)
    expect(console.info).not.toHaveBeenCalledWith(
      'reader-pdf-activate-wait-timeout',
      expect.anything()
    )
  })
})
