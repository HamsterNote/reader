import { createContext, useContext, useMemo, useReducer, useRef } from 'react'
import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryChangeSource,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue
} from '../../types/selection'

export type AnnotationHistoryApplySource = 'undo' | 'redo'
export type AnnotationHistoryApplyTargetResult =
  | {
      readonly applied: true
      readonly source: AnnotationHistoryApplySource
      readonly target: ReaderAnnotationHistoryValue
      readonly detail: ReaderAnnotationHistoryChangeDetail
    }
  | {
      readonly applied: false
      readonly source: AnnotationHistoryApplySource
      readonly target?: undefined
      readonly detail?: undefined
    }
export type AnnotationHistoryController = {
  readonly cancelInput: () => void
  readonly setCheckpoint: (
    next: ReaderAnnotationHistoryValue,
    source: ReaderAnnotationHistoryChangeSource
  ) => void
  readonly syncPresent: (
    next: ReaderAnnotationHistoryValue,
    source: ReaderAnnotationHistoryChangeSource
  ) => void
  readonly syncSilent: (next: ReaderAnnotationHistoryValue) => void
  readonly reset: (
    next: ReaderAnnotationHistoryValue,
    source: ReaderAnnotationHistoryChangeSource
  ) => void
  readonly undo: () => AnnotationHistoryApplyTargetResult
  readonly redo: () => AnnotationHistoryApplyTargetResult
  readonly applyTarget: (
    source: AnnotationHistoryApplySource,
    apply: (target: ReaderAnnotationHistoryValue) => void
  ) => AnnotationHistoryApplyTargetResult
  readonly applyTargetSilently: (
    source: AnnotationHistoryApplySource
  ) => AnnotationHistoryApplyTargetResult
  readonly getStatus: () => ReaderAnnotationHistoryStatus
  readonly getPresent: () => ReaderAnnotationHistoryValue
  readonly getTarget: (
    source: AnnotationHistoryApplySource
  ) => ReaderAnnotationHistoryValue | undefined
}
export const AnnotationHistoryContext =
  createContext<AnnotationHistoryController | null>(null)
type Options = {
  readonly enabled: boolean
  readonly initialValue: ReaderAnnotationHistoryValue
  readonly onChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
  readonly beforeApply?: () => void
  readonly canApply?: (target: ReaderAnnotationHistoryValue) => boolean
  readonly onApply?: (target: ReaderAnnotationHistoryValue) => void
}
type History = {
  past: ReaderAnnotationHistoryValue[]
  present: ReaderAnnotationHistoryValue
  future: ReaderAnnotationHistoryValue[]
}

export { paintingContentKey } from '../../painting/paintingContent'
import { paintingContentKey } from '../../painting/paintingContent'
import type { ReaderPagePaintingMap } from '../Page'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
/**
 * Canonical form used to recognize echoes: sorted keys, no `undefined`, empty
 * objects (e.g. persisted defaults such as `selectionStyle: {}`) dropped.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isRecord(value)) return value
  const sorted: Record<string, unknown> = {}
  Object.keys(value)
    .sort()
    .forEach((key) => {
      const child = canonical(value[key])
      if (child === undefined) return
      if (isRecord(child) && Object.keys(child).length === 0) return
      sorted[key] = child
    })
  return sorted
}
const canonicalJson = (value: unknown) => JSON.stringify(canonical(value))
const sameValue = (a: unknown, b: unknown) =>
  canonicalJson(a) === canonicalJson(b)
const paintingJson = (value: ReaderPagePaintingMap | undefined) =>
  canonicalJson(JSON.parse(paintingContentKey(value)) as unknown)
const sameContent = (
  a: ReaderAnnotationHistoryValue,
  b: ReaderAnnotationHistoryValue
) =>
  canonicalJson(a.ranges) === canonicalJson(b.ranges) &&
  canonicalJson(a.rects) === canonicalJson(b.rects) &&
  paintingJson(a.pagePaintings) === paintingJson(b.pagePaintings)
const copy = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
/**
 * Three-way field merge of one annotation (base = current value, local = the
 * retained history snapshot, external = the host's latest value). Fields the
 * local stack changed keep the history value; fields it did not touch take the
 * host's value, so independent external edits survive undo/redo. Same-leaf
 * conflicts resolve to history. Optional style objects descend the same way
 * when one side has not created them yet (e.g. first local `markerStyle`).
 */
