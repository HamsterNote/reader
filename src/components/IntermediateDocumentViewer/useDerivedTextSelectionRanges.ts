import { useEffect, useLayoutEffect, useState } from 'react'

import type {
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange
} from '../../types/selection'
import { deriveTextSelectionRanges } from './textHighlightAdapter'

type UseDerivedTextSelectionRangesInput = {
  readonly ranges: readonly ReaderSelectionRange[]
  readonly root: HTMLElement | null
  readonly pageNumbers: readonly number[]
  readonly overlayRectType: ReaderSelectionOverlayRectType
  readonly layoutKey: string
}

export function useDerivedTextSelectionRanges({
  ranges,
  root,
  pageNumbers,
  overlayRectType,
  layoutKey
}: UseDerivedTextSelectionRangesInput): ReaderSelectionRange[] {
  useSelectionGeometryRevision(root, layoutKey)

  return deriveTextSelectionRanges({
    ranges,
    root,
    pageNumbers,
    overlayRectType
  })
}

export function useSelectionGeometryRevision(
  root: HTMLElement | null,
  layoutDependency: unknown
): number {
  const [geometryState, setGeometryState] = useState({
    layoutDependency,
    revision: 0
  })

  useLayoutEffect(() => {
    setGeometryState((current) =>
      Object.is(current.layoutDependency, layoutDependency)
        ? current
        : {
            layoutDependency,
            revision: current.revision + 1
          }
    )
  }, [layoutDependency])

  useEffect(() => {
    if (!root) return

    const observer = new ResizeObserver(() => {
      setGeometryState((current) => ({
        ...current,
        revision: current.revision + 1
      }))
    })
    observer.observe(root)
    root
      .querySelectorAll<HTMLElement>('.hsn-selection-container')
      .forEach((container) => {
        observer.observe(container)
      })
    return () => {
      observer.disconnect()
    }
  }, [root])

  return geometryState.revision
}
