import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DocumentViewer } from '../src/components/DocumentViewer'

vi.mock(
  '@hamster-note/virtual-paper',
  async () => import('./mocks/virtual-paper')
)

function makeSerializedDocument(): IntermediateDocumentSerialized {
  return {
    id: 'doc-virtual-paper',
    title: 'Virtual Paper Document',
    pages: [
      {
        id: 'page-1',
        number: 1,
        width: 100,
        height: 150,
        content: []
      },
      {
        id: 'page-2',
        number: 2,
        width: 200,
        height: 300,
        texts: []
      }
    ]
  }
}

describe('DocumentViewer virtual-paper mode', () => {
  it('wraps page shells with contain-mode VirtualPaper content sizing', () => {
    render(<DocumentViewer document={makeSerializedDocument()} />)

    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    const container = screen.getByTestId('virtual-paper-container')

    expect(wrapper).toHaveAttribute('data-contain-mode', 'contain')
    expect(container).toHaveAttribute('data-content-size-width', '200')
    expect(container).toHaveAttribute('data-content-size-height', '450')
    expect(screen.getByText('Virtual Paper Document')).toBeInTheDocument()
  })
})
