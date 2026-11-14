import type { EditorDocument } from '@hamster-note/painting/core'
import type { ReaderData } from '../types/readerData'
import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../types/selection'
import type {
  NativePdfAnnotationCommit,
  NativePdfAnnotationIntent
} from './contracts'

export type NativeAnnotationSnapshot = {
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
  readonly pagePaintings: Record<string, EditorDocument>
}

export type AnnotationControllerResult =
  | { readonly status: 'changed'; readonly snapshot: NativeAnnotationSnapshot }
  | {
      readonly status: 'duplicate' | 'ignored'
      readonly snapshot: NativeAnnotationSnapshot
    }
  | {
      readonly status: 'rejected'
      readonly reason: 'MAPPING_NOT_READY' | 'INVALID_TARGET'
    }

function initialSnapshot(
  value: ReaderData | null | undefined
): NativeAnnotationSnapshot {
  return {
    ranges: value?.ranges ?? [],
    rects: value?.rects ?? [],
    pagePaintings: value?.pagePaintings ?? {}
  }
}

function rectForIntent(
  intent: Extract<NativePdfAnnotationIntent, { type: 'rectangle' }>
): ReaderSelectionRectangle {
  const id =
    intent.rectId ??
    `native-rect-${intent.pageNumber}-${intent.geometryRevision}`
  return {
    id,
    createdAt: Date.now(),
    overlayRectType: 'px',
    start: { x: intent.rect.x, y: intent.rect.y },
    end: {
      x: intent.rect.x + intent.rect.width,
      y: intent.rect.y + intent.rect.height
    },
    selectionId: `page-${intent.pageNumber}`,
    rect: intent.rect
  }
}

export function createNativeAnnotationController(initial?: ReaderData | null) {
  let current = initialSnapshot(initial)
  const past: NativeAnnotationSnapshot[] = []
  const future: NativeAnnotationSnapshot[] = []
  const commits = new Set<string>()

  const changed = (
    next: NativeAnnotationSnapshot
  ): AnnotationControllerResult => {
    past.push(current)
    current = next
    future.length = 0
    return { status: 'changed', snapshot: current }
  }

  const applyIntent = (
    commit: NativePdfAnnotationCommit
  ): AnnotationControllerResult => {
    const intent = commit.intent
    if (intent.type === 'rectangle' && intent.phase !== 'commit')
      return { status: 'ignored', snapshot: current }
    if (commits.has(commit.commitId))
      return { status: 'duplicate', snapshot: current }
    commits.add(commit.commitId)
    if (intent.type === 'highlight') {
      const index = current.ranges.findIndex(
        (range) => range.id === intent.rangeId
      )
      const range = current.ranges[index]
      if (index < 0 || !range)
        return { status: 'rejected', reason: 'MAPPING_NOT_READY' }
      const nextRange: ReaderSelectionRange = {
        ...range,
        start: intent.start,
        end: intent.end,
        rectsBySelectionId: Object.fromEntries(
          Object.entries(intent.rectsBySelectionId).map(([page, rects]) => [
            page,
            [...rects]
          ])
        )
      }
      const ranges = [...current.ranges]
      ranges[index] = nextRange
      return changed({ ...current, ranges })
    }
    const rect = rectForIntent(intent)
    const index = current.rects.findIndex((item) => item.id === rect.id)
    const rects = [...current.rects]
    if (index < 0) rects.push(rect)
    else {
      const existing = rects[index]
      if (!existing) return { status: 'rejected', reason: 'INVALID_TARGET' }
      rects[index] = { ...existing, rect: intent.rect }
    }
    return changed({ ...current, rects })
  }

  return {
    getSnapshot: (): NativeAnnotationSnapshot => current,
    /** Controlled rehydration never creates a user history entry. */
    replaceSnapshot: (
      value: ReaderData | null | undefined,
      options: { preserveHistory?: boolean } = {}
    ): void => {
      current = initialSnapshot(value)
      if (options.preserveHistory) return
      past.length = 0
      future.length = 0
      commits.clear()
    },
    apply: applyIntent,
    setPainting: (
      commitId: string,
      pageId: string,
      painting: EditorDocument
    ): AnnotationControllerResult => {
      if (commits.has(commitId))
        return { status: 'duplicate', snapshot: current }
      commits.add(commitId)
      return changed({
        ...current,
        pagePaintings: { ...current.pagePaintings, [pageId]: painting }
      })
    },
    deleteRange: (
      commitId: string,
      rangeId: string
    ): AnnotationControllerResult => {
      if (commits.has(commitId))
        return { status: 'duplicate', snapshot: current }
      const ranges = current.ranges.filter((range) => range.id !== rangeId)
      if (ranges.length === current.ranges.length)
        return { status: 'rejected', reason: 'INVALID_TARGET' }
      commits.add(commitId)
      return changed({ ...current, ranges })
    },
    deleteRectangle: (
      commitId: string,
      rectId: string
    ): AnnotationControllerResult => {
      if (commits.has(commitId))
        return { status: 'duplicate', snapshot: current }
      const rects = current.rects.filter((rect) => rect.id !== rectId)
      if (rects.length === current.rects.length)
        return { status: 'rejected', reason: 'INVALID_TARGET' }
      commits.add(commitId)
      return changed({ ...current, rects })
    },
    clearPainting: (
      commitId: string,
      pageId: string
    ): AnnotationControllerResult => {
      if (commits.has(commitId))
        return { status: 'duplicate', snapshot: current }
      if (!Object.prototype.hasOwnProperty.call(current.pagePaintings, pageId))
        return { status: 'rejected', reason: 'INVALID_TARGET' }
      const pagePaintings = { ...current.pagePaintings }
      delete pagePaintings[pageId]
      commits.add(commitId)
      return changed({ ...current, pagePaintings })
    },
    undo: (): boolean => {
      const previous = past.pop()
      if (!previous) return false
      future.push(current)
      current = previous
      return true
    },
    redo: (): boolean => {
      const next = future.pop()
      if (!next) return false
      past.push(current)
      current = next
      return true
    }
  }
}

/** Keeps undo/redo history in separate buckets while a reader switches files. */
export function createNativeAnnotationControllerStore() {
  const buckets = new Map<string, ReturnType<typeof createNativeAnnotationController>>()
  return {
    get: (storageId: string, initial?: ReaderData | null) => {
      let controller = buckets.get(storageId)
      if (!controller) {
        controller = createNativeAnnotationController(initial)
        buckets.set(storageId, controller)
      }
      return controller
    }
  }
}

/** Host-lifetime store: ReaderScreen may remount a file keyed subtree. */
export const nativeAnnotationControllerStore =
  createNativeAnnotationControllerStore()
