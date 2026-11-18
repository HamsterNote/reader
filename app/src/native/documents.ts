import * as Crypto from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { removeStagedDocument } from './webAssets'
import {
  documentCachePath,
  resolveDocumentCacheUri
} from '../../../src/host/documentCachePath'

import {
  createDocumentFileId,
  detectDocumentFormat
} from '../../../src/host/fileIdentity'
import type {
  HostDocumentRecord,
  ReaderDataStore,
  ReaderWriteFence
} from '../../../src/host/readerDataStore'

const FILE_ROOT = `${FileSystem.documentDirectory ?? ''}reader-files/`
const JSON_MAX_BYTES = 10 * 1024 * 1024

export type PickedDocument = {
  readonly record: HostDocumentRecord
}

type DocumentAsset = {
  readonly uri: string
  readonly fileName: string
  readonly size: number
  readonly modifiedAt: number
  readonly mimeType?: string | null
}

async function ensureFileRoot(): Promise<void> {
  const info = await FileSystem.getInfoAsync(FILE_ROOT)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(FILE_ROOT, { intermediates: true })
  }
}

async function digest(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value)
}

/**
 * 把外部文件复制进应用缓存并建立/复用记录；选择器与调试入口共用，
 * 保证两者对同一文件算出同一个 fileId。
 */
async function registerDocumentAsset(
  store: ReaderDataStore,
  asset: DocumentAsset
): Promise<HostDocumentRecord> {
  const format = detectDocumentFormat(asset.fileName, asset.mimeType)
  if (!format) {
    throw new Error('仅支持 EPUB 与 PDF 文件')
  }
  // 原生流式 MD5：同名同尺寸同时间但内容不同的两个文件必须得到不同 ID，
  // 否则会共用缓存副本与标注数据（读到先选的那份文件）。
  const contentInfo = await FileSystem.getInfoAsync(asset.uri, { md5: true })
  if (!contentInfo.exists || !contentInfo.md5) {
    throw new Error('无法读取所选文件内容')
  }
  const fileId = await createDocumentFileId(
    {
      fileName: asset.fileName,
      size: asset.size,
      modifiedAt: asset.modifiedAt,
      contentDigest: contentInfo.md5
    },
    digest
  )

  await ensureFileRoot()
  const cachedUri = resolveDocumentCacheUri(
    FileSystem.documentDirectory,
    fileId,
    format
  )
  const cachedInfo = await FileSystem.getInfoAsync(cachedUri)
  if (!cachedInfo.exists) {
    await FileSystem.copyAsync({ from: asset.uri, to: cachedUri })
  }

  const existing = await store.get(fileId)
  // 新快照键损坏：不重建、不 upsert，避免把错误状态洗成旧快照后放行编辑。
  if (existing?.snapshotError !== undefined) {
    throw new Error(
      `该文件的标注数据已损坏，已保留原数据：${existing.snapshotError}`
    )
  }
  const importedAt = existing?.importedAt ?? Date.now()
  const record: HostDocumentRecord = {
    fileId,
    fileName: asset.fileName,
    format,
    size: asset.size,
    modifiedAt: asset.modifiedAt,
    cachedUri: documentCachePath(fileId, format),
    importedAt,
    snapshot: existing?.snapshot ?? { data: null, progress: null, revision: 0 },
    ...(existing?.legacyImport ? { legacyImport: existing.legacyImport } : {})
  }
  await store.upsert(record)
  // 返回权威记录（含 snapshotSource/snapshotError），而不是手工拼的对象。
  const persisted = await store.get(fileId)
  return persisted ?? record
}

/**
 * 选择 EPUB/PDF，复制到应用受控缓存，并按稳定 fileId 建立/复用记录。
 * 同一文件再次打开时保留既有快照，不因重新选择而清空标注。
 */
export async function pickAndCacheDocument(
  store: ReaderDataStore
): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false
  })
  if (result.canceled) return null
  const asset = result.assets[0]
  if (!asset) return null
  return {
    record: await registerDocumentAsset(store, {
      uri: asset.uri,
      fileName: asset.name,
      size: asset.size ?? 0,
      // 使用选择器给出的原始修改时间；缓存副本的 mtime 每次复制都会变化，
      // 用它生成 ID 会导致重启后无法恢复同一文件的标注。
      modifiedAt: asset.lastModified,
      mimeType: asset.mimeType
    })
  }
}

function toFileUri(pathOrUri: string): string {
  const value = pathOrUri.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value
  if (!value.startsWith('/')) {
    throw new Error(`调试入口需要绝对路径：${pathOrUri}`)
  }
  return `file://${value}`
}

function fileNameFromUri(uri: string): string {
  const name = uri.split('/').pop() ?? ''
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/**
 * expo-file-system 的 modificationTime 以秒返回，选择器给的是毫秒；
 * 统一到毫秒，避免同一文件经调试入口与选择器得到不同 fileId。
 */
function modifiedAtMillis(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return value < 1e11 ? value * 1000 : value
}

/**
 * 调试入口：不经系统选择器，直接按绝对路径 / file:// URI 导入设备上的文件。
 * 仅由 __DEV__ 的深链接与环境变量调用，release 不暴露。
 */
export async function importDocumentFromPath(
  store: ReaderDataStore,
  pathOrUri: string
): Promise<HostDocumentRecord> {
  const uri = toFileUri(pathOrUri)
  const info = await FileSystem.getInfoAsync(uri)
  if (!info.exists) {
    throw new Error(`调试入口指定的文件不存在：${pathOrUri}`)
  }
  if (info.isDirectory) {
    throw new Error(`调试入口需要文件而不是目录：${pathOrUri}`)
  }
  return registerDocumentAsset(store, {
    uri,
    fileName: fileNameFromUri(uri),
    size: info.size ?? 0,
    modifiedAt: modifiedAtMillis(info.modificationTime),
    mimeType: null
  })
}

/**
 * 选择旧读入器导出的高亮 JSON，导入到当前文件；不改变其他文件的数据。
 * 原 JSON 经过顶层结构校验后由 Web 层现有解析器在 restore 时处理。
 */
export async function pickLegacyJsonAndImport(
  store: ReaderDataStore,
  fileId: string,
  fence?: ReaderWriteFence
): Promise<HostDocumentRecord | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false
  })
  if (result.canceled) return null
  const asset = result.assets[0]
  if (!asset) return null
  if (asset.size !== undefined && asset.size > JSON_MAX_BYTES) {
    throw new Error('旧数据 JSON 超过 10 MiB 上限')
  }
  const raw = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8
  })
  return store.importLegacyJson(fileId, raw, asset.name, Date.now(), fence)
}

export async function removeDocument(
  store: ReaderDataStore,
  record: HostDocumentRecord
): Promise<void> {
  await store.remove(record.fileId)
  await removeStagedDocument(record.fileId)
  await FileSystem.deleteAsync(
    resolveDocumentCacheUri(
      FileSystem.documentDirectory,
      record.fileId,
      record.format
    ),
    { idempotent: true }
  )
}
