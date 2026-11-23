import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import type { WebViewProps } from 'react-native-webview'
import { Alert } from 'react-native'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrainPair } from './helpers/bridge-drain'
import { startNativePdfSurface } from '../webview/src/nativePdf'
import { nativeCanonicalPageFromOcr } from '../src/nativePdf/ocr'
import {
  ReaderScreen as ReaderScreenContent,
  type ReaderScreenHandle,
  type ReaderScreenHeaderState,
  type ReaderScreenProps
} from '../app/src/screens/ReaderScreen'
import * as pdfRouting from '../src/nativePdf/routing'
import type { ReaderWebViewHandle } from '../app/src/components/ReaderWebView'
import type { ReaderPdfViewProps } from '../app/modules/reader-pdf'
import type {
  BridgeCloseResult,
  BridgeHostSnapshot
} from '../src/bridge/hostSession'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../src/host/readerDataStore'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../src/host/readerSnapshot'
import type {
  PdfCommand,
  PdfIdentity,
  PdfCanonicalPage
} from '../src/nativePdf/contracts'

type TestBinding = {
  readonly identity: PdfIdentity
  readonly canWrite: (identity: PdfIdentity) => boolean
  readonly assertWriter: (identity: PdfIdentity) => void
  readonly onReady?: (identity: PdfIdentity) => void
}

type OuterWebProps = {
  readonly handoff?: TestBinding
  readonly sessionId?: string
}

function ReaderScreen(props: ReaderScreenProps) {
  const handle = useRef<ReaderScreenHandle>(null)
  const [header, setHeader] = useState<ReaderScreenHeaderState>({
    title: props.record.fileName,
    canToggleLayout: true,
    nativePdf: false,
    canImportLegacy: true
  })
  const updateHeader = useCallback(
    (_paneId: string, state: ReaderScreenHeaderState) => setHeader(state),
    []
  )
  return (
    <>
      <ReaderScreenContent
        {...props}
        ref={handle}
        onHeaderStateChange={updateHeader}
      />
      <span>{header.title}</span>
      <button onClick={() => handle.current?.close(false)}>返回</button>
      {header.canToggleLayout ? (
        <button onClick={() => handle.current?.toggleLayout()}>
          {header.nativePdf ? 'Text' : 'Layout'}
        </button>
      ) : null}
      {__DEV__ && header.canToggleLayout ? (
        <button onClick={() => handle.current?.toggleDebugRenderer()}>
          {header.nativePdf ? 'Web 对照' : '原生 PDF 验证'}
        </button>
      ) : null}
      <button
        disabled={!header.canImportLegacy}
        onClick={() => handle.current?.importLegacy()}
      >
        导入旧数据
      </button>
    </>
  )
}

const host = vi.hoisted(() => ({
  web: {} as WebViewProps,
  outerProps: null as OuterWebProps | null,
  native: {} as ReaderPdfViewProps,
  commands: [] as PdfCommand[],
  post: vi.fn(),
  webClose:
    vi.fn<(props: OuterWebProps | undefined) => Promise<BridgeCloseResult>>(),
  webDiscard: vi.fn<() => Promise<BridgeCloseResult>>(),
  sequence: 0,
  webError: false,
  nativeMounts: 0,
  nativeUnmounts: 0
}))

