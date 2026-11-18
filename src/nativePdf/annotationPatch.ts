import type { EditorDocument } from '@hamster-note/painting/core'
import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../types/selection'
import { restoreReaderSnapshot } from '../host/readerSnapshot'
import type { NativeAnnotationSnapshot } from './annotationController'
import { withNativeAnnotationData } from './drawing'

type Identified = { readonly id: string }

type EntityPatch<T> = {
  readonly create: readonly T[]
  readonly update: readonly T[]
  readonly restore: readonly T[]
  readonly delete: readonly string[]
}

type PaintingObject = EditorDocument['objects'][number]

type PaintingPatch = {
  readonly create: readonly PaintingObject[]
  readonly update: readonly PaintingObject[]
  readonly restore: readonly PaintingObject[]
  readonly delete: readonly string[]
  readonly afterPresent: boolean
}

export type NativeAnnotationPatch = {
  readonly ranges: EntityPatch<ReaderSelectionRange>
  readonly rects: EntityPatch<ReaderSelectionRectangle>
  readonly paintings: Readonly<Record<string, PaintingPatch>>
}

export type NativeAnnotationConflict = {
  readonly entity: 'range' | 'rect' | 'painting'
  readonly objectId: string
  readonly pageId?: string
  readonly operation: 'create' | 'update' | 'restore'
  readonly reason: 'already-exists' | 'missing-target'
}

export type NativeAnnotationPatchResult = {
  readonly snapshot: NativeAnnotationSnapshot
  readonly conflicts: readonly NativeAnnotationConflict[]
}

type NativeAnnotationDiffOptions = {
  readonly history?: 'edit' | 'undo' | 'redo'
  readonly rangeUpsert?: {
    readonly rangeId: string
    readonly operation: 'create' | 'update'
  }
}

function diffEntities<T>(
  before: readonly T[],
  after: readonly T[],
  history: 'edit' | 'undo' | 'redo',
  idOf: (item: T) => string,
  forceUpsert?: { readonly id: string; readonly operation: 'create' | 'update' }
): EntityPatch<T> {
  const beforeById = new Map(before.map((item) => [idOf(item), item]))
  const afterIds = new Set(after.map(idOf))
  const changed = after.filter((item) => beforeById.get(idOf(item)) !== item)
  let create = changed.filter((item) => !beforeById.has(idOf(item)))
  let update = changed.filter((item) => beforeById.has(idOf(item)))
  let restore: readonly T[] = []
  if (history === 'undo') {
    restore = create
    create = []
  }
  if (forceUpsert) {
    const target = changed.find((item) => idOf(item) === forceUpsert.id)
    if (target) {
      create = create.filter((item) => idOf(item) !== forceUpsert.id)
      update = update.filter((item) => idOf(item) !== forceUpsert.id)
      restore = restore.filter((item) => idOf(item) !== forceUpsert.id)
      if (forceUpsert.operation === 'create') create = [...create, target]
      else update = [...update, target]
    }
  }
  return {
    create,
    update,
    restore,
    delete: before
      .filter((item) => !afterIds.has(idOf(item)))
      .map((item) => idOf(item))
  }
}

function applyEntities<T extends Identified>(
  current: readonly T[],
  patch: EntityPatch<T>,
  conflict: (
    item: T,
    operation: 'create' | 'update' | 'restore',
    reason: 'already-exists' | 'missing-target'
  ) => void
): T[] {
  const removed = new Set(patch.delete)
  const next = current.filter((item) => !removed.has(item.id))
  for (const item of patch.create) {
    if (next.some((existing) => existing.id === item.id)) {
      conflict(item, 'create', 'already-exists')
    } else next.push(item)
  }
  for (const item of patch.restore) {
    if (next.some((existing) => existing.id === item.id)) {
      conflict(item, 'restore', 'already-exists')
    } else next.push(item)
  }
  for (const item of patch.update) {
    const index = next.findIndex((existing) => existing.id === item.id)
    if (index < 0) conflict(item, 'update', 'missing-target')
    else next[index] = item
  }
  return next
}

function diffPainting(
  before: EditorDocument | undefined,
  after: EditorDocument | undefined,
  history: 'edit' | 'undo' | 'redo'
): PaintingPatch | null {
  const beforeObjects = before?.objects ?? []
  const afterObjects = after?.objects ?? []
  const patch = diffEntities(
    beforeObjects,
    afterObjects,
    history,
    (object) => object.objectId
  )
  const result: PaintingPatch = {
    create: patch.create,
    update: patch.update,
    restore: patch.restore,
    delete: patch.delete,
    afterPresent: after !== undefined
  }
  return result.create.length > 0 ||
    result.update.length > 0 ||
    result.restore.length > 0 ||
    result.delete.length > 0 ||
    (before === undefined) !== (after === undefined)
    ? result
    : null
}

