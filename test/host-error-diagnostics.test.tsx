import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { WebViewProps } from 'react-native-webview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppErrorBoundary } from '../app/src/components/AppErrorBoundary'
import { ReaderWebView } from '../app/src/components/ReaderWebView'
import { ReaderRootErrorBoundary } from '../webview/src/ReaderRootErrorBoundary'
import { ReaderDataStore } from '../src/host/readerDataStore'
import type { HostDocumentRecord } from '../src/host/readerDataStore'

const native = vi.hoisted(() => ({
  props: {} as WebViewProps,
  mounts: 0,
  dispose: vi.fn(),
  handleRawMessage: vi.fn(async () => ({ accepted: true }))
}))

// These tests exercise React state and callback wiring. Native event delivery
// itself still requires an iOS/Android device.
vi.mock('react-native', () => {
  const Container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  )
  return {
    View: Container,
    SafeAreaView: Container,
    ScrollView: Container,
    Text: ({ children, role }: { children?: ReactNode; role?: string }) => (
      <span role={role}>{children}</span>
    ),
    TouchableOpacity: ({
      children,
      onPress
    }: {
      children?: ReactNode
      onPress?: () => void
    }) => <button onClick={onPress}>{children}</button>,
    ActivityIndicator: () => <span>loading</span>,
    AppState: { addEventListener: () => ({ remove: vi.fn() }) },
    Alert: { alert: vi.fn() },
    Linking: { openURL: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} }
  }
})

vi.mock('react-native-webview', async () => {
  const { forwardRef, useEffect } = await import('react')
  return {
    WebView: forwardRef(function MockWebView(props: WebViewProps, _ref) {
      native.props = props
      useEffect(() => {
        native.mounts++
      }, [])
      return <div data-testid='webview' />
    })
  }
})

vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-id' }))
vi.mock('../src/host/readerHostSession', () => ({
  createReaderHostSession: () => ({
    handleRawMessage: native.handleRawMessage,
    dispose: native.dispose
  })
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('__DEV__', true)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  native.mounts = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function BrokenOutsidePdf(): ReactNode {
  throw new Error('Toolbar failed outside PDF page')
}

describe.each([
  ['app', AppErrorBoundary, 'Reader app root render error'],
  ['web', ReaderRootErrorBoundary, 'Reader web root render error']
] as const)('%s root boundary', (_runtime, Boundary, logLabel) => {
  it('passes healthy children through', () => {
    render(
      <Boundary>
        <span>healthy library / reader</span>
      </Boundary>
    )
    expect(screen.getByText('healthy library / reader')).toBeVisible()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('shows the error and development component stack, and logs both', () => {
    render(
      <Boundary>
        <BrokenOutsidePdf />
      </Boundary>
    )
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByText(/Toolbar failed outside PDF page/)).toBeVisible()
    expect(screen.getByText(/at BrokenOutsidePdf/)).toBeVisible()
    expect(console.error).toHaveBeenCalledWith(
      logLabel,
      expect.objectContaining({ message: 'Toolbar failed outside PDF page' }),
      expect.stringContaining('BrokenOutsidePdf')
    )
  })

  it('hides component stack in production but keeps it in the log', () => {
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('DEV', false)
    render(
      <Boundary>
        <BrokenOutsidePdf />
      </Boundary>
    )
    expect(screen.getByText(/Toolbar failed outside PDF page/)).toBeVisible()
    expect(screen.queryByText(/at BrokenOutsidePdf/)).toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      logLabel,
      expect.any(Error),
      expect.stringContaining('BrokenOutsidePdf')
    )
  })
})

const record: HostDocumentRecord = {
  fileId: 'f_0123456789abcdef0123456789abcdef',
  fileName: 'book.pdf',
  format: 'pdf',
  size: 10,
  modifiedAt: 0,
  cachedUri: 'book.pdf',
  importedAt: 0,
  snapshot: { data: null, progress: null, revision: 0 }
}

function renderHost() {
  const store = new ReaderDataStore({
    read: async () => null,
    write: async () => undefined,
    remove: async () => undefined
  })
  return render(
    <ReaderWebView
      record={record}
      store={store}
      entryUrl='file:///reader/index.html'
      baseUrl='file:///reader/'
      publicationUrl='file:///reader/book.pdf'
    />
  )
}

// WebView only reads nativeEvent here; no native dispatcher in jsdom.
function event<T>(nativeEvent: T) {
  return { nativeEvent } as import('react-native').NativeSyntheticEvent<T>
}

const navigation = {
  url: 'file:///reader/index.html',
  loading: false,
  title: '',
  canGoBack: false,
  canGoForward: false,
  navigationType: 'other' as const,
  lockIdentifier: 0
}

describe('WebView host diagnostics', () => {
  it.each([
    [
      'onError',
      () =>
        native.props.onError?.(
          event({
            ...navigation,
            code: -1001,
            domain: 'NSURLErrorDomain',
            description: 'Timed out'
          })
        ),
      'Timed out (code=-1001, domain=NSURLErrorDomain)'
    ],
    [
      'onHttpError',
      () =>
        native.props.onHttpError?.(
          event({
            ...navigation,
            statusCode: 503,
            description: 'Service unavailable'
          })
        ),
      'HTTP 503: Service unavailable'
    ],
    [
      'onContentProcessDidTerminate',
      () => native.props.onContentProcessDidTerminate?.(event(navigation)),
      'iOS WebView 内容进程已终止'
    ],
    [
      'onRenderProcessGone',
      () => native.props.onRenderProcessGone?.(event({ didCrash: true })),
      'didCrash=true'
    ],
    [
      'onRenderProcessGone',
      () => native.props.onRenderProcessGone?.(event({ didCrash: false })),
      'didCrash=false'
    ]
  ] as const)(
    '%s is visible and logged, survives later events, clears only on reload',
    async (type, fail, description) => {
      vi.useFakeTimers()
      renderHost()
      act(fail)
      expect(screen.getByRole('alert')).toHaveTextContent(type)
      expect(screen.getByRole('alert')).toHaveTextContent(description)
      expect(console.error).toHaveBeenCalledWith(
        'Reader WebView host error',
        expect.stringContaining(description)
      )
      act(() => {
        native.props.onLoadEnd?.(event(navigation))
        vi.advanceTimersByTime(8000)
      })
      await act(async () => {
        await native.props.onMessage?.(
          event({
            ...navigation,
            data: 'late bridge response'
          })
        )
      })
      expect(screen.getByRole('alert')).toHaveTextContent(description)
      expect(native.mounts).toBe(1)
      fireEvent.click(screen.getByText('重载 WebView'))
      expect(screen.queryByRole('alert')).toBeNull()
      expect(native.mounts).toBe(2)
      // Reload retains the host session and its confirmed snapshot.
      expect(native.dispose).not.toHaveBeenCalled()
    }
  )

  it('shows a process exit after a successful connection', async () => {
    renderHost()
    await act(async () => {
      await native.props.onMessage?.(event({ ...navigation, data: 'ready' }))
    })
    expect(screen.queryByText('正在加载阅读资源…')).toBeNull()
    act(() => native.props.onRenderProcessGone?.(event({ didCrash: true })))
    expect(screen.getByRole('alert')).toHaveTextContent('didCrash=true')
  })
})
