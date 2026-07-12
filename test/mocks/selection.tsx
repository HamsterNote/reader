import * as React from 'react'

export type OverlayRectType = 'px' | 'percent'

export type SelectionTool = 'text' | 'rect'

export interface SelectionRectPoint {
  x: number
  y: number
}

export interface SelectionRect {
  id: string
  createdAt: number
  overlayRectType: OverlayRectType
  start: SelectionRectPoint
  end: SelectionRectPoint
  rect: OverlayRect | PercentOverlayRect
  selectionId?: string
  markerStyle?: React.CSSProperties
  selectionStyle?: React.CSSProperties
}

export interface SelectionRange {
  id: string
  text: string
  start: number
  end: number
  createdAt: number
  overlayRectType?: OverlayRectType
  rects?: OverlayRect[] | PercentOverlayRect[]
}

export interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PercentOverlayRect {
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
  confirm: () => void
  confirmRect: () => void
  clear: () => void
}

export type SelectionEndpoint = {
  selectionId: string
  offset: number
}

export type LinkedSelectionRange = {
  id: string
  text: string
  start: SelectionEndpoint
  end: SelectionEndpoint
  createdAt: number
  overlayRectType?: OverlayRectType
  rectsBySelectionId: Record<string, OverlayRect[] | PercentOverlayRect[]>
  markerStyle?: React.CSSProperties
  selectionStyle?: React.CSSProperties
}

export type LinkedSelectionDragState =
  | { type: 'active-selection' }
  | { type: 'persisted-range'; id: string }

export type LinkedSelectionData = {
  items: LinkedSelectionRange[]
  selectedRangeId: string | null
  selectionOrder: string[]
  overlayRectType?: OverlayRectType
  draggingRange?: LinkedSelectionDragState | null
  selectingText?: boolean
  activeRange?: LinkedSelectionRange | null
}

export interface SelectionProps {
  children: React.ReactNode
  selectionId?: string
  linkedMode?: boolean
  linkedData?: LinkedSelectionData
  onLinkedDataChange?: (next: LinkedSelectionData) => void
  onLinkedSelect?: (range: LinkedSelectionRange) => void
  onLinkedUpdateRange?: (range: LinkedSelectionRange) => void
  onLinkedSelectRange?: (id: string | null) => void
  ranges?: SelectionRange[]
  selectedRangeId?: string | null
  onSelect?: (range: SelectionRange) => void
  onSelectRange?: (id: string | null) => void
  onUpdateRange?: (range: SelectionRange) => void
  onSelectionStart?: (mousePos: MousePosition, selection: Selection) => void
  onSelectionEnd?: (mousePos: MousePosition, selection: Selection) => void
  onHighlight?: (range: SelectionRange) => void
  highlightColor?: string
  selectionColor?: string
  className?: string
  popover?: React.ReactNode
  selectionPopover?: React.ReactNode
  overlayRectType?: OverlayRectType
  tool?: SelectionTool
  rects?: SelectionRect[]
  selectedRectId?: string | null
  onCreateRect?: (rect: SelectionRect) => void
  onSelectRect?: (id: string | null) => void
  onUpdateRect?: (rect: SelectionRect) => void
}

export let lastSelectionProps: SelectionProps | null = null

const selectionPropsById = new Map<string, SelectionProps>()
const selectionRefsById = new Map<string, SelectionRef>()
const selectionRefCallCountsById = new Map<
  string,
  { highlight: number; confirm: number; confirmRect: number; clear: number }
>()

const mockedRange: SelectionRange = {
  id: 'highlight-id',
  text: 'Mocked highlight',
  start: 0,
  end: 10,
  createdAt: 123456789
}

function shouldTrackLinkedProps(
  props: SelectionProps
): props is SelectionProps & {
  selectionId: string
} {
  return props.linkedMode === true && typeof props.selectionId === 'string'
}

export function getLastSelectionProps(): SelectionProps | null {
  return lastSelectionProps
}

export function clearLastSelectionProps(): void {
  lastSelectionProps = null
}

export function getSelectionPropsById(id: string): SelectionProps | undefined {
  return selectionPropsById.get(id)
}

