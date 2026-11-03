import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHighlights } from '../demo/highlightStorage'
import { parseComments } from '../demo/commentStorage'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../src/host/readerSnapshot'

const SNAPSHOT_ANNOTATIONS_VERSION = 5

describe('engine host snapshot compatibility', () => {
  for (const format of ['epub-duplicate-text', 'pdf-two-column']) {
    it.each([2, 3, 4])(
      `${format} v%i migrates to annotations without losing content`,
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
        // 旧绘图由画库迁移成 schema 3 文档，页集合保持一致。
        expect(Object.keys(restored.data.pagePaintings ?? {})).toEqual(
          Object.keys(before.paintings)
        )
        for (const document of Object.values(
          restored.data.pagePaintings ?? {}
        )) {
          expect(document.schemaVersion).toBe(3)
        }

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
        // 单一写入格式：信封里只有 annotations，没有 v4 highlights。
        expect(saved['highlights']).toBeUndefined()
        expect(saved['annotations']).toMatchObject({
          version: SNAPSHOT_ANNOTATIONS_VERSION
        })
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

describe('snapshot envelope annotations', () => {
  const annotations = {
    version: SNAPSHOT_ANNOTATIONS_VERSION,
    ranges: [],
    rects: [],
    paintings: {
      'page-1': {
        schemaVersion: 3,
        documentRevision: 1,
        objects: []
      }
    }
  }

  it('round-trips annotations and keeps unknown extension fields', () => {
    const envelope = {
      annotations,
      comments: { version: 2, comments: [] },
      readerData: { renderMode: 'layout', hiddenPages: [2] },
      customOwnerField: { keep: true }
    }

    const restored = restoreReaderSnapshot(envelope)
    expect(restored.data.renderMode).toBe('layout')
    expect(restored.data.pagePaintings).toEqual(annotations.paintings)
    expect(restored.extra['customOwnerField']).toEqual({ keep: true })

    const saved = serializeReaderSnapshot(restored)
    expect(saved['annotations']).toEqual(annotations)
    expect(saved['highlights']).toBeUndefined()
    expect(saved['customOwnerField']).toEqual({ keep: true })
    expect(saved['readerData']).toEqual({
      renderMode: 'layout',
      hiddenPages: [2]
    })
    expect(restoreReaderSnapshot(saved)).toEqual({ ...restored, extra: saved })
  })

  it('drops a legacy highlights key instead of writing both containers', () => {
    const restored = restoreReaderSnapshot({
      highlights: {
        version: 4,
        ranges: [],
        rects: [],
        paintings: {}
      }
    })

    const saved = serializeReaderSnapshot(restored)
    expect(saved['highlights']).toBeUndefined()
    expect(saved['annotations']).toEqual({
      version: SNAPSHOT_ANNOTATIONS_VERSION,
      ranges: [],
      rects: [],
      paintings: {}
    })
  })

  it('fails explicitly for a corrupt annotations envelope', () => {
    expect(() =>
      restoreReaderSnapshot({
        annotations: {
          version: 5,
          ranges: [],
          rects: [],
          paintings: { 'page-1': { schemaVersion: 3, objects: 'broken' } }
        }
      })
    ).toThrow('标注恢复失败')
  })
})
