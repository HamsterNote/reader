// HAM-88 任务 2.3：单个 spine 节的「DOM 位置 ↔ 旧页内字符偏移」双向映射。
//
// 旧坐标系（legacyText.ts）是纯正则管线；本模块在 DOM 上复现同一变换：
// - script/style 子树跳过（旧管线整体删除，不产空格）；
// - h1-h6 / aside 进出各算一次行边界；br、li 开标签、
//   p/div/section/article/header/footer/li/tr/table 闭标签算行边界；
// - small/b/strong/i/em 是行内哨兵，不产生任何字符；
// - 其余所有标签（开/闭各一次）折叠为一个空格。
// 行内空白（真实空白字符与标签空格混合的连续段）折叠为一个空格，行首尾裁剪，
// 行间直接拼接。折叠后保留的空格若来自真实空白字符则映射到该字符，否则是
// "虚拟空格"，锚定到相邻真实字符之间的缝隙。
//
// 产出的字符流与 legacyPageTextFromChapter 逐字相等时该节为 healthy；
// 不相等（命名实体、注释等正则/DOM 分歧）时整节降级：不做任何定位，
// 由上层按"不可定位、原样保留"处理。

/** 行边界标签（开闭都算）：旧管线 h1-h6、aside。 */
const BLOCK_SENTINEL_TAGS: Record<string, true> = {
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  aside: true
}

/** 仅闭标签算行边界：与旧管线 `</(p|div|…)>` → \n 一致。 */
const CLOSING_BOUNDARY_TAGS: Record<string, true> = {
  p: true,
  div: true,
  section: true,
  article: true,
  header: true,
  footer: true,
  li: true,
  tr: true,
  table: true
}

/** 行内哨兵标签：旧管线只打标记，不产生空格或边界。 */
const INLINE_SENTINEL_TAGS: Record<string, true> = {
  small: true,
  b: true,
  strong: true,
  i: true,
  em: true
}

const SKIP_SUBTREE_TAGS: Record<string, true> = {
  script: true,
  style: true
}

type KeptChar =
  | {
      readonly kind: 'real'
      readonly node: Text
      readonly offset: number
      /** 规范字符值：折叠空格为 U+0020（旧管线 \s+ → ' '），其余为原字符。 */
      readonly char: string
    }
  | { readonly kind: 'virtual'; readonly char: ' ' }

type Token =
  | { readonly type: 'text'; readonly node: Text }
  | { readonly type: 'boundary' }
  | { readonly type: 'space' }

const BOUNDARY_TOKEN: Token = { type: 'boundary' }
const SPACE_TOKEN: Token = { type: 'space' }

