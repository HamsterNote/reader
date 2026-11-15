import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import type { WebViewProps } from 'react-native-webview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativePdfReader } from '../../app/src/components/NativePdfReader'
import type { ReaderWebViewHandle } from '../../app/src/components/ReaderWebView'
import type { ReaderPdfViewProps } from '../../app/modules/reader-pdf'
import type { BridgeHostSnapshot } from '../../src/bridge/hostSession'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../../src/host/readerDataStore'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../../src/host/readerSnapshot'
import type { PdfCommand, PdfIdentity } from '../../src/nativePdf/contracts'
import type { ReaderSelectionRange } from '../../src/types/selection'

const host = vi.hoisted(() => ({
  web: {} as WebViewProps,
  native: {} as ReaderPdfViewProps,
  commands: [] as PdfCommand[],
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
    Pressable: ({
      children,
      onPress
    }: {
      children?: ReactNode
      onPress?: () => void
    }) => <button onClick={onPress}>{children}</button>,
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
    const command = props.command as PdfCommand | null | undefined
    if (command && host.commands.at(-1)?.requestId !== command.requestId)
      host.commands.push(command)
    return null
  }
}))
vi.mock('expo-crypto', () => ({
  randomUUID: () => `interleaved-${++host.sequence}`
}))
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' }
}))

function highlight(
  id: string,
  backgroundColor = '#ffc107'
): ReaderSelectionRange {
  return {
    id,
    createdAt: 1,
    text: 'QA',
    start: { selectionId: 'page-1', offset: 4 },
    end: { selectionId: 'page-1', offset: 6 },
    overlayRectType: 'px',
    markerStyle: { backgroundColor },
    rectsBySelectionId: {
      'page-1': [{ x: 40, y: 50, width: 320, height: 50 }]
    }
  } as ReaderSelectionRange
}

function record(
  fileId: string,
  ranges: readonly ReaderSelectionRange[]
): HostDocumentRecord {
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    format: 'pdf',
    size: 1,
    modifiedAt: 0,
    importedAt: 0,
    cachedUri: `${fileId}.pdf`,
    snapshot: {
      revision: 0,
      progress: null,
      data: {
        readerData: { hiddenPages: [] },
        annotations: { version: 5, ranges, rects: [], paintings: {} }
      }
    }
  }
}

async function mount(file: HostDocumentRecord) {
  let current = file
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
  const identity = JSON.parse(
    host.web.injectedJavaScriptBeforeContentLoaded!.slice(
      'window.__READER_NATIVE_PDF__='.length,
      -';true;'.length
    )
  ) as PdfIdentity
  act(() =>
    host.native.onPdfEvent({
      nativeEvent: { ...identity, type: 'loaded', pageCount: 12 }
    })
  )
  await drainCommands(identity)
  return {
    identity,
    ref,
    snapshot: () => current.snapshot,
    close: async () => {
      await act(async () => {
        await ref.current!.close()
      })
    }
  }
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

function nativeRectangle(identity: PdfIdentity, pageNumber = 2) {
  act(() =>
    host.native.onPdfEvent({
      nativeEvent: {
        ...identity,
        type: 'rect',
        pageNumber,
        rect: { x: 10, y: 20, width: 40, height: 30 },
        phase: 'commit',
        geometryRevision: 1
      }
    })
  )
}

async function webSnapshot(
  identity: PdfIdentity,
  file: HostDocumentRecord,
  ranges: readonly ReaderSelectionRange[]
) {
  const restored = restoreReaderSnapshot(
    file.snapshot.data,
    file.snapshot.progress
  )
  const data = serializeReaderSnapshot({
    ...restored,
    data: { ...restored.data, ranges: [...ranges] }
  })
  await act(async () => {
    host.web.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          ...identity,
          type: 'snapshot',
          commitId: `web-${ranges.map((range) => range.id).join('-')}`,
          data
        })
      }
    } as Parameters<NonNullable<WebViewProps['onMessage']>>[0])
  })
}

