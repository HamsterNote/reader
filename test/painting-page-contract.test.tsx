import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  emptyDrawing,
  mockPaintingCanvas,
  pageGeometry,
  paintingPointer
} from './fixtures/painting'
import { PageDrawingLayer } from '../src/components/PageDrawingLayer'

afterEach(() => vi.restoreAllMocks())
import { migrateLegacyDocument } from '@hamster-note/painting/core'
import {
  createEditor,
  PageDrawingSurface
} from '@hamster-note/painting/layered'

it.each([
  { dashOffset: 'broken' },
  { fillOpacity: 2 },
  { rotationRad: 'broken' }
])(
  'the released migrator rejects mixed input containing %j without changing its source',
  (style) => {
    const pen = {
      id: 'valid',
      tool: 'pen',
      width: 3,
      points: [{ x: 10, y: 20 }]
    }
    const input = { strokes: [pen, { ...pen, id: 'broken', ...style }] }
    const original = structuredClone(input)
    expect(migrateLegacyDocument(input).ok).toBe(false)
    expect(input).toEqual(original)
  }
)

it('the released migrator accepts a valid pen', () => {
  expect(
    migrateLegacyDocument({
      strokes: [
        { id: 'valid', tool: 'pen', width: 3, points: [{ x: 10, y: 20 }] }
      ]
    }).ok
  ).toBe(true)
})

it('the official page surface displays complete saved history on disabled first mount and remount', async () => {
  mockPaintingCanvas()
  const migrated = migrateLegacyDocument({
    strokes: [
      {
        id: 'saved-ink',
        tool: 'pen',
        width: 3,
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 }
        ]
      },
      {
        id: 'saved-shape',
        tool: 'line',
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 }
        ]
      },
      {
        id: 'saved-text',
        tool: 'text',
        text: 'Saved annotation',
        points: [
          { x: 10, y: 50 },
          { x: 200, y: 80 }
        ]
      },
      {
        id: 'saved-image',
        tool: 'image',
        src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
        points: [
          { x: 10, y: 90 },
          { x: 50, y: 130 }
        ]
      }
    ]
  })
  if (!migrated.ok) throw new Error(migrated.error.path)
  const controller = createEditor(migrated.value)
  const element = (
    <PageDrawingSurface
      pageId='page-1'
      controller={controller}
      enabled={false}
      geometry={{
        width: 600,
        height: 800,
        pageToSurface: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
      }}
    />
  )
  const expected = migrated.value.objects
    .map((object) => object.objectId)
    .sort()
  const expectCompleteHistory = () => {
    const nodes = screen
      .getByTestId('page-drawing-surface')
      .querySelectorAll('[data-object-id]')
    expect(
      [
        ...new Set(
          Array.from(nodes, (node) => node.getAttribute('data-object-id'))
        )
      ].sort()
    ).toEqual(expected)
    expect(controller.getSnapshot('document')).toEqual(migrated.value)
  }
  let first: ReturnType<typeof render> | undefined
  await act(async () => {
    first = render(element)
  })
  expectCompleteHistory()
  await act(async () => {
    first?.unmount()
  })
  await act(async () => {
    render(element)
  })
  expectCompleteHistory()
})

it.each(['keyboard', 'button'] as const)(
  'disabling a reader text draft prevents %s persistence across remounts',
  (submit) => {
    mockPaintingCanvas()
    const settings = {
      ...createEditor(emptyDrawing).getSnapshot('tools'),
      activeTool: 'text' as const
    }
    let saved = emptyDrawing
    const onChange = vi.fn((document: typeof emptyDrawing) => {
      saved = document
    })
    const surface = (enabled: boolean, key = 'initial') => (
      <PageDrawingLayer
        key={key}
        pageId='page-1'
        enabled={enabled}
        geometry={pageGeometry}
        settings={settings}
        value={saved}
        onChange={onChange}
      />
    )
    const view = render(surface(true))
    const beginText = () => {
      const target = screen.getByTestId('layered-surface')
      paintingPointer(target, 'down', 40, 50, 'mouse')
      paintingPointer(target, 'up', 40, 50, 'mouse')
      return screen.getByRole('textbox', { name: '文字内容' })
    }
    const draft = beginText()
    fireEvent.change(draft, { target: { value: 'Discard this draft' } })
    const button = screen.getByRole('button', { name: '完成' })
    view.rerender(surface(false))
    if (submit === 'keyboard') {
      fireEvent.keyDown(draft, { key: 'Enter', ctrlKey: true })
    } else {
      fireEvent.click(button)
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(saved.objects).toHaveLength(0)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(view.container.querySelector('foreignObject')).toBeNull()

    view.rerender(surface(false, 'remounted'))
    expect(onChange).not.toHaveBeenCalled()
    expect(saved.objects).toHaveLength(0)
    view.rerender(surface(true, 'remounted'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.change(beginText(), { target: { value: 'New valid text' } })
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(saved.objects).toHaveLength(1)
    expect(saved.objects[0]).toMatchObject({
      kind: 'text',
      content: 'New valid text'
    })
    view.rerender(surface(false, 'saved-remount'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(saved.objects).toHaveLength(1)
    expect(view.container.querySelector('[data-object-id]')).toBeInTheDocument()
  }
)
