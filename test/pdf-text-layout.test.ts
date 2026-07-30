import { IntermediateText, TextDir } from '@hamster-note/types'
import { describe, expect, it } from 'vitest'

import { reconstructPdfTextLayout } from '../src/components/IntermediateDocumentViewer/pdfTextLayout'

const makePdfText = ({
  id,
  content,
  x,
  y,
  width,
  fontSize = 12
}: {
  readonly id: string
  readonly content: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly fontSize?: number
}): IntermediateText =>
  new IntermediateText({
    id,
    content,
    fontSize,
    fontFamily: 'Test Sans',
    fontWeight: fontSize > 12 ? 700 : 400,
    italic: false,
    color: '#111827',
    polygon: [
      [x, y],
      [x + width, y],
      [x + width, y + fontSize],
      [x, y + fontSize]
    ],
    lineHeight: fontSize * 1.2,
    ascent: fontSize * 0.8,
    descent: fontSize * 0.2,
    dir: TextDir.LTR,
    skew: 0,
    isEOL: true
  })

describe('reconstructPdfTextLayout', () => {
  it('groups positioned CJK glyphs into one visual line despite per-glyph EOL flags', () => {
    // Given: 三个同基线中文字符，每个字符都带错误的 isEOL。
    const texts = [
      makePdfText({ id: 'cjk-1', content: '你', x: 10, y: 20, width: 12 }),
      makePdfText({ id: 'cjk-2', content: '好', x: 22, y: 20, width: 12 }),
      makePdfText({ id: 'cjk-3', content: '呀', x: 34, y: 20, width: 12 })
    ]

    // When: 按 PDF 几何信息重建文本结构。
    const layout = reconstructPdfTextLayout(texts)

    // Then: 字符仍是独立 glyph，但处于同一行且不会插入西文空格。
    expect(layout.paragraphs).toHaveLength(1)
    expect(layout.paragraphs[0]?.lines).toHaveLength(1)
    expect(
      layout.paragraphs[0]?.lines[0]?.glyphs.map((glyph) => ({
        content: glyph.text.content,
        spaceBefore: glyph.spaceBefore
      }))
    ).toEqual([
      { content: '你', spaceBefore: false },
      { content: '好', spaceBefore: false },
      { content: '呀', spaceBefore: false }
    ])
  })

  it('keeps normally spaced lines together and starts a paragraph after a large gap', () => {
    // Given: 前两行是正常行距，第三行之前有明显段间距。
    const texts = [
      makePdfText({ id: 'line-1', content: '第一行', x: 10, y: 10, width: 36 }),
      makePdfText({ id: 'line-2', content: '第二行', x: 10, y: 27, width: 36 }),
      makePdfText({ id: 'line-3', content: '新段落', x: 10, y: 62, width: 36 })
    ]

    // When: 重建页面段落。
    const layout = reconstructPdfTextLayout(texts)

    // Then: 正常行距形成同段，大间距形成新段。
    expect(
      layout.paragraphs.map((paragraph) => paragraph.lines.length)
    ).toEqual([2, 1])
  })

  it('inserts a space between Latin words when their boxes have a word-sized gap', () => {
    // Given: 两个拉丁单词在同一视觉行，中间留有明显词间距。
    const texts = [
      makePdfText({ id: 'latin-1', content: 'Hello', x: 10, y: 20, width: 30 }),
      makePdfText({ id: 'latin-2', content: 'world', x: 46, y: 20, width: 30 })
    ]

    // When: 重建视觉行。
    const layout = reconstructPdfTextLayout(texts)

    // Then: 第二个单词前补一个可读空格。
    expect(layout.paragraphs[0]?.lines[0]?.glyphs[1]?.spaceBefore).toBe(true)
  })

  it('ignores zero-height PDF whitespace helpers without falling back from positioned layout', () => {
    // Given: PDF parser 在有效正文之间输出一个零高度空格辅助条目。
    const texts = [
      makePdfText({ id: 'cjk', content: '正文', x: 10, y: 20, width: 24 }),
      makePdfText({
        id: 'space',
        content: ' ',
        x: 34,
        y: 32,
        width: 5,
        fontSize: 0
      }),
      makePdfText({ id: 'latin', content: 'PDF', x: 39, y: 20, width: 20 })
    ]

    // When: 按正文 box 重建视觉行。
    const layout = reconstructPdfTextLayout(texts)

    // Then: 辅助空格不会触发旧 flow 回退，正文仍组成一行并恢复词间空格。
    expect(layout.hasPositionedText).toBe(true)
    expect(
      layout.paragraphs[0]?.lines[0]?.glyphs.map((glyph) => ({
        content: glyph.text.content,
        spaceBefore: glyph.spaceBefore
      }))
    ).toEqual([
      { content: '正文', spaceBefore: false },
      { content: 'PDF', spaceBefore: true }
    ])
  })

  it('uses weighted body text as the font baseline and preserves title scale', () => {
    // Given: 一个 24px 标题和两个 12px 正文条目。
    const texts = [
      makePdfText({
        id: 'title',
        content: 'Title',
        x: 10,
        y: 10,
        width: 60,
        fontSize: 24
      }),
      makePdfText({
        id: 'body-1',
        content: 'Body text',
        x: 10,
        y: 50,
        width: 54
      }),
      makePdfText({
        id: 'body-2',
        content: 'More body',
        x: 10,
        y: 68,
        width: 54
      })
    ]

    // When: 计算 PDF 文本字号层级。
    const layout = reconstructPdfTextLayout(texts)
    const title = layout.paragraphs
      .flatMap((paragraph) => paragraph.lines)
      .flatMap((line) => line.glyphs)
      .find((glyph) => glyph.text.id === 'title')

    // Then: 正文是基准字号，标题保持二倍视觉层级。
    expect(layout.bodyFontSize).toBe(12)
    expect(title?.fontSizeRatio).toBe(2)
  })
})
