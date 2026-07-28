import { IntermediateText, TextDir } from '@hamster-note/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PdfTextContent } from '../src/components/IntermediateDocumentViewer/PdfTextContent'

const makeGlyph = ({
  id,
  content,
  x,
  y,
  fontSize = 12,
  color = '#123456'
}: {
  readonly id: string
  readonly content: string
  readonly x: number
  readonly y: number
  readonly fontSize?: number
  readonly color?: string
}): IntermediateText =>
  new IntermediateText({
    id,
    content,
    fontSize,
    fontFamily: 'PDF Sans',
    fontWeight: fontSize > 12 ? 700 : 400,
    italic: fontSize > 12,
    color,
    polygon: [
      [x, y],
      [x + fontSize, y],
      [x + fontSize, y + fontSize],
      [x, y + fontSize]
    ],
    lineHeight: fontSize * 1.2,
    ascent: fontSize * 0.8,
    descent: fontSize * 0.2,
    dir: TextDir.LTR,
    skew: 0,
    isEOL: true
  })

describe('PdfTextContent', () => {
  it('naturally reflows visual lines that belong to the same paragraph', () => {
    // Given: PDF 中两个相邻视觉行属于同一段，且行尾与下一行行首构成英文单词边界。
    const firstLine = makeGlyph({
      id: 'pdf-line-1',
      content: 'Hello',
      x: 10,
      y: 20
    })
    const secondLine = makeGlyph({
      id: 'pdf-line-2',
      content: 'world',
      x: 10,
      y: 37
    })

    // When: PDF Text 模式渲染重建后的段落。
    const { container } = render(
      <PdfTextContent
        pageNumber={1}
        texts={[firstLine, secondLine]}
        paragraphs={[]}
      />
    )

    // Then: 源视觉行不再形成强制换行，并以自然词间距合并为一个可重排段落。
    const paragraphs = container.querySelectorAll(
      '.hamster-reader__pdf-text-paragraph'
    )
    expect(paragraphs).toHaveLength(1)
    expect(container.querySelectorAll('.hamster-reader__pdf-text-line')).toHaveLength(0)
    expect(paragraphs[0]?.textContent).toBe('Hello world')
    expect(container.querySelectorAll('[data-text-id]')).toHaveLength(2)
  })

  it('renders reconstructed paragraphs while preserving glyph identities and relative fonts', () => {
    // Given: 标题和两个被错误标成 EOL 的同一行 PDF 字符。
    const title = makeGlyph({
      id: 'pdf-title',
      content: '题',
      x: 10,
      y: 10,
      fontSize: 24
    })
    const firstGlyph = makeGlyph({
      id: 'pdf-character-1',
      content: '你',
      x: 10,
      y: 52
    })
    const secondGlyph = makeGlyph({
      id: 'pdf-character-2',
      content: '好',
      x: 22,
      y: 52
    })
    const setTextRef = vi.fn(() => vi.fn())

    // When: PDF Text 模式按 box 重建并以 1.5 倍基础字号渲染。
    const { container } = render(
      <PdfTextContent
        pageNumber={1}
        texts={[title, firstGlyph, secondGlyph]}
        paragraphs={[]}
        setTextRef={setTextRef}
        fontScale={1.5}
      />
    )

    // Then: 正文字符同行且保留选择锚点，标题按二倍层级并保留字体样式。
    const paragraphs = container.querySelectorAll(
      '.hamster-reader__pdf-text-paragraph'
    )
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1]?.textContent).toBe('你好')
    expect(screen.getByText('你')).toHaveAttribute('data-text-id', firstGlyph.id)
    expect(screen.getByText('好')).toHaveAttribute('data-text-id', secondGlyph.id)
    const titleElement = screen.getByText('题')
    expect(titleElement.style.fontSize).toBe('3rem')
    expect(titleElement.style.fontFamily).toContain('PDF Sans')
    expect(titleElement.style.fontWeight).toBe('700')
    expect(titleElement.style.fontStyle).toBe('italic')
    expect(titleElement.style.color).toBe('rgb(18, 52, 86)')
    expect(setTextRef).toHaveBeenCalledTimes(3)
  })

  it('keeps visible Text mode glyphs readable when source color is transparent', () => {
    // Given: OCR/PDF 元数据把文字颜色标记为透明，但 Text 模式是可见正文层。
    const glyph = makeGlyph({
      id: 'transparent-pdf-character',
      content: 'Visible text',
      x: 10,
      y: 10,
      color: 'transparent'
    })

    // When: PDF Text 模式渲染该字形。
    render(
      <PdfTextContent
        pageNumber={1}
        texts={[glyph]}
        paragraphs={[]}
      />
    )

    // Then: 可见正文不继承透明色，而由 Reader 的正文色统一控制。
    expect(screen.getByText('Visible text').style.color).toBe('')
  })
})
