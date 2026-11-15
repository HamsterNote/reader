import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { mergeOcrTexts, parseOcrSeed } from '../app/src/debug/ocrSeed'
import { nativeCanonicalPageFromOcr } from '../src/nativePdf/ocr'
import { restoreReaderSnapshot } from '../src/host/readerSnapshot'
import {
  materializeNativeRange,
  nativeSelectionPagesReady
} from '../src/nativePdf/selection'
import type { PdfCanonicalPage } from '../src/nativePdf/contracts'
import type { ReaderSelectionRange } from '../src/types/selection'

const fixture = (name: string) => join(process.cwd(), 'test/fixtures', name)
const seedRaw = JSON.parse(
  readFileSync(fixture('ham278-scanned-sample.ocr.json'), 'utf8')
)
const pdfBytes = readFileSync(fixture('ham278-scanned-sample.pdf'))

describe('scanned sample fixture (HAM-278 S12)', () => {
  it('is an image-only PDF with two pages and no text layer', () => {
    const text = pdfBytes.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    // 每页只有一张图片；没有任何字体对象 -> pdfjs 提取不到文字。
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(2)
    expect(text).not.toContain('/Type /Font')
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2)
    // 页面内容流只画图片，没有文本绘制指令。
    expect(text).toContain('/Im0 Do')
  })

  it('ships an OCR seed that matches the two sample pages', () => {
    const seed = parseOcrSeed(seedRaw)
    expect(seed).not.toBeNull()
    expect([...(seed?.pages.keys() ?? [])]).toEqual([1, 2])
    expect(seed?.pages.get(1)?.length).toBeGreaterThan(0)
    expect(seed?.pages.get(2)?.length).toBeGreaterThan(0)
    expect(seed?.ranges.map((range) => range['id'])).toEqual([
      'scanned-range-p1-p2'
    ])
  })

  it('keeps the pre-seeded range activatable from the seeded OCR text', () => {
    const seed = parseOcrSeed(seedRaw)!
    const pages = new Map<number, PdfCanonicalPage>()
    for (const [pageNumber, texts] of seed.pages) {
      const canonical = nativeCanonicalPageFromOcr(pageNumber, 612, 792, texts)
      expect(canonical).not.toBeNull()
      pages.set(pageNumber, canonical!)
    }
    const range = seed.ranges[0] as unknown as ReaderSelectionRange
    expect(
      nativeSelectionPagesReady(pages, [1, 2], range.start, range.end)
    ).toBe(true)
    const materialized = materializeNativeRange(
      range.start,
      range.end,
      pages,
      [1, 2],
      { id: range.id, createdAt: range.createdAt, color: '#ffc107' },
      range
    )
    expect(Object.keys(materialized.rectsBySelectionId).sort()).toEqual([
      'page-1',
      'page-2'
    ])
  })
})

describe('OCR seed merge', () => {
  it('writes readerData.ocrTexts without touching other snapshot fields', () => {
    const seed = parseOcrSeed(seedRaw)!
    const merged = mergeOcrTexts(
      {
        annotations: { version: 5 },
        readerData: { hiddenPages: [3], ocrTexts: { 7: [{ content: 'old' }] } }
      },
      seed
    )
    expect(merged.pages).toEqual([1, 2])
    expect(merged.texts).toBeGreaterThan(0)
    expect(merged.ranges).toBe(1)
    expect(merged.data['annotations']).toMatchObject({ version: 5 })
    expect(
      (merged.data['annotations'] as Record<string, unknown>)['ranges']
    ).toEqual([expect.objectContaining({ id: 'scanned-range-p1-p2' })])
    // 合并后的快照必须能被现有 v5 恢复逻辑读回，否则打开即报错。
    const restored = restoreReaderSnapshot(merged.data)
    expect(restored.data.ranges).toHaveLength(1)
    expect(
      Object.keys(restored.data.ranges![0]!.rectsBySelectionId).sort()
    ).toEqual(['page-1', 'page-2'])
    expect(merged.data['readerData']).toMatchObject({
      hiddenPages: [3]
    })
    const ocrTexts = (merged.data['readerData'] as Record<string, unknown>)[
      'ocrTexts'
    ] as Record<string, unknown>
    expect(Object.keys(ocrTexts).sort()).toEqual(['1', '2', '7'])
  })

  it('rejects seeds that would not produce canonical pages', () => {
    expect(parseOcrSeed(null)).toBeNull()
    expect(parseOcrSeed({ version: 2, pages: { 1: [] } })).toBeNull()
    expect(parseOcrSeed({ version: 1, pages: [] })).toBeNull()
    expect(
      parseOcrSeed({
        version: 1,
        pages: {
          1: [{ content: 'no polygon' }],
          2: [{ content: 'too few points', polygon: [[0, 0]] }]
        }
      })
    ).toBeNull()
  })
})
