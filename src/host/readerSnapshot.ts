import type { ReaderData } from '../types/readerData'
import type { ReaderComment } from '../types/comments'
import {
  parseHighlights,
  serializeHighlights
} from '../storage/highlightStorage'
import { parseComments, serializeComments } from '../storage/commentStorage'

export type ReaderSnapshot = {
  readonly data: ReaderData
  readonly comments: readonly ReaderComment[]
  readonly extra: Readonly<Record<string, unknown>>
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * 读取宿主快照信封（旧格式解析沿用 Web demo 的读入器）。
 *
 * v2 快照键里的 `data` 由 WebView 生产。新格式把绘图放进 `data.annotations`
 * （V5 容器）；reader 当前仍按 `highlights` 读取 v4 数据，`annotations` 与其余
 * 未知扩展字段都经 `extra` 原样透传，不解析、不裁剪、不重建，避免在 2.4/3.1
 * 切换生产端之前丢字段。
 */
export function restoreReaderSnapshot(
  value: unknown,
  progress?: unknown
): ReaderSnapshot {
  const envelope = record(value)
  const highlights = parseHighlights(
    envelope['highlights'] ? JSON.stringify(envelope['highlights']) : null
  )
  const data = {
    ...record(progress),
    ...record(envelope['readerData'])
  } as ReaderData
  return {
    data: {
      ...data,
      ranges: Array.from(highlights.ranges),
      rects: Array.from(highlights.rects),
      pagePaintings: highlights.paintings
    },
    comments: parseComments(
      envelope['comments'] ? JSON.stringify(envelope['comments']) : null
    ),
    extra: envelope
  }
}

export function serializeReaderSnapshot(
  snapshot: ReaderSnapshot
): Record<string, unknown> {
  const {
    ranges = [],
    rects = [],
    pagePaintings = {},
    ...readerData
  } = snapshot.data
  return {
    ...snapshot.extra,
    highlights: JSON.parse(serializeHighlights(ranges, rects, pagePaintings)),
    comments: JSON.parse(serializeComments(snapshot.comments)),
    readerData
  }
}
