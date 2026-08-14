import type {
  IntermediateContent,
  IntermediateParagraph,
  IntermediateText
} from '@hamster-note/types'
import { Fragment } from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
import { IntermediateDocumentFlowImageContent } from './IntermediateDocumentFlowImageContent'
import { IntermediateDocumentFlowTextContent } from './IntermediateDocumentFlowTextContent'
import type { IntermediateDocumentSetTextRef } from './IntermediateDocumentPageContent'
import { isIntermediateText } from './intermediateContent'
import type { ReaderIntermediateImage } from './intermediateImage'
import { PdfTextContent } from './PdfTextContent'

type IntermediateDocumentFlowContentProps = {
  pageNumber: number
  content: IntermediateContent[]
  paragraphs: IntermediateParagraph[]
  isPdf?: boolean
  setTextRef?: IntermediateDocumentSetTextRef
  fontScale?: ReaderFontScale
  preserveSourceFontSize: boolean
}

type ContentRun =
  | {
      readonly kind: 'texts'
      readonly texts: IntermediateText[]
      readonly sourceOffsetBase: number
    }
  | { readonly kind: 'image'; readonly image: ReaderIntermediateImage }

type PositionedContent = {
  readonly entry: IntermediateContent
  readonly index: number
  readonly left: number
  readonly top: number
}

const isImage = (
  entry: IntermediateContent
): entry is ReaderIntermediateImage => 'src' in entry && 'polygon' in entry

function getContentPosition(
  entry: IntermediateContent,
  index: number
): PositionedContent | undefined {
  const polygon: unknown = Reflect.get(entry, 'polygon')
  if (!Array.isArray(polygon) || polygon.length === 0) return undefined

  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  for (let pointIndex = 0; pointIndex < polygon.length; pointIndex += 1) {
    const point: unknown = polygon[pointIndex]
    if (!Array.isArray(point)) return undefined
    const x: unknown = point[0]
    const y: unknown = point[1]
    if (
      typeof x !== 'number' ||
      !Number.isFinite(x) ||
      typeof y !== 'number' ||
      !Number.isFinite(y)
    )
      return undefined
    left = Math.min(left, x)
    top = Math.min(top, y)
  }

  return { entry, index, left, top }
}

function orderPdfContent(
  content: IntermediateContent[]
): IntermediateContent[] {
  const positioned = content
    .map(getContentPosition)
    .filter((entry): entry is PositionedContent => entry !== undefined)
    .sort(
      (left, right) =>
        left.top - right.top ||
        left.left - right.left ||
        left.index - right.index
    )

  let positionedIndex = 0
  return content.map((entry, index) => {
    if (!getContentPosition(entry, index)) return entry
    const orderedEntry = positioned[positionedIndex]?.entry
    positionedIndex += 1
    return orderedEntry ?? entry
  })
}

function createContentRuns(content: IntermediateContent[]): ContentRun[] {
  const runs: ContentRun[] = []
  let sourceOffset = 0
  for (const entry of content) {
    if (isIntermediateText(entry)) {
      const previous = runs.at(-1)
      if (previous?.kind === 'texts') previous.texts.push(entry)
      else
        runs.push({
          kind: 'texts',
          texts: [entry],
          sourceOffsetBase: sourceOffset
        })
      sourceOffset += entry.content.length
    } else if (isImage(entry)) {
      runs.push({ kind: 'image', image: entry })
    }
  }
  return runs
}

function createSourceOffsets(
  content: IntermediateContent[]
): ReadonlyMap<IntermediateText, number> {
  const offsets = new Map<IntermediateText, number>()
  let sourceOffset = 0
  for (const entry of content) {
    if (!isIntermediateText(entry)) continue
    offsets.set(entry, sourceOffset)
    sourceOffset += entry.content.length
  }
  return offsets
}

export function IntermediateDocumentFlowContent({
  pageNumber,
  content,
  paragraphs,
  isPdf = false,
  setTextRef,
  fontScale,
  preserveSourceFontSize
}: IntermediateDocumentFlowContentProps) {
  const flowContent = isPdf ? orderPdfContent(content) : content
  const sourceOffsets = isPdf ? createSourceOffsets(content) : undefined
  return createContentRuns(flowContent).map((run) => {
    if (run.kind === 'image') {
      return (
        <IntermediateDocumentFlowImageContent
          key={`${pageNumber}:image:${run.image.id}`}
          images={[run.image]}
        />
      )
    }

    return (
      <Fragment
        key={`${pageNumber}:texts:${run.texts[0]?.id}:${run.texts.at(-1)?.id}`}
      >
        {isPdf ? (
          <PdfTextContent
            pageNumber={pageNumber}
            texts={run.texts}
            paragraphs={paragraphs}
            setTextRef={setTextRef}
            fontScale={fontScale}
            sourceOffsetBase={run.sourceOffsetBase}
            sourceOffsets={sourceOffsets}
          />
        ) : (
          <IntermediateDocumentFlowTextContent
            pageNumber={pageNumber}
            texts={run.texts}
            paragraphs={paragraphs}
            setTextRef={setTextRef}
            fontScale={fontScale}
            preserveSourceFontSize={preserveSourceFontSize}
          />
        )}
      </Fragment>
    )
  })
}
