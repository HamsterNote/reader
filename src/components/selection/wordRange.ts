/**
 * 从插入点（collapsed Range）扩展出单词级别的 Range。
 * 用于长按选择单词的场景。
 */

/**
 * 判断字符是否属于"单词字符"。
 * 涵盖：拉丁字母/数字/下划线、CJK 统一表意文字、
 * CJK 扩展 A/B、兼容表意文字、注音符号等。
 */

/** ASCII 字母、数字、下划线 */
const isAsciiWordChar = (code: number): boolean =>
  (code >= 0x0030 && code <= 0x0039) || // 0-9
  (code >= 0x0041 && code <= 0x005a) || // A-Z
  (code >= 0x0061 && code <= 0x007a) || // a-z
  code === 0x005f // _

/** CJK 统一表意文字（基本区 + 扩展 A/B + 兼容） */
const isCJKWordChar = (code: number): boolean =>
  (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
  (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
  (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
  (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
  (code >= 0x2f800 && code <= 0x2fa1f) // CJK Compatibility Supplement

/** 注音符号、平假名、片假名 */
const isKanaOrBopomofo = (code: number): boolean =>
  (code >= 0x3100 && code <= 0x312f) || // Bopomofo
  (code >= 0x3040 && code <= 0x309f) || // Hiragana
  (code >= 0x30a0 && code <= 0x30ff) // Katakana

/** 韩文音节 */
const isHangulSyllable = (code: number): boolean =>
  code >= 0xac00 && code <= 0xd7af

const isWordChar = (char: string): boolean => {
  const code = char.codePointAt(0)
  if (code === undefined) return false

  return (
    isAsciiWordChar(code) ||
    isCJKWordChar(code) ||
    isKanaOrBopomofo(code) ||
    isHangulSyllable(code)
  )
}

/**
 * 回退方案：基于字符类别向两边扩展单词。
 * 从 caret 的 offset 位置向左右扫描，收集连续的单词字符。
 */
const expandWordByCharClass = (
  textNode: Text,
  offset: number
): Range | null => {
  const text = textNode.textContent ?? ''
  if (text.length === 0) return null

  // 如果 caret 处在空白上，直接返回 null
  if (
    offset < text.length &&
    !isWordChar(text[offset]) &&
    text[offset] !== ' '
  ) {
    // 标点符号上，不扩展
    return null
  }
  if (offset < text.length && text[offset] === ' ') return null

  // 向左扩展
  let start = offset
  while (start > 0 && isWordChar(text[start - 1])) {
    start--
  }

  // 向右扩展
  let end = offset
  while (end < text.length && isWordChar(text[end])) {
    end++
  }

  // 如果 start === end，说明没有找到单词字符
  if (start === end) return null

  const doc = textNode.ownerDocument
  const range = doc.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, end)
  return range
}

/**
 * 使用 Intl.Segmenter 进行语言感知的分词。
 * 找到包含 caret offset 的那个 word segment，返回对应 Range。
 */
const expandWordBySegmenter = (
  textNode: Text,
  offset: number,
  segmenter: Intl.Segmenter
): Range | null => {
  const text = textNode.textContent ?? ''
  if (text.length === 0) return null

  const segments = Array.from(segmenter.segment(text))

  // 遍历 segments，找到包含 offset 的那个
  for (const seg of segments) {
    const segStart = seg.index
    const segEnd = seg.index + seg.segment.length

    // caret 在 segment 范围内
    if (offset >= segStart && offset <= segEnd) {
      // 只选择 word 类型的 segment（跳过空格、标点等）
      if (seg.isWordLike) {
        const doc = textNode.ownerDocument
        const range = doc.createRange()
        range.setStart(textNode, segStart)
        range.setEnd(textNode, segEnd)
        return range
      }
      // 落在非单词 segment 上，不扩展
      return null
    }
  }

  return null
}

// 保存 Intl.Segmenter 实例（懒初始化，避免每次调用都创建）
let cachedSegmenter: Intl.Segmenter | null | undefined

const getSegmenter = (): Intl.Segmenter | null => {
  if (cachedSegmenter !== undefined) return cachedSegmenter

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    cachedSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  } else {
    cachedSegmenter = null
  }
  return cachedSegmenter
}

/**
 * 从一个 collapsed Range（插入点）扩展出该位置所在的单词 Range。
 *
 * @param caretRange - 必须是 collapsed 的 Range（startContainer 为 Text 节点）
 * @returns 选中单词的新 Range，或无法扩展时返回 null
 *
 * 安全约束：
 * - 不修改输入 range
 * - 输入非 collapsed 时返回 null
 * - 输入不在文本节点内时返回 null
 */
export const createWordRangeFromCaret = (caretRange: Range): Range | null => {
  // 安全检查：输入必须是 collapsed
  if (!caretRange.collapsed) return null

  const { startContainer, startOffset } = caretRange

  // 必须在文本节点内
  if (startContainer.nodeType !== Node.TEXT_NODE) return null

  const textNode = startContainer as Text

  // 优先尝试 Intl.Segmenter
  const segmenter = getSegmenter()
  if (segmenter) {
    return expandWordBySegmenter(textNode, startOffset, segmenter)
  }

  // 回退到字符类别扩展
  return expandWordByCharClass(textNode, startOffset)
}
