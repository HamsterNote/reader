import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import {
  createRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type ReactNode
} from 'react'
import type { WebViewProps } from 'react-native-webview'
import { Alert } from 'react-native'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ReaderScreen,
  type ReaderScreenHandle
} from '../app/src/screens/ReaderScreen'
import { App } from '../app/App'
import type { ReaderWebViewHandle } from '../app/src/components/ReaderWebView'
import type { ReaderPdfViewProps } from '../app/modules/reader-pdf'
import type {
  BridgeCloseResult,
  BridgeHostSnapshot
} from '../src/bridge/hostSession'
import type {
  HostDocumentRecord,
  HostDocumentSummary
} from '../src/host/readerDataStore'
import { ReaderDataStore } from '../src/host/readerDataStore'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../src/host/readerSnapshot'
import type {
  PdfCommand,
  PdfEvent,
  PdfIdentity
} from '../src/nativePdf/contracts'
import * as pdfRouting from '../src/nativePdf/routing'
import { stageReaderDocument } from '../app/src/native/webAssets'
import { createDocumentFileId } from '../src/host/fileIdentity'
import type { ReaderSelectionRange } from '../src/types/selection'

type TestBinding = {
  readonly identity: PdfIdentity
  readonly canWrite: (identity: PdfIdentity) => boolean
  readonly assertWriter: (identity: PdfIdentity) => void
  readonly onReady?: (identity: PdfIdentity) => void
}

type OuterWebProps = {
  readonly record?: HostDocumentRecord
  readonly handoff?: TestBinding
  readonly sessionId?: string
}

const host = vi.hoisted(() => {
  const values = new Map<string, string>()
  const writeControls = { failNext: false }
  return {
    web: {} as WebViewProps,
    outerProps: null as OuterWebProps | null,
    native: {} as ReaderPdfViewProps,
    commands: [] as PdfCommand[],
    post: vi.fn(),
    webClose:
      vi.fn<(props: OuterWebProps | undefined) => Promise<BridgeCloseResult>>(),
    sequence: 0,
    webError: false,
    nativeMounts: 0,
    nativeUnmounts: 0,
    nativeAvailable: true,
    platform: 'ios',
    views: new Map<string, ReaderPdfViewProps>(),
    webViews: new Map<string, WebViewProps>(),
    census: [] as ('web' | 'native')[],
    values,
    writeControls,
    storage: {
      read: async (key: string) => values.get(key) ?? null,
      write: async (key: string, value: string) => {
        if (writeControls.failNext) {
          writeControls.failNext = false
          throw new Error('disk full')
        }
        values.set(key, value)
      },
      remove: async (key: string) => {
        values.delete(key)
      }
    }
  }
})

vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
vi.mock('../app/src/native/storage', () => ({
  createFileSystemStorage: () => host.storage
}))
vi.mock('../app/src/native/webAssets', () => ({
  stageReaderDocument: vi.fn(async () => ({
    baseUrl: 'file:///session/',
    entryUrl: 'file:///session/index.html',
    publicationUrl: 'file:///session/publication.pdf'
  })),
  preparePackagedWebReader: vi.fn(async () => ({
    baseUrl: 'file:///session/',
    entryUrl: 'file:///session/index.html'
  }))
}))
vi.mock('../app/src/components/ReaderWebView', () => ({
  ReaderWebView: forwardRef<ReaderWebViewHandle, OuterWebProps>(
    function MockReaderWebView(props, ref) {
      const [closed, setClosed] = useState(false)
      host.outerProps = props
      useImperativeHandle(ref, () => ({
        close: async () => {
          const result = await host.webClose(props)
          if (result.status === 'closed') setClosed(true)
          return result
        },
        requestPageRenderCensus: () => {
          host.census.push('web')
        }
      }))
      const generation = props.handoff?.identity.generation ?? 0
      let content = 'web-live'
      if (host.webError && generation === 0) {
        content = 'WebView 未完成握手（8 秒超时）'
      }
      if (closed) content = 'web-disposed'
      return (
        <div
          data-testid='web-reader'
          data-generation={generation}
          data-session={props.sessionId ?? 'initial-session'}
        >
          {content}
        </div>
      )
    }
  )
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
    SafeAreaView: Container,
    FlatList: ({
      data,
      renderItem
    }: {
      data: readonly HostDocumentSummary[]
      renderItem: (info: { item: HostDocumentSummary }) => ReactNode
    }) => (
      <div>
        {data.map((item) => (
          <div key={item.fileId}>{renderItem({ item })}</div>
        ))}
      </div>
    ),
    Pressable: ({
      children,
      onPress,
      disabled
    }: {
      children?: ReactNode
      onPress?: () => void
      disabled?: boolean
    }) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Modal: ({
      visible,
      children
    }: {
      visible: boolean
      children?: ReactNode
    }) => (visible ? <div>{children}</div> : null),
    Image: () => null,
    Platform: {
      get OS() {
        return host.platform
      }
    },
    Linking: {
      openURL: vi.fn(),
      getInitialURL: async () => null,
      addEventListener: () => ({ remove: vi.fn() })
    },
    AppState: { addEventListener: () => ({ remove: vi.fn() }) }
  }
})
vi.mock('react-native-webview', async () => {
  const { forwardRef: forward, useImperativeHandle: imperative } =
    await import('react')
  return {
    WebView: forward(function TestWebView(props: WebViewProps, ref) {
      host.web = props
      const script = props.injectedJavaScriptBeforeContentLoaded
      if (script?.startsWith('window.__READER_NATIVE_PDF__=')) {
        const identity = JSON.parse(
          script.slice('window.__READER_NATIVE_PDF__='.length, -';true;'.length)
        ) as PdfIdentity
        host.webViews.set(identity.sessionId, props)
      }
      imperative(ref, () => ({ postMessage: host.post }), [])
      return null
    })
  }
})
vi.mock('../app/modules/reader-pdf', () => ({
  get readerPdfModule() {
    return host.nativeAvailable ? {} : null
  },
  ReaderPdfView: (props: ReaderPdfViewProps) => {
    host.native = props
    useEffect(() => {
      host.nativeMounts += 1
      return () => {
        host.nativeUnmounts += 1
      }
    }, [])
    const command = props.command as PdfCommand | null | undefined
    if (command) host.views.set(command.sessionId, props)
    if (
      command &&
      !host.commands.some(
        (existing) =>
          existing.sessionId === command.sessionId &&
          existing.requestId === command.requestId
      )
    ) {
      host.commands.push(command)
    }
    return <div data-testid='native-pdf-view' />
  }
}))
vi.mock('../app/src/native/documents', () => ({
  pickLegacyJsonAndImport: vi.fn(),
  pickAndCacheDocument: vi.fn(),
  removeDocument: vi.fn()
}))
vi.mock('expo-crypto', () => ({
  randomUUID: () => `handoff-${++host.sequence}`
}))
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' }
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function makeRecord(fileId = 'handoff-document'): HostDocumentRecord {
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    format: 'pdf',
    size: 57_618,
    modifiedAt: 0,
    importedAt: 0,
    cachedUri: `${fileId}.pdf`,
    snapshot: {
      revision: 0,
      progress: null,
      data: {
        readerData: {
          hiddenPages: [],
          edgeCrop: { pages: { 'page-2': { left: 0.2 } } }
        },
        annotations: { version: 5, ranges: [], rects: [], paintings: {} },
        comments: [{ id: 'keep-comment' }],
        envelopeSentinel: { keep: true }
      }
    }
  }
}

