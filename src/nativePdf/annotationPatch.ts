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
  readonly upsert: readonly T[]
  readonly remove: readonly string[]
}

type PaintingObject = EditorDocument['objects'][number]

type PaintingPatch = {
  readonly upsert: readonly PaintingObject[]
  readonly remove: readonly string[]
  readonly afterPresent: boolean
}

export type NativeAnnotationPatch = {
  readonly ranges: EntityPatch<ReaderSelectionRange>
  readonly rects: EntityPatch<ReaderSelectionRectangle>
  readonly paintings: Readonly<Record<string, PaintingPatch>>
}

function diffEntities<T extends Identified>(
  before: readonly T[],
  after: readonly T[]
): EntityPatch<T> {
  const beforeById = new Map(before.map((item) => [item.id, item]))
  const afterIds = new Set(after.map((item) => item.id))
  return {
    upsert: after.filter((item) => beforeById.get(item.id) !== item),
    remove: before
      .filter((item) => !afterIds.has(item.id))
      .map((item) => item.id)
  }
}

function applyEntities<T extends Identified>(
  current: readonly T[],
  patch: EntityPatch<T>
): T[] {
  const removed = new Set(patch.remove)
  const next = current.filter((item) => !removed.has(item.id))
  for (const item of patch.upsert) {
    const index = next.findIndex((existing) => existing.id === item.id)
    if (index < 0) next.push(item)
    else next[index] = item
  }
  return next
}

function diffPainting(
  before: EditorDocument | undefined,
  after: EditorDocument | undefined
): PaintingPatch | null {
  const beforeObjects = before?.objects ?? []
  const afterObjects = after?.objects ?? []
  const beforeById = new Map(beforeObjects.map((item) => [item.objectId, item]))
  const afterIds = new Set(afterObjects.map((item) => item.objectId))
  const patch: PaintingPatch = {
    upsert: afterObjects.filter(
      (item) => beforeById.get(item.objectId) !== item
    ),
    remove: beforeObjects
      .filter((item) => !afterIds.has(item.objectId))
      .map((item) => item.objectId),
    afterPresent: after !== undefined
  }
  return patch.upsert.length > 0 ||
    patch.remove.length > 0 ||
    (before === undefined) !== (after === undefined)
    ? patch
    : null
}

export function diffNativeAnnotationSnapshots(
  before: NativeAnnotationSnapshot,
  after: NativeAnnotationSnapshot
): NativeAnnotationPatch {
  const paintings: Record<string, PaintingPatch> = {}
  const pageIds = new Set([
    ...Object.keys(before.pagePaintings),
    ...Object.keys(after.pagePaintings)
  ])
  for (const pageId of pageIds) {
    const patch = diffPainting(
      before.pagePaintings[pageId],
      after.pagePaintings[pageId]
    )
    if (patch) paintings[pageId] = patch
  }
  return {
    ranges: diffEntities(before.ranges, after.ranges),
    rects: diffEntities(before.rects, after.rects),
    paintings
  }
}

export function applyNativeAnnotationPatch(
  current: NativeAnnotationSnapshot,
  patch: NativeAnnotationPatch
): NativeAnnotationSnapshot {
  const pagePaintings = { ...current.pagePaintings }
  for (const [pageId, pagePatch] of Object.entries(patch.paintings)) {
    const document = pagePaintings[pageId]
    const objects = applyEntities(
      (document?.objects ?? []).map((object) => ({
        ...object,
        id: object.objectId
      })),
      {
        remove: pagePatch.remove,
        upsert: pagePatch.upsert.map((object) => ({
          ...object,
          id: object.objectId
        }))
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
  return {
    ranges: applyEntities(current.ranges, patch.ranges),
    rects: applyEntities(current.rects, patch.rects),
    pagePaintings
  }
}

export function withNativeAnnotationPatch(
  snapshotData: unknown,
  patch: NativeAnnotationPatch
): Record<string, unknown> {
  const restored = restoreReaderSnapshot(snapshotData)
  const current: NativeAnnotationSnapshot = {
    ranges: restored.data.ranges ?? [],
    rects: restored.data.rects ?? [],
    pagePaintings: restored.data.pagePaintings ?? {}
  }
  return withNativeAnnotationData(
    snapshotData,
    applyNativeAnnotationPatch(current, patch)
  )
}