function mergeFields(
  base: unknown,
  local: unknown,
  external: unknown
): unknown {
  if (sameValue(local, external)) return local
  if (sameValue(local, base)) return copy(external)
  if (sameValue(external, base)) return local
  const canDescend =
    (isRecord(local) || local === undefined) &&
    (isRecord(external) || external === undefined) &&
    (isRecord(base) || base === undefined) &&
    (isRecord(local) || isRecord(external))
  if (canDescend) {
    const baseRecord = isRecord(base) ? base : {}
    const localRecord = isRecord(local) ? local : {}
    const externalRecord = isRecord(external) ? external : {}
    const merged: Record<string, unknown> = {}
    const keys = new Set([
      ...Object.keys(baseRecord),
      ...Object.keys(localRecord),
      ...Object.keys(externalRecord)
    ])
    keys.forEach((key) => {
      const value = mergeFields(
        baseRecord[key],
        localRecord[key],
        externalRecord[key]
      )
      if (value !== undefined) merged[key] = value
    })
    return merged
  }
  return local
}
/** Replays an external snapshot's changes onto a retained history snapshot. */
function mergeIdentified<T extends { readonly id: string }>(
  target: readonly T[],
  previous: readonly T[],
  next: readonly T[]
): T[] {
  const previousById = new Map(previous.map((item) => [item.id, item]))
  const nextById = new Map(next.map((item) => [item.id, item]))
  const merged = new Map<string, T>()
  target.forEach((item) => {
    const previousItem = previousById.get(item.id)
    const nextItem = nextById.get(item.id)
    if (!nextItem && previousItem) return
    if (nextItem && previousItem) {
      merged.set(item.id, mergeFields(previousItem, item, nextItem) as T)
      return
    }
    merged.set(item.id, item)
  })
  nextById.forEach((item, id) => {
    if (!previousById.has(id) && !merged.has(id)) merged.set(id, copy(item))
  })
  const ordered: T[] = []
  const seen = new Set<string>()
  ;[...next, ...target].forEach((item) => {
    const mergedItem = merged.get(item.id)
    if (!mergedItem || seen.has(item.id)) return
    ordered.push(mergedItem)
    seen.add(item.id)
  })
  return ordered
}
const objectIdOf = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.objectId === 'string'
    ? value.objectId
    : undefined
/**
 * Object-level replay of the host's page edit onto a retained snapshot. Objects
 * the local stack added or removed keep that decision; other objects take the
 * host's additions and field changes, so strokes drawn on another device on the
 * same page survive undo/redo.
 */
function mergeObjects(
  target: readonly unknown[],
  previous: readonly unknown[],
  next: readonly unknown[]
): unknown[] {
  const byId = (items: readonly unknown[]) => {
    const map = new Map<string, unknown>()
    items.forEach((item) => {
      const id = objectIdOf(item)
      if (id !== undefined) map.set(id, item)
    })
    return map
  }
  const targetById = byId(target)
  const previousById = byId(previous)
  const merged: unknown[] = []
  const seen = new Set<string>()
  next.forEach((item) => {
    const id = objectIdOf(item)
    if (id === undefined || seen.has(id)) return
    seen.add(id)
    const targetItem = targetById.get(id)
    if (targetItem === undefined) {
      // The snapshot removed it locally; only an object the host added survives.
      if (!previousById.has(id)) merged.push(copy(item))
      return
    }
    const previousItem = previousById.get(id)
    merged.push(
      previousItem === undefined
        ? copy(item)
        : mergeFields(previousItem, targetItem, item)
    )
  })
  target.forEach((item) => {
    const id = objectIdOf(item)
    if (id === undefined || seen.has(id)) return
    seen.add(id)
    // Locally added objects stay; objects also present before but gone in the
    // host's value were deleted externally.
    if (!previousById.has(id)) merged.push(item)
  })
  return merged
}
const pagePaintingJson = (pageId: string, doc: unknown): string =>
  paintingJson(
    isRecord(doc) && 'objects' in doc
      ? ({ [pageId]: doc } as ReaderPagePaintingMap)
      : {}
  )
