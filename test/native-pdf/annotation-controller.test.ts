import { describe, expect, it } from 'vitest'
import { createNativeAnnotationController } from '../../src/nativePdf/annotationController'
import type { ReaderSelectionRange } from '../../src/types/selection'

const range: ReaderSelectionRange = {
  id: 'range-1',
  createdAt: 1,
  text: 'old',
  start: { selectionId: 'page-1', offset: 0 },
  end: { selectionId: 'page-1', offset: 3 },
  rectsBySelectionId: { 'page-1': [{ x: 0, y: 0, width: 10, height: 10 }] },
  markerStyle: { backgroundColor: '#ff0' }
}

describe('native annotation business controller', () => {
  it('deduplicates repeated range commits and supports undo/redo order', () => {
    const controller = createNativeAnnotationController({
      ranges: [range],
      rects: []
    })
    const intent = {
      type: 'highlight' as const,
      rangeId: 'range-1',
      start: { selectionId: 'page-1', offset: 1 },
      end: { selectionId: 'page-1', offset: 4 },
      rectsBySelectionId: { 'page-1': [{ x: 2, y: 3, width: 11, height: 10 }] },
      geometryRevision: 2
    }
    expect(controller.apply({ commitId: 'a', intent }).status).toBe('changed')
    expect(controller.apply({ commitId: 'a', intent }).status).toBe('duplicate')
    expect(controller.undo()).toBe(true)
    expect(controller.getSnapshot().ranges[0]).toEqual(range)
    expect(controller.redo()).toBe(true)
    expect(controller.getSnapshot().ranges[0]?.start.offset).toBe(1)
  })

  it('keeps rectangles on separate original pages', () => {
    const controller = createNativeAnnotationController()
    controller.apply({
      commitId: 'r1',
      intent: {
        type: 'rectangle',
        pageNumber: 1,
        rect: { x: 1, y: 2, width: 3, height: 4 },
        phase: 'commit',
        geometryRevision: 1
      }
    })
    controller.apply({
      commitId: 'r2',
      intent: {
        type: 'rectangle',
        pageNumber: 2,
        rect: { x: 5, y: 6, width: 7, height: 8 },
        phase: 'commit',
        geometryRevision: 1
      }
    })
    expect(
      controller.getSnapshot().rects.map((rect) => rect.selectionId)
    ).toEqual(['page-1', 'page-2'])
    controller.apply({
      commitId: 'r2-update',
      intent: {
        type: 'rectangle',
        pageNumber: 2,
        rect: { x: 9, y: 10, width: 11, height: 12 },
        phase: 'commit',
        geometryRevision: 1
      }
    })
    expect(controller.getSnapshot().rects).toHaveLength(2)
    expect(controller.getSnapshot().rects[1]?.rect.x).toBe(9)
  })

  it('shares one history across painting and annotation changes', () => {
    const controller = createNativeAnnotationController()
    const painting = {} as never
    controller.setPainting('paint', 'page-1', painting)
    controller.apply({
      commitId: 'rect',
      intent: {
        type: 'rectangle',
        pageNumber: 1,
        rect: { x: 1, y: 2, width: 3, height: 4 },
        phase: 'commit',
        geometryRevision: 1
      }
    })
    expect(controller.undo()).toBe(true)
    expect(controller.getSnapshot().rects).toHaveLength(0)
    expect(controller.undo()).toBe(true)
    expect(controller.getSnapshot().pagePaintings).toEqual({})
    expect(controller.redo()).toBe(true)
    expect(controller.redo()).toBe(true)
    expect(controller.getSnapshot().rects).toHaveLength(1)
  })

  it('rejects a highlight that has no existing business range and does not mutate data', () => {
    const controller = createNativeAnnotationController()
    const result = controller.apply({
      commitId: 'missing',
      intent: {
        type: 'highlight',
        rangeId: 'missing',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 1 },
        rectsBySelectionId: {},
        geometryRevision: 1
      }
    })
    expect(result).toEqual({ status: 'rejected', reason: 'MAPPING_NOT_READY' })
    expect(controller.getSnapshot()).toEqual({
      ranges: [],
      rects: [],
      pagePaintings: {}
    })
  })
})
