// HAM-88 任务 2.3：节文本索引双向映射测试。
// 覆盖：样本章节 healthy、offset↔Range 往返、重复文本按位置（非文本搜索）
// 定位、虚拟空格（行内标签）、行边界、元素端点、降级（流不一致禁止定位）。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { openEpubPackage } from '../../src/epub/epubPackage'
import { legacyPageTextFromChapter } from '../../src/epub/legacyText'
import {
  buildSectionTextIndex,
  type SectionTextIndex
} from '../../src/epub/sectionTextIndex'
import { parseHighlights } from '../../demo/highlightStorage'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')

const parseChapter = (xml: string): Document =>
  new DOMParser().parseFromString(xml, 'application/xhtml+xml')

const buildIndexForChapter = async (fixture: string, chapterIndex: number) => {
  const bytes = readFileSync(join(FIXTURE_ROOT, fixture))
  const pkg = await openEpubPackage(bytes)
  const chapter = pkg.chapters[chapterIndex]
  if (!chapter) throw new Error(`missing chapter ${chapterIndex}`)
  const xml = await pkg.readText(chapter.href)
  if (xml === null) throw new Error(`missing ${chapter.href}`)
  const index = buildSectionTextIndex(
    parseChapter(xml),
    legacyPageTextFromChapter(xml)
  )
  return { index, pkg }
}

type LegacyRangeFixture = {
  readonly text: string
  readonly start: { readonly selectionId: string; readonly offset: number }
  readonly end: { readonly selectionId: string; readonly offset: number }
}

/** 单条样本高亮：端点→DOM Range→offset 往返恒等 + 文本契约逐字命中。 */
const expectEndpointRoundTrip = (
  indexes: readonly SectionTextIndex[],
  range: LegacyRangeFixture
) => {
  const startPage = Number(range.start.selectionId.replace('page-', ''))
  const endPage = Number(range.end.selectionId.replace('page-', ''))
  const samePage = startPage === endPage
  const startIndex = indexes[startPage - 1]
  const endIndex = indexes[endPage - 1]
  expect(startIndex.healthy).toBe(true)
  expect(endIndex.healthy).toBe(true)

  const startDom = startIndex.rangeFromOffsets(
    range.start.offset,
    samePage ? range.end.offset : startIndex.legacyText.length
  )
  const endDom = endIndex.rangeFromOffsets(
    samePage ? range.start.offset : 0,
    range.end.offset
  )
  expect(startDom).not.toBeNull()
  expect(endDom).not.toBeNull()
  const roundTrip = startIndex.offsetsFromRange(startDom!)
  expect(roundTrip?.start).toBe(range.start.offset)

  // 文本契约：同页切片 / 跨页 startPage 后缀 + endPage 前缀，逐字一致。
  const expectedText = samePage
    ? startIndex.legacyText.slice(range.start.offset, range.end.offset)
    : startIndex.legacyText.slice(range.start.offset) +
      endIndex.legacyText.slice(0, range.end.offset)
  expect(expectedText).toBe(range.text)
}

describe('section text index: fixture chapters', () => {
  it.each([
    ['epub/cover-and-image-order.epub', 0],
    ['epub/cover-and-image-order.epub', 1],
    ['epub/cover-and-image-order.epub', 2],
    ['epub/spine-omits-cover.epub', 0],
    ['epub/spine-omits-cover.epub', 1],
    ['epub/duplicate-text.epub', 0],
    ['epub/duplicate-text.epub', 1],
    ['epub/duplicate-text.epub', 2],
    ['epub/duplicate-text.epub', 3]
  ] as const)(
    '%s chapter %i stays healthy and round-trips',
    async (fixture, chapterIndex) => {
      const { index, pkg } = await buildIndexForChapter(fixture, chapterIndex)
      expect(index.healthy).toBe(true)
      const text = index.legacyText
      const probes = [
        [0, 0],
        [0, Math.min(1, text.length)],
        [Math.floor(text.length / 2), Math.ceil(text.length / 2) + 1],
        [text.length, text.length]
      ]
      for (const [start, end] of probes) {
        const range = index.rangeFromOffsets(start, end)
        if (text.length === 0) {
          expect(range).toBeNull()
          continue
        }
        expect(range).not.toBeNull()
        expect(index.offsetsFromRange(range!)).toEqual({ start, end })
      }
      await pkg.destroy()
    }
  )

  it('locates every v2/v3/v4 highlight endpoint against duplicate-text.epub', async () => {
    for (const version of [2, 3, 4] as const) {
      const raw = readFileSync(
        join(FIXTURE_ROOT, `highlights/epub-duplicate-text.v${version}.json`),
        'utf8'
      )
      const parsed = parseHighlights(raw)
      expect(parsed.ranges.length).toBeGreaterThan(0)
      const bytes = readFileSync(join(FIXTURE_ROOT, 'epub/duplicate-text.epub'))
      const pkg = await openEpubPackage(bytes)
      // 旧逻辑页（spine 一章一页，封面在 spine 内）：page-N ↔ chapters[N-1]。
      const chapterXmls = await Promise.all(
        pkg.chapters.map(async (chapter) => {
          const xml = await pkg.readText(chapter.href)
          if (xml === null) throw new Error(`missing ${chapter.href}`)
          return xml
        })
      )
      const indexes = chapterXmls.map((xml) =>
        buildSectionTextIndex(parseChapter(xml), legacyPageTextFromChapter(xml))
      )

      for (const range of parsed.ranges) {
        expectEndpointRoundTrip(indexes, range)
      }
      await pkg.destroy()
    }
  })

  it('resolves duplicate paragraphs positionally, never by text search', async () => {
    // 第一处「重复的段落文本。」在 page-2（chapter1），第二处在 page-4（chapter3）。
    // 位置映射下两处都落在各自章节的 DOM 上，不会互相误匹配。
    const first = await buildIndexForChapter('epub/duplicate-text.epub', 1)
    const second = await buildIndexForChapter('epub/duplicate-text.epub', 3)
    const needle = '重复的段落文本。'

    const firstOffset = first.index.legacyText.indexOf(needle)
    const secondOffset = second.index.legacyText.indexOf(needle)
    expect(firstOffset).toBeGreaterThan(-1)
    expect(secondOffset).toBeGreaterThan(-1)

    const firstRange = first.index.rangeFromOffsets(
      firstOffset,
      firstOffset + needle.length
    )
    const secondRange = second.index.rangeFromOffsets(
      secondOffset,
      secondOffset + needle.length
    )
    expect(firstRange?.startContainer.ownerDocument).not.toBe(
      secondRange?.startContainer.ownerDocument
    )
    expect(firstRange?.toString()).toBe(needle)
    expect(secondRange?.toString()).toBe(needle)
    expect(first.index.offsetsFromRange(firstRange!)).toEqual({
      start: firstOffset,
      end: firstOffset + needle.length
    })
    expect(second.index.offsetsFromRange(secondRange!)).toEqual({
      start: secondOffset,
      end: secondOffset + needle.length
    })
    await first.pkg.destroy()
    await second.pkg.destroy()
  })
})

