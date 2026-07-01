import React from 'react'
import {
  IntermediateDocument,
  IntermediatePage,
  IntermediateText,
  type IntermediateContent,
  type IntermediateDocumentSerialized,
  type IntermediatePageSerialized
} from '@hamster-note/types'
import {
  readCachedPageText,
  writeCachedPageText,
  type PageTextCacheRecord
} from './pageTextCache'

export type PageViewerPage = IntermediatePage | IntermediatePageSerialized

type PageViewerState = Readonly<{
  isVisible: boolean
  status: 'idle' | 'loading' | 'loaded'
  text: string
}>

type PageViewerProps = {
  readonly doc?: IntermediateDocument | IntermediateDocumentSerialized | null
  readonly documentId?: string
  readonly page?: PageViewerPage
  readonly pageNumber: number
  readonly onEnterViewport?: (pageNumber: number) => void
  readonly onLeaveViewport?: (pageNumber: number) => void
} & React.HTMLAttributes<HTMLDivElement>

export class PageViewer extends React.Component<
  PageViewerProps,
  PageViewerState
> {
  private rootElement: HTMLDivElement | null = null
  private intersectionObserver: IntersectionObserver | null = null
  private isInViewport = false
  private mounted = false
  private loadToken = 0

  constructor(props: PageViewerProps) {
    super(props)
    this.state = { isVisible: false, status: 'idle', text: '' }
  }

  render() {
    const { doc, pageNumber } = this.props
    const restProps = this.getRootProps()
    const size = this.getPageSize(doc, pageNumber)
    return (
      <div
        {...restProps}
        ref={this.setRootElement}
        style={{
          ...restProps.style,
          width: `${size?.x || 0}px`,
          height: `${size?.y || 0}px`
        }}
      >
        {this.renderPageContent()}
      </div>
    )
  }

  componentDidMount() {
    this.mounted = true
    if (!this.rootElement || !window.IntersectionObserver) {
      return
    }

    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      if (!entry) {
        return
      }

      this.handleViewportChange(entry.isIntersecting)
    })
    this.intersectionObserver.observe(this.rootElement)
  }

  componentDidUpdate(prevProps: PageViewerProps) {
    if (
      prevProps.doc === this.props.doc &&
      prevProps.documentId === this.props.documentId &&
      prevProps.page === this.props.page &&
      prevProps.pageNumber === this.props.pageNumber
    ) {
      return
    }

    this.loadToken += 1
    this.setState(
      { isVisible: this.isInViewport, status: 'idle', text: '' },
      () => {
        if (this.isInViewport) {
          this.loadVisiblePageText()
        }
      }
    )
  }

  componentWillUnmount() {
    this.mounted = false
    this.loadToken += 1
    this.intersectionObserver?.disconnect()
  }

  private setRootElement = (element: HTMLDivElement | null) => {
    this.rootElement = element
  }

  private getPageSize(
    doc: PageViewerProps['doc'],
    pageNumber: number
  ): { x?: number; y?: number } | undefined {
    if (doc && 'getPageSizeByPageNumber' in doc) {
      return doc.getPageSizeByPageNumber(pageNumber)
    }

    const serializedPage = doc?.pages?.[pageNumber - 1]
    if (serializedPage) {
      return { x: serializedPage.width, y: serializedPage.height }
    }

    const propPage = this.props.page
    if (propPage) {
      return { x: propPage.width, y: propPage.height }
    }

    return undefined
  }

  private getRootProps(): React.HTMLAttributes<HTMLDivElement> {
    const rootProps = { ...this.props }
    Reflect.deleteProperty(rootProps, 'doc')
    Reflect.deleteProperty(rootProps, 'documentId')
    Reflect.deleteProperty(rootProps, 'page')
    Reflect.deleteProperty(rootProps, 'pageNumber')
    Reflect.deleteProperty(rootProps, 'onEnterViewport')
    Reflect.deleteProperty(rootProps, 'onLeaveViewport')
    return rootProps
  }

  private renderPageContent() {
    if (!this.state.isVisible) {
      return null
    }

    if (this.state.status === 'loading') {
      return <div>Loading</div>
    }

    if (this.state.status === 'loaded') {
      return <div>{this.state.text}</div>
    }

    return null
  }

  private handleViewportChange(isInViewport: boolean) {
    if (this.isInViewport === isInViewport) {
      return
    }

    this.isInViewport = isInViewport
    if (isInViewport) {
      this.props.onEnterViewport?.(this.props.pageNumber)
      this.loadVisiblePageText()
      return
    }

    this.loadToken += 1
    this.setState({ isVisible: false, status: 'idle', text: '' })
    this.props.onLeaveViewport?.(this.props.pageNumber)
  }

  private async loadVisiblePageText() {
    const loadToken = this.loadToken + 1
    this.loadToken = loadToken
    this.setState({ isVisible: true, status: 'loading', text: '' })

    const cacheRecord = this.getPageCacheRecord('')
    const cachedText = await readCachedPageText(cacheRecord)
    if (!this.isCurrentLoad(loadToken)) {
      return
    }

    if (cachedText !== null) {
      this.setState({ isVisible: true, status: 'loaded', text: cachedText })
      return
    }

    try {
      const text = await this.loadPageText()
      if (!this.isCurrentLoad(loadToken)) {
        return
      }

      await writeCachedPageText(this.getPageCacheRecord(text))
      if (!this.isCurrentLoad(loadToken)) {
        return
      }

      this.setState({ isVisible: true, status: 'loaded', text })
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error
      }

      if (this.isCurrentLoad(loadToken)) {
        this.setState({ isVisible: true, status: 'loaded', text: '' })
      }
    }
  }

  private async loadPageText(): Promise<string> {
    const page = await this.getPage()
    if (!page) {
      return ''
    }

    const content = await page.getContent()
    return content
      .filter(isIntermediateText)
      .map((text) => text.content)
      .join('')
  }

  private async getPage(): Promise<IntermediatePage | null> {
    const { doc, page, pageNumber } = this.props

    if (page instanceof IntermediatePage) {
      return page
    }

    if (page) {
      return new IntermediatePage(page)
    }

    if (doc && 'getPageByPageNumber' in doc) {
      return (await doc.getPageByPageNumber(pageNumber)) ?? null
    }

    const serializedPage = doc?.pages?.[pageNumber - 1]
    return serializedPage ? new IntermediatePage(serializedPage) : null
  }

  private getPageCacheRecord(text: string): PageTextCacheRecord | null {
    const documentId = this.props.documentId ?? this.props.doc?.id
    if (!documentId) {
      return null
    }

    return {
      cacheKey: `${documentId}:${this.props.pageNumber}`,
      documentId,
      pageNumber: this.props.pageNumber,
      text
    }
  }

  private isCurrentLoad(loadToken: number) {
    return this.mounted && this.isInViewport && this.loadToken === loadToken
  }
}

function isIntermediateText(
  content: IntermediateContent
): content is IntermediateText {
  return content instanceof IntermediateText
}
