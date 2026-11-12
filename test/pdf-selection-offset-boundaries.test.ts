import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalizePdfSelectionRanges,
  combinePdfTextSelectionGroups,
  pdfCanonicalEndpointToDom,
  restorePdfTextSelection
} from '../src/components/IntermediateDocumentViewer/pdfSelectionOffsets'
import { getSelectionGroup } from '../src/components/selection/selectionGroups'
import type { ReaderSelectionRange } from '../src/types/selection'

const endpoint = (offset: number, selectionId = 'page-1') => ({
  selectionId,
  offset
})
const range = (
  id: string,
  text: string,
  start: number,
  end: number
): ReaderSelectionRange => ({
  id,
  text,
  start: endpoint(start),
  end: endpoint(end),
  createdAt: 1,
  rectsBySelectionId: {}
})
const span = (offset: number, text: string) =>
  `<span data-selection-start-offset="${offset}">${text}</span>`
function rootFor(...pages: string[]) {
  const root = document.createElement('div')
  root.innerHTML = pages
    .map(
      (content, index) =>
        `<div data-testid="intermediate-text-page-${index + 1}"><div class="hsn-selection-content">${content}</div></div>`
    )
    .join('')
  document.body.append(root)
  return root
}
const anchors = (ranges: ReaderSelectionRange[]) =>
  ranges.map(({ id, start, end, text, selectionGroup }) => ({
    id,
    start,
    end,
    text,
    selectionGroup
  }))
