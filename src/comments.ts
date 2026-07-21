import type { ReaderComment, ReaderCommentThreadNode } from './types/comments'

type IndexedComment = {
  readonly comment: ReaderComment
  readonly index: number
}

const sortIndexedCommentsByCreatedAt = (
  left: IndexedComment,
  right: IndexedComment
): number => {
  const createdAtDelta = left.comment.createdAt - right.comment.createdAt

  if (createdAtDelta !== 0) {
    return createdAtDelta
  }

  return left.index - right.index
}

export const getCommentsByHighlightId = (
  comments: readonly ReaderComment[],
  highlightId: string
): ReaderComment[] =>
  comments
    .map((comment, index) => ({ comment, index }))
    .filter(({ comment }) => comment.highlightIds.includes(highlightId))
    .sort(sortIndexedCommentsByCreatedAt)
    .map(({ comment }) => comment)

export const getCommentCountByHighlightId = (
  comments: readonly ReaderComment[]
): Record<string, number> => {
  const countByHighlightId: Record<string, number> = {}

  for (const comment of comments) {
    for (const highlightId of comment.highlightIds) {
      countByHighlightId[highlightId] =
        (countByHighlightId[highlightId] ?? 0) + 1
    }
  }

  return countByHighlightId
}

export const buildReaderCommentTree = (
  comments: readonly ReaderComment[]
): ReaderCommentThreadNode[] => {
  const indexedComments = comments.map((comment, index) => ({ comment, index }))
  const commentsById = new Set(comments.map((comment) => comment.id))
  const childrenByParentId = new Map<string, IndexedComment[]>()
  const roots: IndexedComment[] = []

  for (const indexedComment of indexedComments) {
    const { comment } = indexedComment

    if (comment.parentId === null || !commentsById.has(comment.parentId)) {
      roots.push(indexedComment)
      continue
    }

    const children = childrenByParentId.get(comment.parentId)

    if (children === undefined) {
      childrenByParentId.set(comment.parentId, [indexedComment])
      continue
    }

    children.push(indexedComment)
  }

  const buildNode = ({ comment }: IndexedComment): ReaderCommentThreadNode => {
    const children = childrenByParentId.get(comment.id) ?? []
    const replies = [...children]
      .sort(sortIndexedCommentsByCreatedAt)
      .map((child) => buildNode(child))

    return {
      ...comment,
      replies
    }
  }

  return [...roots]
    .sort(sortIndexedCommentsByCreatedAt)
    .map((root) => buildNode(root))
}