type StoreControls = {
  getGate?: ReturnType<typeof deferred<void>>
  failGetOnCall?: number
  failNextUpdate?: boolean
  holdNextUpdate?: ReturnType<typeof deferred<void>>
}

function createTransactionStore(
  initial: HostDocumentRecord,
  controls: StoreControls = {}
) {
  let current = initial
  let queue: Promise<unknown> = Promise.resolve()
  const owners: string[] = []
  const store = {
    get: vi.fn(async (_fileId: string) => {
      if (controls.getGate) await controls.getGate.promise
      await queue
      if (store.get.mock.calls.length === controls.failGetOnCall) {
        throw new Error('authoritative read failed')
      }
      return current
    }),
    updateSnapshot: vi.fn(
      (
        _fileId: string,
        patch: (snapshot: BridgeHostSnapshot) => BridgeHostSnapshot,
        fence?: () => void
      ) => {
        const run = async () => {
          fence?.()
          const next = patch(current.snapshot)
          if (controls.holdNextUpdate) {
            const hold = controls.holdNextUpdate
            controls.holdNextUpdate = undefined
            await hold.promise
          }
          if (controls.failNextUpdate) {
            controls.failNextUpdate = false
            throw new Error('disk full')
          }
          current = { ...current, snapshot: next }
          owners.push('native')
          return next
        }
        const result = queue.then(run, run)
        queue = result.catch(() => undefined)
        return result
      }
    )
  }
  return {
    store: store as unknown as ReaderDataStore,
    updateSnapshot: store.updateSnapshot,
    get: store.get,
    snapshot: () => current.snapshot,
    owners
  }
}

async function mountScreen(
  store: ReaderDataStore,
  record = makeRecord(),
  onBack = vi.fn()
) {
  render(
    <ReaderScreen
      record={record}
      store={store}
      entryUrl='file:///unused/index.html'
      baseUrl='file:///unused/'
      onBack={onBack}
      onRecordUpdated={vi.fn()}
    />
  )
  await screen.findByTestId('web-reader')
  return { onBack, record }
}

async function switchToNative() {
  await act(async () => {
    fireEvent.click(screen.getByText('原生 PDF 验证'))
    await Promise.resolve()
  })
  expect(host.native.onPdfEvent).toBeTypeOf('function')
}

function nativeIdentity(): PdfIdentity {
  const script = host.web.injectedJavaScriptBeforeContentLoaded
  expect(script).toBeTypeOf('string')
  return JSON.parse(
    script!.slice('window.__READER_NATIVE_PDF__='.length, -';true;'.length)
  ) as PdfIdentity
}

