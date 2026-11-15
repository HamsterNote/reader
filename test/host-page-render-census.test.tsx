import { act, cleanup, render } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import type { WebViewProps } from 'react-native-webview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReaderWebView } from '../app/src/components/ReaderWebView'
import type { ReaderWebViewHandle } from '../app/src/components/ReaderWebView'
import {
  pageRenderCensusReply,
  pageRenderCensusRequest,
  recordPageCanvasRender,
  resetPageRenderCensus
} from '../src/pdf/pageRenderCensus'

const host = vi.hoisted(() => ({
  props: {} as WebViewProps,
  postMessage: vi.fn(),
  handleRawMessage: vi.fn(async () => ({ accepted: true }))
}))

vi.mock('react-native', () => {
  const Container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  )
  return {
    View: Container,
    SafeAreaView: Container,
    ScrollView: Container,
    Text: Container,
    TouchableOpacity: Container,
    ActivityIndicator: () => <span>loading</span>,
    AppState: { addEventListener: () => ({ remove: vi.fn() }) },
    Alert: { alert: vi.fn() },
    Linking: { openURL: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} }
  }
})
vi.mock('react-native-webview', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    WebView: forwardRef(function MockWebView(props: WebViewProps, ref) {
      host.props = props
      useImperativeHandle(ref, () => ({ postMessage: host.postMessage }), [])
      return <div data-testid='webview' />
    })
  }
})
vi.mock('expo-crypto', () => ({ randomUUID: () => 'census-test-id' }))
vi.mock('../src/host/readerHostSession', () => ({
  createReaderHostSession: () => ({
    handleRawMessage: host.handleRawMessage,
    dispose: vi.fn()
  })
}))

const record = {
  fileId: 'f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  fileName: 'a.pdf',
  format: 'pdf' as const,
  size: 1,
  modifiedAt: 0,
  importedAt: 0,
  cachedUri: 'a.pdf',
  snapshot: { data: null, progress: null, revision: 0 }
}

async function message(data: unknown) {
  await act(async () => {
    host.props.onMessage?.({
      nativeEvent: { data: JSON.stringify(data) }
    } as Parameters<NonNullable<WebViewProps['onMessage']>>[0])
    await Promise.resolve()
  })
}

beforeEach(() => {
  resetPageRenderCensus()
  host.postMessage.mockClear()
  host.handleRawMessage.mockClear()
  vi.stubGlobal('__DEV__', true)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Web reader page render census round trip (HAM-278 group 1)', () => {
  it('sends the census request into the WebView and logs the real render count back', async () => {
    const ref = createRef<ReaderWebViewHandle>()
    render(
      <ReaderWebView
        ref={ref}
        record={record}
        store={{} as never}
        entryUrl='file:///session/index.html'
        baseUrl='file:///session/'
        publicationUrl='file:///session/publication.pdf'
      />
    )
    act(() => ref.current?.requestPageRenderCensus?.())
    expect(host.postMessage).toHaveBeenCalledWith(pageRenderCensusRequest())
    expect(host.handleRawMessage).not.toHaveBeenCalled()

    // Web 侧真实渲染了 3 次后回包；宿主按 census 日志读取并计入 sessionId。
    recordPageCanvasRender(1)
    recordPageCanvasRender(2)
    recordPageCanvasRender(3)
    await message(JSON.parse(pageRenderCensusReply('req-1')))
    expect(host.handleRawMessage).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledWith(
      'reader-pdf-page-render-census',
      expect.objectContaining({
        renderer: 'web',
        outerWebMounted: true,
        pageCanvasRenders: 3,
        pages: [1, 2, 3],
        sessionId: 'census-test-id'
      })
    )
  })

  it('keeps the session replacement credential out of census diagnostics', async () => {
    render(
      <ReaderWebView
        record={record}
        store={{} as never}
        entryUrl='file:///session/index.html'
        baseUrl='file:///session/'
        publicationUrl='file:///session/publication.pdf'
        sessionId='census-session'
        sourceToken='private-session-credential'
      />
    )
    await message(JSON.parse(pageRenderCensusReply('req-private')))
    const call = vi
      .mocked(console.info)
      .mock.calls.find(([name]) => name === 'reader-pdf-page-render-census')
    expect(call).toBeDefined()
    expect(call?.[1]).not.toHaveProperty('sourceToken')
    expect(JSON.stringify(call?.[1])).not.toContain(
      'private-session-credential'
    )
  })

  it('still forwards ordinary bridge messages to the host session', async () => {
    const ref = createRef<ReaderWebViewHandle>()
    render(
      <ReaderWebView
        ref={ref}
        record={record}
        store={{} as never}
        entryUrl='file:///session/index.html'
        baseUrl='file:///session/'
        publicationUrl='file:///session/publication.pdf'
      />
    )
    await message({ type: 'ready', sessionId: 'census-test-id' })
    expect(host.handleRawMessage).toHaveBeenCalledTimes(1)
    expect(console.info).not.toHaveBeenCalledWith(
      'reader-pdf-page-render-census',
      expect.anything()
    )
  })
})
