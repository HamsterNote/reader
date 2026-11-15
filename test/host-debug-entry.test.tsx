import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostDocumentRecord } from '../src/host/readerDataStore'
import { ReaderDataStore } from '../src/host/readerDataStore'
import { App } from '../app/App'

type ReaderProps = {
  readonly record: HostDocumentRecord
  readonly paneId?: string
  readonly isActivePane?: boolean
  readonly onBack: () => void
  readonly onRecordUpdated: (record: HostDocumentRecord) => void
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
    alert: vi.fn(),
    initialUrl: null as string | null,
    urlListeners: [] as ((event: { url: string }) => void)[],
    importPath: vi.fn(),
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
  removeDocument: vi.fn(),
  importDocumentFromPath: host.importPath
}))
vi.mock('../app/src/components/AppErrorBoundary', () => ({
  AppErrorBoundary: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('../app/src/screens/ReaderScreen', () => ({
  ReaderScreen: (props: ReaderProps) => {
    if (props.paneId) host.latest.set(props.paneId, props)
    return (
      <div data-testid={`reader-${props.paneId}`}>
        <span>{props.record.fileName}</span>
        <button onClick={props.onBack}>返回{props.paneId}</button>
      </div>
    )
  }
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
}

beforeEach(async () => {
  host.values.clear()
  host.latest.clear()
  host.alert.mockClear()
  host.importPath.mockReset()
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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('demo host debug entrance (HAM-278)', () => {
  it('opens the requested PDF from the launch environment without a picker', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    render(<App />)
    await screen.findByTestId('reader-left')
    expect(screen.queryByText('open:a.pdf')).not.toBeInTheDocument()
    expect(host.pick).not.toHaveBeenCalled()
    expect(host.latest.get('left')?.record.fileId).toBe(a.fileId)
    expect(host.latest.get('left')?.paneId).toBe('left')
    expect(host.latest.get('left')?.isActivePane).toBe(true)
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

  it('mounts two panes with stable paneIds and a single active pane', async () => {
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
    // 单栏视图保留当前活动栏，另一栏卸载。
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
    expect(host.latest.get('left')?.record.fileId).toBe(a.fileId)

    fireEvent.click(screen.getByText('换源'))
    fireEvent.click(screen.getByText('b.pdf'))
    await waitFor(() =>
      expect(host.latest.get('left')?.record.fileId).toBe(b.fileId)
    )
    // 同一个 ReaderScreen 实例收到新记录，由它关闭旧会话并等待保存。
    expect(screen.getByTestId('reader-left')).toHaveTextContent('b.pdf')
  })

  it('opens a device path through a runtime deep link', async () => {
    host.importPath.mockResolvedValue(a)
    render(<App />)
    await screen.findByText('open:a.pdf')
    expect(host.urlListeners).toHaveLength(1)
    host.urlListeners[0]!({
      url: `hamsterreader://open?path=${encodeURIComponent('/var/mobile/reader/a.pdf')}`
    })
    await screen.findByTestId('reader-left')
    expect(host.importPath).toHaveBeenCalledWith(
      expect.anything(),
      '/var/mobile/reader/a.pdf'
    )
    expect(host.latest.get('left')?.record.fileId).toBe(a.fileId)
  })

  it('reports a failed debug route instead of silently opening something else', async () => {
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID =
      'f_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    render(<App />)
    await waitFor(() => expect(host.alert).toHaveBeenCalled())
    expect(host.alert).toHaveBeenCalledWith(
      '调试入口失败',
      '书库中没有 fileId=f_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee 的记录'
    )
    expect(await screen.findByText('open:a.pdf')).toBeInTheDocument()
    expect(screen.queryByTestId('reader-left')).not.toBeInTheDocument()
  })

  it('keeps the debug entrance and split controls out of release builds', async () => {
    vi.stubGlobal('__DEV__', false)
    process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID = a.fileId
    render(<App />)
    fireEvent.click(await screen.findByText('open:a.pdf'))
    await screen.findByTestId('reader-left')
    expect(screen.queryByText('分栏')).not.toBeInTheDocument()
    expect(screen.queryByText('换源')).not.toBeInTheDocument()
    expect(screen.getByTestId('reader-left')).toHaveTextContent('a.pdf')
    expect(host.latest.size).toBe(1)
    expect(host.importPath).not.toHaveBeenCalled()
  })
})
