import type { IntermediateContent, IntermediateText } from '@hamster-note/types'

export const isIntermediateText = (
  content: IntermediateContent
): content is IntermediateText => 'content' in content && 'fontSize' in content
