import type { ComponentPropsWithRef } from 'react'
import {
  HANDLE_CIRCLE_DIAMETER_PX,
  rangeHandleCircleStyle
} from './IntermediateDocumentViewer/RangeHandle'

/** Fixed portal coordinates are screen pixels: PDF viewport scale is already removed. */
export function PdfTouchSelectionHandle({
  end = false,
  color = '#ffc107',
  style,
  ...props
}: ComponentPropsWithRef<'button'> & { end?: boolean; color?: string }) {
  const diameter = HANDLE_CIRCLE_DIAMETER_PX
  const hitSize = diameter * 2
  return (
    <button
      type='button'
      tabIndex={-1}
      {...props}
      data-pdf-handle-hit-target={end ? 'end' : 'start'}
      style={{
        ...style,
        width: hitSize,
        height: hitSize,
        transform: 'translate(-50%, -50%)',
        background: 'transparent',
        border: 0,
        padding: 0,
        boxShadow: 'none',
        borderRadius: 0,
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none'
      }}
    >
      <span
        aria-hidden='true'
        data-pdf-handle-visual='true'
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))'
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: hitSize / 2 - 1,
            top: end ? -2 : 28,
            width: 2,
            height: 12,
            backgroundColor: rangeHandleCircleStyle({ backgroundColor: color })
              .backgroundColor
          }}
        />
        <span
          data-range-handle-circle={end ? 'end' : 'start'}
          style={rangeHandleCircleStyle({
            position: 'absolute',
            left: hitSize / 2,
            top: hitSize / 2,
            backgroundColor: color,
            border: '2px solid white',
            boxSizing: 'border-box',
            pointerEvents: 'none'
          })}
        />
      </span>
    </button>
  )
}