async function drainCommands(identity: PdfIdentity) {
  const completed = new Set<string>()
  for (let index = 0; index < 40; index++) {
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

async function drainPaneCommands(identity: PdfIdentity) {
  const completed = new Set<string>()
  for (let index = 0; index < 40; index++) {
    const command = host.views.get(identity.sessionId)?.command as
      | PdfCommand
      | null
      | undefined
    if (!command || completed.has(command.requestId)) return
    completed.add(command.requestId)
    await emitFor(identity, {
      ...identity,
      type: 'complete',
      requestId: command.requestId
    })
  }
  throw new Error('native pane command queue did not drain')
}

async function loadNative(pageCount = 200): Promise<PdfIdentity> {
  const identity = nativeIdentity()
  await act(async () => {
    host.native.onPdfEvent({
      nativeEvent: { ...identity, type: 'loaded', pageCount }
    })
  })
  await drainCommands(identity)
  return identity
}

async function waitForNativeReady() {
  await waitFor(() => {
    expect(
      screen.getByText('裁切/隐藏页编辑').closest('button')
    ).not.toBeDisabled()
  })
}

async function submitCrop() {
  await act(async () => {
    fireEvent.click(screen.getByText('裁切/隐藏页编辑'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText('裁切四边 5%'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText('确认'))
  })
}

function alertButton(text: string) {
  const calls = vi.mocked(Alert.alert).mock.calls
  for (let index = calls.length - 1; index >= 0; index--) {
    const button = calls[index]?.[2]?.find((entry) => entry.text === text)
    if (button) return button
  }
  throw new Error(`missing alert button: ${text}`)
}

beforeEach(() => {
  host.commands = []
  host.web = {} as WebViewProps
  host.outerProps = null
  host.native = {} as ReaderPdfViewProps
  host.post.mockClear()
  host.webClose.mockReset()
  host.sequence = 0
  host.webError = false
  host.nativeMounts = 0
  host.nativeUnmounts = 0
  host.nativeAvailable = true
  host.platform = 'ios'
  host.views.clear()
  host.webViews.clear()
  host.values.clear()
  host.writeControls.failNext = false
  host.census = []
  vi.stubGlobal('__DEV__', true)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const directProps = {
  entryUrl: 'file:///unused/index.html',
  baseUrl: 'file:///unused/',
  onBack: vi.fn(),
  onRecordUpdated: vi.fn()
}

async function emitFor(identity: PdfIdentity, event: PdfEvent) {
  await act(async () => {
    host.views.get(identity.sessionId)!.onPdfEvent({ nativeEvent: event })
  })
}

function geometryEvent(identity: PdfIdentity, pageNumber: number): PdfEvent {
  return {
    ...identity,
    type: 'geometry',
    geometryRevision: 1,
    pages: [
      {
        pageNumber,
        width: 400,
        height: 500,
        rotation: 0,
        crop: {},
        pageToViewport: [1, 0, 0, 1, 0, -100],
        geometryRevision: 1
      }
    ]
  }
}

function makeRange(id: string, color: string): ReaderSelectionRange {
  return {
    id,
    createdAt: 1,
    text: id,
    start: { selectionId: 'page-1', offset: 0 },
    end: { selectionId: 'page-1', offset: 2 },
    overlayRectType: 'px',
    markerStyle: { backgroundColor: color },
    rectsBySelectionId: {
      'page-1': [{ x: 0, y: 0, width: 20, height: 10 }]
    }
  }
}

async function emitWebRanges(
  identity: PdfIdentity,
  record: HostDocumentRecord,
  ranges: readonly ReaderSelectionRange[],
  commitId: string,
  annotationOperation: { type: 'upsert' | 'delete'; rangeId: string }
) {
  const restored = restoreReaderSnapshot(
    record.snapshot.data,
    record.snapshot.progress
  )
  const data = serializeReaderSnapshot({
    ...restored,
    data: { ...restored.data, ranges: [...ranges] }
  })
  await act(async () => {
    await host.webViews.get(identity.sessionId)?.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          ...identity,
          type: 'snapshot',
          commitId,
          annotationOperation,
          data
        })
      }
    } as Parameters<NonNullable<WebViewProps['onMessage']>>[0])
  })
}

describe('iOS native default entry (S01/S11/S13)', () => {
  it('keeps the normal Text/Layout entry available in release with shared mode persistence', async () => {
    vi.stubGlobal('__DEV__', false)
    const record = makeRecord()
    const fixture = createTransactionStore(record)
    render(
      <ReaderScreen record={record} store={fixture.store} {...directProps} />
    )
    await screen.findByTestId('native-pdf-view')
    await loadNative()
    await waitForNativeReady()
    await act(async () => {
      fireEvent.click(screen.getByText('Text'))
    })
    await screen.findByTestId('web-reader')
    expect(
      restoreReaderSnapshot(host.outerProps!.record!.snapshot.data).data
        .renderMode
    ).toBe('text')
    expect(restoreReaderSnapshot(fixture.snapshot().data).data.renderMode).toBe(
      'text'
    )
    await act(async () => {
      const web = host.outerProps!
      web.handoff!.onReady!(web.handoff!.identity)
    })
    host.webClose
      .mockResolvedValueOnce({ status: 'unconfirmed', reason: 'flush failed' })
      .mockResolvedValueOnce({ status: 'closed' })
    await act(async () => {
      fireEvent.click(screen.getByText('Layout'))
    })
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled())
    expect(alertButton('返回原阅读模式')).toBeDefined()
    const failureAlert = JSON.stringify(
      vi.mocked(Alert.alert).mock.calls.at(-1)
    )
    expect(failureAlert).not.toMatch(/Web 对照|原生 PDF 验证/)
    await act(async () => {
      alertButton('重试旧 Web 保存').onPress?.()
    })
    await screen.findByTestId('native-pdf-view')
    await loadNative()
    await waitForNativeReady()
    await waitFor(() =>
      expect(
        restoreReaderSnapshot(fixture.snapshot().data).data.renderMode
      ).toBe('layout')
    )
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    expect(screen.queryByText('Web 对照')).not.toBeInTheDocument()
  })
  it('keeps A/B/A/B/A sessions and same-named files separate using the existing content identity', async () => {
    const makeFile = async (contentDigest: string) => {
      const fileId = await createDocumentFileId(
        { fileName: 'book.pdf', size: 2048, modifiedAt: 1, contentDigest },
        async (value) => createHash('sha256').update(value).digest('hex')
      )
      return { ...makeRecord(fileId), fileName: 'book.pdf' }
    }
    const a = await makeFile('a'.repeat(32))
    const b = await makeFile('b'.repeat(32))
    expect(a.fileId).not.toBe(b.fileId)
    const fixtures = [createTransactionStore(a), createTransactionStore(b)]
    const records = [a, b]
    const view = render(
      <ReaderScreen
        record={a}
        store={fixtures[0]!.store}
        {...directProps}
        paneId='library'
      />
    )
    const seen = new Set<string>()
    for (const index of [0, 1, 0, 1, 0]) {
      view.rerender(
        <ReaderScreen
          record={records[index]!}
          store={fixtures[index]!.store}
          {...directProps}
          paneId='library'
        />
      )
      await waitFor(() =>
        expect(nativeIdentity().fileId).toBe(records[index]!.fileId)
      )
      const identity = await loadNative()
      await waitForNativeReady()
      expect(identity.paneId).toBe('library')
      expect(seen.has(identity.sessionId)).toBe(false)
      seen.add(identity.sessionId)
      expect(host.native.command?.fileId).toBe(records[index]!.fileId)
      expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    }
    expect(
      fixtures.every(
        (fixture) => fixture.updateSnapshot.mock.calls.length === 0
      )
    ).toBe(true)
    expect(host.webClose).not.toHaveBeenCalled()
  })
  it('opens directly, grants editing after recovery, and reopens without an outer Web session', async () => {
    const record = makeRecord()
    const fixture = createTransactionStore(record)
    let view = render(
      <ReaderScreen record={record} store={fixture.store} {...directProps} />
    )
    await screen.findByTestId('native-pdf-view')
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    expect(host.webClose).not.toHaveBeenCalled()
    const first = await loadNative()
    await waitForNativeReady()
    await submitCrop()
    await waitFor(() => expect(fixture.snapshot().revision).toBe(1))
    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    view.unmount()
    view = render(
      <ReaderScreen
        record={{ ...record, snapshot: fixture.snapshot() }}
        store={fixture.store}
        {...directProps}
      />
    )
    await screen.findByTestId('native-pdf-view')
    const second = await loadNative()
    await waitForNativeReady()
    expect(second.fileId).toBe(first.fileId)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(
      restoreReaderSnapshot(fixture.snapshot().data).data.edgeCrop?.all?.top
    ).toBe(0.05)
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    view.unmount()
  })

  it.each(['android', 'web', 'epub', 'text', 'remote'])(
    'retains the Web entry for %s',
    async (route) => {
      const record = makeRecord()
      if (route === 'android' || route === 'web') host.platform = route
      const selected = {
        ...record,
        ...(route === 'epub' ? { format: 'epub' as const } : {}),
        ...(route === 'remote'
          ? { cachedUri: 'https://example.org/book.pdf' }
          : {}),
        ...(route === 'text'
          ? {
              snapshot: {
                ...record.snapshot,
                data: { readerData: { renderMode: 'text' } }
              }
            }
          : {})
      }
      const fixture = createTransactionStore(selected)
      await mountScreen(fixture.store, selected)
      expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
      expect(host.nativeMounts).toBe(0)
    }
  )

  it('shows the dev-client requirement when the module is absent, writes nothing and never silently mounts Web', async () => {
    host.nativeAvailable = false
    const fixture = createTransactionStore(makeRecord())
    const onBack = vi.fn()
    render(
      <ReaderScreen
        record={makeRecord()}
        store={fixture.store}
        {...directProps}
        onBack={onBack}
      />
    )
    await screen.findByText(/需要重新构建 iOS dev client/)
    expect(screen.getByText(/Expo Go/)).toBeInTheDocument()
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
    expect(host.web.injectedJavaScriptBeforeContentLoaded).toBeUndefined()
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(host.webClose).not.toHaveBeenCalled()
  })

  it('keeps all comparison controls out of release while native remains the default', async () => {
    vi.stubGlobal('__DEV__', false)
    const fixture = createTransactionStore(makeRecord())
    render(
      <ReaderScreen
        record={makeRecord()}
        store={fixture.store}
        {...directProps}
      />
    )
    await screen.findByTestId('native-pdf-view')
    expect(screen.queryByText('Web 对照')).not.toBeInTheDocument()
    expect(screen.queryByText('原生 PDF 验证')).not.toBeInTheDocument()
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
  })

  it('only mounts the Web comparison after an explicit switch and returns to native', async () => {
    const fixture = createTransactionStore(makeRecord())
    render(
      <ReaderScreen
        record={makeRecord()}
        store={fixture.store}
        {...directProps}
      />
    )
    await screen.findByTestId('native-pdf-view')
    const original = await loadNative()
    await waitForNativeReady()
    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
    })
    await screen.findByTestId('web-reader')
    await act(async () => {
      const web = host.outerProps!
      web.handoff!.onReady!(web.handoff!.identity)
    })
    host.webClose.mockResolvedValue({ status: 'closed' })
    await switchToNative()
    const current = await loadNative()
    await waitForNativeReady()
    expect(current.sessionId).not.toBe(original.sessionId)
    expect(current.generation).toBeGreaterThan(original.generation)
    await act(async () => {
      host.native.onPdfEvent({ nativeEvent: geometryEvent(original, 6) })
    })
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
  })

  it('routes the census request to the native service and to the Web comparison reader', async () => {
    const fixture = createTransactionStore(makeRecord())
    const current = makeRecord()
    const view = render(
      <ReaderScreen record={current} store={fixture.store} {...directProps} />
    )
    await screen.findByTestId('native-pdf-view')
    view.rerender(
      <ReaderScreen
        record={current}
        store={fixture.store}
        {...directProps}
        debugCensusToken={1}
      />
    )
    await waitFor(() =>
      expect(
        host.post.mock.calls.some(
          ([raw]) => JSON.parse(raw as string).type === 'census-request'
        )
      ).toBe(true)
    )

    host.webClose.mockResolvedValue({ status: 'closed' })
    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
    })
    await screen.findByTestId('web-reader')
    view.rerender(
      <ReaderScreen
        record={current}
        store={fixture.store}
        {...directProps}
        debugCensusToken={2}
      />
    )
    await waitFor(() => expect(host.census).toEqual(['web']))
  })

  it('keeps a failed save mounted during a configured file switch, then retries into the new native session', async () => {
    const a = makeRecord('a')
    const b = makeRecord('b')
    const hold = deferred<void>()
    const fixture = createTransactionStore(a, {
      holdNextUpdate: hold,
      failNextUpdate: true
    })
    const next = createTransactionStore(b)
    const view = render(
      <ReaderScreen record={a} store={fixture.store} {...directProps} />
    )
    await screen.findByTestId('native-pdf-view')
    const old = await loadNative()
    await waitForNativeReady()
    await submitCrop()
    view.rerender(
      <ReaderScreen record={b} store={next.store} {...directProps} />
    )
    await act(async () => {
      hold.resolve()
      await hold.promise
    })
    await screen.findByText(/disk full/)
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(next.get).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText(/disk full.*重试/))
    })
    await screen.findByText('b.pdf')
    await waitFor(() => expect(nativeIdentity().fileId).toBe('b'))
    expect(nativeIdentity().sessionId).not.toBe(old.sessionId)
    const before = next.snapshot()
    await emitFor(old, {
      ...old,
      type: 'rect',
      pageNumber: 1,
      rect: { x: 1, y: 1, width: 20, height: 20 },
      phase: 'commit',
      geometryRevision: 1
    })
    expect(next.snapshot()).toEqual(before)
    expect(
      restoreReaderSnapshot(fixture.snapshot().data).data.edgeCrop?.all?.top
    ).toBe(0.05)
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
  })

  it('isolates same-file pane/session events and only the active pane persists recent progress', async () => {
    const record = makeRecord()
    const fixture = createTransactionStore(record)
    const left = render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='left'
        isActivePane={false}
      />
    )
    await screen.findByTestId('native-pdf-view')
    const leftId = await loadNative()
    const right = render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='right'
      />
    )
    await waitFor(() => expect(host.nativeMounts).toBe(2))
    const rightId = await loadNative()
    expect(leftId.paneId).toBe('left')
    expect(rightId.paneId).toBe('right')
    expect(leftId.fileId).toBe(rightId.fileId)
    expect(leftId.sessionId).not.toBe(rightId.sessionId)
    for (const id of [leftId, rightId]) {
      await emitFor(id, {
        ...id,
        type: 'displayed',
        pageNumber: 1
      })
      await emitFor(id, { ...id, type: 'restored', pageNumber: 1 })
    }
    await emitFor(leftId, geometryEvent(leftId, 2))
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    // Misdelivery to another pane is rejected even for the same file.
    await act(async () => {
      host.views
        .get(rightId.sessionId)!
        .onPdfEvent({ nativeEvent: geometryEvent(leftId, 3) })
    })
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    await emitFor(rightId, geometryEvent(rightId, 4))
    await waitFor(() =>
      expect(
        restoreReaderSnapshot(fixture.snapshot().data).data
          .layoutReadingProgress
      ).toMatchObject({ pageNumber: 4 })
    )
    left.rerender(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='left'
      />
    )
    right.rerender(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='right'
        isActivePane={false}
      />
    )
    await emitFor(rightId, geometryEvent(rightId, 5))
    await emitFor(leftId, geometryEvent(leftId, 6))
    await waitFor(() =>
      expect(
        restoreReaderSnapshot(fixture.snapshot().data).data
          .layoutReadingProgress
      ).toMatchObject({ pageNumber: 6 })
    )
  })

  it('retains both confirmed rectangles when same-file panes edit in sequence', async () => {
    const record = makeRecord()
    const fixture = createTransactionStore(record)
    render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='left'
      />
    )
    await screen.findByTestId('native-pdf-view')
    const leftId = await loadNative()
    await waitFor(() => {
      for (const element of screen.getAllByText('裁切/隐藏页编辑'))
        expect(element.closest('button')).not.toBeDisabled()
    })
    render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='right'
      />
    )
    await waitFor(() => expect(host.nativeMounts).toBe(2))
    const rightId = await loadNative()
    await waitFor(() => {
      for (const element of screen.getAllByText('裁切/隐藏页编辑'))
        expect(element.closest('button')).not.toBeDisabled()
    })
    for (const identity of [leftId, rightId]) {
      await emitFor(identity, {
        ...identity,
        type: 'rect',
        pageNumber: 1,
        rect: { x: 1, y: 1, width: 20, height: 20 },
        phase: 'commit',
        geometryRevision: 1
      })
      await waitFor(() =>
        expect(fixture.snapshot().revision).toBe(identity === leftId ? 1 : 2)
      )
    }
    expect(
      restoreReaderSnapshot(fixture.snapshot().data).data.rects
    ).toHaveLength(2)
  })

  it('merges same-file range color, deletion, rectangle and undo operations by object', async () => {
    const initial = makeRecord()
    const leftOriginal = makeRange('left-range', '#ffc107')
    const rightOriginal = makeRange('right-range', '#ffc107')
    const record: HostDocumentRecord = {
      ...initial,
      snapshot: {
        ...initial.snapshot,
        data: {
          ...(initial.snapshot.data as Record<string, unknown>),
          annotations: {
            version: 5,
            ranges: [leftOriginal, rightOriginal],
            rects: [],
            paintings: {}
          }
        }
      }
    }
    const fixture = createTransactionStore(record)
    render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='left'
      />
    )
    await screen.findByTestId('native-pdf-view')
    const leftId = await loadNative()
    render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='right'
      />
    )
    await waitFor(() => expect(host.nativeMounts).toBe(2))
    const rightId = await loadNative()
    await waitFor(() => {
      for (const element of screen.getAllByText('裁切/隐藏页编辑'))
        expect(element.closest('button')).not.toBeDisabled()
    })

    await emitWebRanges(
      leftId,
      record,
      [makeRange('left-range', '#ff0000'), rightOriginal],
      'left-color',
      { type: 'upsert', rangeId: 'left-range' }
    )
    await waitFor(() => expect(fixture.snapshot().revision).toBe(1))
    await emitWebRanges(
      rightId,
      record,
      [leftOriginal, makeRange('right-range', '#00ff00')],
      'right-color',
      { type: 'upsert', rangeId: 'right-range' }
    )
    await waitFor(() => expect(fixture.snapshot().revision).toBe(2))
    let data = restoreReaderSnapshot(fixture.snapshot().data).data
    expect(
      data.ranges?.map((range) => [
        range.id,
        range.markerStyle?.backgroundColor
      ])
    ).toEqual([
      ['left-range', '#ff0000'],
      ['right-range', '#00ff00']
    ])

    await emitWebRanges(leftId, record, [rightOriginal], 'left-delete', {
      type: 'delete',
      rangeId: 'left-range'
    })
    await waitFor(() => expect(fixture.snapshot().revision).toBe(3))
    data = restoreReaderSnapshot(fixture.snapshot().data).data
    expect(data.ranges).toEqual([
      expect.objectContaining({
        id: 'right-range',
        markerStyle: expect.objectContaining({ backgroundColor: '#00ff00' })
      })
    ])

    for (const [identity, pageNumber] of [
      [leftId, 1],
      [rightId, 2]
    ] as const) {
      await emitFor(identity, {
        ...identity,
        type: 'rect',
        pageNumber,
        rect: { x: 1, y: 1, width: 20, height: 20 },
        phase: 'commit',
        geometryRevision: 1
      })
      await waitFor(() =>
        expect(fixture.snapshot().revision).toBe(pageNumber === 1 ? 4 : 5)
      )
    }
    await drainPaneCommands(leftId)
    await waitFor(() =>
      expect(
        host.commands.some(
          (command) =>
            command.sessionId === leftId.sessionId &&
            command.type === 'annotations' &&
            command.rects?.length === 2
        )
      ).toBe(true)
    )

    await act(async () => {
      fireEvent.click(screen.getAllByText('撤销标注')[0]!)
    })
    await waitFor(() => expect(fixture.snapshot().revision).toBe(6))
    data = restoreReaderSnapshot(fixture.snapshot().data).data
    expect(data.rects?.map((rect) => rect.selectionId)).toEqual(['page-2'])
    expect(data.ranges).toEqual([
      expect.objectContaining({
        id: 'right-range',
        markerStyle: expect.objectContaining({ backgroundColor: '#00ff00' })
      })
    ])
  })

  it('merges same-page strokes and undo by painting object across panes', async () => {
    const record = makeRecord()
    const fixture = createTransactionStore(record)
    render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='left'
      />
    )
    await screen.findByTestId('native-pdf-view')
    const leftId = await loadNative()
    render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='right'
      />
    )
    await waitFor(() => expect(host.nativeMounts).toBe(2))
    const rightId = await loadNative()
    await waitFor(() => {
      for (const element of screen.getAllByText('裁切/隐藏页编辑'))
        expect(element.closest('button')).not.toBeDisabled()
    })

    for (const [identity, x] of [
      [leftId, 10],
      [rightId, 30]
    ] as const) {
      await emitFor(identity, {
        ...identity,
        type: 'stroke',
        pageNumber: 1,
        points: [
          { x, y: 20 },
          { x: x + 10, y: 30 }
        ],
        phase: 'commit',
        geometryRevision: 1
      })
      await waitFor(() =>
        expect(fixture.snapshot().revision).toBe(x === 10 ? 1 : 2)
      )
    }
    let document = restoreReaderSnapshot(fixture.snapshot().data).data
      .pagePaintings?.['page-1']
    expect(document?.objects).toHaveLength(2)
    const leftObjectId = document?.objects[0]?.objectId
    const rightObjectId = document?.objects[1]?.objectId

    await act(async () => {
      fireEvent.click(screen.getAllByText('撤销标注')[0]!)
    })
    await waitFor(() => expect(fixture.snapshot().revision).toBe(3))
    document = restoreReaderSnapshot(fixture.snapshot().data).data
      .pagePaintings?.['page-1']
    expect(document?.objects.map((object) => object.objectId)).toEqual([
      rightObjectId
    ])
    expect(rightObjectId).not.toBe(leftObjectId)
  })

  it('reports staging failure without showing the old book or falling back and retries the same native route', async () => {
    vi.mocked(stageReaderDocument).mockRejectedValueOnce(
      new Error('PDF permission denied')
    )
    const fixture = createTransactionStore(makeRecord())
    render(
      <ReaderScreen
        record={makeRecord()}
        store={fixture.store}
        {...directProps}
      />
    )
    await screen.findByText('PDF permission denied')
    expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('重试'))
    })
    await screen.findByTestId('native-pdf-view')
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
  })

  it('drops queued progress from a pane that lost focus and can persist the same position after reactivation', async () => {
    const record = makeRecord()
    const controls: StoreControls = {}
    const fixture = createTransactionStore(record, controls)
    const view = render(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='left'
      />
    )
    await screen.findByTestId('native-pdf-view')
    const identity = await loadNative()
    await waitForNativeReady()
    await emitFor(identity, { ...identity, type: 'displayed', pageNumber: 1 })
    await emitFor(identity, { ...identity, type: 'restored', pageNumber: 1 })
    const hold = deferred<void>()
    controls.holdNextUpdate = hold
    const pending = fixture.store.updateSnapshot(
      record.fileId,
      (snapshot) => snapshot
    )
    await emitFor(identity, geometryEvent(identity, 8))
    view.rerender(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='left'
        isActivePane={false}
      />
    )
    await act(async () => {
      hold.resolve()
      await pending
    })
    expect(
      restoreReaderSnapshot(fixture.snapshot().data).data.layoutReadingProgress
    ).toBeUndefined()
    view.rerender(
      <ReaderScreen
        record={record}
        store={fixture.store}
        {...directProps}
        paneId='left'
      />
    )
    await emitFor(identity, geometryEvent(identity, 8))
    await waitFor(() =>
      expect(
        restoreReaderSnapshot(fixture.snapshot().data).data
          .layoutReadingProgress
      ).toMatchObject({ pageNumber: 8 })
    )
  })
})

