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
  /** 读取时标注：快照来自新键（v2）、旧记录（legacy）或新键损坏（corrupt）。不落盘。 */
  readonly snapshotSource?: 'v2' | 'legacy' | 'corrupt'
  /**
   * 新键存在但不可用时的说明；此时 `snapshot` 仍是旧记录的值，
   * 且该文件的保存入口必须拒绝写入（保留原件，不自动降级）。
   */
  readonly snapshotError?: string
}

export type HostDocumentSummary = Omit<
  HostDocumentRecord,
  'snapshot' | 'snapshotSource' | 'snapshotError'
>

const INDEX_KEY = 'reader.host.v1.index'
const DOCUMENT_KEY_PREFIX = 'reader.host.v1.doc.'
/** v2 新权威快照键：值为完整 BridgeHostSnapshot，旧记录只读冻结。 */
const SNAPSHOT_KEY_PREFIX = 'reader.host.v2.snapshot.'
/** 提交中副本：写入成功并回读校验后才替换目标键。 */
const SNAPSHOT_PENDING_SUFFIX = '.pending'
const LEGACY_JSON_MAX_BYTES = 10 * 1024 * 1024

type StoredSnapshotRead =
  | { readonly status: 'ok'; readonly snapshot: BridgeHostSnapshot }
  | { readonly status: 'missing' }
  | { readonly status: 'corrupt'; readonly reason: string }

function documentKey(fileId: string): string {
  return `${DOCUMENT_KEY_PREFIX}${assertSafeFileId(fileId)}`
}

