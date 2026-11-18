import { describe, expect, it } from 'vitest'
import {
  applyNativeAnnotationPatchDetailed,
  diffNativeAnnotationSnapshots
} from '../../src/nativePdf/annotationPatch'
import type { NativeAnnotationSnapshot } from '../../src/nativePdf/annotationController'
import type { ReaderSelectionRange } from '../../src/types/selection'

function range(id: string, color = '#ffc107'): ReaderSelectionRange {
  return {
    id,
    createdAt: 1,
    text: id,
    start: { selectionId: 'page-1', offset: 0 },
    end: { selectionId: 'page-1', offset: 2 },
    overlayRectType: 'px',
    markerStyle: { backgroundColor: color },
    rectsBySelectionId: {
      'page-1': [{ x: 0, y: 0, width: 20, height: 10 }]
    }
  }
}

function snapshot(
  ranges: readonly ReaderSelectionRange[]
): NativeAnnotationSnapshot {
  return { ranges, rects: [], pagePaintings: {} }
}

describe('native annotation object conflict matrix', () => {
  const original = range('shared')
  const keeper = range('keeper')

  it('applies create, recolor and delete without dropping unrelated objects', () => {
    const base = snapshot([original, keeper])
    const added = range('added')
    const create = diffNativeAnnotationSnapshots(
      base,
      snapshot([original, keeper, added])
    )
    const recolor = diffNativeAnnotationSnapshots(
      base,
      snapshot([range('shared', '#ff0000'), keeper])
    )
    const deletion = diffNativeAnnotationSnapshots(base, snapshot([original]))

    let current = applyNativeAnnotationPatchDetailed(base, create).snapshot
    current = applyNativeAnnotationPatchDetailed(current, recolor).snapshot
    const result = applyNativeAnnotationPatchDetailed(current, deletion)

    expect(result.conflicts).toEqual([])
    expect(result.snapshot.ranges).toHaveLength(2)
    expect(result.snapshot.ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'shared',
          markerStyle: expect.objectContaining({ backgroundColor: '#ff0000' })
        }),
        expect.objectContaining({ id: 'added' })
      ])
    )
    expect(result.snapshot.ranges.some((item) => item.id === 'keeper')).toBe(
      false
    )
  })

  it('rejects a stale recolor after another pane deletes the target', () => {
    const patch = diffNativeAnnotationSnapshots(
      snapshot([original, keeper]),
      snapshot([range('shared', '#ff0000'), keeper]),
      { rangeUpsert: { rangeId: 'shared', operation: 'update' } }
    )
    const result = applyNativeAnnotationPatchDetailed(snapshot([keeper]), patch)

    expect(result.snapshot.ranges).toEqual([keeper])
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        entity: 'range',
        objectId: 'shared',
        operation: 'update',
        reason: 'missing-target'
      })
    ])
  })

  it('restores only an owned deletion on undo and deletes it again on redo', () => {
    const before = snapshot([original, keeper])
    const deleted = snapshot([keeper])
    const undo = diffNativeAnnotationSnapshots(deleted, before, {
      history: 'undo'
    })
    const restored = applyNativeAnnotationPatchDetailed(deleted, undo)

    expect(restored.conflicts).toEqual([])
    expect(restored.snapshot.ranges).toHaveLength(2)
    expect(restored.snapshot.ranges).toEqual(
      expect.arrayContaining([original, keeper])
    )

    const redo = diffNativeAnnotationSnapshots(before, deleted, {
      history: 'redo'
    })
    const reapplied = applyNativeAnnotationPatchDetailed(
      restored.snapshot,
      redo
    )
    expect(reapplied.conflicts).toEqual([])
    expect(reapplied.snapshot.ranges).toEqual([keeper])
  })

  it.each(['undo', 'redo'] as const)(
    'does not resurrect a deleted object through %s of a recolor',
    (history) => {
      const before = snapshot([original, keeper])
      const after = snapshot([range('shared', '#ff0000'), keeper])
      const patch = diffNativeAnnotationSnapshots(
        history === 'undo' ? after : before,
        history === 'undo' ? before : after,
        { history }
      )
      const result = applyNativeAnnotationPatchDetailed(
        snapshot([keeper]),
        patch
      )

      expect(result.snapshot.ranges).toEqual([keeper])
      expect(result.conflicts).toEqual([
        expect.objectContaining({
          objectId: 'shared',
          operation: 'update',
          reason: 'missing-target'
        })
      ])
    }
  )

  it('uses confirmation order for concurrent recolors while the object exists', () => {
    const base = snapshot([original, keeper])
    const left = diffNativeAnnotationSnapshots(
      base,
      snapshot([range('shared', '#ff0000'), keeper])
    )
    const right = diffNativeAnnotationSnapshots(
      base,
      snapshot([range('shared', '#00ff00'), keeper])
    )
    const first = applyNativeAnnotationPatchDetailed(base, left)
    const second = applyNativeAnnotationPatchDetailed(first.snapshot, right)

    expect(second.conflicts).toEqual([])
    expect(second.snapshot.ranges).toHaveLength(2)
    expect(second.snapshot.ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'shared',
          markerStyle: expect.objectContaining({ backgroundColor: '#00ff00' })
        }),
        keeper
      ])
    )
  })
})
