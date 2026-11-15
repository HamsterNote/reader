import { describe, expect, it } from 'vitest'
import {
  applyNativePageEditOperation,
  createNativePageEditOperation,
  createNativePageEditUndo,
  nativePageEditGroups,
  restoreNativePageEditFields,
  withNativePageEditData
} from '../../src/nativePdf/pageEdit'
import type { PdfIdentity } from '../../src/nativePdf/contracts'

const identity: PdfIdentity = {
  fileId: 'page-edit',
  paneId: 'development',
  sessionId: 'session',
  generation: 1
}

describe('native page editor snapshot contract', () => {
  it('preserves the readerData envelope and unknown snapshot fields', () => {
    const snapshot = {
      readerData: { hiddenPages: [2] },
      qaSentinel: 'keep-me',
      futureHostField: { version: 2 }
    }
    expect(
      withNativePageEditData(snapshot, {
        hiddenPages: [2, 3],
        edgeCrop: { all: { top: 0.05 } }
      })
    ).toEqual({
      readerData: {
        hiddenPages: [2, 3],
        edgeCrop: { all: { top: 0.05 } }
      },
      qaSentinel: 'keep-me',
      futureHostField: { version: 2 }
    })
  })

  it('restores only page editor fields onto a newer ReaderData snapshot', () => {
    const current = {
      hiddenPages: [2, 3],
      edgeCrop: { all: { top: 0.05 } },
      layoutReadingProgress: { pageNumber: 9, verticalPercentage: 42 }
    } as const
    expect(
      restoreNativePageEditFields(current, {
        hiddenPages: [2],
        edgeCrop: {}
      })
    ).toEqual({
      hiddenPages: [2],
      edgeCrop: {},
      layoutReadingProgress: { pageNumber: 9, verticalPercentage: 42 }
    })
  })

  it('groups a large consecutive hidden range instead of rendering 200 rows', () => {
    const groups = nativePageEditGroups(
      Array.from({ length: 198 }, (_, index) => index + 2),
      200
    )
    expect(groups).toEqual([
      {
        start: 2,
        end: 199,
        pages: Array.from({ length: 198 }, (_, i) => i + 2)
      }
    ])
  })

  it('seals operation intent and applies only dirty fields to the latest data', () => {
    const draftHiddenPages = [2]
    const draftCrop = { top: 0.05 }
    const operation = createNativePageEditOperation({
      operationId: 'crop-1',
      identity,
      leaseEpoch: 3,
      baseRevision: 4,
      base: {
        hiddenPages: ['page-2'],
        edgeCrop: { all: {}, pages: { 'page-2': { left: 0.1 } } }
      },
      draftHiddenPages,
      draftCrop
    })
    draftHiddenPages.push(3)
    draftCrop.top = 0.5

    expect(operation.dirty).toEqual({ hiddenPages: false, cropAll: true })
    expect(operation.target.hiddenPages).toEqual([2])
    expect(operation.target.cropAll).toEqual({ top: 0.05 })
    expect(Object.isFrozen(operation.base.edgeCrop?.pages)).toBe(true)
    const latest = {
      hiddenPages: [2, 4],
      edgeCrop: { all: { left: 0.3 }, pages: { 'page-3': { right: 0.2 } } },
      layoutReadingProgress: { pageNumber: 8, verticalPercentage: 20 }
    } as const
    expect(applyNativePageEditOperation(latest, operation)).toEqual({
      hiddenPages: [2, 4],
      edgeCrop: {
        all: { top: 0.05 },
        pages: { 'page-3': { right: 0.2 } }
      },
      layoutReadingProgress: { pageNumber: 8, verticalPercentage: 20 }
    })
    expect(
      restoreNativePageEditFields(
        latest,
        createNativePageEditUndo(latest, operation)
      ).hiddenPages
    ).toEqual([2, 4])
  })

  it('distinguishes aliases, default crop values and an explicit clear', () => {
    const unchanged = createNativePageEditOperation({
      operationId: 'unchanged',
      identity,
      leaseEpoch: 0,
      baseRevision: 0,
      base: { hiddenPages: ['page-2', 3], edgeCrop: { all: { top: 0 } } },
      draftHiddenPages: [3, 2],
      draftCrop: {}
    })
    expect(unchanged.dirty).toEqual({ hiddenPages: false, cropAll: false })
    const cleared = createNativePageEditOperation({
      operationId: 'cleared',
      identity,
      leaseEpoch: 0,
      baseRevision: 0,
      base: unchanged.base,
      draftHiddenPages: [],
      draftCrop: {}
    })
    expect(cleared.dirty.hiddenPages).toBe(true)
    expect(
      applyNativePageEditOperation({ hiddenPages: [2, 3] }, cleared)
    ).toEqual({ hiddenPages: [] })
  })
})