const samePagePainting = (pageId: string, a: unknown, b: unknown) =>
  pagePaintingJson(pageId, a) === pagePaintingJson(pageId, b)
function mergePagePainting(
  targetDoc: unknown,
  previousDoc: unknown,
  nextDoc: unknown
): unknown {
  const doc = copy(nextDoc)
  if (!isRecord(doc) || !isRecord(targetDoc)) return doc
  const objects = (value: unknown) =>
    isRecord(value) && Array.isArray(value.objects) ? value.objects : []
  return {
    ...doc,
    objects: mergeObjects(
      objects(targetDoc),
      objects(previousDoc),
      objects(doc)
    )
  }
}
function mergePagePaintings(
  target: ReaderPagePaintingMap,
  previous: ReaderPagePaintingMap,
  next: ReaderPagePaintingMap
): ReaderPagePaintingMap {
  const merged: ReaderPagePaintingMap = {}
  const pageIds = new Set([...Object.keys(target), ...Object.keys(next)])
  pageIds.forEach((pageId) => {
    const targetDoc = target[pageId]
    const previousDoc = previous[pageId]
    const nextDoc = next[pageId]
    if (!nextDoc) {
      // Externally removed pages stay removed; pages only the snapshot knows
      // (taken back by a local undo) are kept.
      if (!previousDoc && targetDoc) merged[pageId] = targetDoc
      return
    }
    if (!previousDoc) {
      merged[pageId] = copy(nextDoc)
      return
    }
    if (samePagePainting(pageId, previousDoc, nextDoc)) {
      // The host did not change this page: keep the snapshot's own value,
      // including a missing page (e.g. undoing the first stroke).
      if (targetDoc) merged[pageId] = targetDoc
      return
    }
    if (!targetDoc) {
      merged[pageId] = copy(nextDoc)
      return
    }
    merged[pageId] = mergePagePainting(
      targetDoc,
      previousDoc,
      nextDoc
    ) as ReaderPagePaintingMap[string]
  })
  return merged
}
function mergeExternalChanges(
  target: ReaderAnnotationHistoryValue,
  previous: ReaderAnnotationHistoryValue,
  next: ReaderAnnotationHistoryValue
): ReaderAnnotationHistoryValue {
  return {
    ...target,
    ranges: mergeIdentified(target.ranges, previous.ranges, next.ranges),
    rects: mergeIdentified(target.rects, previous.rects, next.rects),
    pagePaintings: mergePagePaintings(
      target.pagePaintings ?? {},
      previous.pagePaintings ?? {},
      next.pagePaintings ?? {}
    )
  }
}
function snapshot(
  next: ReaderAnnotationHistoryValue,
  previous?: ReaderAnnotationHistoryValue
): ReaderAnnotationHistoryValue {
  const input = next.pagePaintings ?? previous?.pagePaintings ?? {}
  const pagePaintings = Object.fromEntries(
    Object.entries(input).map(([id, doc]) => {
      const saved = previous?.pagePaintings?.[id]
      const unchanged =
        saved &&
        (doc === saved || JSON.stringify(doc) === JSON.stringify(saved))
      return [id, unchanged ? saved : copy(doc)]
    })
  )
  return { ...copy({ ...next, pagePaintings: undefined }), pagePaintings }
}

