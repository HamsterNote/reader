import {
  removeCommentSubtree,
  removeHighlightFromComments
} from '../storage/commentStorage'
import type { ReaderComment } from '../types/comments'

export type NativeCommentCommitResult =
  | { readonly status: 'changed'; readonly comments: readonly ReaderComment[] }
  | {
      readonly status: 'duplicate'
      readonly comments: readonly ReaderComment[]
    }

/**
 * Business-side comment coordinator for the native PDF surface.
 * The WebView owns presentation and text input; this layer owns commit
 * idempotency and the existing ReaderComment relationship semantics.
 */
export function createNativeCommentController(
  initial: readonly ReaderComment[] = []
) {
  let comments = Array.from(initial)
  const commits = new Set<string>()

  const commit = (
    commitId: string,
    next: readonly ReaderComment[]
  ): NativeCommentCommitResult => {
    if (commits.has(commitId)) return { status: 'duplicate', comments }
    commits.add(commitId)
    comments = Array.from(next)
    return { status: 'changed', comments }
  }

  return {
    getComments: (): readonly ReaderComment[] => comments,
    replace: (next: readonly ReaderComment[]): void => {
      comments = Array.from(next)
      commits.clear()
    },
    commit,
    add: (
      commitId: string,
      comment: ReaderComment
    ): NativeCommentCommitResult => {
      if (comments.some((item) => item.id === comment.id))
        return { status: 'duplicate', comments }
      return commit(commitId, [...comments, comment])
    },
    update: (
      commitId: string,
      comment: ReaderComment
    ): NativeCommentCommitResult => {
      if (!comments.some((item) => item.id === comment.id))
        return { status: 'duplicate', comments }
      return commit(
        commitId,
        comments.map((item) => (item.id === comment.id ? comment : item))
      )
    },
    remove: (commitId: string, commentId: string): NativeCommentCommitResult =>
      commit(commitId, removeCommentSubtree(comments, commentId)),
    bind: (
      commitId: string,
      commentId: string,
      highlightIds: readonly string[]
    ): NativeCommentCommitResult =>
      commit(
        commitId,
        comments.map((item) =>
          item.id === commentId
            ? { ...item, highlightIds: Array.from(new Set(highlightIds)) }
            : item
        )
      ),
    removeHighlight: (
      commitId: string,
      highlightId: string
    ): NativeCommentCommitResult =>
      commit(commitId, removeHighlightFromComments(comments, highlightId))
  }
}
