import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mockPaintingCanvas } from './fixtures/painting'

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
