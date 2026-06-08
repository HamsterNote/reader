import { PdfParser } from '@hamster-note/pdf-parser'
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

vi.mock('@hamster-note/reader', () => ({
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
}))

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

  it('logs exactly one onSelectText payload on selection completion', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('SelectText Document')
    )

    render(<App />)
    upload(makeFile('selecttext.pdf'))

    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()

    const mockSelection = { isCollapsed: false } as unknown as Selection
    const mockSegments = [
      {
        id: 'text-1',
        content: 'Hello',
        selectedText: 'Hello',
        startCharIndex: 0,
        endCharIndex: 5
      }
    ]
    const mockExtractedText = 'Hello'

    mockCallbacks.onSelectText?.(mockSelection, mockSegments, mockExtractedText)

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith({
      selection: mockSelection,
      segments: mockSegments,
      extractedText: mockExtractedText
    })

    const loggedPayload = consoleSpy.mock.calls[0][0] as {
      selection: Selection
      segments: Array<{ selectedText: string }>
      extractedText: string
    }
    expect(loggedPayload.segments).toHaveLength(1)
    expect(loggedPayload.segments[0].selectedText).toBe('Hello')
    expect(loggedPayload.extractedText).toBe('Hello')

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