export function diffNativeAnnotationSnapshots(
  before: NativeAnnotationSnapshot,
  after: NativeAnnotationSnapshot,
  options: NativeAnnotationDiffOptions = {}
): NativeAnnotationPatch {
  const history = options.history ?? 'edit'
  const paintings: Record<string, PaintingPatch> = {}
  const pageIds = new Set([
    ...Object.keys(before.pagePaintings),
    ...Object.keys(after.pagePaintings)
  ])
  for (const pageId of pageIds) {
    const patch = diffPainting(
      before.pagePaintings[pageId],
      after.pagePaintings[pageId],
      history
    )
    if (patch) paintings[pageId] = patch
  }
  return {
    ranges: diffEntities(
      before.ranges,
      after.ranges,
      history,
      (item) => item.id,
      {
        id: options.rangeUpsert?.rangeId ?? '',
        operation: options.rangeUpsert?.operation ?? 'update'
      }
    ),
    rects: diffEntities(before.rects, after.rects, history, (item) => item.id),
    paintings
  }
}

export function applyNativeAnnotationPatchDetailed(
  current: NativeAnnotationSnapshot,
  patch: NativeAnnotationPatch
): NativeAnnotationPatchResult {
  const conflicts: NativeAnnotationConflict[] = []
  const pagePaintings = { ...current.pagePaintings }
  for (const [pageId, pagePatch] of Object.entries(patch.paintings)) {
    const document = pagePaintings[pageId]
    const objects = applyEntities(
      (document?.objects ?? []).map((object) => ({
        ...object,
        id: object.objectId
      })),
      {
        create: pagePatch.create.map((object) => ({
          ...object,
          id: object.objectId
        })),
        update: pagePatch.update.map((object) => ({
          ...object,
          id: object.objectId
        })),
        restore: pagePatch.restore.map((object) => ({
          ...object,
          id: object.objectId
        })),
        delete: pagePatch.delete
      },
      (item, operation, reason) => {
        conflicts.push({
          entity: 'painting',
          objectId: item.id,
          pageId,
          operation,
          reason
        })
      }
    )
    if (objects.length === 0 && !pagePatch.afterPresent)
      delete pagePaintings[pageId]
    else {
      pagePaintings[pageId] = {
        schemaVersion: 3,
        documentRevision: (document?.documentRevision ?? 0) + 1,
        objects: objects.map(({ id: _id, ...object }) => object)
      }
    }
  }
  const ranges = applyEntities(
    current.ranges,
    patch.ranges,
    (item, operation, reason) => {
      conflicts.push({
        entity: 'range',
        objectId: item.id,
        operation,
        reason
      })
    }
  )
  const rects = applyEntities(
    current.rects,
    patch.rects,
    (item, operation, reason) => {
      conflicts.push({
        entity: 'rect',
        objectId: item.id,
        operation,
        reason
      })
    }
  )
  return { snapshot: { ranges, rects, pagePaintings }, conflicts }
}

export function applyNativeAnnotationPatch(
  current: NativeAnnotationSnapshot,
  patch: NativeAnnotationPatch
): NativeAnnotationSnapshot {
  return applyNativeAnnotationPatchDetailed(current, patch).snapshot
}

export function withNativeAnnotationPatchDetailed(
  snapshotData: unknown,
  patch: NativeAnnotationPatch
): {
  readonly data: Record<string, unknown>
  readonly conflicts: readonly NativeAnnotationConflict[]
} {
  const restored = restoreReaderSnapshot(snapshotData)
  const current: NativeAnnotationSnapshot = {
    ranges: restored.data.ranges ?? [],
    rects: restored.data.rects ?? [],
    pagePaintings: restored.data.pagePaintings ?? {}
  }
  const result = applyNativeAnnotationPatchDetailed(current, patch)
  return {
    data: withNativeAnnotationData(snapshotData, result.snapshot),
    conflicts: result.conflicts
  }
}

export function withNativeAnnotationPatch(
  snapshotData: unknown,
  patch: NativeAnnotationPatch
): Record<string, unknown> {
  return withNativeAnnotationPatchDetailed(snapshotData, patch).data
}
