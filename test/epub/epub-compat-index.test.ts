// HAM-88 任务 2.3：整书兼容索引验收。
// - 第 1 组样本（EPUB ×3 + 同文件 v2/v3/v4 高亮 JSON）逐条定位成功；
// - 新高亮反向序列化为旧端点结构，重复文本锚定正确章节；
// - 文本契约不成立 / 非法端点 / 节降级 → unlocatable，原样保留。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseHighlights } from '../../demo/highlightStorage'
import { EpubCompatIndex } from '../../src/epub/epubCompatIndex'
import { openEpubPackage, type EpubPackage } from '../../src/epub/epubPackage'
import {
  buildLegacyEpubModel,
  type LegacyEpubModel
} from '../../src/epub/legacyEpubModel'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')

const buildIndex = async (
  fixture: string
): Promise<{
  index: EpubCompatIndex
  model: LegacyEpubModel
  pkg: EpubPackage
}> => {
  const pkg = await openEpubPackage(readFileSync(join(FIXTURE_ROOT, fixture)))
  const model = await buildLegacyEpubModel(pkg)
  const index = await EpubCompatIndex.create(pkg, model)
  return { index, model, pkg }
}

describe('epub compat index: legacy highlight location', () => {
  it.each([2, 3, 4] as const)(
    'v%i highlight JSON: every range locates against duplicate-text.epub',
    async (version) => {
      const raw = readFileSync(
        join(FIXTURE_ROOT, `highlights/epub-duplicate-text.v${version}.json`),
        'utf8'
      )
      const parsed = parseHighlights(raw)
      const { index, pkg } = await buildIndex('epub/duplicate-text.epub')

      for (const range of parsed.ranges) {
        const location = index.locateRange(range)
        if (location.status !== 'located') {
          throw new Error(
            `${range.id} should locate, got ${location.status}: ${location.reason}`
          )
        }
        // 同页 range 一段、跨页 range 两段。
        const samePage = range.start.selectionId === range.end.selectionId
        expect(location.parts).toHaveLength(samePage ? 1 : 2)
        // DOM Range 文本与持久化文本的对应段一致。
        if (samePage) {
          expect(location.parts[0]?.range.toString()).toBe(range.text)
        } else {
          const startText = index.pageText(
            Number(range.start.selectionId.slice(5))
          )!
          const endText = index.pageText(
            Number(range.end.selectionId.slice(5))
          )!
          expect(location.parts[0]?.range.toString()).toBe(
            startText.slice(range.start.offset)
          )
          expect(location.parts[1]?.range.toString()).toBe(
            endText.slice(0, range.end.offset)
          )
        }
      }
      await pkg.destroy()
    }
  )

  it('anchors the duplicate paragraph range to page-2, not page-4', async () => {
    const raw = readFileSync(
      join(FIXTURE_ROOT, 'highlights/epub-duplicate-text.v4.json'),
      'utf8'
    )
    const parsed = parseHighlights(raw)
    const duplicate = parsed.ranges.find(
      (range) => range.id === 'epub-range-duplicate-first'
    )
    if (!duplicate) throw new Error('missing duplicate range')
    const { index, pkg } = await buildIndex('epub/duplicate-text.epub')

    const location = index.locateRange(duplicate)
    if (location.status !== 'located') throw new Error('should locate')
    // page-2 ↔ chapter1（spine 第二章，下标 1），不是 chapter3。
    expect(location.parts[0]?.chapterIndex).toBe(1)
    expect(location.parts[0]?.range.toString()).toBe('重复的段落文本。')
    await pkg.destroy()
  })

  it('serializes a new selection back to legacy endpoints on the right page', async () => {
    const { index, pkg } = await buildIndex('epub/duplicate-text.epub')
    // 在 chapter3（page-4）里选中第二处重复段落：先定位 page-4 文本中的位置。
    const page4Text = index.pageText(4)!
    const needle = '重复的段落文本。'
    const start = page4Text.indexOf(needle)
    expect(start).toBeGreaterThan(-1)

    const probe = index.locateRange({
      text: needle,
      start: { selectionId: 'page-4', offset: start },
      end: { selectionId: 'page-4', offset: start + needle.length }
    })
    if (probe.status !== 'located') throw new Error('probe should locate')

    const serialized = index.serializeRange(
      probe.parts[0]!.chapterIndex,
      probe.parts[0]!.range
    )
    expect(serialized).toEqual({
      start: { selectionId: 'page-4', offset: start },
      end: { selectionId: 'page-4', offset: start + needle.length },
      text: needle
    })

    // 反向序列化结果可再次定位（闭环）。
    const relocated = index.locateRange(serialized!)
    expect(relocated.status).toBe('located')
    await pkg.destroy()
  })

  it('serializes a selection across an in-page duplicate occurrence by position', async () => {
    const { index, pkg } = await buildIndex('epub/duplicate-text.epub')
    // page-2 同时含「重复的段落文本。」（第二句）。选中整页文本的最后一句，
    // 序列化偏移必须指向该句自身位置，而非首次出现的同名句。
    const page2Text = index.pageText(2)!
    const tail = '第一章独有结尾。'
    const start = page2Text.indexOf(tail)
    const probe = index.locateRange({
      text: tail,
      start: { selectionId: 'page-2', offset: start },
      end: { selectionId: 'page-2', offset: start + tail.length }
    })
    if (probe.status !== 'located') throw new Error('probe should locate')
    const serialized = index.serializeRange(
      probe.parts[0]!.chapterIndex,
      probe.parts[0]!.range
    )
    expect(serialized?.start.offset).toBe(start)
    expect(serialized?.text).toBe(tail)
    await pkg.destroy()
  })
})

