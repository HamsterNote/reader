import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHighlights } from '../demo/highlightStorage'
import { parseComments } from '../demo/commentStorage'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../src/host/readerSnapshot'

describe('engine host snapshot compatibility', () => {
  for (const format of ['epub-duplicate-text', 'pdf-two-column']) {
    it.each([2, 3, 4])(
      `${format} v%i survives edit, old import and reopen`,
      (version) => {
        const highlights = JSON.parse(
          readFileSync(
            join(
              __dirname,
              `compat/fixtures/highlights/${format}.v${version}.json`
            ),
            'utf8'
          )
        )
        const comments = {
          version: 2,
          comments: [
            {
              id: 'comment-1',
              highlightIds: [highlights.ranges[0].id],
              content: 'Persisted comment',
              createdAt: 1735689800000,
              updatedAt: 1735689900000,
              parentId: null
            }
          ]
        }
        const readerData = {
          bookmarks: [
            { pageNumber: 2, textId: 'old-text-id', text: 'Anchor', offset: 7 },
            { pageNumber: 1, verticalPercentage: 43 }
          ],
          layoutReadingProgress: {
            pageNumber: 2,
            textId: 'old-text-id',
            text: 'Anchor',
            offset: 7
          },
          textReadingProgress: { currentPageNumber: 1 },
          renderMode: 'layout',
          hiddenPages: [3, 'page-4'],
          edgeCrop: { all: { left: 0.1 }, pages: { 'page-2': { top: 0.2 } } }
        }
        const original = JSON.stringify(highlights)
        const restored = restoreReaderSnapshot({
          highlights,
          comments,
          readerData,
          customOwnerField: 'keep'
        })
        const before = parseHighlights(original)
        expect(restored.data.ranges).toEqual(before.ranges)
        expect(restored.data.rects).toEqual(before.rects)
        expect(restored.data.pagePaintings).toEqual(before.paintings)

        const changed = {
          ...restored,
          data: {
            ...restored.data,
            ranges: restored.data.ranges!.map((range, index) =>
              index === 1
                ? {
                    ...range,
                    markerStyle: {
                      ...range.markerStyle,
                      backgroundColor: '#123456'
                    }
                  }
                : range
            )
          }
        }
        const saved = serializeReaderSnapshot(changed)
        const oldReader = parseHighlights(JSON.stringify(saved['highlights']))
        // Full equality includes IDs, timestamps, endpoints, units, every rectangle and style.
        expect(oldReader.ranges).toEqual(changed.data.ranges)
        expect(oldReader.rects).toEqual(before.rects)
        expect(oldReader.paintings).toEqual(before.paintings)
        expect(parseComments(JSON.stringify(saved['comments']))).toEqual(
          restored.comments
        )
        expect(saved['readerData']).toEqual(readerData)
        expect(saved['customOwnerField']).toBe('keep')
        expect(restoreReaderSnapshot(saved)).toEqual({
          ...changed,
          extra: saved
        })
        expect(JSON.stringify(highlights)).toBe(original)
      }
    )
  }

  it('prefers current ReaderData over the previous progress channel on reopen', () => {
    const current = { currentPageNumber: 8 }
    expect(
      restoreReaderSnapshot(
        { readerData: { textReadingProgress: current } },
        { textReadingProgress: { currentPageNumber: 2 } }
      ).data.textReadingProgress
    ).toEqual(current)
  })
})
