import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ReactNode
} from 'react'
import type { WebViewProps } from 'react-native-webview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderScreen } from '../app/src/screens/ReaderScreen'
import type { ReaderPdfViewProps } from '../app/modules/reader-pdf'
import type {
  BridgeCloseResult,
  BridgeHostSnapshot
} from '../src/bridge/hostSession'
import type { HostDocumentRecord } from '../src/host/readerDataStore'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../src/host/readerSnapshot'
import type { PdfCommand, PdfIdentity } from '../src/nativePdf/contracts'
import type { ReaderSelectionRange } from '../src/types/selection'

const host = vi.hoisted(() => ({
  web: {} as WebViewProps,
  native: {} as ReaderPdfViewProps,
  commands: [] as PdfCommand[],
  post: vi.fn(),
  webClose: vi.fn<() => Promise<BridgeCloseResult>>(),
  sequence: 0
}))
vi.mock('../app/src/native/webAssets', () => ({
  stageReaderDocument: vi.fn(async () => ({
    baseUrl: 'file:///session/',
    entryUrl: 'file:///session/index.html',
    publicationUrl: 'file:///session/publication.pdf'
  }))
}))
vi.mock('../app/src/components/ReaderWebView', () => ({
  ReaderWebView: forwardRef(function MockReaderWebView(_props, ref) {
    const [closed, setClosed] = useState(false)
    useImperativeHandle(
      ref,
      () => ({
        close: async () => {
          const result = await host.webClose()
          if (result.status === 'closed') setClosed(true)
          return result
        }
      }),
      []
    )
    return (
      <div data-testid='web-reader'>{closed ? 'web-disposed' : 'web-live'}</div>
    )
  })
}))
vi.mock('react-native', () => {
  const Container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  )
  return {
    ActivityIndicator: () => <div>loading</div>,
    Alert: { alert: vi.fn() },
    BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
    View: Container,
    Text: Container,
    ScrollView: Container,
    Pressable: ({
      children,
      onPress
    }: {
      children?: ReactNode
      onPress?: () => void
    }) => <button onClick={onPress}>{children}</button>,
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
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
vi.mock('../app/modules/reader-pdf', () => ({
  readerPdfModule: {},
  ReaderPdfView: (props: ReaderPdfViewProps) => {
    host.native = props
    const command = props.command as PdfCommand | null | undefined
    if (command && host.commands.at(-1)?.requestId !== command.requestId)
      host.commands.push(command)
    return null
  }
}))
vi.mock('../app/src/native/documents', () => ({
  pickLegacyJsonAndImport: vi.fn()
}))
vi.mock('expo-crypto', () => ({
  randomUUID: () => `handoff-${++host.sequence}`
}))
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' }
}))

function highlight(id: string): ReaderSelectionRange {
  return {
    id,
    createdAt: 1,
    text: 'QA',
    start: { selectionId: 'page-1', offset: 4 },
    end: { selectionId: 'page-1', offset: 6 },
    overlayRectType: 'px',
    markerStyle: { backgroundColor: '#ff0000' },
    rectsBySelectionId: {
      'page-1': [{ x: 40, y: 50, width: 320, height: 50 }]
    }
  } as ReaderSelectionRange
}

const record: HostDocumentRecord = {
  fileId: 'late-web-flush',
  fileName: 'two-hundred-pages.pdf',
  format: 'pdf',
  size: 1,
  modifiedAt: 0,
  importedAt: 0,
  cachedUri: 'two-hundred-pages.pdf',
  snapshot: {
    revision: 0,
    progress: null,
    data: {
      readerData: { hiddenPages: [] },
      annotations: { version: 5, ranges: [], rects: [], paintings: {} }
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function drainCommands(identity: PdfIdentity) {
  const completed = new Set<string>()
  for (let index = 0; index < 30; index++) {
    const command = host.native.command as PdfCommand | null
    if (!command || completed.has(command.requestId)) return
    completed.add(command.requestId)
    await act(async () => {
      host.native.onPdfEvent({
        nativeEvent: {
          ...identity,
          type: 'complete',
          requestId: command.requestId
        }
      })
    })
  }
  throw new Error('native command queue did not drain')
}

beforeEach(() => {
  host.commands = []
  host.post.mockClear()
  host.webClose.mockReset()
  vi.stubGlobal('__DEV__', true)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ReaderScreen old Web flush handoff', () => {
  it('keeps the late Web highlight when native draws after the flush commits', async () => {
    let current = record
    const store = {
      get: vi.fn(async () => current),
      updateSnapshot: vi.fn(
        async (
          _fileId: string,
          patch: (snapshot: BridgeHostSnapshot) => BridgeHostSnapshot
        ) => {
          const next = patch(current.snapshot)
          current = { ...current, snapshot: next }
          return next
        }
      )
    }
    const close = deferred<BridgeCloseResult>()
    host.webClose.mockReturnValue(close.promise)
    render(
      <ReaderScreen
        record={record}
        store={store as never}
        entryUrl='file:///session/index.html'
        baseUrl='file:///session/'
        onBack={vi.fn()}
        onRecordUpdated={vi.fn()}
      />
    )
    await screen.findByTestId('web-reader')

    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    const restored = restoreReaderSnapshot(record.snapshot.data)
    current = {
      ...current,
      snapshot: {
        ...current.snapshot,
        data: serializeReaderSnapshot({
          ...restored,
          data: { ...restored.data, ranges: [highlight('late-web')] }
        }),
        revision: current.snapshot.revision + 1
      }
    }
    await act(async () => {
      close.resolve({ status: 'closed' })
      await close.promise
    })

    const identity = JSON.parse(
      host.web.injectedJavaScriptBeforeContentLoaded!.slice(
        'window.__READER_NATIVE_PDF__='.length,
        -';true;'.length
      )
    ) as PdfIdentity
    act(() =>
      host.native.onPdfEvent({
        nativeEvent: { ...identity, type: 'loaded', pageCount: 200 }
      })
    )
    await drainCommands(identity)
    act(() =>
      host.native.onPdfEvent({
        nativeEvent: {
          ...identity,
          type: 'rect',
          pageNumber: 2,
          rect: { x: 10, y: 20, width: 40, height: 30 },
          phase: 'commit',
          geometryRevision: 1
        }
      })
    )
    await act(async () => {})

    const final = restoreReaderSnapshot(current.snapshot.data)
    expect(final.data.rects).toHaveLength(1)
    expect(final.data.ranges).toHaveLength(1)
    expect(final.data.ranges?.[0]?.id).toBe('late-web')
    expect(current.snapshot.revision).toBe(2)
  })
})