describe('epub compat index: unlocatable ranges are preserved as-is', () => {
  it('reports text-mismatch when stored text does not match the endpoints', async () => {
    const { index, pkg } = await buildIndex('epub/duplicate-text.epub')
    const location = index.locateRange({
      text: '被篡改的文本。',
      start: { selectionId: 'page-2', offset: 12 },
      end: { selectionId: 'page-2', offset: 20 }
    })
    expect(location).toEqual({
      status: 'unlocatable',
      reason: 'text-mismatch'
    })
    await pkg.destroy()
  })

  it('reports invalid-endpoints for unknown or malformed page ids', async () => {
    const { index, pkg } = await buildIndex('epub/duplicate-text.epub')
    for (const selectionId of ['page-99', 'page-0', 'sec-1', 'page-2x']) {
      const location = index.locateRange({
        text: 'x',
        start: { selectionId, offset: 0 },
        end: { selectionId, offset: 1 }
      })
      expect(location.status).toBe('unlocatable')
      expect(location.status === 'unlocatable' ? location.reason : null).toBe(
        'invalid-endpoints'
      )
    }
    await pkg.destroy()
  })

  it('reports degraded-section when the live document diverges', async () => {
    const { index, pkg } = await buildIndex('epub/duplicate-text.epub')
    // 模拟 foliate 活文档与旧管线分歧（例如非法实体 fallback）。
    const divergent = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>完全不同的内容</p></body></html>',
      'application/xhtml+xml'
    )
    expect(index.attachSectionDocument(1, divergent)).toBe(false)
    expect(index.sectionStatus(1)).toBe('degraded')

    const location = index.locateRange({
      text: '重复的段落文本。',
      start: { selectionId: 'page-2', offset: 12 },
      end: { selectionId: 'page-2', offset: 20 }
    })
    expect(location).toEqual({
      status: 'unlocatable',
      reason: 'degraded-section'
    })
    // 其他健康节不受影响。
    expect(index.sectionStatus(2)).toBe('healthy')
    await pkg.destroy()
  })

  it('locates ranges on the cover page of cover-in-spine books as empty text only', async () => {
    const { index, pkg } = await buildIndex('epub/cover-and-image-order.epub')
    // page-1 是纯封面图页，页文本为空；任何非空文本的 range 都不能定位。
    const location = index.locateRange({
      text: 'not empty',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 1 }
    })
    expect(location.status).toBe('unlocatable')
    await pkg.destroy()
  })
})
