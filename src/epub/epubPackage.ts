// HAM-88 任务 2.3：最小 EPUB 包读取。
// 只用 vendored zip.js 解开归档并解析 container/OPF，为兼容索引提供与旧
// 解析链路一致的 spine 顺序、导航项过滤、封面判定与章节原始 XHTML。
// 主展示由 foliate-js 负责；本模块不渲染、不改写内容。

import {
  BlobReader,
  TextWriter,
  ZipReader,
  configure
} from '../../vendor/foliate-js/vendor/zip.js'

/** zip.js Reader 鸭子类型实现：避免依赖 jsdom Blob 缺少的 arrayBuffer/text。 */
class Uint8ArrayZipSource {
  readonly size: number
  readonly #bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }
  readUint8Array(index: number, length: number): Promise<Uint8Array> {
    // zip.js 内部用 new DataView(array.buffer) 读取，忽略 byteOffset；
    // 必须返回零偏移的独立拷贝（Buffer/subarray 的 slice 可能是共享 buffer
    // 的视图），显式 new + set 最稳。
    const copy = new Uint8Array(length)
    copy.set(this.#bytes.subarray(index, index + length))
    return Promise.resolve(copy)
  }
  /**
   * entry.getData 按 readable 流式读取：复刻 zip.js Reader 基类的 readable
   * getter——流上会被 zip.js 赋予 offset/size/diskNumberStart，按这些元数据
   * 分块回读，不能简单全量输出。
   */
  get readable(): ReadableStream<Uint8Array> {
    const readChunk = (index: number, length: number) =>
      this.readUint8Array(index, length)
    const chunkSize = 65536
    type StreamState = { chunkOffset: number }
    type BoundedStream = ReadableStream<Uint8Array> & {
      offset?: number
      size?: number
    }
    const stream: BoundedStream = new ReadableStream<Uint8Array>({
      start(this: StreamState) {
        this.chunkOffset = 0
      },
      async pull(this: StreamState, controller) {
        const { offset = 0, size } = stream
        const chunkOffset = this.chunkOffset
        const length =
          size === undefined
            ? chunkSize
            : Math.min(chunkSize, size - chunkOffset)
        const chunk = await readChunk(offset + chunkOffset, length)
        controller.enqueue(chunk)
        if (
          (size !== undefined && chunkOffset + chunkSize > size) ||
          (size === undefined && chunk.length === 0 && length > 0)
        ) {
          controller.close()
        } else {
          this.chunkOffset += chunkSize
        }
      }
    })
    return stream
  }
}

/** zip.js Writer 鸭子类型实现：收集块并拼成完整字节。 */
class Uint8ArrayZipSink {
  readonly #chunks: Uint8Array[] = []
  readonly writable = new WritableStream<Uint8Array>({
    write: (chunk) => {
      this.#chunks.push(chunk)
    }
  })
  getData(): Promise<Uint8Array> {
    const size = this.#chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const output = new Uint8Array(size)
    let offset = 0
    for (const chunk of this.#chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return Promise.resolve(output)
  }
}

/** EPUB 包结构不合法时抛出；message 面向宿主错误提示。 */
export class EpubPackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpubPackageError'
  }
}

export type EpubManifestItem = {
  readonly id: string
  /** 相对归档根的路径（未 decode，与旧解析器一致）。 */
  readonly href: string
  readonly mediaType: string
  readonly properties: string
}

export type EpubSpineItem = {
  readonly idref: string
  readonly linear: string | null
}

export type EpubPackage = {
  readonly title: string | null
  readonly language: string | null
  /** OPF <meta name="cover" content="..."> 的 content（manifest item id）。 */
  readonly metadataCoverId: string | null
  readonly guideCoverHref: string | null
  readonly manifest: ReadonlyMap<string, EpubManifestItem>
  /** 完整 spine（含 linear="no"），与旧解析器 flow 一致。 */
  readonly spine: readonly EpubSpineItem[]
  /** spine 顺序、剔除导航项后的章节列表 = 旧逻辑页序。 */
  readonly chapters: readonly EpubManifestItem[]
  /** findCoverId 移植：metadata cover → guide cover → id/href/properties 扫描。 */
  readonly coverItem: EpubManifestItem | null
  readonly readText: (path: string) => Promise<string | null>
  readonly readBytes: (path: string) => Promise<Uint8Array | null>
  readonly destroy: () => Promise<void>
}

/** 与旧解析器 resolveArchivePath 一致：处理 . / .. 与前导 /，不做 decode。 */
export const resolveArchivePath = (
  baseFile: string,
  pathReference: string
): string => {
  const pathWithoutQuery = pathReference.split('?')[0]
  if (!pathWithoutQuery) return baseFile
  if (pathWithoutQuery.startsWith('/')) return pathWithoutQuery.slice(1)
  const parts = [
    ...baseFile.split('/').slice(0, -1),
    ...pathWithoutQuery.split('/')
  ]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return normalized.join('/')
}

const getElements = (document: Document, localName: string): Element[] =>
  Array.from(document.getElementsByTagNameNS('*', localName))

const parseXml = (xml: string): Document =>
  new DOMParser().parseFromString(xml, 'application/xml')

/** 与旧解析器 isNavigationManifestItem 相同的导航项判定。 */
export const isNavigationManifestItem = (item: {
  href: string
  'media-type'?: string
  mediaType?: string
  properties?: string
}): boolean => {
  const fileName = item.href.split('#')[0].toLowerCase().split('/').pop()
  const mediaType = String(
    item['media-type'] ?? item.mediaType ?? ''
  ).toLowerCase()
  return (
    String(item.properties ?? '')
      .toLowerCase()
      .split(/\s+/)
      .includes('nav') ||
    mediaType === 'application/x-dtbncx+xml' ||
    fileName === 'toc.xhtml' ||
    fileName === 'toc.ncx'
  )
}

