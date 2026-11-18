import type { HostDocumentRecord } from '../host/readerDataStore'
import { readerDataFromNativeSnapshot } from './hostProgress'

export function isLocalIosPdf(
  platform: string,
  record: HostDocumentRecord
): boolean {
  const local =
    record.cachedUri.startsWith('file://') ||
    !/^[a-z][a-z\d+.-]*:/i.test(record.cachedUri)
  return platform === 'ios' && record.format === 'pdf' && local
}

/** Only the Expo host's local iOS PDF Layout entry changes renderer. */
export function usesNativePdfLayout(
  platform: string,
  record: HostDocumentRecord
): boolean {
  const mode = readerDataFromNativeSnapshot(
    record.snapshot.data,
    record.snapshot.progress
  )?.renderMode
  return isLocalIosPdf(platform, record) && mode !== 'text'
}
