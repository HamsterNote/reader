// HAM-88 任务 2.3：旧逻辑页模型与旧解析链路的逐字对齐验证。
// 基准实现：@hamster-note/epub-parser + demo/epubForReader 转换层
// （HAM-87 样本 round-trip 使用的同一条链）；被测实现：
// src/epub/epubPackage + legacyText + legacyEpubModel。
// 三个 EPUB 样本的页数、页序、封面补页与页文本必须完全一致。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EpubParser } from '@hamster-note/epub-parser'
import type { IntermediateDocument } from '@hamster-note/types'
import { describe, expect, it } from 'vitest'

import { convertEpubDocumentForReader } from '../../demo/epubForReader'
import {
  getPageContentEntries,
  getRuntimeDocument,
  isIntermediateText
} from '../../src/components/IntermediateDocumentViewer/IntermediateDocumentViewer'
import { openEpubPackage } from '../../src/epub/epubPackage'
import { buildLegacyEpubModel } from '../../src/epub/legacyEpubModel'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')

const EPUB_FIXTURES = [
  'epub/cover-and-image-order.epub',
  'epub/spine-omits-cover.epub',
  'epub/duplicate-text.epub'
] as const

function readFixture(relativePath: string): Uint8Array {
  return readFileSync(join(FIXTURE_ROOT, relativePath))
}

async function getOldChainPageTexts(
  document: Pick<IntermediateDocument, 'pageCount' | 'getPageByPageNumber'>
): Promise<string[]> {
  const texts: string[] = []
  for (let n = 1; n <= document.pageCount; n += 1) {
    const pagePromise = document.getPageByPageNumber(n)
    if (!pagePromise) throw new Error(`missing page ${n}`)
    const page = await pagePromise
    const entries = await getPageContentEntries(
      page as Parameters<typeof getPageContentEntries>[0]
    )
    texts.push(
      entries
        .filter(isIntermediateText)
        .map((entry) => entry.content)
        .join('')
    )
  }
  return texts
}

describe('legacy epub model: equivalence with the old parsing chain', () => {
  it.each(EPUB_FIXTURES.map((fixture) => ({ fixture })))(
    '$fixture: page count, order and text match byte-for-byte',
    async ({ fixture }) => {
      const bytes = readFixture(fixture)

      const parsed = await EpubParser.encode(bytes)
      const oldDocument = await convertEpubDocumentForReader(parsed, bytes)
      const oldRuntime = getRuntimeDocument(oldDocument)
      if (!oldRuntime) throw new Error('Expected runtime document')
      const oldTexts = await getOldChainPageTexts(oldRuntime)

      const pkg = await openEpubPackage(bytes)
      const model = await buildLegacyEpubModel(pkg)
      await pkg.destroy()

      expect(model.pages.map((page) => page.pageNumber)).toEqual(
        oldTexts.map((_, index) => index + 1)
      )
      expect(model.pages.map((page) => page.pageId)).toEqual(
        oldTexts.map((_, index) => `page-${index + 1}`)
      )
      expect(model.pages.map((page) => page.text)).toEqual(oldTexts)
    }
  )

  it('spine-omits-cover.epub prepends the manifest cover page', async () => {
    const pkg = await openEpubPackage(
      readFixture('epub/spine-omits-cover.epub')
    )
    const model = await buildLegacyEpubModel(pkg)
    await pkg.destroy()

    expect(model.coverPrepended).toBe(true)
    // 与 demo getEpubImageMetadata 的 coverAlt 规则一致：manifest 顺序扫描全部
    // xhtml，首个引用封面图的 img alt（本样本是 chapter2 复用封面图的 alt）。
    expect(model.cover?.alt).toBe('Reused cover artwork')
    expect(model.pages[0]).toMatchObject({
      pageNumber: 1,
      pageId: 'page-1',
      chapterIndex: null,
      text: ''
    })
    // 正文页序后移：page-2/page-3 是 spine 两章。
    expect(model.pages[1]?.chapterIndex).toBe(0)
    expect(model.pages[2]?.chapterIndex).toBe(1)
  })

  it('cover-and-image-order.epub keeps the in-spine cover as page-1 without prepending', async () => {
    const pkg = await openEpubPackage(
      readFixture('epub/cover-and-image-order.epub')
    )
    const model = await buildLegacyEpubModel(pkg)
    await pkg.destroy()

    expect(model.coverPrepended).toBe(false)
    expect(model.pages).toHaveLength(3)
    expect(model.pages[0]?.chapterIndex).toBe(0)
  })

  it('rejects corrupt input with EpubPackageError', async () => {
    const garbage = new TextEncoder().encode('not an epub at all')
    await expect(openEpubPackage(garbage)).rejects.toThrow(/Invalid EPUB|zip/i)
  })
})
