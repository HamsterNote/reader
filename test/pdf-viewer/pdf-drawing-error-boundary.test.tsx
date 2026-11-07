import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPaintingSettings } from '../../src/painting/paintingSettings'
import { PdfPageOverlayLayer } from '../../src/pdf/PdfPageOverlayLayer'

const drawing = vi.hoisted(() => ({ failure: null as Error | null }))

vi.mock('../../src/components/PageDrawingLayer', () => ({
  PageDrawingLayer: function PageDrawingLayer() {
    if (drawing.failure) throw drawing.failure
    return <div data-testid='drawing-surface'>Drawing surface</div>
  }
}))

const viewport = {
  scale: 1,
  convertToPdfPoint: (x: number, y: number) => [x, y],
  convertToViewportPoint: (x: number, y: number) => [x, y]
}

function renderOverlay() {
  return render(
    <PdfPageOverlayLayer
      pageNumber={1}
      pageDiv={document.createElement('div')}
      geometry={{
        viewport,
        scaleOneViewport: viewport,
        visual: { width: 400, height: 300 },
        drawing: null
      }}
      tool='drawing'
      overlayRectType='px'
      ranges={[]}
      rects={[]}
      painting={undefined}
      highlightColor='#ffc107'
      selectionContexts={new Map()}
      paintingSettings={createPaintingSettings()}
      onPaintingSettingsChange={vi.fn()}
      pagePaintings={{}}
    />
  )
}

afterEach(() => {
  drawing.failure = null
  vi.restoreAllMocks()
})

describe('PdfPageOverlayLayer drawing error boundary', () => {
  it('renders the drawing surface unchanged when healthy', () => {
    renderOverlay()

    expect(screen.getByTestId('drawing-surface')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows and logs the error message and component stack', () => {
    const failure = new Error('native canvas unavailable')
    drawing.failure = failure
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderOverlay()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'PDF 绘图层发生错误，请截图此信息'
    )
    expect(screen.getByTestId('pdf-drawing-error-message')).toHaveTextContent(
      failure.message
    )
    expect(screen.getByTestId('pdf-drawing-error-stack')).toHaveTextContent(
      'PageDrawingLayer'
    )
    expect(consoleError).toHaveBeenCalledWith(
      'PDF drawing layer render error',
      failure,
      expect.stringContaining('PageDrawingLayer')
    )
    expect(screen.queryByTestId('drawing-surface')).not.toBeInTheDocument()
  })
})
