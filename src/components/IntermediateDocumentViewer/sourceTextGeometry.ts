import type { IntermediateText } from '@hamster-note/types'
import type { ReaderSelectionRect } from '../../types/selection'

type SliceGeometry = (start: number, end: number) => ReaderSelectionRect[]

// Source engines can provide exact glyph geometry instead of approximating
// partial selections from an IntermediateText polygon. Entries live only as
// long as the loaded text objects; no document-wide geometry cache is kept.
export const sourceTextGeometry = new WeakMap<IntermediateText, SliceGeometry>()

export function registerSourceTextGeometry(
  text: IntermediateText,
  slice: SliceGeometry
) {
  sourceTextGeometry.set(text, slice)
}

export function releaseSourceTextGeometry(
  texts: readonly IntermediateText[] = []
) {
  for (const text of texts) sourceTextGeometry.delete(text)
}
