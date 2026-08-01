const CJK_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const WORD_EDGE = /[\p{Letter}\p{Number}]$/u
const WORD_START = /^[\p{Letter}\p{Number}]/u

export const shouldSeparatePdfText = (
  previousContent: string,
  currentContent: string
): boolean => {
  if (/\s$/u.test(previousContent) || /^\s/u.test(currentContent)) return false
  if (
    CJK_CHARACTER.test(previousContent) &&
    CJK_CHARACTER.test(currentContent)
  ) {
    return false
  }
  return WORD_EDGE.test(previousContent) && WORD_START.test(currentContent)
}
