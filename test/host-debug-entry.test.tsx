import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostDocumentRecord } from '../src/host/readerDataStore'
import { ReaderDataStore } from '../src/host/readerDataStore'
import { App } from '../app/App'

type ReaderProps = {
  readonly record: HostDocumentRecord
  readonly paneId?: string
  readonly isActivePane?: boolean
  readonly debugCensusToken?: number
  readonly debugHoldSaveToken?: number
  readonly onBack: () => void
  readonly onRecordUpdated: (record: HostDocumentRecord) => void
}

type ReaderHandle = {
  readonly close: () => Promise<
    | { readonly status: 'closed' }
    | { readonly status: 'unconfirmed'; readonly reason: string }
  >
}

const host = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    values,
    storage: {
      read: async (key: string) => values.get(key) ?? null,
      write: async (key: string, value: string) => {
        values.set(key, value)
      },
      remove: async (key: string) => {
        values.delete(key)
      }
    },
    latest: new Map<string, ReaderProps>(),
    close: vi.fn<(paneId: string) => ReturnType<ReaderHandle['close']>>(),
    alert: vi.fn(),
    initialUrl: null as string | null,
    urlListeners: [] as ((event: { url: string }) => void)[],
    pick: vi.fn(),
    packaged: {
      entryUrl: 'file:///session/index.html',
      baseUrl: 'file:///session/'
    }
  }
})

vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
vi.mock('../app/src/native/storage', () => ({
  createFileSystemStorage: () => host.storage
}))
vi.mock('../app/src/native/webAssets', () => ({
  preparePackagedWebReader: vi.fn(async () => host.packaged)
}))
vi.mock('../app/src/native/documents', () => ({
  pickAndCacheDocument: host.pick,
  removeDocument: vi.fn()
}))
vi.mock('../app/src/components/AppErrorBoundary', () => ({
  AppErrorBoundary: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('../app/src/screens/ReaderScreen', () => ({
  ReaderScreen: forwardRef<ReaderHandle, ReaderProps>(
    function MockReaderScreen(props, ref) {
      const [closeFailed, setCloseFailed] = useState(false)
      const close = async () => {
        const result = await host.close(props.paneId ?? 'standalone')
        if (result.status === 'closed') props.onBack()
        else setCloseFailed(true)
        return result
      }
      useImperativeHandle(ref, () => ({ close }))
      if (props.paneId) host.latest.set(props.paneId, props)
      return (
        <div data-testid={`reader-${props.paneId}`}>
          <span>{props.record.fileName}</span>
          <button onClick={props.onBack}>返回{props.paneId}</button>
          {closeFailed ? (
            <button onClick={() => void close()}>
              重试保存:{props.paneId}
            </button>
          ) : null}
        </div>
      )
    }
  )
}))
vi.mock('../app/src/screens/LibraryScreen', () => ({
  LibraryScreen: (props: {
    documents: readonly HostDocumentRecord[]
    onOpenDocument: (summary: HostDocumentRecord) => void
  }) => (
    <div>
      {props.documents.map((document) => (
        <button
          key={document.fileId}
          onClick={() => props.onOpenDocument(document)}
        >
          open:{document.fileName}
        </button>
      ))}
    </div>
  )
}))
vi.mock('react-native', async () => {
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    ActivityIndicator: () => <div>loading</div>,
    Alert: { alert: host.alert },
    Linking: {
      getInitialURL: async () => host.initialUrl,
      addEventListener: (
        _type: string,
        listener: (event: { url: string }) => void
      ) => {
        host.urlListeners.push(listener)
        return { remove: () => undefined }
      }
    },
    Pressable: ({
      children,
      onPress
    }: {
      children?: React.ReactNode
      onPress?: () => void
    }) => <button onClick={onPress}>{children}</button>,
    SafeAreaView: Container,
    ScrollView: Container,
    Text: Container,
    View: Container,
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Platform: { OS: 'ios' }
  }
})

const a: HostDocumentRecord = {
  fileId: 'f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  fileName: 'a.pdf',
  format: 'pdf',
  size: 1024,
  modifiedAt: 1,
  importedAt: 2,
  cachedUri: 'reader-files/f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf',
  snapshot: { data: null, progress: null, revision: 0 }
}
const b: HostDocumentRecord = {
  ...a,
  fileId: 'f_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  fileName: 'b.pdf',
  cachedUri: 'reader-files/f_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf'
}

async function seed(): Promise<void> {
  const store = new ReaderDataStore(host.storage)
  await store.upsert(a)
  await store.upsert(b)
}

function clearEnv(): void {
  delete process.env.EXPO_PUBLIC_HAM278_ROUTE
  delete process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID
  delete process.env.EXPO_PUBLIC_HAM278_OPEN_PDF
  delete process.env.EXPO_PUBLIC_HAM278_LAYOUT
  delete process.env.EXPO_PUBLIC_HAM278_OCR_SEED
}

beforeEach(async () => {
  host.values.clear()
  host.latest.clear()
  host.close.mockReset()
  host.close.mockResolvedValue({ status: 'closed' })
  host.alert.mockClear()
  host.pick.mockReset()
  host.initialUrl = null
  host.urlListeners = []
  clearEnv()
  vi.stubGlobal('__DEV__', true)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  await seed()
})

afterEach(() => {
  cleanup()
  clearEnv()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('demo host split and deep-link debug controls (HAM-290)', () => {
  it('opens one ReaderScreen from the library and exposes the dev split entry', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    expect(screen.getAllByTestId('reader-left')).toHaveLength(1)
    expect(screen.queryByTestId('reader-right')).not.toBeInTheDocument()
    expect(host.latest.get('left')?.record.fileId).toBe(a.fileId)
    expect(host.latest.get('left')?.paneId).toBe('left')
    expect(host.latest.get('left')?.isActivePane).toBe(true)
    expect(screen.getByText('分栏')).toBeInTheDocument()
  })

  it('opens the requested PDF from the launch environment without a picker', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    render(<App />)
    await screen.findByTestId('reader-left')
    expect(screen.queryByText('open:a.pdf')).not.toBeInTheDocument()
    expect(host.pick).not.toHaveBeenCalled()
    expect(host.latest.get('left')?.record.fileId).toBe(a.fileId)
    expect(console.info).toHaveBeenCalledWith(
      'reader-debug-route',
      expect.objectContaining({
        source: 'env',
        target: 'fileId',
        fileId: a.fileId,
        layout: 'single',
        ok: true
      })
    )
  })

  it('mounts two same-file panes with stable paneIds and one active pane', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    process.env.EXPO_PUBLIC_HAM278_LAYOUT = 'split'
    render(<App />)
    await screen.findByTestId('reader-left')
    await screen.findByTestId('reader-right')
    expect(host.latest.get('left')?.record.fileId).toBe(a.fileId)
    expect(host.latest.get('right')?.record.fileId).toBe(a.fileId)
    expect(host.latest.get('left')?.isActivePane).toBe(true)
    expect(host.latest.get('right')?.isActivePane).toBe(false)

    fireEvent.click(screen.getByText('活动：左栏'))
    await waitFor(() =>
      expect(host.latest.get('right')?.isActivePane).toBe(true)
    )
    expect(host.latest.get('left')?.isActivePane).toBe(false)

    fireEvent.click(screen.getByText('单栏'))
    await waitFor(() =>
      expect(screen.queryByTestId('reader-left')).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('reader-right')).toHaveTextContent('a.pdf')
    expect(host.latest.get('right')?.isActivePane).toBe(true)
  })

  it('replaces the configured record while reading so the save barrier runs', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    fireEvent.click(screen.getByText('换源'))
    fireEvent.click(screen.getByText('b.pdf'))
    await waitFor(() =>
      expect(host.latest.get('left')?.record.fileId).toBe(b.fileId)
    )
    expect(screen.getAllByTestId('reader-left')).toHaveLength(1)
    expect(screen.getByTestId('reader-left')).toHaveTextContent('b.pdf')
  })

  it('requests page census and held saves from the debug bar', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    fireEvent.click(screen.getByText('渲染计数'))
    await waitFor(() =>
      expect(host.latest.get('left')?.debugCensusToken).toBe(1)
    )
    fireEvent.click(screen.getByText('待写保持'))
    await waitFor(() =>
      expect(host.latest.get('left')?.debugHoldSaveToken).toBe(1)
    )
  })

  it('keeps the reader mounted when debug library return fails, then retries', async () => {
    host.close
      .mockResolvedValueOnce({ status: 'unconfirmed', reason: 'disk full' })
      .mockResolvedValueOnce({ status: 'closed' })
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    fireEvent.click(screen.getByText('返回书库'))
    await waitFor(() => expect(host.close).toHaveBeenCalledWith('left'))
    expect(screen.getByTestId('reader-left')).toBeInTheDocument()

    fireEvent.click(screen.getByText('重试保存:left'))
    await waitFor(() =>
      expect(screen.queryByTestId('reader-left')).not.toBeInTheDocument()
    )
    expect(screen.getByText('open:a.pdf')).toBeInTheDocument()
  })

  it('keeps both panes until every library-return close is confirmed', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    process.env.EXPO_PUBLIC_HAM278_LAYOUT = 'split'
    let rightAttempts = 0
    host.close.mockImplementation(async (paneId) => {
      if (paneId === 'right' && ++rightAttempts === 1)
        return { status: 'unconfirmed', reason: 'disk full' }
      return { status: 'closed' }
    })
    render(<App />)
    await screen.findByTestId('reader-left')
    await screen.findByTestId('reader-right')

    fireEvent.click(screen.getByText('返回书库'))
    await waitFor(() => {
      expect(host.close).toHaveBeenCalledWith('left')
      expect(host.close).toHaveBeenCalledWith('right')
    })
    expect(screen.getByTestId('reader-left')).toBeInTheDocument()
    expect(screen.getByTestId('reader-right')).toBeInTheDocument()

    fireEvent.click(screen.getByText('重试保存:right'))
    await waitFor(() => {
      expect(screen.queryByTestId('reader-left')).not.toBeInTheDocument()
      expect(screen.queryByTestId('reader-right')).not.toBeInTheDocument()
    })
    expect(screen.getByText('open:a.pdf')).toBeInTheDocument()
  })

  it('drains the inactive pane before collapsing and retains it on failure', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    process.env.EXPO_PUBLIC_HAM278_LAYOUT = 'split'
    host.close
      .mockResolvedValueOnce({ status: 'unconfirmed', reason: 'disk full' })
      .mockResolvedValue({ status: 'closed' })
    render(<App />)
    await screen.findByTestId('reader-left')
    await screen.findByTestId('reader-right')

    fireEvent.click(screen.getByText('单栏'))
    await waitFor(() => expect(host.close).toHaveBeenCalledWith('right'))
    expect(host.close).not.toHaveBeenCalledWith('left')
    expect(screen.getByTestId('reader-left')).toBeInTheDocument()
    expect(screen.getByTestId('reader-right')).toBeInTheDocument()

    fireEvent.click(screen.getByText('重试保存:right'))
    await waitFor(() =>
      expect(screen.queryByTestId('reader-right')).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('reader-left')).toBeInTheDocument()
    expect(host.latest.get('left')?.isActivePane).toBe(true)
  })

  it('keeps both panes after a failed single-pane deep link and retries the same close', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    process.env.EXPO_PUBLIC_HAM278_LAYOUT = 'split'
    let rightAttempts = 0
    host.close.mockImplementation(async (paneId) => {
      if (paneId === 'right' && ++rightAttempts === 1)
        return { status: 'unconfirmed', reason: 'disk full' }
      return { status: 'closed' }
    })
    render(<App />)
    await screen.findByTestId('reader-left')
    await screen.findByTestId('reader-right')
    await waitFor(() => expect(host.urlListeners).toHaveLength(1))

    await act(async () => {
      host.urlListeners[0]!({
        url: `hamsterreader://open?fileId=${a.fileId}&layout=single`
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('reader-left')).toBeInTheDocument()
    expect(screen.getByTestId('reader-right')).toBeInTheDocument()
    expect(host.close).toHaveBeenCalledWith('right')

    const retry = host.alert.mock.calls.at(-1)?.[2]?.[0]?.onPress
    expect(retry).toBeTypeOf('function')
    await act(async () => {
      retry?.()
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(screen.queryByTestId('reader-right')).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('reader-left')).toBeInTheDocument()
    expect(rightAttempts).toBe(2)
  })

  it('queues a deep link behind an in-progress host close', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    process.env.EXPO_PUBLIC_HAM278_LAYOUT = 'split'
    let releaseRight!: () => void
    const rightGate = new Promise<void>((resolve) => {
      releaseRight = resolve
    })
    let rightAttempts = 0
    host.close.mockImplementation(async (paneId) => {
      if (paneId === 'right' && ++rightAttempts === 1) await rightGate
      return { status: 'closed' }
    })
    render(<App />)
    await screen.findByTestId('reader-left')
    await screen.findByTestId('reader-right')

    fireEvent.click(screen.getByText('返回书库'))
    await waitFor(() => expect(host.close).toHaveBeenCalledWith('right'))
    await act(async () => {
      host.urlListeners[0]!({
        url: `hamsterreader://open?fileId=${a.fileId}&layout=single`
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('reader-left')).toBeInTheDocument()
    expect(screen.getByTestId('reader-right')).toBeInTheDocument()

    await act(async () => {
      releaseRight()
      await rightGate
    })
    await screen.findByTestId('reader-left')
    await waitFor(() =>
      expect(screen.queryByTestId('reader-right')).not.toBeInTheDocument()
    )
    expect(screen.queryByText('open:a.pdf')).not.toBeInTheDocument()
  })

  it('keeps debug controls and launch routes out of release', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    expect(screen.getAllByTestId('reader-left')).toHaveLength(1)
    expect(screen.queryByTestId('reader-right')).not.toBeInTheDocument()
    expect(screen.queryByText('分栏')).not.toBeInTheDocument()
    expect(screen.queryByText('换源')).not.toBeInTheDocument()
    expect(screen.queryByText('返回书库')).not.toBeInTheDocument()
    expect(host.latest.size).toBe(1)
    expect(host.urlListeners).toHaveLength(0)
  })
})
