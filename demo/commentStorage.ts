import type { ReaderComment } from '@hamster-note/reader'

export const HAMSTER_DEMO_COMMENT_STORAGE_VERSION = 2

type CommentStorageV2 = {
  readonly version: typeof HAMSTER_DEMO_COMMENT_STORAGE_VERSION
  readonly comments: readonly ReaderComment[]
}

type MigratedCommentInput = {
  readonly highlightId: string
  readonly content: string
  readonly createdAt: number
  readonly id?: string
}

let fallbackCommentIdCounter = 0

export function parseComments(raw: string | null): ReaderComment[] {
  if (raw === null || raw.trim() === '') return []

  try {
    const parsed: unknown = JSON.parse(raw)
    return parseCommentStorage(parsed)
  } catch (error) {
    if (error instanceof SyntaxError) return []
    return []
  }
}

export function serializeComments(comments: readonly ReaderComment[]): string {
  const storage: CommentStorageV2 = {
    version: HAMSTER_DEMO_COMMENT_STORAGE_VERSION,
    comments
  }
  return JSON.stringify(storage)
}

export function removeCommentSubtree(
  comments: readonly ReaderComment[],
  commentId: string
): ReaderComment[] {
  const removedIds = collectCommentSubtreeIds(comments, new Set([commentId]))
  return comments.filter((comment) => !removedIds.has(comment.id))
}

export function removeHighlightFromComments(
  comments: readonly ReaderComment[],
  highlightId: string
): ReaderComment[] {
  const strippedComments = comments.map((comment) => ({
    ...comment,
    highlightIds: comment.highlightIds.filter((id) => id !== highlightId)
  }))
  const zeroBoundIds = new Set(
    strippedComments
      .filter((comment) => comment.highlightIds.length === 0)
      .map((comment) => comment.id)
  )
  const removedIds = collectCommentSubtreeIds(strippedComments, zeroBoundIds)

  return strippedComments.filter((comment) => !removedIds.has(comment.id))
}

function parseCommentStorage(value: unknown): ReaderComment[] {
  if (!isPlainRecord(value)) return []

  if (value.version === HAMSTER_DEMO_COMMENT_STORAGE_VERSION) {
    return parseCommentStorageV2(value)
  }

  return parseLegacyCommentRecord(value)
}

function parseCommentStorageV2(
  value: Record<string, unknown>
): ReaderComment[] {
  const comments = value.comments
  if (!Array.isArray(comments)) return []

  return comments.flatMap((comment) => {
    const parsedComment = parseReaderComment(comment)
    return parsedComment === null ? [] : [parsedComment]
  })
}

function parseLegacyCommentRecord(
  value: Record<string, unknown>
): ReaderComment[] {
  return Object.entries(value).flatMap(([highlightId, entry]) =>
    parseLegacyCommentEntry(highlightId, entry)
  )
}

function parseLegacyCommentEntry(
  highlightId: string,
  value: unknown
): ReaderComment[] {
  if (typeof value === 'string') {
    return [
      createMigratedComment({
        highlightId,
        content: value,
        createdAt: Date.now()
      })
    ]
  }

  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const parsedComment = parseLegacyCommentItem(highlightId, item)
    return parsedComment === null ? [] : [parsedComment]
  })
}

function parseLegacyCommentItem(
  highlightId: string,
  value: unknown
): ReaderComment | null {
  if (!isPlainRecord(value)) return null

  const content = value.content
  if (typeof content !== 'string') return null

  const id = typeof value.id === 'string' ? value.id : generateCommentId()
  const createdAt =
    typeof value.createdAt === 'number' ? value.createdAt : Date.now()

  return createMigratedComment({ highlightId, content, createdAt, id })
}

function parseReaderComment(value: unknown): ReaderComment | null {
  if (!isPlainRecord(value)) return null

  const id = value.id
  const highlightIds = parseHighlightIds(value.highlightIds)
  const content = value.content
  const createdAt = value.createdAt
  const updatedAt = value.updatedAt
  const parentId = value.parentId

  if (
    typeof id !== 'string' ||
    highlightIds === null ||
    typeof content !== 'string' ||
    typeof createdAt !== 'number' ||
    (updatedAt !== undefined && typeof updatedAt !== 'number') ||
    (parentId !== null && typeof parentId !== 'string')
  ) {
    return null
  }

  return {
    id,
    highlightIds,
    content,
    createdAt,
    ...(updatedAt === undefined ? {} : { updatedAt }),
    parentId
  }
}

function parseHighlightIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((highlightId) => typeof highlightId === 'string')) {
    return null
  }
  return Array.from(new Set(value))
}

function createMigratedComment(input: MigratedCommentInput): ReaderComment {
  return {
    id: input.id ?? generateCommentId(),
    highlightIds: [input.highlightId],
    content: input.content,
    createdAt: input.createdAt,
    parentId: null
  }
}

function collectCommentSubtreeIds(
  comments: readonly ReaderComment[],
  initialRemovedIds: ReadonlySet<string>
): ReadonlySet<string> {
  const removedIds = new Set(initialRemovedIds)
  let changed = true

  while (changed) {
    changed = false
    for (const comment of comments) {
      if (
        comment.parentId !== null &&
        removedIds.has(comment.parentId) &&
        !removedIds.has(comment.id)
      ) {
        removedIds.add(comment.id)
        changed = true
      }
    }
  }

  return removedIds
}

function generateCommentId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  fallbackCommentIdCounter += 1
  return `comment-${Date.now()}-${fallbackCommentIdCounter}`
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
