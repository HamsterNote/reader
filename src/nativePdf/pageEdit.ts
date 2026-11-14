import type { ReaderData } from '../types/readerData'
import { groupHiddenPages, type HiddenPageGroup } from '../pdf/hiddenPages'

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export type NativePageEditUndo = Pick<ReaderData, 'hiddenPages' | 'edgeCrop'>

/** Replace only the existing readerData member of a snapshot data envelope. */
export function withNativePageEditData(
  snapshotData: unknown,
  readerData: ReaderData
): Record<string, unknown> {
  return { ...record(snapshotData), readerData }
}

/** Restore only fields owned by the page editor onto the newest ReaderData. */
export function restoreNativePageEditFields(
  current: ReaderData,
  undo: NativePageEditUndo
): ReaderData {
  const next: Record<string, unknown> = { ...current }
  if (undo.hiddenPages === undefined) delete next.hiddenPages
  else next.hiddenPages = [...undo.hiddenPages]
  if (undo.edgeCrop === undefined) delete next.edgeCrop
  else next.edgeCrop = undo.edgeCrop
  return next as ReaderData
}

export function nativePageEditGroups(
  hiddenPages: ReaderData['hiddenPages'],
  pageCount: number
): readonly HiddenPageGroup[] {
  return groupHiddenPages(
    hiddenPages,
    Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1)
  )
}