const isImageManifestItem = (item: EpubManifestItem): boolean =>
  item.mediaType.toLowerCase().startsWith('image/')

/** findCoverId 移植：返回 manifest item id。 */
const findCoverItemId = (
  metadataCoverId: string | null,
  guideCoverHref: string | null,
  manifest: ReadonlyMap<string, EpubManifestItem>
): string | null => {
  if (metadataCoverId) {
    const item = manifest.get(metadataCoverId)
    if (item && isImageManifestItem(item)) return item.id
  }
  if (guideCoverHref) {
    const hrefWithoutAnchor = guideCoverHref.split('#')[0]
    for (const item of manifest.values()) {
      if (
        item.href.split('#')[0] === hrefWithoutAnchor &&
        isImageManifestItem(item)
      ) {
        return item.id
      }
    }
  }
  for (const item of manifest.values()) {
    const searchable =
      `${item.id} ${item.href} ${item.properties}`.toLowerCase()
    if (
      isImageManifestItem(item) &&
      (searchable.includes('cover-image') || searchable.includes('cover'))
    ) {
      return item.id
    }
  }
  return null
}

export const openEpubPackage = async (
  source: Uint8Array | Blob
): Promise<EpubPackage> => {
  configure({ useWebWorkers: false })
  const reader = new ZipReader(
    source instanceof Blob
      ? new BlobReader(source)
      : new Uint8ArrayZipSource(source)
  )
  let entries
  try {
    entries = await reader.getEntries()
  } catch (error) {
    await reader.close().catch(() => undefined)
    const reason = error instanceof Error ? error.message : String(error)
    throw new EpubPackageError(`Invalid EPUB archive: ${reason}`)
  }
  const entryByName = new Map(entries.map((entry) => [entry.filename, entry]))

  const readText = async (path: string): Promise<string | null> => {
    const entry = entryByName.get(path)
    return entry ? entry.getData(new TextWriter()) : null
  }
  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    const entry = entryByName.get(path)
    return entry ? entry.getData(new Uint8ArrayZipSink()) : null
  }

  const mimeFile = await readText('mimetype')
  if (mimeFile === null) {
    await reader.close().catch(() => undefined)
    throw new EpubPackageError('No mimetype file in archive')
  }
  if (mimeFile.toLowerCase().trim() !== 'application/epub+zip') {
    await reader.close().catch(() => undefined)
    throw new EpubPackageError('Unsupported mime type')
  }

  const containerXml = await readText('META-INF/container.xml')
  if (containerXml === null) {
    await reader.close().catch(() => undefined)
    throw new EpubPackageError('No container file in archive')
  }
  const packagePath = getElements(
    parseXml(containerXml),
    'rootfile'
  )[0]?.getAttribute('full-path')
  if (!packagePath) {
    await reader.close().catch(() => undefined)
    throw new EpubPackageError('Rootfile not found from archive')
  }
  const packageXml = await readText(packagePath)
  if (packageXml === null) {
    await reader.close().catch(() => undefined)
    throw new EpubPackageError('Package document not found in archive')
  }

  const packageDocument = parseXml(packageXml)
  const packageDirectory = packagePath.split('/').slice(0, -1).join('/')
  const resolvePackagePath = (href: string) =>
    resolveArchivePath(
      packageDirectory ? `${packageDirectory}/package.opf` : 'package.opf',
      href
    )

  const manifest = new Map<string, EpubManifestItem>()
  for (const item of getElements(packageDocument, 'item')) {
    const id = item.getAttribute('id')
    const rawHref = item.getAttribute('href')
    if (!id || !rawHref) continue
    manifest.set(id, {
      id,
      href: resolvePackagePath(rawHref),
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? ''
    })
  }

  const metadataCoverId = getElements(packageDocument, 'meta')
    .find((meta) => meta.getAttribute('name') === 'cover')
    ?.getAttribute('content')
    ?.trim()
  const guideCoverHref =
    getElements(packageDocument, 'reference')
      .find(
        (reference) => reference.getAttribute('type')?.toLowerCase() === 'cover'
      )
      ?.getAttribute('href') ?? null

  const spine: EpubSpineItem[] = getElements(packageDocument, 'itemref').map(
    (itemref) => ({
      idref: itemref.getAttribute('idref') ?? '',
      linear: itemref.getAttribute('linear')
    })
  )
  // 与旧解析器一致：spine 顺序展开，缺失的 manifest 项直接丢弃。
  const flow = spine.flatMap((spineItem) => {
    const item = manifest.get(spineItem.idref)
    return item ? [item] : []
  })
  const chapters = flow.filter((item) => !isNavigationManifestItem(item))

  const title = getElements(packageDocument, 'title')[0]?.textContent?.trim()
  const language = getElements(
    packageDocument,
    'language'
  )[0]?.textContent?.trim()

  const coverItemId = findCoverItemId(
    metadataCoverId ?? null,
    guideCoverHref ? resolvePackagePath(guideCoverHref) : null,
    manifest
  )

  return {
    title: title || null,
    language: language || null,
    metadataCoverId: metadataCoverId || null,
    guideCoverHref,
    manifest,
    spine,
    chapters,
    coverItem: coverItemId ? (manifest.get(coverItemId) ?? null) : null,
    readText,
    readBytes,
    destroy: () => reader.close()
  }
}
