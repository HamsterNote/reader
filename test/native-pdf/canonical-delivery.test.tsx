import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { WebViewProps } from 'react-native-webview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativePdfReader } from '../../app/src/components/NativePdfReader'
import type { ReaderPdfViewProps } from '../../app/modules/reader-pdf'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../../src/host/readerDataStore'
import type { PdfIdentity } from '../../src/nativePdf/contracts'

const host = vi.hoisted(() => ({
  web: {} as WebViewProps,
  native: {} as ReaderPdfViewProps,
  post: vi.fn(),
  sequence: 0
}))
vi.mock('react-native', () => {
  const Container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  )
  return {
    View: Container,
    Text: Container,
    ScrollView: Container,
    Pressable: Container,
    Modal: () => null,
    Image: () => null,
    Platform: { OS: 'ios' },
    Linking: { openURL: vi.fn() },
    AppState: { addEventListener: () => ({ remove: vi.fn() }) }
  }
})
vi.mock('react-native-webview', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    WebView: forwardRef(function TestWebView(props: WebViewProps, ref) {
      host.web = props
      useImperativeHandle(ref, () => ({ postMessage: host.post }), [])
      return null
    })
  }
})
vi.mock('../../app/modules/reader-pdf', () => ({
  readerPdfModule: {},
  ReaderPdfView: (props: ReaderPdfViewProps) => {
    host.native = props
    return null
  }
}))
vi.mock('expo-crypto', () => ({
  randomUUID: () => `canonical-${++host.sequence}`
}))
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' }
}))

function record(fileId: string, text = 'OCR QA SAMPLE'): HostDocumentRecord {
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    format: 'pdf',
    size: 1,
    modifiedAt: 0,
    importedAt: 0,
    cachedUri: `${fileId}.pdf`,
    snapshot: {
      revision: 0,
      progress: null,
      data: {
        readerData: {
          ocrTexts: {
            1: [
              {
                id: 'ocr-1',
                content: text,
                polygon: [
                  [0.1, 0.1],
                  [0.9, 0.2]
                ]
              }
            ],
            2: [
              {
                id: 'ocr-2',
                content: `${text} SECOND`,
                polygon: [
                  [0.1, 0.1],
                  [0.9, 0.2]
                ]
              }
            ]
          }
        }
      }
    }
  }
}
async function mount(file: HostDocumentRecord) {
  const store = {
    get: vi.fn().mockResolvedValue(file)
  } as unknown as ReaderDataStore
  const view = render(
    <NativePdfReader
      record={file}
      store={store}
      ocr
      entryUrl={`file:///${file.fileId}/index.html`}
      baseUrl={`file:///${file.fileId}/`}
      publicationUrl={`file:///${file.fileId}/publication.pdf`}
    />
  )
  await act(async () => {})
  const bootstrap = JSON.parse(
    host.web.injectedJavaScriptBeforeContentLoaded!.slice(
      'window.__READER_NATIVE_PDF__='.length,
      -';true;'.length
    )
  ) as PdfIdentity
  act(() =>
    host.native.onPdfEvent({
      nativeEvent: { ...bootstrap, type: 'loaded', pageCount: 2 }
    })
  )
  return { ...view, identity: bootstrap }
}
function geometry(identity: PdfIdentity, pageNumber = 1, width = 400) {
  act(() =>
    host.native.onPdfEvent({
      nativeEvent: {
        ...identity,
        type: 'geometry',
        geometryRevision: 1,
        pages: [
          {
            pageNumber,
            width,
            height: 500,
            rotation: 0,
            crop: {},
            pageToViewport: [1, 0, 0, 1, 0, 0],
            geometryRevision: 1
          }
        ]
      }
    })
  )
}
function message(identity: PdfIdentity, type: string, pages?: number[]) {
  act(() =>
    host.web.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({ ...identity, type, pages })
      }
    } as Parameters<NonNullable<WebViewProps['onMessage']>>[0])
  )
}
function delivered() {
  return host.post.mock.calls
    .map(([raw]) => JSON.parse(raw as string))
    .filter((m) => m.type === 'ocrText')
}

beforeEach(() => {
  host.post.mockClear()
  vi.stubGlobal('__DEV__', false)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NativePdfReader canonical delivery callback wiring', () => {
  it('replays every cached page after ready when OCR precedes receiver installation', async () => {
    const { identity } = await mount(record('early'))
    geometry(identity, 1)
    geometry(identity, 2)
    geometry(identity, 1)
    expect(delivered()).toHaveLength(0)
    message(identity, 'web-ready')
    expect(delivered().map((m) => m.canonicalPage.pageNumber)).toEqual([1, 2])
    expect(delivered()[0].canonicalPage).toMatchObject({
      text: 'OCR QA SAMPLE',
      boundaries: expect.any(Array)
    })
    message(identity, 'web-ready')
    geometry(identity, 1)
    expect(delivered()).toHaveLength(2)
  })

  it('delivers OCR after ready immediately and sends changed geometry even for identical text', async () => {
    const { identity } = await mount(record('late'))
    message(identity, 'web-ready')
    expect(delivered()).toHaveLength(0)
    geometry(identity)
    expect(delivered()).toHaveLength(1)
    geometry(identity, 1, 800)
    expect(delivered()).toHaveLength(2)
    expect(delivered()[1].canonicalPage.width).toBe(800)
  })

  it('honors explicit backfill despite earlier delivery and replays after a Web reload', async () => {
    const { identity } = await mount(record('refill'))
    geometry(identity)
    message(identity, 'web-ready')
    message(identity, 'canonical-request', [1, 1, 99])
    expect(delivered()).toHaveLength(2)
    act(() =>
      host.web.onLoadStart?.({
        nativeEvent: { url: 'file:///refill/index.html' }
      } as Parameters<NonNullable<WebViewProps['onLoadStart']>>[0])
    )
    geometry(identity, 2)
    expect(delivered()).toHaveLength(2)
    message(identity, 'web-ready')
    expect(
      delivered()
        .slice(2)
        .map((m) => m.canonicalPage.pageNumber)
    ).toEqual([1, 2])
  })

  it('rejects late ready/refill from A after switching to B and reopens A in a fresh session', async () => {
    const a = await mount(record('A', 'PAGE A'))
    geometry(a.identity)
    a.unmount()
    const b = await mount(record('B', 'PAGE B'))
    geometry(b.identity)
    message(a.identity, 'web-ready')
    message(a.identity, 'canonical-request', [1])
    expect(delivered()).toHaveLength(0)
    message(b.identity, 'web-ready')
    expect(
      delivered().map((m) => [m.identity.fileId, m.canonicalPage.text])
    ).toEqual([['B', 'PAGE B']])
    b.unmount()
    const reopened = await mount(record('A', 'PAGE A'))
    geometry(reopened.identity)
    message(a.identity, 'web-ready')
    expect(delivered()).toHaveLength(1)
    message(reopened.identity, 'web-ready')
    expect(
      delivered().map((m) => [m.identity.fileId, m.canonicalPage.text])
    ).toEqual([
      ['B', 'PAGE B'],
      ['A', 'PAGE A']
    ])
    expect(reopened.identity.sessionId).not.toBe(a.identity.sessionId)
  })
})
