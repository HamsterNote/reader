// 原生矩形工具的宿主侧适配：只做「原生事件 → 既有标注控制层 → V5 快照」的
// 转换，矩形 id/单位/去重与历史仍由 annotationController 决定，不在这里重建
// 业务规则。

import type { NativeAnnotationSnapshot } from './annotationController'
import type { NativePdfAnnotationCommit, PdfEvent, PdfRect } from './contracts'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../host/readerSnapshot'

export type NativeRectEvent = Extract<PdfEvent, { type: 'rect' }>

/** 小于该边长的拖动视为误触，不产生标注。 */
export const NATIVE_RECT_MIN_SIZE = 2

const finite = (value: number): boolean => Number.isFinite(value)

/** 校验原生下发的页内 px 矩形；无效时不写入业务数据。 */
export function validNativeRect(rect: PdfRect): boolean {
  return (
    finite(rect.x) &&
    finite(rect.y) &&
    finite(rect.width) &&
    finite(rect.height) &&
    rect.width >= NATIVE_RECT_MIN_SIZE &&
    rect.height >= NATIVE_RECT_MIN_SIZE
  )
}

/**
 * 原生矩形事件 → 既有控制层提交。
 * 只有 `commit` 且几何有效才产生提交；preview/cancel 由原生自己绘制。
 */
export function nativeRectCommit(
  event: NativeRectEvent,
  commitId: string
): NativePdfAnnotationCommit | null {
  if (event.phase !== 'commit') return null
  if (!Number.isInteger(event.pageNumber) || event.pageNumber < 1) return null
  if (!validNativeRect(event.rect)) return null
  return {
    commitId,
    intent: {
      type: 'rectangle',
      // One gesture is one rectangle; never reuse the geometry-revision id.
      rectId: `native-${commitId}`,
      pageNumber: event.pageNumber,
      rect: event.rect,
      phase: 'commit',
      geometryRevision: event.geometryRevision
    }
  }
}

/**
 * 把控制层快照写回既有 V5 宿主信封：`annotations` 是唯一权威容器，
 * readerData 的其它字段和未知扩展字段原样保留。
 */
export function readerSnapshotWithAnnotations(
  snapshotData: unknown,
  progressData: unknown,
  annotations: NativeAnnotationSnapshot
): Record<string, unknown> {
  const restored = restoreReaderSnapshot(snapshotData, progressData)
  return serializeReaderSnapshot({
    ...restored,
    data: {
      ...restored.data,
      ranges: [...annotations.ranges],
      rects: [...annotations.rects],
      pagePaintings: { ...annotations.pagePaintings }
    }
  })
}
