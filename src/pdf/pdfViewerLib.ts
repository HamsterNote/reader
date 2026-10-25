// pdfjs-dist 5.4 的 web/pdf_viewer.mjs 在模块求值期从 globalThis.pdfjsLib
// 读取 core 导出。先显式导入 ./pdfjsRuntime（其模块体设置该全局），
// 再 re-export viewer 组件——依赖按源码顺序求值，顺序由此文件保证。

import './pdfjsRuntime'

export {
  EventBus,
  PDFLinkService,
  PDFViewer
} from 'pdfjs-dist/web/pdf_viewer.mjs'