vi.mock('../app/src/native/webAssets', () => ({
  stageReaderDocument: vi.fn(async () => ({
    baseUrl: 'file:///session/',
    entryUrl: 'file:///session/index.html',
    publicationUrl: 'file:///session/publication.pdf'
  }))
}))
vi.mock('../app/src/components/ReaderWebView', () => ({
  ReaderWebView: forwardRef<ReaderWebViewHandle, OuterWebProps>(
    function MockReaderWebView(props, ref) {
      const [closed, setClosed] = useState(false)
      host.outerProps = props
      useImperativeHandle(ref, () => ({
        discardUnconfirmed: async () => {
          const result = await host.webDiscard()
          if (result.status === 'closed') setClosed(true)
          return result
        },
        close: async () => {
          const result = await host.webClose(props)
          if (result.status === 'closed') setClosed(true)
          return result
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
  const Container = ({
    children,
    style
  }: {
    children?: ReactNode
    style?: CSSProperties
  }) => <div style={style}>{children}</div>
  return {
    ActivityIndicator: () => <div>loading</div>,
    Alert: { alert: vi.fn() },
    BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
    View: Container,
    Text: Container,
    ScrollView: Container,
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
    Platform: { OS: 'ios' },
    Linking: { openURL: vi.fn() },
    AppState: { addEventListener: () => ({ remove: vi.fn() }) }
  }
})
vi.mock('react-native-webview', async () => {
  const { forwardRef: forward, useImperativeHandle: imperative } =
    await import('react')
  return {
    WebView: forward(function TestWebView(props: WebViewProps, ref) {
      host.web = props
      imperative(ref, () => ({ postMessage: host.post }), [])
      return null
    })
  }
})
vi.mock('../app/modules/reader-pdf', () => ({
  readerPdfModule: {},
  ReaderPdfView: (props: ReaderPdfViewProps) => {
    host.native = props
    useEffect(() => {
      host.nativeMounts += 1
      return () => {
        host.nativeUnmounts += 1
      }
    }, [])
    const command = props.command as PdfCommand | null | undefined
    if (command && host.commands.at(-1)?.requestId !== command.requestId) {
      host.commands.push(command)
    }
    return <div data-testid='native-pdf-view' />
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

const pdf = vi.hoisted(() => ({ terminate: vi.fn() }))
vi.mock('../src/pdf/pdfDocumentSession', () => ({
  PdfDocumentSession: {
    open: async () => ({
      document: { numPages: 200, getOutline: async () => null },
      dispose: async () => undefined
    })
  }
}))
vi.mock('../webview/src/pdfWorker', () => ({
  createPdfWorkerFromAsset: async () => ({ terminate: pdf.terminate })
}))
vi.mock('../webview/src/packagedAsset', () => ({
  readPackagedAsset: async () => new ArrayBuffer(1)
}))
vi.mock('../webview/src/pdfAssets', () => ({ packagedPdfOptions: {} }))
vi.mock('../src/pdf/pdfjsRuntime', () => ({ GlobalWorkerOptions: {} }))
vi.mock('../src/nativePdf/textGeometry', () => ({
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
vi.mock('../demo/CommentPanel', () => ({ CommentPanel: () => null }))
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
  // This suite exercises the retained manual Web -> native comparison path.
  vi.spyOn(pdfRouting, 'usesNativePdfLayout').mockReturnValue(false)
  host.commands = []
  host.web = {} as WebViewProps
  host.outerProps = null
  host.native = {} as ReaderPdfViewProps
  host.post.mockClear()
  host.webClose.mockReset()
  host.webDiscard.mockReset()
  host.sequence = 0
  host.webError = false
  host.nativeMounts = 0
  host.nativeUnmounts = 0
  vi.stubGlobal('__DEV__', true)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ReaderScreen native handoff regressions', () => {
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

describe('independent review: close failure feedback', () => {
  it('offers retry after native close fails', async () => {
    host.webClose.mockResolvedValue({ status: 'closed' })
    const fixture = createTransactionStore(makeRecord(), {
      failNextUpdate: true
    })
    const { onBack } = await mountScreen(fixture.store)
    await switchToNative()
    await loadNative()
    await waitForNativeReady()
    await submitCrop()
    await screen.findByText(/disk full/)
    vi.mocked(Alert.alert).mockClear()
    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()
    expect(Alert.alert).toHaveBeenCalledTimes(1)
    expect(Alert.alert).toHaveBeenCalledWith(
      '原生数据尚未保存',
      expect.any(String),
      expect.any(Array)
    )
    await act(async () => {
      alertButton('重试保存').onPress?.()
    })
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
    expect(
      restoreReaderSnapshot(
        (await fixture.store.get('handoff-document'))!.snapshot.data
      ).data.edgeCrop?.all?.top
    ).toBe(0.05)
    expect(Alert.alert).toHaveBeenCalledTimes(1)
  })
})

describe('independent review: read-only popover', () => {
  it('rejects optimistic annotation commands while old Web still owns lease', async () => {
    const close = deferred<BridgeCloseResult>()
    host.webClose.mockReturnValue(close.promise)
    const fixture = createTransactionStore(makeRecord())
    await mountScreen(fixture.store)
    await switchToNative()
    const identity = await loadNative()
    const premature = {
      id: 'premature-range',
      text: 'hi',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 2 }
    }
    await act(async () => {
      host.web.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            ...identity,
            type: 'command',
            command: {
              ...identity,
              requestId: 'web-premature',
              type: 'annotations',
              ranges: [premature]
            }
          })
        }
      } as Parameters<NonNullable<WebViewProps['onMessage']>>[0])
    })
    await drainCommands(identity)
    await act(async () => {
      host.web.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            ...identity,
            type: 'snapshot',
            commitId: 'premature-commit',
            data: {
              ...(makeRecord().snapshot.data as object),
              annotations: {
                version: 5,
                ranges: [premature],
                rects: [],
                paintings: {}
              }
            }
          })
        }
      } as Parameters<NonNullable<WebViewProps['onMessage']>>[0])
    })
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    const painted = host.commands.filter(
      (c) =>
        c.type === 'annotations' &&
        'ranges' in c &&
        c.ranges?.some((r) => r.id === 'premature-range')
    )
    expect(painted).toHaveLength(0)
    await act(async () => {
      close.resolve({ status: 'closed' })
      await close.promise
    })
  })
})

// Runs the real Web Popover and its optimistic commit across the RN boundary.
// Messages are queued like postMessage, so rejection arrives after commit().
describe('real Popover handoff feedback', () => {
  const peers: ReturnType<typeof createDrainPair>[] = []
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
  let outbox: string[] = []
  let surfaceIdentity: PdfIdentity | undefined
  function receive(body: Record<string, unknown>) {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ ...body, identity: surfaceIdentity })
      })
    )
  }
  async function flushWebMessages() {
    await act(async () => {
      while (outbox.length)
        host.web.onMessage?.({
          nativeEvent: { data: outbox.shift()! }
        } as Parameters<NonNullable<WebViewProps['onMessage']>>[0])
    })
  }
  async function openSurface(
    snapshot: BridgeHostSnapshot,
    identity: PdfIdentity
  ) {
    surfaceIdentity = identity
    const container = document.createElement('div')
    container.id = 'reader'
    document.body.append(container)
    outbox = []
    window.ReactNativeWebView = {
      postMessage: (raw: string) => {
        outbox.push(raw)
      }
    }
    host.post.mockImplementation((raw: string) =>
      window.dispatchEvent(new MessageEvent('message', { data: raw }))
    )
    await act(async () =>
      startNativePdfSurface({
        ...identity,
        canEdit: false,
        snapshot: snapshot.data,
        progress: snapshot.progress,
        publicationUrl: 'file:///publication.pdf'
      })
    )
    await flushWebMessages()
  }
  async function closeSurface() {
    if (!surfaceIdentity) return
    await act(async () => receive({ type: 'dispose' }))
    document.getElementById('reader')?.remove()
    surfaceIdentity = undefined
    host.post.mockReset()
    delete window.ReactNativeWebView
  }
  async function selectText(rangeId?: string) {
    await act(async () =>
      receive({
        type: 'nativeSelection',
        canonicalPages: [canonical],
        event: {
          ...surfaceIdentity,
          rangeId,
          type: 'selection',
          phase: 'end',
          start: { selectionId: 'page-1', offset: 0 },
          end: { selectionId: 'page-1', offset: 3 },
          anchor: { x: 0, y: 50, width: 30, height: 20 },
          geometryRevision: 1
        }
      })
    )
    await screen.findByRole('button', { name: rangeId ? '删除' : '高亮' })
  }
  afterEach(async () => {
    await closeSurface()
    peers.splice(0).forEach((peer) => peer.dispose())
  })

  it.each(['far-color-to-web', 'cross-delete-to-library'])(
    'completes the full device recovery path: %s',
    async (path) => {
      const far = path === 'far-color-to-web'
      const first = far ? 100 : 1
      const last = far ? 100 : 3
      const range = {
        id: 'device-range',
        createdAt: 1,
        text: 'OCR',
        start: { selectionId: `page-${first}`, offset: 0 },
        end: { selectionId: `page-${last}`, offset: 3 },
        markerStyle: { backgroundColor: '#ffc107' },
        overlayRectType: 'px',
        rectsBySelectionId: Object.fromEntries(
          [...new Set([first, last])].map((page) => [
            `page-${page}`,
            [{ x: 0, y: 50, width: 30, height: 20 }]
          ])
        )
      }
      const original = makeRecord()
      const record = {
        ...original,
        snapshot: {
          ...original.snapshot,
          data: {
            ...(original.snapshot.data as object),
            annotations: {
              version: 5,
              ranges: [range],
              rects: [],
              paintings: {}
            }
          }
        }
      }
      const fixture = createTransactionStore(record)
      const { onBack } = await mountScreen(fixture.store, record)
      const webIdentity = host.outerProps!.handoff!.identity
      const peer = createDrainPair({
        sessionId: webIdentity.sessionId,
        snapshot: fixture.snapshot(),
        quiesce: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          if (
            screen.getByTestId('web-reader').closest('[style*="display: none"]')
          )
            throw new Error('zero viewport before editing')
        }
      })
      peers.push(peer)
      peer.web.start()
      await waitFor(() => expect(peer.web.getRevision()).not.toBeNull())
      host.webClose.mockImplementation(() =>
        peer.host.close(100, { handoff: true })
      )
      await switchToNative()
      const identity = await loadNative(far ? 200 : 3)
      await waitForNativeReady()
      await openSurface(fixture.snapshot(), identity)
      await act(async () =>
        receive({
          type: 'nativeSelection',
          canonicalPages: [...new Set([first, last])]
            .map((pageNumber) => ({
              ...canonical,
              pageNumber
            }))
            .concat(
              far
                ? []
                : [
                    {
                      ...canonical,
                      pageNumber: 2,
                      text: '',
                      glyphs: [],
                      boundaries: [canonical.boundaries[0]]
                    }
                  ]
            ),
          event: {
            ...identity,
            rangeId: range.id,
            type: 'selection',
            phase: 'end',
            start: range.start,
            end: range.end,
            anchor: { x: 0, y: 50, width: 30, height: 20 },
            geometryRevision: 1
          }
        })
      )
      const button = await screen.findByRole('button', {
        name: far ? 'Highlight color #8eba8e' : '删除'
      })
      expect(button).toBeEnabled()
      await act(async () => fireEvent.click(button))
      await flushWebMessages()
      await drainCommands(identity)
      await waitFor(() => {
        const ranges = restoreReaderSnapshot(fixture.snapshot().data).data
          .ranges
        if (far)
          expect(ranges?.[0].markerStyle?.backgroundColor).toBe('#8eba8e')
        else expect(ranges).toEqual([])
      })
      await act(async () =>
        fireEvent.click(screen.getByText(far ? 'Web 对照' : '返回'))
      )
      if (far) {
        await waitFor(() =>
          expect(screen.getByTestId('web-reader')).toHaveAttribute(
            'data-generation',
            '1'
          )
        )
        expect(onBack).not.toHaveBeenCalled()
      } else {
        await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
        expect(
          restoreReaderSnapshot(
            (await fixture.store.get(record.fileId))!.snapshot.data
          ).data.ranges
        ).toEqual([])
      }
      expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
      expect(Alert.alert).not.toHaveBeenCalled()
    }
  )

  it('rolls back a rejected real Popover highlight and reopens without it; saves after lease grant', async () => {
    const close = deferred<BridgeCloseResult>()
    host.webClose.mockReturnValue(close.promise)
    const fixture = createTransactionStore(makeRecord())
    await mountScreen(fixture.store)
    await switchToNative()
    const identity = await loadNative()
    await openSurface(fixture.snapshot(), identity)
    await selectText()
    expect(screen.getByRole('button', { name: '高亮' })).toBeDisabled()
    expect(screen.getByText('只读：等待权威数据与写权就绪')).toBeVisible()

    // Simulate a capability update still in flight when the writer is revoked.
    // The real Popover commits optimistically; the host remains authoritative.
    await act(async () =>
      receive({
        type: 'editing-state',
        canEdit: true,
        snapshot: fixture.snapshot().data
      })
    )
    await selectText()
    host.post.mockClear()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '高亮' }))
    )
    const submitted = outbox.map(
      (raw) => JSON.parse(raw) as { type: string; data?: unknown }
    )
    const optimistic = submitted.find((message) => message.type === 'snapshot')!
    expect(restoreReaderSnapshot(optimistic.data).data.ranges).toHaveLength(1)
    await flushWebMessages()
    await drainCommands(identity)
    expect(fixture.updateSnapshot).not.toHaveBeenCalled()
    expect(
      host.commands
        .filter((c) => c.type === 'annotations')
        .every((c) => c.type === 'annotations' && c.ranges.length === 0)
    ).toBe(true)
    expect(host.native.command).toMatchObject({
      type: 'selection',
      range: null
    })
    expect(screen.getByText(/编辑未保存.*已恢复已确认内容/)).toBeInTheDocument()
    const resets = host.post.mock.calls.map(
      ([raw]) =>
        JSON.parse(raw as string) as {
          type: string
          canEdit?: boolean
          snapshot?: unknown
        }
    )
    expect(resets.filter((m) => m.type === 'editing-state')).toHaveLength(1)
    expect(
      restoreReaderSnapshot(
        resets.filter((m) => m.type === 'editing-state').at(-1)!.snapshot
      ).data.ranges
    ).toEqual([])
    await selectText()
    expect(screen.getByRole('button', { name: '高亮' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: '删除' })
    ).not.toBeInTheDocument()
    await closeSurface()

    const reopened = (await fixture.store.get('handoff-document'))!.snapshot
    expect(restoreReaderSnapshot(reopened.data).data.ranges).toEqual([])
    await openSurface(reopened, identity)
    await selectText()
    expect(
      screen.queryByRole('button', { name: '删除' })
    ).not.toBeInTheDocument()
    await act(async () => {
      close.resolve({ status: 'closed' })
      await close.promise
    })
    await waitForNativeReady()
    await selectText()
    expect(screen.getByRole('button', { name: '高亮' })).toBeEnabled()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '高亮' }))
    )
    await flushWebMessages()
    await waitFor(() => expect(fixture.updateSnapshot).toHaveBeenCalledTimes(1))
    const saved = (await fixture.store.get('handoff-document'))!.snapshot
    expect(saved.revision).toBeGreaterThan(reopened.revision)
    expect(restoreReaderSnapshot(saved.data).data.ranges).toHaveLength(1)
    await closeSurface()
    await openSurface(saved, identity)
    await selectText(restoreReaderSnapshot(saved.data).data.ranges![0].id)
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled()
  })
})

