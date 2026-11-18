/**
 * 调试入口的目标解析：fileId 直接取书库记录，path 先导入再返回权威记录。
 * 失败时返回原因而不是静默回退到书库，方便设备取证看到明确结论。
 */
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../../../src/host/readerDataStore'
import { importDocumentFromPath } from '../native/documents'
import type { DebugTarget } from './route'

export type DebugOpenOutcome =
  | { readonly status: 'opened'; readonly record: HostDocumentRecord }
  | { readonly status: 'failed'; readonly reason: string }

export async function resolveDebugTarget(
  store: ReaderDataStore,
  target: DebugTarget
): Promise<DebugOpenOutcome> {
  try {
    if (target.kind === 'fileId') {
      const record = await store.get(target.value)
      return record
        ? { status: 'opened', record }
        : {
            status: 'failed',
            reason: `书库中没有 fileId=${target.value} 的记录`
          }
    }
    return {
      status: 'opened',
      record: await importDocumentFromPath(store, target.value)
    }
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}
