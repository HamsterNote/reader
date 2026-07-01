import type { IntermediateImage, IntermediateText } from '@hamster-note/types'
import { memo, Profiler, type CSSProperties } from 'react'

import {
  buildImageStyle,
  getImageGeometry,
  getTextBbox,
  type RenderableIntermediateText
} from './pageContentGeometry'
import { buildTextSpanStyle } from './textSpanStyle'

/**
 * `intermediate-document` 默认模式已加载页面的内容渲染器。
 *
 * 该组件渲染在外壳 `.hamster-reader__intermediate-page` 内部，负责把已加载
 * 的页面内容 bundle（基础底图、文本 span、OCR 文本 span、IntermediateImage
 * 内容项）绘制到 DOM。它复用与 direct / html-parser 路径相同的几何辅助函数，
 * 以保证选择、OCR 与测试行为一致。
 *
 * 关键约束：
 * - 绝不使用 `dangerouslySetInnerHTML`；所有内容均由 React 元素渲染。
 * - 保留与 direct 路径一致的 thumbnail / base-image duck typing。
 * - 文本 span 沿用 `.hamster-reader__intermediate-text` + `data-text-id` +
 *   `data-page-number`，以便选择载荷序列化器 / OCR / 测试正常工作。
 * - IntermediateImage 内容项以绝对定位 `<img>` 绘制，几何由 polygon 决定。
 */

/**
 * 文本 ref 注册回调类型 —— 与 viewer 内 `SetTextRef` 结构兼容，
 * 使文本 span 能被选择载荷追踪。
 */
export type IntermediateDocumentSetTextRef = (
  text: IntermediateText,
  pageNumber: number
) => (element: HTMLSpanElement | null) => void

export type IntermediateDocumentPageContentProps = {
  /** 当前页码（用于 data-page-number 与文本 ref 注册） */
  pageNumber: number
  /** getContent() 返回的文本内容（已过滤掉图片项） */
  texts: IntermediateText[]
  /** OCR 识别产生的文本 span（id 已带 ocr- 前缀） */
  ocrTexts: IntermediateText[]
  /** 基础底图 URL（来自 thumbnail / image / getThumbnail() 的 duck typing 解析） */
  baseImageSource: string | undefined
  /** getContent() 返回的 IntermediateImage 内容项 */
  images: IntermediateImage[]
  /** 文本 span ref 注册回调 */
  setTextRef: IntermediateDocumentSetTextRef
  onRenderTiming?: (
    pageNumber: number,
    startTime: number,
    commitTime: number,
    actualDuration: number
  ) => void
}

/**
 * 判断文本内容是否应被渲染。
 *
 * 纯空白（含零宽字符、全角空格等）的 "占位 span" 在原始 direct / html-parser
 * 路径中也会被过滤，这里保持一致以避免选择范围异常。
 */
const isRenderableText = (text: IntermediateText): boolean =>
  text.content.length > 0

/**
 * 渲染单个文本 span。复用 direct 路径的几何与样式逻辑。
 */
const renderTextSpan = (
  textData: IntermediateText,
  pageNumber: number,
  setTextRef: IntermediateDocumentSetTextRef,
  isOcr = false
) => {
  const text = textData as RenderableIntermediateText
  const bbox = getTextBbox(text)
  const spanStyle: CSSProperties = buildTextSpanStyle(text, bbox, true)

  return (
    <span
      key={text.id}
      ref={setTextRef(text, pageNumber)}
      className='hamster-reader__intermediate-text'
      data-text-id={text.id}
      data-page-number={pageNumber}
      data-ocr={isOcr ? 'true' : undefined}
      style={spanStyle}
    >
      {text.content}
    </span>
  )
}

/**
 * 渲染单个 IntermediateImage 内容项。以绝对定位 `<img>` 绘制在页面内容层内。
 */
const renderImageEntry = (image: IntermediateImage) => {
  const geometry = getImageGeometry(image)
  const imageStyle = buildImageStyle(image, geometry)

  return (
    <img
      key={image.id}
      className='hamster-reader__intermediate-page-image'
      src={image.src}
      alt=''
      aria-hidden='true'
      data-image-id={image.id}
      style={imageStyle}
    />
  )
}

function IntermediateDocumentPageContentComponent({
  pageNumber,
  texts,
  ocrTexts,
  baseImageSource,
  images,
  setTextRef,
  onRenderTiming
}: IntermediateDocumentPageContentProps) {
  // 过滤纯空白文本 span，与 direct / html-parser 路径保持一致
  const renderableTexts = texts.filter(isRenderableText)
  const renderableOcrTexts = ocrTexts.filter(isRenderableText)

  const content = (
    <>
      {/* 基础底图层：来自 thumbnail / image / getThumbnail() 的 duck typing 解析 */}
      {baseImageSource && (
        <img
          className='hamster-reader__intermediate-page-base-image'
          src={baseImageSource}
          alt=''
          aria-hidden='true'
        />
      )}

      {/* IntermediateImage 内容项（getContent() 返回的图片） */}
      {images.map(renderImageEntry)}

      {/* getContent() 文本 span */}
      {renderableTexts.map((text) =>
        renderTextSpan(text, pageNumber, setTextRef)
      )}

      {/* OCR 文本 span（id 已带 ocr- 前缀，复用同一渲染逻辑） */}
      {renderableOcrTexts.map((text) =>
        renderTextSpan(text, pageNumber, setTextRef, true)
      )}
    </>
  )

  if (!onRenderTiming) return content

  return (
    <Profiler
      id={`intermediate-page-content-${pageNumber}`}
      onRender={(
        _id,
        _phase,
        actualDuration,
        _baseDuration,
        startTime,
        commitTime
      ) => {
        onRenderTiming(pageNumber, startTime, commitTime, actualDuration)
      }}
    >
      {content}
    </Profiler>
  )
}

export const IntermediateDocumentPageContent = memo(
  IntermediateDocumentPageContentComponent
)