describe('device Web close regressions with real bridge peers', () => {
  const peers: ReturnType<typeof createDrainPair>[] = []
  afterEach(() => peers.splice(0).forEach((p) => p.dispose()))
  it('requires explicit confirmation to discard, then restores saved data in a fresh Web', async () => {
    const fixture = createTransactionStore(makeRecord())
    const { onBack } = await mountScreen(fixture.store)
    const identity = host.outerProps!.handoff!.identity
    const peer = createDrainPair({
      sessionId: identity.sessionId,
      snapshot: fixture.snapshot(),
      quiesce: async () => {
        throw new Error('progress did not stabilize')
      },
      persist: (snapshot) =>
        fixture.store
          .updateSnapshot('handoff-document', () => snapshot)
          .then(() => undefined)
    })
    peers.push(peer)
    peer.web.start()
    await waitFor(() => expect(peer.web.getRevision()).not.toBeNull())
    peer.web.sendChange({ readerData: { hiddenPages: [2] } })
    await waitFor(() => expect(peer.web.getPendingCount()).toBe(0))
    host.webClose.mockImplementation(() =>
      peer.host.close(30, { handoff: true })
    )
    host.webDiscard.mockImplementation(async () => {
      await peer.host.discardUnconfirmed()
      return { status: 'closed' }
    })
    await switchToNative()
    await loadNative()
    await act(async () => {
      await host.webClose.mock.results[0].value
    })
    await act(async () => alertButton('放弃未确认内容…').onPress?.())
    expect(Alert.alert).toHaveBeenCalledWith(
      '放弃未确认内容？',
      expect.stringContaining('可能丢失'),
      expect.anything()
    )
    // Cancel keeps the native view and all unconfirmed content in place.
    await act(async () => alertButton('继续保留并重试').onPress?.())
    expect(host.webDiscard).not.toHaveBeenCalled()
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
    await act(async () => alertButton('放弃未确认内容…').onPress?.())
    await act(async () => alertButton('放弃并返回原阅读模式').onPress?.())
    await waitFor(() =>
      expect(screen.getByTestId('web-reader')).toHaveAttribute(
        'data-generation',
        '1'
      )
    )
    expect(screen.queryByTestId('native-pdf-view')).not.toBeInTheDocument()
    expect(host.webDiscard).toHaveBeenCalledTimes(1)
    expect(onBack).not.toHaveBeenCalled()
    expect(
      restoreReaderSnapshot(fixture.snapshot().data).data.hiddenPages
    ).toEqual([2])
    expect(host.outerProps!.handoff!.identity.sessionId).not.toBe(
      identity.sessionId
    )
  })

  it('ignores a discard confirmation from a failure that has since recovered', async () => {
    host.webClose
      .mockResolvedValueOnce({
        status: 'unconfirmed',
        reason: 'missing progress'
      })
      .mockResolvedValueOnce({ status: 'closed' })
    const fixture = createTransactionStore(makeRecord())
    await mountScreen(fixture.store)
    await switchToNative()
    await loadNative()
    await act(async () => alertButton('放弃未确认内容…').onPress?.())
    const staleConfirm = alertButton('放弃并返回原阅读模式')
    await act(async () => alertButton('重试旧 Web 保存').onPress?.())
    await waitForNativeReady()
    await act(async () => staleConfirm.onPress?.())
    expect(host.webDiscard).not.toHaveBeenCalled()
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
  })

  it('finishes the second B to A round trip with the draining Web viewport retained', async () => {
    const records = [makeRecord('A'), makeRecord('B')]
    const fixtures = records.map((r) => createTransactionStore(r))
    const onBack = vi.fn()
    const props = {
      entryUrl: 'file:///unused/index.html',
      baseUrl: 'file:///unused/',
      onBack,
      onRecordUpdated: vi.fn()
    }
    const view = render(
      <ReaderScreen record={records[0]} store={fixtures[0].store} {...props} />
    )
    for (const [turn, index] of [0, 1, 0, 1, 0].entries()) {
      await act(async () =>
        view.rerender(
          <ReaderScreen
            record={records[index]}
            store={fixtures[index].store}
            {...props}
          />
        )
      )
      await screen.findByTestId('web-reader')
      const identity = host.outerProps!.handoff!.identity
      const peer = createDrainPair({
        sessionId: identity.sessionId,
        snapshot: fixtures[index].snapshot(),
        quiesce: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          // WebKit cannot finish geometry/animation-frame readiness in a zero viewport.
          if (
            screen.getByTestId('web-reader').closest('[style*="display: none"]')
          )
            throw new Error('zero Web viewport during stable progress')
        }
      })
      peers.push(peer)
      peer.web.start()
      await waitFor(() => expect(peer.web.getRevision()).not.toBeNull())
      host.webClose.mockImplementation(() =>
        peer.host.close(30, { handoff: true })
      )
      await switchToNative()
      await loadNative()
      await waitForNativeReady()
      expect(Alert.alert).not.toHaveBeenCalledWith(
        '旧 Web 数据尚未保存',
        expect.anything(),
        expect.anything()
      )
      await act(async () => fireEvent.click(screen.getByText('返回')))
      await waitFor(() => expect(onBack).toHaveBeenCalledTimes(turn + 1))
    }
  })

  it('retains native and onBack=0 for a real Web disk failure, then retries and leaves', async () => {
    const fixture = createTransactionStore(makeRecord())
    const { onBack } = await mountScreen(fixture.store)
    let fail = true
    const identity = host.outerProps!.handoff!.identity
    const peer = createDrainPair({
      sessionId: identity.sessionId,
      snapshot: fixture.snapshot(),
      persist: async (snapshot) => {
        if (fail) throw new Error('disk full')
        await fixture.store.updateSnapshot('handoff-document', () => snapshot)
      }
    })
    peers.push(peer)
    peer.web.start()
    await waitFor(() => expect(peer.web.getRevision()).not.toBeNull())
    await act(async () => {
      peer.web.sendChange({ readerData: { hiddenPages: [2] } })
    })
    host.webClose.mockImplementation(() =>
      peer.host.close(30, { handoff: true })
    )
    await switchToNative()
    await loadNative()
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        '旧 Web 数据尚未保存',
        expect.anything(),
        expect.anything()
      )
    )
    await act(async () => fireEvent.click(screen.getByText('返回')))
    await waitFor(() => expect(host.webClose.mock.calls.length).toBe(2))
    expect(screen.getByTestId('native-pdf-view')).toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()
    await act(async () => {
      await host.webClose.mock.results[1].value
    })
    fail = false
    await waitFor(() =>
      expect(
        peer.hostMessages.filter((m) => m.type === 'command')
      ).toHaveLength(2)
    )
    await act(async () => {
      alertButton('重试旧 Web 保存').onPress?.()
    })
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(
      restoreReaderSnapshot(
        (await fixture.store.get('handoff-document'))!.snapshot.data
      ).data.hiddenPages
    ).toEqual([2])
  })
})
