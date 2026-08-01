import type {
  IntermediateContent,
  IntermediateImage,
  IntermediateParagraph,
  IntermediateText
} from '@hamster-note/types'
import { memo } from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
import { IntermediateDocumentFlowContent } from './IntermediateDocumentFlowContent'
import type { IntermediateDocumentSetTextRef } from './IntermediateDocumentPageContent'

/**
 * `intermediate-document` 文本渲染模式（`renderMode="text"`）单页内容渲染器。
 *
 * 与 layout 模式的 {@link IntermediateDocumentPageContent} 相对，文本模式以
 * 普通文档流（document flow）绘制 `IntermediateText` 与 `IntermediateImage` 条目，
 * 不渲染基础底图 / thumbnail / OCR span。每页内容容器自带 `padding: 5px`。
 *
 * 关键约束（与 layout 模式保持一致）：
 * - 绝不使用 `dangerouslySetInnerHTML`；所有文本均为 React 文本节点。
 * - 非 EOL 空文本跳过；EOL 空文本保留为裸 `<br />`，用于 TXT 空行。
 * - 文本 span 沿用 `.hamster-reader__intermediate-text` + `data-text-id` +
 *   `data-page-number`，保证选择 / 测试行为一致。
 * - `text.isEOL` 为真时在该 span 后追加 `<br />`，实现换行。
 * - 条目按传入顺序渲染。
 */

/**
 * 文本模式单页内容组件 props。
 */
export type IntermediateDocumentTextPageContentProps = {
  /** 当前页码（用于 data-page-number 与文本 ref 注册） */
  pageNumber: number
  /** 已加载的文本内容列表（由 useLazyPageQueue text 模式过滤后传入） */
  texts: IntermediateText[]
  paragraphs: IntermediateParagraph[]
  images: IntermediateImage[]
  orderedContent?: IntermediateContent[]
  /** PDF 文本模式按文字 box 重建视觉行、段落和相对字号。 */
  isPdf?: boolean
  /** 文本 span ref 注册回调（与 layout 模式同型）；可选 */
  setTextRef?: IntermediateDocumentSetTextRef
  fontScale?: ReaderFontScale
  /**
   * 渲染计时回调（预留）；与 layout 模式 onRenderTiming 语义不同，
   * 此处接收页码与已挂载的页面 DOM 元素，供未来 Profiler 集成使用。
   */
  onRenderTiming?: (pageNumber: number, element: Element) => void
}

/**
 * 判断文本内容是否应被渲染。
 *
 * 镜像 layout 模式 `IntermediateDocumentPageContent` 的 span 过滤：
 * 非 EOL 空文本被过滤，EOL 空文本转成裸 `<br />` 表达空行。
 * 额外处理 undefined/null 以防御外部数据。
 */
/**
 * 文本模式单页内容渲染组件。
 *
 * 将 `texts` 数组按顺序映射为文档流 `<span>` 节点。每个 span：
 * - class: `hamster-reader__intermediate-text hamster-reader__intermediate-text--flow`
 * - 属性: `data-text-id`、`data-page-number`
 * - ref: 若 `setTextRef` 提供，则注册到选择追踪层
 *
 * 当 `text.isEOL` 为真时，在该 span 之后追加 `<br />`。
 */
function IntermediateDocumentTextPageContentComponent({
  pageNumber,
  texts,
  paragraphs,
  images,
  orderedContent,
  isPdf = false,
  setTextRef,
  fontScale
}: IntermediateDocumentTextPageContentProps) {
  return (
    <IntermediateDocumentFlowContent
      pageNumber={pageNumber}
      content={orderedContent ?? [...texts, ...images]}
      paragraphs={paragraphs}
      isPdf={isPdf}
      setTextRef={setTextRef}
      fontScale={fontScale}
      preserveSourceFontSize={false}
    />
  )
}

export const IntermediateDocumentTextPageContent = memo(
  IntermediateDocumentTextPageContentComponent
)
