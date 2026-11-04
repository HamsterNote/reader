import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type {
  ReaderTextAnchor,
  ReaderTextReadingProgress
} from '../types/readerData'
import { buttonOnlyInput } from '../components/reading/buttonOnlyInput'
import {
  measurePdfTextColumns,
  pdfTextAnchorColumn,
  pdfTextTurnTarget,
  type PdfTextColumn
} from './pdfTextPagination'

type Target = {
  pageNumber: number
  anchor?: ReaderTextAnchor
  verticalPercentage?: number
  column?: number
  last?: boolean
  publish: boolean
  token: number
}
type Snapshot = {
  generation: number
  target: Target
  columns: PdfTextColumn[]
  column: number
  busy: boolean
  ready: boolean
  revision: number
  unlocatable: boolean
}

function restoredPdfAnchor(
  restore: ReaderTextAnchor | undefined,
  restoredColumn: number | null,
  visible: PdfTextColumn,
  unlocatable: boolean
) {
  if (unlocatable) return restore
  return restore && restoredColumn === visible.index ? restore : visible.anchor
}

/** PDF-only layout lifecycle. The viewer owns loading, selection and public progress. */
export function usePdfTextPagination(options: {
  enabled: boolean
  generation: number
  root: HTMLElement | null
  pages: readonly number[]
  progress?: ReaderTextReadingProgress
  loaded: ReadonlyMap<number, unknown>
  errors: ReadonlySet<number>
  width: number
  height: number
  layoutKey: unknown
  enqueue: (page: number) => void
  onCommit: (progress: ReaderTextReadingProgress, publish: boolean) => void
  onTurn: (preserveSelected?: boolean) => void
}) {
  const {
    enabled,
    generation,
    root,
    pages,
    progress,
    loaded,
    errors,
    width,
    height,
    layoutKey
  } = options
  const values = useRef(options)
  values.current = options
  const serial = useRef(0)
  const initial = (): Snapshot => ({
    generation,
    target: {
      pageNumber:
        progress && pages.includes(progress.currentPageNumber)
          ? progress.currentPageNumber
          : (pages[0] ?? 0),
      anchor:
        progress &&
        pages.includes(progress.currentPageNumber) &&
        progress.anchor?.pageNumber === progress.currentPageNumber
          ? progress.anchor
          : undefined,
      verticalPercentage: progress?.anchor
        ? undefined
        : progress?.verticalPercentage,
      publish: false,
      token: serial.current
    },
    columns: [{ index: 0 }],
    column: 0,
    busy: true,
    ready: false,
    revision: 0,
    unlocatable: false
  })
  const [state, setState] = useState(initial)
  const committed = useRef<ReaderTextReadingProgress | undefined>(progress)
  const gate = useRef(false)
  const committedToken = useRef(-1)
  const stableWaiters = useRef(
    new Set<{ resolve: () => void; reject: (error: Error) => void }>()
  )
  useLayoutEffect(
    () => () => {
      for (const waiter of stableWaiters.current) waiter.resolve()
      stableWaiters.current.clear()
    },
    [generation]
  )
  // Invalidate during render so old effects cannot commit into a new document.
  const scope = useRef(generation)
  if (scope.current !== generation) {
    scope.current = generation
    committed.current = progress
    gate.current = false
  }
  const current = state.generation === generation ? state : initial()
  useLayoutEffect(() => {
    if (state.generation !== generation) setState(initial())
    // The generation owns the initial target, not subsequent prop echoes.
  }, [generation])

  const navigate = useCallback(
    (
      pageNumber: number,
      anchor?: ReaderTextAnchor,
      publish = true,
      preserveSelected = false,
      verticalPercentage?: number
    ) => {
      if (!values.current.enabled || !values.current.pages.includes(pageNumber))
        return
      gate.current = true
      values.current.onTurn(preserveSelected)
      // React may replay state initializers/updaters in StrictMode. Allocate
      // navigation tokens once per request, outside those pure functions.
      const target = {
        pageNumber,
        anchor,
        verticalPercentage,
        publish,
        token: ++serial.current
      }
      setState((previous) => ({
        ...previous,
        generation: values.current.generation,
        target,
        busy: true,
        ready: false
      }))
    },
    []
  )
  const echo = useRef(progress)
  useLayoutEffect(() => {
    if (!enabled || echo.current === progress) return
    echo.current = progress
    if (
      !progress ||
      JSON.stringify(progress) === JSON.stringify(committed.current)
    )
      return
    navigate(
      progress.currentPageNumber,
      progress.anchor,
      false,
      false,
      progress.verticalPercentage
    )
  }, [enabled, progress, navigate])

  const target = current.target
  useLayoutEffect(() => {
    if (!enabled || !root || !pages.length || state.generation !== generation)
      return
    const token = target.token
    let cancelled = false
    let frame = 0
    const valid = () =>
      !cancelled && scope.current === generation && serial.current === token
    if (!loaded.has(target.pageNumber)) {
      if (!errors.has(target.pageNumber))
        values.current.enqueue(target.pageNumber)
      return
    }
    const content = root.querySelector<HTMLElement>('.hsn-selection-content')
    if (width <= 0 || height <= 0) {
      gate.current = true
      setState((previous) =>
        previous.busy ? previous : { ...previous, busy: true }
      )
      return
    }
    gate.current = true
    setState((previous) =>
      previous.busy ? previous : { ...previous, busy: true }
    )
    const layout = () => {
      if (
        !valid() ||
        root.getBoundingClientRect().width <= 0 ||
        root.getBoundingClientRect().height <= 0
      )
        return
      // Keep the last confirmed source anchor through any number of resize events.
      const restore =
        target.anchor ??
        (committedToken.current === token &&
        committed.current?.currentPageNumber === target.pageNumber
          ? committed.current.anchor
          : undefined)
      const columns = content
        ? measurePdfTextColumns(content, target.pageNumber, width)
        : [{ index: 0 }]
      const restoredColumn =
        restore && content ? pdfTextAnchorColumn(content, restore, width) : null
      const ratioColumn =
        target.verticalPercentage === undefined
          ? undefined
          : columns[
              Math.round(
                (Math.max(0, Math.min(100, target.verticalPercentage)) / 100) *
                  (columns.length - 1)
              )
            ]?.index
      const column =
        target.last && committedToken.current !== token
          ? columns.at(-1)!.index
          : (restoredColumn ?? target.column ?? ratioColumn ?? 0)
      const visible =
        columns.find((item) => item.index === column) ?? columns[0]
      if (content)
        content.style.transform = `translateX(${-visible.index * (width + 24)}px)`
      const unlocatable = Boolean(restore && content && restoredColumn === null)
      const anchor = restoredPdfAnchor(
        restore,
        restoredColumn,
        visible,
        unlocatable
      )
      const fallbackPosition = {
        verticalPercentage: target.verticalPercentage ?? 0
      }
      const next: ReaderTextReadingProgress = {
        currentPageNumber: target.pageNumber,
        ...(anchor ? { anchor } : fallbackPosition)
      }
      committed.current = next
      committedToken.current = token
      gate.current = false
      setState((previous) => ({
        ...previous,
        column: visible.index,
        columns,
        busy: false,
        ready: true,
        revision: previous.revision + 1,
        unlocatable
      }))
      values.current.onCommit(next, target.publish && !unlocatable)
    }
    const schedule = () => {
      if (valid()) {
        gate.current = true
        setState((previous) =>
          previous.busy ? previous : { ...previous, busy: true }
        )
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(layout)
      }
    }
    schedule()
    const fonts = root.ownerDocument.fonts
    fonts?.ready.then(schedule).catch(() => undefined)
    fonts?.addEventListener('loadingdone', schedule)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      fonts?.removeEventListener('loadingdone', schedule)
    }
  }, [
    enabled,
    root,
    pages.length,
    generation,
    state.generation,
    target,
    loaded,
    errors,
    width,
    height,
    layoutKey
  ])

  useLayoutEffect(() => {
    if (!enabled || !root) return
    const clearInput = buttonOnlyInput(
      root,
      (event) =>
        !(event.target as Element | null)?.closest?.(
          '[role="dialog"], [role="complementary"], .hsn-selection-popover, .hamster-reader__viewport-pagination'
        )
    )
    // CSS overflow:clip prevents the browser's native selection auto-scroll too.
    return clearInput
  }, [enabled, root])

  const turn = useCallback(
    (forward: boolean) => {
      if (
        gate.current ||
        state.busy ||
        !state.ready ||
        state.generation !== values.current.generation
      )
        return
      const next = pdfTextTurnTarget(
        values.current.pages,
        state.target.pageNumber,
        state.column,
        state.columns,
        forward
      )
      if (!next) return
      gate.current = true
      values.current.onTurn()
      const target = { ...next, publish: true, token: ++serial.current }
      setState((previous) => ({
        ...previous,
        target,
        busy: true,
        ready: false
      }))
    },
    [state]
  )
  useLayoutEffect(() => {
    const failed = errors.has(target.pageNumber)
    if (!failed && (current.busy || !current.ready || gate.current)) return
    for (const waiter of stableWaiters.current) {
      if (failed) waiter.reject(new Error('阅读页加载失败，保存未确认，请重试'))
      else waiter.resolve()
    }
    stableWaiters.current.clear()
  }, [current.busy, current.ready, errors, target.pageNumber])
  return {
    pageNumber: target.pageNumber,
    column: current.column,
    revision: current.revision,
    ready: current.ready,
    unlocatable: current.unlocatable,
    navigation: {
      busy: current.busy,
      canPrevious: !!pdfTextTurnTarget(
        pages,
        target.pageNumber,
        current.column,
        current.columns,
        false
      ),
      canNext: !!pdfTextTurnTarget(
        pages,
        target.pageNumber,
        current.column,
        current.columns,
        true
      )
    },
    navigate,
    turn,
    whenStable: () => {
      if (errors.has(target.pageNumber))
        return Promise.reject(new Error('阅读页加载失败，保存未确认，请重试'))
      if (!gate.current && current.ready && !current.busy)
        return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        stableWaiters.current.add({ resolve, reject })
      })
    },
    capture: () => committed.current?.anchor,
    capturePosition: () => {
      if (!current.ready || gate.current) return undefined
      const anchor = current.columns.find(
        (item) => item.index === current.column
      )?.anchor
      return (
        anchor ??
        (committed.current
          ? {
              pageNumber: committed.current.currentPageNumber,
              verticalPercentage: committed.current.verticalPercentage ?? 0
            }
          : undefined)
      )
    }
  }
}
