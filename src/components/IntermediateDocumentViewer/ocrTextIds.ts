import type { IntermediateText } from '@hamster-note/types'

export const prefixOcrTextIds = (
  texts: IntermediateText[],
  pageNumber: number
) =>
  texts.map((text) => ({
    ...text,
    id: `ocr-${pageNumber}-${text.id}`,
    color: 'transparent'
  }))
