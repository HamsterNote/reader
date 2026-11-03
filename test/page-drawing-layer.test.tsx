import { DrawingInputContext } from '../src/painting/DrawingInputContext'
import type {
  EditorDocument,
  LayeredEditorController
} from '@hamster-note/painting/core'
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

const editors = vi.hoisted(() => [] as LayeredEditorController[])
vi.mock('@hamster-note/painting/layered', async (original) => {
  const actual =
    await original<typeof import('@hamster-note/painting/layered')>()
  return {
    ...actual,
    createEditor: (...args: Parameters<typeof actual.createEditor>) => {
      const editor = actual.createEditor(...args)
      editors.push(editor)
      return editor
    }
  }
})
beforeEach(() => {
  editors.length = 0
})
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
    const nextPage = (
      <PageDrawingLayer
        enabled
        pageId='page-2'
        settings={createPaintingSettings('freehand', '#22aa33')}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    view.rerender(nextPage)
    expect(onChange).toHaveBeenCalledTimes(2)
    draw()
    expect(onChange.mock.lastCall?.[0].objects).toMatchObject([
      { brushSnapshot: { color: '#22aa33' } }
    ])
    view.unmount()
    render(nextPage)
    expect(onChange).toHaveBeenCalledTimes(3)
    draw()
    expect(onChange).toHaveBeenCalledTimes(4)
    expect(onChange.mock.lastCall?.[0].objects).toMatchObject([
      { brushSnapshot: { color: '#22aa33' } }
    ])
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

it.each(['line', 'rect', 'ellipse'] as const)(
  'commits one complete %s gesture and no move notifications',
  (tool) => {
    const onChange = vi.fn()
    render(
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={createPaintingSettings(tool)}
        geometry={pageGeometry}
        onChange={onChange}
      />
    )
    paintingPointer(surface(), 'down', 20, 30)
    paintingPointer(window, 'move', 40, 50)
    paintingPointer(window, 'move', 70, 80)
    expect(onChange).not.toHaveBeenCalled()
    paintingPointer(window, 'up', 90, 100)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.lastCall?.[0].objects).toHaveLength(1)
  }
)

it('edits an entire object, erases multiple objects, deletes, and clears as atomic public commands', () => {
  const value = drawingFixture({
    strokes: [
      {
        id: 'a',
        tool: 'line',
        points: [
          { x: 20, y: 30 },
          { x: 100, y: 30 }
        ]
      },
      {
        id: 'b',
        tool: 'line',
        points: [
          { x: 20, y: 60 },
          { x: 100, y: 60 }
        ]
      }
    ]
  })
  const onChange = vi.fn()
  render(
    <PageDrawingLayer
      enabled
      pageId='page-1'
      settings={settings}
      value={value}
      geometry={pageGeometry}
      onChange={onChange}
    />
  )
  const editor = editors.at(-1)!
  const commit = (edit: Parameters<typeof editor.editObjects>[0]) =>
    act(() => {
      const result = editor.editObjects(edit)
      if (!result.ok) throw new Error(JSON.stringify(result.error))
    })
  const a = value.objects[0]!
  const transformed = {
    ...a,
    transform: { ...a.transform, tx: a.transform.tx + 50 },
    objectRevision: a.objectRevision + 1,
    transformRevision: a.transformRevision + 1
  }
  commit({
    expectedDocumentRevision: editor.getSnapshot('document').documentRevision,
    upsert: [transformed]
  })
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange.mock.lastCall?.[0].objects[0]).toMatchObject({
    objectId: a.objectId,
    transform: transformed.transform
  })
  // One eraser transaction can remove multiple objects; no per-object checkpoints.
  commit({
    expectedDocumentRevision: editor.getSnapshot('document').documentRevision,
    removeIds: value.objects.map((o) => o.objectId)
  })
  expect(onChange).toHaveBeenCalledTimes(2)
  act(() => {
    editor.undo()
  })
  expect(editor.getSnapshot('document').objects).toEqual([
    transformed,
    value.objects[1]
  ])
  commit({
    expectedDocumentRevision: editor.getSnapshot('document').documentRevision,
    removeIds: [a.objectId]
  })
  const beforeClear = editor.getSnapshot('document')
  commit({
    expectedDocumentRevision: beforeClear.documentRevision,
    removeIds: beforeClear.objects.map((o) => o.objectId)
  })
  expect(editor.getSnapshot('document').objects).toHaveLength(0)
  act(() => {
    editor.undo()
  })
  expect(editor.getSnapshot('document').objects).toEqual(beforeClear.objects)
})

it('commits an eraser sweep once, and emits nothing for an empty or cancelled sweep', () => {
  const value = drawingFixture({
    strokes: [
      {
        id: 'a',
        tool: 'line',
        points: [
          { x: 20, y: 30 },
          { x: 100, y: 30 }
        ]
      },
      {
        id: 'b',
        tool: 'line',
        points: [
          { x: 20, y: 60 },
          { x: 100, y: 60 }
        ]
      }
    ]
  })
  const changed = vi.fn()
  render(
    <PageDrawingLayer
      enabled
      pageId='page-1'
      settings={createPaintingSettings('eraser')}
      value={value}
      geometry={pageGeometry}
      onChange={changed}
    />
  )
  paintingPointer(surface(), 'down', 40, 30)
  paintingPointer(window, 'move', 40, 60)
  expect(changed).not.toHaveBeenCalled()
  paintingPointer(window, 'cancel', 40, 60)
  expect(changed).not.toHaveBeenCalled()
  paintingPointer(surface(), 'down', 40, 30)
  paintingPointer(window, 'move', 40, 60)
  paintingPointer(window, 'up', 40, 60)
  expect(changed).toHaveBeenCalledTimes(1)
  expect(changed.mock.lastCall?.[0].objects).toHaveLength(0)
  paintingPointer(surface(), 'down', 300, 300)
  paintingPointer(window, 'up', 350, 350)
  expect(changed).toHaveBeenCalledTimes(1)
})

it('invalidates active input synchronously before replay, including a late pointerup', () => {
  const inputs = new Set<() => void>()
  const changed = vi.fn()
  render(
    <DrawingInputContext.Provider value={inputs}>
      <PageDrawingLayer
        enabled
        pageId='page-1'
        settings={settings}
        geometry={pageGeometry}
        onChange={changed}
      />
    </DrawingInputContext.Provider>
  )
  paintingPointer(surface(), 'down', 20, 30)
  paintingPointer(window, 'move', 40, 40)
  act(() => {
    for (const cancel of inputs) cancel()
  })
  paintingPointer(window, 'up', 60, 60)
  expect(changed).not.toHaveBeenCalled()
  draw()
  expect(changed).toHaveBeenCalledTimes(1)
  expect(changed.mock.lastCall?.[0].objects).toHaveLength(1)
})