function snapshotKey(fileId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${assertSafeFileId(fileId)}`
}

function pendingSnapshotKey(fileId: string): string {
  return `${snapshotKey(fileId)}${SNAPSHOT_PENDING_SUFFIX}`
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

  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.storage.remove(key)
    } catch {
      // 清理失败不影响已提交状态：读取优先完整目标键，残留副本下次写入再清。
    }
  }

  /**
   * 读取新键：完整目标 > 可恢复的提交副本 > 缺失。
   *
   * 目标键不完整（中断/半写）时用完整副本补全；副本也不完整则丢弃并回退到
   * 旧记录，绝不把半写 JSON 当成有效数据，也不把新键损坏误判为“缺失”。
   */
  private async readStoredSnapshot(
    fileId: string
  ): Promise<StoredSnapshotRead> {
    const key = snapshotKey(fileId)
    const pendingKey = pendingSnapshotKey(fileId)
    const raw = await this.storage.read(key)

    if (raw !== null) {
      const snapshot = parseSnapshotText(raw)
      if (snapshot !== null) {
        await this.removeQuietly(pendingKey)
        return { status: 'ok', snapshot }
      }
      const recovered = await this.recoverPending(fileId, pendingKey)
      if (recovered !== null) return { status: 'ok', snapshot: recovered }
      return { status: 'corrupt', reason: '新快照 JSON 损坏且无可恢复副本' }
    }

    const recovered = await this.recoverPending(fileId, pendingKey)
    if (recovered !== null) return { status: 'ok', snapshot: recovered }
    return { status: 'missing' }
  }

  private async recoverPending(
    fileId: string,
    pendingKey: string
  ): Promise<BridgeHostSnapshot | null> {
    const pending = await this.storage.read(pendingKey)
    if (pending === null) return null
    const snapshot = parseSnapshotText(pending)
    if (snapshot === null) {
      await this.removeQuietly(pendingKey)
      return null
    }
    // 副本已完整落盘、目标缺失或不完整：补全目标后清理副本。
    await this.storage.write(snapshotKey(fileId), pending)
    await this.removeQuietly(pendingKey)
    return snapshot
  }

  /**
   * 完整替换新键：先写副本并回读校验，再写目标键。任何一步失败都恢复为
   * “只能看到完整旧状态”，不会留下可被读成有效数据的半写 JSON。
   */
  private async commitSnapshot(
    fileId: string,
    snapshot: BridgeHostSnapshot
  ): Promise<void> {
    const key = snapshotKey(fileId)
    const pendingKey = pendingSnapshotKey(fileId)
    const value = JSON.stringify(snapshot)

    await this.storage.write(pendingKey, value)
    const echo = await this.storage.read(pendingKey)
    if (echo !== value) {
      await this.removeQuietly(pendingKey)
      throw new Error('快照写入校验失败，已保留上一次完整数据')
    }

    try {
      await this.storage.write(key, value)
    } catch (error) {
      await this.removeQuietly(pendingKey)
      throw error
    }
    await this.removeQuietly(pendingKey)
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
      const record = this.cache.get(fileId)
      if (!record) return null

      const stored = await this.readStoredSnapshot(fileId)
      if (stored.status === 'ok') {
        return { ...record, snapshot: stored.snapshot, snapshotSource: 'v2' }
      }
      if (stored.status === 'corrupt') {
        // 新键损坏：保留旧记录值供展示/删除，但标记错误，禁止任何保存覆盖。
        return {
          ...record,
          snapshotSource: 'corrupt',
          snapshotError: stored.reason
        }
      }
      return { ...record, snapshotSource: 'legacy' }
    })
  }

  upsert(record: HostDocumentRecord): Promise<void> {
    return this.runExclusive(async () => {
      assertSafeFileId(record.fileId)
      await this.loadIndex()
      // v1 记录的 snapshot 是旧格式原件：已有记录沿用磁盘值；新记录用调用方给
      // 的初始快照。v2 快照绝不投影回旧记录，旧 blob 因此保持逐字节不变。
      const legacySnapshot =
        this.cache.get(record.fileId)?.snapshot ?? record.snapshot
      const persisted = toLegacyRecord(record, legacySnapshot)
      await this.storage.write(
        documentKey(record.fileId),
        JSON.stringify(persisted)
      )
      this.cache.set(record.fileId, persisted)
      await this.persistIndex()
    })
  }

  saveSnapshot(fileId: string, snapshot: BridgeHostSnapshot): Promise<void> {
    return this.runExclusive(async () => {
      assertSafeFileId(fileId)
      await this.loadIndex()
      if (!this.cache.has(fileId)) {
        throw new Error(`文档不存在：${fileId}`)
      }
      const stored = await this.readStoredSnapshot(fileId)
      if (stored.status === 'corrupt') {
        throw new Error(
          `该文件的标注数据已损坏，已保留原数据：${stored.reason}`
        )
      }
      await this.commitSnapshot(fileId, snapshot)
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
      const stored = await this.readStoredSnapshot(fileId)
      if (stored.status === 'ok') {
        throw new Error('该文档已使用新格式存储，不能再用旧数据覆盖')
      }
      if (stored.status === 'corrupt') {
        throw new Error(
          `该文件的标注数据已损坏，已保留原数据：${stored.reason}`
        )
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
      const persisted = toLegacyRecord(next, next.snapshot)
      await this.storage.write(documentKey(fileId), JSON.stringify(persisted))
      this.cache.set(fileId, persisted)
      return persisted
    })
  }

  remove(fileId: string): Promise<void> {
    return this.runExclusive(async () => {
      assertSafeFileId(fileId)
      await this.loadIndex()
      await this.storage.remove(documentKey(fileId))
      await this.storage.remove(snapshotKey(fileId))
      await this.removeQuietly(pendingSnapshotKey(fileId))
      this.cache.delete(fileId)
      await this.persistIndex()
    })
  }
}

/** 构造要落盘的 v1 记录：快照字段固定为旧原件，计算型字段不落盘。 */
function toLegacyRecord(
  record: HostDocumentRecord,
  legacySnapshot: BridgeHostSnapshot
): HostDocumentRecord {
  return {
    fileId: record.fileId,
    fileName: record.fileName,
    format: record.format,
    size: record.size,
    modifiedAt: record.modifiedAt,
    cachedUri: record.cachedUri,
    importedAt: record.importedAt,
    snapshot: legacySnapshot,
    ...(record.legacyImport === undefined
      ? {}
      : { legacyImport: record.legacyImport })
  }
}

function parseSnapshotText(raw: string): BridgeHostSnapshot | null {
  return parseStoredSnapshot(safeParse(raw))
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
