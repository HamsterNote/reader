import { describe, expect, it } from 'vitest'
import {
  createNativeAnnotationController,
  createNativeAnnotationControllerStore
} from '../../src/nativePdf/annotationController'
import type { ReaderSelectionRange } from '../../src/types/selection'
import {
  reduceNativeMenu,
  shouldPreserveNativeWebMenu
} from '../../src/nativePdf/menuOwnership'

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

  it('keeps undo history isolated by storage id', () => {
    const store = createNativeAnnotationControllerStore()
    const a = store.get('file-a')
    const b = store.get('file-b')
    a.setPainting('a-paint', 'page-1', {} as never)
    b.setPainting('b-paint', 'page-1', {} as never)
    expect(a.undo()).toBe(true)
    expect(a.getSnapshot().pagePaintings).toEqual({})
    expect(b.getSnapshot().pagePaintings).toHaveProperty('page-1')
    expect(b.undo()).toBe(true)
  })

  it('isolates same-file histories by pane and host storage instance', () => {
    const buckets = createNativeAnnotationControllerStore()
    const storageA = {},
      storageB = {}
    const left = buckets.get('same-file', undefined, storageA, 'left')
    const right = buckets.get('same-file', undefined, storageA, 'right')
    const otherStorage = buckets.get('same-file', undefined, storageB, 'left')
    left.setPainting('left-ink', 'page-1', {} as never)
    expect(right.undo()).toBe(false)
    expect(otherStorage.undo()).toBe(false)
    expect(right.getSnapshot().pagePaintings).toEqual({})
    expect(otherStorage.getSnapshot().pagePaintings).toEqual({})
    expect(buckets.get('same-file', undefined, storageA, 'left')).toBe(left)
    expect(left.undo()).toBe(true)
  })

  it('keeps a native menu when WebView hide and geometry arrive afterward', () => {
    const native = reduceNativeMenu(
      { owner: null, value: null },
      { source: 'native-selection-end', value: { left: 10, top: 198 } }
    ).state
    const hidden = reduceNativeMenu(native, {
      source: 'web-hide-menu',
      value: null
    })
    const geometry = reduceNativeMenu(hidden.state, {
      source: 'native-geometry',
      value: null
    })
    expect(hidden.ignored).toBe(true)
    expect(geometry.ignored).toBe(true)
    expect(geometry.state).toEqual(native)
    expect(shouldPreserveNativeWebMenu('native', 'geometry')).toBe(true)
    expect(shouldPreserveNativeWebMenu('native', 'cancelled')).toBe(true)
    expect(shouldPreserveNativeWebMenu(null, 'geometry')).toBe(false)
  })
})

describe('native drawing history ownership', () => {
  it('restores only drawing fields across external range updates during undo and redo', () => {
    const controller = createNativeAnnotationController({ ranges: [range] })
    controller.apply({
      commitId: 'drawing-undo-ranges',
      intent: {
        type: 'rectangle',
        pageNumber: 1,
        rect: { x: 1, y: 2, width: 3, height: 4 },
        phase: 'commit',
        geometryRevision: 1
      }
    })
    const added = {
      ...range,
      id: 'added',
      markerStyle: { backgroundColor: '#ff0000' }
    }
    controller.replaceSnapshot(
      {
        ranges: [range, added],
        rects: [...controller.getSnapshot().rects],
        pagePaintings: controller.getSnapshot().pagePaintings
      },
      { preserveHistory: true }
    )

    expect(controller.undo()).toBe(true)
    expect(controller.getSnapshot().rects).toEqual([])
    expect(controller.getSnapshot().ranges).toEqual([range, added])

    const latest = { ...added, markerStyle: { backgroundColor: '#0000ff' } }
    controller.replaceSnapshot(
      {
        ranges: [latest],
        rects: [],
        pagePaintings: {}
      },
      { preserveHistory: true }
    )
    expect(controller.redo()).toBe(true)
    expect(controller.getSnapshot().rects).toHaveLength(1)
    expect(controller.getSnapshot().ranges).toEqual([latest])
  })
})
