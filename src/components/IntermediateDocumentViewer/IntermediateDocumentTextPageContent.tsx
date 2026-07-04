import type { IntermediateText } from '@hamster-note/types'
import { Fragment, memo } from 'react'

import type { IntermediateDocumentSetTextRef } from './IntermediateDocumentPageContent'

/**
 * `intermediate-document` 文本渲染模式（`renderMode="text"`）单页内容渲染器。
 *
 * 与 layout 模式的 {@link IntermediateDocumentPageContent} 相对，文本模式以
 * 普通文档流（document flow）绘制 `IntermediateText` 条目，不做任何绝对定位、
 * 不渲染基础底图 / IntermediateImage / OCR span。每页内容容器自带 `padding: 5px`。
 *
 * 关键约束（与 layout 模式保持一致）：
 * - 绝不使用 `dangerouslySetInnerHTML`；所有文本均为 React 文本节点。
 * - 纯空白 `content` 跳过渲染（镜像 layout 模式 `isRenderableText` 行为）。
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
  /** 文本 span ref 注册回调（与 layout 模式同型）；可选 */
  setTextRef?: IntermediateDocumentSetTextRef
  /**
   * 渲染计时回调（预留）；与 layout 模式 onRenderTiming 语义不同，
   * 此处接收页码与已挂载的页面 DOM 元素，供未来 Profiler 集成使用。
   */
  onRenderTiming?: (pageNumber: number, element: Element) => void
}

/**
 * 判断文本内容是否应被渲染。
 *
 * 镜像 layout 模式 `IntermediateDocumentPageContent` 的 `isRenderableText`：
 * 纯空白（零长度）的占位 span 被过滤，避免文档流中出现多余空节点。
 * 额外处理 undefined/null 以防御外部数据。
 */
const isRenderableText = (text: IntermediateText): boolean =>
  typeof text.content === 'string' && text.content.length > 0

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
  setTextRef
}: IntermediateDocumentTextPageContentProps) {
  // 过滤纯空白文本，与 layout 模式渲染契约保持一致
  const renderableTexts = texts.filter(isRenderableText)

  return (
    <>
      {renderableTexts.map((text, index) => {
        // key 优先用 text.id，缺失时回退到数组索引
        const key = text.id ?? index
        const eolKey = `${key}-eol`

        // Fragment 包裹 span 与可选的 <br />，保证 <br /> 紧跟在对应
        // span 之后（DOM 顺序与文本数组顺序一致），实现文档流换行。
        return (
          <Fragment key={key}>
            <span
              // setTextRef 签名为 (text, pageNumber) => (element) => void，
              // 与 layout 模式完全兼容；未提供时不设置 ref。
              ref={setTextRef ? setTextRef(text, pageNumber) : undefined}
              className='hamster-reader__intermediate-text hamster-reader__intermediate-text--flow'
              data-text-id={text.id}
              data-page-number={pageNumber}
            >
              {text.content}
            </span>
            {/* isEOL: 在该 span 之后立即换行 */}
            {text.isEOL ? <br key={eolKey} /> : null}
          </Fragment>
        )
      })}
    </>
  )
}

export const IntermediateDocumentTextPageContent = memo(
  IntermediateDocumentTextPageContentComponent
)
