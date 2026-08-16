import { PdfParser } from '@hamster-note/pdf-parser'
import { IntermediateDocument } from '@hamster-note/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../demo/App'
import {
  clearRecentFile,
  loadRecentFile,
  saveRecentFile
} from '../demo/recentFileStorage'
import {
  createViewerLifetimeToken,
  ViewerLifetimeBoundary
} from '../demo/ViewerLifetimeBoundary'

vi.mock('@hamster-note/pdf-parser', () => ({
  PdfParser: {
    loadPdfSession: vi.fn(),
    openDocument: vi.fn(),
    resolvePdfPageObject: vi.fn()
  }
}))

vi.mock('@hamster-note/txt-parser', () => ({
  TxtParser: { encode: vi.fn() }
}))

vi.mock('@hamster-note/docx-parser', () => ({
  DocxParser: { encodeToIntermediate: vi.fn() }
}))

vi.mock('@hamster-note/epub-parser', () => ({
  EpubParser: class {
    readonly encode = vi.fn()
  }
}))

vi.mock('@hamster-note/markdown-parser', () => ({
  MarkdownParser: { encode: vi.fn() }
}))

vi.mock('../demo/fileMemoryLoader', () => ({
  loadFileToMemory: vi.fn(async (file: File) => ({
    file,
    buffer: new ArrayBuffer(file.size),
    elapsedMs: 1
  }))
}))

vi.mock('../demo/recentFileStorage', () => ({
  clearRecentFile: vi.fn(),
  loadRecentFile: vi.fn(),
  saveRecentFile: vi.fn()
}))

vi.mock('@hamster-note/reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hamster-note/reader')>()
  const React = await import('react')
  return {
    ...actual,
    Reader: (props: {
      readonly document?: { readonly title: string }
      readonly emptyText?: string
      readonly onFileUpload?: (file: File) => void
    }) => {
      React.useEffect(() => {
        return () => {
          lifecycleEvents.push('viewer-cleanup-raw')
        }
      }, [props.document])
      return (
        <div data-testid='lifecycle-reader'>
          {props.document?.title ?? props.emptyText}
          <input
            aria-label='lifecycle-file-input'
            type='file'
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) props.onFileUpload?.(file)
            }}
          />
        </div>
      )
    }
  }
})

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (reason?: unknown) => void
}

type TestHandle = {
  readonly id: string
  readonly title: string
  readonly pageCount: number
  readonly document: IntermediateDocument
  readonly dispose: ReturnType<typeof vi.fn<() => Promise<void>>>
}

const lifecycleEvents: string[] = []
const handles: TestHandle[] = []

function createDeferred<T>(): Deferred<T> {
  let resolve = (_value: T | PromiseLike<T>) => {}
  let reject = (_reason?: unknown) => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function makeDocument(title: string): IntermediateDocument {
  return IntermediateDocument.parse({
    id: title.toLowerCase().replaceAll(' ', '-'),
    title,
    pages: []
  })
}

function makeHandle(
  title: string,
  disposal: Promise<void> = Promise.resolve()
): TestHandle {
  const document = makeDocument(title)
  const handle: TestHandle = {
    id: document.id,
    title,
    pageCount: 0,
    document,
    dispose: vi.fn(async () => {
      lifecycleEvents.push(`dispose-start:${title}`)
      await disposal
      lifecycleEvents.push(`dispose-settled:${title}`)
    })
  }
  handles.push(handle)
  return handle
}

function makeFile(name: string): File {
  return new File(['pdf'], name, { type: 'application/pdf' })
}

function selectFile(file: File): void {
  const input =
    screen.queryByLabelText('lifecycle-file-input') ??
    screen.getByLabelText('Choose another file')
  fireEvent.change(input, {
    target: { files: [file] }
  })
}

async function openPdf(name: string): Promise<void> {
  selectFile(makeFile(name))
  fireEvent.click(await screen.findByRole('button', { name: '加载文件' }))
}

async function drainMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function AckProbe({
  token
}: {
  readonly token: ReturnType<typeof createViewerLifetimeToken>
}) {
  useEffect(
    () => () => {
      lifecycleEvents.push('child-cleanup')
    },
    []
  )
  return <div>{token.mounted ? 'mounted' : 'pending'}</div>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(PdfParser.openDocument).mockReset()
  vi.mocked(loadRecentFile).mockReset()
  vi.mocked(saveRecentFile).mockReset()
  vi.mocked(clearRecentFile).mockReset()
  lifecycleEvents.length = 0
  handles.length = 0
  vi.mocked(loadRecentFile).mockResolvedValue(null)
  vi.mocked(saveRecentFile).mockResolvedValue(true)
  vi.mocked(clearRecentFile).mockResolvedValue(true)
  vi.mocked(PdfParser.openDocument).mockImplementation(async () => {
    const title = `PDF ${handles.length + 1}`
    lifecycleEvents.push(`openDocument:${title}`)
    return makeHandle(title)
  })
})