/** A ref serializes commits within a React batch. Only the file owner keeps an active stack. */
export function useAnnotationHistory(
  options: Options
): AnnotationHistoryController {
  const inherited = useContext(AnnotationHistoryContext)
  const latest = useRef(options)
  latest.current = options
  const initial = useRef<History | null>(null)
  if (!initial.current && !inherited)
    initial.current = {
      past: [],
      present: snapshot(options.initialValue),
      future: []
    }
  const state = initial as { current: History }
  const [, render] = useReducer((n: number) => n + 1, 0)
  const controller = useMemo<AnnotationHistoryController>(() => {
    const getTarget = (source: AnnotationHistoryApplySource) => {
      if (!latest.current.enabled) return undefined
      return source === 'undo'
        ? state.current.past.at(-1)
        : state.current.future[0]
    }
    const getStatus = (): ReaderAnnotationHistoryStatus => {
      const { enabled, canApply } = latest.current
      const { past, future } = state.current
      return {
        enabled,
        canUndo:
          enabled && past.length > 0 && (canApply?.(past.at(-1)!) ?? true),
        canRedo:
          enabled && future.length > 0 && (canApply?.(future[0]!) ?? true),
        pastCount: enabled ? past.length : 0,
        futureCount: enabled ? future.length : 0
      }
    }
    const notify = (
      next: ReaderAnnotationHistoryValue,
      source: ReaderAnnotationHistoryChangeSource
    ) => latest.current.onChange?.(next, { source, status: getStatus() })
    const sync = (
      next: ReaderAnnotationHistoryValue,
      source?: ReaderAnnotationHistoryChangeSource
    ) => {
      if (!latest.current.enabled) return
      const value = snapshot(next, state.current.present)
      if (JSON.stringify(value) === JSON.stringify(state.current.present))
        return
      state.current.present = value
      render()
      if (source) notify(value, source)
    }
    /**
     * External snapshots replace the present value without adding checkpoints.
     * Normalized echoes (same content, e.g. reordered keys or default fields)
     * only refresh the present value; their changes are also replayed onto
     * retained snapshots so undo/redo do not discard annotations another host
     * added or edited in the meantime.
     */
    const syncExternal = (next: ReaderAnnotationHistoryValue) => {
      if (!latest.current.enabled) return
      const current = state.current
      const value = snapshot(next, current.present)
      if (sameValue(value, current.present)) return
      state.current = sameContent(value, current.present)
        ? { ...current, present: value }
        : {
            past: current.past.map((target) =>
              mergeExternalChanges(target, current.present, value)
            ),
            present: value,
            future: current.future.map((target) =>
              mergeExternalChanges(target, current.present, value)
            )
          }
      render()
    }
    const applyTargetSilently = (
      source: AnnotationHistoryApplySource
    ): AnnotationHistoryApplyTargetResult => {
      latest.current.beforeApply?.()
      const target = getTarget(source)
      if (!target || latest.current.canApply?.(target) === false)
        return { applied: false, source }
      const current = state.current
      state.current =
        source === 'undo'
          ? {
              past: current.past.slice(0, -1),
              present: target,
              future: [current.present, ...current.future]
            }
          : {
              past: [...current.past, current.present],
              present: target,
              future: current.future.slice(1)
            }
      latest.current.onApply?.(target)
      render()
      return {
        applied: true,
        source,
        target,
        detail: { source, status: getStatus() }
      }
    }
    const run = (source: AnnotationHistoryApplySource) => {
      const result = applyTargetSilently(source)
      if (result.applied) notify(result.target, source)
      return result
    }
    return {
      cancelInput: () => latest.current.beforeApply?.(),
      getTarget,
      getStatus,
      getPresent: () => state.current.present,
      setCheckpoint: (next, source) => {
        if (!latest.current.enabled) return
        const current = state.current
        const value = snapshot(next, current.present)
        if (sameContent(current.present, value)) {
          sync(value)
          return
        }
        state.current = {
          past: [...current.past, current.present],
          present: value,
          future: []
        }
        render()
        notify(value, source)
      },
      syncSilent: (next) => syncExternal(next),
      syncPresent: sync,
      reset: (next, source) => {
        state.current = { past: [], present: snapshot(next), future: [] }
        render()
        if (latest.current.enabled) notify(state.current.present, source)
      },
      applyTargetSilently,
      undo: () => run('undo'),
      redo: () => run('redo'),
      applyTarget: (source, apply) => {
        const result = run(source)
        if (result.applied) apply(result.target)
        return result
      }
    }
  }, [])
  return inherited ?? controller
}
