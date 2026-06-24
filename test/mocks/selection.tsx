import * as React from 'react'

export interface SelectionRange {
  id: string
  text: string
  start: number
  end: number
  createdAt: number
}

export interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MousePosition {
  x: number
  y: number
}

export interface SelectionRef {
  highlight: () => void
  clear: () => void
}

export interface SelectionProps {
  children: React.ReactNode
  ranges?: SelectionRange[]
  selectedRangeId?: string | null
  onSelect?: (range: SelectionRange) => void
  onSelectRange?: (id: string | null) => void
  onSelectionStart?: (mousePos: MousePosition, selection: Selection) => void
  onSelectionEnd?: (mousePos: MousePosition, selection: Selection) => void
  onHighlight?: (range: SelectionRange) => void
  highlightColor?: string
  selectionColor?: string
  className?: string
  popover?: React.ReactNode
}

export interface UseTextSelectionResult {
  selectedText: string
  startIndex: number
  endIndex: number
  hasSelection: boolean
  clear: () => void
}

const noop = () => {}

export const Selection = React.forwardRef<SelectionRef, SelectionProps>(
  ({ children }, ref) => {
    React.useImperativeHandle(ref, () => ({ highlight: noop, clear: noop }))
    return <>{children}</>
  }
)
Selection.displayName = 'Selection'

export function useTextSelection(): UseTextSelectionResult {
  return {
    selectedText: '',
    startIndex: 0,
    endIndex: 0,
    hasSelection: false,
    clear: noop
  }
}
