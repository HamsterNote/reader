import type {
  HandleRenderProps,
  LinkedSelectionData
} from '@hamster-note/selection'
import { RangeHandle } from '../components/IntermediateDocumentViewer/RangeHandle'
import { pdfTextAnchorColumn } from './pdfTextPagination'

/** A clipped range must not make an offscreen source endpoint editable at the
 * edge of the visible column. Keep PDF source offsets and delegate the drag. */
export function PdfTextHandle({
  handle,
  linkedData,
  root,
  selectionId,
  pageNumber,
  width,
  column,
  magnifierEnabled
}: {
  handle: HandleRenderProps
  linkedData: LinkedSelectionData
  root: HTMLElement | null
  selectionId: string
  pageNumber: number
  width: number
  column: number
  magnifierEnabled: boolean
}) {
  const range =
    handle.owner === 'active-selection'
      ? linkedData.activeRange
      : linkedData.items.find((item) => item.id === handle.rangeId)
  const endpoint = handle.type === 'start' ? range?.start : range?.end
  const content = root?.querySelector<HTMLElement>('.hsn-selection-content')
  if (!endpoint || endpoint.selectionId !== selectionId || !content) return null
  const offset =
    handle.type === 'end' ? Math.max(0, endpoint.offset - 1) : endpoint.offset
  if (
    pdfTextAnchorColumn(
      content,
      { pageNumber, textId: '', text: '', offset },
      width
    ) !== column
  )
    return null
  return (
    <RangeHandle
      handle={handle}
      linkedData={linkedData}
      scale={1}
      selectionId={selectionId}
      viewerRoot={root}
      magnifierEnabled={magnifierEnabled}
    />
  )
}
