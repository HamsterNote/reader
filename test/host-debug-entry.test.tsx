import {
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

describe('demo host single-reader debug controls (HAM-278)', () => {
  it('opens one ReaderScreen from the library with a stable active pane', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    expect(screen.getAllByTestId('reader-left')).toHaveLength(1)
    expect(screen.queryByTestId('reader-right')).not.toBeInTheDocument()
    expect(host.latest.get('left')?.record.fileId).toBe(a.fileId)
    expect(host.latest.get('left')?.paneId).toBe('left')
    expect(host.latest.get('left')?.isActivePane).toBe(true)
    expect(screen.queryByText('分栏')).not.toBeInTheDocument()
  })

  it('replaces the configured record while reading so the save barrier runs', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    expect(host.latest.get('left')?.record.fileId).toBe(a.fileId)

    fireEvent.click(screen.getByText('换源'))
    fireEvent.click(screen.getByText('b.pdf'))
    await waitFor(() =>
      expect(host.latest.get('left')?.record.fileId).toBe(b.fileId)
    )
    expect(screen.getAllByTestId('reader-left')).toHaveLength(1)
    expect(screen.getByTestId('reader-left')).toHaveTextContent('b.pdf')
  })

  it('requests page census and held saves from the single-reader debug bar', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    expect(host.latest.get('left')?.debugCensusToken).toBe(0)
    fireEvent.click(screen.getByText('渲染计数'))
    await waitFor(() =>
      expect(host.latest.get('left')?.debugCensusToken).toBe(1)
    )
    expect(host.latest.get('left')?.debugHoldSaveToken).toBe(0)
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
    expect(screen.queryByText('open:a.pdf')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('重试保存:left'))
    await waitFor(() =>
      expect(screen.queryByTestId('reader-left')).not.toBeInTheDocument()
    )
    expect(screen.getByText('open:a.pdf')).toBeInTheDocument()
  })

  it('does not activate retired deep links or launch environment routes', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    process.env.EXPO_PUBLIC_HAM278_LAYOUT = 'split'
    host.initialUrl = `hamsterreader://open?fileId=${a.fileId}&layout=split`
    render(<App />)
    expect(await screen.findByText('open:a.pdf')).toBeInTheDocument()
    expect(screen.queryByTestId('reader-left')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reader-right')).not.toBeInTheDocument()
    expect(host.urlListeners).toHaveLength(0)
  })

  it('keeps debug controls out of release and still mounts only one reader', async () => {
    vi.stubGlobal('__DEV__', false)
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    expect(screen.getAllByTestId('reader-left')).toHaveLength(1)
    expect(screen.queryByText('分栏')).not.toBeInTheDocument()
    expect(screen.queryByText('换源')).not.toBeInTheDocument()
    expect(screen.queryByText('返回书库')).not.toBeInTheDocument()
    expect(host.latest.size).toBe(1)
  })
})