describe('ReaderScreen close retry after a failed drain', () => {
  it('starts a fresh drain when the page header is pressed again after storage recovers', async () => {
    const fixture = createTransactionStore(makeRecord(), {
      failNextUpdate: true
    })
    const onBack = vi.fn()
    render(
      <ReaderScreen
        record={makeRecord()}
        store={fixture.store}
        {...directProps}
        onBack={onBack}
      />
    )
    await screen.findByTestId('native-pdf-view')
    await loadNative()
    await waitForNativeReady()
    await submitCrop()
    await screen.findByText(/disk full/)
    expect(fixture.updateSnapshot).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        '原生数据尚未保存',
        expect.any(String),
        expect.any(Array)
      )
    )
    expect(onBack).not.toHaveBeenCalled()
    expect(fixture.snapshot().revision).toBe(0)

    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    await waitFor(() => expect(fixture.updateSnapshot).toHaveBeenCalledTimes(2))
    expect(fixture.snapshot().revision).toBe(1)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
  })

  it('starts a fresh drain for host close after a page-header failure', async () => {
    const fixture = createTransactionStore(makeRecord(), {
      failNextUpdate: true
    })
    const onBack = vi.fn()
    const ref = createRef<ReaderScreenHandle>()
    render(
      <ReaderScreen
        ref={ref}
        record={makeRecord()}
        store={fixture.store}
        {...directProps}
        onBack={onBack}
      />
    )
    await screen.findByTestId('native-pdf-view')
    await loadNative()
    await waitForNativeReady()
    await submitCrop()
    await screen.findByText(/disk full/)

    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        '原生数据尚未保存',
        expect.any(String),
        expect.any(Array)
      )
    )
    expect(fixture.updateSnapshot).toHaveBeenCalledTimes(1)

    const closing = ref.current!.close()
    await waitFor(() => expect(fixture.updateSnapshot).toHaveBeenCalledTimes(2))
    await expect(closing).resolves.toEqual({ status: 'closed' })
    expect(fixture.snapshot().revision).toBe(1)
    expect(onBack).not.toHaveBeenCalled()
    expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
  })
})

