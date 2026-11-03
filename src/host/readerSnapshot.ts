import type { ReaderData } from '../types/readerData'
import type { ReaderComment } from '../types/comments'
import {
  isPaintingDocument,
  migrateLegacyContainer,
  toAnnotations,
  type ReaderAnnotations
} from '../storage/annotationStore'
import { parseAnnotationStorageV5 } from '../storage/highlightStorage'
import { parseComments, serializeComments } from '../storage/commentStorage'

export type ReaderSnapshot = {
  readonly data: ReaderData
  readonly comments: readonly ReaderComment[]
  readonly extra: Readonly<Record<string, unknown>>
}

const EMPTY_ANNOTATIONS: ReaderAnnotations = {
  version: 5,
  ranges: [],
  rects: [],
  paintings: {}
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * 读取宿主快照信封。
 *
 * `annotations` 是唯一的新格式入口（V5 容器，文档由画库校验）；旧宿主快照里的
 * `highlights`（v2/v3/v4）只在读入时一次性迁移成 V5，之后不再回写。损坏或版本
 * 不支持时抛错，由调用方显式展示，不静默退化成空数据。
 */
export function restoreReaderSnapshot(
  value: unknown,
  progress?: unknown
): ReaderSnapshot {
  const envelope = record(value)
  const annotations = restoreAnnotations(envelope)
  const data = {
    ...record(progress),
    ...record(envelope['readerData'])
  } as ReaderData
  return {
    data: {
      ...data,
      ranges: Array.from(annotations.ranges),
      rects: Array.from(annotations.rects),
      pagePaintings: { ...annotations.paintings }
    },
    comments: parseComments(
      envelope['comments'] ? JSON.stringify(envelope['comments']) : null
    ),
    extra: envelope
  }
}

function restoreAnnotations(
  envelope: Record<string, unknown>
): ReaderAnnotations {
  const annotations = envelope['annotations']
  if (annotations !== undefined) {
    const parsed = parseAnnotationStorageV5(JSON.stringify(annotations), {
      validateDocument: isPaintingDocument
    })
    if (parsed.status !== 'ok') {
      throw new Error(
        `标注恢复失败：${
          parsed.status === 'invalid' ? parsed.reason : 'missing'
        }`
      )
    }
    return toAnnotations(parsed.storage)
  }
  // 旧宿主快照：绘图原值交给画库一次性迁移（含未渲染页）。
  if (envelope['highlights'] !== undefined)
    return migrateLegacyContainer(envelope['highlights'])
  return EMPTY_ANNOTATIONS
}

/**
 * 生产新快照信封：只写 `annotations`，不再生成 v4 `highlights`。
 * 从旧快照带过来的 `highlights` 键在写回时被显式丢弃，避免双写。
 */
export function serializeReaderSnapshot(
  snapshot: ReaderSnapshot
): Record<string, unknown> {
  const {
    ranges = [],
    rects = [],
    pagePaintings = {},
    ...readerData
  } = snapshot.data
  const extra: Record<string, unknown> = { ...snapshot.extra }
  // 单一格式：旧 v4 容器与旧容器键都不再写回，避免双写。
  delete extra['highlights']
  delete extra['annotations']
  return {
    ...extra,
    annotations: {
      version: 5,
      ranges: Array.from(ranges),
      rects: Array.from(rects),
      paintings: pagePaintings
    },
    comments: JSON.parse(serializeComments(snapshot.comments)),
    readerData
  }
}
