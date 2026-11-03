import type { EditorDocument } from '@hamster-note/painting/core'
import type { CSSProperties } from 'react'
import { PageDrawingLayer } from '../PageDrawingLayer'
import { createPaintingSettings } from '../../painting/paintingSettings'

const PREVIEW_SETTINGS = createPaintingSettings()

export function PageBrowserDrawingPreview({
  pageId,
  pageSize,
  value,
  style
}: {
  readonly pageId: string
  readonly pageSize: { readonly width: number; readonly height: number }
  readonly value: EditorDocument
  readonly style: CSSProperties
}) {
  return (
    <span
      className='hamster-reader__highlight-rect-drawing'
      style={style}
      aria-hidden='true'
      data-testid={`page-browser-rect-drawing-${pageId}`}
    >
      <PageDrawingLayer
        enabled={false}
        pageId={`preview-${pageId}`}
        settings={PREVIEW_SETTINGS}
        value={value}
        pageSize={pageSize}
      />
    </span>
  )
}
