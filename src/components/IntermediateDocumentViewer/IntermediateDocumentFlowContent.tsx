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
  | { readonly kind: 'texts'; readonly texts: IntermediateText[] }
  | { readonly kind: 'image'; readonly image: ReaderIntermediateImage }

const isText = (entry: IntermediateContent): entry is IntermediateText =>
  'content' in entry && 'fontSize' in entry

const isImage = (
  entry: IntermediateContent
): entry is ReaderIntermediateImage => 'src' in entry && 'polygon' in entry

function createContentRuns(content: IntermediateContent[]): ContentRun[] {
  const runs: ContentRun[] = []
  for (const entry of content) {
    if (isText(entry)) {
      const previous = runs.at(-1)
      if (previous?.kind === 'texts') previous.texts.push(entry)
      else runs.push({ kind: 'texts', texts: [entry] })
    } else if (isImage(entry)) {
      runs.push({ kind: 'image', image: entry })
    }
  }
  return runs
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
  return createContentRuns(content).map((run) => {
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
