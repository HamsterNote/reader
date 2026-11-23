import { act, fireEvent, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startNativePdfSurface } from '../../webview/src/nativePdf'
import type { BridgeHostSnapshot } from '../../src/bridge/hostSession'
import { restoreReaderSnapshot } from '../../src/host/readerSnapshot'
import { mergeNativeExternalData } from '../../src/nativePdf/pageEdit'
import type {
  PdfCanonicalPage,
  PdfIdentity
} from '../../src/nativePdf/contracts'
import { nativeCanonicalPageFromOcr } from '../../src/nativePdf/ocr'
import type { ReaderSelectionRange } from '../../src/types/selection'

const pdf = vi.hoisted(() => ({ terminate: vi.fn() }))
vi.mock('../../src/pdf/pdfDocumentSession', () => ({
  PdfDocumentSession: {
    open: async () => ({
      document: { numPages: 1, getOutline: async () => null },
      dispose: async () => undefined
    })
  }
}))
vi.mock('../../webview/src/pdfWorker', () => ({
  createPdfWorkerFromAsset: async () => ({ terminate: pdf.terminate })
}))
vi.mock('../../webview/src/packagedAsset', () => ({
  readPackagedAsset: async () => new ArrayBuffer(1)
}))
vi.mock('../../webview/src/pdfAssets', () => ({ packagedPdfOptions: {} }))
vi.mock('../../src/pdf/pdfjsRuntime', () => ({ GlobalWorkerOptions: {} }))
vi.mock('../../src/nativePdf/textGeometry', () => ({
  NativeCanonicalCache: class {
    pages = new Map<number, PdfCanonicalPage>()
    retain() {}
    async get(pageNumber: number) {
      const existing = this.pages.get(pageNumber)
      if (existing) return existing
      const text = 'OCR QA SAMPLE'
      const page = {
        pageNumber,
        text,
        width: 400,
        height: 500,
        boundaries: Array.from({ length: text.length + 1 }, (_, offset) => ({
          offset,
          textId: `text-${pageNumber}`,
          rect: { x: offset * 10, y: 50, width: 10, height: 20 }
        })),
        glyphs: [
          {
            start: 0,
            end: text.length,
            text,
            rect: { x: 0, y: 50, width: 130, height: 20 }
          }
        ]
      }
      this.pages.set(pageNumber, page)
      return page
    }
    dispose() {
      this.pages.clear()
    }
  }
}))
vi.mock('../../demo/CommentPanel', () => ({ CommentPanel: () => null }))
vi.mock('../../src/components/PopoverPortal', () => ({
  PopoverPortal: ({
    visible,
    children
  }: {
    visible: boolean
    children: ReactNode
  }) => (visible ? <div>{children}</div> : null)
}))

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
  rectsBySelectionId: {
    'page-1': [{ x: 40, y: 50, width: 320, height: 50 }]
  }
} as ReaderSelectionRange

type StoredFile = { snapshot: BridgeHostSnapshot }
type Message = Record<string, unknown> & {
  type: string
  fileId?: string
  data?: unknown
}
const files = new Map<string, StoredFile>()
let activeIdentity: PdfIdentity | undefined
let session = 0

function seed(fileId: string, color: string) {
  files.set(fileId, {
    snapshot: {
      revision: 0,
      progress: null,
      data: {
        annotations: {
          version: 5,
          ranges: [
            {
              ...range,
              markerStyle: { ...range.markerStyle, backgroundColor: color }
            }
          ],
          rects: [],
          paintings: {}
        }
      }
    }
  })
}

function receive(body: Record<string, unknown>) {
  if (!activeIdentity) throw new Error('no active file')
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ ...body, identity: activeIdentity })
    })
  )
}

async function send(body: Record<string, unknown>) {
  await act(async () => receive(body))
}

