// @vitest-environment node
//
// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.1。
// 旧读入器 PDF round-trip：验证基线 @hamster-note/pdf-parser 能读取全部
// PDF 样本（多栏、旋转、连字），并校验同文件 v2/v3/v4 高亮 JSON 的端点在
// 旧页文本坐标系中逐字成立。pdfjs 需要在 Node 环境运行，故本文件用 node
// 环境而不是默认 jsdom。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PdfParser } from '@hamster-note/pdf-parser'
import { describe, expect, it } from 'vitest'

import { parseHighlights } from '../../demo/highlightStorage'

const FIXTURE_ROOT = join(__dirname, 'fixtures')

function readFixtureArrayBuffer(relativePath: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURE_ROOT, relativePath))
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  )
}

async function getPdfPageTexts(source: ArrayBuffer): Promise<{
  pageTexts: string[]
  pageSizes: Array<{ width: number; height: number }>
}> {
  const handle = await PdfParser.openDocument(source)
  try {
    const pageTexts: string[] = []
    const pageSizes: Array<{ width: number; height: number }> = []
    for (let n = 1; n <= handle.pageCount; n += 1) {
      const page = await handle.document.getPageByPageNumber(n)
      const entries = await page.getContent()
      pageTexts.push(
        (entries as Array<{ content?: unknown }>)
          .filter((entry) => typeof entry.content === 'string')
          .map((entry) => entry.content as string)
          .join('')
      )
      pageSizes.push({ width: page.width, height: page.height })
    }
    return { pageTexts, pageSizes }
  } finally {
    await handle.dispose?.()
  }
}

describe('compat fixtures: pdf parsing', () => {
  it('reads two-column.pdf preserving column draw order as text order', async () => {
    // Given/When: 双栏两页样本走旧 pdf-parser。
    const { pageTexts, pageSizes } = await getPdfPageTexts(
      readFixtureArrayBuffer('pdf/two-column.pdf')
    )

    // Then: 页数、页面尺寸与逐字文本固定；左栏文本先于右栏。
    expect(pageSizes).toEqual([
      { width: 400, height: 300 },
      { width: 400, height: 300 }
    ])
    expect(pageTexts).toEqual([
      'Left column line oneLeft column line twoRight column line oneRight column line two',
      'Second page continues the article'
    ])
  })

  it('reads rotated.pdf with rotation applied to page size', async () => {
    // Given/When: /Rotate 90 的单页样本。
    const { pageTexts, pageSizes } = await getPdfPageTexts(
      readFixtureArrayBuffer('pdf/rotated.pdf')
    )

    // Then: 可视尺寸随旋转交换宽高，文本完整提取。
    expect(pageSizes).toEqual([{ width: 300, height: 400 }])
    expect(pageTexts).toEqual(['Rotated page text'])
  })

  it('reads ligature.pdf decomposing the fi ligature glyph to two characters', async () => {
    // Given/When: 单个字形经 ToUnicode 映射 U+FB01 的样本。
    const { pageTexts } = await getPdfPageTexts(
      readFixtureArrayBuffer('pdf/ligature.pdf')
    )

    // Then: 文本层按 NFKC 分解连字，页内拼接文本逐字固定为 "fi x"。
    expect(pageTexts).toEqual(['fi x'])
  })
})

describe('compat fixtures: pdf highlight json endpoints', () => {
  const versions = [2, 3, 4] as const

  it.each(versions.map((version) => [version] as const))(
    'v%i highlight endpoints resolve against two-column.pdf page text',
    async (version) => {
      // Given: 同文件 v2/v3/v4 高亮 JSON。
      const raw = readFileSync(
        join(FIXTURE_ROOT, `highlights/pdf-two-column.v${version}.json`),
        'utf8'
      )
      const parsed = parseHighlights(raw)
      expect(parsed.ranges).toHaveLength(2)

      // When: 旧解析链路给出页文本。
      const { pageTexts } = await getPdfPageTexts(
        readFixtureArrayBuffer('pdf/two-column.pdf')
      )

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

      // And: 跨页 range 跨越右栏第二行与第二页开头。
      const crossPage = parsed.ranges.find(
        (range) => range.id === 'pdf-range-cross-page'
      )
      if (!crossPage) throw new Error('missing cross-page range')
      expect(crossPage.text).toBe('Right column line twoSecond page')
    }
  )
})
