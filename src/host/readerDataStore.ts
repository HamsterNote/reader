// 宿主的文件级阅读数据存储。每个文档一条独立记录，键由受校验的 fileId
// 生成，文件之间互不影响；索引损坏时退化为空列表，而不是清空单文件记录。
// 纯 TypeScript，原生层注入基于 expo-file-system 的 HostStorage。

import type { BridgeHostSnapshot } from '../bridge/hostSession'
import { assertSafeFileId, type HostDocumentFormat } from './fileIdentity'

export type HostStorage = {
  readonly read: (key: string) => Promise<string | null>
  readonly write: (key: string, value: string) => Promise<void>
  readonly remove: (key: string) => Promise<void>
}

export type LegacyHighlightsImport = {
  readonly importedAt: number
  readonly sourceFileName: string
  readonly version: number
}

export type HostDocumentRecord = {
  readonly fileId: string
  readonly fileName: string
  readonly format: HostDocumentFormat
  readonly size: number
  readonly modifiedAt: number
  /** 应用文档目录内的相对缓存路径；旧记录可能保存已失效的绝对 URI。 */
  readonly cachedUri: string
  readonly importedAt: number
  readonly snapshot: BridgeHostSnapshot
  readonly legacyImport?: LegacyHighlightsImport
}

export type HostDocumentSummary = Omit<HostDocumentRecord, 'snapshot'>

const INDEX_KEY = 'reader.host.v1.index'
const DOCUMENT_KEY_PREFIX = 'reader.host.v1.doc.'
const LEGACY_JSON_MAX_BYTES = 10 * 1024 * 1024

function documentKey(fileId: string): string {
  return `${DOCUMENT_KEY_PREFIX}${assertSafeFileId(fileId)}`
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStoredSnapshot(value: unknown): BridgeHostSnapshot | null {
  if (!isPlainRecord(value)) return null
  const revision = value['revision']
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
    return null
  }
  return {
    data: value['data'] ?? null,
    progress: value['progress'] ?? null,
    revision
  }
}

function parseLegacyImport(value: unknown): LegacyHighlightsImport | undefined {
  if (!isPlainRecord(value)) return undefined
  const version = value['version']
  const sourceFileName = value['sourceFileName']
  const importedAt = value['importedAt']
  if (
    typeof version !== 'number' ||
    typeof sourceFileName !== 'string' ||
    typeof importedAt !== 'number'
  ) {
    return undefined
  }
  return { importedAt, sourceFileName, version }
}

function parseStoredRecord(value: unknown): HostDocumentRecord | null {
  if (!isPlainRecord(value)) return null
  const { fileId, fileName, format, size, modifiedAt } = value
  const cachedUri = value['cachedUri']
  const importedAt = value['importedAt']
  const snapshot = parseStoredSnapshot(value['snapshot'])
  if (
    typeof fileId !== 'string' ||
    typeof fileName !== 'string' ||
    (format !== 'epub' && format !== 'pdf') ||
    typeof size !== 'number' ||
    typeof modifiedAt !== 'number' ||
    typeof cachedUri !== 'string' ||
    typeof importedAt !== 'number' ||
    snapshot === null
  ) {
    return null
  }
  const legacyImport = parseLegacyImport(value['legacyImport'])
  return {
    fileId,
    fileName,
    format,
    size,
    modifiedAt,
    cachedUri,
    importedAt,
    snapshot,
    ...(legacyImport === undefined ? {} : { legacyImport })
  }
}

/**
 * 校验旧读入器导出的高亮 JSON（v2/v3/v4）。只做顶层形状校验，
 * 逐条字段校验沿用 Web 层现有 parseHighlights，导入内容原样保留。
 */
