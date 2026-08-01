import { IntermediateText, TextDir } from '@hamster-note/types'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IntermediateDocumentFlowTextContent } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentFlowTextContent'
import { normalizeGiantTxtContent } from '../src/components/IntermediateDocumentViewer/normalizeGiantTxtContent'

const makeGiantText = (content: string, lineCount: number) =>
  new IntermediateText({
    id: 'giant-text',
    content,
    fontSize: 1,
    fontFamily: 'monospace',
    fontWeight: 400,
    italic: false,
    color: '#000000',
    polygon: [
      [0, 0],
      [content.length, 0],
      [content.length, lineCount],
      [0, lineCount]
    ],
    lineHeight: 1,
    ascent: 0.8,
    descent: 0.2,
    dir: TextDir.LTR,
    skew: 0,
    isEOL: false
  })

describe('normalizeGiantTxtContent', () => {
  it.each([
    ['LF', 'A\n\nB\n'],
    ['CRLF', 'A\r\n\r\nB\r\n'],
    ['CR', 'A\r\rB\r']
  ])('preserves %s delimiters and empty logical lines', (_, source) => {
    // Given: parser 输出含内部空行与尾随换行的单个巨型文本。
    const lineCount = 4

    // When: 巨型文本被规范化为逐行条目。
    const normalized = normalizeGiantTxtContent(
      [makeGiantText(source, lineCount)],
      lineCount
    )
    const texts = normalized?.filter(
      (entry): entry is IntermediateText => entry instanceof IntermediateText
    )

    // Then: 分隔符、空行及每行 polygon 都与源行一一对应。
    expect(texts).toHaveLength(lineCount)
    expect(texts?.map((text) => text.content).join('')).toBe(source)
    expect(texts?.map((text) => text.polygon[0][1])).toEqual([0, 1, 2, 3])
    expect(texts?.[1]?.polygon[1][0]).toBe(0)
    expect(texts?.[3]?.content).toBe('')
  })

  it('renders internal and trailing empty lines as flow rows', () => {
    // Given: 规范化文本包含分隔符空行和尾随空行。
    const normalized = normalizeGiantTxtContent(
      [makeGiantText('A\n\nB\n', 4)],
      4
    )
    const texts =
      normalized?.filter(
        (entry): entry is IntermediateText => entry instanceof IntermediateText
      ) ?? []

    // When: Reader 的 flow renderer 输出这些逐行文本。
    const { container } = render(
      <IntermediateDocumentFlowTextContent
        pageNumber={1}
        texts={texts}
        paragraphs={[]}
        preserveSourceFontSize={false}
      />
    )

    // Then: 每个逻辑行均保留一个具有固定行高的 DOM 行盒。
    const rows = container.querySelectorAll(
      '.hamster-reader__intermediate-text--flow'
    )
    expect(rows).toHaveLength(4)
    expect(rows[1]?.textContent).toBe('\n')
    expect(rows[3]).toBeEmptyDOMElement()
  })
})
