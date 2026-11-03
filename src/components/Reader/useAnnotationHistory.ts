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
const sameContent = (
  a: ReaderAnnotationHistoryValue,
  b: ReaderAnnotationHistoryValue
) =>
  JSON.stringify(a.ranges) === JSON.stringify(b.ranges) &&
  JSON.stringify(a.rects) === JSON.stringify(b.rects) &&
  paintingContentKey(a.pagePaintings) === paintingContentKey(b.pagePaintings)
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
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
      syncSilent: (next) => sync(next),
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
