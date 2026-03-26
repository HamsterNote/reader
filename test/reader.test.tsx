import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