afterEach(() => {
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe('PDF selection boundary round trips', () => {
  it.each([3, 11])(
    'normalizes a display-space start with %i source spaces before restoring and shrinking',
    (gap) => {
      const words = ['abc', 'def', 'ghi', 'jkl']
      const step = 3 + gap
      const root = rootFor(
        words.map((word, index) => span(index * step, word)).join(' ')
      )
      const source = words.join(' '.repeat(gap))
      const draft = {
        ...range('logical', ' ghi jkl', 7, 15),
        selectionGroup: { id: 'logical', index: 0 }
      }
      const saved = canonicalizePdfSelectionRanges(draft, root, source)
      expect(saved).toEqual([
        {
          ...draft,
          text: 'ghi jkl',
          start: endpoint(2 * step),
          end: endpoint(3 * step + 3)
        }
      ])
      expect(restorePdfTextSelection(saved, 'logical', root)?.toString()).toBe(
        'ghi jkl'
      )
      const [runtime] = combinePdfTextSelectionGroups(saved, root)
      expect(runtime).toMatchObject({
        id: 'logical',
        start: endpoint(8),
        end: endpoint(15)
      })
      expect(canonicalizePdfSelectionRanges(runtime!, root, source)).toEqual(
        saved
      )

      // The next end-handle gesture shrinks to the first restored word. Its
      // leading g must survive; offsets come from the restored DOM range.
      const shrunk = canonicalizePdfSelectionRanges(
        { ...runtime!, text: 'ghi', end: endpoint(11) },
        root,
        source
      )
      expect(shrunk).toEqual([
        {
          ...saved[0]!,
          text: 'ghi',
          end: endpoint(2 * step + 3)
        }
      ])
      expect(restorePdfTextSelection(shrunk, 'logical', root)?.toString()).toBe(
        'ghi'
      )
      expect(combinePdfTextSelectionGroups(shrunk, root)[0]).toMatchObject({
        id: 'logical',
        selectionGroup: draft.selectionGroup,
        start: endpoint(8),
        end: endpoint(11)
      })

      // The other side must also normalize inward: the display space before
      // ghi cannot become an unanchored canonical end at ghi's source start.
      const trailing = canonicalizePdfSelectionRanges(
        range('trailing', 'def ', 4, 8),
        root,
        source
      )
      expect(trailing).toEqual([range('trailing', 'def', step, step + 3)])
      expect(
        restorePdfTextSelection(trailing, 'trailing', root)?.toString()
      ).toBe('def')
    }
  )

  it('rejects unmapped source offsets instead of interpreting them as DOM offsets', () => {
    const root = rootFor(`${span(0, 'abc')} ${span(14, 'def')}`)
    expect(pdfCanonicalEndpointToDom(endpoint(3), 'start', root)).toBeNull()
    expect(pdfCanonicalEndpointToDom(endpoint(14), 'end', root)).toBeNull()
    expect(
      restorePdfTextSelection([range('invalid', 'def', 3, 17)], 'invalid', root)
    ).toBeNull()
    expect(
      canonicalizePdfSelectionRanges(
        range('outside', '?', 50, 51),
        root,
        'abc           def'
      )
    ).toEqual([])
    // Unmounted annotations remain in the linked snapshot, but cannot be
    // materialized into a native selection before their anchors mount.
    const offscreen = {
      ...range('offscreen', 'other', 0, 5),
      start: endpoint(0, 'page-2'),
      end: endpoint(5, 'page-2')
    }
    expect(combinePdfTextSelectionGroups([offscreen], root)).toEqual([
      offscreen
    ])
    expect(restorePdfTextSelection([offscreen], 'offscreen', root)).toBeNull()
  })
})

describe('PDF exclusions across columns, lines and pages', () => {
  it.each([
    {
      name: 'columns: selecting the left column must exclude RIGHT from the interleaved source stream',
      html: `<div class="left-column">${span(0, 'LeftA')} ${span(18, 'LeftB')}</div><aside class="right-column">${span(8, 'RIGHT')}</aside>`,
      source: 'LeftA   RIGHT     LeftB',
      text: 'LeftA LeftB',
      excluded: 'RIGHT',
      expected: [
        [0, 5],
        [18, 23]
      ],
      independent: range('right-independent', 'RIGHT', 8, 13)
    },
    {
      name: 'lines: selecting two body lines must exclude the separately positioned NOTE between them in source order',
      html: `<p>${span(0, 'Top')}</p> <p>${span(14, 'Bottom')}</p><aside>${span(6, 'NOTE')}</aside>`,
      source: 'Top   NOTE    Bottom',
      text: 'Top Bottom',
      excluded: 'NOTE',
      expected: [
        [0, 3],
        [14, 20]
      ],
      independent: range('note-independent', 'NOTE', 6, 10)
    }
  ])('$name', ({ html, source, text, excluded, expected, independent }) => {
    const root = rootFor(html)
    const saved = canonicalizePdfSelectionRanges(
      range('body', text, 0, text.length),
      root,
      source
    )
    expect(saved.map(({ start, end }) => [start.offset, end.offset])).toEqual(
      expected
    )
    expect(
      saved.every(
        ({ start, end }) =>
          start.selectionId === 'page-1' && end.selectionId === 'page-1'
      )
    ).toBe(true)
    expect(
      saved
        .map(({ start, end }) => source.slice(start.offset, end.offset))
        .join('')
    ).not.toContain(excluded)
    expect(saved.map(({ selectionGroup }) => selectionGroup)).toEqual([
      { id: 'body', index: 0 },
      { id: 'body', index: 1 }
    ])
    const all = [...saved, independent]
    expect(
      combinePdfTextSelectionGroups(all, root).map(({ id }) => id)
    ).toEqual(['body', independent.id])
    expect(getSelectionGroup(all, independent.id)).toEqual([independent])
    for (const member of saved) {
      expect(restorePdfTextSelection(all, member.id, root)?.toString()).toBe(
        text
      )
      const [runtime] = combinePdfTextSelectionGroups(
        getSelectionGroup(all, member.id),
        root
      )
      expect(
        anchors(canonicalizePdfSelectionRanges(runtime!, root, source))
      ).toEqual(anchors(saved))
    }
    expect(restorePdfTextSelection(all, independent.id, root)?.toString()).toBe(
      excluded
    )
    const independentRuntime = combinePdfTextSelectionGroups(
      [independent],
      root
    )[0]!
    expect(
      canonicalizePdfSelectionRanges(independentRuntime, root, source)
    ).toEqual([independent])
  })

  it('pages: a tail-to-head selection excludes the unselected page-1 prefix and page-2 suffix, keeping their independent IDs', () => {
    const root = rootFor(
      `${span(0, 'NO1')} ${span(6, 'Tail')}`,
      `${span(0, 'Head')} ${span(7, 'NO2')}`
    )
    const draft = {
      ...range('spanning', 'TailHead', 4, 4),
      end: endpoint(4, 'page-2')
    }
    const saved = canonicalizePdfSelectionRanges(draft, root, 'NO1   Tail')
    expect(saved).toEqual([{ ...draft, start: endpoint(6) }])
    // Page-local source intervals [6,10) and [0,4) exclude the visible NO1
    // prefix [0,3) and NO2 suffix [7,10); whitespace doesn't join their IDs.
    expect('NO1   Tail'.slice(saved[0]!.start.offset)).toBe('Tail')
    expect('Head   NO2'.slice(0, saved[0]!.end.offset)).toBe('Head')
    const independent = [
      range('prefix', 'NO1', 0, 3),
      {
        ...range('suffix', 'NO2', 7, 10),
        start: endpoint(7, 'page-2'),
        end: endpoint(10, 'page-2')
      }
    ]
    const all = [...saved, ...independent]
    expect(
      combinePdfTextSelectionGroups(all, root).map(({ id }) => id)
    ).toEqual(['spanning', 'prefix', 'suffix'])
    for (const item of all) {
      expect(getSelectionGroup(all, item.id)).toEqual([item])
      expect(restorePdfTextSelection(all, item.id, root)?.toString()).toBe(
        item.text
      )
      const [runtime] = combinePdfTextSelectionGroups([item], root)
      expect(anchors(canonicalizePdfSelectionRanges(runtime!, root))).toEqual(
        anchors([item])
      )
    }
  })
})
