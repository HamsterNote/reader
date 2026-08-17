import { IntermediateText, TextDir } from '@hamster-note/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IntermediateDocumentFlowContent } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentFlowContent'
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
    expect(
      container.querySelectorAll('.hamster-reader__pdf-text-line')
    ).toHaveLength(0)
    expect(paragraphs[0]?.textContent).toBe('Hello world')
    expect(container.querySelectorAll('[data-text-id]')).toHaveLength(2)
    expect(screen.getByText('Hello')).toHaveAttribute(
      'data-selection-start-offset',
      '0'
    )
    expect(screen.getByText('world')).toHaveAttribute(
      'data-selection-start-offset',
      '5'
    )
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
    expect(screen.getByText('你')).toHaveAttribute(
      'data-text-id',
      firstGlyph.id
    )
    expect(screen.getByText('好')).toHaveAttribute(
      'data-text-id',
      secondGlyph.id
    )
    const titleElement = screen.getByText('题')
    expect(titleElement.style.fontSize).toBe('3rem')
    expect(titleElement.style.fontFamily).toContain('PDF Sans')
    expect(titleElement.style.fontWeight).toBe('700')
    expect(titleElement.style.fontStyle).toBe('italic')
    expect(titleElement.style.color).toBe('rgb(18, 52, 86)')
    expect(setTextRef).toHaveBeenCalledTimes(3)
  })

  it('keeps source offsets distinct when PDF glyph ids repeat', () => {
    // Given: 两个源字形共享展示 id，但在 canonical stream 中处于不同位置。
    const firstGlyph = makeGlyph({
      id: 'duplicate-pdf-glyph',
      content: 'Hello',
      x: 10,
      y: 20
    })
    const secondGlyph = makeGlyph({
      id: 'duplicate-pdf-glyph',
      content: 'world',
      x: 40,
      y: 20
    })

    // When: PDF Text 模式渲染两个源对象。
    const { container } = render(
      <PdfTextContent
        pageNumber={1}
        texts={[firstGlyph, secondGlyph]}
        paragraphs={[]}
      />
    )

    // Then: marker 由源对象身份关联，不会被重复 id 覆盖。
    expect(
      Array.from(
        container.querySelectorAll('[data-text-id="duplicate-pdf-glyph"]'),
        (element) => element.getAttribute('data-selection-start-offset')
      )
    ).toEqual(['0', '5'])
  })

  it('continues page-level source offsets after an image splits PDF text runs', () => {
    // Given: 图片前的 PDF 文字已经占用了 canonical stream 的前 5 个字符。
    const glyphAfterImage = makeGlyph({
      id: 'pdf-glyph-after-image',
      content: 'world',
      x: 10,
      y: 20
    })

    // When: 图片后的文字 run 从页级 offset 5 继续渲染。
    render(
      <PdfTextContent
        pageNumber={1}
        texts={[glyphAfterImage]}
        paragraphs={[]}
        sourceOffsetBase={5}
      />
    )

    // Then: selection marker 不会从 0 重新开始。
    expect(screen.getByText('world')).toHaveAttribute(
      'data-selection-start-offset',
      '5'
    )
  })

  it('preserves parser-stream offsets after visually ordering PDF glyphs', () => {
    // Given: 解析器先返回右栏、再返回左栏，但 Text 模式需要按视觉位置展示左栏、右栏。
    const rightColumn = makeGlyph({
      id: 'pdf-right-column',
      content: 'Right',
      x: 200,
      y: 20
    })
    const leftColumn = makeGlyph({
      id: 'pdf-left-column',
      content: 'Left',
      x: 10,
      y: 20
    })

    // When: PDF flow 内容按几何位置重排并渲染。
    const { container } = render(
      <IntermediateDocumentFlowContent
        pageNumber={1}
        content={[rightColumn, leftColumn]}
        paragraphs={[]}
        isPdf
        preserveSourceFontSize={false}
      />
    )

    // Then: DOM 保持视觉顺序，但 selection offset 仍指向原始 parser stream。
    expect(
      Array.from(container.querySelectorAll('[data-text-id]'), (element) =>
        element.getAttribute('data-text-id')
      )
    ).toEqual(['pdf-left-column', 'pdf-right-column'])
    expect(screen.getByText('Right')).toHaveAttribute(
      'data-selection-start-offset',
      '0'
    )
    expect(screen.getByText('Left')).toHaveAttribute(
      'data-selection-start-offset',
      String(rightColumn.content.length)
    )
  })

  it('preserves parser-stream anchors when PDF layout falls back', () => {
    // Given: 一个 glyph 缺少有效 polygon，整组 PDF 文本需要走通用 flow fallback。
    const positioned = makeGlyph({
      id: 'pdf-positioned-fallback',
      content: 'Positioned',
      x: 200,
      y: 20
    })
    const unpositioned = makeGlyph({
      id: 'pdf-unpositioned-fallback',
      content: 'Fallback',
      x: 10,
      y: 20
    })
    unpositioned.polygon = [
      [Number.NaN, Number.NaN],
      [Number.NaN, Number.NaN],
      [Number.NaN, Number.NaN],
      [Number.NaN, Number.NaN]
    ]

    // When: fallback renderer 输出 parser 顺序文本。
    render(
      <PdfTextContent
        pageNumber={1}
        texts={[positioned, unpositioned]}
        paragraphs={[]}
      />
    )

    // Then: 每个 span 仍携带 canonical parser-stream anchor。
    expect(screen.getByText('Positioned')).toHaveAttribute(
      'data-selection-start-offset',
      '0'
    )
    expect(screen.getByText('Fallback')).toHaveAttribute(
      'data-selection-start-offset',
      String(positioned.content.length)
    )
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
    render(<PdfTextContent pageNumber={1} texts={[glyph]} paragraphs={[]} />)

    // Then: 可见正文不继承透明色，而由 Reader 的正文色统一控制。
    expect(screen.getByText('Visible text').style.color).toBe('')
  })

  it('applies the selected Text mode line height to reconstructed PDF glyphs', () => {
    // Given: PDF Text Mode 使用 1.8 倍行距。
    const glyph = makeGlyph({
      id: 'custom-line-height-character',
      content: 'Comfortable line spacing',
      x: 10,
      y: 10
    })

    // When: 渲染重建后的 PDF 正文。
    render(
      <PdfTextContent
        pageNumber={1}
        texts={[glyph]}
        paragraphs={[]}
        lineHeight={1.8}
      />
    )

    // Then: 用户选择值应用到实际文字 span，而不是继续使用默认值。
    expect(screen.getByText('Comfortable line spacing')).toHaveStyle({
      lineHeight: '1.8'
    })
  })
})
