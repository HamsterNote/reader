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
import { nativeAnnotationControllerStore } from '../../src/nativePdf/annotationController'
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

function withSnapshotData(
  file: HostDocumentRecord,
  data: Record<string, unknown>
): HostDocumentRecord {
  return {
    ...file,
    snapshot: {
      ...file.snapshot,
      data: {
        ...(file.snapshot.data as Record<string, unknown>),
        ...data
      }
    }
  }
}

type MountControls = {
  failNextUpdate?: boolean
}

async function mount(file: HostDocumentRecord, controls: MountControls = {}) {
  let current = file
  const store = {
    get: vi.fn(async () => current),
    updateSnapshot: vi.fn(
      async (
        _fileId: string,
        patch: (snapshot: BridgeHostSnapshot) => BridgeHostSnapshot
      ) => {
        if (controls.failNextUpdate) {
          controls.failNextUpdate = false
          throw new Error('injected save failure')
        }
        const next = patch(current.snapshot)
        current = { ...current, snapshot: next }
        return next
      }
    )
  }
  const ref = createRef<ReaderWebViewHandle>()
  const view = render(
    <NativePdfReader
      ref={ref}
      record={file}
      store={store as unknown as ReaderDataStore}
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
    store,
    snapshot: () => current.snapshot,
    close: async () => {
      await act(async () => {
        await ref.current!.close()
      })
    },
    unmount: view.unmount
  }
}

async function writeHiddenPages(
  opened: Awaited<ReturnType<typeof mount>>,
  fileId: string,
  hiddenPages: number[],
  withHighlight = false
) {
  await act(async () => {
    await opened.store.updateSnapshot(fileId, (snapshot) => {
      const restored = restoreReaderSnapshot(snapshot.data, snapshot.progress)
      return {
        ...snapshot,
        data: serializeReaderSnapshot({
          ...restored,
          data: {
            ...restored.data,
            hiddenPages,
            ...(withHighlight
              ? { ranges: [...(restored.data.ranges ?? []), highlight('web')] }
              : {})
          }
        }),
        revision: snapshot.revision + 1
      }
    })
  })
}

async function confirmCrop() {
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

async function reopen(
  file: HostDocumentRecord,
  opened: Awaited<ReturnType<typeof mount>>
) {
  await opened.close()
  act(() => opened.unmount())
  return mount({ ...file, snapshot: opened.snapshot() })
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

function nativeStroke(identity: PdfIdentity, pageNumber = 1) {
  act(() =>
    host.native.onPdfEvent({
      nativeEvent: {
        ...identity,
        type: 'stroke',
        pageNumber,
        points: [
          { x: 10, y: 20 },
          { x: 20, y: 30 },
          { x: 30, y: 40 }
        ],
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

describe('native annotation commit identity across remounts', () => {
  it('saves a second rectangle after reopening and increments revision', async () => {
    const file = record('remount-second-rectangle', [])
    let opened = await mount(file)
    nativeRectangle(opened.identity, 2)
    opened = await reopen(file, opened)
    nativeRectangle(opened.identity, 3)
    opened = await reopen(file, opened)

    const current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.rects).toHaveLength(2)
    expect(opened.snapshot().revision).toBe(2)
  })

  it('keeps rectangles added across three consecutive reopens', async () => {
    const file = record('remount-three-times', [])
    let opened = await mount(file)
    for (const pageNumber of [2, 3, 4]) {
      opened = await reopen(file, opened)
      nativeRectangle(opened.identity, pageNumber)
    }
    opened = await reopen(file, opened)

    const current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.rects).toHaveLength(3)
    expect(opened.snapshot().revision).toBe(3)
  })

  it('keeps both sides after rectangles and Web edits cross a reopen', async () => {
    const file = record('remount-web-interleaving', [highlight('saved')])
    let opened = await mount(file)
    nativeRectangle(opened.identity, 2)
    await webSnapshot(opened.identity, file, [
      highlight('saved', '#ff0000'),
      highlight('added', '#00ff00')
    ])
    opened = await reopen(file, opened)
    await webSnapshot(opened.identity, file, [
      highlight('saved', '#0000ff'),
      highlight('added', '#00ff00')
    ])
    nativeRectangle(opened.identity, 3)
    opened = await reopen(file, opened)

    const current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.rects).toHaveLength(2)
    expect(current.data.ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'saved',
          markerStyle: expect.objectContaining({ backgroundColor: '#0000ff' })
        }),
        expect.objectContaining({ id: 'added' })
      ])
    )
    expect(opened.snapshot().revision).toBe(4)
  })

  it('gives a new rectangle a fresh id after undo and redo', async () => {
    const file = record('undo-redo-new-rectangle', [])
    let opened = await mount(file)
    nativeRectangle(opened.identity, 2)
    await act(async () => {
      fireEvent.click(screen.getByText('撤销标注'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('重做'))
    })
    opened = await reopen(file, opened)
    nativeRectangle(opened.identity, 3)
    opened = await reopen(file, opened)

    const current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.rects).toHaveLength(2)
    expect(opened.snapshot().revision).toBe(4)
  })

  it('allows a new stroke and a second clear after two remounts', async () => {
    const file = record('remount-clear-painting', [])
    let opened = await mount(file)
    const clearSpy = vi.spyOn(
      nativeAnnotationControllerStore.get(file.fileId),
      'clearPainting'
    )
    nativeStroke(opened.identity)
    await act(async () => {
      fireEvent.click(screen.getByText('清空本页'))
    })
    opened = await reopen(file, opened)
    nativeStroke(opened.identity)
    await act(async () => {
      fireEvent.click(screen.getByText('清空本页'))
    })
    expect(
      new Set(clearSpy.mock.calls.map(([commitId]) => commitId)).size
    ).toBe(2)
    opened = await reopen(file, opened)

    const current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.pagePaintings).toEqual({})
    expect(opened.snapshot().revision).toBe(4)
  })
})

