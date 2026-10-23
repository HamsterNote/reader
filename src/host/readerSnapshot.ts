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

/** Same legacy readers as the Web demo; engine positions never enter the envelope. */
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