describe('section text index: normalization equivalence with the regex pipeline', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    // 行内标签折叠为空格（span 非哨兵），b/i/em/strong/small 不产生字符。
    [
      '<p>foo<span>bar</span> baz <b>qux</b><i>zap</i></p>',
      'foo bar baz quxzap'
    ],
    // h1 边界：标题与正文分行拼接。
    ['<h1>Title</h1><p>body</p>', 'Titlebody'],
    // br 边界与 p 闭标签边界。
    ['<p>line one<br/>line two</p><p>para</p>', 'line oneline twopara'],
    // img 折叠为空格：行间单空格保留。
    ['<p>foo</p><img src="a.png"/><p>bar</p>', 'foobar'],
    ['<p>foo <img src="a.png"/> bar</p>', 'foo bar'],
    // 实体：受限解码（amp/nbsp 解码，未知实体保留原样）。
    ['<p>a &amp; b&#160;c</p>', 'a & b c']
  ]

  it.each(cases.map(([body, expected], i) => ({ i, body, expected })))(
    'case $i: DOM stream equals legacy pipeline output',
    ({ body, expected }) => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`
      const legacyText = legacyPageTextFromChapter(xml)
      expect(legacyText).toBe(expected)
      const index = buildSectionTextIndex(parseChapter(xml), legacyText)
      expect(index.healthy).toBe(true)
    }
  )

  it('round-trips offsets across an inline-tag virtual space', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body><p>foo<span>bar</span> baz</p></body></html>`
    const legacyText = legacyPageTextFromChapter(xml)
    expect(legacyText).toBe('foo bar baz')
    const index = buildSectionTextIndex(parseChapter(xml), legacyText)
    expect(index.healthy).toBe(true)

    // 覆盖虚拟空格（'foo' 与 'bar' 之间）的 range 往返。
    for (const [start, end] of [
      [3, 8],
      [4, 11],
      [0, 11]
    ] as const) {
      const range = index.rangeFromOffsets(start, end)
      expect(range).not.toBeNull()
      expect(index.offsetsFromRange(range!)).toEqual({ start, end })
    }

    // 虚拟空格零宽度：end 恰好落在空格后界的 offset（如 [0,4) 覆盖 'foo '）
    // 与用户在该词前结束的选区共享 DOM 位置；此时按选区文本保真优先，
    // 反向序列化到 3（'foo'），不追求该点的往返恒等。
    const atVirtualBoundary = index.rangeFromOffsets(0, 4)
    expect(atVirtualBoundary?.toString()).toBe('foo')
  })

  it('maps element-level range endpoints to text offsets', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body><p>alpha beta</p><p>gamma</p></body></html>`
    const legacyText = legacyPageTextFromChapter(xml)
    const doc = parseChapter(xml)
    const index = buildSectionTextIndex(doc, legacyText)
    expect(index.healthy).toBe(true)

    // 手工构造元素端点：(body, 0) → (body, 2)，覆盖两段全文。
    const body = doc.getElementsByTagName('body')[0]
    const range = doc.createRange()
    range.setStart(body, 0)
    range.setEnd(body, body.childNodes.length)
    expect(index.offsetsFromRange(range)).toEqual({
      start: 0,
      end: legacyText.length
    })

    // (p, 0) → (p, 1)：第一段全文。
    const firstP = doc.getElementsByTagName('p')[0]
    const paraRange = doc.createRange()
    paraRange.setStart(firstP, 0)
    paraRange.setEnd(firstP, firstP.childNodes.length)
    expect(index.offsetsFromRange(paraRange)).toEqual({
      start: 0,
      end: 'alpha beta'.length
    })
  })

  it('marks diverging sections degraded and refuses to locate', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body><p>actual</p></body></html>`
    const index = buildSectionTextIndex(parseChapter(xml), 'different text')
    expect(index.healthy).toBe(false)
    expect(index.rangeFromOffsets(0, 1)).toBeNull()
    const doc = parseChapter(xml)
    const range = doc.createRange()
    range.selectNodeContents(doc.getElementsByTagName('p')[0])
    expect(index.offsetsFromRange(range)).toBeNull()
  })
})
