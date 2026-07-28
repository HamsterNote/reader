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
  const [geometryRevision, setGeometryRevision] = useState(0)

  useLayoutEffect(() => {
    void layoutDependency
    setGeometryRevision((revision) => revision + 1)
  }, [layoutDependency])

  useEffect(() => {
    void layoutDependency
    if (!root) return

    const observer = new ResizeObserver(() => {
      setGeometryRevision((revision) => revision + 1)
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
  }, [layoutDependency, root])

  return geometryRevision
}
