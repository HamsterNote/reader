export function getPagePreloadWindow(
  pageNumbers: readonly number[],
  anchorPageNumbers: readonly number[],
  radius: number
): number[] {
  const safeRadius = Number.isFinite(radius)
    ? Math.max(0, Math.floor(radius))
    : 0
  const includedIndexes = new Set<number>()

  anchorPageNumbers.forEach((anchorPageNumber) => {
    const anchorIndex = pageNumbers.indexOf(anchorPageNumber)
    if (anchorIndex === -1) return

    const startIndex = Math.max(0, anchorIndex - safeRadius)
    const endIndex = Math.min(pageNumbers.length - 1, anchorIndex + safeRadius)
    for (let index = startIndex; index <= endIndex; index += 1) {
      includedIndexes.add(index)
    }
  })

  return pageNumbers.filter((_, index) => includedIndexes.has(index))
}