beforeEach(() => {
  host.commands = []
  host.post.mockClear()
  vi.stubGlobal('__DEV__', false)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('interleaved native and Web annotation saves', () => {
  it('keeps a native rectangle when Web adds and edits highlights before reopen', async () => {
    const file = record('native-then-web', [highlight('saved')])
    const opened = await mount(file)
    nativeRectangle(opened.identity)
    await webSnapshot(opened.identity, file, [
      highlight('saved', '#ff0000'),
      highlight('added', '#00ff00')
    ])
    await opened.close()

    const reopened = restoreReaderSnapshot(opened.snapshot().data)
    expect(reopened.data.rects).toHaveLength(1)
    expect(reopened.data.rects?.[0]).toMatchObject({
      selectionId: 'page-2',
      rect: { x: 10, y: 20, width: 40, height: 30 }
    })
    expect(reopened.data.ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'saved',
          markerStyle: expect.objectContaining({ backgroundColor: '#ff0000' })
        }),
        expect.objectContaining({ id: 'added' })
      ])
    )
  })

  it('applies a Web highlight edit before a later native rectangle save', async () => {
    const file = record('web-then-native', [highlight('saved')])
    const opened = await mount(file)
    await webSnapshot(opened.identity, file, [highlight('saved', '#ff0000')])
    nativeRectangle(opened.identity)
    await drainCommands(opened.identity)
    await opened.close()

    const reopened = restoreReaderSnapshot(opened.snapshot().data)
    expect(reopened.data.ranges).toEqual([
      expect.objectContaining({
        id: 'saved',
        markerStyle: expect.objectContaining({ backgroundColor: '#ff0000' })
      })
    ])
    expect(reopened.data.rects).toHaveLength(1)
    expect(
      host.commands.some(
        (command) =>
          command.type === 'annotations' &&
          command.ranges.some(
            (range) =>
              range.id === 'saved' &&
              range.markerStyle?.backgroundColor === '#ff0000'
          )
      )
    ).toBe(true)
  })

  it('keeps the latest Web additions, deletion and color across native undo and redo', async () => {
    const file = record('undo-redo-web-interleaving', [highlight('saved')])
    const opened = await mount(file)
    nativeRectangle(opened.identity)
    await webSnapshot(opened.identity, file, [
      highlight('saved', '#ff0000'),
      highlight('added', '#00ff00')
    ])

    await act(async () => {
      fireEvent.click(screen.getByText('撤销标注'))
    })
    let current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.rects).toEqual([])
    expect(current.data.ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'saved',
          markerStyle: expect.objectContaining({ backgroundColor: '#ff0000' })
        }),
        expect.objectContaining({ id: 'added' })
      ])
    )

    await webSnapshot(opened.identity, file, [highlight('saved', '#0000ff')])
    await act(async () => {
      fireEvent.click(screen.getByText('重做'))
    })
    await opened.close()

    current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.rects).toHaveLength(1)
    expect(current.data.ranges).toEqual([
      expect.objectContaining({
        id: 'saved',
        markerStyle: expect.objectContaining({ backgroundColor: '#0000ff' })
      })
    ])
    expect(opened.snapshot().revision).toBe(5)
  })

  it('does not resurrect a Web-deleted highlight during native undo and redo', async () => {
    const file = record('undo-redo-web-delete', [highlight('saved')])
    const opened = await mount(file)
    nativeRectangle(opened.identity)
    await webSnapshot(opened.identity, file, [])

    await act(async () => {
      fireEvent.click(screen.getByText('撤销标注'))
    })
    let current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.rects).toEqual([])
    expect(current.data.ranges).toEqual([])

    await act(async () => {
      fireEvent.click(screen.getByText('重做'))
    })
    await opened.close()
    current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.rects).toHaveLength(1)
    expect(current.data.ranges).toEqual([])
    expect(opened.snapshot().revision).toBe(4)
  })
})
