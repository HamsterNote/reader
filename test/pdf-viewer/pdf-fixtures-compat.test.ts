// @vitest-environment node
//
// HAM-89 / tasks.md 3.2：pdfjs-dist 官方链路的页文本与 canonical 坐标系
// 对第 1 组契约样本逐字一致（空白/换行/连字/多栏/跨页）。期望值来自
// openspec/.../contracts/sample-manifest.md 与 generate-fixtures.mjs 固定的
// 旧解析链路输出。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { IntermediateText } from '@hamster-note/types'
import { describe, expect, it } from 'vitest'

import type { TextItem } from '../../src/pdf/pdfjsRuntime'

import { parseHighlights } from '../../demo/highlightStorage'
import { buildCanonicalPageText } from '../../src/pdf/pdfTextMapping'
import { createPdfTextModeDocument } from '../../src/pdf/pdfTextModeDocument'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')

function readFixtureArrayBuffer(relativePath: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURE_ROOT, relativePath))
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  )
}

async function openFixture(relativePath: string): Promise<PDFDocumentProxy> {
  return getDocument({
    data: new Uint8Array(readFixtureArrayBuffer(relativePath)),
    isEvalSupported: false
  }).promise
}

async function getCanonicalTexts(
  document: PDFDocumentProxy
): Promise<string[]> {
  const texts: string[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const canonical = buildCanonicalPageText(
      pageNumber,
      content.items.filter((item): item is TextItem => 'str' in item)
    )
    texts.push(canonical.text)
  }
  return texts
}

describe('pdfjs 官方链路：canonical 页文本与契约样本逐字一致', () => {
  it('two-column.pdf 保持绘制顺序拼接（多栏）', async () => {
    const document = await openFixture('pdf/two-column.pdf')
    try {
      const texts = await getCanonicalTexts(document)
      expect(texts).toEqual([
        'Left column line oneLeft column line twoRight column line oneRight column line two',
        'Second page continues the article'
      ])
    } finally {
      await document.destroy()
    }
  })

  it('rotated.pdf 旋转页文本完整提取，可视尺寸宽高交换', async () => {
    const document = await openFixture('pdf/rotated.pdf')
    try {
      const texts = await getCanonicalTexts(document)
      expect(texts).toEqual(['Rotated page text'])

      const page = await document.getPage(1)
      const viewport = page.getViewport({ scale: 1 })
      expect(page.rotate).toBe(90)
      expect([viewport.width, viewport.height]).toEqual([300, 400])
    } finally {
      await document.destroy()
    }
  })

  it('ligature.pdf 连字 U+FB01 在 textContent 层已分解为 fi（与旧链路一致）', async () => {
    const document = await openFixture('pdf/ligature.pdf')
    try {
      const texts = await getCanonicalTexts(document)
      expect(texts).toEqual(['fi x'])
    } finally {
      await document.destroy()
    }
  })
})

describe('pdfjs 官方链路：v2/v3/v4 高亮端点在 canonical 坐标系逐字命中', () => {
  it.each(['v2', 'v3', 'v4'])(
    'pdf-two-column.%s.json 端点 slice === range.text（含跨页拼接）',
    async (version) => {
      const document = await openFixture('pdf/two-column.pdf')
      try {
        const pageTexts = await getCanonicalTexts(document)
        const raw = readFileSync(
          join(FIXTURE_ROOT, `highlights/pdf-two-column.${version}.json`),
          'utf8'
        )
        const parsed = parseHighlights(raw)
        expect(parsed).not.toBeNull()
        expect(parsed!.ranges.length).toBeGreaterThan(0)

        for (const range of parsed!.ranges) {
          const startPage = Number(
            /^page-(\d+)$/.exec(range.start.selectionId)![1]
          )
          const endPage = Number(/^page-(\d+)$/.exec(range.end.selectionId)![1])
          const startText = pageTexts[startPage - 1]
          const endText = pageTexts[endPage - 1]
          const sliced =
            startPage === endPage
              ? startText.slice(range.start.offset, range.end.offset)
              : startText.slice(range.start.offset) +
                endText.slice(0, range.end.offset)
          expect(sliced).toBe(range.text)
        }
      } finally {
        await document.destroy()
      }
    }
  )
})

describe('Text 模式派生文档（createPdfTextModeDocument）', () => {
  it('页文本与 canonical 坐标系逐字一致，页 ID 为 page-N', async () => {
    const document = await openFixture('pdf/two-column.pdf')
    try {
      const facade = await createPdfTextModeDocument(document, 'two-column')
      expect(facade.document.pageCount).toBe(2)
      expect(facade.document.pageNumbers).toEqual([1, 2])

      const page1 = await facade.document.getPageByPageNumber(1)
      expect(page1).toBeDefined()
      expect(page1!.width).toBe(400)
      expect(page1!.height).toBe(300)

      const texts = page1!.content
        .map((item) => (item as IntermediateText).content)
        .join('')
      expect(texts).toBe(
        'Left column line oneLeft column line twoRight column line oneRight column line two'
      )
      // Text 模式页内容与 canonical 缓存同源。
      expect(facade.getCanonicalPageText(1)?.text).toBe(texts)
    } finally {
      await document.destroy()
    }
  })

  it('旋转页尺寸与旧链路一致（300x400）', async () => {
    const document = await openFixture('pdf/rotated.pdf')
    try {
      const facade = await createPdfTextModeDocument(document, 'rotated')
      const page = await facade.document.getPageByPageNumber(1)
      expect([page!.width, page!.height]).toEqual([300, 400])
    } finally {
      await document.destroy()
    }
  })
})
