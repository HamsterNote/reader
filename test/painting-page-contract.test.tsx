import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
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

it('the official page surface displays saved objects with input disabled on first mount', () => {
  const controller = createEditor({
    schemaVersion: 3,
    documentRevision: 1,
    objects: [
      {
        kind: 'shape',
        objectId: 'saved-shape',
        objectRevision: 0,
        transformRevision: 0,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        shapeType: 'line',
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 }
        ],
        style: { color: '#d02080', width: 3, opacity: 1 }
      }
    ]
  })
  render(
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
  expect(
    screen
      .getByTestId('page-drawing-surface')
      .querySelector('[data-object-id="saved-shape"]')
  ).not.toBeNull()
})
