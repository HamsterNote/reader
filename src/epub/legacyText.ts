// HAM-88 任务 2.3：旧 EPUB 文本管线移植。
// 逐行复刻基线 237c0d5 的 @hamster-note/epub-parser@0.3.0-beta.2：
// - EpubArchive.getChapter 的 body 提取与预处理（src/href 重写只改属性值，
//   不影响文本提取，故省略；on* 属性改名同理）。
// - htmlToStyledTextLines 的正则规范化（哨兵标记、块级换行、标签→空格、
//   受限实体解码、行内空白折叠）。
// 旧逻辑页的文本坐标系 = 规范化行内容无分隔符拼接（见
// openspec/changes/migrate-reader-to-expo-webview/contracts/sample-manifest.md）。
// 该管线是兼容索引的唯一旧坐标来源；主展示不使用本模块。

// 私用区哨兵字符（与旧实现一致）；用 fromCharCode 避免源码出现不可见字符。
const SENTINEL_OPEN = String.fromCharCode(0xe000)
const SENTINEL_CLOSE = String.fromCharCode(0xe001)

/** 与旧实现一致的受限实体解码：未知实体保留原始 `&entity;` 形式。 */
const decodeHtmlEntity = (entity: string): string => {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  }
  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    const codePoint = Number.parseInt(entity.slice(2), 16)
    return Number.isFinite(codePoint)
      ? String.fromCodePoint(codePoint)
      : `&${entity};`
  }
  if (entity.startsWith('#')) {
    const codePoint = Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(codePoint)
      ? String.fromCodePoint(codePoint)
      : `&${entity};`
  }
  return namedEntities[entity] ?? `&${entity};`
}

const markTag = (html: string, tagPattern: RegExp, name: string): string =>
  html.replace(tagPattern, `${SENTINEL_OPEN}${name}${SENTINEL_CLOSE}`)

/**
 * 线性扫描的 script/style 块剔除，替代旧管线中易回溯的
 * `/<tag\b[^>]*>[\s\S]*?<\/tag…>/gi` 正则（sonarjs/slow-regex）。
 * 逐参数对齐旧正则语义；未闭合的块按旧正则行为保留原文（不匹配不删）。
 */
const stripTagBlocks = (
  html: string,
  tag: 'script' | 'style',
  options: { wordBoundary: boolean; allowCloseAttributes: boolean }
): string => {
  const openPattern = new RegExp(
    options.wordBoundary ? `<${tag}\\b[^>]*>` : `<${tag}[^>]*>`,
    'i'
  )
  const closePattern = new RegExp(
    options.allowCloseAttributes ? `</${tag}[^>]*>` : `</${tag}>`,
    'i'
  )
  let rest = html
  let output = ''
  let stripped = false
  for (;;) {
    const openMatch = openPattern.exec(rest)
    if (!openMatch) break
    const afterOpen = openMatch.index + openMatch[0].length
    const closeMatch = closePattern.exec(rest.slice(afterOpen))
    if (!closeMatch) break
    output += rest.slice(0, openMatch.index)
    rest = rest.slice(afterOpen + closeMatch.index + closeMatch[0].length)
    stripped = true
  }
  return stripped ? output + rest : html
}

/**
 * 章节原始 XHTML → 规范化文本行（只保留 content；旧管线同时算出的字号/字重
 * 不影响文本坐标，不移植）。
 */
export const htmlToLegacyTextLines = (html: string): readonly string[] => {
  // 与旧正则 <tag\b[^>]*>[\s\S]*?</tag> 完全同参数。
  let marked = stripTagBlocks(
    stripTagBlocks(html, 'script', {
      wordBoundary: true,
      allowCloseAttributes: false
    }),
    'style',
    { wordBoundary: true, allowCloseAttributes: false }
  )
  marked = marked.replace(
    /<h([1-6])\b[^>]*>/gi,
    (_match, level) => `\n${SENTINEL_OPEN}h${level}${SENTINEL_CLOSE}\n`
  )
  marked = marked.replace(
    /<\/h([1-6])\s*>/gi,
    (_match, level) => `\n${SENTINEL_OPEN}/h${level}${SENTINEL_CLOSE}\n`
  )
  marked = marked.replace(
    /<aside\b[^>]*>/gi,
    `\n${SENTINEL_OPEN}fn${SENTINEL_CLOSE}\n`
  )
  marked = marked.replace(
    /<\/aside\s*>/gi,
    `\n${SENTINEL_OPEN}/fn${SENTINEL_CLOSE}\n`
  )
  marked = markTag(marked, /<(small)\b[^>]*>/gi, 'fn')
  marked = markTag(marked, /<\/(small)\s*>/gi, '/fn')
  marked = markTag(marked, /<(?:b|strong)\b[^>]*>/gi, 'b')
  marked = markTag(marked, /<\/(?:b|strong)\s*>/gi, '/b')
  marked = markTag(marked, /<(?:i|em)\b[^>]*>/gi, 'i')
  marked = markTag(marked, /<\/(?:i|em)\s*>/gi, '/i')
  const withBreaks = marked
    // eslint-disable-next-line sonarjs/slow-regex -- 逐字移植旧解析管线正则（基线 epub-parser 同款），输入为单章 XHTML，等价性优先于重写
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|li|tr|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    // eslint-disable-next-line sonarjs/slow-regex -- 同上：旧管线 `<[^>]+>` → 空格的原始规则，改动会破坏坐标对齐
    .replace(/<[^>]+>/g, ' ')
    .replace(
      /&([a-zA-Z][a-zA-Z\d]+|#\d+|#x[0-9a-fA-F]+);/g,
      (_match, entity: string) => decodeHtmlEntity(entity)
    )

  const sentinelPattern = new RegExp(
    `${SENTINEL_OPEN}([^${SENTINEL_CLOSE}]*)${SENTINEL_CLOSE}`,
    'g'
  )
  return withBreaks
    .split(/\r?\n/)
    .map((rawLine) => {
      const content = rawLine
        .replace(sentinelPattern, '')
        .replace(/\s+/g, ' ')
        .trim()
      return content || undefined
    })
    .filter((line): line is string => line !== undefined)
}

/**
 * 复刻 EpubArchive.getChapter 的输入预处理：换行占位、body 提取、
 * script/style 剔除。src/href 重写与 on* 改名只影响标签属性，文本管线会把
 * 整个标签折叠为一个空格，因此省略不影响结果（test/epub/legacy-model.test.ts
 * 用旧解析链路逐字验证）。
 */
export const extractLegacyChapterHtml = (rawChapter: string): string => {
  // 旧实现先把 \n 换成 \0 让 `.` 跨行匹配，最后再换回来；这里统一用
  // [\s\S] 匹配，等价且无需占位往返。
  let html = rawChapter
  html.replace(
    /<body[^>]*?>([\s\S]*)<\/body[^>]*?>/i,
    (_match, body: string) => {
      html = body.trim()
      return ''
    }
  )
  // 与旧正则 <tag[^>]*?>[\s\S]*?</tag[^>]*?> 完全同参数（无 \b、闭合可带属性）。
  return stripTagBlocks(
    stripTagBlocks(html, 'script', {
      wordBoundary: false,
      allowCloseAttributes: true
    }),
    'style',
    { wordBoundary: false, allowCloseAttributes: true }
  ).trim()
}

/** 旧逻辑页文本：body 预处理后规范化行内容的无分隔符拼接。 */
export const legacyPageTextFromChapter = (rawChapter: string): string =>
  htmlToLegacyTextLines(extractLegacyChapterHtml(rawChapter)).join('')
