import type {
  IntermediateParagraph,
  IntermediateText
} from '@hamster-note/types'
import { Fragment } from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
import type { IntermediateDocumentSetTextRef } from './IntermediateDocumentPageContent'
import { getScaledFontSize } from './textSpanStyle'

type IntermediateDocumentFlowTextContentProps = {
  pageNumber: number
  texts: IntermediateText[]
  paragraphs: IntermediateParagraph[]
  setTextRef?: IntermediateDocumentSetTextRef
  fontScale?: ReaderFontScale
  preserveSourceFontSize: boolean
  sourceOffsets?: ReadonlyMap<IntermediateText, number>
}

/**
 * 找出每个非末段的最后一个可见文本条目。
 *
 * `isEOL` 只表达换行，不能作为段落边界；段落边界必须来自解析器输出的
 * `IntermediateParagraph.textIds`。忽略当前页不存在的 text id，可兼容分页切片。
 */
const getParagraphGapTextIds = (
  texts: IntermediateText[],
  paragraphs: IntermediateParagraph[]
): ReadonlySet<string> => {
  const visibleTextIds = new Set(texts.map((text) => text.id))
  const paragraphEndTextIds = paragraphs.flatMap((paragraph) => {
    const visibleParagraphTextIds = paragraph.textIds.filter((textId) =>
      visibleTextIds.has(textId)
    )
    const endTextId = visibleParagraphTextIds.at(-1)
    return endTextId ? [endTextId] : []
  })

  return new Set(paragraphEndTextIds.slice(0, -1))
}

export function IntermediateDocumentFlowTextContent({
  pageNumber,
  texts,
  paragraphs,
  setTextRef,
  fontScale,
  preserveSourceFontSize,
  sourceOffsets
}: IntermediateDocumentFlowTextContentProps) {
  const paragraphGapTextIds = getParagraphGapTextIds(texts, paragraphs)

  return (
    <>
      {texts.map((text, index) => {
        const key = `${pageNumber}:${text.id ?? index}`
        const hasContent = text.content.length > 0
        const paragraphGap = paragraphGapTextIds.has(text.id) ? (
          <span
            className='hamster-reader__intermediate-paragraph-gap'
            aria-hidden='true'
          />
        ) : null

        if (!hasContent && text.isEOL) {
          return (
            <Fragment key={key}>
              <br />
              {paragraphGap}
            </Fragment>
          )
        }

        const shouldSetFontSize =
          preserveSourceFontSize || fontScale !== undefined
        return (
          <Fragment key={key}>
            <span
              ref={setTextRef ? setTextRef(text, pageNumber) : undefined}
              className='hamster-reader__intermediate-text hamster-reader__intermediate-text--flow'
              data-text-id={text.id}
              data-selection-start-offset={sourceOffsets?.get(text)}
              data-page-number={pageNumber}
              style={
                shouldSetFontSize
                  ? {
                      fontSize: getScaledFontSize(text.fontSize, fontScale),
                      lineHeight: 1.5
                    }
                  : { lineHeight: 1.5 }
              }
            >
              {text.content}
            </span>
            {text.isEOL ? <br /> : null}
            {paragraphGap}
          </Fragment>
        )
      })}
    </>
  )
}
