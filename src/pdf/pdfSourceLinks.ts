import type { PDFDocumentProxy, TextItem } from './pdfjsRuntime'

type Destination = [number, { name: 'XYZ' }, number, number, null]
type LinkAnnotation = {
  subtype: string
  url?: string
  unsafeUrl?: string
  overlaidText?: string
  rect: number[]
}

type SourceLinks = {
  destinations: Map<string, Destination | null>
  origin: string | null
}

function httpUrl(value: string | null | undefined): URL | null {
  try {
    const url = new URL(value ?? '')
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

/** Reader-mode print exports retain the source URL in their heading permalinks. */
function sourceUrl(annotation: LinkAnnotation): URL | null {
  try {
    const wrapper = new URL(annotation.unsafeUrl ?? '')
    if (wrapper.protocol !== 'chrome-extension:') return null
    const source = httpUrl(wrapper.searchParams.get('url'))
    if (!source || source.hostname === 'undefined') return null
    if (wrapper.hash) source.hash = wrapper.hash
    return source
  } catch {
    return null
  }
}

function fragmentKey(hash: string): string {
  try {
    return decodeURIComponent(hash)
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '')
  } catch {
    return ''
  }
}

function addDestination(index: SourceLinks, key: string, dest: Destination) {
  // An ambiguous heading must never silently jump to the first occurrence.
  index.destinations.set(key, index.destinations.has(key) ? null : dest)
}

function headingAtMarker(
  items: TextItem[],
  marker: LinkAnnotation,
  pageIndex: number
) {
  // The § marker is on the heading's baseline. The physical annotation
  // position survives PDF concatenation, unlike some exported /Dest refs.
  const glyph = items.find(
    (item) =>
      item.str === '§' &&
      item.transform[4] >= marker.rect[0] - 1 &&
      item.transform[4] <= marker.rect[2] + 1 &&
      item.transform[5] >= marker.rect[1] &&
      item.transform[5] <= marker.rect[3]
  )
  if (!glyph) return null
  const title = items
    .filter(
      (item) =>
        item.str !== '§' &&
        Math.abs(item.transform[5] - glyph.transform[5]) < 1 &&
        item.transform[4] < glyph.transform[4]
    )
    .map((item) => item.str)
    .join('')
  const dest: Destination = [
    pageIndex,
    { name: 'XYZ' },
    Math.min(
      ...items
        .filter(
          (item) =>
            item.str && Math.abs(item.transform[5] - glyph.transform[5]) < 1
        )
        .map((item) => item.transform[4])
    ),
    marker.rect[3] + 3,
    null
  ]
  return { title, dest }
}

function recordHeading(
  index: SourceLinks,
  section: URL,
  source: URL | null,
  heading: { title: string; dest: Destination }
) {
  if (source) {
    addDestination(index, `${section.pathname}#`, heading.dest)
    if (source.hash)
      addDestination(
        index,
        `${section.pathname}#${fragmentKey(source.hash)}`,
        heading.dest
      )
  }
  const key = fragmentKey(heading.title)
  if (key && key !== fragmentKey(source?.hash ?? ''))
    addDestination(index, `${section.pathname}#${key}`, heading.dest)
}

async function readPageHeadings(
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>
) {
  const markers = (await page.getAnnotations()).filter(
    (item: LinkAnnotation) =>
      item.subtype === 'Link' && item.overlaidText?.trim() === '§'
  ) as LinkAnnotation[]
  if (!markers.length) return { markers, items: [] }
  const items = (await page.getTextContent()).items.filter(
    (item): item is TextItem => 'str' in item
  )
  return { markers, items }
}

function indexPageHeadings(
  index: SourceLinks,
  origins: Set<string>,
  section: URL | null,
  markers: LinkAnnotation[],
  items: TextItem[],
  pageIndex: number
) {
  for (const marker of markers) {
    const source = sourceUrl(marker)
    if (source) {
      origins.add(source.origin)
      section = source
    }
    if (!section) continue
    const heading = headingAtMarker(items, marker, pageIndex)
    if (heading) recordHeading(index, section, source, heading)
  }
  return section
}

/** Recover printed cross-chapter links from the PDF's own source/heading data. */
export async function indexPdfSourceLinks(
  doc: PDFDocumentProxy,
  isCancelled: () => boolean = () => false
): Promise<SourceLinks> {
  const index: SourceLinks = { destinations: new Map(), origin: null }
  const origins = new Set<string>()
  let section: URL | null = null
  for (let number = 1; number <= doc.numPages; number++) {
    if (isCancelled()) break
    const page = await doc.getPage(number)
    const { markers, items } = await readPageHeadings(page)
    if (isCancelled()) break
    section = indexPageHeadings(
      index,
      origins,
      section,
      markers,
      items,
      number - 1
    )
  }
  if (origins.size === 1) index.origin = [...origins][0]
  return index
}

type LinkService = {
  goToDestination: (dest: unknown[]) => Promise<void>
  getDestinationHash: (dest: unknown[]) => string
}

export function bindPdfSourceLinks(
  container: HTMLElement,
  doc: PDFDocumentProxy,
  service: LinkService
) {
  let cancelled = false
  let pending: Promise<SourceLinks> | undefined
  const local = new WeakMap<HTMLAnchorElement, Destination>()
  let index: SourceLinks | undefined
  const repair = (anchor: HTMLAnchorElement) => {
    const url = httpUrl(anchor.href)
    if (!index || url?.hostname !== 'undefined') return
    const dest = index.destinations.get(
      `${url.pathname}#${fragmentKey(url.hash)}`
    )
    if (dest) {
      local.set(anchor, dest)
      anchor.href = service.getDestinationHash(dest)
      anchor.removeAttribute('target')
      anchor.removeAttribute('title')
    } else if (index.origin) {
      anchor.href = new URL(
        url.pathname + url.search + url.hash,
        index.origin
      ).href
      anchor.title = anchor.href
    }
  }
  const repairAll = () =>
    container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(repair)
  const load = () => {
    pending ??= indexPdfSourceLinks(doc, () => cancelled).then((value) => {
      if (!cancelled) {
        index = value
        repairAll()
      }
      return value
    })
    return pending
  }
  const click = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      'a[href]'
    )
    if (!anchor) return
    const dest = local.get(anchor)
    if (dest) {
      event.preventDefault()
      event.stopPropagation()
      // eslint-disable-next-line sonarjs/void-use -- browser click handlers do not await navigation
      void service.goToDestination(dest)
    } else if (httpUrl(anchor.href)?.hostname === 'undefined') {
      event.preventDefault()
      event.stopPropagation()
      // eslint-disable-next-line sonarjs/void-use -- deferred click after the document index is ready
      void load()
        .then(() => {
          if (cancelled || !anchor.isConnected) return
          repair(anchor)
          if (httpUrl(anchor.href)?.hostname !== 'undefined') anchor.click()
        })
        .catch(() => undefined)
    }
  }
  const update = () => {
    repairAll()
    if (!pending && container.querySelector('a[href*="//undefined/"]')) {
      // eslint-disable-next-line sonarjs/void-use -- lazy indexing is cancelled on document replacement
      void load().catch(() => undefined)
    }
  }
  const observer = new MutationObserver(update)
  observer.observe(container, { childList: true, subtree: true })
  container.addEventListener('click', click, true)
  update()
  return () => {
    cancelled = true
    observer.disconnect()
    container.removeEventListener('click', click, true)
  }
}
