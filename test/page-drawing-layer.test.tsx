import type { EditorDocument } from '@hamster-note/painting/core'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageDrawingLayer } from '../src/components/PageDrawingLayer'
import { DrawingDocumentContext } from '../src/painting/DrawingDocumentContext'
import { createPaintingSettings } from '../src/painting/paintingSettings'
import {
  drawingFixture,
  emptyDrawing,
  mockPaintingCanvas,
  pageGeometry,
  paintingPointer
} from './fixtures/painting'

beforeEach(mockPaintingCanvas)
afterEach(() => vi.restoreAllMocks())
const settings = createPaintingSettings()
const surface = () => screen.getByTestId('layered-surface')
const draw = (source = 'pen', id = 1) => {
  paintingPointer(surface(), 'down', 20, 30, source, id)
  paintingPointer(window, 'move', 40, 30, source, id)
  paintingPointer(window, 'up', 60, 30, source, id)
}

describe('PageDrawingLayer using the published library', () => {
  it('emits only committed new documents, once per touch stroke', () => {
    const onChange = vi.fn()
    render(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        value={emptyDrawing}
        onChange={onChange}
      />
    )
    paintingPointer(surface(), 'down', 20, 30, 'touch')
    paintingPointer(window, 'move', 40, 30, 'touch')
    expect(onChange).not.toHaveBeenCalled()
    paintingPointer(window, 'up', 60, 30, 'touch')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: 3,
      objects: [{ kind: 'freehand', brushSnapshot: { color: '#2563eb' } }]
    })
  })

  it('does not emit for controlled echoes or replacing a document', () => {
    const onChange = vi.fn()
    const view = render(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        value={emptyDrawing}
        onChange={onChange}
      />
    )
    draw()
    const document = onChange.mock.calls[0]?.[0] as EditorDocument
    view.rerender(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        value={JSON.parse(JSON.stringify(document))}
        onChange={onChange}
      />
    )
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(surface().querySelectorAll('[data-object-id]')).toHaveLength(1)
    view.rerender(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        value={emptyDrawing}
        onChange={onChange}
      />
    )
    expect(surface().querySelectorAll('[data-object-id]')).toHaveLength(0)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('freezes the down color and applies controlled color to the next stroke without recoloring history', () => {
    const onChange = vi.fn()
    const view = render(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={createPaintingSettings('freehand', '#cc1122')}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    paintingPointer(surface(), 'down', 20, 30)
    view.rerender(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={createPaintingSettings('freehand', '#22aa33')}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    paintingPointer(window, 'up', 60, 30)
    draw()
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(
      onChange.mock.lastCall?.[0].objects.map(
        (object: { brushSnapshot: { color: string } }) =>
          object.brushSnapshot.color
      )
    ).toEqual(['#cc1122', '#22aa33'])
  })

  it('cancels partial touch ink when a second finger joins', () => {
    const onChange = vi.fn()
    render(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    paintingPointer(surface(), 'down', 20, 30, 'touch', 1)
    paintingPointer(window, 'move', 40, 30, 'touch', 1)
    paintingPointer(surface(), 'down', 80, 90, 'touch', 2)
    paintingPointer(window, 'up', 60, 30, 'touch', 1)
    paintingPointer(window, 'up', 80, 90, 'touch', 2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('cancels pending input when disabled, changing tools or switching pages', () => {
    const onChange = vi.fn()
    const view = render(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    paintingPointer(surface(), 'down', 20, 30)
    view.rerender(
      <PageDrawingLayer
        enabled={false}
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    paintingPointer(window, 'up', 60, 30)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('reader-page-drawing-layer-page-1')).toHaveStyle({
      pointerEvents: 'none'
    })
    view.rerender(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    paintingPointer(surface(), 'down', 20, 30)
    view.rerender(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={createPaintingSettings('rect')}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    paintingPointer(window, 'up', 60, 30)
    expect(onChange).not.toHaveBeenCalled()
    view.rerender(
      <PageDrawingLayer
        enabled
        pageId='page-2'
        settings={settings}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    draw()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.lastCall?.[0].objects).toHaveLength(1)
  })

  it('scopes uncontrolled page controllers to document identity and releases old subscriptions', () => {
    const onChange = vi.fn()
    const first = {},
      second = {}
    const view = render(
      <DrawingDocumentContext.Provider value={first}>
        <PageDrawingLayer
          enabled
          pageId='page-1'
          settings={settings}
          geometry={pageGeometry}
          onChange={onChange}
        />
      </DrawingDocumentContext.Provider>
    )
    draw()
    paintingPointer(surface(), 'down', 20, 30)
    view.rerender(
      <DrawingDocumentContext.Provider value={second}>
        <PageDrawingLayer
          enabled
          pageId='page-1'
          settings={settings}
          geometry={pageGeometry}
          onChange={onChange}
        />
      </DrawingDocumentContext.Provider>
    )
    paintingPointer(window, 'up', 60, 30)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(surface().querySelectorAll('[data-object-id]')).toHaveLength(0)
    draw()
    expect(onChange.mock.lastCall?.[0].objects).toHaveLength(1)
    act(() => view.unmount())
    paintingPointer(window, 'up', 100, 100)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('reports invalid new data instead of dropping objects or saving an empty page', () => {
    const onChange = vi.fn()
    const invalid = {
      schemaVersion: 99,
      objects: []
    } as unknown as EditorDocument
    render(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        value={invalid}
        onChange={onChange}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('绘图数据无法恢复')
    expect(screen.queryByTestId('layered-surface')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('retains all objects and fields without the retired truncation sanitizer', () => {
    const value = drawingFixture({
      strokes: Array.from({ length: 501 }, (_, index) => ({
        id: `line-${index}`,
        tool: 'line',
        points: [
          { x: index, y: 20 },
          { x: index + 1, y: 30 }
        ]
      }))
    })
    render(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        value={value}
      />
    )
    expect(surface().querySelectorAll('[data-object-id]')).toHaveLength(501)
  })
})
