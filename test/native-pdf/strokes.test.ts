import { describe, expect, it } from 'vitest'
import type { EditorDocument } from '@hamster-note/painting/core'
import { createNativeAnnotationController } from '../../src/nativePdf/annotationController'
import { nativePageLayout } from '../../src/nativePdf/geometry'
import {
  appendStrokeDocument,
  paintingPageId,
  strokesForNative
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
      strokesForNative(controller.getSnapshot().pagePaintings)
    ).toHaveLength(3)

    expect(controller.undo()).toBe(true)
    expect(controller.undo()).toBe(true)
    const remaining =
      controller.getSnapshot().pagePaintings[pageId]?.objects ?? []
    expect(remaining.map((object) => object.objectId)).toEqual(['s1'])
    expect(
      strokesForNative(controller.getSnapshot().pagePaintings)
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
