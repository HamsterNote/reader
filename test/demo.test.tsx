import { PdfParser } from '@hamster-note/pdf-parser'
import type { ReaderSavedSelection } from '@hamster-note/reader'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized
} from '@hamster-note/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../demo/App'

vi.mock('@hamster-note/pdf-parser', () => ({
  PdfParser: {
    encode: vi.fn()
  }
}))

const mockCallbacks: {
  onTextSelectionChange?: (text: unknown, detail: unknown) => void
  onTextSelectionEnd?: (text: unknown, detail: unknown) => void
  onSelectText?: (
    selection: unknown,
    segments: unknown,
    extractedText: unknown
  ) => void
} = {}
const mockReaderProps: unknown[] = []

vi.mock('@hamster-note/reader', async (importOriginal) => {
  // 部分 mock：保留库内纯函数（buildSavedSelection / getSelectionOverlayRects），
  // 仅替换 Reader 组件，让 demo 能像生产那样调用库 API。
  const actual = await importOriginal<typeof import('@hamster-note/reader')>()
  return {
    ...actual,
    Reader: (props: {
      document?: IntermediateDocument | IntermediateDocumentSerialized | null
      emptyText?: string
      onFileUpload?: (file: File) => void
      renderMode?: string
      selectionOverlay?: unknown
      onTextSelectionChange?: (text: unknown, detail: unknown) => void
      onTextSelectionEnd?: (text: unknown, detail: unknown) => void
      onSelectText?: (
        selection: unknown,
        segments: unknown,
        extractedText: unknown
      ) => void
      savedSelections?: ReaderSavedSelection[]
      onSavedSelectionEdit?: (
        id: string,
        nextSelection: ReaderSavedSelection
      ) => void
      activeSavedSelectionId?: string | null
      onActiveSavedSelectionChange?: (id: string | null) => void
    }) => {
      mockReaderProps.push(props)
      if (props.onTextSelectionChange)
        mockCallbacks.onTextSelectionChange = props.onTextSelectionChange
      if (props.onTextSelectionEnd)
        mockCallbacks.onTextSelectionEnd = props.onTextSelectionEnd
      if (props.onSelectText) mockCallbacks.onSelectText = props.onSelectText
      return (
        <div data-testid='mock-reader'>
          {props.document ? props.document.title : props.emptyText}
          {props.onFileUpload && (
            <input
              data-testid='file-input'
              type='file'
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]

                if (file) {
                  props.onFileUpload?.(file)
                }
              }}
            />
          )}
        </div>
      )
    }
  }
})

function makeSerializedDocument(
  title: string,
  pages: IntermediateDocumentSerialized['pages'] = []
): IntermediateDocumentSerialized {
  return {
    id: title.toLowerCase().replaceAll(' ', '-'),
    title,
    pages
  }
}

function makeRuntimeDocument(title: string) {
  return IntermediateDocument.parse(makeSerializedDocument(title))
}

function makeFile(name: string) {
  const file = new File(['pdf'], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { value: 3 })
  return file
}