afterEach(async () => {
  await drainMicrotasks()
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
})

describe('demo PDF streaming lifecycle', () => {
  it('[a] viewer ack 先于 dispose，dispose settled 后才启动下一次 openDocument', async () => {
    const destroy = createDeferred<void>()
    vi.mocked(PdfParser.openDocument)
      .mockResolvedValueOnce(makeHandle('PDF A', destroy.promise))
      .mockResolvedValueOnce(makeHandle('PDF B'))
    render(<App />)
    await openPdf('a.pdf')
    await screen.findByText('PDF A')
    selectFile(makeFile('b.pdf'))
    await waitFor(() => expect(handles[0]?.dispose).toHaveBeenCalledOnce())
    expect(PdfParser.openDocument).toHaveBeenCalledOnce()
    destroy.resolve()
    fireEvent.click(await screen.findByRole('button', { name: '加载文件' }))
    await screen.findByText('PDF B')
    expect(lifecycleEvents.indexOf('viewer-cleanup-raw')).toBeLessThan(
      lifecycleEvents.indexOf('dispose-start:PDF A')
    )
  })

  it('[b] 解析中重选后 late handle 只 dispose 一次且不提交旧 UI', async () => {
    const stale = createDeferred<TestHandle>()
    vi.mocked(PdfParser.openDocument)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(makeHandle('PDF B'))
    render(<App />)
    await openPdf('a.pdf')
    selectFile(makeFile('b.pdf'))
    stale.resolve(makeHandle('PDF A'))
    await waitFor(() => expect(handles.at(-1)?.dispose).toHaveBeenCalledOnce())
    expect(screen.queryByText('PDF A')).not.toBeInTheDocument()
  })

  it('[c] 两阶段移交同步 abort 旧解析，resolve 后提交 handle document', async () => {
    const signals: AbortSignal[] = []
    const stale = createDeferred<TestHandle>()
    vi.mocked(PdfParser.openDocument).mockImplementationOnce(
      (_buffer, options) => {
        if (options?.signal) signals.push(options.signal)
        return stale.promise
      }
    )
    render(<App />)
    await openPdf('a.pdf')
    selectFile(makeFile('b.pdf'))
    expect(signals[0]?.aborted).toBe(true)
    stale.resolve(makeHandle('PDF A'))
    await waitFor(() => expect(handles[0]?.dispose).toHaveBeenCalledOnce())
  })

  it('[d] Forget 只清 IndexedDB，不 dispose 当前 handle', async () => {
    render(<App />)
    await openPdf('a.pdf')
    await screen.findByText('PDF 1')
    fireEvent.click(screen.getByRole('button', { name: 'Forget saved file' }))
    await waitFor(() => expect(clearRecentFile).toHaveBeenCalledOnce())
    expect(handles[0]?.dispose).not.toHaveBeenCalled()
  })

  it('[e] dispose pending 连选 B/C 时只有最终 C 可进入解析', async () => {
    const destroy = createDeferred<void>()
    vi.mocked(PdfParser.openDocument).mockResolvedValueOnce(
      makeHandle('PDF A', destroy.promise)
    )
    render(<App />)
    await openPdf('a.pdf')
    selectFile(makeFile('b.pdf'))
    selectFile(makeFile('c.pdf'))
    destroy.resolve()
    const button = await screen.findByRole('button', { name: '加载文件' })
    expect(screen.getByTestId('pdf-ready-card')).toHaveTextContent('c.pdf')
    fireEvent.click(button)
    await waitFor(() => expect(PdfParser.openDocument).toHaveBeenCalledTimes(2))
  })

  it('[f] deferred openDocument 期间卸载，late handle dispose 恰一次', async () => {
    const late = createDeferred<TestHandle>()
    vi.mocked(PdfParser.openDocument).mockReturnValue(late.promise)
    const view = render(<App />)
    await openPdf('late.pdf')
    await act(async () => view.unmount())
    const handle = makeHandle('Late PDF')
    late.resolve(handle)
    await waitFor(() => expect(handle.dispose).toHaveBeenCalledOnce())
  })

  it('[g] 真实卸载只 dispose ref 当前持有 handle，后续操作 no-op', async () => {
    const view = render(<App />)
    await openPdf('a.pdf')
    await screen.findByText('PDF 1')
    await act(async () => view.unmount())
    await drainMicrotasks()
    await waitFor(() => expect(handles[0]?.dispose).toHaveBeenCalledOnce())
  })

  it('[h] viewerLifetimeToken 按文档独立且 ack 不串扰', async () => {
    const first = createViewerLifetimeToken()
    const second = createViewerLifetimeToken()
    const view = render(
      <ViewerLifetimeBoundary
        token={first}
        onSetup={() => {}}
        onCleanup={() => {}}
      >
        <AckProbe token={first} />
      </ViewerLifetimeBoundary>
    )
    view.rerender(
      <ViewerLifetimeBoundary
        token={second}
        onSetup={() => {}}
        onCleanup={() => {}}
      >
        <AckProbe token={second} />
      </ViewerLifetimeBoundary>
    )
    await first.ack
    expect(first.mounted).toBe(true)
    expect(second.mounted).toBe(true)
  })

  it('[i] 空队列和 null handle 卸载为零 dispose no-op', async () => {
    const view = render(<App />)
    await act(async () => view.unmount())
    await drainMicrotasks()
    expect(handles).toHaveLength(0)
  })

  it('[j] dispose reject 不毒化队列且不产生 unhandledrejection', async () => {
    const errors: unknown[] = []
    const listener = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      errors.push(event.reason)
    }
    window.addEventListener('unhandledrejection', listener)
    const destroy = createDeferred<void>()
    vi.mocked(PdfParser.openDocument)
      .mockResolvedValueOnce(makeHandle('PDF A', destroy.promise))
      .mockResolvedValueOnce(makeHandle('PDF B'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<App />)
    await openPdf('a.pdf')
    selectFile(makeFile('b.pdf'))
    await waitFor(() => expect(handles[0]?.dispose).toHaveBeenCalledOnce())
    destroy.reject(new Error('destroy failed'))
    fireEvent.click(await screen.findByRole('button', { name: '加载文件' }))
    await screen.findByText('PDF B')
    expect(errors).toEqual([])
    window.removeEventListener('unhandledrejection', listener)
  })

  it('[k] 冷启动首次选择不等待 ack 且 dispose 零次', async () => {
    render(<App />)
    await openPdf('cold.pdf')
    await screen.findByText('PDF 1')
    expect(handles[0]?.dispose).not.toHaveBeenCalled()
  })

  it('[l] pre-effect token 未 mounted 时切换不等待 ack 仍 dispose', async () => {
    const token = createViewerLifetimeToken()
    expect(token.mounted).toBe(false)
    const handle = makeHandle('Pre Effect')
    await handle.dispose()
    expect(handle.dispose).toHaveBeenCalledOnce()
  })

  it('[m] 非 PDF 永久 pending 不进入 ownership barrier 队尾', async () => {
    const pending = createDeferred<IntermediateDocument>()
    const { TxtParser } = await import('@hamster-note/txt-parser')
    vi.mocked(TxtParser.encode).mockReturnValue(pending.promise)
    render(<App />)
    selectFile(new File(['a'], 'a.txt', { type: 'text/plain' }))
    selectFile(makeFile('b.pdf'))
    expect(await screen.findByTestId('pdf-ready-card')).toHaveTextContent(
      'b.pdf'
    )
  })

  it('[n] abort rejection retirement fence settle 前不启动下一 PDF', async () => {
    const retirement = createDeferred<void>()
    const error = Object.assign(new Error('aborted'), {
      retirement: retirement.promise
    })
    vi.mocked(PdfParser.openDocument).mockRejectedValueOnce(error)
    render(<App />)
    await openPdf('a.pdf')
    await screen.findByTestId('demo-error-state')
    selectFile(makeFile('b.pdf'))
    fireEvent.click(await screen.findByRole('button', { name: '加载文件' }))
    expect(PdfParser.openDocument).toHaveBeenCalledOnce()
    retirement.resolve()
    await waitFor(() => expect(PdfParser.openDocument).toHaveBeenCalledTimes(2))
  })

  it('[o] StrictMode replay 不 dispose 假卸载，真实卸载 dispose 一次', async () => {
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>
    )
    await openPdf('strict.pdf')
    await screen.findByText('PDF 1')
    await drainMicrotasks()
    expect(handles[0]?.dispose).not.toHaveBeenCalled()
    await act(async () => view.unmount())
    await drainMicrotasks()
    await waitFor(() => expect(handles[0]?.dispose).toHaveBeenCalledOnce())
  })
})
