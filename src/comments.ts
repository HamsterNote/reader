import type { ReaderComment, ReaderCommentThreadNode } from './types/comments'

type IndexedComment = {
  readonly comment: ReaderComment
  readonly index: number
}

type MutableCommentThreadNode = ReaderComment & {
  readonly replies: MutableCommentThreadNode[]
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

const resolveCommentParentIndexes = (
  indexedComments: readonly IndexedComment[]
): (number | null)[] => {
  const firstIndexById = new Map<string, number>()

  for (const indexedComment of indexedComments) {
    if (!firstIndexById.has(indexedComment.comment.id)) {
      firstIndexById.set(indexedComment.comment.id, indexedComment.index)
    }
  }

  return indexedComments.map(({ comment, index }) => {
    const firstIndex = firstIndexById.get(comment.id)
    if (firstIndex !== index || comment.parentId === null) return null

    const parentIndex = firstIndexById.get(comment.parentId)
    return parentIndex === undefined || parentIndex === index
      ? null
      : parentIndex
  })
}

const findSmallestCycleIndex = (
  path: readonly number[],
  cycleStart: number,
  fallbackIndex: number
): number => {
  let cycleRootIndex = path[cycleStart] ?? fallbackIndex
  for (
    let pathIndex = cycleStart + 1;
    pathIndex < path.length;
    pathIndex += 1
  ) {
    const cycleIndex = path[pathIndex]
    if (cycleIndex !== undefined) {
      cycleRootIndex = Math.min(cycleRootIndex, cycleIndex)
    }
  }
  return cycleRootIndex
}

const breakCommentParentCycles = (parentIndexes: (number | null)[]): void => {
  const resolvedIndexes = new Set<number>()

  for (let startIndex = 0; startIndex < parentIndexes.length; startIndex += 1) {
    if (resolvedIndexes.has(startIndex)) continue

    const path: number[] = []
    const pathPositionByIndex = new Map<number, number>()
    let currentIndex: number | null = startIndex

    while (currentIndex !== null && !resolvedIndexes.has(currentIndex)) {
      const cycleStart = pathPositionByIndex.get(currentIndex)
      if (cycleStart !== undefined) {
        const cycleRootIndex = findSmallestCycleIndex(
          path,
          cycleStart,
          currentIndex
        )
        parentIndexes[cycleRootIndex] = null
        break
      }

      pathPositionByIndex.set(currentIndex, path.length)
      path.push(currentIndex)
      currentIndex = parentIndexes[currentIndex] ?? null
    }

    for (const resolvedIndex of path) resolvedIndexes.add(resolvedIndex)
  }
}

const groupCommentsByParentIndex = (
  indexedComments: readonly IndexedComment[],
  parentIndexes: readonly (number | null)[]
): {
  readonly childrenByParentIndex: ReadonlyMap<number, IndexedComment[]>
  readonly roots: IndexedComment[]
} => {
  const childrenByParentIndex = new Map<number, IndexedComment[]>()
  const roots: IndexedComment[] = []

  for (const indexedComment of indexedComments) {
    const parentIndex = parentIndexes[indexedComment.index]
    if (parentIndex === null || parentIndex === undefined) {
      roots.push(indexedComment)
      continue
    }

    const children = childrenByParentIndex.get(parentIndex)
    if (children) {
      children.push(indexedComment)
    } else {
      childrenByParentIndex.set(parentIndex, [indexedComment])
    }
  }

  return { childrenByParentIndex, roots }
}

const materializeCommentNodes = (
  indexedComments: readonly IndexedComment[],
  childrenByParentIndex: ReadonlyMap<number, readonly IndexedComment[]>
): MutableCommentThreadNode[] => {
  const nodes: MutableCommentThreadNode[] = indexedComments.map(
    ({ comment }) => ({ ...comment, replies: [] })
  )

  for (const [parentIndex, children] of childrenByParentIndex) {
    const parentNode = nodes[parentIndex]
    if (!parentNode) continue

    for (const child of [...children].sort(sortIndexedCommentsByCreatedAt)) {
      const childNode = nodes[child.index]
      if (childNode) parentNode.replies.push(childNode)
    }
  }

  return nodes
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
  const parentIndexes = resolveCommentParentIndexes(indexedComments)
  breakCommentParentCycles(parentIndexes)

  const { childrenByParentIndex, roots } = groupCommentsByParentIndex(
    indexedComments,
    parentIndexes
  )
  const nodes = materializeCommentNodes(indexedComments, childrenByParentIndex)

  const rootNodes: ReaderCommentThreadNode[] = []
  for (const root of [...roots].sort(sortIndexedCommentsByCreatedAt)) {
    const rootNode = nodes[root.index]
    if (rootNode) rootNodes.push(rootNode)
  }
  return rootNodes
}
