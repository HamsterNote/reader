import type {
  IntermediateParagraph,
  IntermediateText
} from '@hamster-note/types'
import { Fragment, useMemo } from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
import { IntermediateDocumentFlowTextContent } from './IntermediateDocumentFlowTextContent'
import type { IntermediateDocumentSetTextRef } from './IntermediateDocumentPageContent'
import { reconstructPdfTextLayout } from './pdfTextLayout'
import { shouldSeparatePdfText } from './pdfTextSpacing'

type PdfTextContentProps = {
  readonly pageNumber: number
  readonly texts: IntermediateText[]
  readonly paragraphs: IntermediateParagraph[]
  readonly setTextRef?: IntermediateDocumentSetTextRef
  readonly fontScale?: ReaderFontScale
}

export function PdfTextContent({
  pageNumber,
  texts,
  paragraphs,
  setTextRef,
  fontScale
}: PdfTextContentProps) {
  const layout = useMemo(() => reconstructPdfTextLayout(texts), [texts])

  if (!layout.hasPositionedText) {
    return (
      <IntermediateDocumentFlowTextContent
        pageNumber={pageNumber}
        texts={texts}
        paragraphs={paragraphs}
        setTextRef={setTextRef}
        fontScale={fontScale}
        preserveSourceFontSize={false}
      />
    )
  }

  const baseFontScale = fontScale ?? 1
  return (
    <div className='hamster-reader__pdf-text-content'>
      {layout.paragraphs.map((paragraph) => (
        <div
          key={`${pageNumber}:paragraph:${paragraph.lines[0]?.glyphs[0]?.text.id}`}
          className='hamster-reader__pdf-text-paragraph'
        >
          {paragraph.lines.map((line, lineIndex) => {
            const previousLine = paragraph.lines[lineIndex - 1]
            const previousContent = previousLine?.glyphs.at(-1)?.text.content
            const currentContent = line.glyphs[0]?.text.content
            return (
              <Fragment key={`${pageNumber}:line:${line.glyphs[0]?.text.id}`}>
                {previousContent &&
                currentContent &&
                shouldSeparatePdfText(previousContent, currentContent)
                  ? ' '
                  : null}
                {line.glyphs.map((glyph) => (
                  <Fragment key={`${pageNumber}:${glyph.text.id}`}>
                    {glyph.spaceBefore ? ' ' : null}
                    <span
                      ref={
                        setTextRef
                          ? setTextRef(glyph.text, pageNumber)
                          : undefined
                      }
                      className='hamster-reader__intermediate-text hamster-reader__intermediate-text--flow hamster-reader__intermediate-text--pdf-flow'
                      data-text-id={glyph.text.id}
                      data-page-number={pageNumber}
                      style={{
                        fontSize: `${glyph.fontSizeRatio * baseFontScale}rem`,
                        fontFamily: glyph.text.fontFamily || undefined,
                        fontWeight: glyph.text.fontWeight || undefined,
                        fontStyle: glyph.text.italic ? 'italic' : undefined,
                        color:
                          glyph.text.color === 'transparent'
                            ? undefined
                            : glyph.text.color || undefined,
                        lineHeight: 1.5
                      }}
                    >
                      {glyph.text.content}
                    </span>
                  </Fragment>
                ))}
              </Fragment>
            )
          })}
        </div>
      ))}
    </div>
  )
}