describe('native page edit handoff regressions', () => {
  it('preserves Web hidden pages when native crop follows handoff', async () => {
    const file = withSnapshotData(
      record('handoff-hidden-then-crop', [highlight('saved')]),
      {
        readerData: {
          hiddenPages: [],
          edgeCrop: { pages: { 'page-2': { left: 0.2 } } }
        }
      }
    )
    const opened = await mount(file)
    await writeHiddenPages(opened, file.fileId, [2])

    await confirmCrop()
    await act(async () => {})

    const current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.hiddenPages).toEqual([2])
    expect(current.data.edgeCrop?.all?.top).toBe(0.05)
    expect(current.data.edgeCrop?.pages?.['page-2']?.left).toBe(0.2)
    expect(current.data.ranges).toEqual([
      expect.objectContaining({ id: 'saved' })
    ])
    expect(opened.snapshot().revision).toBe(2)
  })

  it('retry keeps immutable page edit baseline after editor reopen', async () => {
    const controls: MountControls = { failNextUpdate: true }
    const file = withSnapshotData(
      record('retry-after-editor-reopen', [highlight('saved')]),
      {
        readerData: {
          hiddenPages: [],
          edgeCrop: { pages: { 'page-2': { left: 0.2 } } }
        },
        comments: [{ id: 'keep-comment' }]
      }
    )
    const opened = await mount(file, controls)
    await confirmCrop()
    await screen.findByText(/injected save failure/)
    await writeHiddenPages(opened, file.fileId, [2])

    await act(async () => {
      fireEvent.click(screen.getByText('裁切/隐藏页编辑'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('取消'))
    })
    await act(async () => {
      const retry = screen.getByText(/injected save failure.*重试/)
      fireEvent.click(retry)
      fireEvent.click(retry)
    })
    await act(async () => {})

    const current = restoreReaderSnapshot(opened.snapshot().data)
    expect(current.data.hiddenPages).toEqual([2])
    expect(current.data.edgeCrop?.all?.top).toBe(0.05)
    expect(current.data.edgeCrop?.pages?.['page-2']?.left).toBe(0.2)
    expect(current.data.ranges).toEqual([
      expect.objectContaining({ id: 'saved' })
    ])
    expect(opened.store.updateSnapshot).toHaveBeenCalledTimes(3)
    expect(opened.snapshot().revision).toBe(2)
  })

  it.each(['untouched', 'explicit-clear', 'crop-only-undo'] as const)(
    'explicit hidden page clearing differs from untouched fields: %s',
    async (scenario) => {
      const base = record(`page-edit-${scenario}`, [])
      const file =
        scenario === 'explicit-clear'
          ? withSnapshotData(base, { readerData: { hiddenPages: [2] } })
          : base
      const opened = await mount(file)
      if (scenario === 'explicit-clear') {
        await act(async () => {
          fireEvent.click(screen.getByText('裁切/隐藏页编辑'))
        })
        await act(async () => {
          fireEvent.click(screen.getByText('取消选择'))
        })
        await act(async () => {
          fireEvent.click(screen.getByText('确认'))
        })
        await act(async () => {})
        expect(
          restoreReaderSnapshot(opened.snapshot().data).data.hiddenPages
        ).toEqual([])
        return
      }

      if (scenario === 'untouched') {
        await writeHiddenPages(opened, file.fileId, [2])
      }
      await confirmCrop()
      await act(async () => {})
      if (scenario === 'crop-only-undo') {
        await writeHiddenPages(opened, file.fileId, [2], true)
        await act(async () => {
          fireEvent.click(screen.getByText('撤销（5秒）'))
        })
        await act(async () => {})
      }

      const current = restoreReaderSnapshot(opened.snapshot().data)
      expect(current.data.hiddenPages).toEqual([2])
      expect(current.data.edgeCrop?.all?.top).toBe(
        scenario === 'crop-only-undo' ? undefined : 0.05
      )
      if (scenario === 'crop-only-undo') {
        expect(current.data.ranges).toEqual([
          expect.objectContaining({ id: 'web' })
        ])
      }
    }
  )
})