const collectTokens = (root: Node, tokens: Token[]): void => {
  if (root.nodeType === Node.TEXT_NODE) {
    if ((root as Text).data.length > 0) {
      tokens.push({ type: 'text', node: root as Text })
    }
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return

  const tag = (root as Element).localName.toLowerCase()
  if (SKIP_SUBTREE_TAGS[tag]) return

  const isBr = tag === 'br'
  const isBoundaryOpen = BLOCK_SENTINEL_TAGS[tag] || isBr || tag === 'li'
  const isInlineSentinel = INLINE_SENTINEL_TAGS[tag]

  if (isBoundaryOpen) tokens.push(BOUNDARY_TOKEN)
  else if (!isInlineSentinel) tokens.push(SPACE_TOKEN)

  for (const child of Array.from(root.childNodes)) {
    collectTokens(child, tokens)
  }

  if (isBr) return
  if (BLOCK_SENTINEL_TAGS[tag] || CLOSING_BOUNDARY_TAGS[tag]) {
    tokens.push(BOUNDARY_TOKEN)
  } else if (!isInlineSentinel) {
    tokens.push(SPACE_TOKEN)
  }
}

/** 从 token 流构建保留字符序列：边界分段、段内折叠、段首尾裁剪。 */
const buildKeptChars = (tokens: readonly Token[]): KeptChar[] => {
  const kept: KeptChar[] = []
  // 当前空白 run 里第一个真实空白字符的位置（折叠后的空格锚定到它）。
  let pendingReal: { node: Text; offset: number } | null = null
  let pendingAny = false

  const flushPending = (lineHasContent: boolean) => {
    if (!pendingAny) return
    // 行首裁剪：行内已有内容时才保留折叠空格。
    if (lineHasContent) {
      kept.push(
        pendingReal
          ? {
              kind: 'real',
              node: pendingReal.node,
              offset: pendingReal.offset,
              char: ' '
            }
          : { kind: 'virtual', char: ' ' }
      )
    }
    pendingReal = null
    pendingAny = false
  }

  let lineHasContent = false
  for (const token of tokens) {
    if (token.type === 'boundary') {
      // 行尾裁剪：丢弃未落地的空白 run。
      pendingReal = null
      pendingAny = false
      lineHasContent = false
      continue
    }
    if (token.type === 'space') {
      pendingAny = true
      continue
    }
    const data = token.node.data
    for (let index = 0; index < data.length; index += 1) {
      if (/\s/.test(data[index])) {
        if (!pendingReal) pendingReal = { node: token.node, offset: index }
        pendingAny = true
        continue
      }
      flushPending(lineHasContent)
      kept.push({
        kind: 'real',
        node: token.node,
        offset: index,
        char: data[index]
      })
      lineHasContent = true
    }
  }
  return kept
}

export type SectionTextIndex = {
  /** 字符流与旧页文本逐字一致。false 时禁止任何定位。 */
  readonly healthy: boolean
  /** 旧页文本（调用方传入的权威值）。 */
  readonly legacyText: string
  /** DOM 变换得到的字符流；healthy 时与 legacyText 相等。 */
  readonly streamText: string
  /** 旧页内 [start, end) → 该节文档内的 DOM Range；越界或空流返回 null。 */
  readonly rangeFromOffsets: (start: number, end: number) => Range | null
  /** DOM Range（端点可落在元素上）→ 旧页内 [start, end)；越界返回 null。 */
  readonly offsetsFromRange: (
    range: Range
  ) => { readonly start: number; readonly end: number } | null
}

export const buildSectionTextIndex = (
  doc: Document,
  legacyText: string
): SectionTextIndex => {
  const body = doc.body ?? doc.getElementsByTagName('body')[0] ?? null
  const tokens: Token[] = []
  if (body) collectTokens(body, tokens)
  const kept = buildKeptChars(tokens)
  const streamText = kept.map((char) => char.char).join('')
  const healthy = streamText === legacyText

  /** 保留字符 i 之前的 DOM 位置；虚拟空格向前回退到上一个真实字符之后。 */
  const positionBefore = (index: number): { node: Node; offset: number } => {
    for (let i = index; i >= 0; i -= 1) {
      const char = kept[i]
      if (i < index && char.kind === 'real') {
        return { node: char.node, offset: char.offset + 1 }
      }
      if (i === index && char.kind === 'real') {
        return { node: char.node, offset: char.offset }
      }
    }
    return { node: body ?? doc, offset: 0 }
  }

  /** 保留字符 i 之后的 DOM 位置；虚拟空格向后推进到下一个真实字符之前。 */
  const positionAfter = (index: number): { node: Node; offset: number } => {
    for (let i = index; i < kept.length; i += 1) {
      const char = kept[i]
      if (i > index && char.kind === 'real') {
        return { node: char.node, offset: char.offset }
      }
      if (i === index && char.kind === 'real') {
        return { node: char.node, offset: char.offset + 1 }
      }
    }
    const last = kept[kept.length - 1]
    if (last?.kind === 'real') {
      return { node: last.node, offset: last.offset + 1 }
    }
    return { node: body ?? doc, offset: 0 }
  }

  const rangeFromOffsets = (start: number, end: number): Range | null => {
    if (!healthy || kept.length === 0) return null
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > kept.length ||
      start > end
    ) {
      return null
    }
    const from =
      start >= kept.length
        ? positionAfter(kept.length - 1)
        : positionBefore(start)
    const to = end === 0 ? from : positionAfter(end - 1)
    const range = doc.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    return range
  }

  type NormalizedEndpoint = {
    readonly reference: Node
    readonly referenceOffset: number
    readonly side: 'before' | 'after'
  }

  /**
   * 元素端点换算为「参照节点 + before/after」；文本端点原样返回。
   * 参照落回文本节点时偏移换算为文本内偏移（0 或全长），
   * 不能沿用元素的子节点下标。
   */
  const normalizeEndpoint = (
    container: Node,
    offset: number
  ): NormalizedEndpoint => {
    if (container.nodeType !== Node.ELEMENT_NODE) {
      return { reference: container, referenceOffset: offset, side: 'before' }
    }
    const children = container.childNodes
    if (offset >= children.length && children.length > 0) {
      const reference = children[children.length - 1]
      return {
        reference,
        referenceOffset:
          reference.nodeType === Node.TEXT_NODE
            ? (reference as Text).data.length
            : offset,
        side: 'after'
      }
    }
    const reference = offset < children.length ? children[offset] : container
    return {
      reference,
      referenceOffset: reference.nodeType === Node.TEXT_NODE ? 0 : offset,
      side: 'before'
    }
  }

  const isRealCharBefore = (
    char: { node: Text; offset: number },
    endpoint: NormalizedEndpoint
  ): boolean => {
    const { reference, referenceOffset, side } = endpoint
    if (char.node === reference && reference.nodeType === Node.TEXT_NODE) {
      return char.offset < referenceOffset
    }
    const relation = reference.compareDocumentPosition(char.node)
    // 后代关系会同时带 PRECEDING/FOLLOWING 位，必须先判包含。
    if (relation & Node.DOCUMENT_POSITION_CONTAINED_BY) {
      // 字符在参照元素内部：位置在元素首子节点之前则字符在其后，反之在前。
      return side === 'after'
    }
    return Boolean(relation & Node.DOCUMENT_POSITION_PRECEDING)
  }

  /** 虚拟空格的计数规则：后随字符严格在前计入；恰好落在其起点仅 start 边计入。 */
  const shouldCountVirtual = (
    following: KeptChar | undefined,
    endpoint: NormalizedEndpoint,
    edge: 'start' | 'end'
  ): boolean => {
    if (following?.kind !== 'real') {
      // 末尾虚拟空格（实践中不存在：末位保留字符必为真实字符）：end 边计入。
      return edge === 'end'
    }
    if (isRealCharBefore(following, endpoint)) return true
    return (
      edge === 'start' &&
      following.node === endpoint.reference &&
      endpoint.reference.nodeType === Node.TEXT_NODE &&
      following.offset === endpoint.referenceOffset
    )
  }

  /**
   * 计数规则：严格位于端点之前的真实字符全部计入；虚拟空格按
   * shouldCountVirtual 的 start/end 边规则计入。
   */
  const offsetFromPosition = (
    container: Node,
    offset: number,
    edge: 'start' | 'end'
  ): number | null => {
    if (!healthy || !body) return null
    if (!body.contains(container) && container !== body) return null

    const endpoint = normalizeEndpoint(container, offset)
    let count = 0
    for (let index = 0; index < kept.length; index += 1) {
      const char = kept[index]
      if (char.kind === 'virtual') {
        if (shouldCountVirtual(kept[index + 1], endpoint, edge)) count += 1
      } else if (isRealCharBefore(char, endpoint)) {
        count += 1
      }
    }
    return count
  }

  const offsetsFromRange = (
    range: Range
  ): { readonly start: number; readonly end: number } | null => {
    if (!healthy) return null
    const start = offsetFromPosition(
      range.startContainer,
      range.startOffset,
      'start'
    )
    const end = offsetFromPosition(range.endContainer, range.endOffset, 'end')
    if (start === null || end === null || end < start) return null
    return { start, end }
  }

  return { healthy, legacyText, streamText, rangeFromOffsets, offsetsFromRange }
}
