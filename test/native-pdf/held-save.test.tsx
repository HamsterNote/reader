import { act, cleanup, render } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import type { WebViewProps } from 'react-native-webview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NativePdfReader } from '../../app/src/components/NativePdfReader'
import type { ReaderWebViewHandle } from '../../app/src/components/ReaderWebView'
import type { ReaderPdfViewProps } from '../../app/modules/reader-pdf'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../../src/host/readerDataStore'
import type { BridgeHostSnapshot } from '../../src/bridge/hostSession'

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
  randomUUID: () => `held-${++host.sequence}`
}))
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' }
}))

function record(): HostDocumentRecord {
  return {
    fileId: 'f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    fileName: 'a.pdf',
    format: 'pdf',
    size: 1,
    modifiedAt: 0,
    importedAt: 0,
    cachedUri: 'a.pdf',
    snapshot: { revision: 0, progress: null, data: null }
  }
}

async function mount() {
  const file = record()
  let current: BridgeHostSnapshot = file.snapshot
  const store = {
    get: vi.fn(async () => ({ ...file, snapshot: current })),
    updateSnapshot: vi.fn(
      async (
        _fileId: string,
        patch: (snapshot: BridgeHostSnapshot) => BridgeHostSnapshot
      ) => {
        current = patch(current)
        return current
      }
    )
  } as unknown as ReaderDataStore
  const ref = createRef<ReaderWebViewHandle>()
  render(
    <NativePdfReader
      ref={ref}
      record={file}
      store={store}
      entryUrl={`file:///${file.fileId}/index.html`}
      baseUrl={`file:///${file.fileId}/`}
      publicationUrl={`file:///${file.fileId}/publication.pdf`}
    />
  )
  await act(async () => {})
  return { ref, store, current: () => current }
}

function events(
  spy: ReturnType<typeof vi.spyOn>,
  name: string
): Record<string, unknown>[] {
  return spy.mock.calls
    .filter(([message]) => message === name)
    .map(([, payload]) => payload as Record<string, unknown>)
}

beforeEach(() => {
  host.post.mockClear()
  host.sequence = 0
  vi.stubGlobal('__DEV__', true)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('controllable pending save (HAM-278 group 4)', () => {
  it('holds the write, then drains it before the old session is closed', async () => {
    const { ref } = await mount()
    const spy = vi.mocked(console.info)
    act(() => {
      expect(ref.current?.debugHoldNextSave?.(80)).toBe(true)
    })
    const queued = events(spy, 'reader-pdf-debug-held-save-queued')
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ holdMs: 80, pendingSaves: 1 })

    let status = ''
    await act(async () => {
      const result = await ref.current!.close()
      status = result.status
    })
    expect(status).toBe('closed')

    const barrierStart = events(spy, 'reader-pdf-save-barrier-start')
    const barrierEnd = events(spy, 'reader-pdf-save-barrier-end')
    expect(barrierStart[0]).toMatchObject({ pendingSaves: 1 })
    expect(barrierEnd[0]).toMatchObject({
      result: 'drained',
      pendingSaves: 0
    })
    expect(barrierEnd[0]!.waitedMs as number).toBeGreaterThanOrEqual(60)

    const drainStart = events(spy, 'reader-pdf-save-queue').find(
      (event) => event.event === 'drain-start'
    )
    const drainEnd = events(spy, 'reader-pdf-save-queue').find(
      (event) => event.event === 'drain-end'
    )
    const confirmed = events(spy, 'reader-pdf-save-queue').filter(
      (event) => event.event === 'confirmed'
    )
    expect(drainStart).toMatchObject({ pending: 1 })
    expect(confirmed).toHaveLength(1)
    expect(drainEnd).toMatchObject({ ok: true, pending: 0 })
    expect(drainEnd!.elapsedMs as number).toBeGreaterThanOrEqual(60)
  })
})
