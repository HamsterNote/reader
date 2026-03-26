import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Reader } from '../src/index'

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
