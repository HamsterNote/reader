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
      data: {
        readerData: {
          hiddenPages: [2],
          layoutReadingProgress: { pageNumber: 1, verticalPercentage: 20 }
        }
      },
      progress: null,
      revision: 4
    }
    const current = {
      ...previous,
      data: {
        readerData: {
          hiddenPages: [2],
          layoutReadingProgress: { pageNumber: 3, verticalPercentage: 40 }
        }
      },
      revision: 5
    }
    const staleEdit = {
      ...previous,
      data: {
        readerData: {
          hiddenPages: [2, 3],
          layoutReadingProgress: { pageNumber: 1, verticalPercentage: 20 }
        }
      },
      revision: 5
    }
    expect(rebaseSnapshot(current, previous, staleEdit).data).toEqual({
      readerData: {
        hiddenPages: [2, 3],
        layoutReadingProgress: { pageNumber: 3, verticalPercentage: 40 }
      }
    })
  })

  it('keeps painting objects when a stale progress write lands later', () => {
    const previous = {
      data: {
        readerData: {
          pagePaintings: { 'page-1': { objects: [{ id: 'a' }] } },
          layoutReadingProgress: { pageNumber: 1, verticalPercentage: 10 }
        }
      },
      progress: null,
      revision: 1
    }
    const current = {
      ...previous,
      data: {
        readerData: {
          pagePaintings: { 'page-1': { objects: [{ id: 'a' }, { id: 'b' }] } },
          layoutReadingProgress: previous.data.readerData.layoutReadingProgress
        }
      },
      revision: 2
    }
    const stale = {
      ...previous,
      data: {
        readerData: {
          pagePaintings: previous.data.readerData.pagePaintings,
          layoutReadingProgress: { pageNumber: 2, verticalPercentage: 35 }
        }
      },
      revision: 2
    }
    expect(rebaseSnapshot(current, previous, stale).data.readerData).toEqual({
      pagePaintings: { 'page-1': { objects: [{ id: 'a' }, { id: 'b' }] } },
      layoutReadingProgress: { pageNumber: 2, verticalPercentage: 35 }
    })
  })

  it('keeps comment cascade data when a stale annotation write lands later', () => {
    const previous = {
      data: {
        annotations: { ranges: [{ id: 'r1' }], rects: [], paintings: {} },
        comments: { comments: [{ id: 'c1', parentId: null }] }
      },
      progress: null,
      revision: 3
    }
    const current = {
      ...previous,
      data: {
        annotations: {
          ranges: [{ id: 'r1' }, { id: 'r2' }],
          rects: [],
          paintings: {}
        },
        comments: {
          comments: [
            { id: 'c1', parentId: null },
            { id: 'reply', parentId: 'c1' }
          ]
        }
      },
      revision: 4
    }
    const stale = {
      ...previous,
      data: {
        annotations: {
          ranges: previous.data.annotations.ranges,
          rects: [{ id: 'rect-new' }],
          paintings: {}
        },
        comments: previous.data.comments
      },
      revision: 4
    }
    expect(rebaseSnapshot(current, previous, stale).data).toEqual({
      annotations: {
        ranges: [{ id: 'r1' }, { id: 'r2' }],
        rects: [{ id: 'rect-new' }],
        paintings: {}
      },
      comments: current.data.comments
    })
  })

  it('keeps external annotation child keys during an OCR write', () => {
    const previous = {
      data: {
        readerData: { ocrTexts: { 1: [{ id: 'old', content: 'old' }] } },
        annotations: {
          ranges: [{ id: 'r1' }],
          rects: [{ id: 'rect-1' }],
          paintings: {}
        }
      },
      progress: null,
      revision: 5
    }
    const current = {
      ...previous,
      data: {
        readerData: previous.data.readerData,
        annotations: {
          ranges: [{ id: 'r1' }],
          rects: [{ id: 'rect-1' }, { id: 'rect-2' }],
          paintings: {}
        }
      },
      revision: 6
    }
    const stale = {
      ...previous,
      data: {
        readerData: { ocrTexts: { 1: [{ id: 'new', content: 'new' }] } },
        annotations: previous.data.annotations
      },
      revision: 6
    }
    expect(rebaseSnapshot(current, previous, stale).data).toEqual({
      readerData: { ocrTexts: { 1: [{ id: 'new', content: 'new' }] } },
      annotations: current.data.annotations
    })
  })
})