export function getAllSelectionProps(): SelectionProps[] {
  return Array.from(selectionPropsById.values())
}

export function clearSelectionProps(): void {
  selectionPropsById.clear()
  selectionRefsById.clear()
  selectionRefCallCountsById.clear()
  clearLastSelectionProps()
}

export function getSelectionRefCallCounts(id: string): {
  highlight: number
  confirm: number
  confirmRect: number
  clear: number
} {
  return (
    selectionRefCallCountsById.get(id) ?? {
      highlight: 0,
      confirm: 0,
      confirmRect: 0,
      clear: 0
    }
  )
}

function countSelectionRefCall(
  id: string | undefined,
  method: 'highlight' | 'confirm' | 'confirmRect' | 'clear'
): void {
  if (!id) return

  const current = selectionRefCallCountsById.get(id) ?? {
    highlight: 0,
    confirm: 0,
    confirmRect: 0,
    clear: 0
  }
  selectionRefCallCountsById.set(id, {
    ...current,
    [method]: current[method] + 1
  })
}

export function simulateLinkedDataChange(
  id: string,
  next: LinkedSelectionData
): void {
  selectionPropsById.get(id)?.onLinkedDataChange?.(next)
}

export function simulateLinkedSelect(
  id: string,
  range: LinkedSelectionRange
): void {
  selectionPropsById.get(id)?.onLinkedSelect?.(range)
}

export function simulateLinkedUpdateRange(
  id: string,
  range: LinkedSelectionRange
): void {
  selectionPropsById.get(id)?.onLinkedUpdateRange?.(range)
}

export function simulateLinkedSelectRange(
  id: string,
  rangeId: string | null
): void {
  selectionPropsById.get(id)?.onLinkedSelectRange?.(rangeId)
}

export function simulateSelectionHighlight(id: string): void {
  selectionRefsById.get(id)?.highlight()
}

export function simulateSelectionConfirm(id: string): void {
  selectionRefsById.get(id)?.confirm()
}

export function simulateSelectionConfirmRect(id: string): void {
  selectionRefsById.get(id)?.confirmRect()
}

export function simulateSelectionClear(id: string): void {
  selectionRefsById.get(id)?.clear()
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
  (props, ref) => {
    lastSelectionProps = props
    const selectionRef = React.useMemo<SelectionRef>(
      () => ({
        highlight: () => {
          countSelectionRefCall(props.selectionId, 'highlight')
          props.onSelect?.(mockedRange)
          props.onHighlight?.(mockedRange)
        },
        confirm: () => {
          countSelectionRefCall(props.selectionId, 'confirm')
          if (props.tool === 'rect') {
            selectionRef.confirmRect()
          } else {
            selectionRef.highlight()
          }
        },
        confirmRect: () => {
          countSelectionRefCall(props.selectionId, 'confirmRect')
          const mockedRect: SelectionRect = {
            id: 'rect-highlight-id',
            createdAt: Date.now(),
            overlayRectType: props.overlayRectType ?? 'percent',
            start: { x: 0, y: 0 },
            end: { x: 100, y: 100 },
            rect: { x: 0, y: 0, width: 100, height: 100 }
          }
          props.onCreateRect?.(mockedRect)
        },
        clear: () => {
          countSelectionRefCall(props.selectionId, 'clear')
          globalThis.window.getSelection()?.removeAllRanges()
        }
      }),
      [props]
    )
    React.useImperativeHandle(ref, () => selectionRef, [selectionRef])

    React.useEffect(() => {
      if (!shouldTrackLinkedProps(props)) return undefined

      selectionPropsById.set(props.selectionId, props)
      selectionRefsById.set(props.selectionId, selectionRef)

      return () => {
        selectionPropsById.delete(props.selectionId)
        selectionRefsById.delete(props.selectionId)
      }
    }, [props, selectionRef])

    const className = props.className
      ? `hsn-selection-container ${props.className}`
      : 'hsn-selection-container'

    return (
      <div
        className={className}
        data-linked-mode={props.linkedMode ? 'true' : undefined}
        data-selection-id={props.selectionId}
      >
        <div className='hsn-selection-content'>{props.children}</div>
      </div>
    )
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
