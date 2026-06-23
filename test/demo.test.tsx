import { DocxParser } from '@hamster-note/docx-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import { PdfParser } from '@hamster-note/pdf-parser'

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

      expect(await screen.findByText('Parsed Document')).toBeInTheDocument()
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
    expect(screen.queryByText('Parsed Document')).not.toBeInTheDocument()
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
    expect(screen.queryByText('Parsed Document')).not.toBeInTheDocument()
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
