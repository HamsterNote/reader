/**
 * 演示 App 的双栏宿主状态。默认单栏（left），开启分栏时另一栏镜像当前文档，
 * 这样同一 PDF 可以在两个 ReaderScreen 里同时打开；每个屏幕用稳定 paneId
 * 与各自的 isActivePane 隔离 session 和写权。
 */
import type { HostDocumentRecord } from '../../../src/host/readerDataStore'

export type PaneId = 'left' | 'right'

export type PaneRecords = Readonly<Record<PaneId, HostDocumentRecord | null>>

export const EMPTY_PANES: PaneRecords = { left: null, right: null }

export function otherPane(pane: PaneId): PaneId {
  return pane === 'left' ? 'right' : 'left'
}

export function setPaneRecord(
  state: PaneRecords,
  pane: PaneId,
  record: HostDocumentRecord
): PaneRecords {
  return { ...state, [pane]: record }
}

export function clearPaneRecord(state: PaneRecords, pane: PaneId): PaneRecords {
  return { ...state, [pane]: null }
}

/** 开启分栏时把当前栏的文档复制到空栏，便于同一 PDF 双栏对照。 */
export function mirrorActivePane(
  state: PaneRecords,
  pane: PaneId
): PaneRecords {
  const record = state[pane]
  if (!record || state[otherPane(pane)]) return state
  return { ...state, [otherPane(pane)]: record }
}

/** 焦点只能落在一个确实有文档的栏；否则保持原选择。 */
export function resolveActivePane(
  state: PaneRecords,
  preferred: PaneId
): PaneId {
  if (state[preferred]) return preferred
  const other = otherPane(preferred)
  return state[other] ? other : preferred
}

export function hasAnyPane(state: PaneRecords): boolean {
  return state.left !== null || state.right !== null
}

/** 删除文件后清掉两栏中指向它的记录。 */
export function withoutRecord(state: PaneRecords, fileId: string): PaneRecords {
  const keep = (record: HostDocumentRecord | null) =>
    record?.fileId === fileId ? null : record
  return { left: keep(state.left), right: keep(state.right) }
}

export function currentFileId(state: PaneRecords, pane: PaneId): string {
  return state[pane]?.fileId ?? ''
}
