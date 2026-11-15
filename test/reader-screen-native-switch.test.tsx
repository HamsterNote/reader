import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ReactNode
} from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Alert } from 'react-native'
import { ReaderScreen } from '../app/src/screens/ReaderScreen'
import type { BridgeCloseResult } from '../src/bridge/hostSession'
import type { HostDocumentRecord } from '../src/host/readerDataStore'

const host = vi.hoisted(() => ({
  webClose: vi.fn<() => Promise<BridgeCloseResult>>(),
  nativeClose: vi.fn<() => Promise<BridgeCloseResult>>(),
  webError: false
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
    const [error] = useState(host.webError)
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
    let content = 'web-live'
    if (error) content = 'WebView 未完成握手（8 秒超时）'
    if (closed) content = 'web-disposed'
    return <div data-testid='web-reader'>{content}</div>
  })
}))
vi.mock('../app/src/components/NativePdfReader', () => ({
  NativePdfReader: forwardRef(function MockNativePdfReader(_props, ref) {
    useImperativeHandle(ref, () => ({ close: host.nativeClose }), [])
    return <div data-testid='native-reader' />
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
    Pressable: ({
      children,
      onPress
    }: {
      children?: ReactNode
      onPress?: () => void
    }) => <button onClick={onPress}>{children}</button>,
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: Container,
    View: Container
  }
})
vi.mock('../app/src/native/documents', () => ({
  pickLegacyJsonAndImport: vi.fn()
}))

const record: HostDocumentRecord = {
  fileId: 'two-hundred-pages',
  fileName: 'two-hundred-pages.pdf',
  format: 'pdf',
  size: 1,
  modifiedAt: 0,
  importedAt: 0,
  cachedUri: 'two-hundred-pages.pdf',
  snapshot: { revision: 0, data: null, progress: null }
}

async function mountScreen(onBack = vi.fn()) {
  render(
    <ReaderScreen
      record={record}
      store={{} as never}
      entryUrl='file:///session/index.html'
      baseUrl='file:///session/'
      onBack={onBack}
      onRecordUpdated={vi.fn()}
    />
  )
  return screen.findByTestId('web-reader')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.stubGlobal('__DEV__', true)
  host.webError = false
  host.webClose.mockReset()
  host.nativeClose.mockReset()
  host.nativeClose.mockResolvedValue({ status: 'closed' })
  vi.mocked(Alert.alert).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ReaderScreen native PDF entry', () => {
  it('mounts native reading for a 200-page document while the old Web close is pending', async () => {
    const close = deferred<BridgeCloseResult>()
    host.webClose.mockReturnValue(close.promise)
    await mountScreen()

    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
    expect(host.webClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      close.resolve({ status: 'closed' })
      await close.promise
    })
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  it('keeps native reading available through a delayed close timeout', async () => {
    host.webClose.mockImplementation(
      () =>
        new Promise<BridgeCloseResult>((resolve) => {
          setTimeout(
            () =>
              resolve({
                status: 'unconfirmed',
                reason: '关闭超时：仍有未确认写入未落盘'
              }),
            10000
          )
        })
    )
    await mountScreen()
    vi.useFakeTimers()

    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
    expect(screen.getByTestId('web-reader')).toBeInTheDocument()
    expect(Alert.alert).toHaveBeenCalled()
  })

  it('retains an unconfirmed Web session for retry instead of discarding writes', async () => {
    host.webClose
      .mockResolvedValueOnce({ status: 'unconfirmed', reason: 'close timeout' })
      .mockResolvedValueOnce({ status: 'closed' })
    await mountScreen()

    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
    expect(screen.getByTestId('web-reader')).toBeInTheDocument()
    expect(Alert.alert).toHaveBeenCalledWith(
      '旧 Web 数据尚未保存',
      expect.stringContaining('原生阅读已打开'),
      expect.any(Array)
    )

    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2]
    await act(async () => {
      buttons?.[0]?.onPress?.()
    })
    expect(host.webClose).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('web-reader')).not.toBeInTheDocument()
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
  })

  it('keeps quick native and pdfjs switching intact', async () => {
    host.webClose.mockResolvedValue({ status: 'closed' })
    await mountScreen()

    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
    })
    expect(host.nativeClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('web-reader')).toBeInTheDocument()
    expect(screen.queryByTestId('native-reader')).not.toBeInTheDocument()
  })
})

describe('ReaderScreen mode close races', () => {
  it('ignores a late Web close result after returning to pdfjs', async () => {
    const close = deferred<BridgeCloseResult>()
    host.webClose.mockReturnValue(close.promise)
    await mountScreen()

    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
    })
    expect(screen.getByTestId('web-reader')).toBeInTheDocument()

    await act(async () => {
      close.resolve({ status: 'closed' })
      await close.promise
    })
    expect(screen.getByTestId('web-reader')).toBeInTheDocument()
    expect(screen.queryByTestId('native-reader')).not.toBeInTheDocument()
    expect(Alert.alert).not.toHaveBeenCalled()
  })
})

describe('irreversible Web close races', () => {
  it('returns to a live Web session after the retiring close completes', async () => {
    const close = deferred<BridgeCloseResult>()
    host.webClose.mockReturnValue(close.promise)
    await mountScreen()
    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
    })
    await act(async () => {
      close.resolve({ status: 'closed' })
      await close.promise
    })
    expect(screen.getByTestId('web-reader')).toHaveTextContent('web-live')
  })

  it('closes a native session mounted while library return is awaiting Web', async () => {
    const close = deferred<BridgeCloseResult>()
    host.webClose.mockReturnValue(close.promise)
    const onBack = vi.fn()
    await mountScreen(onBack)
    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    expect(screen.getByTestId('native-reader')).toBeInTheDocument()
    await act(async () => {
      close.resolve({ status: 'closed' })
      await close.promise
    })
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(host.nativeClose).toHaveBeenCalled()
  })
})

describe('stale Web error recovery', () => {
  it('creates a fresh generation without the old handshake error on return', async () => {
    host.webError = true
    host.webClose.mockResolvedValue({ status: 'closed' })
    await mountScreen()
    expect(
      screen.getByText('WebView 未完成握手（8 秒超时）')
    ).toBeInTheDocument()

    host.webError = false
    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Web 对照'))
    })
    expect(screen.getByTestId('web-reader')).toHaveTextContent('web-live')
    expect(
      screen.queryByText('WebView 未完成握手（8 秒超时）')
    ).not.toBeInTheDocument()
  })

  it('does not block native library return on a stale Web unconfirmed error', async () => {
    const onBack = vi.fn()
    host.webClose.mockResolvedValue({
      status: 'unconfirmed',
      reason: '关闭超时：仍有未确认写入未落盘'
    })
    await mountScreen(onBack)
    await act(async () => {
      fireEvent.click(screen.getByText('原生 PDF 验证'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('返回'))
    })

    expect(host.nativeClose).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(host.webClose).toHaveBeenCalledTimes(1)
  })
})
