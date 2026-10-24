import { assertSafeFileId, type HostDocumentFormat } from './fileIdentity'

export function documentCachePath(
  fileId: string,
  format: HostDocumentFormat
): string {
  assertSafeFileId(fileId)
  if (format !== 'epub' && format !== 'pdf') throw new Error('非法文档格式')
  return `reader-files/${fileId}.${format}`
}

/** iOS can relocate the data container during an update; never reuse its old root. */
export function resolveDocumentCacheUri(
  documentDirectory: string | null,
  fileId: string,
  format: HostDocumentFormat
): string {
  if (!documentDirectory?.startsWith('file://'))
    throw new Error('应用文档目录不可用')
  return `${documentDirectory.replace(/\/?$/, '/')}${documentCachePath(fileId, format)}`
}
