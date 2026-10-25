// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.1。
// 旧读入器 EPUB round-trip：验证基线版本能完整读取全部 EPUB 样本，
// 并校验同文件 v2/v3/v4 高亮 JSON 的端点在旧页文本坐标系中逐字成立。
// 样本矩阵与来源清单见
// openspec/changes/migrate-reader-to-expo-webview/contracts/sample-manifest.md。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EpubParser } from '@hamster-note/epub-parser'
import type { IntermediateDocument } from '@hamster-note/types'
import { describe, expect, it } from 'vitest'

import { convertEpubDocumentForReader } from '../../demo/epubForReader'
import { parseHighlights } from '../../demo/highlightStorage'
import {
  getPageContentEntries,
  getRuntimeDocument,
  isIntermediateImage,
  isIntermediateText
} from '../../src/components/IntermediateDocumentViewer/IntermediateDocumentViewer'

const FIXTURE_ROOT = join(__dirname, 'fixtures')

function readFixture(relativePath: string): Uint8Array {
  return readFileSync(join(FIXTURE_ROOT, relativePath))
}

async function getPageTexts(
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

describe('compat fixtures: epub parsing', () => {
  it('reads cover-and-image-order.epub with stable spine order and image order', async () => {
    // Given: 封面在 spine 首位、正文含外链图与重复章插图的样本。
    const bytes = readFixture('epub/cover-and-image-order.epub')

    // When: 旧解析链路读取并进入 Reader 转换层。
    const parsed = await EpubParser.encode(bytes)
    const document = await convertEpubDocumentForReader(parsed, bytes)
    const runtimeDocument = getRuntimeDocument(document)
    if (!runtimeDocument) throw new Error('Expected runtime document')

    // Then: 封面 page-1，正文页序与文本不变。
    expect(runtimeDocument.pageCount).toBe(3)
    const pageTexts = await getPageTexts(runtimeDocument)
    expect(pageTexts).toEqual([
      '',
      'Chapter 1Hello EPUB text modeText after chapter illustration',
      'Chapter 2Second chapter text'
    ])

    // Then: 封面图只在 page-1 出现一次；章插图保留 alt 与文中位置。
    const coverPage = await runtimeDocument.getPageByPageNumber(1)
    if (!coverPage) throw new Error('missing cover page')
    const coverEntries = await getPageContentEntries(coverPage)
    const coverImages = coverEntries.filter(isIntermediateImage)
    expect(coverImages).toHaveLength(1)
    expect(Reflect.get(coverImages[0] ?? {}, 'alt')).toBe('Book cover')
  })

  it('prepends the manifest cover when spine omits it', async () => {
    // Given: manifest 声明封面但 spine 省略封面页的样本。
    const bytes = readFixture('epub/spine-omits-cover.epub')

    // When: 旧转换层补封面。
    const parsed = await EpubParser.encode(bytes)
    const document = await convertEpubDocumentForReader(parsed, bytes)
    const runtimeDocument = getRuntimeDocument(document)
    if (!runtimeDocument) throw new Error('Expected runtime document')

    // Then: 补出的封面为 page-1，正文页序后移不丢内容。
    expect(runtimeDocument.pageCount).toBe(3)
    const pageTexts = await getPageTexts(runtimeDocument)
    expect(pageTexts[0]).toBe('')
    expect(pageTexts[1]).toContain('Hello EPUB text mode')
    expect(pageTexts[2]).toContain('Second chapter text')
  })

  it('keeps duplicate paragraphs on their own pages in duplicate-text.epub', async () => {
    // Given: 第 1、3 章含逐字相同段落的样本。
    const bytes = readFixture('epub/duplicate-text.epub')

    // When/Then: 两处重复文本分别位于 page-2 与 page-4，页文本逐字固定。
    const parsed = await EpubParser.encode(bytes)
    const document = await convertEpubDocumentForReader(parsed, bytes)
    const runtimeDocument = getRuntimeDocument(document)
    if (!runtimeDocument) throw new Error('Expected runtime document')
    expect(runtimeDocument.pageCount).toBe(4)
    const pageTexts = await getPageTexts(runtimeDocument)
    expect(pageTexts[1]).toBe(
      '第一章起始段落在第一章。重复的段落文本。第一章独有结尾。'
    )
    expect(pageTexts[2]).toBe(
      '第二章第二章开头完全不同。第二章结尾与第三章开头相连。'
    )
    expect(pageTexts[3]).toBe('第三章重复的段落文本。第三章独有结尾。')
  })
})

describe('compat fixtures: epub highlight json endpoints', () => {
  const versions = [2, 3, 4] as const

  it.each(versions.map((version) => [version] as const))(
    'v%i highlight endpoints resolve against duplicate-text.epub page text',
    async (version) => {
      // Given: 同文件 v2/v3/v4 高亮 JSON。
      const raw = readFileSync(
        join(FIXTURE_ROOT, `highlights/epub-duplicate-text.v${version}.json`),
        'utf8'
      )
      const parsed = parseHighlights(raw)
      expect(parsed.ranges).toHaveLength(2)

      // When: 旧解析链路给出页文本。
      const bytes = readFixture('epub/duplicate-text.epub')
      const parsedEpub = await EpubParser.encode(bytes)
      const document = await convertEpubDocumentForReader(parsedEpub, bytes)
      const runtimeDocument = getRuntimeDocument(document)
      if (!runtimeDocument) throw new Error('Expected runtime document')
      const pageTexts = await getPageTexts(runtimeDocument)

      // Then: 每条 range 的端点在页内拼接文本坐标系中逐字命中 text。
      for (const range of parsed.ranges) {
        const startPage = Number(range.start.selectionId.replace('page-', ''))
        const endPage = Number(range.end.selectionId.replace('page-', ''))
        const reconstructed =
          startPage === endPage
            ? pageTexts[startPage - 1]?.slice(
                range.start.offset,
                range.end.offset
              )
            : (pageTexts[startPage - 1]?.slice(range.start.offset) ?? '') +
              (pageTexts[endPage - 1]?.slice(0, range.end.offset) ?? '')
        expect(reconstructed).toBe(range.text)
      }

      // And: 重复文本 range 锚定第一次出现（page-2），而非 page-4 的同段落。
      const duplicate = parsed.ranges.find(
        (range) => range.id === 'epub-range-duplicate-first'
      )
      if (!duplicate) throw new Error('missing duplicate range')
      expect(duplicate.text).toBe('重复的段落文本。')
      expect(duplicate.start.selectionId).toBe('page-2')
    }
  )
})
