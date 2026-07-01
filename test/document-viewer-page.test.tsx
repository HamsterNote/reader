import { IntermediateDocument, TextDir } from '@hamster-note/types'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PageViewer } from '../src/components/DocumentViewer/page'
import { intersectionObserverMock } from './setup'

function makeDocument(): IntermediateDocument {
  return IntermediateDocument.parse({
    id: 'doc-1',
    title: 'Document',
    pages: [
      {
        id: 'page-1',
        number: 1,
        width: 100,
        height: 150
      }
    ]
  })
}

function makeDocumentWithText(): IntermediateDocument {
  return IntermediateDocument.parse({
    id: 'doc-with-text',
    title: 'Document with text',
    pages: [
      {
        id: 'page-with-text',
        number: 1,
        width: 100,
        height: 150,
        content: [
          {
            id: 'text-1',
            content: 'Hello viewport',
            fontSize: 12,
            fontFamily: 'Arial',
            fontWeight: 400,
            italic: false,
            color: '#000000',
            polygon: [
              [0, 0],
              [100, 0],
              [100, 12],
              [0, 12]
            ],
            lineHeight: 12,
            ascent: 9,
            descent: 3,
            dir: TextDir.LTR,
            skew: 0,
            isEOL: false
          }
        ]
      }
    ]
  })
}

describe('PageViewer viewport callbacks', () => {
  it('calls enter and leave handlers only when viewport state changes', () => {
    const onEnterViewport = vi.fn()
    const onLeaveViewport = vi.fn()

    render(
      <PageViewer
        data-testid='page-viewer'
        doc={makeDocument()}
        pageNumber={1}
        onEnterViewport={onEnterViewport}
        onLeaveViewport={onLeaveViewport}
      />
    )

    const pageViewer = screen.getByTestId('page-viewer')

    intersectionObserverMock.trigger(pageViewer, true)
    intersectionObserverMock.trigger(pageViewer, true)
    intersectionObserverMock.trigger(pageViewer, false)
    intersectionObserverMock.trigger(pageViewer, false)

    expect(onEnterViewport).toHaveBeenCalledTimes(1)
    expect(onEnterViewport).toHaveBeenCalledWith(1)
    expect(onLeaveViewport).toHaveBeenCalledTimes(1)
    expect(onLeaveViewport).toHaveBeenCalledWith(1)
  })

  it('loads text only while the page is visible and clears it after leaving', async () => {
    render(
      <PageViewer
        data-testid='page-viewer'
        doc={makeDocumentWithText()}
        pageNumber={1}
      />
    )

    const pageViewer = screen.getByTestId('page-viewer')
    expect(screen.queryByText('Hello viewport')).not.toBeInTheDocument()

    intersectionObserverMock.trigger(pageViewer, true)
    expect(screen.getByText('Loading')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Hello viewport')).toBeInTheDocument()
    })

    intersectionObserverMock.trigger(pageViewer, false)
    expect(screen.queryByText('Hello viewport')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })
})
