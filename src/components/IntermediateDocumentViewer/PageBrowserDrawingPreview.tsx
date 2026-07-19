import type { DrawingValue } from '@hamster-note/painting'
import { useEffect, useRef } from 'react'
import { PageDrawingLayer } from '../PageDrawingLayer'

type PageBrowserDrawingPreviewProps = {
  readonly pageId: string
  readonly pageSize: { readonly width: number; readonly height: number }
  readonly value: DrawingValue
  readonly style: React.CSSProperties
}

/**
 * 复用正式页面的 DrawingSurface，并为其 SVG 补上页面坐标系 viewBox。
 * 这样绘制笔迹会和底图按完全相同的几何比例缩放、裁切，无需生成异步截图。
 */
export function PageBrowserDrawingPreview({
  pageId,
  pageSize,
  value,
  style
}: PageBrowserDrawingPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const svg = rootRef.current?.querySelector('svg')
    if (!svg) return

    svg.setAttribute('viewBox', `0 0 ${pageSize.width} ${pageSize.height}`)
    svg.setAttribute('preserveAspectRatio', 'none')
  }, [pageSize.height, pageSize.width])

  return (
    <span
      ref={rootRef}
      className='hamster-reader__highlight-rect-drawing'
      style={style}
      aria-hidden='true'
      data-testid={`page-browser-rect-drawing-${pageId}`}
    >
      <PageDrawingLayer
        enabled={false}
        pageId={`preview-${pageId}`}
        value={value}
      />
    </span>
  )
}
