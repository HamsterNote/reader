import { describe, expect, it } from 'vitest'
import {
  nativePageEditGroups,
  restoreNativePageEditFields,
  withNativePageEditData
} from '../../src/nativePdf/pageEdit'

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
      { start: 2, end: 199, pages: Array.from({ length: 198 }, (_, i) => i + 2) }
    ])
  })
})
