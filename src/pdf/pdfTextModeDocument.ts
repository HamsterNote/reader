// HAM-89 / tasks.md 3.2：保留既有 Text 模式入口——从 PDF.js 文本内容派生
// 兼容文本视图（design.md 决策 4：「从 PDF.js 文本内容派生兼容文本视图，
// Layout 页面由官方 viewer 展示」）。本 facade 只服务 Text 模式与书签锚点，
// 不作为主展示链路；页文本与 canonical 坐标系逐字一致（pdfTextMapping）。

import {
  IntermediateDocument,
  IntermediatePage,
  IntermediatePageMap,
  IntermediateText,
  TextDir
} from '@hamster-note/types'

import type { PageViewport, PDFDocumentProxy, TextItem } from './pdfjsRuntime'
import {
  buildCanonicalPageText,
  canonicalTextId,
  type CanonicalPageText
} from './pdfTextMapping'

const isTextItem = (item: unknown): item is TextItem =>
  typeof item === 'object' && item !== null && 'str' in item

const buildPagePolygon = (
  item: TextItem,
  scaleOneViewport: PageViewport
): IntermediateText['polygon'] => {
  // user space（y 向上）：文字盒下缘取基线，上缘加 item.height。
  const x = item.transform[4] ?? 0
  const yBaseline = item.transform[5] ?? 0
  const corners: Array<[number, number]> = [
    [x, yBaseline],
    [x + item.width, yBaseline],
    [x + item.width, yBaseline + item.height],
    [x, yBaseline + item.height]
  ]
  const projected = corners.map(
    (corner) =>
      scaleOneViewport.convertToViewportPoint(corner[0], corner[1]) as [
        number,
        number
      ]
  )
  return [projected[0], projected[1], projected[2], projected[3]]
}

const buildPageTexts = (
  items: readonly TextItem[],
  pageNumber: number,
  scaleOneViewport: PageViewport
): { texts: IntermediateText[]; canonical: CanonicalPageText } => {
  const canonical = buildCanonicalPageText(pageNumber, items)

  const texts = canonical.spans
    .filter((span) => span.canonicalText !== '')
    .map((span) => {
      const item = items[span.itemIndex]
      const fontSize =
        item.height > 0
          ? item.height
          : Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0) || 12
      return new IntermediateText({
        id: canonicalTextId(pageNumber, span.itemIndex),
        content: span.canonicalText,
        fontSize,
        fontFamily: item.fontName ?? '',
        fontWeight: 400,
        italic: false,
        color: '#000000',
        polygon: buildPagePolygon(item, scaleOneViewport),
        lineHeight: fontSize * 1.2,
        ascent: fontSize * 0.8,
        descent: fontSize * 0.2,
        dir: TextDir.LTR,
        skew: 0,
        isEOL: item.hasEOL
      })
    })

  return { texts, canonical }
}

export type PdfTextModeDocument = {
  readonly document: IntermediateDocument
  readonly getCanonicalPageText: (
    pageNumber: number
  ) => CanonicalPageText | undefined
}

/**
 * 由 PDFDocumentProxy 派生 Text 模式兼容文档（异步：需先取各页可视尺寸，
 * IntermediatePageMap 在构造时一次性读取 size）。
 * - 页 ID/页号与 Layout 一致（page-N，N 为原 PDF 页号）；
 * - 页尺寸取 scale=1 可视尺寸（旋转已应用），与旧 pdf-parser 输出一致；
 * - 文本内容惰性加载（getTextContent 按需调用），不整册提取文本。
 * 缩略图不由本 facade 提供（进度缩略图仅 Layout，矩阵 §7）。
 */
export async function createPdfTextModeDocument(
  document: PDFDocumentProxy,
  documentId: string
): Promise<PdfTextModeDocument> {
  const canonicalByPage = new Map<number, CanonicalPageText>()
  const pdfPages = await Promise.all(
    Array.from({ length: document.numPages }, (_, index) =>
      document.getPage(index + 1)
    )
  )

  const pagesMap = IntermediatePageMap.makeByInfoList(
    pdfPages.map((pdfPage, index) => {
      const pageNumber = index + 1
      const scaleOneViewport = pdfPage.getViewport({ scale: 1 })
      return {
        id: `page-${pageNumber}`,
        pageNumber,
        size: { x: scaleOneViewport.width, y: scaleOneViewport.height },
        getData: async () => {
          const textContent = await pdfPage.getTextContent()
          const { texts, canonical } = buildPageTexts(
            textContent.items.filter(isTextItem),
            pageNumber,
            scaleOneViewport
          )
          canonicalByPage.set(pageNumber, canonical)
          return new IntermediatePage({
            id: `page-${pageNumber}`,
            number: pageNumber,
            width: scaleOneViewport.width,
            height: scaleOneViewport.height,
            texts
          })
        }
      }
    })
  )

  return {
    document: new IntermediateDocument({
      id: documentId,
      title: '',
      pagesMap
    }),
    getCanonicalPageText: (pageNumber) => canonicalByPage.get(pageNumber)
  }
}