export function parseLegacyHighlightsJson(raw: string): {
  readonly version: number
  readonly value: Record<string, unknown>
} {
  if (raw.length > LEGACY_JSON_MAX_BYTES) {
    throw new Error('旧数据 JSON 超过 10 MiB 上限')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('旧数据不是合法 JSON')
  }
  if (!isPlainRecord(parsed)) {
    throw new Error('旧数据必须是 JSON 对象')
  }
  const version = parsed['version']
  if (version !== 2 && version !== 3 && version !== 4) {
    throw new Error('仅支持 v2/v3/v4 高亮 JSON')
  }
  if (!Array.isArray(parsed['ranges'])) {
    throw new Error('旧数据缺少 ranges 数组')
  }
  if (version >= 3 && !Array.isArray(parsed['rects'])) {
    throw new Error(`v${version} 旧数据缺少 rects 数组`)
  }
  if (version === 4 && !isPlainRecord(parsed['paintings'])) {
    throw new Error('v4 旧数据缺少 paintings 对象')
  }
  return { version, value: parsed }
}

export class ReaderDataStore {
  private readonly cache = new Map<string, HostDocumentRecord>()
  private indexLoaded = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: HostStorage) {}

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async loadRecordEntry(entry: unknown): Promise<void> {
    if (typeof entry !== 'string') return
    const recordRaw = await this.storage.read(documentKey(entry))
    if (recordRaw === null) return
    const record = parseStoredRecord(safeParse(recordRaw))
    if (record !== null) this.cache.set(record.fileId, record)
  }

  private async loadIndexEntries(raw: string): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      for (const entry of parsed) await this.loadRecordEntry(entry)
    } catch {
      // 索引损坏：保持空列表；单文件记录仍在各自键下。
    }
  }

  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return
    const raw = await this.storage.read(INDEX_KEY)
    this.cache.clear()
    if (raw !== null) await this.loadIndexEntries(raw)
    this.indexLoaded = true
  }

  private async persistIndex(): Promise<void> {
    await this.storage.write(
      INDEX_KEY,
      JSON.stringify([...this.cache.keys()].sort())
    )
  }

  list(): Promise<HostDocumentSummary[]> {
    return this.runExclusive(async () => {
      await this.loadIndex()
      return [...this.cache.values()]
        .sort((left, right) => right.importedAt - left.importedAt)
        .map(({ snapshot: _snapshot, ...summary }) => summary)
    })
  }

  get(fileId: string): Promise<HostDocumentRecord | null> {
    return this.runExclusive(async () => {
      assertSafeFileId(fileId)
      await this.loadIndex()
      return this.cache.get(fileId) ?? null
    })
  }

  upsert(record: HostDocumentRecord): Promise<void> {
    return this.runExclusive(async () => {
      assertSafeFileId(record.fileId)
      await this.loadIndex()
      await this.storage.write(
        documentKey(record.fileId),
        JSON.stringify(record)
      )
      this.cache.set(record.fileId, record)
      await this.persistIndex()
    })
  }

  saveSnapshot(fileId: string, snapshot: BridgeHostSnapshot): Promise<void> {
    return this.runExclusive(async () => {
      assertSafeFileId(fileId)
      await this.loadIndex()
      const record = this.cache.get(fileId)
      if (!record) {
        throw new Error(`文档不存在：${fileId}`)
      }
      const next = { ...record, snapshot }
      await this.storage.write(documentKey(fileId), JSON.stringify(next))
      this.cache.set(fileId, next)
    })
  }

  importLegacyJson(
    fileId: string,
    raw: string,
    sourceFileName: string,
    importedAt: number
  ): Promise<HostDocumentRecord> {
    return this.runExclusive(async () => {
      assertSafeFileId(fileId)
      await this.loadIndex()
      const record = this.cache.get(fileId)
      if (!record) {
        throw new Error(`文档不存在：${fileId}`)
      }
      const { version, value } = parseLegacyHighlightsJson(raw)
      const next: HostDocumentRecord = {
        ...record,
        snapshot: {
          data: { highlights: value },
          progress: null,
          revision: 0
        },
        legacyImport: { importedAt, sourceFileName, version }
      }
      await this.storage.write(documentKey(fileId), JSON.stringify(next))
      this.cache.set(fileId, next)
      return next
    })
  }

  remove(fileId: string): Promise<void> {
    return this.runExclusive(async () => {
      assertSafeFileId(fileId)
      await this.loadIndex()
      await this.storage.remove(documentKey(fileId))
      this.cache.delete(fileId)
      await this.persistIndex()
    })
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
