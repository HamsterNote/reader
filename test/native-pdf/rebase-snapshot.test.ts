import { describe, expect, it } from 'vitest'
import { rebaseSnapshot } from '../../src/host/rebaseSnapshot'

describe('host snapshot field rebase', () => {
  it('keeps a crop edit when a stale progress write lands later', () => {
    const previous = {
      data: {
        readerData: {
          edgeCrop: { all: {} },
          layoutReadingProgress: { pageNumber: 1, verticalPercentage: 0 }
        },
        qaSentinel: 'keep'
      },
      progress: null,
      revision: 1
    }
    const current = {
      ...previous,
      data: {
        ...previous.data,
        readerData: {
          ...previous.data.readerData,
          edgeCrop: { all: { top: 0.05 } }
        }
      },
      revision: 2
    }
    const staleProgress = {
      ...previous,
      data: {
        ...previous.data,
        readerData: {
          ...previous.data.readerData,
          layoutReadingProgress: { pageNumber: 2, verticalPercentage: 35 }
        }
      },
      revision: 2
    }
    expect(rebaseSnapshot(current, previous, staleProgress)).toEqual({
      ...current,
      data: {
        ...current.data,
        readerData: {
          edgeCrop: { all: { top: 0.05 } },
          layoutReadingProgress: { pageNumber: 2, verticalPercentage: 35 }
        }
      },
      revision: 3
    })
  })

  it('preserves reader progress when a stale page edit is rebased', () => {
    const previous = {
      data: { readerData: { hiddenPages: [2], layoutReadingProgress: { pageNumber: 1, verticalPercentage: 20 } } },
      progress: null,
      revision: 4
    }
    const current = {
      ...previous,
      data: { readerData: { hiddenPages: [2], layoutReadingProgress: { pageNumber: 3, verticalPercentage: 40 } } },
      revision: 5
    }
    const staleEdit = {
      ...previous,
      data: { readerData: { hiddenPages: [2, 3], layoutReadingProgress: { pageNumber: 1, verticalPercentage: 20 } } },
      revision: 5
    }
    expect(rebaseSnapshot(current, previous, staleEdit).data).toEqual({
      readerData: {
        hiddenPages: [2, 3],
        layoutReadingProgress: { pageNumber: 3, verticalPercentage: 40 }
      }
    })
  })
})