async function mountFile(fileId: string, activate = true) {
  const file = files.get(fileId)!
  activeIdentity = {
    fileId,
    paneId: 'development',
    sessionId: `${fileId}-${++session}`,
    generation: 1
  }
  document.body.innerHTML = '<div id="reader"></div>'
  await act(async () => {
    startNativePdfSurface({
      ...activeIdentity!,
      publicationUrl: `file:///${fileId}.pdf`,
      canEdit: true,
      progress: file.snapshot.progress,
      snapshot: file.snapshot.data
    })
  })
  await act(async () => {})
  if (!activate) return
  await send({ type: 'ocrText', canonicalPage: canonical })
  await send({ type: 'activate', rangeId: 'saved' })
  await act(async () => {})
  await send({
    type: 'nativeSelection',
    event: {
      ...activeIdentity,
      type: 'selection',
      phase: 'end',
      rangeId: 'saved',
      start: range.start,
      end: range.end,
      anchor: { x: 40, y: 50, width: 320, height: 50 },
      geometryRevision: 1
    }
  })
  expect(screen.getByRole('button', { name: '删除' })).toBeVisible()
}

async function closeFile() {
  if (!activeIdentity) return
  await send({ type: 'dispose' })
  activeIdentity = undefined
  document.body.innerHTML = ''
}

async function choose(color: string) {
  const swatch = screen.getByRole('button', {
    name: `Highlight color ${color}`
  })
  await act(async () => {
    fireEvent.mouseDown(swatch)
    fireEvent.click(swatch)
  })
}

function restored(fileId: string) {
  return restoreReaderSnapshot(files.get(fileId)!.snapshot.data)
}

beforeEach(() => {
  files.clear()
  activeIdentity = undefined
  session = 0
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  window.ReactNativeWebView = {
    postMessage: (raw: string) => {
      const message = JSON.parse(raw) as Message
      if (message.type !== 'snapshot' || !message.fileId) return
      const file = files.get(message.fileId)!
      file.snapshot = {
        ...file.snapshot,
        data: mergeNativeExternalData(file.snapshot.data, message.data),
        revision: file.snapshot.revision + 1
      }
    }
  }
})

afterEach(async () => {
  await closeFile()
  delete window.ReactNativeWebView
  vi.restoreAllMocks()
})

describe('native PDF color editing persistence', () => {
  it('reopens with the new color and a higher revision, then deletes to zero ranges', async () => {
    seed('color-reopen', '#ffc107')
    await mountFile('color-reopen')
    await choose('#8eba8e')

    expect(files.get('color-reopen')!.snapshot.revision).toBe(1)
    expect(restored('color-reopen').data.ranges?.[0]).toMatchObject({
      markerStyle: { backgroundColor: '#8eba8e' }
    })
    await closeFile()

    await mountFile('color-reopen')
    expect(
      screen.getByRole('button', { name: 'Highlight color #8eba8e' })
    ).toHaveAttribute('aria-pressed', 'true')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除' }))
    })
    expect(files.get('color-reopen')!.snapshot.revision).toBe(2)
    expect(restored('color-reopen').data.ranges).toEqual([])
    await closeFile()

    await mountFile('color-reopen', false)
    expect(restored('color-reopen').data.ranges).toEqual([])
    expect(files.get('color-reopen')!.snapshot.revision).toBe(2)
  })

  it('edits correctly after two A/B round trips without changing B', async () => {
    seed('file-A', '#ffc107')
    seed('file-B', '#a99fc4')

    await mountFile('file-A')
    await choose('#cf9cab')
    expect(files.get('file-A')!.snapshot.revision).toBe(1)
    await closeFile()
    await mountFile('file-B')
    await closeFile()
    await mountFile('file-A')
    await closeFile()
    await mountFile('file-B')
    await closeFile()

    await mountFile('file-A')
    await choose('#8eba8e')
    expect(files.get('file-A')!.snapshot.revision).toBe(2)
    expect(restored('file-A').data.ranges?.[0]).toMatchObject({
      markerStyle: { backgroundColor: '#8eba8e' }
    })
    expect(files.get('file-B')!.snapshot.revision).toBe(0)
    expect(restored('file-B').data.ranges?.[0]).toMatchObject({
      markerStyle: { backgroundColor: '#a99fc4' }
    })
    await closeFile()

    await mountFile('file-A')
    expect(
      screen.getByRole('button', { name: 'Highlight color #8eba8e' })
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
