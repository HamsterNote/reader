import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Reader } from '../src'

const { parseEpub } = vi.hoisted(() => ({ parseEpub: vi.fn() }))
vi.mock('../src/pdf/localSource', async (load) => ({
  ...(await load<typeof import('../src/pdf/localSource')>()),
  parseLocalEpub: parseEpub
}))
vi.mock('../src/pdf/PdfReader', () => ({
  default: () => <div data-testid='independent-pdf'>PDF surface</div>
}))
const document: IntermediateDocumentSerialized = {
  id: 'epub',
  title: 'EPUB',
  pages: [{ id: 'page-1', number: 1, width: 100, height: 150, content: [] }]
}
const pdf = () => ({
  kind: 'bytes' as const,
  bytes: new TextEncoder().encode('%PDF-1.7'),
  name: 'wrong.epub'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Reader local source dispatch', () => {
  it('rejects source/document conflict before parsing or reading', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const onStateChange = vi.fn()
    render(
      <Reader
        source={pdf()}
        document={document}
        onStateChange={onStateChange}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'either source or document'
    )
    expect(onStateChange).toHaveBeenCalledWith({
      status: 'error',
      error: expect.objectContaining({ code: 'SOURCE_DOCUMENT_CONFLICT' })
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(parseEpub).not.toHaveBeenCalled()
  })

  it('routes misnamed PDF by bytes and keeps host bytes intact across EPUB replacement', async () => {
    parseEpub.mockResolvedValue(document)
    const input = pdf()
    const bytes = input.bytes.slice()
    const onDataChange = vi.fn()
    const view = render(<Reader source={input} onDataChange={onDataChange} />)
    expect(await screen.findByTestId('independent-pdf')).toBeInTheDocument()
    expect(parseEpub).not.toHaveBeenCalled()
    view.rerender(
      <Reader
        source={{
          kind: 'bytes',
          bytes: new Uint8Array([80, 75, 3, 4]),
          name: 'wrong.pdf'
        }}
      />
    )
    expect(await screen.findByTestId('reader-root')).toBeInTheDocument()
    expect(screen.queryByTestId('independent-pdf')).not.toBeInTheDocument()
    expect(input.bytes).toEqual(bytes)
    expect(onDataChange).not.toHaveBeenCalled()
  })

  it('rejects remote sources without fetching', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const onStateChange = vi.fn()
    render(
      <Reader
        source={{ kind: 'uri', uri: 'https://example.test/document.pdf' }}
        onStateChange={onStateChange}
      />
    )
    await screen.findByRole('alert')
    expect(fetch).not.toHaveBeenCalled()
    expect(onStateChange).toHaveBeenLastCalledWith({
      status: 'error',
      error: expect.objectContaining({ category: 'unsupported' })
    })
  })

  it('late EPUB parsing cannot replace a new PDF or notify ready', async () => {
    let complete!: (value: IntermediateDocumentSerialized) => void
    parseEpub.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const onStateChange = vi.fn()
    const view = render(
      <Reader
        source={{ kind: 'bytes', bytes: new Uint8Array([80, 75, 3, 4]) }}
        onStateChange={onStateChange}
      />
    )
    await waitFor(() => expect(parseEpub).toHaveBeenCalled())
    view.rerender(<Reader source={pdf()} onStateChange={onStateChange} />)
    await screen.findByTestId('independent-pdf')
    onStateChange.mockClear()
    await act(async () => {
      complete(document)
    })
    expect(screen.getByTestId('independent-pdf')).toBeInTheDocument()
    expect(onStateChange).not.toHaveBeenCalled()
  })
})
