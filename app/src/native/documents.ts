import * as Crypto from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'

import {
  createDocumentFileId,
  detectDocumentFormat
} from '../../../src/host/fileIdentity'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../../../src/host/readerDataStore'

const FILE_ROOT = `${FileSystem.documentDirectory ?? ''}reader-files/`
const JSON_MAX_BYTES = 10 * 1024 * 1024

export type PickedDocument = {
  readonly record: HostDocumentRecord
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

  const format = detectDocumentFormat(asset.name, asset.mimeType)
  if (!format) {
    throw new Error('仅支持 EPUB 与 PDF 文件')
  }
  const size = asset.size ?? 0
  // 使用选择器给出的原始修改时间；缓存副本的 mtime 每次复制都会变化，
  // 用它生成 ID 会导致重启后无法恢复同一文件的标注。
  const modifiedAt = asset.lastModified
  // 原生流式 MD5：同名同尺寸同时间但内容不同的两个文件必须得到不同 ID，
  // 否则会共用缓存副本与标注数据（读到先选的那份文件）。
  const contentInfo = await FileSystem.getInfoAsync(asset.uri, { md5: true })
  if (!contentInfo.exists || !contentInfo.md5) {
    throw new Error('无法读取所选文件内容')
  }
  const fileId = await createDocumentFileId(
    { fileName: asset.name, size, modifiedAt, contentDigest: contentInfo.md5 },
    digest
  )

  await ensureFileRoot()
  const extension: string = format
  const cachedUri = `${FILE_ROOT}${fileId}.${extension}`
  const cachedInfo = await FileSystem.getInfoAsync(cachedUri)
  if (!cachedInfo.exists) {
    await FileSystem.copyAsync({ from: asset.uri, to: cachedUri })
  }

  const existing = await store.get(fileId)
  const importedAt = existing?.importedAt ?? Date.now()
  const record: HostDocumentRecord = {
    fileId,
    fileName: asset.name,
    format,
    size,
    modifiedAt,
    cachedUri,
    importedAt,
    snapshot: existing?.snapshot ?? { data: null, progress: null, revision: 0 },
    ...(existing?.legacyImport ? { legacyImport: existing.legacyImport } : {})
  }
  await store.upsert(record)
  return { record }
}

/**
 * 选择旧读入器导出的高亮 JSON，导入到当前文件；不改变其他文件的数据。
 * 原 JSON 经过顶层结构校验后由 Web 层现有解析器在 restore 时处理。
 */
export async function pickLegacyJsonAndImport(
  store: ReaderDataStore,
  fileId: string
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
  return store.importLegacyJson(fileId, raw, asset.name, Date.now())
}

export async function removeDocument(
  store: ReaderDataStore,
  record: HostDocumentRecord
): Promise<void> {
  await store.remove(record.fileId)
  if (record.cachedUri.startsWith(FILE_ROOT)) {
    await FileSystem.deleteAsync(record.cachedUri, { idempotent: true })
  }
}
