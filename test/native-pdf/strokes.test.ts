import { describe, expect, it } from 'vitest'
import type { EditorDocument } from '@hamster-note/painting/core'
import { createNativeAnnotationController } from '../../src/nativePdf/annotationController'
import { nativePageLayout } from '../../src/nativePdf/geometry'
import { readLayeredDocument } from '@hamster-note/painting/core'
import {
  appendStrokeDocument,
  inkObjectsForNative,
  paintingPageId
} from '../../src/nativePdf/strokes'
import type { PdfPoint } from '../../src/nativePdf/contracts'

const stroke = (
  pageId: string,
  points: PdfPoint[],
  commitId: string,
  previous?: ReturnType<typeof appendStrokeDocument> | undefined
) => {
  const document = appendStrokeDocument(
    previous ?? undefined,
    commitId,
    points,
    {
      time: 1
    }
  )
  if (!document) throw new Error('stroke rejected')
  return { pageId, document }
}

/**
 * Mirrors `ReaderPdfViewport.scrollPoint` / `contentPoint(at:)`
 * (app/modules/reader-pdf/ios/ReaderPdfGeometry.swift). Production conversion
 * lives in Swift; this oracle exists so the page-local anchor invariant can be
 * executed on Linux, and the same numbers run there through
 * `scripts/test-native-pdf-geometry.sh`.
 */
function contentPoint(
  viewportPoint: PdfPoint,
  scale: number,
  origin: PdfPoint,
  offset: PdfPoint
): PdfPoint {
  return {
    x: (viewportPoint.x + offset.x - origin.x) / scale,
    y: (viewportPoint.y + offset.y - origin.y) / scale
  }
}

function scrollPoint(
  point: PdfPoint,
  scale: number,
  origin: PdfPoint,
  offset: PdfPoint
): PdfPoint {
  return {
    x: origin.x + point.x * scale - offset.x,
    y: origin.y + point.y * scale - offset.y
  }
}

describe('native freehand strokes', () => {
  it('keeps multiple strokes in commit order through one shared history', () => {
    const controller = createNativeAnnotationController()
    const pageId = paintingPageId(2)
    const ids = ['s1', 's2', 's3']
    let previous: EditorDocument | undefined
    for (const [index, id] of ids.entries()) {
      const { document } = stroke(
        pageId,
        [
          { x: 10 + index * 10, y: 20 },
          { x: 30 + index * 10, y: 40 },
          { x: 50 + index * 10, y: 20 }
        ],
        id,
        previous
      )
      previous = document
      expect(controller.setPainting(id, pageId, document).status).toBe(
        'changed'
      )
    }
    const objects =
      controller.getSnapshot().pagePaintings[pageId]?.objects ?? []
    expect(objects.map((object) => object.objectId)).toEqual(ids)
    expect(
      inkObjectsForNative(controller.getSnapshot().pagePaintings)
    ).toHaveLength(3)

    expect(controller.undo()).toBe(true)
    expect(controller.undo()).toBe(true)
    const remaining =
      controller.getSnapshot().pagePaintings[pageId]?.objects ?? []
    expect(remaining.map((object) => object.objectId)).toEqual(['s1'])
    expect(
      inkObjectsForNative(controller.getSnapshot().pagePaintings)
    ).toHaveLength(1)

    expect(controller.redo()).toBe(true)
    expect(
      controller
        .getSnapshot()
        .pagePaintings[pageId]?.objects.map((o) => o.objectId)
    ).toEqual(['s1', 's2'])
  })

  it('drops the redo branch once a new stroke is drawn after undo', () => {
    const controller = createNativeAnnotationController()
    const pageId = paintingPageId(1)
    const first = stroke(
      pageId,
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ],
      's1'
    )
    controller.setPainting('s1', pageId, first.document)
    expect(controller.undo()).toBe(true)

    const second = stroke(
      pageId,
      [
        { x: 50, y: 50 },
        { x: 60, y: 70 }
      ],
      's2'
    )
    controller.setPainting('s2', pageId, second.document)
    expect(controller.redo()).toBe(false)
    expect(
      controller
        .getSnapshot()
        .pagePaintings[pageId]?.objects.map((o) => o.objectId)
    ).toEqual(['s2'])
  })

  it('keeps one page-local anchor at zoom 0.5 / 1 / 2', () => {
    const anchor: PdfPoint = { x: 137.5, y: 262.25 }
    const origin: PdfPoint = { x: 0, y: 0 }
    for (const scale of [0.5, 1, 2]) {
      const offset: PdfPoint = { x: 40 * scale, y: 120 * scale }
      const viewportPoint = scrollPoint(anchor, scale, origin, offset)
      const back = contentPoint(viewportPoint, scale, origin, offset)
      expect(back.x).toBeCloseTo(anchor.x, 6)
      expect(back.y).toBeCloseTo(anchor.y, 6)
    }
  })

  it('anchors strokes to the page when the page is cropped', () => {
    const box = { x: 0, y: 0, width: 400, height: 500, rotation: 0 }
    const plain = nativePageLayout(box, {}, 0)
    const cropped = nativePageLayout(
      box,
      { left: 0.05, right: 0.05, top: 0.1, bottom: 0.1 },
      0
    )
    expect(cropped.frame).not.toEqual(plain.frame)
    // Persisted samples are page-local; the frame origin carries the crop.
    const local: PdfPoint = { x: 60, y: 80 }
    expect(local.x + cropped.frame.x).toBeCloseTo(-20 + local.x, 6)
    expect(local.y + cropped.frame.y).toBeCloseTo(-50 + local.y, 6)
    expect(cropped.slot.width).toBeCloseTo(360, 6)
    expect(cropped.slot.height).toBeCloseTo(400, 6)
  })

  it('rejects gestures that cannot form a stroke', () => {
    expect(appendStrokeDocument(undefined, 'one', [{ x: 1, y: 1 }])).toBeNull()
    expect(
      appendStrokeDocument(undefined, 'dup', [
        { x: 5, y: 5 },
        { x: 5, y: 5 }
      ])
    ).toBeNull()
    expect(
      appendStrokeDocument(undefined, 'bad', [
        { x: Number.NaN, y: 1 },
        { x: 2, y: 2 }
      ])
    ).toBeNull()
  })
})