function upload(file: File) {
  fireEvent.change(screen.getByTestId('file-input'), {
    target: { files: [file] }
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function getLatestParsedReaderProps() {
  for (let index = mockReaderProps.length - 1; index >= 0; index -= 1) {
    const props = mockReaderProps[index]
    const document =
      props && typeof props === 'object' && 'document' in props
        ? (
            props as {
              document?:
                | IntermediateDocument
                | IntermediateDocumentSerialized
                | null
            }
          ).document
        : undefined

    if (document) {
      return props as {
        document: IntermediateDocument | IntermediateDocumentSerialized
        onSelectText?: (...args: unknown[]) => unknown
        savedSelections?: ReaderSavedSelection[]
        onSavedSelectionEdit?: (
          id: string,
          nextSelection: ReaderSavedSelection
        ) => void
        activeSavedSelectionId?: string | null
        onActiveSavedSelectionChange?: (id: string | null) => void
      }
    }
  }

  return undefined
}

describe('demo parser flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReaderProps.length = 0
  })

  it('renders the parsed document and uploaded file details on success', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Success Document')
    )

    render(<App />)
    const uploadedFile = makeFile('success.pdf')
    upload(uploadedFile)

    expect(screen.getByText('Parsing...')).toBeInTheDocument()
    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()
    expect(screen.getByText('Success Document')).toBeInTheDocument()
    expect(screen.getByText('Name: success.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
  })

  it('shows a parse error when the parser returns undefined', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(undefined)

    render(<App />)
    const uploadedFile = makeFile('undefined.pdf')
    upload(uploadedFile)

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(
      screen.getByText('Failed to parse PDF: received undefined result')
    ).toBeInTheDocument()
    expect(screen.queryByText('Parsed Document')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
  })

  it('shows a parse error when the parser throws', async () => {
    vi.mocked(PdfParser.encode).mockRejectedValue(new Error('bad pdf'))

    render(<App />)
    const uploadedFile = makeFile('broken.pdf')
    upload(uploadedFile)

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(screen.getByText('Failed to parse PDF: bad pdf')).toBeInTheDocument()
    expect(screen.queryByText('Parsed Document')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
  })

  it('renders parsed document Reader without errors when OCR and selection props are provided', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('OCR Document')
    )

    render(<App />)
    upload(makeFile('ocr.pdf'))
    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()
    expect(screen.getByText('OCR Document')).toBeInTheDocument()
  })

  it('renders parsed document with direct render mode for custom selection demo', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Custom Selection Document')
    )

    render(<App />)
    upload(makeFile('custom-selection.pdf'))

    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Rendered with the direct text layer to demonstrate the custom selection overlay \(pink default\)/
      )
    ).toBeInTheDocument()

    const parsedReaderProps = mockReaderProps.find(
      (props): props is { renderMode?: string; selectionOverlay?: unknown } =>
        typeof props === 'object' &&
        props !== null &&
        'renderMode' in props &&
        'selectionOverlay' in props
    )

    expect(parsedReaderProps?.renderMode).toBe('direct')
    expect(parsedReaderProps?.selectionOverlay).toMatchObject({
      opacity: 0.28,
      enabled: true
    })
  })

  it('logs selection events when callbacks are invoked', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Callback Document')
    )

    render(<App />)
    upload(makeFile('callback.pdf'))

    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()

    const mockText = { id: 'text-1', content: 'Hello' }
    const mockDetail = {
      text: mockText,
      texts: [mockText],
      selectedText: 'Hello',
      pageNumber: 1,
      selection: {} as Selection
    }

    mockCallbacks.onTextSelectionChange?.(mockText, mockDetail)
    mockCallbacks.onTextSelectionEnd?.(mockText, mockDetail)

    expect(consoleSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('does not log upload Reader selection payloads', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('SelectText Document')
    )

    render(<App />)
    upload(makeFile('selecttext.pdf'))

    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()

    const uploadReaderProps = mockReaderProps.find(
      (
        props
      ): props is {
        emptyText?: string
        onSelectText?: (...args: unknown[]) => unknown
      } =>
        typeof props === 'object' &&
        props !== null &&
        'emptyText' in props &&
        (props as { emptyText?: string }).emptyText === 'No document loaded'
    )

    uploadReaderProps?.onSelectText?.(
      { isCollapsed: false } as unknown as Selection,
      [{ selectedText: 'Hello' }],
      'Hello'
    )

    expect(consoleSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('ignores stale parser results after a replacement upload', async () => {
    const staleRequest = createDeferred<IntermediateDocument | undefined>()
    const freshRequest = createDeferred<IntermediateDocument | undefined>()

    vi.mocked(PdfParser.encode)
      .mockReturnValueOnce(staleRequest.promise)
      .mockReturnValueOnce(freshRequest.promise)

    render(<App />)
    upload(makeFile('stale.pdf'))
    upload(makeFile('fresh.pdf'))

    freshRequest.resolve(makeRuntimeDocument('Fresh Document'))

    expect(await screen.findByText('Fresh Document')).toBeInTheDocument()

    staleRequest.resolve(makeRuntimeDocument('Stale Document'))

    await waitFor(() => {
      expect(screen.queryByText('Stale Document')).not.toBeInTheDocument()
      expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
      expect(screen.queryByText('Parsing...')).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// 保存选区持久化测试
// ---------------------------------------------------------------------------

describe('demo saved-selection persistence', () => {
  const STORAGE_KEY = 'hamster-reader-saved-selections'

  /** 构造一个合法的保存选区 fixture */
  function makeValidSavedSelection(id: string, text = 'Hello World') {
    return {
      version: 1,
      id,
      text,
      start: { pageNumber: 1, charIndex: 0 },
      end: { pageNumber: 1, charIndex: text.length },
      segments: [
        {
          pageNumber: 1,
          startCharIndex: 0,
          endCharIndex: text.length,
          selectedText: text
        }
      ],
      visual: [
        {
          pageNumber: 1,
          pageSize: { width: 612, height: 792 },
          rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]
        }
      ]
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockReaderProps.length = 0
    localStorage.clear()
  })

  /** 辅助：上传文件并等待解析文档出现 */
  async function renderParsedDocument(title: string) {
    vi.mocked(PdfParser.encode).mockResolvedValue(makeRuntimeDocument(title))
    render(<App />)
    upload(makeFile(`${title.toLowerCase().replaceAll(' ', '-')}.pdf`))
    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()
  }

  it('shows error status when localStorage contains malformed JSON', async () => {
    // 植入损坏的 JSON
    localStorage.setItem(STORAGE_KEY, '{bad json')

    await renderParsedDocument('Malformed JSON Document')

    // 点击加载按钮
    fireEvent.click(screen.getByTestId('load-selections-button'))

    // 断言错误状态
    expect(screen.getByTestId('selection-status')).toHaveTextContent(
      '加载失败：JSON 解析错误'
    )

    // 断言没有崩溃，页面仍然正常渲染
    expect(screen.getByText('Parsed Document')).toBeInTheDocument()
  })

  it('rejects the whole load when parsed root is not an array', async () => {
    // 植入一个对象（非数组）
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, id: 'not-array' })
    )

    await renderParsedDocument('Non-Array Document')

    fireEvent.click(screen.getByTestId('load-selections-button'))

    expect(screen.getByTestId('selection-status')).toHaveTextContent(
      '加载失败：存储数据格式错误（非数组）'
    )
    expect(screen.getByText('Parsed Document')).toBeInTheDocument()
  })

  it('shows status and leaves localStorage unchanged when saving without a current selection', async () => {
    await renderParsedDocument('No Selection Document')

    // 点击保存按钮（未选择文本）
    fireEvent.click(screen.getByTestId('save-selection-button'))

    // 断言状态提示
    expect(screen.getByTestId('selection-status')).toHaveTextContent(
      '没有当前选区，无法保存'
    )

    // 断言 localStorage 未被写入
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('loads only valid items from a mixed localStorage array', async () => {
    const validSelection = makeValidSavedSelection('valid-id-1')

    // 缺少必需字段的无效项
    const invalidItem = {
      version: 1,
      id: 'invalid-id'
      // 缺少 text、start、end、segments、visual
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([validSelection, invalidItem])
    )

    await renderParsedDocument('Mixed Document')

    fireEvent.click(screen.getByTestId('load-selections-button'))

    expect(screen.getByTestId('selection-status')).toHaveTextContent(
      '已加载 1 个有效选区'
    )

    expect(getLatestParsedReaderProps()?.savedSelections).toEqual([
      validSelection
    ])
  })

  it('loads 0 valid selections and shows status when all items are invalid', async () => {
    const invalidItem1 = { version: 1, id: 'bad-1' }
    const invalidItem2 = { version: 2, id: 'bad-2', text: 'wrong version' }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([invalidItem1, invalidItem2])
    )

    await renderParsedDocument('All Invalid Document')

    fireEvent.click(screen.getByTestId('load-selections-button'))

    expect(screen.getByTestId('selection-status')).toHaveTextContent(
      '已加载 0 个有效选区'
    )
  })

  it('saves current selection to localStorage after onSelectText fires', async () => {
    await renderParsedDocument('Save Flow Document')

    const onSelectText = getLatestParsedReaderProps()?.onSelectText
    expect(onSelectText).toBeDefined()

    const mockSelection = { isCollapsed: false } as unknown as Selection
    const mockSegments = [
      {
        id: 'text-3',
        pageNumber: 3,
        content: 'Selected text',
        selectedText: 'Selected text',
        startCharIndex: 0,
        endCharIndex: 13,
        polygon: [
          [100, 200],
          [200, 200],
          [200, 220],
          [100, 220]
        ] as [number, number][]
      }
    ]
    const mockExtractedText = 'Selected text'

    act(() => {
      onSelectText?.(mockSelection, mockSegments, mockExtractedText)
    })

    fireEvent.click(screen.getByTestId('save-selection-button'))

    // 断言 localStorage 被写入了 JSON 数组
    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored ?? '[]') as unknown[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)

    // 断言保存的项包含正确的字段
    const saved = parsed[0] as Record<string, unknown>
    expect(saved.version).toBe(1)
    expect(typeof saved.id).toBe('string')
    expect(saved.text).toBe('Selected text')
    expect(saved.start).toMatchObject({ pageNumber: 3, textId: 'text-3' })
    expect(saved.end).toMatchObject({ pageNumber: 3, textId: 'text-3' })
    expect(saved.segments).toEqual([
      expect.objectContaining({
        pageNumber: 3,
        textId: 'text-3',
        selectedText: 'Selected text'
      })
    ])
    expect(saved.visual).toEqual([
      expect.objectContaining({
        pageNumber: 3,
        pageSize: { width: 612, height: 792 },
        rects: [
          // 库的 normalizePageRects 先把 x/right 各 round 到 6 位，再 width = round(right - x)
          expect.objectContaining({
            x: Number((100 / 612).toFixed(6)),
            y: Number((200 / 792).toFixed(6)),
            width: Number(
              (
                Number((200 / 612).toFixed(6)) - Number((100 / 612).toFixed(6))
              ).toFixed(6)
            ),
            height: Number(
              (
                Number((220 / 792).toFixed(6)) - Number((200 / 792).toFixed(6))
              ).toFixed(6)
            )
          })
        ]
      })
    ])

    expect(screen.getByTestId('selection-status')).toHaveTextContent(
      /已标记选区/
    )

    await waitFor(() => {
      expect(getLatestParsedReaderProps()?.savedSelections).toHaveLength(1)
    })
    const firstSavedId = getLatestParsedReaderProps()?.savedSelections?.[0]?.id

    act(() => {
      onSelectText?.(
        mockSelection,
        [
          {
            id: 'text-4',
            pageNumber: 4,
            content: 'Next text',
            selectedText: 'Next text',
            startCharIndex: 0,
            endCharIndex: 9,
            polygon: [
              [20, 30],
              [80, 30],
              [80, 46],
              [20, 46]
            ] as [number, number][]
          }
        ],
        'Next text'
      )
    })

    await waitFor(() => {
      expect(getLatestParsedReaderProps()?.savedSelections).toHaveLength(1)
      expect(getLatestParsedReaderProps()?.savedSelections?.[0]?.id).toBe(
        firstSavedId
      )
    })
  })

  it('persists saved-selection edits from the parsed Reader callback', async () => {
    const originalSelection = makeValidSavedSelection('edit-id', 'Original')
    const editedSelection = makeValidSavedSelection('edit-id', 'Edited text')

    localStorage.setItem(STORAGE_KEY, JSON.stringify([originalSelection]))
    await renderParsedDocument('Edit Callback Document')

    fireEvent.click(screen.getByTestId('load-selections-button'))
    expect(getLatestParsedReaderProps()?.savedSelections).toEqual([
      originalSelection
    ])

    const onSavedSelectionEdit =
      getLatestParsedReaderProps()?.onSavedSelectionEdit
    expect(onSavedSelectionEdit).toBeDefined()

    act(() => {
      onSavedSelectionEdit?.('edit-id', editedSelection as ReaderSavedSelection)
    })

    expect(screen.getByTestId('selection-status')).toHaveTextContent(
      /已更新选区/
    )
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([
      editedSelection
    ])
    expect(getLatestParsedReaderProps()?.savedSelections).toEqual([
      editedSelection
    ])
  })

  it('deletes the active saved selection selected from the parsed Reader callback', async () => {
    const firstSelection = makeValidSavedSelection('delete-id-1', 'First')
    const secondSelection = makeValidSavedSelection('delete-id-2', 'Second')

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([firstSelection, secondSelection])
    )
    await renderParsedDocument('Delete Active Document')

    fireEvent.click(screen.getByTestId('load-selections-button'))
    expect(screen.getByTestId('delete-selection-button')).toBeDisabled()

    const onActiveSavedSelectionChange =
      getLatestParsedReaderProps()?.onActiveSavedSelectionChange
    expect(onActiveSavedSelectionChange).toBeDefined()

    act(() => {
      onActiveSavedSelectionChange?.('delete-id-1')
    })

    expect(getLatestParsedReaderProps()?.activeSavedSelectionId).toBe(
      'delete-id-1'
    )
    expect(screen.getByTestId('delete-selection-button')).toBeEnabled()

    fireEvent.click(screen.getByTestId('delete-selection-button'))

    expect(screen.getByTestId('selection-status')).toHaveTextContent(
      /已删除选区/
    )
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([
      secondSelection
    ])
    expect(getLatestParsedReaderProps()?.savedSelections).toEqual([
      secondSelection
    ])
    expect(getLatestParsedReaderProps()?.activeSavedSelectionId).toBeNull()
  })
})
