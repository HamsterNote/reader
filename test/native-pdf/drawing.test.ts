import { describe, expect, it } from 'vitest'
import { createNativeAnnotationController } from '../../src/nativePdf/annotationController'
import {
  nativeRectCommit,
  readerSnapshotWithAnnotations,
  validNativeRect,
  type NativeRectEvent
} from '../../src/nativePdf/drawing'
import { restoreReaderSnapshot } from '../../src/host/readerSnapshot'

function rectEvent(over: Partial<NativeRectEvent> = {}): NativeRectEvent {
  return {
    type: 'rect',
    fileId: 'file',
    paneId: 'development',
    sessionId: 'session',
    generation: 1,
    pageNumber: 2,
    rect: { x: 10, y: 20, width: 40, height: 30 },
    phase: 'commit',
    geometryRevision: 3,
    ...over
  } as NativeRectEvent
}

describe('native rectangle tool', () => {
  it('only commits valid single gestures', () => {
    expect(nativeRectCommit(rectEvent(), 'c1')).toMatchObject({
      commitId: 'c1',
      intent: {
        type: 'rectangle',
        pageNumber: 2,
        rect: { x: 10, y: 20, width: 40, height: 30 },
        phase: 'commit'
      }
    })
    expect(nativeRectCommit(rectEvent({ phase: 'preview' }), 'c2')).toBeNull()
    expect(nativeRectCommit(rectEvent({ phase: 'cancel' }), 'c3')).toBeNull()
    expect(
      nativeRectCommit(
        rectEvent({ rect: { x: 1, y: 1, width: 0.5, height: 30 } }),
        'c4'
      )
    ).toBeNull()
    expect(validNativeRect({ x: 0, y: 0, width: 4, height: 4 })).toBe(true)
  })

  it('gives every gesture its own rectangle id and dedupes retries', () => {
    const controller = createNativeAnnotationController()
    const first = nativeRectCommit(rectEvent(), 'gesture-1')!
    const second = nativeRectCommit(
      rectEvent({ rect: { x: 60, y: 20, width: 20, height: 20 } }),
      'gesture-2'
    )!
    expect(controller.apply(first).status).toBe('changed')
    expect(controller.apply(first).status).toBe('duplicate')
    expect(controller.apply(second).status).toBe('changed')
    expect(controller.getSnapshot().rects).toHaveLength(2)
    expect(
      controller.getSnapshot().rects.map((rect) => rect.selectionId)
    ).toEqual(['page-2', 'page-2'])
  })

  it('undoes the last rectangle through the shared controller', () => {
    const controller = createNativeAnnotationController()
    controller.apply(nativeRectCommit(rectEvent(), 'gesture-1')!)
    controller.apply(
      nativeRectCommit(
        rectEvent({ rect: { x: 60, y: 20, width: 20, height: 20 } }),
        'gesture-2'
      )!
    )
    expect(controller.undo()).toBe(true)
    expect(controller.getSnapshot().rects).toHaveLength(1)
    expect(controller.getSnapshot().rects[0]?.rect.x).toBe(10)
    expect(controller.undo()).toBe(true)
    expect(controller.getSnapshot().rects).toHaveLength(0)
    expect(controller.undo()).toBe(false)
  })

  it('writes rects through the existing V5 envelope and keeps other fields', () => {
    const controller = createNativeAnnotationController()
    controller.apply(nativeRectCommit(rectEvent(), 'gesture-1')!)
    const envelope = readerSnapshotWithAnnotations(
      {
        readerData: {
          hiddenPages: [3],
          layoutReadingProgress: { pageNumber: 2 }
        },
        unknown: { kept: true }
      },
      {},
      controller.getSnapshot()
    )
    expect(envelope['unknown']).toEqual({ kept: true })
    expect(envelope['readerData']).toMatchObject({ hiddenPages: [3] })
    expect(envelope['annotations']).toMatchObject({ version: 5 })

    const restored = restoreReaderSnapshot(envelope)
    expect(restored.data.rects).toHaveLength(1)
    expect(restored.data.rects?.[0]).toMatchObject({
      id: 'native-gesture-1',
      overlayRectType: 'px',
      selectionId: 'page-2',
      rect: { x: 10, y: 20, width: 40, height: 30 }
    })
  })
})
