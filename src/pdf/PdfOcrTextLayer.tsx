import type { IntermediateText } from '@hamster-note/types'
import { IntermediateDocumentPageContent } from '../components/IntermediateDocumentViewer/IntermediateDocumentPageContent'
import type { PageViewport } from './pdfjsRuntime'

export function PdfOcrTextLayer({
  texts,
  pageNumber,
  offset,
  viewport,
  scaleOneViewport,
  debug
}: {
  texts: readonly IntermediateText[]
  pageNumber: number
  offset: number
  viewport: PageViewport
  scaleOneViewport: PageViewport
  debug?: boolean
}) {
  const project = (x: number, y: number) => {
    const [px, py] = scaleOneViewport.convertToPdfPoint(x, y)
    return viewport.convertToViewportPoint(px, py)
  }
  const [x, y] = project(0, 0)
  const [xx, xy] = project(1, 0)
  const [yx, yy] = project(0, 1)
  const offsets = new Map<IntermediateText, number>()
  const displayed = texts.map((text) => ({
    ...text,
    color: debug ? 'rgba(0, 0, 0, 0.5)' : 'transparent'
  }))
  for (const text of displayed) {
    offsets.set(text, offset)
    offset += text.content.length
  }
  return (
    <div
      data-testid={`pdf-ocr-page-${pageNumber}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: scaleOneViewport.width,
        height: scaleOneViewport.height,
        transformOrigin: '0 0',
        transform: `matrix(${xx - x}, ${xy - y}, ${yx - x}, ${yy - y}, ${x}, ${y})`,
        pointerEvents: 'none',
        zIndex: 2
      }}
    >
      <IntermediateDocumentPageContent
        pageNumber={pageNumber}
        texts={[]}
        paragraphs={[]}
        useFlowLayout={false}
        images={[]}
        baseImageSource={undefined}
        ocrTexts={displayed}
        setTextRef={(text) => (element) => {
          if (!element) return
          element.dataset.selectionStartOffset = String(offsets.get(text))
          element.style.pointerEvents = 'auto'
          element.style.userSelect = 'text'
          element.style.outline = debug ? '1px solid red' : ''
        }}
      />
    </div>
  )
}
