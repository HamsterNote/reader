import type { DrawingValue } from '@hamster-note/painting'
import type { SelectionRange, SelectionRect } from '@hamster-note/selection'
import {
  type IntermediateDocumentSerialized,
  type IntermediateTextSerialized,
  TextDir
} from '@hamster-note/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Reader } from '../src/index'

function makeText(id: string, content: string): IntermediateTextSerialized {
  return {
    id,
    content,
    fontSize: 30,
    fontFamily: 'Georgia',
    fontWeight: 500,
    italic: false,
    color: '#0f172a',
    width: 720,
    height: 42,
    lineHeight: 42,
    x: 96,
    y: 120,
    ascent: 30,
    descent: 12,
    dir: TextDir.LTR,
    rotate: 0,
    skew: 0,
    isEOL: true
  }
}

function makeDocument(
  overrides?: Partial<IntermediateDocumentSerialized>
): IntermediateDocumentSerialized {
  return {
    id: 'doc-1',
    pages: [],
    title: 'Hamster Reader Title',
    ...overrides
  }
}

function createMockFile(
  name: string,
  size: number,
  type: string = 'application/pdf'
): File {
  const file = new File([], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('Reader public API', () => {
  it('renders the provided document title on the public entry', () => {
    render(<Reader document={makeDocument()} />)

    const root = screen.getByTestId('reader-root')

    expect(root).toBeInTheDocument()
    expect(root).toHaveTextContent('Hamster Reader Title')
  })

  it('renders document pages with the selected tool and exposed data', () => {
    const paintingValue: DrawingValue = {
      strokes: [
        {
          id: 'stroke-1',
          tool: 'pen',
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 20 }
          ]
        }
      ]
    }
    const textSelections: readonly SelectionRange[] = [
      {
        id: 'range-1',
        text: 'Important paragraph',
        start: 0,
        end: 19,
        createdAt: 1,
        rects: [{ x: 10, y: 10, width: 100, height: 20 }],
        overlayRectType: 'px'
      }
    ]
    const rectSelections: readonly SelectionRect[] = [
      {
        id: 'rect-1',
        createdAt: 2,
        overlayRectType: 'px',
        start: { x: 20, y: 20 },
        end: { x: 160, y: 120 },
        rect: { x: 20, y: 20, width: 140, height: 100 }
      }
    ]

    render(
      <Reader
        document={makeDocument({
          pages: [
            {
              id: 'page-1',
              number: 1,
              width: 1080,
              height: 1528,
              texts: [makeText('page-1-text-1', 'Important paragraph')],
              thumbnail: undefined
            }
          ]
        })}
        selectedTool='drawing'
        pagePaintings={{ 'page-1': paintingValue }}
        pageTextSelections={{ 'page-1': textSelections }}
        pageRectSelections={{ 'page-1': rectSelections }}
      />
    )

    expect(screen.getByTestId('reader-pages')).toBeInTheDocument()
    expect(screen.getByTestId('reader-page-page-1')).toHaveAttribute(
      'data-tool',
      'drawing'
    )
    expect(screen.getByText('Tool')).toBeInTheDocument()
    expect(screen.getByText('Drawing')).toBeInTheDocument()
    expect(screen.getByText('Text Marks')).toBeInTheDocument()
    expect(screen.getByText('Rect Marks')).toBeInTheDocument()
    expect(screen.getByText('Strokes')).toBeInTheDocument()
    expect(screen.getByTestId('reader-page-text-page-1-text-1')).toHaveTextContent(
      'Important paragraph'
    )
  })

  it('renders emptyText when document is null', () => {
    render(<Reader document={null} emptyText='Nothing to render' />)

    const root = screen.getByTestId('reader-root')

    expect(root).toBeInTheDocument()
    expect(root).toHaveTextContent('Nothing to render')
  })
})

describe('Reader file upload', () => {
  it('shows upload zone when no document is provided', () => {
    render(<Reader document={null} />)

    const uploadZone = screen.getByTestId('upload-zone')

    expect(uploadZone).toBeInTheDocument()
    expect(uploadZone).toHaveTextContent('Click or drag PDF to upload')
  })

  it('does not show upload zone when document is provided', () => {
    render(<Reader document={makeDocument()} />)

    const uploadZone = screen.queryByTestId('upload-zone')

    expect(uploadZone).not.toBeInTheDocument()
  })

  it('triggers onFileUpload callback when file is selected', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024 * 100)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    expect(onFileUpload).toHaveBeenCalledWith(mockFile)
  })

  it('displays file info after upload', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024 * 100)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toBeInTheDocument()
    expect(fileInfo).toHaveTextContent('test.pdf')
    expect(fileInfo).toHaveTextContent('100.0 KB')
  })

  it('displays file name and size correctly for small files', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('small.pdf', 500)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toHaveTextContent('500 B')
  })

  it('displays file name and size correctly for large files', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('large.pdf', 2 * 1024 * 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toHaveTextContent('2.0 MB')
  })

  it('has upload another button after file is uploaded', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const uploadAnotherBtn = screen.getByTestId('upload-another-btn')
    expect(uploadAnotherBtn).toBeInTheDocument()
    expect(uploadAnotherBtn).toHaveTextContent('Upload Another')
  })

  it('clicking upload another button works without errors', async () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const uploadAnotherBtn = screen.getByTestId('upload-another-btn')
    expect(uploadAnotherBtn).toBeEnabled()

    await userEvent.click(uploadAnotherBtn)

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toBeInTheDocument()
  })

  it('hides file info when document is provided', () => {
    render(<Reader document={makeDocument()} />)

    const fileInfo = screen.queryByTestId('file-info')

    expect(fileInfo).not.toBeInTheDocument()
  })
})