describe('real App host close barriers', () => {
  it('keeps a real failed native save mounted on debug library return and retries', async () => {
    const record = makeRecord('f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    await new ReaderDataStore(host.storage).upsert(record)
    render(<App />)
    const open = await screen.findByText(record.fileName)
    await act(async () => {
      fireEvent.click(open)
    })
    await screen.findByTestId('native-pdf-view')
    await loadNative()
    await waitForNativeReady()
    host.writeControls.failNext = true
    await submitCrop()
    await screen.findByText(/disk full/)

    await act(async () => {
      fireEvent.click(screen.getByText('返回书库'))
    })
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        '阅读数据尚未保存',
        expect.any(String),
        expect.any(Array)
      )
    )
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
    expect(screen.queryByText('仓鼠阅读')).not.toBeInTheDocument()

    await act(async () => {
      alertButton('重试').onPress?.()
    })
    await waitFor(() =>
      expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
    )
    expect(screen.getByText('仓鼠阅读')).toBeInTheDocument()
    const saved = await new ReaderDataStore(host.storage).get(record.fileId)
    expect(
      restoreReaderSnapshot(saved?.snapshot.data).data.edgeCrop?.all?.top
    ).toBe(0.05)
  })
})

describe('ReaderScreen native handoff regressions', () => {
  // These tests deliberately start at Web to exercise the manual handoff.
  // Direct entries below use the real routing function.
  beforeEach(() => {
    vi.spyOn(pdfRouting, 'usesNativePdfLayout').mockReturnValue(false)
  })
  it('retries a Web drain when the page header is pressed again after failure', async () => {
    host.webClose
      .mockResolvedValueOnce({ status: 'unconfirmed', reason: 'flush failed' })
      .mockResolvedValueOnce({ status: 'closed' })
    const fixture = createTransactionStore(makeRecord())
    const { onBack } = await mountScreen(fixture.store)

    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        '旧 Web 数据尚未保存',
        expect.any(String),
        expect.any(Array)
      )
    )
    expect(onBack).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(host.webClose).toHaveBeenCalledTimes(2)
  })

  it.each(['delayed', 'absent'])(
    'opens native for delayed or absent Web handshake: %s',
    async () => {
      const close = deferred<BridgeCloseResult>()
      const get = deferred<void>()
      host.webClose.mockReturnValue(close.promise)
      const fixture = createTransactionStore(makeRecord(), { getGate: get })
      await mountScreen(fixture.store)

      await switchToNative()
      const identity = await loadNative()
      expect(host.commands.some((command) => command.type === 'open')).toBe(
        true
      )
      expect(screen.getByText('1/200')).toBeInTheDocument()
      expect(fixture.get).toHaveBeenCalled()

      await act(async () => {
        fireEvent.click(screen.getByText('下一页'))
      })
      await waitFor(() => {
        expect(host.native.command).toMatchObject({
          type: 'navigate',
          pageNumber: 2
        })
      })
      expect(fixture.updateSnapshot).not.toHaveBeenCalled()
      expect(identity.fileId).toBe('handoff-document')
      close.reject(new Error('test cleanup'))
      get.reject(new Error('test cleanup'))
    }
  )

  it('rejects edits until authoritative snapshot and lease are ready', async () => {
    const close = deferred<BridgeCloseResult>()
    const get = deferred<void>()
    host.webClose.mockReturnValue(close.promise)
    const fixture = createTransactionStore(makeRecord(), { getGate: get })
    await mountScreen(fixture.store)
    await switchToNative()
    const identity = await loadNative()

    await act(async () => {
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
      await host.web.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            ...identity,
            type: 'snapshot',
            commitId: 'premature-web-edit',
            data: makeRecord().snapshot.data
          })
        }
      } as Parameters<NonNullable<WebViewProps['onMessage']>>[0])
    })
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    expect(screen.getByText('裁切/隐藏页编辑').closest('button')).toBeDisabled()

    await act(async () => {
      get.resolve()
      await get.promise
    })
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    expect(screen.getByText('裁切/隐藏页编辑').closest('button')).toBeDisabled()

    await act(async () => {
      await fixture.store.updateSnapshot('handoff-document', (snapshot) => ({
        ...snapshot,
        data: {
          ...(snapshot.data as Record<string, unknown>),
          readerData: { hiddenPages: [2] }
        },
        revision: snapshot.revision + 1
      }))
      close.resolve({ status: 'closed' })
      await close.promise
    })
    await waitForNativeReady()
    await submitCrop()
    await waitFor(() => {
      const restored = restoreReaderSnapshot(fixture.snapshot().data)
      expect(restored.data.hiddenPages).toEqual([2])
      expect(restored.data.edgeCrop?.all?.top).toBe(0.05)
    })
  })

  it('rejects edits until authoritative snapshot and lease are ready after a read failure', async () => {
    host.webClose.mockResolvedValue({ status: 'closed' })
    const fixture = createTransactionStore(makeRecord(), { failGetOnCall: 2 })
    await mountScreen(fixture.store)
    await switchToNative()
    const identity = await loadNative()
    await screen.findByText(/权威数据读取失败/)

    await act(async () => {
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
    })
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText('重试数据恢复'))
    })
    await waitForNativeReady()
  })

  it('keeps native mounted when cancel save fails and recovers by retry', async () => {
    host.webClose.mockResolvedValue({ status: 'closed' })
    const hold = deferred<void>()
    const fixture = createTransactionStore(makeRecord(), {
      holdNextUpdate: hold,
      failNextUpdate: true
    })
    const { onBack } = await mountScreen(fixture.store)
    await switchToNative()
    await loadNative()
    await waitForNativeReady()
    await submitCrop()
    await waitFor(() => expect(fixture.updateSnapshot).toHaveBeenCalledTimes(1))

    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
    })
    await act(async () => {
      hold.resolve()
      await hold.promise
    })
    await screen.findByText(/disk full/)
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()
    expect(host.outerProps?.handoff?.identity.generation ?? 0).toBe(0)

    await act(async () => {
      fireEvent.click(screen.getByText(/disk full.*重试/))
    })
    await waitFor(() => {
      expect(screen.getByTestId('web-reader')).toHaveAttribute(
        'data-generation',
        '1'
      )
    })
    expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
    expect(
      restoreReaderSnapshot(fixture.snapshot().data).data.edgeCrop?.all?.top
    ).toBe(0.05)
  })

  it('does not discard old Web writes when cancelling pending handoff', async () => {
    const first = deferred<BridgeCloseResult>()
    host.webClose
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ status: 'closed' })
    const fixture = createTransactionStore(makeRecord())
    await mountScreen(fixture.store)
    const oldBinding = host.outerProps?.handoff
    await switchToNative()
    await loadNative()

    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
    })
    expect(host.webClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
    await act(async () => {
      first.resolve({ status: 'unconfirmed', reason: 'old Web write pending' })
      await first.promise
    })
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
    expect(host.outerProps?.handoff?.identity.generation ?? 0).toBe(0)

    await act(async () => {
      await fixture.store.updateSnapshot('handoff-document', (snapshot) => ({
        ...snapshot,
        data: serializeReaderSnapshot({
          ...restoreReaderSnapshot(snapshot.data),
          data: {
            ...restoreReaderSnapshot(snapshot.data).data,
            hiddenPages: [2]
          }
        }),
        revision: snapshot.revision + 1
      }))
      alertButton('重试旧 Web 保存').onPress?.()
    })
    await waitFor(() => {
      expect(screen.getByTestId('web-reader')).toHaveAttribute(
        'data-generation',
        '1'
      )
    })
    expect(
      restoreReaderSnapshot(fixture.snapshot().data).data.hiddenPages
    ).toEqual([2])
    expect(oldBinding?.canWrite(oldBinding.identity)).toBe(false)
  })

  it.each(['normal', 'failure', 'cancel'])(
    'returns to a fresh Web generation on every return path: %s',
    async (path) => {
      host.webError = true
      const close = deferred<BridgeCloseResult>()
      if (path === 'normal') {
        host.webClose.mockResolvedValue({ status: 'closed' })
      } else if (path === 'failure') {
        host.webClose
          .mockResolvedValueOnce({
            status: 'unconfirmed',
            reason: 'flush failed'
          })
          .mockResolvedValueOnce({ status: 'closed' })
      } else {
        host.webClose.mockReturnValue(close.promise)
      }
      const fixture = createTransactionStore(makeRecord())
      await mountScreen(fixture.store)
      const oldProps = host.outerProps
      const oldGeneration = oldProps?.handoff?.identity.generation
      expect(
        screen.getByText('WebView 未完成握手（8 秒超时）')
      ).toBeInTheDocument()
      host.webError = false
      await switchToNative()
      await loadNative()

      if (path === 'normal') {
        await waitForNativeReady()
        await act(async () => {
          fireEvent.click(screen.getByText('Web 对照'))
        })
      } else if (path === 'failure') {
        await act(async () => {
          alertButton('返回原阅读模式').onPress?.()
        })
      } else {
        await act(async () => {
          fireEvent.click(screen.getByText('Web 对照'))
          close.resolve({ status: 'closed' })
          await close.promise
        })
      }

      await waitFor(() => {
        expect(screen.getByTestId('web-reader')).toHaveAttribute(
          'data-generation',
          String((oldGeneration ?? 0) + 1)
        )
      })
      expect(host.outerProps?.sessionId).not.toBe(oldProps?.sessionId)
      expect(screen.getByTestId('web-reader')).toHaveTextContent('web-live')
      expect(
        screen.queryByText('WebView 未完成握手（8 秒超时）')
      ).not.toBeInTheDocument()
      expect(oldProps?.handoff?.canWrite(oldProps.handoff.identity)).toBe(false)
      expect(
        host.outerProps?.handoff?.canWrite(host.outerProps.handoff.identity)
      ).toBe(false)
      await act(async () => {
        oldProps?.handoff?.onReady?.(oldProps.handoff.identity)
      })
      expect(
        host.outerProps?.handoff?.canWrite(host.outerProps.handoff.identity)
      ).toBe(false)
      await act(async () => {
        const current = host.outerProps
        current?.handoff?.onReady?.(current.handoff.identity)
      })
      expect(
        host.outerProps?.handoff?.canWrite(host.outerProps.handoff.identity)
      ).toBe(true)
    }
  )

  it('fences queued stale writes and repeated switch requests', async () => {
    const close = deferred<BridgeCloseResult>()
    host.webClose.mockReturnValue(close.promise)
    const hold = deferred<void>()
    const fixture = createTransactionStore(makeRecord(), {
      holdNextUpdate: hold
    })
    const { onBack } = await mountScreen(fixture.store)
    const oldWeb = host.outerProps
    const switchButton = screen.getByText('原生 PDF 验证')
    await act(async () => {
      fireEvent.click(switchButton)
      fireEvent.click(switchButton)
      await Promise.resolve()
    })
    expect(host.native.onPdfEvent).toBeTypeOf('function')
    expect(host.webClose).toHaveBeenCalledTimes(1)
    expect(host.nativeMounts).toBe(1)
    await loadNative()
    await act(async () => {
      close.resolve({ status: 'closed' })
      await close.promise
    })
    await waitForNativeReady()
    const oldNative = host.web.injectedJavaScriptBeforeContentLoaded
    expect(oldNative).toContain('handoff-')

    await submitCrop()
    await waitFor(() => expect(fixture.updateSnapshot).toHaveBeenCalledTimes(1))
    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
      fireEvent.click(screen.getByText('Web 对照'))
    })
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
    await act(async () => {
      hold.resolve()
      await hold.promise
    })
    await waitFor(() => {
      expect(screen.getByTestId('web-reader')).toHaveAttribute(
        'data-generation',
        '1'
      )
    })
    expect(fixture.updateSnapshot).toHaveBeenCalledTimes(1)
    expect(oldWeb?.handoff?.canWrite(oldWeb.handoff.identity)).toBe(false)
    expect(() =>
      oldWeb?.handoff?.assertWriter(oldWeb.handoff.identity)
    ).toThrow(/not-ready|stale|lease/)

    host.webClose.mockResolvedValue({ status: 'closed' })
    const currentWeb = host.outerProps
    await act(async () => {
      currentWeb?.handoff?.onReady?.(currentWeb.handoff.identity)
    })
    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
      fireEvent.click(screen.getByText('返回'))
    })
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(host.webClose).toHaveBeenCalledTimes(2)
  })

  it('isolates stale writer callbacks when the file identity changes', async () => {
    host.webClose.mockResolvedValue({ status: 'closed' })
    const first = makeRecord('file-a')
    const second = makeRecord('file-b')
    const firstFixture = createTransactionStore(first)
    const secondFixture = createTransactionStore(second)
    const onBack = vi.fn()
    const props = {
      entryUrl: 'file:///unused/index.html',
      baseUrl: 'file:///unused/',
      onBack,
      onRecordUpdated: vi.fn()
    }
    const view = render(
      <ReaderScreen record={first} store={firstFixture.store} {...props} />
    )
    await screen.findByTestId('web-reader')
    const old = host.outerProps

    await act(async () => {
      view.rerender(
        <ReaderScreen record={second} store={secondFixture.store} {...props} />
      )
    })
    await screen.findByText('file-b.pdf')
    expect(host.outerProps?.handoff?.identity.fileId).toBe('file-b')
    await act(async () => {
      old?.handoff?.onReady?.(old.handoff.identity)
    })
    expect(old?.handoff?.canWrite(old.handoff.identity)).toBe(false)
    expect(() => old?.handoff?.assertWriter(old.handoff.identity)).toThrow(
      /stale|lease/
    )
    const current = host.outerProps
    expect(current?.handoff?.canWrite(current.handoff.identity)).toBe(true)
    expect(firstFixture.updateSnapshot).not.toHaveBeenCalled()
    expect(secondFixture.updateSnapshot).not.toHaveBeenCalled()
  })
})
