export type PdfPageStructure = {
  readonly pageNumber: number
  readonly width: number
  readonly height: number
}

type PdfFileIdentity = {
  readonly name: string
  readonly size: number
  readonly lastModified: number
}

export type PdfStructure = {
  readonly version: 1
  readonly file: PdfFileIdentity
  readonly pageCount: number
  readonly pages: readonly PdfPageStructure[]
}

const PDF_STRUCTURE_VERSION = 1 as const

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function parsePage(value: unknown): PdfPageStructure | null {
  if (typeof value !== 'object' || value === null) return null

  const pageNumber = Reflect.get(value, 'pageNumber')
  const width = Reflect.get(value, 'width')
  const height = Reflect.get(value, 'height')
  if (
    !isPositiveInteger(pageNumber) ||
    !isPositiveFiniteNumber(width) ||
    !isPositiveFiniteNumber(height)
  ) {
    return null
  }

  return { pageNumber, width, height }
}

function matchesFileIdentity(value: unknown, file: File): boolean {
  if (typeof value !== 'object' || value === null) return false
  return (
    Reflect.get(value, 'name') === file.name &&
    Reflect.get(value, 'size') === file.size &&
    Reflect.get(value, 'lastModified') === file.lastModified
  )
}

export function parsePdfStructureJson(
  json: string | null,
  file: File
): PdfStructure | null {
  if (json === null) return null

  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
  if (typeof value !== 'object' || value === null) return null

  const version = Reflect.get(value, 'version')
  const pageCount = Reflect.get(value, 'pageCount')
  const pagesValue = Reflect.get(value, 'pages')
  if (
    version !== PDF_STRUCTURE_VERSION ||
    !Number.isInteger(pageCount) ||
    typeof pageCount !== 'number' ||
    pageCount < 0 ||
    !Array.isArray(pagesValue) ||
    !matchesFileIdentity(Reflect.get(value, 'file'), file)
  ) {
    return null
  }

  const pages: PdfPageStructure[] = []
  const pageNumbers = new Set<number>()
  for (const pageValue of pagesValue) {
    const page = parsePage(pageValue)
    if (
      page === null ||
      page.pageNumber > pageCount ||
      pageNumbers.has(page.pageNumber)
    ) {
      return null
    }
    pageNumbers.add(page.pageNumber)
    pages.push(page)
  }

  return {
    version: PDF_STRUCTURE_VERSION,
    file: {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified
    },
    pageCount,
    pages: [...pages].sort((left, right) => left.pageNumber - right.pageNumber)
  }
}

export function mergePdfStructure(
  current: PdfStructure | null,
  file: File,
  pageCount: number,
  scannedPages: readonly PdfPageStructure[]
): PdfStructure {
  const pagesByNumber = new Map<number, PdfPageStructure>()
  if (current?.pageCount === pageCount) {
    for (const page of current.pages) pagesByNumber.set(page.pageNumber, page)
  }
  for (const page of scannedPages) pagesByNumber.set(page.pageNumber, page)

  return {
    version: PDF_STRUCTURE_VERSION,
    file: {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified
    },
    pageCount,
    pages: [...pagesByNumber.values()].sort(
      (left, right) => left.pageNumber - right.pageNumber
    )
  }
}

export function serializePdfStructure(structure: PdfStructure): string {
  return JSON.stringify(structure)
}
