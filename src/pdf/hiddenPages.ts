export type HiddenPageEntry = number | string

export type HiddenPageGroup = {
  readonly start: number
  readonly end: number
  readonly pages: readonly number[]
}

export function getHiddenPageNumber(entry: HiddenPageEntry): number | null {
  if (typeof entry === 'number') {
    return Number.isSafeInteger(entry) && entry > 0 ? entry : null
  }
  const match = /^page-([1-9]\d*)$/.exec(entry)
  if (!match) return null
  const pageNumber = Number(match[1])
  return Number.isSafeInteger(pageNumber) ? pageNumber : null
}

export function normalizeHiddenPageNumbers(
  hiddenPages: readonly HiddenPageEntry[] | undefined
): ReadonlySet<number> {
  const result = new Set<number>()
  for (const entry of hiddenPages ?? []) {
    const pageNumber = getHiddenPageNumber(entry)
    if (pageNumber !== null) result.add(pageNumber)
  }
  return result
}

export function groupHiddenPages(
  hiddenPages: readonly HiddenPageEntry[] | undefined,
  allowedPages: readonly number[]
): readonly HiddenPageGroup[] {
  const allowed = new Set(allowedPages)
  const pages = [...normalizeHiddenPageNumbers(hiddenPages)]
    .filter((pageNumber) => allowed.has(pageNumber))
    .sort((left, right) => left - right)
  const groups: {
    start: number
    end: number
    pages: number[]
  }[] = []
  for (const pageNumber of pages) {
    const current = groups.at(-1)
    if (current && current.end + 1 === pageNumber) {
      current.pages.push(pageNumber)
      current.end = pageNumber
    } else {
      groups.push({ start: pageNumber, end: pageNumber, pages: [pageNumber] })
    }
  }
  return groups
}

export function removeHiddenPageNumbers(
  hiddenPages: readonly HiddenPageEntry[] | undefined,
  pageNumbers: readonly number[]
): readonly HiddenPageEntry[] {
  const removed = new Set(pageNumbers)
  return (hiddenPages ?? []).filter((entry) => {
    const pageNumber = getHiddenPageNumber(entry)
    return pageNumber === null || !removed.has(pageNumber)
  })
}
