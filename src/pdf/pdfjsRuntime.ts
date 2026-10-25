// HAM-89 / OpenSpec change migrate-reader-to-expo-webview 主线 B（tasks.md 3.1）。
// pdfjs-dist 运行时入口：core / worker / viewer / 样式必须同版本，
// 版本锁定在 package.json（pdfjs-dist 5.4.530，与 @hamster-note/pdf-parser
// 内部 pin 一致）。本模块只做导入集中与 worker 配置，业务逻辑见同目录其余模块。

import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordResponses,
  RenderingCancelledException,
  version as pdfjsApiVersion
} from 'pdfjs-dist'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api'

// pdfjs-dist 5.4 的 web/pdf_viewer.mjs 从 globalThis.pdfjsLib 读取 core 导出
//（沿用 Firefox 内置 viewer 的打包约定）。本模块在 PdfDocumentViewer 的依赖
// 顺序上先于 viewer 模块求值，保证该全局在 viewer 模块加载前就位。
declare global {
  var pdfjsLib: unknown
}
if (typeof globalThis.pdfjsLib === 'undefined') {
  globalThis.pdfjsLib = pdfjsLib
}

export {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordResponses,
  RenderingCancelledException,
  pdfjsApiVersion
}
export type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  TextContent,
  TextItem
}

/** package.json 锁定的 pdfjs-dist 版本；core/worker/viewer/styles 同源同版本。 */
export const PDFJS_DIST_VERSION = '5.4.530'

/**
 * 配置 worker 来源。宿主（demo / Expo 打包）负责把
 * `pdfjs-dist/build/pdf.worker.min.mjs` 作为资产提供并传入 URL。
 * pdf.js 自身会在 API 与 worker 版本不一致时抛错，此处只做显式断言，
 * 让版本漂移在启动期即暴露。
 */
export function configurePdfJsWorker(workerSrc: string): void {
  GlobalWorkerOptions.workerSrc = workerSrc
}

export function assertPdfJsVersion(): void {
  if (pdfjsApiVersion !== PDFJS_DIST_VERSION) {
    throw new Error(
      `pdfjs-dist version mismatch: expected ${PDFJS_DIST_VERSION}, got ${pdfjsApiVersion}`
    )
  }
}
