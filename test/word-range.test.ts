import { describe, expect, it } from 'vitest'
import { createWordRangeFromCaret } from '../src/components/selection/wordRange'

// ── 测试辅助函数 ──────────────────────────────────────────────

/** 创建 collapsed Range（插入点），用于模拟 caret 位置 */
function makeCaretRange(text: string, offset: number): Range {
  const textNode = document.createTextNode(text)
  const range = document.createRange()
  range.setStart(textNode, offset)
  range.collapse(true)
  return range
}

/** 从 Range 提取纯文本 */
function rangeToText(range: Range): string {
  return range.toString()
}

function makeNonCollapsedRange(
  text: string,
  start: number,
  end: number
): Range {
  const textNode = document.createTextNode(text)
  const range = document.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, end)
  return range
}

// ── 测试套件 ──────────────────────────────────────────────────
// 注意：Node 24+ 内置 Intl.Segmenter，因此测试走的是 segmenter 路径，
// 而非回退的字符类别扩展路径。此处测试覆盖真实运行路径。

describe('createWordRangeFromCaret', () => {
  // ---------------------------------------------------------------------------
  // 1. 英文单词 "hello" 中任意 caret 位置 → 选中 "hello"
  // ---------------------------------------------------------------------------
  it('选中英文单词 "hello" 中任意位置', () => {
    for (const pos of [0, 1, 2, 3, 4]) {
      const range = createWordRangeFromCaret(makeCaretRange('hello', pos))
      expect(range, `pos=${pos} 应返回非 null`).not.toBeNull()
      expect(rangeToText(range!), `pos=${pos} 应选中 "hello"`).toBe('hello')
    }
  })

  // ---------------------------------------------------------------------------
  // 2. 带标点 "hello," → 选中 "hello"
  // ---------------------------------------------------------------------------
  it('带标点 "hello," 选中 "hello"（caret 在单词内）', () => {
    const range = createWordRangeFromCaret(makeCaretRange('hello,', 0)) // caret 在 'h'
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('hello')
  })

  it('"hello," 中 caret 在词末边界仍选中 "hello"', () => {
    // Intl.Segmenter: "hello"(0-5) 和 ","(5-6) 边界
    // 边界包含策略选择左侧 "hello"
    const range = createWordRangeFromCaret(makeCaretRange('hello,', 5))
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('hello')
  })

  // ---------------------------------------------------------------------------
  // 3. 多个单词 "hello world" → 只选中一个单词
  // ---------------------------------------------------------------------------
  it('多个单词 "hello world" 只选中一个', () => {
    // caret 在 'hello' 部分
    const r1 = createWordRangeFromCaret(makeCaretRange('hello world', 2))
    expect(r1).not.toBeNull()
    expect(rangeToText(r1!)).toBe('hello')

    // caret 在 'world' 部分
    const r2 = createWordRangeFromCaret(makeCaretRange('hello world', 8))
    expect(r2).not.toBeNull()
    expect(rangeToText(r2!)).toBe('world')
  })

  it('"hello world" caret 在空白边界上选中左侧单词', () => {
    // Intl.Segmenter: offset 5 在 "hello"(0-5) 和 " "(5-6) 边界
    const range = createWordRangeFromCaret(makeCaretRange('hello world', 5))
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('hello')
  })

  // ---------------------------------------------------------------------------
  // 4. 纯空白 → 返回 null
  // ---------------------------------------------------------------------------
  it('纯空白返回 null', () => {
    const range = createWordRangeFromCaret(makeCaretRange('   ', 1))
    expect(range).toBeNull()
  })

  it('前导空白，caret 在空白上返回 null', () => {
    // Intl.Segmenter: 空格是 isWordLike=false → 返回 null
    const range = createWordRangeFromCaret(makeCaretRange('  hello', 0))
    expect(range).toBeNull()
  })

  it('前导空白，caret 在单词内正常选中', () => {
    const range = createWordRangeFromCaret(makeCaretRange('  hello', 3))
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('hello')
  })

  // ---------------------------------------------------------------------------
  // 5. 中文字符串
  //    Intl.Segmenter(granularity:'word') 将 CJK 按词组切分，
  //    例如 "你好世界" → ["你好"(0-2), "世界"(2-4)]
  // ---------------------------------------------------------------------------
  it('中文字符串选中一个词组（Intl.Segmenter）', () => {
    const range = createWordRangeFromCaret(makeCaretRange('你好世界', 2))
    // offset 2 在 "你好"(0-2) 和 "世界"(2-4) 边界 → 选中左侧 "你好"
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('你好')
  })

  it('中文字符串中 caret 在词组内部选中该词组', () => {
    const range = createWordRangeFromCaret(makeCaretRange('你好世界', 3))
    // offset 3 在 "世界"(2-4) 内部 → 选中 "世界"
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('世界')
  })

  it('中日韩混合文字按 Intl.Segmenter 词组选中', () => {
    // Intl.Segmenter: "こんにちは"(0-5) + "世界"(5-7)
    const range = createWordRangeFromCaret(makeCaretRange('こんにちは世界', 3))
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('こんにちは')
  })

  // ---------------------------------------------------------------------------
  // 6. 非文本节点 → null
  // ---------------------------------------------------------------------------
  it('非文本节点返回 null', () => {
    const div = document.createElement('div')
    const range = document.createRange()
    range.setStart(div, 0)
    range.collapse(true)
    expect(createWordRangeFromCaret(range)).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 7. 非 collapsed range → null
  // ---------------------------------------------------------------------------
  it('非 collapsed range 返回 null', () => {
    const range = makeNonCollapsedRange('hello world', 0, 5)
    expect(range.collapsed).toBe(false)
    expect(createWordRangeFromCaret(range)).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // 8. 安全：输入 range 不被修改
  // ---------------------------------------------------------------------------
  it('不修改输入 range', () => {
    const input = makeCaretRange('hello', 2)
    const savedContainer = input.startContainer
    const savedOffset = input.startOffset
    const savedCollapsed = input.collapsed

    createWordRangeFromCaret(input)

    expect(input.startContainer).toBe(savedContainer)
    expect(input.startOffset).toBe(savedOffset)
    expect(input.collapsed).toBe(savedCollapsed)
  })

  // ---------------------------------------------------------------------------
  // 9. 边缘情况
  // ---------------------------------------------------------------------------
  it('空文本返回 null', () => {
    const range = createWordRangeFromCaret(makeCaretRange('', 0))
    expect(range).toBeNull()
  })

  it('caret 在单词末尾仍然选中该单词', () => {
    // "hello" offset 5（最后一个字符之后）
    const range = createWordRangeFromCaret(makeCaretRange('hello', 5))
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('hello')
  })

  it('单词后紧跟空格，caret 在词末正常选中', () => {
    const range = createWordRangeFromCaret(makeCaretRange('hello ', 4)) // caret 在 'l'
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('hello')
  })

  it('单词后紧跟空格，caret 在空格上选中左侧单词', () => {
    // Intl.Segmenter 边界包含 → 选 "hello"
    const range = createWordRangeFromCaret(makeCaretRange('hello ', 5))
    expect(range).not.toBeNull()
    expect(rangeToText(range!)).toBe('hello')
  })

  it('只含有标点符号返回 null', () => {
    const range = createWordRangeFromCaret(makeCaretRange(',.!?', 1))
    expect(range).toBeNull()
  })
})
