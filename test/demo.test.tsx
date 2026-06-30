import { DocxParser } from '@hamster-note/docx-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import { PdfParser } from '@hamster-note/pdf-parser'
import type { ReaderSelectionRange } from '@hamster-note/reader'

import { TxtParser } from '@hamster-note/txt-parser'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized
} from '@hamster-note/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../demo/App'

vi.mock('@hamster-note/pdf-parser', () => ({
  PdfParser: {
    encode: vi.fn()
  }
}))

vi.mock('@hamster-note/txt-parser', () => ({
  TxtParser: {
    encode: vi.fn()
  }
}))

vi.mock('@hamster-note/docx-parser', () => ({
  DocxParser: {
    encodeToIntermediate: vi.fn()
  }
}))

vi.mock('@hamster-note/markdown-parser', () => ({
  MarkdownParser: {
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
const HIGHLIGHT_STORAGE_PREFIX = 'hamster-reader-demo:highlights:'

vi.mock('@hamster-note/reader', async (importOriginal) => {
  // 部分 mock：保留库内纯函数，仅替换 Reader 组件
  const actual = await importOriginal<typeof import('@hamster-note/reader')>()
  return {
    ...actual,
    Reader: (props: {
      document?: IntermediateDocument | IntermediateDocumentSerialized | null
      emptyText?: string
      onFileUpload?: (file: File) => void
      renderMode?: string
      onTextSelectionChange?: (text: unknown, detail: unknown) => void
      onTextSelectionEnd?: (text: unknown, detail: unknown) => void
      onSelectText?: (
        selection: unknown,
        segments: unknown,
        extractedText: unknown
      ) => void
    }) => {
      mockReaderProps.push(props)
      if (props.onTextSelectionChange)
        mockCallbacks.onTextSelectionChange = props.onTextSelectionChange
      if (props.onTextSelectionEnd)
        mockCallbacks.onTextSelectionEnd = props.onTextSelectionEnd
      if (props.onSelectText) mockCallbacks.onSelectText = props.onSelectText
      return (
        <div
          data-testid='mock-reader'
          className='hamster-reader'
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
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

function makeLinkedRange(
  id: string,
  text: string,
  selectionId = 'page-1'
): ReaderSelectionRange {
  return {
    id,
    text,
    start: { selectionId, offset: 1 },
    end: { selectionId, offset: 6 },
    createdAt: 1000,
    overlayRectType: 'percent',
    rectsBySelectionId: {
      [selectionId]: [{ x: 10, y: 20, width: 30, height: 40 }]
    }
  }
}

function highlightStorageKey(fileName: string): string {
  return `${HIGHLIGHT_STORAGE_PREFIX}${fileName}`
}

function findDocumentReaderProps(): Record<string, unknown> | undefined {
  for (let index = mockReaderProps.length - 1; index >= 0; index -= 1) {
    const props = mockReaderProps[index]
    if (
      typeof props === 'object' &&
      props !== null &&
      'document' in props &&
      props.document !== undefined
    ) {
      return props
    }
  }
  return undefined
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
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(screen.getByText('Success Document')).toBeInTheDocument()
    expect(screen.getByText('Name: success.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
  })

  it.each([
    {
      fileName: 'success.pdf',
      label: 'PDF',
      title: 'PDF Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(PdfParser.encode).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(PdfParser.encode).toHaveBeenCalledWith(file, undefined)
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
        expect(MarkdownParser.encode).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'BOOK.TXT',
      label: 'TXT',
      title: 'TXT Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(TxtParser.encode).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(TxtParser.encode).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
        expect(MarkdownParser.encode).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'file.DOCX',
      label: 'DOCX',
      title: 'DOCX Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(DocxParser.encodeToIntermediate).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(DocxParser.encodeToIntermediate).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(MarkdownParser.encode).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'notes.final.md',
      label: 'Markdown',
      title: 'Markdown MD Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(MarkdownParser.encode).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(MarkdownParser.encode).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
      }
    },
    {
      fileName: 'README.markdown',
      label: 'Markdown',
      title: 'Markdown Long Routed Document',
      arrange: (document: IntermediateDocument) =>
        vi.mocked(MarkdownParser.encode).mockResolvedValue(document),
      assertParserCall: (file: File) => {
        expect(MarkdownParser.encode).toHaveBeenCalledWith(file)
        expect(PdfParser.encode).not.toHaveBeenCalled()
        expect(TxtParser.encode).not.toHaveBeenCalled()
        expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
      }
    }
  ])(
    'routes supported $label upload $fileName by extension',
    async (caseData) => {
      const document = makeRuntimeDocument(caseData.title)
      caseData.arrange(document)

      render(<App />)
      const uploadedFile = makeFile(caseData.fileName)
      upload(uploadedFile)

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const shell = screen.getByTestId('reader-demo-root')
      expect(shell).toHaveClass('hamster-demo-shell')

      const sidebar = screen.getByTestId('demo-sidebar-settings').parentElement
      expect(sidebar).toHaveClass('hamster-demo-sidebar')

      const main = screen.getByTestId('mock-reader').parentElement
      expect(main).toHaveClass('hamster-demo-main')

      // Check Reader height fill integration
      const readerRoot = screen.getByTestId('mock-reader')
      expect(readerRoot).toHaveStyle({
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column'
      })

      const highlightGroup = screen.queryByTestId('demo-sidebar-highlights')
      if (highlightGroup) {
        expect(
          highlightGroup.querySelectorAll('button[aria-label]')
        ).not.toHaveLength(0)
      }

      expect(screen.getByText(caseData.title)).toBeInTheDocument()
      expect(screen.getByText(`Name: ${caseData.fileName}`)).toBeInTheDocument()
      expect(screen.queryByText('Parse Error')).not.toBeInTheDocument()
      caseData.assertParserCall(uploadedFile)
    }
  )

  it.each([
    'book.epub',
    'legacy.doc',
    'component.mdx',
    'README',
    'archive.zip'
  ])('rejects unsupported upload %s by extension', async (fileName) => {
    render(<App />)
    upload(makeFile(fileName))

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Unsupported file type. Supported: PDF, TXT, DOCX, Markdown.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(PdfParser.encode).not.toHaveBeenCalled()
    expect(TxtParser.encode).not.toHaveBeenCalled()
    expect(DocxParser.encodeToIntermediate).not.toHaveBeenCalled()
    expect(MarkdownParser.encode).not.toHaveBeenCalled()
  })

  it('shows a TXT parse error when the TXT parser rejects', async () => {
    vi.mocked(TxtParser.encode).mockRejectedValue(new Error('bad txt'))

    render(<App />)
    const uploadedFile = makeFile('broken.txt')
    upload(uploadedFile)

    expect(await screen.findByText('Parse Error')).toBeInTheDocument()
    expect(screen.getByText('Failed to parse TXT: bad txt')).toBeInTheDocument()
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(TxtParser.encode).toHaveBeenCalledTimes(1)
    expect(TxtParser.encode).toHaveBeenCalledWith(uploadedFile)
    expect(PdfParser.encode).not.toHaveBeenCalled()
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
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
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
    expect(screen.queryByText('Reader Settings')).not.toBeInTheDocument()
    expect(PdfParser.encode).toHaveBeenCalledTimes(1)
    expect(PdfParser.encode).toHaveBeenCalledWith(uploadedFile, undefined)
  })

  it('renders parsed document Reader without errors when OCR and selection props are provided', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('OCR Document')
    )

    render(<App />)
    upload(makeFile('ocr.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
    expect(screen.getByText('OCR Document')).toBeInTheDocument()
  })

  it('defaults renderMode to intermediate-document (new lazy renderer)', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Render Mode Document')
    )

    render(<App />)
    upload(makeFile('rendermode.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const readerProps = findDocumentReaderProps()
    expect(readerProps?.renderMode).toBe('intermediate-document')
  })

  it('exposes render-mode-select and switches to html-parser when selected', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Switch Render Mode Document')
    )

    render(<App />)
    upload(makeFile('switchmode.pdf'))
    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

    const select = screen.getByTestId('render-mode-select') as HTMLSelectElement
    expect(select.value).toBe('intermediate-document')

    fireEvent.change(select, { target: { value: 'html-parser' } })

    await waitFor(() => {
      const readerProps = findDocumentReaderProps()
      expect(readerProps?.renderMode).toBe('html-parser')
    })
  })

  it('logs selection events when callbacks are invoked', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Callback Document')
    )

    render(<App />)
    upload(makeFile('callback.pdf'))

    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

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

    expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

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

  describe('demo highlighting interactions', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockReaderProps.length = 0
      localStorage.clear()
    })

    it('provides autoHighlight toggle that updates Reader prop', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Auto Highlight Document')
      )
      render(<App />)
      upload(makeFile('auto.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const toggle = screen.getByTestId('auto-highlight-toggle')
      expect(toggle).not.toBeChecked()

      let uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )
      expect(uploadReaderProps?.autoHighlight).toBe(false)

      fireEvent.click(toggle)
      expect(toggle).toBeChecked()

      await waitFor(() => {
        uploadReaderProps = mockReaderProps[
          mockReaderProps.length - 1
        ] as Record<string, unknown>
        expect(uploadReaderProps?.autoHighlight).toBe(true)
      })
    })

    it('renders selectionPopover with 高亮 and 背景颜色设置', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Popover Document')
      )
      render(<App />)
      upload(makeFile('popover.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const popover = render(
        uploadReaderProps?.selectionPopover as React.ReactElement
      )
      expect(popover.getByText('高亮')).toBeInTheDocument()
      expect(popover.getByText('背景颜色设置')).toBeInTheDocument()

      const colorInput = popover.container.querySelector('input[type="color"]')
      expect(colorInput).toBeInTheDocument()
    })

    it('renders highlightPopover with 删除 and 背景颜色设置', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Highlight Popover Document')
      )
      render(<App />)
      upload(makeFile('hpopover.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const popover = render(
        uploadReaderProps?.highlightPopover as React.ReactElement
      )
      expect(popover.getByText('删除')).toBeInTheDocument()
      expect(popover.getByText('背景颜色设置')).toBeInTheDocument()
    })

    it('does not store a highlight on selection end when autoHighlight is false', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('No Auto Highlight Document')
      )
      render(<App />)
      upload(makeFile('no-auto.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const onSelectionEnd = uploadReaderProps?.onSelectionEnd as () => void
      onSelectionEnd()

      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
    })

    it('calls selectionRef.current?.highlight() when 高亮 is clicked', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Manual Highlight Document')
      )
      render(<App />)
      upload(makeFile('manual.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const highlightSpy = vi.fn()
      const refFromProps =
        uploadReaderProps?.selectionRef as React.MutableRefObject<unknown>

      refFromProps.current = { highlight: highlightSpy, clear: vi.fn() }

      const popover = render(
        uploadReaderProps?.selectionPopover as React.ReactElement
      )
      fireEvent.click(popover.getByText('高亮'))

      expect(highlightSpy).toHaveBeenCalledTimes(1)
    })

    it('changes the highlightColor prop when color input is changed', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Color Document')
      )
      render(<App />)
      upload(makeFile('color.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      let uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const popover = render(
        uploadReaderProps?.selectionPopover as React.ReactElement
      )
      const colorInput = popover.container.querySelector(
        'input[type="color"]'
      ) as HTMLInputElement

      fireEvent.change(colorInput, { target: { value: '#ff0000' } })

      await waitFor(() => {
        uploadReaderProps = mockReaderProps[
          mockReaderProps.length - 1
        ] as Record<string, unknown>
        expect(uploadReaderProps?.highlightColor).toBe('#ff0000')
      })
    })

    it('removes range by id and clears selectedRangeId when 删除 is clicked', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Delete Document')
      )
      render(<App />)
      upload(makeFile('delete.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      let uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('del-range', 'text to delete'))

      expect(await screen.findByText('text to delete')).toBeInTheDocument()

      const onSelectRange = uploadReaderProps?.onSelectRange as (
        id: string
      ) => void

      onSelectRange('del-range')

      await waitFor(() => {
        uploadReaderProps = mockReaderProps[
          mockReaderProps.length - 1
        ] as Record<string, unknown>
        expect(uploadReaderProps?.selectedRangeId).toBe('del-range')
      })

      const popover = render(
        uploadReaderProps?.highlightPopover as React.ReactElement
      )

      const deleteButton = popover.container.querySelector('button')
      if (deleteButton) {
        fireEvent.click(deleteButton)
      }

      await waitFor(() => {
        const elements = screen.queryAllByText('text to delete')
        expect(elements).toHaveLength(0)
      })

      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('delete.pdf')) || '{}'
      )
      expect(stored).toEqual({ version: 2, ranges: [] })

      uploadReaderProps = mockReaderProps[mockReaderProps.length - 1] as Record<
        string,
        unknown
      >
      expect(uploadReaderProps?.selectedRangeId).toBe(null)
    })

    it('stores exactly one range even if both onSelect and onHighlight are triggered', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Single Store Document')
      )
      render(<App />)
      upload(makeFile('single.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (props): props is Record<string, unknown> =>
          typeof props === 'object' &&
          props !== null &&
          'document' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      const onHighlight = uploadReaderProps?.onHighlight as (
        range: unknown
      ) => void
      const onSelect = uploadReaderProps?.onSelect as (range: unknown) => void

      const range = makeLinkedRange('single-range', 'single text')
      onHighlight(range)
      onSelect(range)

      expect(await screen.findByText('已创建高亮 (1)')).toBeInTheDocument()
      expect(screen.getAllByText('single text')).toHaveLength(1)
    })
  })

  describe('demo highlighting persistence', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockReaderProps.length = 0
      localStorage.clear()
    })

    it('defaults to no highlights on fresh render with empty localStorage', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Clean Document')
      )

      render(<App />)
      upload(makeFile('clean.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
    })

    it('writes a new highlight to localStorage when onHighlight is called', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Highlight Document')
      )

      render(<App />)
      upload(makeFile('highlight.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const uploadReaderProps = mockReaderProps.find(
        (
          props
        ): props is {
          emptyText?: string
          onHighlight?: (...args: unknown[]) => unknown
          document?: unknown
        } =>
          typeof props === 'object' &&
          props !== null &&
          'onHighlight' in props &&
          (props as Record<string, unknown>).document !== undefined
      )

      uploadReaderProps?.onHighlight?.({
        ...makeLinkedRange('range-1', 'hello highlight')
      })

      expect(await screen.findByText('已创建高亮 (1)')).toBeInTheDocument()
      expect(screen.getByText('hello highlight')).toBeInTheDocument()

      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('highlight.pdf')) || '{}'
      )
      expect(stored).toEqual({
        version: 2,
        ranges: [makeLinkedRange('range-1', 'hello highlight')]
      })
    })

    it('keeps valid v2 ranges and drops invalid v2 entries when loading', async () => {
      const validRangeA = makeLinkedRange('range-a', 'valid A')
      const validRangeB = makeLinkedRange('range-b', 'valid B', 'page-2')
      localStorage.setItem(
        highlightStorageKey('mixed.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [
            validRangeA,
            {
              ...validRangeA,
              start: { selectionId: 'reader-1:page-1', offset: 1 }
            },
            { ...validRangeA, rectsBySelectionId: { 'page-0': [] } },
            null,
            validRangeB
          ]
        })
      )
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Mixed Document')
      )

      render(<App />)
      upload(makeFile('mixed.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.getByText('已创建高亮 (2)')).toBeInTheDocument()
      expect(screen.getByText('valid A')).toBeInTheDocument()
      expect(screen.getByText('valid B')).toBeInTheDocument()
    })

    it('ignores old unversioned bare-array highlights instead of guessing page ownership', async () => {
      localStorage.setItem(
        highlightStorageKey('legacy.pdf'),
        JSON.stringify([
          {
            id: 'legacy-range',
            text: 'legacy highlight',
            start: 0,
            end: 10,
            createdAt: 1000,
            rects: [{ x: 1, y: 2, width: 3, height: 4 }]
          }
        ])
      )
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Legacy Document')
      )

      render(<App />)
      upload(makeFile('legacy.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      expect(screen.queryByText('legacy highlight')).not.toBeInTheDocument()
    })

    it('updates a highlight by id and persists the v2 envelope', async () => {
      const originalRange = makeLinkedRange('range-update', 'before update')
      const updatedRange = {
        ...originalRange,
        text: 'after update',
        markerStyle: { backgroundColor: '#ff0000' }
      }
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Update Document')
      )

      render(<App />)
      upload(makeFile('update.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(originalRange)
      expect(await screen.findByText('before update')).toBeInTheDocument()

      const onUpdateRange = findDocumentReaderProps()?.onUpdateRange as (
        range: unknown
      ) => void
      onUpdateRange(updatedRange)

      await waitFor(() => {
        expect(screen.getByText('after update')).toBeInTheDocument()
      })
      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('update.pdf')) || '{}'
      )
      expect(stored).toEqual({ version: 2, ranges: [updatedRange] })
    })

    it('clears all highlights and persists an empty v2 envelope', async () => {
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Clear Document')
      )

      render(<App />)
      upload(makeFile('clear.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(makeLinkedRange('range-clear-a', 'clear A'))
      onHighlight(makeLinkedRange('range-clear-b', 'clear B', 'page-2'))
      expect(await screen.findByText('已创建高亮 (2)')).toBeInTheDocument()

      fireEvent.click(screen.getByText('清空全部'))

      await waitFor(() => {
        expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      })
      const stored = JSON.parse(
        localStorage.getItem(highlightStorageKey('clear.pdf')) || '{}'
      )
      expect(stored).toEqual({ version: 2, ranges: [] })
    })

    it('does not persist runtime-scoped selection ids', async () => {
      const runtimeScopedRange = {
        ...makeLinkedRange('runtime-range', 'runtime scoped'),
        start: { selectionId: 'reader-linked-1:page-1', offset: 1 },
        end: { selectionId: 'reader-linked-1:page-1', offset: 6 },
        rectsBySelectionId: {
          'reader-linked-1:page-1': [{ x: 10, y: 20, width: 30, height: 40 }]
        }
      }
      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Runtime Id Document')
      )

      render(<App />)
      upload(makeFile('runtime.pdf'))
      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      const onHighlight = findDocumentReaderProps()?.onHighlight as (
        range: unknown
      ) => void
      onHighlight(runtimeScopedRange)

      await waitFor(() => {
        expect(
          localStorage.getItem(highlightStorageKey('runtime.pdf'))
        ).not.toBe(null)
      })
      const storedRaw = localStorage.getItem(highlightStorageKey('runtime.pdf'))
      expect(storedRaw).not.toContain('reader-linked-1')
      expect(JSON.parse(storedRaw || '{}')).toEqual({ version: 2, ranges: [] })
    })

    it('restores stored highlights when reloading a file', async () => {
      localStorage.setItem(
        highlightStorageKey('restored.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-1', 'restored highlight')]
        })
      )

      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Restored Document')
      )

      render(<App />)
      upload(makeFile('restored.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.getByText('已创建高亮 (1)')).toBeInTheDocument()
      expect(screen.getByText('restored highlight')).toBeInTheDocument()
    })

    it('isolates highlights per file name', async () => {
      localStorage.setItem(
        highlightStorageKey('file-a.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-a', 'file A highlight')]
        })
      )

      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('File B Document')
      )

      render(<App />)
      upload(makeFile('file-b.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()

      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      expect(screen.queryByText('file A highlight')).not.toBeInTheDocument()
    })

    it('yields empty array for invalid JSON or wrong shape', async () => {
      localStorage.setItem(
        highlightStorageKey('corrupt.pdf'),
        '{ not valid json ]'
      )
      localStorage.setItem(
        highlightStorageKey('wrong-shape.pdf'),
        JSON.stringify([{ id: 'partial' }])
      )

      vi.mocked(PdfParser.encode).mockResolvedValue(
        makeRuntimeDocument('Corrupt Document')
      )

      const { unmount } = render(<App />)
      upload(makeFile('corrupt.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
      unmount()

      render(<App />)
      upload(makeFile('wrong-shape.pdf'))

      expect(await screen.findByText('Reader Settings')).toBeInTheDocument()
      expect(screen.queryByText(/已创建高亮/)).not.toBeInTheDocument()
    })

    it('ignores stale parser results applying older highlights to a newer file', async () => {
      const staleRequest = createDeferred<IntermediateDocument | undefined>()
      const freshRequest = createDeferred<IntermediateDocument | undefined>()

      localStorage.setItem(
        highlightStorageKey('stale.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-stale', 'stale text')]
        })
      )
      localStorage.setItem(
        highlightStorageKey('fresh.pdf'),
        JSON.stringify({
          version: 2,
          ranges: [makeLinkedRange('range-fresh', 'fresh text')]
        })
      )

      vi.mocked(PdfParser.encode)
        .mockReturnValueOnce(staleRequest.promise)
        .mockReturnValueOnce(freshRequest.promise)

      render(<App />)
      upload(makeFile('stale.pdf'))
      upload(makeFile('fresh.pdf'))

      freshRequest.resolve(makeRuntimeDocument('Fresh Document'))
      expect(await screen.findByText('Fresh Document')).toBeInTheDocument()

      expect(screen.getByText('已创建高亮 (1)')).toBeInTheDocument()
      expect(screen.getByText('fresh text')).toBeInTheDocument()
      expect(screen.queryByText('stale text')).not.toBeInTheDocument()

      staleRequest.resolve(makeRuntimeDocument('Stale Document'))
      await new Promise((r) => setTimeout(r, 10))

      expect(screen.queryByText('Stale Document')).not.toBeInTheDocument()
      expect(screen.queryByText('stale text')).not.toBeInTheDocument()
    })
  })
})
