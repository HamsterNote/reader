import {
  IntermediateDocument,
  type IntermediateDocumentSerialized
} from '@hamster-note/types'
import { VirtualPaper } from '@hamster-note/virtual-paper'
import React from 'react'
import { PageViewer, type PageViewerPage } from './page'

interface DocumentViewerProps extends React.HTMLAttributes<HTMLDivElement> {
  document?:
    | IntermediateDocument
    | IntermediateDocumentSerialized
    | null
    | undefined
}

type PageDescriptor = {
  readonly id: string
  readonly number: number
  readonly page?: PageViewerPage
}

type DocumentContentSize = {
  readonly width: number
  readonly height: number
}

interface DocumentViewerState {
  readonly pages: PageDescriptor[]
  readonly contentSize: DocumentContentSize
}

export class DocumentViewer extends React.Component<
  DocumentViewerProps,
  DocumentViewerState
> {
  constructor(props: DocumentViewerProps) {
    super(props)
    this.state = {
      pages: [],
      contentSize: { width: 0, height: 0 }
    }
  }

  render() {
    const { document: doc, ...restProps } = this.props
    return (
      <div {...restProps}>
        <div>{doc?.title}</div>
        <VirtualPaper
          containMode='contain'
          contentSize={this.state.contentSize}
        >
          {this.state.pages.map((page) => (
            <PageViewer
              key={page.id}
              doc={doc}
              documentId={doc?.id}
              page={page.page}
              pageNumber={page.number}
            />
          ))}
        </VirtualPaper>
      </div>
    )
  }

  componentDidMount() {
    this.updatePagesFromDocument()
  }

  componentDidUpdate(prevProps: DocumentViewerProps) {
    if (prevProps.document !== this.props.document) {
      this.updatePagesFromDocument()
    }
  }

  private updatePagesFromDocument() {
    const doc = this.props.document
    const pages = this.getPageDescriptors(doc)
    this.setState({
      pages,
      contentSize: this.getContentSize(doc, pages)
    })
  }

  private getPageDescriptors(
    doc: DocumentViewerProps['document']
  ): PageDescriptor[] {
    if (!doc) {
      return []
    }

    if (Array.isArray(doc.pages)) {
      return doc.pages.map((page) => ({
        id: page.id,
        number: page.number,
        page
      }))
    }

    if (!hasRuntimePageNumbers(doc)) {
      return []
    }

    return doc.pageNumbers.map((pageNumber) => ({
      id: `${doc.id}:${pageNumber}`,
      number: pageNumber
    }))
  }

  private getContentSize(
    doc: DocumentViewerProps['document'],
    pages: readonly PageDescriptor[]
  ): DocumentContentSize {
    return pages.reduce<DocumentContentSize>(
      (contentSize, page) => {
        const pageSize = this.getPageSize(doc, page)
        return {
          width: Math.max(contentSize.width, pageSize.width),
          height: contentSize.height + pageSize.height
        }
      },
      { width: 0, height: 0 }
    )
  }

  private getPageSize(
    doc: DocumentViewerProps['document'],
    page: PageDescriptor
  ): DocumentContentSize {
    if (page.page) {
      return { width: page.page.width, height: page.page.height }
    }

    if (doc && 'getPageSizeByPageNumber' in doc) {
      const pageSize = doc.getPageSizeByPageNumber(page.number)
      if (pageSize) {
        return { width: pageSize.x, height: pageSize.y }
      }
    }

    return { width: 0, height: 0 }
  }
}

function hasRuntimePageNumbers(
  doc: DocumentViewerProps['document']
): doc is IntermediateDocument {
  return Boolean(
    doc &&
    'pageNumbers' in doc &&
    Array.isArray(doc.pageNumbers) &&
    'getPageSizeByPageNumber' in doc
  )
}