describe('native shape rendering', () => {
  const shapeDocument = (
    shapeType: 'line' | 'rect' | 'ellipse',
    points: PdfPoint[],
    transform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
  ) => {
    const read = readLayeredDocument({
      schemaVersion: 3,
      documentRevision: 1,
      objects: [
        {
          kind: 'shape',
          objectId: `shape-${shapeType}`,
          objectRevision: 1,
          transform,
          transformRevision: 1,
          shapeType,
          points,
          style: { color: '#1f6feb', width: 2.5, opacity: 1 }
        }
      ]
    })
    if (!read.ok) throw new Error(`shape rejected: ${read.error.path}`)
    return { 'page-4': read.value }
  }

  it('renders line and rect objects as polylines with the stored style', () => {
    const line = inkObjectsForNative(
      shapeDocument('line', [
        { x: 10, y: 20 },
        { x: 110, y: 70 }
      ])
    )
    expect(line).toHaveLength(1)
    expect(line[0]).toMatchObject({
      pageNumber: 4,
      color: '#1f6feb',
      width: 2.5,
      closed: false
    })
    expect(line[0]?.points).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 70 }
    ])

    const rect = inkObjectsForNative(
      shapeDocument('rect', [
        { x: 10, y: 20 },
        { x: 60, y: 80 }
      ])
    )
    expect(rect).toHaveLength(1)
    expect(rect[0]?.closed).toBe(true)
    const xs = rect[0]!.points.map((point) => point.x)
    const ys = rect[0]!.points.map((point) => point.y)
    expect(Math.min(...xs)).toBe(10)
    expect(Math.max(...xs)).toBe(60)
    expect(Math.min(...ys)).toBe(20)
    expect(Math.max(...ys)).toBe(80)
  })

  it('samples ellipse objects and keeps every point inside the bounds', () => {
    const ellipse = inkObjectsForNative(
      shapeDocument('ellipse', [
        { x: 0, y: 0 },
        { x: 200, y: 100 }
      ])
    )
    expect(ellipse).toHaveLength(1)
    expect(ellipse[0]?.closed).toBe(true)
    expect(ellipse[0]!.points.length).toBeGreaterThan(16)
    for (const point of ellipse[0]!.points) {
      expect(point.x).toBeGreaterThanOrEqual(-0.001)
      expect(point.x).toBeLessThanOrEqual(200.001)
      expect(point.y).toBeGreaterThanOrEqual(-0.001)
      expect(point.y).toBeLessThanOrEqual(100.001)
    }
  })

  it('applies the object transform before handing points to native', () => {
    const moved = inkObjectsForNative(
      shapeDocument(
        'line',
        [
          { x: 10, y: 20 },
          { x: 30, y: 40 }
        ],
        { a: 2, b: 0, c: 0, d: 1, tx: 5, ty: -10 }
      )
    )
    expect(moved[0]?.points).toEqual([
      { x: 25, y: 10 },
      { x: 65, y: 30 }
    ])
  })

  it('persists the chosen colour and width into the same painting document', () => {
    const document = appendStrokeDocument(
      undefined,
      'styled',
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 }
      ],
      { color: '#2ea043', width: 8, time: 1 }
    )
    expect(document).not.toBeNull()
    const objects = inkObjectsForNative({ 'page-2': document! })
    expect(objects[0]).toMatchObject({ color: '#2ea043', width: 8 })
  })
})
