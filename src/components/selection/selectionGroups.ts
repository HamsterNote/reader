import type { ReaderSelectionRange } from '../../types/selection'

/** Never infer membership from endpoint overlap, timestamps or ID prefixes. */
export function getSelectionGroup(
  ranges: readonly ReaderSelectionRange[],
  id: string | null | undefined
): ReaderSelectionRange[] {
  const target = ranges.find((range) => range.id === id)
  if (!target) return []
  const group = target.selectionGroup
  return group
    ? ranges
        .filter((range) => range.selectionGroup?.id === group.id)
        .sort((a, b) => a.selectionGroup!.index - b.selectionGroup!.index)
    : [target]
}
