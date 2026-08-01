import JSZip from 'jszip'

import { type EpubImagePlacement, getTextBeforeImage } from './epubContentOrder'

export type EpubBinaryInput = ArrayBuffer | Uint8Array | File | Blob

export type EpubImageMetadata = {
  readonly altsByPage: readonly (readonly (string | null)[])[]
  readonly imagePlacementsByPage: readonly (readonly EpubImagePlacement[])[]
  readonly coverAlt: string | null
  readonly coverInSpine: boolean
}

type EpubManifestItem = {
  readonly id: string
  readonly isNavigation: boolean
  readonly mediaType: string
  readonly path: string
}

type EpubPackageIndex = {
  readonly chapterPaths: readonly string[]
  readonly imageIdsByPath: ReadonlyMap<string, string>
  readonly packagePath: string
  readonly xhtmlPaths: readonly string[]
}

type EpubPageImage = {
  readonly alt: string | null
  readonly id: string
  readonly path: string
  readonly textBefore: string
}

function resolveArchivePath(
  basePath: string,
  pathReference: string
): string | null {
  const trimmed = pathReference.trim()
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed) ||
    trimmed.includes('\\')
  ) {
    return null
  }

  const pathWithoutSuffix = trimmed.split(/[?#]/, 1)[0]
  if (!pathWithoutSuffix) return null

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathWithoutSuffix)
  } catch (error) {
    if (error instanceof URIError) return null
    throw error
  }

  const resolved = decodedPath.startsWith('/')
    ? []
    : basePath.split('/').slice(0, -1)
  for (const segment of decodedPath.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
      continue
    }
    resolved.push(segment)
  }

  return resolved.join('/') || null
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function getElements(document: Document, localName: string): Element[] {
  return Array.from(document.getElementsByTagNameNS('*', localName))
}

async function readArchiveText(
  archive: JSZip,
  path: string
): Promise<string | null> {
  const entry = archive.file(path)
  return entry ? entry.async('string') : null
}

async function readPageImages(
  archive: JSZip,
  chapterPath: string,
  imageIdsByPath: ReadonlyMap<string, string>
): Promise<readonly EpubPageImage[]> {
  const chapterXml = await readArchiveText(archive, chapterPath)
  if (!chapterXml) return []

  const seenImageIds = new Set<string>()
  return getElements(parseXml(chapterXml), 'img').flatMap((image) => {
    const src = image.getAttribute('src')
    const path = src ? resolveArchivePath(chapterPath, src) : null
    if (!path) return []

    const id = imageIdsByPath.get(path)
    if (!id || seenImageIds.has(id)) return []

    seenImageIds.add(id)
    return [
      {
        alt: image.getAttribute('alt')?.trim() || null,
        id,
        path,
        textBefore: getTextBeforeImage(image)
      }
    ]
  })
}

async function hasZipSignature(source: EpubBinaryInput): Promise<boolean> {
  let bytes: Uint8Array
  if (source instanceof Blob) {
    bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () =>
        reject(reader.error ?? new Error('Unable to read the EPUB signature'))
      reader.onload = () => {
        const result = reader.result
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error('Unexpected EPUB signature result'))
          return
        }
        resolve(new Uint8Array(result))
      }
      reader.readAsArrayBuffer(source.slice(0, 2))
    })
  } else if (source instanceof Uint8Array) {
    bytes = source.subarray(0, 2)
  } else {
    bytes = new Uint8Array(source, 0, Math.min(source.byteLength, 2))
  }

  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

async function readPackageIndex(
  archive: JSZip
): Promise<EpubPackageIndex | null> {
  const containerXml = await readArchiveText(archive, 'META-INF/container.xml')
  if (!containerXml) return null

  const packagePath = getElements(
    parseXml(containerXml),
    'rootfile'
  )[0]?.getAttribute('full-path')
  if (!packagePath) return null

  const packageXml = await readArchiveText(archive, packagePath)
  if (!packageXml) return null

  const packageDocument = parseXml(packageXml)
  const manifestItems = new Map<string, EpubManifestItem>()
  const imageIdsByPath = new Map<string, string>()
  const xhtmlPaths: string[] = []
  for (const item of getElements(packageDocument, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    const mediaType = item.getAttribute('media-type') ?? ''
    const path = href ? resolveArchivePath(packagePath, href) : null
    if (!id || !path) continue

    const fileName = path.toLowerCase().split('/').at(-1)
    const manifestItem = {
      id,
      isNavigation:
        (item.getAttribute('properties') ?? '').split(/\s+/).includes('nav') ||
        mediaType.toLowerCase() === 'application/x-dtbncx+xml' ||
        fileName === 'toc.xhtml' ||
        fileName === 'toc.ncx',
      mediaType,
      path
    }
    manifestItems.set(id, manifestItem)
    if (mediaType === 'application/xhtml+xml') xhtmlPaths.push(path)
    if (mediaType.startsWith('image/')) imageIdsByPath.set(path, id)
  }

  const chapterPaths = getElements(packageDocument, 'itemref').flatMap(
    (itemReference) => {
      const id = itemReference.getAttribute('idref')
      const item = id ? manifestItems.get(id) : undefined
      return item &&
        item.mediaType === 'application/xhtml+xml' &&
        !item.isNavigation
        ? [item.path]
        : []
    }
  )
  return { chapterPaths, imageIdsByPath, packagePath, xhtmlPaths }
}

export async function getEpubImageMetadata(
  source: EpubBinaryInput,
  coverHref: string | null
): Promise<EpubImageMetadata | null> {
  if (!(await hasZipSignature(source))) return null

  const archive = await JSZip.loadAsync(source)
  const packageIndex = await readPackageIndex(archive)
  if (!packageIndex) return null

  const readImages = (path: string) =>
    readPageImages(archive, path, packageIndex.imageIdsByPath)
  const chapterImages = await Promise.all(
    packageIndex.chapterPaths.map(readImages)
  )
  const directCoverPath = coverHref ? resolveArchivePath('', coverHref) : null
  const relativeCoverPath = coverHref
    ? resolveArchivePath(packageIndex.packagePath, coverHref)
    : null
  const coverPath =
    (directCoverPath && archive.file(directCoverPath)
      ? directCoverPath
      : relativeCoverPath) ?? null
  const allPageImages = await Promise.all(
    packageIndex.xhtmlPaths.map(readImages)
  )

  return {
    altsByPage: chapterImages.map((images) => images.map((image) => image.alt)),
    imagePlacementsByPage: chapterImages.map((images) =>
      images.map(({ alt, textBefore }) => ({ alt, textBefore }))
    ),
    coverAlt: coverPath
      ? (allPageImages.flat().find((image) => image.path === coverPath)?.alt ??
        null)
      : null,
    coverInSpine: coverPath
      ? (chapterImages[0]?.some((image) => image.path === coverPath) ?? false)
      : false
  }
}
